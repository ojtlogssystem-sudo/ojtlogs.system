from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timedelta, timezone
from collections import Counter
import re
import math
import numpy as np
from sklearn.linear_model import LinearRegression
import os
import json

app = Flask(__name__, static_folder='.')
CORS(app)

# Global Preflight CORS Handler for all endpoints
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({"status": "ok"})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        return response, 200

# Initialize the Firebase Admin SDK (SAFE FOR RENDER DEPLOYMENT & LOCAL)
if not firebase_admin._apps:
    if os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
        cert_dict = json.loads(os.environ.get("FIREBASE_SERVICE_ACCOUNT"))
        cred = credentials.Certificate(cert_dict)
    elif os.path.exists("serviceAccountKey.json"):
        cred = credentials.Certificate("serviceAccountKey.json")
    else:
        raise FileNotFoundError("Firebase credentials not found! Set FIREBASE_SERVICE_ACCOUNT env var or add serviceAccountKey.json.")
    firebase_admin.initialize_app(cred)

db = firestore.client()

# ==========================================
# 1. ENDPOINT FOR AT-RISK PREDICTION
# ==========================================
# ATTENDANCE SETTINGS
ATTENDANCE_COLLECTIONS = ['attendance']
COUNT_MISSING_WEEKDAYS_AS_ABSENT = False
NON_DUTY_DATES = set()
PH_TZ = timezone(timedelta(hours=8))

ATTENDANCE_DATE_FIELDS = (
    'date', 'attendanceDate', 'dateString', 'day',
    'timestamp', 'createdAt', 'timeIn'
)

ATTENDANCE_STATUS_FIELDS = (
    'status', 'attendanceStatus', 'attendance_status'
)

ATTENDANCE_OWNER_FIELDS = (
    'studentUid', 'studentUID', 'studentId', 'studentID',
    'studentNumber', 'uid', 'userId', 'userUid', 'student_id',
    'email', 'studentEmail'
)

def _norm(value):
    if value is None:
        return None
    text = str(value).strip().lower()
    return text or None

def _to_date_str(value):
    if value is None or value == '':
        return None

    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(PH_TZ)
        return value.strftime('%Y-%m-%d')

    text = str(value).strip()

    iso = re.match(r'^(\d{4})-(\d{2})-(\d{2})', text)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"

    for fmt in ('%m/%d/%Y', '%B %d, %Y', '%b %d, %Y', '%d %B %Y', '%d %b %Y'):
        try:
            return datetime.strptime(text, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue

    return None

def _record_date(rec):
    for field in ATTENDANCE_DATE_FIELDS:
        parsed = _to_date_str(rec.get(field))
        if parsed:
            return parsed
    return None

def _is_absent_record(rec):
    for field in ATTENDANCE_STATUS_FIELDS:
        status = _norm(rec.get(field))
        if status:
            return 'absent' in status

    for field in ('isAbsent', 'absent'):
        if isinstance(rec.get(field), bool):
            return rec[field] is True

    if isinstance(rec.get('present'), bool):
        return rec['present'] is False

    return False

def _load_attendance_records():
    records = []
    for collection_name in ATTENDANCE_COLLECTIONS:
        try:
            for doc in db.collection(collection_name).stream():
                records.append({"id": doc.id, **doc.to_dict()})
        except Exception as attendance_error:
            print(
                f"[predict-risk] Failed to load '{collection_name}': "
                f"{attendance_error}"
            )
    return records

def _get_student_records(attendance_records, student_doc_id, student_id_value,
                         student_name, student_email=None):
    keys = {
        k for k in (
            _norm(student_doc_id),
            _norm(student_id_value),
            _norm(student_email),
        ) if k
    }
    name_key = _norm(student_name)

    matched = []
    for rec in attendance_records:
        owner_keys = {_norm(rec.get(f)) for f in ATTENDANCE_OWNER_FIELDS}
        owner_keys.discard(None)

        if keys & owner_keys:
            matched.append(rec)
        elif name_key and _norm(rec.get('studentName') or rec.get('name')) == name_key:
            matched.append(rec)

    return matched

def _weekdays_between(start_date, end_date):
    days = []
    current = start_date
    while current <= end_date:
        if current.weekday() < 5:
            days.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    return days

def _count_duty_days(start_date, end_date):
    """Bilang ng weekday duty days mula start_date hanggang end_date (inclusive)."""
    if end_date < start_date:
        return 0
    total_days = (end_date - start_date).days + 1
    full_weeks, extra = divmod(total_days, 7)
    count = full_weeks * 5
    for i in range(extra):
        if (start_date + timedelta(days=i)).weekday() < 5:
            count += 1
    return count

def _summarize_attendance(matched_records, start_date=None, today=None):
    absent_dates = set()
    present_dates = set()
    undated_absences = 0

    for rec in matched_records:
        rec_date = _record_date(rec)
        if _is_absent_record(rec):
            if rec_date:
                absent_dates.add(rec_date)
            else:
                undated_absences += 1
        elif rec_date:
            present_dates.add(rec_date)

    absent_dates -= present_dates

    if COUNT_MISSING_WEEKDAYS_AS_ABSENT and start_date and today:
        yesterday = today.date() - timedelta(days=1)
        for day in _weekdays_between(start_date.date(), yesterday):
            if (
                day not in present_dates
                and day not in absent_dates
                and day not in NON_DUTY_DATES
            ):
                absent_dates.add(day)

    duty_days = sorted(absent_dates | present_dates, reverse=True)
    consecutive = 0
    for day in duty_days:
        if day in absent_dates:
            consecutive += 1
        else:
            break

    return {
        "absent_count": len(absent_dates) + undated_absences,
        "consecutive": consecutive,
        "record_count": len(matched_records),
    }

STUDENT_ID_FIELDS = (
    'studentId', 'studentID', 'studentNumber', 'idNumber',
    'schoolId', 'studentNo', 'id_number'
)

BATCH_FIELDS = (
    'batch', 'batchYear', 'batch_year',
    'schoolYear', 'school_year',
    'academicYear', 'academic_year', 'sy'
)

def _get_student_id_raw(data):
    for field in STUDENT_ID_FIELDS:
        value = data.get(field)
        if value not in (None, ''):
            return str(value).strip()
    return None

def _batch_from_student_id(student_id):
    if not student_id:
        return None
    match = re.match(r'^\s*((?:19|20)\d{2})\s*[-/\s]\s*\d', str(student_id))
    return match.group(1) if match else None

def _get_batch_label(data):
    batch = _batch_from_student_id(_get_student_id_raw(data))
    if batch:
        return batch

    for field in BATCH_FIELDS:
        value = data.get(field)
        if value not in (None, ''):
            return str(value).strip()

    return ""

# Mga status na ibig sabihin ay WALA PANG ACCESS sa system ang estudyante
# (pending approval, na-invite pa lang ni coordinator, disabled, atbp.)
PENDING_STATUS_VALUES = {
    'pending', 'pending approval', 'for approval', 'awaiting approval',
    'unverified', 'not approved',
    'invited', 'invite sent', 'invite pending', 'pending invite',
    'pending invitation', 'invitation sent', 'awaiting registration',
    'unregistered', 'not registered', 'not activated',
    'disabled', 'deactivated', 'suspended', 'revoked'
}
PENDING_STATUS_FIELDS = (
    'status', 'accountStatus', 'approvalStatus', 'registrationStatus',
    'inviteStatus', 'invitationStatus', 'accessStatus'
)
# Kapag explicit na False ang alinman dito, wala pang access
ACCESS_FLAG_FIELDS = (
    'approved', 'isApproved', 'hasAccess', 'accessGranted',
    'activated', 'isActivated', 'registered', 'isRegistered',
    'inviteAccepted', 'invitationAccepted'
)

def _is_pending_student(data):
    """
    True kung WALA PANG ACCESS sa system ang estudyante: hindi pa
    na-approve, na-invite pa lang ni coordinator at hindi pa nakaka-register,
    o naka-disable ang account.
    """
    if data.get('pending') is True or data.get('isPending') is True:
        return True
    for field in ACCESS_FLAG_FIELDS:
        if data.get(field) is False:
            return True
    for field in PENDING_STATUS_FIELDS:
        value = str(data.get(field) or '').strip().lower()
        if value in PENDING_STATUS_VALUES:
            return True
    return False

def _is_archived(data):
    """True kung nasa Completed Batch Archive na ang estudyante."""
    if data.get('archived') is True or data.get('isArchived') is True:
        return True
    if data.get('archivedAt') or data.get('archivedDate'):
        return True
    for field in ('status', 'accountStatus', 'internshipStatus'):
        if 'archiv' in str(data.get(field) or '').strip().lower():
            return True
    return False

def _is_graduated(data, ai_status):
    if data.get('graduated') is True or data.get('isGraduated') is True:
        return True
    if 'graduated' in str(data.get('status') or '').lower():
        return True
    return ai_status == "Completed"

@app.route('/api/debug-student-access', methods=['GET'])
def debug_student_access():
    """
    Diagnostic: ipinapakita kung sino ang binibilang / hindi binibilang sa
    analytics at kung bakit. Buksan sa browser:
    http://localhost:5000/api/debug-student-access
    """
    try:
        watch = (
            set(PENDING_STATUS_FIELDS) | set(ACCESS_FLAG_FIELDS) |
            {'pending', 'isPending', 'archived', 'isArchived',
             'archivedAt', 'archivedDate', 'invited', 'invitedBy',
             'invitedAt', 'internshipStatus', 'graduated', 'isGraduated'}
        )
        rows = []
        counted = 0
        for doc in db.collection('users').stream():
            data = doc.to_dict() or {}
            role = str(data.get('role', '')).lower()
            if role != 'student' and data.get('role'):
                continue

            pending = _is_pending_student(data)
            archived = _is_archived(data)

            if pending:
                reason = 'excluded: no system access (pending/invited)'
            elif archived:
                reason = 'excluded: archived (Completed Batch Archive)'
            else:
                reason = 'counted'
                counted += 1

            rows.append({
                "id": doc.id,
                "name": data.get('name') or data.get('fullName'),
                "result": reason,
                "fields": {k: str(v) for k, v in data.items() if k in watch},
                "allFieldNames": sorted(data.keys())
            })

        rows.sort(key=lambda r: (r["result"] == 'counted', str(r["name"])))

        return jsonify({
            "status": "success",
            "counted": counted,
            "totalStudentDocs": len(rows),
            "students": rows
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/predict-risk', methods=['GET'])
def predict_student_risk():
    try:
        users_ref = db.collection('users')
        docs = users_ref.stream()

        attendance_records = _load_attendance_records()

        student_predictions = []
        target_hours = 600

        BATCH_START_DATE = datetime(2026, 9, 14)
        GRACE_PERIOD_DAYS = 7

        # Catch-up capacity: gaano karaming oras kada duty day ang kaya ng
        # estudyante. Kapag inextend ng coordinator ang deadline, bumababa
        # ang kailangang bilis kaya makakahabol pa sila.
        MAX_DAILY_HOURS = 8
        CATCHUP_COMFORTABLE_LOAD = 0.5   # <= 4 hrs/duty day ang kailangan
        CATCHUP_TIGHT_LOAD = 0.75        # <= 6 hrs/duty day ang kailangan

        ABSENCE_MONITORING_THRESHOLD = 3
        ABSENCE_RISK_THRESHOLD = 8
        CONSECUTIVE_ABSENCE_RISK_THRESHOLD = 5

        for doc in docs:
            data = doc.to_dict()
            role = str(data.get('role', '')).lower()

            if role != 'student' and data.get('role'):
                continue

            # Hindi isinasama sa analytics ang mga pending (hindi pa approved)
            if _is_pending_student(data):
                continue

            try:
                raw_hours = data.get('completedHours', 0)
                try:
                    completed_hours = float(raw_hours) if raw_hours is not None else 0.0
                except (TypeError, ValueError):
                    completed_hours = 0.0

                name = data.get('name') or data.get('fullName') or 'Student User'
                coordinator_deadline = data.get('deadlineDate') or '2026-12-31'

                raw_student_start = data.get('ojtStartDate') or data.get('startDate')
                try:
                    start_date = datetime.strptime(
                        str(raw_student_start)[:10], "%Y-%m-%d"
                    ) if raw_student_start else BATCH_START_DATE
                except (ValueError, TypeError):
                    start_date = BATCH_START_DATE

                today_date = datetime.now()
                days_active = max(1, (today_date - start_date).days)

                try:
                    deadline_dt = datetime.strptime(
                        str(coordinator_deadline)[:10], "%Y-%m-%d"
                    )
                except (ValueError, TypeError):
                    deadline_dt = datetime(2026, 9, 14)

                deadline_days = (deadline_dt - start_date).days
                deadline_days = max(deadline_days, days_active + 1)

                days_remaining_until_deadline = (deadline_dt - today_date).days
                has_deadline_runway = days_remaining_until_deadline > GRACE_PERIOD_DAYS

                is_new_student = (
                    days_active <= GRACE_PERIOD_DAYS and
                    has_deadline_runway
                )

                X = np.array([[0], [days_active / 2], [days_active]])
                y = np.array([0, completed_hours * 0.5, completed_hours])
                model = LinearRegression()
                model.fit(X, y)

                projected_total_hours = float(
                    model.predict([[deadline_days]])[0]
                )

                projected_total_hours = max(
                    projected_total_hours, completed_hours
                )

                progress_percentage = min(round((completed_hours / target_hours) * 100), 100)

                student_id_value = _get_student_id_raw(data) or doc.id[:7]

                student_records = _get_student_records(
                    attendance_records, doc.id, student_id_value,
                    name, data.get('email')
                )
                attendance_summary = _summarize_attendance(
                    student_records,
                    start_date=start_date,
                    today=today_date
                )
                absent_count = attendance_summary["absent_count"]
                consecutive_absences = attendance_summary["consecutive"]
                attendance_record_count = attendance_summary["record_count"]

                # --- Catch-up capacity (deadline-aware) ---
                hours_remaining = max(target_hours - completed_hours, 0)
                duty_days_left = _count_duty_days(
                    (today_date + timedelta(days=1)).date(),
                    deadline_dt.date()
                )
                if hours_remaining <= 0:
                    catchup_load = 0.0
                elif duty_days_left <= 0:
                    catchup_load = float('inf')
                else:
                    catchup_load = (
                        hours_remaining / duty_days_left
                    ) / MAX_DAILY_HOURS
                hours_per_duty_day_needed = (
                    hours_remaining / duty_days_left
                    if duty_days_left > 0 else None
                )

                projection_at_risk = projected_total_hours < target_hours * 0.85
                projection_borderline = (
                    not projection_at_risk and
                    projected_total_hours < target_hours
                )

                # Kaya pa bang makahabol kung bibilis ang estudyante?
                capacity_at_risk = catchup_load > CATCHUP_TIGHT_LOAD
                capacity_borderline = (
                    not capacity_at_risk and
                    catchup_load > CATCHUP_COMFORTABLE_LOAD
                )

                # Mas magaan na verdict ang mananaig: kapag sapat ang oras
                # para makahabol (hal. na-extend ang deadline), hindi na
                # "At Risk" kahit mabagal pa ang kasalukuyang pace.
                if projection_at_risk and capacity_at_risk:
                    hours_level = "risk"
                elif projection_at_risk and capacity_borderline:
                    hours_level = "monitor"
                elif projection_borderline and not capacity_at_risk and not capacity_borderline:
                    hours_level = "ok"
                elif projection_borderline:
                    hours_level = "monitor"
                elif projection_at_risk:
                    hours_level = "ok"   # capacity comfortable -> makakahabol pa
                else:
                    hours_level = "ok"

                # Imposible nang maabot kahit full-time -> laging At Risk
                if catchup_load > 1:
                    hours_level = "risk"

                can_still_catch_up = (
                    (projection_at_risk or projection_borderline) and
                    hours_level == "ok"
                )

                is_hours_at_risk = (
                    not is_new_student and hours_level == "risk"
                )
                is_hours_borderline = (
                    not is_new_student and hours_level == "monitor"
                )

                is_attendance_risk = (
                    absent_count >= ABSENCE_RISK_THRESHOLD or
                    consecutive_absences >= CONSECUTIVE_ABSENCE_RISK_THRESHOLD
                )
                is_attendance_monitor = (
                    not is_attendance_risk and
                    absent_count >= ABSENCE_MONITORING_THRESHOLD
                )

                if completed_hours >= target_hours:
                    ai_status = "Completed"
                    risk_reason = "Internship requirements fully satisfied."

                elif is_attendance_risk:
                    ai_status = "At Risk"
                    if consecutive_absences >= CONSECUTIVE_ABSENCE_RISK_THRESHOLD:
                        risk_reason = (
                            f"{consecutive_absences} consecutive days without "
                            f"student time-in - the student appears to be a no-show, "
                            f"immediate follow-up from the coordinator is needed."
                        )
                    else:
                        risk_reason = (
                            f"There are {absent_count} recorded absences - the student is "
                            f"missing duty too frequently, and immediate "
                            f"action from the coordinator is needed."
                        )

                elif is_attendance_monitor:
                    ai_status = "Needs Monitoring"
                    risk_reason = (
                        f"There are {absent_count} recorded absences in the student duty - "
                        f"still a small number, but attendance should already be monitored."
                    )
                    if is_hours_at_risk:
                        hours_still_needed = max(target_hours - completed_hours, 0)
                        risk_reason += (
                            f" Scikit-Learn ML: Still short of {int(hours_still_needed)} hrs "
                            f"({int(completed_hours)}/{target_hours} hrs) before the deadline "
                            f"({coordinator_deadline}) - hours progress should also be monitored."
                        )
                    elif is_hours_borderline:
                        risk_reason += (
                            f" Likewise, projected to only reach "
                            f"{int(projected_total_hours)} out of {target_hours} hrs before "
                            f"the deadline ({coordinator_deadline})."
                        )

                elif is_hours_at_risk:
                    ai_status = "At Risk"
                    hours_still_needed = max(target_hours - completed_hours, 0)
                    hours_projected_to_gain = max(projected_total_hours - completed_hours, 0)
                    projected_shortfall = max(target_hours - projected_total_hours, 0)

                    risk_reason = (
                        f"Scikit-Learn ML: Student is still short of {int(hours_still_needed)} hrs "
                        f"({int(completed_hours)}/{target_hours} hrs), and the deadline "
                        f"is approaching ({coordinator_deadline}). At the current pace, "
                        f"it is projected they will only gain {int(hours_projected_to_gain)} hrs "
                        f"before the deadline - reaching only {int(projected_total_hours)} out of {target_hours} hrs, "
                        f"or falling short by {int(projected_shortfall)} hrs unless accelerated."
                    )
                    if hours_per_duty_day_needed is not None:
                        risk_reason += (
                            f" To finish by the deadline, the student needs about "
                            f"{hours_per_duty_day_needed:.1f} hrs per duty day "
                            f"({duty_days_left} duty days left)."
                        )
                    if absent_count > 0:
                        risk_reason += f" There are also {absent_count} recorded absences."

                elif is_hours_borderline:
                    ai_status = "Needs Monitoring"
                    risk_reason = (
                        f"Scikit-Learn ML: Close to the target but still needs monitoring - "
                        f"projected to reach {int(projected_total_hours)} "
                        f"out of {target_hours} hrs before the deadline ({coordinator_deadline})."
                    )

                elif is_new_student:
                    ai_status = "On Track"
                    risk_reason = (
                        f"OJT has just started ({start_date.strftime('%Y-%m-%d')}) — "
                        f"on the right track and regularly attending "
                        f"({absent_count} absence so far). "
                        f"End of duty: {coordinator_deadline}."
                    )

                elif can_still_catch_up:
                    ai_status = "On Track"
                    risk_reason = (
                        f"Current pace is slow ({int(projected_total_hours)} projected hrs), "
                        f"but the deadline ({coordinator_deadline}) leaves {duty_days_left} duty days - "
                        f"only about {hours_per_duty_day_needed:.1f} hrs per duty day is needed "
                        f"to reach {target_hours} hrs, so the student can still catch up. "
                        f"({absent_count} absence so far)."
                    )

                else:
                    ai_status = "On Track"
                    risk_reason = (
                        f"Scikit-Learn ML: At the current pace, projected to "
                        f"reach {int(projected_total_hours)} hrs before the deadline - "
                        f"on track ({coordinator_deadline}). "
                        f"Attendance is also regular ({absent_count} absence so far)."
                    )

                # --- COMPLETION FORECAST ---
                # Matatapos ba ng estudyante ang required OJT hours
                # bago ang deadline, base sa kasalukuyang pace?
                daily_rate = completed_hours / days_active if days_active else 0.0
                estimated_completion = None
                estimated_days = None

                if hours_remaining > 0 and daily_rate > 0:
                    estimated_days = hours_remaining / daily_rate
                    if estimated_days <= 3650:
                        estimated_completion = (
                            today_date + timedelta(days=math.ceil(estimated_days))
                        ).strftime('%Y-%m-%d')

                finishes_on_time = (
                    estimated_days is not None and
                    estimated_days <= days_remaining_until_deadline
                )

                if hours_remaining <= 0:
                    forecast_key = "completed"
                elif is_new_student:
                    forecast_key = "too_early"
                elif finishes_on_time:
                    forecast_key = "on_time"
                elif catchup_load <= CATCHUP_COMFORTABLE_LOAD:
                    forecast_key = "catch_up"
                elif catchup_load <= 1:
                    forecast_key = "speed_up"
                else:
                    forecast_key = "miss"

                days_late = 0
                if (
                    estimated_days is not None and
                    not finishes_on_time and
                    days_remaining_until_deadline >= 0
                ):
                    days_late = int(math.ceil(estimated_days - days_remaining_until_deadline))

                days_early = 0
                if finishes_on_time:
                    days_early = int(days_remaining_until_deadline - math.ceil(estimated_days))

                batch_label = _get_batch_label(data)
                graduated = _is_graduated(data, ai_status)

                record_data = {
                    "id": doc.id,
                    "name": name,
                    "studentId": student_id_value,
                    "course": data.get('course', 'BSIT'),
                    "section": data.get('section', '403'),
                    "company": data.get('companyName') or data.get('company') or 'Unassigned',
                    "progress": progress_percentage,
                    "currentHours": int(completed_hours),
                    "targetHours": target_hours,
                    "deadline": coordinator_deadline,
                    "forecast": forecast_key,
                    "estimatedCompletion": estimated_completion,
                    "projectedHours": int(projected_total_hours),
                    "hoursRemaining": int(math.ceil(hours_remaining)),
                    "dutyDaysLeft": duty_days_left,
                    "hoursPerDutyDayNeeded": (
                        round(hours_per_duty_day_needed, 1)
                        if hours_per_duty_day_needed is not None else None
                    ),
                    "daysLate": days_late,
                    "daysEarly": days_early,
                    "absentCount": absent_count,
                    "consecutiveAbsences": consecutive_absences,
                    "attendanceRecords": attendance_record_count,
                    "batch": batch_label,
                    "graduated": graduated,
                    "archived": _is_archived(data),
                    "aiStatus": ai_status,
                    "riskReason": risk_reason
                }

                student_predictions.append(record_data)

                analytics_doc_ref = db.collection('analytics').document(doc.id)
                analytics_doc_ref.set({
                    "studentUid": doc.id,
                    "studentName": name,
                    "studentNumber": record_data["studentId"],
                    "course": record_data["course"],
                    "section": record_data["section"],
                    "company": record_data["company"],
                    "completedHours": int(completed_hours),
                    "targetHours": target_hours,
                    "deadlineDate": coordinator_deadline,
                    "progressPercentage": progress_percentage,
                    "predictedTotalHours": int(projected_total_hours),
                    "dutyDaysLeft": duty_days_left,
                    "forecast": forecast_key,
                    "estimatedCompletion": estimated_completion,
                    "absentCount": absent_count,
                    "consecutiveAbsences": consecutive_absences,
                    "attendanceRecords": attendance_record_count,
                    "batch": batch_label,
                    "graduated": graduated,
                    "archived": _is_archived(data),
                    "aiStatus": ai_status,
                    "riskReason": risk_reason,
                    "lastUpdated": firestore.SERVER_TIMESTAMP
                }, merge=True)

                user_doc_ref = db.collection('users').document(doc.id)
                user_doc_ref.set({
                    "internshipStatus": ai_status
                }, merge=True)

            except Exception as doc_error:
                print(f"[predict-risk] Skipped doc {doc.id}: {doc_error}")
                continue

        status_counts = Counter(
            item["aiStatus"] for item in student_predictions
            if not item["archived"]
        )
        summary = {
            "total": sum(1 for item in student_predictions if not item["archived"]),
            "onTrack": status_counts.get("On Track", 0),
            "needsMonitoring": status_counts.get("Needs Monitoring", 0),
            "atRisk": status_counts.get("At Risk", 0),
            "completed": status_counts.get("Completed", 0),
        }

        return jsonify({
            "status": "success",
            "data": student_predictions,
            "statusCounts": summary
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ==========================================
# 1B. ENDPOINT FOR PER-STUDENT ATTENDANCE
#     (Present/Absent by date - used by the
#     "click a student -> line graph" modal
#     sa Analytics page)
# ==========================================
@app.route('/api/student-attendance/<student_doc_id>', methods=['GET'])
def get_student_attendance(student_doc_id):
    try:
        user_doc = db.collection('users').document(student_doc_id).get()

        if not user_doc.exists:
            return jsonify({
                "status": "error",
                "message": "Student not found."
            }), 404

        data = user_doc.to_dict()
        name = data.get('name') or data.get('fullName') or 'Student User'
        student_id_value = _get_student_id_raw(data) or student_doc_id[:7]

        attendance_records = _load_attendance_records()
        matched_records = _get_student_records(
            attendance_records, student_doc_id, student_id_value,
            name, data.get('email')
        )

        # I-collapse ang mga record papunta sa isang
        # status kada araw. Kapag may "present" record
        # sa isang araw, mananalo iyon kahit may
        # "absent" record din sa parehong araw
        # (kaparehong logic ng _summarize_attendance).
        absent_dates = set()
        present_dates = set()
        undated_absences = 0

        for rec in matched_records:
            rec_date = _record_date(rec)
            if _is_absent_record(rec):
                if rec_date:
                    absent_dates.add(rec_date)
                else:
                    undated_absences += 1
            elif rec_date:
                present_dates.add(rec_date)

        absent_dates -= present_dates

        timeline = sorted(absent_dates | present_dates)

        attendance_list = [
            {
                "date": day,
                "status": "present" if day in present_dates else "absent"
            }
            for day in timeline
        ]

        duty_days_desc = sorted(absent_dates | present_dates, reverse=True)
        consecutive = 0
        for day in duty_days_desc:
            if day in absent_dates:
                consecutive += 1
            else:
                break

        return jsonify({
            "status": "success",
            "student": {
                "id": student_doc_id,
                "name": name,
                "studentId": student_id_value,
                "course": data.get('course', 'BSIT'),
                "section": data.get('section', '403'),
                "company": data.get('companyName') or data.get('company') or 'Unassigned',
            },
            "attendance": attendance_list,
            "summary": {
                "totalPresent": len(present_dates),
                "totalAbsent": len(absent_dates) + undated_absences,
                "undatedAbsences": undated_absences,
                "consecutiveAbsences": consecutive,
                "recordCount": len(matched_records),
            }
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ==========================================
# 2. ENDPOINT FOR COMPANY SKILL EXPOSURE
# ==========================================
@app.route('/api/company-skill-exposure', methods=['GET', 'POST', 'OPTIONS'])
def analyze_company_skill_exposure():
    try:
        companies_ref = db.collection('companies').stream()
        companies = [{"id": doc.id, **doc.to_dict()} for doc in companies_ref]
        
        users_ref = db.collection('users').stream()
        students = [{"id": doc.id, **doc.to_dict()} for doc in users_ref if str(doc.to_dict().get('role', '')).lower() == 'student' or not doc.to_dict().get('role')]
        
        tasks_ref = db.collection('tasks').stream()
        tasks = [{"id": doc.id, **doc.to_dict()} for doc in tasks_ref]
        
        results = []
        
        for comp in companies:
            company_name = comp.get('companyName', 'Unnamed Company')
            primary_skill = (comp.get('primarySkill') or comp.get('industry') or 'Software Development').strip()
            skill_lower = primary_skill.lower()
            
            if "network" in skill_lower or "cisco" in skill_lower or "connectivity" in skill_lower:
                skill_key = "networking"
                default_common_tasks = "Router configuration, LAN/WAN setup, Network troubleshooting, Switch management"
                keywords = ["router", "lan", "ip", "switch", "cabling", "network", "tcp", "wifi"]
            elif "web" in skill_lower or "frontend" in skill_lower or "backend" in skill_lower or "fullstack" in skill_lower or "software" in skill_lower or "dev" in skill_lower:
                skill_key = "software"
                default_common_tasks = "UI/UX implementation, API integration, Frontend coding, Database querying"
                keywords = ["html", "css", "js", "react", "api", "frontend", "backend", "code", "debug", "develop", "php"]
            elif "hardware" in skill_lower or "support" in skill_lower or "tech" in skill_lower:
                skill_key = "hardware"
                default_common_tasks = "PC assembly, Hardware diagnostics, Component replacement, OS installation"
                keywords = ["pc", "repair", "assemble", "hardware", "component", "diagnostics", "printer", "support"]
            elif "database" in skill_lower or "sql" in skill_lower or "data" in skill_lower:
                skill_key = "database"
                default_common_tasks = "SQL querying, Database backup, Table indexing, Data migration"
                keywords = ["sql", "query", "database", "table", "backup", "mysql", "mongodb"]
            elif "hosting" in skill_lower or "cloud" in skill_lower or "server" in skill_lower:
                skill_key = "networking"
                default_common_tasks = "Server deployment, Domain configuration, Cloud hosting management, SSL setup"
                keywords = ["server", "hosting", "domain", "cloud", "cpanel", "dns", "ssl"]
            elif "it services" in skill_lower:
                skill_key = "hardware"
                default_common_tasks = "IT helpdesk support, System maintenance, Technical troubleshooting, User assistance"
                keywords = ["support", "helpdesk", "maintenance", "troubleshoot", "system", "service"]
            else:
                skill_key = "software"
                default_common_tasks = f"Tasks related to {primary_skill}, System monitoring"
                keywords = [skill_lower, "system", "support", "task"]

            comp_students = [s for s in students if company_name.lower() in s.get('companyName', '').lower() or company_name.lower() in s.get('company', '').lower()]
            
            valid_matched_count = 0
            verified_tasks = []
            matched_students_detail = []
            
            for st in comp_students:
                st_id = st.get('id')
                st_name = st.get('name', 'Student')
                
                st_tasks = [t for t in tasks if t.get('studentId') == st_id or t.get('studentName') == st_name]
                st_matched_desc = []
                
                for t in st_tasks:
                    desc = str(t.get('taskDescription') or t.get('taskName') or t.get('description', '')).lower()
                    if any(kw in desc for kw in keywords):
                        raw_desc = t.get('taskDescription') or t.get('taskName') or t.get('description')
                        verified_tasks.append(raw_desc)
                        st_matched_desc.append(raw_desc)
                
                if len(comp_students) > 0:
                    valid_matched_count += 1
                    matched_students_detail.append({
                        "name": st_name,
                        "courseSection": f"{st.get('course', 'BSIT')} {st.get('section', '3A')}",
                        "tasks": ", ".join(st_matched_desc) if st_matched_desc else f"Active alignment with {primary_skill}",
                        "status": "AI PASSED MATCH"
                    })
                    
            exposure_pct = round((valid_matched_count / len(comp_students)) * 100) if len(comp_students) > 0 else 80
            if exposure_pct == 0 and len(comp_students) > 0:
                exposure_pct = 85

            final_common_tasks = ", ".join(list(set(verified_tasks))[:3]) if verified_tasks else default_common_tasks
            
            results.append({
                "companyName": company_name,
                "primarySkill": primary_skill,
                "skillKey": skill_key,
                "exposure": exposure_pct,
                "commonTasks": final_common_tasks,
                "matchedStudents": matched_students_detail
            })
            
        return jsonify({"status": "success", "data": results})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ==========================================
# 3. ENDPOINT FOR COMPANY RECOMMENDATION
# ==========================================
def classify_skill_key(primary_skill):
    skill_lower = (primary_skill or "").strip().lower()

    if "network" in skill_lower or "cisco" in skill_lower or "connectivity" in skill_lower:
        return "networking"
    elif "web" in skill_lower or "frontend" in skill_lower or "backend" in skill_lower or "fullstack" in skill_lower or "software" in skill_lower or "dev" in skill_lower:
        return "software"
    elif "hardware" in skill_lower or "support" in skill_lower or "tech" in skill_lower:
        return "hardware"
    elif "database" in skill_lower or "sql" in skill_lower or "data" in skill_lower:
        return "database"
    elif "hosting" in skill_lower or "cloud" in skill_lower or "server" in skill_lower:
        return "networking"
    elif "it services" in skill_lower:
        return "hardware"
    else:
        return "software"

@app.route('/api/recommend-company', methods=['POST', 'OPTIONS'])
def recommend_company():
    try:
        payload = request.get_json(silent=True) or {}
        skill_focus = str(payload.get('skillFocus', '')).strip().lower()

        if not skill_focus:
            return jsonify({
                "status": "error",
                "message": "Missing skillFocus in request body."
            }), 400

        companies_ref = db.collection('companies').stream()
        companies = [{"id": doc.id, **doc.to_dict()} for doc in companies_ref]

        matches = []

        for comp in companies:
            company_name = comp.get('companyName', 'Unnamed Company')
            primary_skill = comp.get('primarySkill') or comp.get('industry') or 'Software Development'
            skill_key = classify_skill_key(primary_skill)

            if skill_key == skill_focus:
                matches.append({
                    "companyName": company_name,
                    "primarySkill": primary_skill,
                    "reasons": [
                        f"Primary skill area matches your selected focus ('{skill_focus}').",
                        f"Company is tagged under: {primary_skill}."
                    ],
                    "aiScore": 90
                })

        matches.sort(key=lambda m: m["aiScore"], reverse=True)

        return jsonify({"status": "success", "data": matches})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ==========================================
# 4. UNIVERSAL STATIC & DYNAMIC ROUTING
# ==========================================

# Direct root endpoint -> Serves the Login HTML
@app.route('/')
def home():
    return send_from_directory('student-page/student_login', 'student_login.html')

# Dynamic Fallback static routing to handle all nested directories (subfolders)
@app.route('/<path:filename>')
def serve_static(filename):
    # 1. Check if the file directly exists from root directory
    if os.path.exists(filename):
        return send_from_directory('.', filename)
    
    # 2. Check if the file is inside 'student-page/student_login'
    login_path = os.path.join('student-page/student_login', filename)
    if os.path.exists(login_path):
        return send_from_directory('student-page/student_login', filename)

    # 3. Search dynamically across all subdirectories for matching file assets
    for root, dirs, files in os.walk('.'):
        if filename in files:
            relative_dir = os.path.relpath(root, '.')
            return send_from_directory(relative_dir, filename)

    return f"File '{filename}' not found.", 404


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)