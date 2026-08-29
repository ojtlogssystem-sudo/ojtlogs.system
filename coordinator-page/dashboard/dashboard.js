import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc,
    collection,
    getDocs,
    query,
    where 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase Configuration (OJT-LOGS)
const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global memory store para sa filtering
let allWeeklyReports = [];

document.addEventListener("DOMContentLoaded", () => {

    // 1. Check Authentication State
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                // Fetch Coordinator Profile details
                const userDocRef = doc(db, "users", user.uid);
                const userDoc = await getDoc(userDocRef);

                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    updateProfileUI(userData, user);
                } else {
                    updateProfileUI({}, user);
                }

                // Fetch Dynamic Dashboard Data
                loadDashboardStats();
                loadPendingCounts();
                loadOverallProgress();
                loadWeeklyReports();
                loadRecentActivities();

            } catch (error) {
                console.error("Error fetching coordinator details:", error);
            }
        } else {
            window.location.href = "../coordinator_login/coordinator_login.html";
        }
    });

    // 2. Logout Handler
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                window.location.href = "../coordinator_login/coordinator_login.html";
            } catch (err) {
                console.error("Logout Error:", err);
            }
        });
    }

    // Initialize UI Handlers
    initPendingModalEvents();
    initReportFilters();
})

// Update Profile UI
function updateProfileUI(userData, authUser) {
    const fullName = userData.name || userData.fullName || authUser.displayName || "OJT Coordinator";
    const role = userData.role || userData.position || "Coordinator";
    const welcomeName = document.getElementById("welcomeName");
    const userName = document.getElementById("userName");
    const userRole = document.getElementById("userRole");
    const userAvatar = document.getElementById("userAvatar");

    if (welcomeName) welcomeName.textContent = fullName;
    if (userName) userName.textContent = fullName;
    if (userRole) userRole.textContent = role.toUpperCase();

    if (userAvatar) {
        const initials = fullName
            .split(" ")
            .filter(n => n.length > 0)
            .map(n => n[0])
            .join("")
            .substring(0, 2)
            .toUpperCase();
        userAvatar.textContent = initials || "CO";
    }
}

// Fetch Dynamic Counts for Main Cards
async function loadDashboardStats() {
    try {
        const usersRef = collection(db, "users");
        const studentQuery = query(usersRef, where("role", "==", "student"));
        const snapshot = await getDocs(studentQuery);

        let total = 0;
        let active = 0;
        let completed = 0;
        let atRisk = 0;

        snapshot.forEach((docSnap) => {
            total++;
            const data = docSnap.data();
            
            if (data.status === "Completed") {
                completed++;
            } else if (data.status === "At-Risk") {
                atRisk++;
            } else if (data.status === "Active") {
                active++;
            }
        });

        const totalElem = document.getElementById("totalStudentsCount");
        const activeElem = document.getElementById("activeStudentsCount");
        const completedElem = document.getElementById("completedStudentsCount");
        const atRiskElem = document.getElementById("atRiskStudentsCount");

        if (totalElem) totalElem.textContent = total;
        if (activeElem) activeElem.textContent = active;
        if (completedElem) completedElem.textContent = completed;
        if (atRiskElem) atRiskElem.textContent = atRisk;

    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

// Compute & Display Overall Progress
async function loadOverallProgress() {
    try {
        const REQUIRED_HOURS_PER_STUDENT = 600;

        const usersRef = collection(db, "users");
        const activeStudentsQuery = query(
            usersRef, 
            where("role", "==", "student"), 
            where("status", "==", "Active")
        );
        
        const activeSnap = await getDocs(activeStudentsQuery);
        const activeCount = activeSnap.size;

        let totalCompletedHours = 0;

        activeSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const studentHours = Number(data.renderedHours || data.completedHours || data.hoursRendered || 0);
            totalCompletedHours += studentHours;
        });

        const totalRequiredHours = activeCount * REQUIRED_HOURS_PER_STUDENT;
        const remainingHours = Math.max(0, totalRequiredHours - totalCompletedHours);
        
        const percentage = totalRequiredHours > 0 
            ? Math.min(100, Math.round((totalCompletedHours / totalRequiredHours) * 100)) 
            : 0;

        // UI Updates
        const reqElem = document.getElementById("totalRequiredHours");
        const compElem = document.getElementById("totalCompletedHours");
        const remElem = document.getElementById("remainingHours");
        const avgElem = document.getElementById("averageCompletionPercent");
        const centerPercentElem = document.getElementById("centerProgressPercent");
        const progressBarElem = document.getElementById("overallProgressBar");

        if (reqElem) reqElem.textContent = `${totalRequiredHours.toLocaleString()} hrs`;
        if (compElem) compElem.textContent = `${totalCompletedHours.toLocaleString()} hrs`;
        if (remElem) remElem.textContent = `${remainingHours.toLocaleString()} hrs`;
        if (avgElem) avgElem.textContent = `${percentage}%`;
        if (centerPercentElem) centerPercentElem.textContent = `${percentage}%`;

        if (progressBarElem) {
            progressBarElem.style.strokeDasharray = `${percentage}, 100`;
        }

    } catch (error) {
        console.error("Error loading overall progress:", error);
    }
}

// Fetch Pending Counts
async function loadPendingCounts() {
    try {
        const usersRef = collection(db, "users");
        const activeUsersQuery = query(usersRef, where("role", "==", "student"), where("status", "==", "Active"));
        const activeSnap = await getDocs(activeUsersQuery);
        
        const activeEmails = new Set();
        activeSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.email) activeEmails.add(data.email.toLowerCase().trim());
        });

        const invitesRef = collection(db, "invitations");
        const qInvites = query(invitesRef, where("status", "in", ["pending", "Pending"]));
        const invitesSnap = await getDocs(qInvites);

        let realPendingCount = 0;
        invitesSnap.forEach((docSnap) => {
            const inviteEmail = (docSnap.data().email || "").toLowerCase().trim();
            if (!activeEmails.has(inviteEmail)) {
                realPendingCount++;
            }
        });

        const inviteCountElem = document.getElementById("pendingInvitationsCount");
        if (inviteCountElem) inviteCountElem.textContent = realPendingCount;

    } catch (error) {
        console.error("Error fetching pending counts:", error);
    }
}

// Fetch Pending Invitations for Modal Display
async function fetchAndDisplayPendingInvitations() {
    const listContainer = document.getElementById("invitationsList");
    if (!listContainer) return;

    listContainer.innerHTML = '<tr><td colspan="4" class="text-center">Loading pending items...</td></tr>';

    try {
        let combinedRows = "";
        let count = 0;

        const usersRef = collection(db, "users");
        const activeUsersQuery = query(usersRef, where("role", "==", "student"), where("status", "==", "Active"));
        const activeSnap = await getDocs(activeUsersQuery);
        
        const activeEmails = new Set();
        activeSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.email) activeEmails.add(data.email.toLowerCase().trim());
        });

        const invitesRef = collection(db, "invitations");
        const qInvites = query(invitesRef, where("status", "in", ["pending", "Pending"]));
        const invitesSnap = await getDocs(qInvites);

        invitesSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const inviteEmail = (data.email || "").toLowerCase().trim();

            if (!activeEmails.has(inviteEmail)) {
                count++;
                const dateSent = data.createdAt 
                    ? new Date(data.createdAt.seconds ? data.createdAt.seconds * 1000 : data.createdAt).toLocaleDateString() 
                    : "N/A";

                combinedRows += `
                    <tr>
                        <td>${data.email || "-"}</td>
                        <td>${dateSent}</td>
                        <td><span class="badge-pending">Invite Sent</span></td>
                    </tr>
                `;
            }
        });

        if (count === 0) {
            listContainer.innerHTML = '<tr><td colspan="4" class="text-center">Walang pending student invitation na nahanap.</td></tr>';
        } else {
            listContainer.innerHTML = combinedRows;
        }

        const inviteCountElem = document.getElementById("pendingInvitationsCount");
        if (inviteCountElem) inviteCountElem.textContent = count;

    } catch (error) {
        console.error("Error loading pending modal list:", error);
        listContainer.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error loading pending data.</td></tr>';
    }
}

function initPendingModalEvents() {
    const pendingInviteCard = document.getElementById("pendingInviteCard");
    const modal = document.getElementById("pendingInvitationsModal");
    const closeModalBtn = document.getElementById("closeModalBtn");

    if (pendingInviteCard && modal) {
        pendingInviteCard.addEventListener("click", () => {
            modal.style.display = "flex";
            fetchAndDisplayPendingInvitations();
        });
    }

    if (closeModalBtn && modal) {
        closeModalBtn.addEventListener("click", () => {
            modal.style.display = "none";
        });
    }

    window.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
        }
    });
}

// Fetch Weekly Reports Connected to Firebase Firestore
async function loadWeeklyReports() {
    const tableBody = document.getElementById("weeklyReportsTableBody");
    if (!tableBody) return;

    try {
        // 1. Fetch Students Map for Course, Section, and Company mapping
        const usersRef = collection(db, "users");
        const studentQuery = query(usersRef, where("role", "==", "student"));
        const studentsSnap = await getDocs(studentQuery);

        const studentMap = {};
        studentsSnap.forEach(docSnap => {
            studentMap[docSnap.id] = docSnap.data();
        });

        // 2. Fetch Weekly Reports from Firestore
        const reportsRef = collection(db, "weekly_reports");
        const reportsSnap = await getDocs(reportsRef);

        allWeeklyReports = [];

        reportsSnap.forEach(docSnap => {
            const data = docSnap.data();
            const studentId = data.userId || data.studentId;
            const studentInfo = studentMap[studentId] || {};

            let rawDate = data.submittedAt || data.createdAt || data.date;
            let formattedDate = "N/A";
            let dateTimestamp = 0;

            if (rawDate) {
                const parsedDate = rawDate.seconds ? new Date(rawDate.seconds * 1000) : new Date(rawDate);
                if (!isNaN(parsedDate)) {
                    dateTimestamp = parsedDate.getTime();
                    formattedDate = parsedDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    });
                }
            }

            allWeeklyReports.push({
                id: docSnap.id,
                studentId: studentId,
                reportDate: formattedDate,
                timestamp: dateTimestamp,
                studentName: studentInfo.fullName || studentInfo.name || data.studentName || "Unknown Student",
                course: studentInfo.course || data.course || "BSIT",
                section: studentInfo.section || data.section || "N/A",
                company: studentInfo.companyName || studentInfo.company || data.company || "N/A",
                weekRange: data.weekRange || data.week || "Week Report",
            });
        });

        // 3. Render Table
        renderWeeklyReportsTable();

    } catch (error) {
        console.error("Error loading weekly reports:", error);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ff5a5f; padding: 20px;">Failed to load reports data.</td></tr>`;
    }
}

// Render Function
function renderWeeklyReportsTable() {
    const tableBody = document.getElementById("weeklyReportsTableBody");
    if (!tableBody) return;

    const courseFilter = document.getElementById("reportCourseFilter")?.value || "all";
    const sectionFilter = document.getElementById("reportSectionFilter")?.value || "all";
    const dateSort = document.getElementById("reportDateSort")?.value || "desc";

    // Filter Data
    let filteredData = allWeeklyReports.filter(item => {
        const matchesCourse = courseFilter === "all" || item.course.toLowerCase().includes(courseFilter.toLowerCase());
        const matchesSection = sectionFilter === "all" || item.section.toLowerCase().includes(sectionFilter.toLowerCase());
        return matchesCourse && matchesSection;
    });

    // Sort Data (Latest Report Date -> Oldest Report Date as Default)
    filteredData.sort((a, b) => {
        return dateSort === "desc" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
    });

    // Populate Table HTML
    if (filteredData.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: #888; padding: 25px;">
                    Walang nakatala na weekly report batay sa filter.
                </td>
            </tr>
        `;
        return;
    }

    let rowsHTML = "";
    filteredData.forEach(report => {
        rowsHTML += `
            <tr>
                <td><strong>${report.reportDate}</strong></td>
                <td>${report.studentName}</td>
                <td>${report.course}</td>
                <td>${report.section}</td>
                <td>${report.company}</td>
                <td><span style="color: #16a34a; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ${report.weekRange}</span></td>
                <td>
                    <a href="../../student-page/reportform/weeklyreport.html?studentId=${report.studentId}&reportId=${report.id}" target="_blank" class="btn-view-report">
                        <i class="fa-regular fa-eye"></i> View
                    </a>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = rowsHTML;
}

// Filter Change Listeners
function initReportFilters() {
    const courseFilter = document.getElementById("reportCourseFilter");
    const sectionFilter = document.getElementById("reportSectionFilter");
    const dateSort = document.getElementById("reportDateSort");

    if (courseFilter) courseFilter.addEventListener("change", renderWeeklyReportsTable);
    if (sectionFilter) sectionFilter.addEventListener("change", renderWeeklyReportsTable);
    if (dateSort) dateSort.addEventListener("change", renderWeeklyReportsTable);
}

async function loadRecentActivities() {
    const container = document.getElementById("recentActivityList");
    if (!container) return;

    let activities = [];

    // ==========================================
    // 1. TRY TO GET REAL LOGS FROM FIREBASE
    // ==========================================
    try {

        const logsRef = collection(db, "logs");
        const logsSnap = await getDocs(logsRef);

        logsSnap.forEach((docSnap) => {

            const data = docSnap.data();

            let iconClass = "fa-solid fa-clock";
            let typeClass = "blue";

            // TIME IN
            if (
                data.type === "time_in" ||
                data.action === "Time In"
            ) {
                iconClass = "fa-solid fa-right-to-bracket";
                typeClass = "green";

            } else if (
                data.type === "time_out" ||
                data.action === "Time Out"
            ) {
                iconClass = "fa-solid fa-right-from-bracket";
                typeClass = "orange";

            } else if (
                data.type === "registration" ||
                data.action === "Sign Up"
            ) {
                iconClass = "fa-solid fa-user-plus";
                typeClass = "blue";

            } else if (
                data.type === "login" ||
                data.action === "Login"
            ) {
                iconClass = "fa-solid fa-right-to-bracket";
                typeClass = "blue";

            } else if (
                data.type === "weekly_report" ||
                data.action === "Weekly Report Added"
            ) {
                iconClass = "fa-solid fa-file-lines";
                typeClass = "blue";

            } else if (
                data.type === "evaluation" ||
                data.action === "Supervisor Evaluation Completed"
            ) {
                iconClass = "fa-solid fa-clipboard-check";
                typeClass = "green";
            }

            // LOGIN
            else if (
                data.type === "login" ||
                data.action === "Login"
            ) {
                iconClass = "fa-solid fa-right-to-bracket";
                typeClass = "blue";
            }

            // EVALUATION
            else if (
                data.type === "evaluation" ||
                data.action === "Evaluation Completed" ||
                data.action === "Supervisor Evaluation Completed"
            ) {
                iconClass = "fa-solid fa-clipboard-check";
                typeClass = "green";
            }

            // WEEKLY REPORT
            else if (
                data.type === "weekly_report" ||
                data.action === "Weekly Report Added"
            ) {
                iconClass = "fa-solid fa-file-lines";
                typeClass = "blue";
            }

            // DATE / TIME
            let timeText = "Just now";
            let rawTimestamp = 0;

            if (data.timestamp || data.createdAt) {

                const rawTime =
                    data.timestamp || data.createdAt;

                const dateObj = rawTime.seconds
                    ? new Date(rawTime.seconds * 1000)
                    : new Date(rawTime);

                if (!isNaN(dateObj.getTime())) {

                    rawTimestamp = dateObj.getTime();

                    timeText =
                        dateObj.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit"
                        });
                }
            }

            activities.push({
                title:
                    data.title ||
                    data.action ||
                    "System Activity",

                desc:
                    data.description ||
                    data.message ||
                    `${data.studentName || "A student"} performed an action`,

                time: timeText,

                type: typeClass,

                icon: iconClass,

                rawTimestamp: rawTimestamp
            });
        });

    } catch (error) {

        console.error(
            "Could not read logs collection:",
            error
        );

        // Don't stop the dashboard.
        // We'll use sample activities below.
        activities = [];
    }

    // ==========================================
    // 3. LATEST FIRST
    // ==========================================
    activities.sort(
        (a, b) =>
            b.rawTimestamp - a.rawTimestamp
    );


    // ==========================================
    // 4. ONLY SHOW 4 LATEST
    // ==========================================
    activities = activities.slice(0, 4);

    if (activities.length === 0) {
        container.innerHTML = `
            <div style="
                text-align: center;
                color: #888;
                font-size: 11.5px;
                padding: 15px 0;
            ">
                <i
                    class="fa-solid fa-info-circle"
                    style="
                        margin-bottom: 5px;
                        font-size: 14px;
                        display: block;
                    "
                ></i>

                No system activities recorded yet.
            </div>
        `;

        return;
    }
    // ==========================================
    // 5. DISPLAY
    // ==========================================
    let html = "";

    activities.forEach((activity) => {

        html += `
            <div class="activity-item">

                <div class="activity-icon icon-${activity.type}">
                    <i class="${activity.icon}"></i>
                </div>

                <div class="activity-details">

                    <h5>
                        ${activity.title}
                    </h5>

                    <p>
                        ${activity.desc}
                    </p>

                    <span class="activity-time">
                        ${activity.time}
                    </span>

                </div>

            </div>
        `;
    });

    container.innerHTML = html;
}