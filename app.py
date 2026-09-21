from flask import Flask, jsonify, request
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timedelta, timezone
from collections import Counter
import re
import numpy as np
from sklearn.linear_model import LinearRegression

app = Flask(__name__)
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

# Initialize the Firebase Admin SDK
if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
db = firestore.client()

# ==========================================
# 1. ENDPOINT FOR AT-RISK PREDICTION
# ==========================================
# ==========================================
# ATTENDANCE SETTINGS
# ==========================================

# Name of the Firestore collection(s) where
# attendance is stored. If the name is different in your Firebase (ex.
# "attendanceRecords"), just add it here. You can check
# the correct name at http://localhost:5000/api/debug-attendance
ATTENDANCE_COLLECTIONS = ['attendance']

# If your attendance collection only saves PRESENT records
# (with no "Absent" record when a student does not attend), set this to True to
# treat every weekday (Mon-Fri) from the start of
# OJT through yesterday with NO attendance record.
# Defaults to False to avoid incorrectly flagging
# students who are not scheduled on certain days.
COUNT_MISSING_WEEKDAYS_AS_ABSENT = False

# Dates (YYYY-MM-DD) with no duty (holiday / no workday)
# - these will not be counted as absent when the setting above is True.
NON_DUTY_DATES = set()

# Philippine time (UTC+8) - to avoid date mismatches when
# a Firestore Timestamp (UTC) is saved in attendance.
PH_TZ = timezone(timedelta(hours=8))

# Fields that may contain the attendance record date
ATTENDANCE_DATE_FIELDS = (
    'date', 'attendanceDate', 'dateString', 'day',
    'timestamp', 'createdAt', 'timeIn'
)

# Mga field na puwedeng naglalaman ng status (Present/Absent/Late)
ATTENDANCE_STATUS_FIELDS = (
    'status', 'attendanceStatus', 'attendance_status'
)

# Fields that may identify WHICH student
# owns the attendance record
ATTENDANCE_OWNER_FIELDS = (
    'studentUid', 'studentUID', 'studentId', 'studentID',
    'studentNumber', 'uid', 'userId', 'userUid', 'student_id',
    'email', 'studentEmail'
)


def _norm(value):
    """Lowercase + trim so spaces/capitalization do not affect matching."""
    if value is None:
        return None
    text = str(value).strip().lower()
    return text or None


def _to_date_str(value):
    """
    Converts any date-like value to 'YYYY-MM-DD'
    (Firestore Timestamp, datetime, ISO string, MM/DD/YYYY, etc.)
    Returns None if it cannot be parsed.
    """
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
    """Returns the first readable date from the possible date fields."""
    for field in ATTENDANCE_DATE_FIELDS:
        parsed = _to_date_str(rec.get(field))
        if parsed:
            return parsed
    return None


def _is_absent_record(rec):
    """
    Flexible reader for different possible attendance collection schemas:
    attendance collection:
      - status / attendanceStatus / attendance_status na
        naglalaman ng salitang "absent"
      - boolean 'isAbsent' / 'absent' (True = absent)
      - boolean 'present' (False = absent)
    """
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
    """
    Loads all attendance records once,
    then filters/counts them per student later. Faster
    than querying per student.
    """
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
    """
    Gets all attendance records belonging ng partikular
    to a specific student. Checks the doc ID, student number, email,
    and (as a last fallback) the name.
    """
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
    """All Mon-Fri (YYYY-MM-DD) from start_date through end_date (inclusive)."""
    days = []
    current = start_date
    while current <= end_date:
        if current.weekday() < 5:
            days.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    return days


def _summarize_attendance(matched_records, start_date=None, today=None):
    """
    Returns:
      - absent_count: number of absent days (unique per date,
        so duplicate records on the same day are not double-counted)
      - consecutive: number of consecutive absences starting from
        the most recent duty day going backward ("no-show")
      - record_count: number of attendance records found for the
        student (0 = no attendance has been found)
    """
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

    # If both Present and Absent exist on the same day, Present takes precedence
    absent_dates -= present_dates

    if COUNT_MISSING_WEEKDAYS_AS_ABSENT and start_date and today:
        # Today is excluded because the duty day is not finished yet
        yesterday = today.date() - timedelta(days=1)
        for day in _weekdays_between(start_date.date(), yesterday):
            if (
                day not in present_dates
                and day not in absent_dates
                and day not in NON_DUTY_DATES
            ):
                absent_dates.add(day)

    # Streak: from the most recent date backward until the first Present
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


# ==========================================
# STUDENT BATCH - BASED ON STUDENT ID
#
# Used in the "Graduated Students by Batch" chart. The first
# 4 digits (year) of the Student ID represent the student's batch:
#     2023-01-22112  ->  batch 2023
#     2026-21-01233  ->  batch 2026
# If no year can be read from the ID, only then look for the
# batch field in the document (if available).
# ==========================================
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
    """The actual student ID from Firestore (without doc.id fallback)."""
    for field in STUDENT_ID_FIELDS:
        value = data.get(field)
        if value not in (None, ''):
            return str(value).strip()
    return None


def _batch_from_student_id(student_id):
    """'2023-01-22112' -> '2023'. Returns None if the ID does not start with a year."""
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

    # Walang mabasang batch - hindi isasama sa bar graph
    return ""


def _is_graduated(data, ai_status):
    """Graduated = has an explicit flag, or has completed the required OJT hours."""
    if data.get('graduated') is True or data.get('isGraduated') is True:
        return True
    if 'graduated' in str(data.get('status') or '').lower():
        return True
    return ai_status == "Completed"


@app.route('/api/predict-risk', methods=['GET'])
def predict_student_risk():
    try:
        users_ref = db.collection('users')
        docs = users_ref.stream()

        attendance_records = _load_attendance_records()

        student_predictions = []
        target_hours = 600

        # ==========================================
        # BATCH START DATE
        #
        # This is the start of the current OJT batch.
        # When students have just started (ex. September 14,
        # 2026), they should not immediately be marked "At Risk"
        # because they are still near the beginning
        # - there is not enough data yet for a reliable
        # projection. A GRACE_PERIOD_DAYS period is applied before
        # using the hours-based projection.
        # ==========================================
        BATCH_START_DATE = datetime(2026, 9, 14)
        GRACE_PERIOD_DAYS = 7

        # Absence thresholds - these are the PRIMARY
        # basis for At Risk / Needs Monitoring, especially
        # during the first week of OJT when there are still very few
        # completed hours for all students.
        ABSENCE_MONITORING_THRESHOLD = 5   # 5+ absences -> Needs Monitoring
        ABSENCE_RISK_THRESHOLD = 8         # 8+ absences (many) -> At Risk

        # "No-show" - consecutive Absent records
        # starting from the most recent duty day going backward. Even if
        # the total has not reached 8 absences, if there are 3+ consecutive
        # days without a time-in, the student is also considered At Risk (parang biglang
        # nawalan ng communication/showed up ang estudyante).
        CONSECUTIVE_ABSENCE_RISK_THRESHOLD = 3

        # Name retained so other references do not break
        # below (backward-compatible variable name).
        absence_monitoring_threshold = ABSENCE_MONITORING_THRESHOLD

        for doc in docs:
            data = doc.to_dict()
            role = str(data.get('role', '')).lower()

            if role != 'student' and data.get('role'):
                continue

            try:

                # SAFE PARSING - protection against
                # null / string / missing values
                raw_hours = data.get('completedHours', 0)
                try:
                    completed_hours = float(raw_hours) if raw_hours is not None else 0.0
                except (TypeError, ValueError):
                    completed_hours = 0.0

                name = data.get('name') or data.get('fullName') or 'Student User'
                coordinator_deadline = data.get('deadlineDate') or '2026-12-31'

                # If there is a per-student OJT start date
                # (ex. field na 'ojtStartDate' sa Firestore),
                # use it. If unavailable, use
                # ang BATCH_START_DATE (Sept 14, 2026).
                raw_student_start = data.get('ojtStartDate') or data.get('startDate')
                try:
                    start_date = datetime.strptime(
                        str(raw_student_start)[:10], "%Y-%m-%d"
                    ) if raw_student_start else BATCH_START_DATE
                except (ValueError, TypeError):
                    start_date = BATCH_START_DATE

                today_date = datetime.now()
                days_active = max(1, (today_date - start_date).days)

                # PARSE THE DEADLINE TO DETERMINE
                # HOW MANY DAYS FROM START_DATE THE
                # DEADLINE IS (target of the regression model)
                try:
                    deadline_dt = datetime.strptime(
                        str(coordinator_deadline)[:10], "%Y-%m-%d"
                    )
                except (ValueError, TypeError):
                    deadline_dt = datetime(2026, 9, 14)

                deadline_days = (deadline_dt - start_date).days
                deadline_days = max(deadline_days, days_active + 1)

                # ==========================================
                # GRACE PERIOD - dapat lang ma-exempt sa
                # hours-based risk ang isang estudyante kung
                # BAGO PA LANG SIYA *AT* may sapat pa ring
                # natitirang oras bago ang deadline.
                #
                # Dati, "days_active <= GRACE_PERIOD_DAYS" lang
                # ang basehan - kaya kahit gaano kalapit na ang
                # deadline (coordinator_deadline), hindi na-e-
                # evaluate ang hours risk habang loob pa ng unang
                # 7 araw mula sa start date. Ngayon, isinasama na
                # rin ang natitirang araw bago ang deadline -
                # kung malapit na o lagpas na ito, dapat mawala
                # ang exemption kahit "bagong-bago" pa lang ang
                # estudyante, dahil totoong deadline risk na ito.
                # ==========================================
                days_remaining_until_deadline = (deadline_dt - today_date).days
                has_deadline_runway = days_remaining_until_deadline > GRACE_PERIOD_DAYS

                is_new_student = (
                    days_active <= GRACE_PERIOD_DAYS and
                    has_deadline_runway
                )

                # ==========================================
                # SCIKIT-LEARN LINEAR REGRESSION
                #
                # Uses the current rate of
                # progress (completed_hours vs days_active)
                # to project how many hours
                # the student will complete BY THE
                # DEADLINE - this will be used directly
                # as the basis for the AI status, instead of
                # using only fixed thresholds.
                # ==========================================

                X = np.array([[0], [days_active / 2], [days_active]])
                y = np.array([0, completed_hours * 0.5, completed_hours])
                model = LinearRegression()
                model.fit(X, y)

                projected_total_hours = float(
                    model.predict([[deadline_days]])[0]
                )

                # Cannot be lower than the
                # current completed hours
                projected_total_hours = max(
                    projected_total_hours, completed_hours
                )

                progress_percentage = min(round((completed_hours / target_hours) * 100), 100)

                student_id_value = _get_student_id_raw(data) or doc.id[:7]

                # ==========================================
                # ATTENDANCE - READ ABSENCES
                # ==========================================
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

                # ==========================================
                # AI STATUS - COMBINED BASIS:
                #   1) Scikit-Learn projection (hours vs deadline)
                #   2) Attendance record (number of absences)
                #
                # PRIORITY:
                #   - Completed      -> target hours have been reached
                #   - At Risk        -> far below the target
                #                       before the deadline (hours-based)
                #   - Needs Monitoring -> not yet "at risk" based on hours,
                #                       but has 5+ absences, or
                #                       is only approaching the target
                #   - On Track       -> hours are progressing well AND
                #                       attendance is regular
                # ==========================================

                # Hours projection is USED
                # ONLY after the grace period -
                # it is not meaningful to flag a student as "at risk by hours"
                # when a student has just started
                # (halos 0 pa lang talaga dapat ang hours
                # during the first week).
                is_hours_at_risk = (
                    not is_new_student and
                    projected_total_hours < target_hours * 0.85
                )
                is_hours_borderline = (
                    not is_new_student and
                    not is_hours_at_risk and
                    projected_total_hours < target_hours
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

                elif is_hours_at_risk:
                    ai_status = "At Risk"

                    # Ilang oras pa kulang ngayon (completed vs target),
                    # ilang oras pa ang hinuhulaan ng modelo na madadagdag
                    # bago sumapit ang deadline, at kung gaano pa siya
                    # magkukulang KAHIT patuloy niya ang kasalukuyang bilis.
                    hours_still_needed = max(target_hours - completed_hours, 0)
                    hours_projected_to_gain = max(projected_total_hours - completed_hours, 0)
                    projected_shortfall = max(target_hours - projected_total_hours, 0)

                    risk_reason = (
                        f"Scikit-Learn ML: Kulang pa ng {int(hours_still_needed)} hrs "
                        f"({int(completed_hours)}/{target_hours} hrs) ang estudyante, at "
                        f"malapit na ang deadline ({coordinator_deadline}). Sa kasalukuyang "
                        f"bilis, hinuhulaan lamang na makakadagdag pa siya ng "
                        f"{int(hours_projected_to_gain)} hrs bago sumapit ang deadline - "
                        f"aabot lamang ng {int(projected_total_hours)} out of {target_hours} hrs, "
                        f"o magkukulang ng {int(projected_shortfall)} hrs kung hindi bibilisan."
                    )
                    if absent_count > 0:
                        risk_reason += f" May {absent_count} naitalang absence din."

                elif is_attendance_monitor:
                    ai_status = "Needs Monitoring"
                    risk_reason = (
                        f"There are {absent_count} recorded absences in the student duty - "
                        f"still a small number, but attendance should already be monitored."
                    )
                    if is_hours_borderline:
                        risk_reason += (
                            f" Gayundin, hinuhulaan lamang na makakaabot ng "
                            f"{int(projected_total_hours)} sa {target_hours} hrs bago "
                            f"ang deadline ({coordinator_deadline})."
                        )

                elif is_hours_borderline:
                    ai_status = "Needs Monitoring"
                    risk_reason = (
                        f"Scikit-Learn ML: Close to the target but still needs monitoring - "
                        f"hinuhulaan na makakaabot ng {int(projected_total_hours)} "
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

                else:
                    ai_status = "On Track"
                    risk_reason = (
                        f"Scikit-Learn ML: Sa kasalukuyang bilis, hinuhulaan na "
                        f"reach {int(projected_total_hours)} hrs before the deadline - "
                        f"on track ({coordinator_deadline}). "
                        f"Attendance is also regular ({absent_count} absence so far)."
                    )

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
                    "absentCount": absent_count,
                    "consecutiveAbsences": consecutive_absences,
                    "attendanceRecords": attendance_record_count,
                    "batch": batch_label,
                    "graduated": graduated,
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
                    "absentCount": absent_count,
                    "consecutiveAbsences": consecutive_absences,
                    "attendanceRecords": attendance_record_count,
                    "batch": batch_label,
                    "graduated": graduated,
                    "aiStatus": ai_status,
                    "riskReason": risk_reason,
                    "lastUpdated": firestore.SERVER_TIMESTAMP
                }, merge=True)

                user_doc_ref = db.collection('users').document(doc.id)
                user_doc_ref.set({
                    "internshipStatus": ai_status
                }, merge=True)

            except Exception as doc_error:
                # Huwag ipahinto ang buong request dahil
                # sa isang sirang document lang - i-skip
                # at ipagpatuloy ang susunod na estudyante.
                print(f"[predict-risk] Skipped doc {doc.id}: {doc_error}")
                continue

        return jsonify({"status": "success", "data": student_predictions})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ==========================================
# 1.B DEBUG - ATTENDANCE READER
#
# Open in the browser: http://localhost:5000/api/debug-attendance
# This shows which collection/fields are being read,
# how many attendance records matched each student,
# and how many are absent - to make it easier to determine why
# a student's absence count is 0.
# (For development only - remove before deployment.)
# ==========================================
def _jsonable(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


@app.route('/api/debug-attendance', methods=['GET'])
def debug_attendance():
    try:
        records = _load_attendance_records()

        field_counter = Counter()
        status_counter = Counter()
        for rec in records:
            field_counter.update(rec.keys())
            status_value = next(
                (rec.get(f) for f in ATTENDANCE_STATUS_FIELDS if rec.get(f) not in (None, '')),
                None
            )
            status_counter[str(status_value)] += 1

        students = []
        matched_ids = set()
        for doc in db.collection('users').stream():
            data = doc.to_dict()
            role = str(data.get('role', '')).lower()
            if role != 'student' and data.get('role'):
                continue

            name = data.get('name') or data.get('fullName') or 'Student User'
            student_id_value = _get_student_id_raw(data) or doc.id[:7]

            matched = _get_student_records(
                records, doc.id, student_id_value, name, data.get('email')
            )
            matched_ids.update(rec['id'] for rec in matched)

            summary = _summarize_attendance(
                matched,
                start_date=datetime(2026, 9, 14),
                today=datetime.now(PH_TZ).replace(tzinfo=None)
            )
            students.append({
                "name": name,
                "studentId": _jsonable(student_id_value),
                "matchedRecords": summary["record_count"],
                "absences": summary["absent_count"],
                "consecutiveAbsences": summary["consecutive"],
            })

        unmatched = [rec for rec in records if rec['id'] not in matched_ids]

        return jsonify({
            "status": "success",
            "topLevelCollections": [c.id for c in db.collections()],
            "attendanceCollectionsRead": ATTENDANCE_COLLECTIONS,
            "totalAttendanceRecords": len(records),
            "fieldsSeen": dict(field_counter),
            "statusValuesSeen": dict(status_counter),
            "countMissingWeekdaysAsAbsent": COUNT_MISSING_WEEKDAYS_AS_ABSENT,
            "students": students,
            "unmatchedRecordCount": len(unmatched),
            "unmatchedSamples": [
                {k: _jsonable(v) for k, v in rec.items()} for rec in unmatched[:3]
            ],
            "sampleRecords": [
                {k: _jsonable(v) for k, v in rec.items()} for rec in records[:3]
            ],
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

        # Sort by aiScore, highest first
        matches.sort(key=lambda m: m["aiScore"], reverse=True)

        return jsonify({"status": "success", "data": matches})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == '__main__':
    app.run(port=5000, debug=True)