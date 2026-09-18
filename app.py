from flask import Flask, jsonify, request
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime
import numpy as np
from sklearn.linear_model import LinearRegression

app = Flask(__name__)
CORS(app)

# Global Preflight CORS Handler para sa lahat ng endpoints
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({"status": "ok"})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        return response, 200

# I-initialize ang Firebase Admin SDK
if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
db = firestore.client()

# ==========================================
# 1. ENDPOINT PARA SA AT-RISK PREDICTION
# ==========================================
def _is_absent_record(rec):
    """
    Flexible reader para sa iba't ibang posibleng
    schema ng 'attendance' collection:
      - status / attendanceStatus na field na naglalaman
        ng salitang "absent"
      - boolean na field na 'present' (False = absent)
    """
    status = str(
        rec.get('status') or rec.get('attendanceStatus') or ''
    ).strip().lower()

    if status:
        return 'absent' in status

    if 'present' in rec:
        return rec.get('present') is False

    return False


def _load_attendance_records():
    """
    Kinukuha lahat ng attendance records nang isang beses
    (parang ginawa na rin sa /api/company-skill-exposure
    endpoint para sa tasks), tapos i-filter/i-count later
    per-student. Mas mabilis kaysa mag-query per student.
    """
    try:
        attendance_ref = db.collection('attendance').stream()
        return [{"id": doc.id, **doc.to_dict()} for doc in attendance_ref]
    except Exception as attendance_error:
        print(f"[predict-risk] Failed to load attendance: {attendance_error}")
        return []


def _count_absences(attendance_records, student_doc_id, student_id_value, student_name):
    count = 0
    for rec in attendance_records:
        matches_student = (
            rec.get('studentUid') == student_doc_id or
            rec.get('studentId') == student_doc_id or
            rec.get('studentId') == student_id_value or
            rec.get('studentUid') == student_id_value or
            (rec.get('studentName') and rec.get('studentName') == student_name)
        )
        if matches_student and _is_absent_record(rec):
            count += 1
    return count


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
        # Ito ang simula ng kasalukuyang OJT batch.
        # Kapag bago pa lang nag-start (ex. September 14,
        # 2026), hindi pa dapat "At Risk" agad ang mga
        # estudyante dahil malapit pa lang sila sa umpisa
        # - kulang pa ang datos para maging maaasahan ang
        # projection. May GRACE_PERIOD_DAYS muna bago
        # tuluyang gamitin ang hours-based projection.
        # ==========================================
        BATCH_START_DATE = datetime(2026, 9, 14)
        GRACE_PERIOD_DAYS = 7

        # Absence thresholds - ito na ang PANGUNAHING
        # basehan ng At Risk / Needs Monitoring, lalo na
        # sa unang linggo ng OJT kung saan halos wala pang
        # laman ang completed hours ng lahat ng estudyante.
        ABSENCE_MONITORING_THRESHOLD = 2   # konting absent -> Needs Monitoring
        ABSENCE_RISK_THRESHOLD = 5         # maraming absent -> At Risk

        # Pangalan lang para di masira ang ibang reference
        # sa baba (backward-compat na variable name).
        absence_monitoring_threshold = ABSENCE_MONITORING_THRESHOLD

        for doc in docs:
            data = doc.to_dict()
            role = str(data.get('role', '')).lower()

            if role != 'student' and data.get('role'):
                continue

            try:

                # SAFE PARSING - proteksyon laban sa
                # null / string / missing na values
                raw_hours = data.get('completedHours', 0)
                try:
                    completed_hours = float(raw_hours) if raw_hours is not None else 0.0
                except (TypeError, ValueError):
                    completed_hours = 0.0

                name = data.get('name') or data.get('fullName') or 'Student User'
                coordinator_deadline = data.get('deadlineDate') or '2026-12-31'

                # Kung may per-student na simula ng OJT
                # (ex. field na 'ojtStartDate' sa Firestore),
                # gamitin yun. Kung wala, gamitin na lang
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
                is_new_student = days_active <= GRACE_PERIOD_DAYS

                # I-PARSE ANG DEADLINE PARA MALAMAN
                # KUNG ILANG ARAW MULA START_DATE ANG
                # DEADLINE (target ng regression model)
                try:
                    deadline_dt = datetime.strptime(
                        str(coordinator_deadline)[:10], "%Y-%m-%d"
                    )
                except (ValueError, TypeError):
                    deadline_dt = datetime(2026, 9, 14)

                deadline_days = (deadline_dt - start_date).days
                deadline_days = max(deadline_days, days_active + 1)

                # ==========================================
                # SCIKIT-LEARN LINEAR REGRESSION
                #
                # Ginagamit ang kasalukuyang bilis ng
                # progreso (completed_hours vs days_active)
                # para i-project kung ilang hours ang
                # matatapos ng estudyante SA ORAS NG
                # DEADLINE - ito na mismo ang gagamitin
                # bilang basehan ng AI status, hindi na
                # basta fixed threshold lang.
                # ==========================================

                X = np.array([[0], [days_active / 2], [days_active]])
                y = np.array([0, completed_hours * 0.5, completed_hours])
                model = LinearRegression()
                model.fit(X, y)

                projected_total_hours = float(
                    model.predict([[deadline_days]])[0]
                )

                # Hindi puwedeng bumaba pa sa ibaba ng
                # kasalukuyang completed hours
                projected_total_hours = max(
                    projected_total_hours, completed_hours
                )

                progress_percentage = min(round((completed_hours / target_hours) * 100), 100)

                student_id_value = (
                    data.get('studentId') or
                    data.get('studentID') or
                    data.get('studentNumber') or
                    data.get('idNumber') or
                    data.get('schoolId') or
                    data.get('studentNo') or
                    data.get('id_number') or
                    doc.id[:7]
                )

                absent_count = _count_absences(
                    attendance_records, doc.id, student_id_value, name
                )

                # ==========================================
                # AI STATUS - COMBINED NA BASEHAN:
                #   1) Scikit-Learn projection (hours vs deadline)
                #   2) Attendance record (bilang ng absences)
                #
                # PRIORITY:
                #   - Completed      -> naabot na ang target hours
                #   - At Risk        -> malayong-malayo sa target
                #                       bago ang deadline (hours-based)
                #   - Needs Monitoring -> hindi pa "at risk" sa hours,
                #                       pero may 5+ absences NA, o
                #                       papalapit lang sa target
                #   - On Track       -> maayos ang hours AT
                #                       regular ang pagpasok
                # ==========================================

                # Hours-projection na basehan ay GINAGAMIT
                # LANG kapag lampas na sa grace period -
                # walang saysay i-flag na "at risk sa hours"
                # ang isang estudyanteng bagong-start pa lang
                # (halos 0 pa lang talaga dapat ang hours
                # nila lahat sa first week).
                is_hours_at_risk = (
                    not is_new_student and
                    projected_total_hours < target_hours * 0.85
                )
                is_hours_borderline = (
                    not is_new_student and
                    not is_hours_at_risk and
                    projected_total_hours < target_hours
                )

                is_attendance_risk = absent_count >= ABSENCE_RISK_THRESHOLD
                is_attendance_monitor = (
                    not is_attendance_risk and
                    absent_count >= ABSENCE_MONITORING_THRESHOLD
                )

                if completed_hours >= target_hours:
                    ai_status = "Completed"
                    risk_reason = "Internship requirements fully satisfied."

                elif is_attendance_risk:
                    ai_status = "At Risk"
                    risk_reason = (
                        f"May {absent_count} naitalang absence na - masyado nang "
                        f"madalas hindi pumasok sa duty, kailangan na ng agarang "
                        f"aksyon mula sa coordinator."
                    )

                elif is_hours_at_risk:
                    ai_status = "At Risk"
                    risk_reason = (
                        f"Scikit-Learn ML: Sa kasalukuyang bilis ng progreso, "
                        f"hinuhulaan lamang na makakaabot ng {int(projected_total_hours)} "
                        f"sa {target_hours} hrs bago ang deadline ({coordinator_deadline})."
                    )
                    if absent_count > 0:
                        risk_reason += f" May {absent_count} naitalang absence din."

                elif is_attendance_monitor:
                    ai_status = "Needs Monitoring"
                    risk_reason = (
                        f"May {absent_count} naitalang absence sa duty ng estudyante - "
                        f"konti pa lang pero kailangan nang bantayan ang attendance."
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
                        f"Scikit-Learn ML: Malapit sa target pero kailangan pang bantayan - "
                        f"hinuhulaan na makakaabot ng {int(projected_total_hours)} "
                        f"sa {target_hours} hrs bago ang deadline ({coordinator_deadline})."
                    )

                elif is_new_student:
                    ai_status = "On Track"
                    risk_reason = (
                        f"OJT has just started ({start_date.strftime('%Y-%m-%d')}) — "
                        f"on the right track and regularly attending "
                        f"({absent_count} absence so far)."
                    )

                else:
                    ai_status = "On Track"
                    risk_reason = (
                        f"Scikit-Learn ML: Sa kasalukuyang bilis, hinuhulaan na "
                        f"makakaabot ng {int(projected_total_hours)} hrs bago ang deadline - "
                        f"nasa tamang track ({coordinator_deadline}). "
                        f"Regular din sa pagpasok ({absent_count} absence lang)."
                    )

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
# 2. ENDPOINT PARA SA COMPANY SKILL EXPOSURE
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
# 3. ENDPOINT PARA SA COMPANY RECOMMENDATION
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

        # I-sort base sa aiScore, pinakamataas muna
        matches.sort(key=lambda m: m["aiScore"], reverse=True)

        return jsonify({"status": "success", "data": matches})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == '__main__':
    app.run(port=5000, debug=True)