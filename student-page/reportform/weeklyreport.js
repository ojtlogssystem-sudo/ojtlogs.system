import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query,
    where,
    onSnapshot,
    doc,
    getDoc,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);

// Global state variables
let currentUserId = null;
let currentLogs = [];
let calculatedTotalHours = 0;

document.addEventListener("DOMContentLoaded", () => {
    // 1. Kuhanin ang studentId at reportId mula sa URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const targetStudentId = urlParams.get("studentId");

    const submitBtn = document.getElementById("btn-submit-report");
    const backBtn = document.getElementById("btn-back-report"); // Dynamic Back Button

    onAuthStateChanged(auth, async (user) => {
        const tableBody = document.getElementById("report-table-body");
        if (!user) {
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">
                            Please log in to view your report.
                        </td>
                    </tr>
                `;
            }
            return;
        }

        // 2. Suriin ang role ng naka-login na user sa Firestore
        let isCoordinator = false;
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
                const role = userDocSnap.data().role || "";
                if (role.toLowerCase() === "coordinator") {
                    isCoordinator = true;
                }
            }
        } catch (err) {
            console.error("Error fetching user role:", err);
        }

        // 3. TUKUYIN ANG DAPAT I-LOAD NA USER ID:
        const activeStudentUid = targetStudentId || user.uid;
        currentUserId = activeStudentUid;
        await loadStudentReportInformation(activeStudentUid);

        // 4. ITAGO ANG SUBMIT REPORT BUTTON SA COORDINATOR
        if (submitBtn) {
            if (isCoordinator || targetStudentId) {
                submitBtn.style.display = "none";
            } else {
                submitBtn.style.display = "flex";
            }
        }

        // 5. SETUP DYNAMIC BACK BUTTON NAVIGATION
        if (backBtn) {
            backBtn.addEventListener("click", (e) => {
                e.preventDefault();
                if (isCoordinator || targetStudentId) {
                    window.location.href = "/coordinator-page/dashboard/dashboard.html";
                } else {
                    window.location.href = "/student-page/tasks/tasks.html";
                }
            });
        }

        // Load Report Data mula sa Firestore
        loadAccomplishmentReport(activeStudentUid);
    });

    // Event Listener sa Submit Button
    if (submitBtn) {
        submitBtn.addEventListener("click", submitWeeklyReport);
    }
});

// ========================================
// LOAD STUDENT DETAILS FOR WEEKLY REPORT
// ========================================
async function loadStudentReportInformation(userId) {
    try {
        const studentRef = doc(db, "users", userId);
        const studentSnap = await getDoc(studentRef);

        if (!studentSnap.exists()) {
            console.error("Student details not found.");
            return;
        }

        const studentData = studentSnap.data();

        // Get the actual student details from Firebase
        const studentName = studentData.fullName || studentData.name;
        const studentSection = studentData.section;
        const companyName = studentData.companyName || studentData.company;

        // Display Name
        const nameElement = document.getElementById("report-student-name");
        if (nameElement) {
            nameElement.textContent = studentName || "";
        }

        // Display Section
        const sectionElement = document.getElementById("report-section");
        if (sectionElement) {
            sectionElement.textContent = studentSection || "";
        }

        // Display Company Name
        const companyElement = document.getElementById("report-company");
        if (companyElement) {
            companyElement.textContent = companyName || "";
        }

    } catch (error) {
        console.error("Error loading student report information:", error);
    }
}

function loadAccomplishmentReport(userId) {
    const tableBody = document.getElementById("report-table-body");
    if (!tableBody) return;

    const attendanceRef = collection(db, "attendance");
    const q = query(attendanceRef, where("userId", "==", userId));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 20px; color: #6b7280;">
                        No logs found in database.
                    </td>
                </tr>
            `;
            updateTotalHours(0);
            currentLogs = [];
            return;
        }

        let logs = [];
        snapshot.forEach((docSnap) => {
            logs.push({ id: docSnap.id, ...docSnap.data() });
        });

        logs.sort((a, b) => parseDocDate(a) - parseDocDate(b));
        currentLogs = logs; // i-save sa global array para sa submission

        let html = "";
        let totalHoursAcc = 0;

        logs.forEach((log) => {
            const dateStr = log.formattedDate || log.date || "N/A";
            const timeIn = log.timeIn || "--:--";
            const timeOut = log.timeOut || "--:--";
            
            const accomplishmentHTML = getAccomplishmentHTML(log);
            const hoursRendered = calculateHours(timeIn, timeOut);
            totalHoursAcc += hoursRendered;

            html += `
                <tr>
                    <td style="text-align: center;">${escapeHtml(dateStr)}</td>
                    <td style="text-align: center;">${escapeHtml(timeIn)}</td>
                    <td style="text-align: center;">${escapeHtml(timeOut)}</td>
                    <td style="text-align: left;">${accomplishmentHTML}</td>
                    <td style="text-align: center;">${hoursRendered > 0 ? hoursRendered.toFixed(1) + " hrs" : "0 hrs"}</td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;
        updateTotalHours(totalHoursAcc);

    }, (error) => {
        console.error("Firestore Error:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 20px; color: #ef4444;">
                    Error loading report: ${error.message}
                </td>
            </tr>
        `;
    });
}

// Function para mai-submit ang Accomplishment Report sa Coordinator Dashboard
async function submitWeeklyReport() {
    const submitBtn = document.getElementById("btn-submit-report");
    const statusEl = document.getElementById("submit-status");

    if (!currentUserId) {
        alert("Unable to detect logged-in user. Please re-login.");
        return;
    }

    if (!currentLogs || currentLogs.length === 0) {
        alert("No logs available to submit.");
        return;
    }

    try {
        submitBtn.disabled = true;
        submitBtn.innerText = "Submitting...";
        statusEl.style.color = "#6b7280";
        statusEl.innerText = "Processing submission...";

        // 1. Kuhanin ang profile details ng kasalukuyang user
        let userData = {
            fullName: "Student",
            section: "BSIT 401",
            company: "-",
            supervisor: "-"
        };

        const userDocRef = doc(db, "users", currentUserId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const u = userDocSnap.data();
            userData = {
                fullName: u.fullName || u.name || "Student",
                section: u.section || "BSIT 401",
                company: u.company || "-",
                supervisor: u.supervisor || "-"
            };
        }
        

        // 2. Kunin ang pinaka-unang petsa at pinakahuling petsa para sa Week Range
        const firstDate = currentLogs[0].formattedDate || currentLogs[0].date || "N/A";
        const lastDate = currentLogs[currentLogs.length - 1].formattedDate || currentLogs[currentLogs.length - 1].date || "N/A";
        const weekRangeText = `${firstDate} - ${lastDate}`;

        // 3. I-save sa `weekly_reports` collection
        const reportsRef = collection(db, "weekly_reports");
        await addDoc(reportsRef, {
            userId: currentUserId,
            studentName: userData.fullName,
            section: userData.section,
            company: userData.company,
            supervisor: userData.supervisor,
            totalHours: calculatedTotalHours,
            weekRange: weekRangeText,
            logsCount: currentLogs.length,
            status: "Submitted",
            submittedAt: serverTimestamp()
        });

        await addDoc(collection(db, "logs"), {
            type: "weekly_report",
            action: "Weekly Report Added",
            title: "Weekly Report Added",
            description: `${userData.fullName} added a weekly report.`,
            studentName: userData.fullName,
            company: userData.company,
            weekRange: weekRangeText,
            timestamp: serverTimestamp()
        });

        submitBtn.style.background = "#15803d";
        submitBtn.innerText = "Submitted!";
        statusEl.style.color = "#16a34a";
        statusEl.innerText = "Report submitted successfully to coordinator!";

        alert("Weekly report successfully submitted to coordinator!");

    } catch (err) {
        console.error("Submission Error:", err);
        submitBtn.disabled = false;
        submitBtn.innerText = "Submit Report";
        statusEl.style.color = "#ef4444";
        statusEl.innerText = "Failed to submit report.";
        alert("Failed to submit report: " + err.message);
    }
}

function getAccomplishmentHTML(logData) {
    if (Array.isArray(logData.taskList) && logData.taskList.length > 0) {
        let listItems = logData.taskList.map(item => {
            const title = item.title ? `<strong>${escapeHtml(item.title)}:</strong> ` : "";
            const desc = item.description ? escapeHtml(item.description) : "";
            return `<li>${title}${desc}</li>`;
        }).join("");

        return `<ul style="margin: 0; padding-left: 18px;">${listItems}</ul>`;
    }

    if (logData.tasks && typeof logData.tasks === "string") {
        if (logData.tasks.includes("|")) {
            const items = logData.tasks.split("|").map(t => t.trim()).filter(Boolean);
            return `<ul style="margin: 0; padding-left: 18px;">` + 
                items.map(item => `<li>${escapeHtml(item)}</li>`).join("") + 
                `</ul>`;
        }
        return `<ul style="margin: 0; padding-left: 18px;"><li>${escapeHtml(logData.tasks)}</li></ul>`;
    }

    return "<em>No accomplishment logged.</em>";
}

function calculateHours(timeIn, timeOut) {
    if (!timeIn || !timeOut || timeIn === "--:--" || timeOut === "--:--") return 0;

    try {
        const parseTime = (timeStr) => {
            const match = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM)?/i);
            if (!match) return null;

            let hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const modifier = match[3];

            if (modifier) {
                if (modifier.toUpperCase() === "PM" && hours < 12) hours += 12;
                if (modifier.toUpperCase() === "AM" && hours === 12) hours = 0;
            }
            return hours * 60 + minutes;
        };

        const start = parseTime(timeIn);
        const end = parseTime(timeOut);
        
        if (start === null || end === null) return 0;

        let diff = end - start;
        if (diff < 0) diff += 24 * 60; 

        return Math.round((diff / 60) * 10) / 10;
    } catch (e) {
        return 0;
    }
}

function updateTotalHours(totalHours) {
    calculatedTotalHours = totalHours; // Itabi sa global variable
    const totalEl = document.getElementById("total-hours-cell");
    if (totalEl) {
        totalEl.textContent = `${totalHours.toFixed(1)} hrs`;
    }
}

function parseDocDate(log) {
    if (log.createdAt?.toDate) return log.createdAt.toDate();
    if (log.date) {
        const parts = log.date.split('-');
        if (parts.length === 3) {
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }
    }
    return new Date(0);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");
}