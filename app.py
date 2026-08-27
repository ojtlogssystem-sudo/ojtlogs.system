from flask import Flask, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime
import numpy as np
from sklearn.linear_model import LinearRegression

app = Flask(__name__)
CORS(app)

# I-initialize ang Firebase Admin SDK
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

@app.route('/api/predict-risk', methods=['GET'])
def predict_student_risk():
    try:
        users_ref = db.collection('users')
        docs = users_ref.stream()
        
        student_predictions = []
        target_hours = 600  # Standard OJT target hours
        
        for doc in docs:
            data = doc.to_dict()
            role = str(data.get('role', '')).lower()
            
            # Sinasala lang ang mga student account
            if role == 'student' or not data.get('role'):
                completed_hours = float(data.get('completedHours', 0))
                name = data.get('name', 'Student User')
                
                # Kukunin ang deadline mula sa Firebase o mag-default sa end of year
                coordinator_deadline = data.get('deadlineDate', '2026-12-31')
                
                # Awtomatikong kalkulahin ang lumipas na araw mula May 1 hanggang ngayon
                start_date = datetime(2026, 5, 1)
                today_date = datetime.now()
                days_active = max(1, (today_date - start_date).days)
                
                # --- SCIKIT-LEARN PREDICTIVE PACING MODEL ---
                if days_active > 0:
                    X = np.array([[0], [days_active / 2], [days_active]])
                    y = np.array([0, completed_hours * 0.5, completed_hours])
                    
                    model = LinearRegression()
                    model.fit(X, y)
                    
                    # I-predict ang total hours sa pagtatapos ng timeline
                    projected_total_hours = model.predict([[120]])[0]
                else:
                    projected_total_hours = completed_hours

                progress_percentage = min(round((completed_hours / target_hours) * 100), 100)
                
                # UPDATED AT RISK LOGIC: Mas mahigpit para sa pag-test ng mababang oras
                if completed_hours >= target_hours:
                    ai_status = "Completed"
                    risk_reason = "Internship requirements fully satisfied."
                elif completed_hours < 100 and days_active > 30:
                    ai_status = "At Risk"
                    risk_reason = f"Scikit-Learn ML: Low completed hours ({int(completed_hours)}) relative to active days. At risk of missing deadline ({coordinator_deadline})."
                else:
                    ai_status = "On Track"
                    risk_reason = f"Pacing trajectory is aligned with deadline ({coordinator_deadline})."
                record_data = {
                    "id": doc.id,
                    "name": name,
                    "studentId": data.get('studentNumber', doc.id[:7]),
                    "course": data.get('course', 'BSIT'),
                    "section": data.get('section', '403'),
                    "company": data.get('companyName', 'Unassigned'),
                    "progress": progress_percentage,
                    "currentHours": int(completed_hours),
                    "targetHours": target_hours,
                    "deadline": coordinator_deadline,
                    "aiStatus": ai_status,
                    "riskReason": risk_reason
                }

                student_predictions.append(record_data)

                # --- AWTOMATIKONG PAG-SAVE SA FIREBASE 'analytics' COLLECTION ---
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
                    "aiStatus": ai_status,
                    "riskReason": risk_reason,
                    "lastUpdated": firestore.SERVER_TIMESTAMP
                }, merge=True)

                # --- DAGDAG: I-UPDATE DIN ANG 'users' COLLECTION PARA MATAPOS ANG DESCREPANCY ---
                user_doc_ref = db.collection('users').document(doc.id)
                user_doc_ref.set({
                    "internshipStatus": ai_status
                }, merge=True)

        return jsonify({"status": "success", "data": student_predictions})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000, debug=True)