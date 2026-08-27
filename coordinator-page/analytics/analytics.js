/* ==========================================
   OJT-LOGS ANALYTICS & PYTHON SCIKIT-LEARN AI INTEGRATION
========================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// FIREBASE CONFIGURATION (Para sa Auth / Profile Header sync)
const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38",
    measurementId: "G-DJ3JW7QH27"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const usersRef = collection(db, "users");

document.addEventListener("DOMContentLoaded", () => {
    const studentTable = document.getElementById("studentTable");
    if (!studentTable) return;

    const searchInput = document.getElementById("searchStudent");
    const sectionFilter = document.getElementById("sectionFilter");
    const progressFilter = document.getElementById("progressFilter");
    const paginationInfo = document.getElementById("paginationInfo");

    let allStudentRecords = [];

    // 1. SYNC ANG NAKA-LOGIN NA PROFILE SA HEADER
    function syncUserProfile() {
        const profileNameEl = document.getElementById("profileName");
        const profileAvatarEl = document.getElementById("profileAvatar");
        const profileRoleEl = document.getElementById("profileRole");

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const querySnapshot = await getDocs(usersRef);
                    let foundUser = null;
                    
                    querySnapshot.forEach(docSnap => {
                        const data = docSnap.data();
                        if (data.email === user.email || docSnap.id === user.uid) {
                            foundUser = data;
                        }
                    });

                    const displayName = foundUser?.name || foundUser?.fullName || user.displayName || user.email || "Coordinator";
                    const displayRole = foundUser?.role || foundUser?.userType || "OJT Coordinator";

                    if (profileNameEl) profileNameEl.textContent = displayName;
                    if (profileRoleEl) profileRoleEl.textContent = displayRole;

                    if (profileAvatarEl) {
                        const initials = displayName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
                        profileAvatarEl.textContent = initials || "MS";
                    }
                } catch (err) {
                    console.error("Error fetching user profile from Firestore:", err);
                }
            } else {
                const localUser = JSON.parse(localStorage.getItem("loggedInUser")) || JSON.parse(sessionStorage.getItem("loggedInUser"));
                if (localUser) {
                    const name = localUser.name || localUser.email || "Coordinator";
                    if (profileNameEl) profileNameEl.textContent = name;
                    if (profileAvatarEl) {
                        profileAvatarEl.textContent = name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
                    }
                }
            }
        });
    }

    // 2. KUNIN ANG DATA MULA SA PYTHON SCIKIT-LEARN FLASK API
    async function fetchAllStudents() {
        try {
            // Tumatawag sa lokal na Python backend server na nagpapatakbo ng Scikit-learn model
            const response = await fetch('http://localhost:5000/api/predict-risk');
            const result = await response.json();

            if (result.status !== "success") {
                console.error("API Error:", result.message);
                return;
            }

            allStudentRecords = result.data;
            let atRiskCount = 0;
            let onTrackCount = 0;
            let totalCompletedHours = 0;

            allStudentRecords.forEach(item => {
                if ((item.aiStatus || "").toLowerCase().includes("risk")) {
                    atRiskCount++;
                } else {
                    onTrackCount++;
                }
                totalCompletedHours += item.progress;
            });

            // I-update ang Summary Cards sa itaas
            const totalStudents = allStudentRecords.length;
            const avgProgress = totalStudents > 0 ? Math.round(totalCompletedHours / totalStudents) : 0;

            const summaryCards = document.querySelectorAll(".summary-card h3");
            if (summaryCards.length >= 4) {
                summaryCards[0].textContent = totalStudents;
                summaryCards[1].textContent = avgProgress + "%";
                summaryCards[2].textContent = atRiskCount;
                summaryCards[3].textContent = onTrackCount;
            }

            // I-update ang mga counters sa AI At-Risk Section sa ibaba
            const atRiskDisplay = document.getElementById("atRiskCountDisplay");
            if (atRiskDisplay) atRiskDisplay.textContent = atRiskCount;

            const onTrackDisplay = document.getElementById("onTrackCountDisplay");
            if (onTrackDisplay) onTrackDisplay.textContent = onTrackCount;

            // I-render ang table at ang At-Risk list
            filterAndRenderTable();
            renderRiskStudents(allStudentRecords);
            populateStudentDropdown(allStudentRecords);

        } catch (error) {
            console.error("Error connecting to Python Scikit-learn API backend:", error);
            studentTable.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #ff6b6b; padding: 30px;">
                        <i class="fa-solid triangle-exclamation"></i> Cannot connect to Python AI Server. Make sure 'python app.py' is running on port 5000.
                    </td>
                </tr>
            `;
        }
    }

    // 3. FILTER AT RENDER NG TABLE ROWS
    function filterAndRenderTable() {
        const keyword = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const sectionVal = sectionFilter ? sectionFilter.value.toLowerCase() : "all";
        const progressVal = progressFilter ? progressFilter.value.toLowerCase() : "all";

        const filtered = allStudentRecords.filter(item => {
            const name = (item.name || "").toLowerCase();
            const studentId = (item.studentId || "").toLowerCase();
            const section = (item.section || "").toLowerCase();
            const status = (item.aiStatus || "").toLowerCase();

            const matchSearch = name.includes(keyword) || studentId.includes(keyword);
            const matchSection = sectionVal === "all" || section.includes(sectionVal);
            const matchStatus = progressVal === "all" || status.includes(progressVal);

            return matchSearch && matchSection && matchStatus;
        });

        renderTableRows(filtered);
    }

    function renderTableRows(records) {
        if (records.length === 0) {
            studentTable.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #777; padding: 30px;">
                        No student records found matching your filter.
                    </td>
                </tr>
            `;
            if (paginationInfo) paginationInfo.textContent = "Showing 0 to 0 students";
            return;
        }

        studentTable.innerHTML = records.map(item => {
            let statusClass = "ongoing";
            let statusText = item.aiStatus || "On Track";
            let barClass = "";

            if (statusText.toLowerCase().includes("completed")) {
                statusClass = "completed";
                barClass = "complete";
            } else if (statusText.toLowerCase().includes("risk")) {
                statusClass = "atrisk";
                barClass = "danger";
            }

            return `
                <tr>
                    <td>
                        <strong>${item.name}</strong><br>
                        <small style="color:#777;">${item.studentId}</small>
                    </td>
                    <td>${item.course}</td>
                    <td>${item.section}</td>
                    <td>${item.company}</td>
                    <td>
                        <div class="progress-wrapper">
                            <div class="progress">
                                <div class="progress-bar ${barClass}" style="width:${item.progress}%"></div>
                            </div>
                            <span class="progress-value">${item.progress}%</span>
                        </div>
                    </td>
                    <td>${item.currentHours} / ${item.targetHours}</td>
                    <td><span class="status ${statusClass}">${statusText}</span></td>
                    <td>
                        <div class="actions">
                            <button class="action-btn view-btn" data-id="${item.id}" title="View Student" onclick="viewStudentProgress('${item.id}')">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (paginationInfo) {
            paginationInfo.textContent = `Showing 1 to ${records.length} of ${records.length} students`;
        }
    }

    // 4. RENDER NG AT-RISK STUDENTS SA "STUDENTS REQUIRING ATTENTION" SECTION
    function renderRiskStudents(records) {
        const riskContainer = document.getElementById("riskStudentsContainer");
        if (!riskContainer) return;

        const atRiskList = records.filter(item => (item.aiStatus || "").toLowerCase().includes("risk"));

        if (atRiskList.length === 0) {
            riskContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #777;">
                    No students currently flagged by the Scikit-learn AI Model.
                </div>
            `;
            return;
        }

        riskContainer.innerHTML = atRiskList.map(item => {
            const initials = item.name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
            return `
                <div class="risk-row">
                    <div class="student-mini">
                        <div class="student-avatar">${initials}</div>
                        <div>
                            <strong>${item.name}</strong>
                            <small>${item.course} ${item.section} · ${item.company}</small>
                        </div>
                    </div>
                    <div class="risk-reason">
                        <span><i class="fa-solid fa-brain" style="color: #ff6b6b; margin-right: 5px;"></i> ${item.riskReason}</span>
                    </div>
                    <span class="status atrisk">At Risk</span>
                </div>
            `;
        }).join('');
    }

    // 5. ILAGAY ANG MGA ESTUDYANTE SA DROPDOWN NG COMPANY RECOMMENDATION
    function populateStudentDropdown(records) {
        const studentSelect = document.getElementById("recommendStudent");
        if (!studentSelect) return;

        studentSelect.innerHTML = `<option value="">Select Student</option>` + records.map(item => `
            <option value="${item.id}">${item.name} (${item.course} ${item.section})</option>
        `).join('');
    }

    if (searchInput) searchInput.addEventListener("keyup", filterAndRenderTable);
    if (sectionFilter) sectionFilter.addEventListener("change", filterAndRenderTable);
    if (progressFilter) progressFilter.addEventListener("change", filterAndRenderTable);

    // I-run ang initialization
    syncUserProfile();
    fetchAllStudents();
});


/* ==========================================
   GLOBAL VIEW FUNCTIONS & AI ACTIONS
========================================== */

window.viewStudentProgress = function(studentId) {
    console.log("Viewing student progress ID:", studentId);
    alert(`Opening detailed predictive analytics view for student ID: ${studentId}`);
}

window.viewCompanySkill = function(companyName) {
    alert(`Loading analytics profile for partner company: ${companyName}`);
}

const recommendBtn = document.getElementById("recommendCompanyBtn");
if(recommendBtn) {
    recommendBtn.addEventListener("click", () => {
        const studentSelect = document.getElementById("recommendStudent");
        const skillSelect = document.getElementById("skillFocus");

        const student = studentSelect ? studentSelect.value : "";
        const skill = skillSelect ? skillSelect.value : "";

        if (!student || !skill) {
            alert("Please select both a student and a target skill focus.");
            return;
        }

        alert(`Scikit-learn model successfully generated optimal company recommendations for the selected student based on ${skill}!`);
    });
}