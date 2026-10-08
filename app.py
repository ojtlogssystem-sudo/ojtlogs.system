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
# FIREBASE USAGE SAVER: memory + disk cache
# ==========================================
# Para hindi paulit-ulit ang pagbasa ng buong collection sa Firestore.
# May dalawang layer:
#   1. memory cache  - mabilis, pero nawawala kapag nag-restart ang server
#   2. disk cache    - nasa folder na ".cache", kaya HINDI nawawala kapag
#                      nag-restart ang server (dating dahilan ng biglang
#                      pagdami ng reads at writes)
import time
import threading
import pickle
import hashlib

_cache = {}
_cache_lock = threading.Lock()

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
except Exception:
    pass


def _disk_path(key):
    return os.path.join(CACHE_DIR, f"{key}.pkl")


def _disk_load(key, ttl):
    try:
        with open(_disk_path(key), 'rb') as f:
            stamp, value = pickle.load(f)
        if time.time() - stamp < ttl:
            return stamp, value
    except Exception:
        pass
    return None


def _disk_save(key, stamp, value):
    try:
        tmp = _disk_path(key) + '.tmp'
        with open(tmp, 'wb') as f:
            pickle.dump((stamp, value), f)
        os.replace(tmp, _disk_path(key))
    except Exception as e:
        print(f"[cache] disk save skipped for '{key}': {e}")


def invalidate(*keys):
    """Burahin ang cache (memory + disk) para sa mga key na ito."""
    with _cache_lock:
        for key in keys:
            _cache.pop(key, None)
    for key in keys:
        try:
            os.remove(_disk_path(key))
        except OSError:
            pass


def cached(key, ttl, loader, force=False, persist=True):
    """Ibalik ang cached na value kung bago pa (ttl = segundo); kung hindi, i-load ulit."""
    now = time.time()
    if not force:
        with _cache_lock:
            hit = _cache.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
        if persist:
            disk = _disk_load(key, ttl)
            if disk:
                with _cache_lock:
                    _cache[key] = disk
                return disk[1]
    value = loader()
    stamp = time.time()
    with _cache_lock:
        _cache[key] = (stamp, value)
    if persist:
        _disk_save(key, stamp, value)
    return value


# TTL settings (segundo) - dagdagan para mas makatipid, bawasan para mas "live"
ATTENDANCE_CACHE_TTL = 900       # 15 min
USERS_CACHE_TTL = 600            # 10 min
PREDICT_RISK_CACHE_TTL = 600     # 10 min
SKILL_PROFILE_CACHE_TTL = 86400  # 24 oras (bihirang magbago ang tasks/skills)
COMPANIES_CACHE_TTL = 86400      # 24 oras


class _UserDoc:
    """Kapalit ng Firestore DocumentSnapshot para magamit ang cached na users."""
    exists = True

    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


def _load_users(force=False):
    """Lahat ng users - 1 beses lang binabasa kada TTL, ibinabahagi sa lahat ng endpoint."""
    def loader():
        return [(d.id, d.to_dict() or {}) for d in db.collection('users').stream()]
    return [_UserDoc(i, d) for i, d in cached('users', USERS_CACHE_TTL, loader, force)]


def _get_user_doc(doc_id):
    """Isang user galing sa cache (0 reads). Kung wala sa cache, saka lang magbabasa sa Firestore."""
    for u in _load_users():
        if u.id == doc_id:
            return u
    snap = db.collection('users').document(doc_id).get()
    return _UserDoc(snap.id, snap.to_dict() or {}) if snap.exists else None


def _load_companies(force=False):
    def loader():
        return [(d.id, d.to_dict() or {}) for d in db.collection('companies').stream()]
    return [{"id": i, **d} for i, d in cached('companies', COMPANIES_CACHE_TTL, loader, force)]


# Huling na-write na analytics payload kada estudyante (para hindi mag-write kung walang nagbago).
# Naka-save sa disk, kaya hindi na ulit isusulat ang LAHAT ng estudyante pagka-restart ng server.
_last_written_lock = threading.Lock()
try:
    with open(os.path.join(CACHE_DIR, 'last_written.json'), 'r', encoding='utf-8') as _f:
        _last_written = json.load(_f)
except Exception:
    _last_written = {}


def _save_last_written():
    try:
        with _last_written_lock:
            tmp = os.path.join(CACHE_DIR, 'last_written.json.tmp')
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(_last_written, f)
            os.replace(tmp, os.path.join(CACHE_DIR, 'last_written.json'))
    except Exception as e:
        print(f"[cache] last_written save skipped: {e}")

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
    'email', 'studentEmail', 'userEmail'
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

def _load_attendance_records(force=False):
    return cached('attendance', ATTENDANCE_CACHE_TTL, _load_attendance_records_uncached, force)

def _load_attendance_records_uncached():
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

# ==========================================
# SCHEDULE-BASED ATTENDANCE
# Iisang source of truth para sa bilang ng absent (Analytics, attendance
# graph modal). Sinusunod ang Attendance Records (attendance_shared.js) at
# ang Reports (reports.js):
#   - Absent  = araw na naka-schedule pero walang time-in, o may record na
#               status = absent. Hindi binibilang ang Rejected / Excused.
#   - Isang status kada ARAW (Present/Late ang nananalo kung may absent
#     record din sa parehong araw).
#   - Simula ng bilang = schedule.startDate ng estudyante (kapareho ng Reports).
#   - Completed na: hanggang huling araw lang ng time-in ang bilang.
# ==========================================
GRACE_MINUTES = 15            # dapat kapareho ng GRACE_MINUTES sa attendance_shared.js
SCHEDULE_MAX_RANGE_DAYS = 366 # dapat kapareho ng MAX_RANGE_DAYS sa attendance_shared.js
WEEKDAY_ABBR = ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
FALLBACK_DAY_END_MINUTES = 17 * 60   # kung walang valid na session times (kapareho ng reports.js)
ATTENDANCE_RECORD_DATE_FIELDS = ('formattedDate', 'date', 'timestamp', 'createdAt')

def _time_to_minutes(value):
    """'08:00' / '8:05 AM' / '08:05:12 PM' -> minutes since midnight."""
    if value is None:
        return None
    m = re.match(r'^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$', str(value).strip())
    if not m:
        return None
    hours, minutes = int(m.group(1)), int(m.group(2))
    meridiem = m.group(3).upper() if m.group(3) else None
    if meridiem == 'PM' and hours < 12:
        hours += 12
    if meridiem == 'AM' and hours == 12:
        hours = 0
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes

def _get_schedule_sessions(schedule):
    if not isinstance(schedule, dict):
        return []
    raw = []
    if schedule.get('morning') and schedule.get('morningEnabled') is not False:
        raw.append(schedule['morning'])
    if schedule.get('afternoon') and schedule.get('afternoonEnabled') is not False:
        raw.append(schedule['afternoon'])
    sessions = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        start = _time_to_minutes(item.get('timeIn'))
        end = _time_to_minutes(item.get('timeOut'))
        if start is not None and end is not None and start < end:
            sessions.append({"start": start, "end": end})
    sessions.sort(key=lambda x: x["start"])
    return sessions

def _to_ph_day(value):
    """Kahit anong date value (Firestore Timestamp, ISO string, epoch...) -> 'YYYY-MM-DD' (PH time)."""
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(PH_TZ)
        return value.strftime('%Y-%m-%d')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            ts = float(value)
            if ts > 1e11:       # milliseconds
                ts /= 1000.0
            return datetime.fromtimestamp(ts, PH_TZ).strftime('%Y-%m-%d')
        except (ValueError, OverflowError, OSError):
            return None
    text = str(value).strip()
    if 'T' in text:
        try:
            return _to_ph_day(datetime.fromisoformat(text.replace('Z', '+00:00')))
        except ValueError:
            pass
    return _to_date_str(text)

def _attendance_day(rec):
    for field in ATTENDANCE_RECORD_DATE_FIELDS:
        day = _to_ph_day(rec.get(field))
        if day:
            return day
    return None

def _build_attendance_index(attendance_records):
    """{(userId / uid / lowercase email, 'YYYY-MM-DD'): [records]}"""
    index = {}
    for rec in attendance_records:
        day = _attendance_day(rec)
        if not day:
            continue
        owners = set()
        for field in ('userId', 'uid'):
            if rec.get(field):
                owners.add(str(rec[field]))
        if rec.get('userEmail'):
            owners.add(str(rec['userEmail']).lower())
        for owner in owners:
            index.setdefault((owner, day), []).append(rec)
    return index

def _stored_status(rec):
    return str((rec or {}).get('status') or '').lower()

def _pick_day_record(recs):
    """Isang record kada araw: ang may time-in (Present/Late) ang nananalo
    kahit may absent record din sa parehong araw."""
    if not recs:
        return None
    for r in recs:
        st = _stored_status(r)
        if (_time_to_minutes(r.get('timeIn')) is not None
                and 'reject' not in st and 'absent' not in st):
            return r
    for r in recs:
        if 'excus' in _stored_status(r):
            return r
    return recs[0]

def _is_completed_student(data):
    status = str(data.get('internshipStatus') or data.get('aiStatus') or '').lower()
    if status == 'completed':
        return True
    try:
        completed = float(data.get('completedHours'))
        target = float(data.get('targetHours') or 0) or 600
        return completed >= target
    except (TypeError, ValueError):
        return False

def _derive_day_status(sessions, rec, now_minutes, day_end):
    stored = _stored_status(rec)
    if rec and 'reject' in stored:
        return 'Rejected'
    if rec and 'excus' in stored:
        return 'Excused'
    if rec and 'absent' in stored:
        return 'Absent'

    time_in = _time_to_minutes(rec.get('timeIn')) if rec else None
    if time_in is not None:
        if sessions:
            session = next((x for x in sessions if time_in < x["end"]), sessions[-1])
            return 'Late' if time_in > session["start"] + GRACE_MINUTES else 'Present'
        return 'Late' if 'late' in stored else 'Present'

    if rec and not sessions:
        # walang session times: sundin ang naka-save na status ng record
        if 'late' in stored:
            return 'Late'
        if any(w in stored for w in ('present', 'on-time', 'adjusted')):
            return 'Present'
        return 'Unknown'

    return 'Absent' if now_minutes >= day_end else 'Pending'

def _student_start_date(data):
    raw = data.get('ojtStartDate') or data.get('startDate')
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d") if raw else datetime(2026, 9, 14)
    except (ValueError, TypeError):
        return datetime(2026, 9, 14)

def _schedule_start_day(data):
    """schedule.startDate ng estudyante bilang date (o None)."""
    schedule = data.get('schedule')
    raw = schedule.get('startDate') if isinstance(schedule, dict) else None
    day = _to_ph_day(raw) if raw else None
    if not day:
        return None
    try:
        return datetime.strptime(day, '%Y-%m-%d').date()
    except ValueError:
        return None

def _attendance_start_day(data, default_dt):
    """Simula ng bilang ng absent: schedule.startDate (tulad ng Reports),
    kung wala ay ang default (ojtStartDate / startDate / batch start)."""
    return _schedule_start_day(data) or default_dt.date()

def _scheduled_day_statuses_ex(user_data, user_doc_id, attendance_index, start_day, now=None):
    """
    Ibinabalik ang ({date: status}, reason). status = Present / Late / Absent /
    Pending / Rejected / Excused / Unknown para sa bawat araw na naka-schedule
    ang estudyante mula start_day hanggang ngayon.
    Ibinabalik ang (None, reason) kung walang magagamit na schedule - sa ganoon
    ang lumang record-based na bilang ang gagamitin.
    """
    schedule = user_data.get('schedule')
    if not isinstance(schedule, dict) or not schedule:
        return None, 'walang schedule sa users doc'

    days = schedule.get('days')
    duty_weekdays = (
        {str(d).strip()[:3].lower() for d in days if d is not None}
        if isinstance(days, list) else set()
    ) & set(WEEKDAY_ABBR)
    if not duty_weekdays:
        return None, 'walang valid na schedule.days'

    sessions = _get_schedule_sessions(schedule)
    day_end = sessions[-1]["end"] if sessions else FALLBACK_DAY_END_MINUTES

    cutoff_mode = (
        _is_completed_student(user_data) and
        user_data.get('continueDutyAfterCompletion') is not True
    )

    email = str(user_data.get('email') or '').lower()
    now = now or datetime.now(PH_TZ)
    today = now.date()
    now_minutes = now.hour * 60 + now.minute

    cursor = max(start_day, today - timedelta(days=SCHEDULE_MAX_RANGE_DAYS - 1))
    statuses = {}
    last_time_in = None
    while cursor <= today:
        key = cursor.strftime('%Y-%m-%d')
        if WEEKDAY_ABBR[cursor.weekday()] in duty_weekdays and key not in NON_DUTY_DATES:
            recs = list(attendance_index.get((str(user_doc_id), key), []))
            if email:
                recs += attendance_index.get((email, key), [])
            rec = _pick_day_record(recs)
            status = _derive_day_status(
                sessions, rec, now_minutes if cursor == today else 24 * 60, day_end
            )
            statuses[key] = status
            if rec and status in ('Present', 'Late') and _time_to_minutes(rec.get('timeIn')) is not None:
                last_time_in = key
        cursor += timedelta(days=1)

    # Completed na: huwag nang bilangin ang absent pagkatapos ng huling time-in
    if cutoff_mode and last_time_in:
        statuses = {k: v for k, v in statuses.items() if k <= last_time_in}

    reason = 'ok' if sessions else 'ok (walang valid na session times - gumamit ng 5:00 PM bilang uwian)'
    return statuses, reason

def _scheduled_day_statuses(user_data, user_doc_id, attendance_index, start_day, now=None):
    return _scheduled_day_statuses_ex(user_data, user_doc_id, attendance_index, start_day, now)[0]

def _absent_present_from_statuses(statuses):
    absent = {d for d, st in statuses.items() if st == 'Absent'}
    present = {d for d, st in statuses.items() if st in ('Present', 'Late')}
    return absent, present

def _summarize_statuses(statuses):
    absent, present = _absent_present_from_statuses(statuses)
    consecutive = 0
    for day in sorted(absent | present, reverse=True):
        if day in absent:
            consecutive += 1
        else:
            break
    return {
        "absent_count": len(absent),
        "consecutive": consecutive,
        "record_count": len(absent) + len(present),
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

    # Soft-deleted na ng coordinator
    if data.get('accountDisabled') is True:
        return True

    # Pareho sa rule ng students.js / registered-students.js:
    # hindi pa registered kung hindi pa tapos ang profile setup o
    # kulang ang email, student number, o company.
    # (Completed = manual final status, kaya hindi dumadaan dito.)
    if str(data.get('status') or '').strip().lower() != 'completed':
        email = str(data.get('email') or '').strip()
        profile_done = (
            data.get('isProfileComplete') is True or
            data.get('profileCompleted') is True
        )
        has_student_number = bool(data.get('studentNumber') or data.get('studentId'))
        has_company = bool(data.get('companyName') or data.get('company'))
        if not (email and profile_done and has_student_number and has_company):
            return True

    return False

def _is_archived(data):
    """True kung nasa Completed Batch Archive na ang estudyante."""
    if data.get('archived') is True or data.get('isArchived') is True:
        return True
    if data.get('archivedAt') or data.get('archivedDate'):
        return True
    for field in ('batchArchived', 'inArchive', 'isCompletedBatch',
                  'completedBatchArchived', 'archiveId', 'archivedBatch'):
        if data.get(field):
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
        force = request.args.get('refresh') == '1'
        if force:
            invalidate('attendance', 'users')  # i-refresh din ang attendance at users
        data = cached('predict-risk', PREDICT_RISK_CACHE_TTL, _build_predict_risk, force)
        return jsonify(data)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


def _build_predict_risk():
    try:
        docs = _load_users()   # cached - hindi na bumabasa ng buong users kada rebuild

        attendance_records = _load_attendance_records()
        attendance_index = _build_attendance_index(attendance_records)

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

        _writes_done = 0

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

                # Schedule-based (kapareho ng Attendance Records page): ang araw na
                # naka-schedule pero walang time-in ay bilang Absent.
                day_statuses = _scheduled_day_statuses(
                    data, doc.id, attendance_index,
                    _attendance_start_day(data, start_date)
                )
                if day_statuses is not None:
                    attendance_summary = _summarize_statuses(day_statuses)
                else:
                    # Walang schedule / Completed na -> lumang record-based na bilang
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

                # Hindi pa nagsisimula sa duty: walang hours, walang attendance
                # record, at walang absent (hal. hindi pa dumarating ang start ng
                # schedule). Hindi pa dapat hatulan ang hours pace; kapag may
                # naka-schedule na araw na lumipas nang walang time-in, papasok na
                # ang absent at saka na siya masusukat.
                not_started = (
                    completed_hours <= 0 and
                    attendance_record_count == 0 and
                    absent_count == 0 and
                    duty_days_left > 0
                )

                if completed_hours >= target_hours:
                    ai_status = "Completed"
                    risk_reason = "Internship requirements fully satisfied."

                elif not_started:
                    ai_status = "On Track"
                    risk_reason = (
                        f"Duty has not started yet - no attendance records and "
                        f"no absences so far. Hours progress will be evaluated "
                        f"once the student starts duty. "
                        f"End of duty: {coordinator_deadline}."
                    )

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
                            f" Still short of {int(hours_still_needed)} hrs "
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
                elif is_new_student or not_started:
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
                analytics_payload = {
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
                    "riskReason": risk_reason
                }

                # Mag-write lang kung may nagbago (tipid sa Firestore writes)
                payload_key = hashlib.md5(
                    json.dumps(analytics_payload, sort_keys=True, default=str).encode('utf-8')
                ).hexdigest()
                if _last_written.get(doc.id) != payload_key:
                    analytics_doc_ref.set(
                        {**analytics_payload, "lastUpdated": firestore.SERVER_TIMESTAMP},
                        merge=True
                    )
                    _last_written[doc.id] = payload_key
                    _writes_done += 1

                # Nabasa na natin ang users doc, kaya libre ang paghahambing
                if data.get('internshipStatus') != ai_status:
                    db.collection('users').document(doc.id).set({
                        "internshipStatus": ai_status
                    }, merge=True)
                    try:
                        doc._data['internshipStatus'] = ai_status   # sync sa cached copy
                    except Exception:
                        pass

            except Exception as doc_error:
                print(f"[predict-risk] Skipped doc {doc.id}: {doc_error}")
                continue

        if _writes_done:
            _save_last_written()

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

        return {
            "status": "success",
            "data": student_predictions,
            "statusCounts": summary
        }

    except Exception:
        raise


# ==========================================
# 1B. ENDPOINT FOR PER-STUDENT ATTENDANCE
#     (Present/Absent by date - used by the
#     "click a student -> line graph" modal
#     sa Analytics page)
# ==========================================
@app.route('/api/student-attendance/<student_doc_id>', methods=['GET'])
def get_student_attendance(student_doc_id):
    try:
        user_doc = _get_user_doc(student_doc_id)

        if user_doc is None:
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
        day_statuses = _scheduled_day_statuses(
            data, student_doc_id,
            _build_attendance_index(attendance_records),
            _attendance_start_day(data, _student_start_date(data))
        )

        if day_statuses is not None:
            # Schedule-based: kapareho ng Attendance Records at ng Analytics table
            absent_dates, present_dates = _absent_present_from_statuses(day_statuses)
            undated_absences = 0
            record_count = len(absent_dates) + len(present_dates)
        else:
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
            record_count = len(matched_records)

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
                "recordCount": record_count,
            }
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ==========================================
# 1C. DIAGNOSTIC: bakit ganito ang bilang ng absent ng bawat estudyante
#     Buksan: /api/debug-absences            (lahat)
#             /api/debug-absences?name=looc  (isang estudyante)
#             /api/debug-absences?refresh=1  (i-reload ang attendance)
# ==========================================
@app.route('/api/debug-absences', methods=['GET'])
def debug_absences():
    try:
        if request.args.get('refresh') == '1':
            _cache.pop('attendance', None)
        name_filter = _norm(request.args.get('name'))

        records = _load_attendance_records()
        index = _build_attendance_index(records)

        rows = []
        for doc in db.collection('users').stream():
            data = doc.to_dict() or {}
            role = str(data.get('role', '')).lower()
            if role != 'student' and data.get('role'):
                continue
            name = data.get('name') or data.get('fullName') or 'Student User'
            if name_filter and name_filter not in (_norm(name) or ''):
                continue

            sched_start = _schedule_start_day(data)
            start_day = _attendance_start_day(data, _student_start_date(data))
            statuses, reason = _scheduled_day_statuses_ex(data, doc.id, index, start_day)

            row = {
                "id": doc.id,
                "name": name,
                "pending(hindi binibilang sa analytics)": _is_pending_student(data),
                "startDay": str(start_day),
                "startSource": "schedule.startDate" if sched_start else "ojtStartDate/startDate/batch default",
                "reason": reason,
            }
            if statuses is None:
                row["method"] = "record-based (walang schedule)"
                matched = _get_student_records(
                    records, doc.id, _get_student_id_raw(data) or doc.id[:7],
                    name, data.get('email')
                )
                row.update(_summarize_attendance(matched))
            else:
                absent, present = _absent_present_from_statuses(statuses)
                counts = Counter(statuses.values())
                row.update({
                    "method": "schedule-based",
                    "absent": len(absent),
                    "present": counts.get('Present', 0),
                    "late": counts.get('Late', 0),
                    "pending": counts.get('Pending', 0),
                    "rejected": counts.get('Rejected', 0),
                    "excused": counts.get('Excused', 0),
                    "consecutiveAbsences": _summarize_statuses(statuses)["consecutive"],
                    "absentDates": sorted(absent),
                })
            rows.append(row)

        rows.sort(key=lambda r: str(r["name"]).lower())
        return jsonify({"status": "success", "count": len(rows), "students": rows})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ==========================================
# 2. ENDPOINT FOR COMPANY SKILL EXPOSURE
#    (Primary Skill is now DERIVED from the tasks the students log)
# ==========================================

# skillKey -> (label shown in table, keywords found in task text)
SKILL_CATEGORIES = {
    "networking": ("Network", [
        "router", "routing", "lan", "wan", "vlan", "switch", "cabling", "cable", "network",
        "tcp", "ip address", "wifi", "wi-fi", "wireless", "subnet", "firewall", "cisco",
        "crimp", "utp", "access point", "modem", "ethernet", "vpn", "patch panel",
        "topology", "bandwidth", "connectivity", "internet connection"]),
    "software": ("Web/Software Developer", [
        "html", "css", "javascript", "js", "react", "api", "frontend", "front-end",
        "backend", "back-end", "code", "coding", "program", "debug", "develop", "php",
        "python", "java", "website", "web app", "ui", "ux", "flutter", "laravel",
        "bug", "feature", "software", "git", "django", "node", "system design"]),
    "hardware": ("Hardware", [
        "pc", "computer", "laptop", "desktop", "hardware", "assemble", "assembly", "repair",
        "component", "ram", "motherboard", "printer", "peripheral", "format", "diagnos",
        "replace", "monitor", "keyboard", "upgrade", "os installation", "install windows",
        "cleaning", "ups", "cctv"]),
    "database": ("Database", [
        "database", "sql", "mysql", "postgres", "mongodb", "firebase", "query", "queries",
        "schema", "table", "backup", "migration", "data entry", "records", "encode", "spreadsheet"]),
    "hosting": ("Hosting & Cloud", [
        "server", "hosting", "domain", "cloud", "cpanel", "dns", "ssl", "deploy",
        "aws", "azure", "vps", "linux", "nginx", "apache", "ftp", "uptime"]),
    "support": ("IT Support", [
        "helpdesk", "help desk", "support", "maintenance", "troubleshoot", "user assist",
        "assist", "ticket", "technical", "documentation", "inventory", "antivirus",
        "account", "install", "software installation", "user"]),
}


def _kw_pattern(kw):
    # short keywords (lan, ip, pc...) must match as a whole word, longer ones as a word prefix
    # (so "configur" style stems and plurals work, but "lan" won't match "plan"/"language")
    esc = re.escape(kw)
    return re.compile(r'\b' + esc + (r'\b' if len(kw) <= 3 else ''), re.IGNORECASE)


_SKILL_PATTERNS = {
    key: [_kw_pattern(k) for k in kws] for key, (_, kws) in SKILL_CATEGORIES.items()
}


LABEL_ALIASES = {
    "networking": "networking", "network": "networking", "network administration": "networking",
    "software development": "software", "web development": "software", "programming": "software",
    "coding": "software", "ui/ux design": "software", "ui/ux": "software", "ui design": "software",
    "system testing": "software", "testing": "software", "quality assurance": "software",
    "database maintenance": "database", "database": "database", "data management": "database",
    "hardware": "hardware", "hardware maintenance": "hardware", "pc repair": "hardware",
    "hosting": "hosting", "cloud": "hosting", "server administration": "hosting",
    "it support": "support", "technical support": "support", "helpdesk": "support",
}
_LABEL_RE = re.compile(r'^\s*([A-Za-z][A-Za-z/&\- ]{2,40}?)\s*:\s*(.+)$', re.S)


def _split_label(text):
    """'Networking: Set up router' -> ('Networking', 'Set up router')"""
    m = _LABEL_RE.match(text or '')
    if not m:
        return None, text
    return m.group(1).strip(), m.group(2).strip()


def _classify_by_keywords(text):
    best_key, best_score = None, 0
    for key, patterns in _SKILL_PATTERNS.items():
        score = sum(1 for p in patterns if p.search(text))
        if score > best_score:  # ties -> the earlier category in SKILL_CATEGORIES wins
            best_key, best_score = key, score
    return best_key


def classify_task_text(text):
    """Return the skillKey for one task. Uses the student's own 'Category:' label when present,
    otherwise reads the sentence itself and matches keywords."""
    text = str(text or "").strip()
    if not text:
        return None
    label, body = _split_label(text)
    if label:
        key = LABEL_ALIASES.get(label.lower()) or _classify_by_keywords(label)
        if key:
            return key
        return _classify_by_keywords(body)
    return _classify_by_keywords(text)


def _top_common_tasks(task_texts, limit=3, max_len=90):
    counts, original = Counter(), {}
    for raw in task_texts:
        _, body = _split_label(raw)
        body = re.sub(r'\s+', ' ', body).strip(' .,;')
        norm = body.lower()
        counts[norm] += 1
        original.setdefault(norm, body)
    out = []
    for n, _ in counts.most_common(limit):
        t = original[n]
        out.append(t if len(t) <= max_len else t[:max_len - 1].rstrip() + '\u2026')
    return out


MIN_SKILL_SHARE = 0.20       # a skill must be >= 20% of the company's tasks to be listed
MAX_SKILLS_PER_COMPANY = 3   # at most 3 skills per company row


# ---- Task discovery -------------------------------------------------------
# Hindi fixed ang pangalan ng collection/field kung saan nilalagay ng students ang tasks,
# kaya awtomatiko nating hinahanap: lahat ng top-level collections (maliban sa companies/users/analytics)
# + subcollections ng bawat user + collection groups na may task-like na pangalan.
TASK_SKIP_COLLECTIONS = {'companies', 'users', 'analytics'}
TASK_GROUP_NAMES = ('tasks', 'taskLogs', 'logs', 'dailyLogs', 'dtr', 'journals', 'accomplishments')

# TIPID SA READS: kung alam mo na kung saang collection nakalagay ang tasks,
# ilagay dito ang pangalan (hal. ('tasks',) o ('dailyLogs',)). Ang collection_group
# scan ay sasakop sa top-level AT subcollection na may ganoong pangalan, kaya
# hindi na i-scan ang LAHAT ng collections at subcollections ng bawat estudyante.
# Kapag walang laman (()), gagana ang dating auto-discovery (mabigat sa reads).
TASK_SOURCES = ()
TASK_TEXT_FIELDS = {f.lower() for f in (
    'taskDescription', 'taskName', 'taskTitle', 'task', 'tasks', 'taskDone', 'tasksDone',
    'task_description', 'tasksPerformed', 'taskPerformed', 'description', 'activity', 'activities',
    'accomplishment', 'accomplishments', 'workDone', 'work', 'workDescription', 'remarks',
    'notes', 'summary', 'details', 'report', 'narrative', 'journal', 'title')}
TASK_OWNER_FIELDS = ATTENDANCE_OWNER_FIELDS + ('studentName', 'name', 'student', 'fullName')


def _flatten_text(value, depth=0):
    if value is None or depth > 3:
        return []
    if isinstance(value, str):
        parts = re.split(r'[\n;|\u2022]+', value)
        return [p.strip(' -*\t') for p in parts if len(p.strip(' -*\t')) >= 3]
    if isinstance(value, (list, tuple)):
        out = []
        for v in value:
            out.extend(_flatten_text(v, depth + 1))
        return out
    if isinstance(value, dict):
        out = []
        for k, v in value.items():
            if str(k).lower() in TASK_TEXT_FIELDS:
                out.extend(_flatten_text(v, depth + 1))
        return out
    return []


def _extract_task_texts(rec):
    out = []
    for k, v in rec.items():
        if str(k).lower() in TASK_TEXT_FIELDS:
            out.extend(_flatten_text(v))
    return out


TASK_SOURCES_FILE = os.path.join(CACHE_DIR, 'task_sources.json')


def _load_known_task_sources():
    try:
        with open(TASK_SOURCES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _save_known_task_sources(found):
    try:
        with open(TASK_SOURCES_FILE, 'w', encoding='utf-8') as f:
            json.dump(found, f)
    except Exception as e:
        print(f"[skill-exposure] cannot save task sources: {e}")


def _load_task_records(students):
    """Collect every Firestore record that could hold student tasks.

    TIPID SA READS:
    - Unang takbo lang ang buong auto-discovery. Itinatala kung aling sources
      ang talagang may task text (.cache/task_sources.json); sa susunod, yun
      na lang ang babasahin.
    - Hindi na binabasa ulit ang 'attendance' (galing sa cached attendance).
    - Hindi na dobleng binabasa ang top-level collection na kapareho ng
      pangalan ng collection group (sakop na ng collection_group).
    - Para ulitin ang discovery: /api/company-skill-exposure?refresh=1&rediscover=1
    """
    records, seen = [], set()
    productive = {"groups": set(), "top": set(), "sub": set()}

    def add(doc, src, kind, parent=None):
        path = doc.reference.path
        if path in seen:
            return
        seen.add(path)
        rec = {**doc.to_dict(), "_src": src, "_parent": parent}
        records.append(rec)
        if _extract_task_texts(rec):
            productive[kind].add(src)

    known = None if TASK_SOURCES else _load_known_task_sources()

    if TASK_SOURCES:
        group_names = list(TASK_SOURCES)
        top_names, sub_names, discover = [], [], False
    elif known:
        group_names = known.get("groups", [])
        top_names = known.get("top", [])
        sub_names = known.get("sub", [])
        discover = False
    else:
        group_names = list(TASK_GROUP_NAMES)
        top_names, sub_names, discover = [], [], True

    # 1. TOP-LEVEL COLLECTIONS
    if discover:
        try:
            for col in db.collections():
                if col.id in TASK_SKIP_COLLECTIONS or col.id in TASK_GROUP_NAMES:
                    continue
                if col.id in ATTENDANCE_COLLECTIONS:
                    # galing sa cache - walang dagdag na reads
                    for rec in _load_attendance_records():
                        r = {**rec, "_src": col.id, "_parent": None}
                        records.append(r)
                        if _extract_task_texts(r):
                            productive["top"].add(col.id)
                    continue
                for doc in col.stream():
                    add(doc, col.id, "top")
        except Exception as e:
            print(f"[skill-exposure] top-level scan failed: {e}")
    else:
        for name in top_names:
            try:
                if name in ATTENDANCE_COLLECTIONS:
                    for rec in _load_attendance_records():
                        records.append({**rec, "_src": name, "_parent": None})
                    continue
                for doc in db.collection(name).stream():
                    add(doc, name, "top")
            except Exception as e:
                print(f"[skill-exposure] top-level '{name}' skipped: {e}")

    # 2. COLLECTION GROUPS (sakop din ang top-level na kapareho ng pangalan)
    for name in group_names:
        try:
            for doc in db.collection_group(name).stream():
                add(doc, name, "groups")
        except Exception as e:
            print(f"[skill-exposure] collection_group '{name}' skipped: {e}")

    # 3. SUBCOLLECTIONS NG BAWAT USER
    if discover:
        for st in students:
            try:
                for sub in db.collection('users').document(st['id']).collections():
                    for doc in sub.stream():
                        add(doc, sub.id, "sub", st['id'])
            except Exception as e:
                print(f"[skill-exposure] subcollections of {st['id']} skipped: {e}")
    else:
        for name in sub_names:
            for st in students:
                try:
                    for doc in db.collection('users').document(st['id']).collection(name).stream():
                        add(doc, name, "sub", st['id'])
                except Exception as e:
                    print(f"[skill-exposure] users/{st['id']}/{name} skipped: {e}")

    if discover:
        _save_known_task_sources({k: sorted(v) for k, v in productive.items()})

    return records


def _student_keys(st):
    keys = {_norm(st.get('id')), _norm(_get_student_id_raw(st)), _norm(st.get('email')),
            _norm(st.get('uid')), _norm(st.get('name')), _norm(st.get('fullName'))}
    keys.discard(None)
    return keys


def _record_belongs_to(rec, keys):
    if rec.get("_parent") and _norm(rec["_parent"]) in keys:
        return True
    owners = {_norm(rec.get(f)) for f in TASK_OWNER_FIELDS}
    owners.discard(None)
    return bool(keys & owners)


def build_company_skill_profiles(force=False):
    return cached('skill-profiles', SKILL_PROFILE_CACHE_TTL, _build_company_skill_profiles_uncached, force)


def _build_company_skill_profiles_uncached():
    """Compute the skills (1..3) + exposure for every company from the students' logged tasks."""
    companies = _load_companies()
    students = []
    for d in _load_users():
        data = d.to_dict()
        if str(data.get('role', '')).lower() == 'student' or not data.get('role'):
            students.append({"id": d.id, **data})
    records = _load_task_records(students)

    profiles = []
    for comp in companies:
        company_name = comp.get('companyName', 'Unnamed Company')
        cname = company_name.lower()
        comp_students = [
            s for s in students
            if cname in str(s.get('companyName', '')).lower() or cname in str(s.get('company', '')).lower()
        ]

        skill_counts = Counter()
        tasks_by_skill = {k: [] for k in SKILL_CATEGORIES}
        per_student = []
        raw_task_total = 0

        for st in comp_students:
            keys = _student_keys(st)
            st_counts, st_texts = Counter(), []
            for rec in records:
                if not _record_belongs_to(rec, keys):
                    continue
                for text in _extract_task_texts(rec):
                    raw_task_total += 1
                    st_texts.append(text)
                    key = classify_task_text(text)
                    if key:
                        skill_counts[key] += 1
                        st_counts[key] += 1
                        tasks_by_skill[key].append(text)
            per_student.append({
                "student": st, "name": st.get('name') or st.get('fullName') or 'Student',
                "texts": st_texts, "counts": st_counts,
                "top": st_counts.most_common(1)[0][0] if st_counts else None,
            })

        def course_section(p):
            return f"{p['student'].get('course', 'BSIT')} {p['student'].get('section', '')}".strip()

        classified_total = sum(skill_counts.values())

        if classified_total == 0:
            if not comp_students:
                msg = "No students are assigned to this company yet."
            elif raw_task_total == 0:
                msg = f"{len(comp_students)} student(s) found, but no task records were matched to them."
            else:
                msg = (f"{raw_task_total} task(s) found, but none matched a known skill. "
                       f"Samples: {', '.join(t for p in per_student for t in p['texts'][:1])[:150]}")
            profiles.append({
                "companyName": company_name, "primarySkill": "No task data yet",
                "skillKey": "none", "exposure": 0, "commonTasks": msg, "skills": [],
                "matchedStudents": [
                    {"name": p["name"], "courseSection": course_section(p),
                     "tasks": ", ".join(p["texts"][:3]) or "No tasks logged yet",
                     "status": "NO MATCH DATA"} for p in per_student],
            })
            continue

        # every skill that makes up a meaningful part of the logged tasks (max 3)
        skills = []
        for key, cnt in skill_counts.most_common():
            share = cnt / classified_total
            if skills and (share < MIN_SKILL_SHARE or len(skills) >= MAX_SKILLS_PER_COMPANY):
                break
            skills.append({
                "skillKey": key,
                "primarySkill": SKILL_CATEGORIES[key][0],
                "exposure": round(share * 100),
                "studentCount": sum(1 for p in per_student if p["counts"].get(key)),
                "commonTasks": ", ".join(_top_common_tasks(tasks_by_skill[key], 3)),
            })
        top = skills[0]

        matched = []
        for p in per_student:
            status = "NO MATCH DATA" if p["top"] is None else SKILL_CATEGORIES[p["top"]][0].upper()
            matched.append({
                "name": p["name"], "courseSection": course_section(p),
                "tasks": ", ".join(_top_common_tasks(p["texts"], 3)) or "No tasks logged yet",
                "status": status,
            })

        profiles.append({
            "companyName": company_name,
            # top-level fields = the strongest skill (kept for backward compatibility)
            "primarySkill": top["primarySkill"], "skillKey": top["skillKey"],
            "exposure": top["exposure"], "commonTasks": top["commonTasks"],
            "skills": skills,
            "totalStudents": len(comp_students),
            "matchedStudents": matched,
        })
    return profiles


@app.route('/api/debug-skill-sources', methods=['GET'])
def debug_skill_sources():
    """Open in the browser to see where tasks really live in Firestore."""
    try:
        students = [{"id": d.id, **d.to_dict()} for d in db.collection('users').stream()]
        records = _load_task_records(students)
        by_src = {}
        for r in records:
            info = by_src.setdefault(r["_src"], {"docs": 0, "withTaskText": 0, "sampleFields": [], "sampleTask": None})
            info["docs"] += 1
            texts = _extract_task_texts(r)
            if texts:
                info["withTaskText"] += 1
                info["sampleTask"] = info["sampleTask"] or texts[0]
            if not info["sampleFields"]:
                info["sampleFields"] = [k for k in r.keys() if not k.startswith("_")]
        return jsonify({"status": "success", "sources": by_src})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/company-skill-exposure', methods=['GET', 'POST', 'OPTIONS'])
def analyze_company_skill_exposure():
    try:
        force = request.args.get('refresh') == '1'
        if force and request.args.get('rediscover') == '1':
            try:
                os.remove(TASK_SOURCES_FILE)
            except OSError:
                pass
        if force:
            invalidate('users', 'companies')
        return jsonify({"status": "success", "data": build_company_skill_profiles(force)})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ==========================================
# 3. ENDPOINT FOR COMPANY RECOMMENDATION
# ==========================================
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

        matches = []
        for prof in build_company_skill_profiles():
            for sk in prof.get("skills", []):
                if sk["skillKey"] == skill_focus:
                    matches.append({
                        "companyName": prof["companyName"],
                        "primarySkill": sk["primarySkill"],
                        "reasons": [
                            f"Based on student tasks, {sk['exposure']}% of logged work here is {sk['primarySkill']} "
                            f"({sk['studentCount']} student(s)).",
                            f"Common tasks: {sk['commonTasks']}"
                        ],
                        "aiScore": sk["exposure"]
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
    # use_reloader=False: ang auto-reloader ay nagre-restart ng server kada save ng file
    # (at nagpapatakbo ng 2 process), kaya nabubura ang cache at umuulit ang reads/writes.
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False)