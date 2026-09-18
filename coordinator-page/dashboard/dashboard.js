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
    where,
    setDoc,
    deleteDoc,
    onSnapshot,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// ========================================
// FIREBASE CONFIGURATION
// ========================================

const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};


// ========================================
// INITIALIZE FIREBASE
// ========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// ========================================
// GLOBAL DATA
// ========================================

let allWeeklyReports = [];

let coordinatorExceptions = {};


// ========================================
// NOTIFICATIONS (weekly report submissions)
// ========================================

let studentNameMap = {};

let notifItems = [];

let notifLastSeenAt = 0;

let notifStorageKey = "coordinatorNotifLastSeen";

let notifUnsubscribe = null;


// ========================================
// WEEKLY REPORT PAGINATION
// ========================================

let currentReportPage = 1;
let reportsPerPage = 8;
let filteredWeeklyReports = [];


// ========================================
// PHILIPPINE NATIONAL HOLIDAYS
// ========================================

const philNationalHolidays = {

    "2026-01-01": "New Year's Day",
    "2026-04-02": "Maundy Thursday",
    "2026-04-03": "Good Friday",
    "2026-04-04": "Black Saturday",
    "2026-04-09": "Araw ng Kagitingan",
    "2026-05-01": "Labor Day",
    "2026-06-12": "Independence Day",
    "2026-08-31": "National Heroes Day",
    "2026-11-01": "All Saints' Day",
    "2026-11-02": "All Souls' Day",
    "2026-11-30": "Bonifacio Day",
    "2026-12-25": "Christmas Day",
    "2026-12-30": "Rizal Day"

};


// ========================================
// DOM CONTENT LOADED
// ========================================

document.addEventListener("DOMContentLoaded", () => {

    // ========================================
    // CHECK AUTHENTICATION
    // ========================================

    onAuthStateChanged(auth, async (user) => {

        if (user) {

            try {

                // Fetch Coordinator Profile
                const userDocRef = doc(db, "users", user.uid);
                const userDoc = await getDoc(userDocRef);

                if (userDoc.exists()) {

                    const userData = userDoc.data();

                    updateProfileUI(userData, user);

                } else {

                    updateProfileUI({}, user);

                }


                // ========================================
                // LOAD DASHBOARD DATA
                // ========================================

                loadDashboardStats();

                loadPendingCounts();

                loadOverallProgress();

                loadWeeklyReports();

                startWeeklyReportNotifications(user.uid);


                // ========================================
                // LOAD CALENDAR
                // ========================================

                await loadCalendarExceptions();

                initCoordinatorCalendar();

            } catch (error) {

                console.error(
                    "Error fetching coordinator details:",
                    error
                );

            }

        } else {

            window.location.href =
                "../coordinator_login/coordinator_login.html";

        }

    });


    // ========================================
    // LOGOUT HANDLER
    // ========================================

    const logoutBtn =
        document.getElementById("logoutBtn");

    if (logoutBtn) {

        logoutBtn.addEventListener("click", async (e) => {

            e.preventDefault();

            try {

                await signOut(auth);

                window.location.href =
                    "../coordinator_login/coordinator_login.html";

            } catch (err) {

                console.error(
                    "Logout Error:",
                    err
                );

            }

        });

    }


    // ========================================
    // INITIALIZE UI HANDLERS
    // ========================================

    // Each init runs in its own try/catch so that if one
    // of them throws (e.g. a missing element on some page
    // variant), it doesn't stop the rest from wiring up.

    safeInit(initPendingModalEvents, "initPendingModalEvents");

    safeInit(initReportFilters, "initReportFilters");

    // IMPORTANT:
    // Initialize Weekly Reports Pagination
    safeInit(initReportPagination, "initReportPagination");

    safeInit(initCalendarModalEvents, "initCalendarModalEvents");

    safeInit(initProfileMenu, "initProfileMenu");

    safeInit(initNotificationDropdown, "initNotificationDropdown");

});


function safeInit(fn, label) {

    try {

        fn();

    } catch (error) {

        console.error(`Error running ${label}:`, error);

    }

}


// ========================================
// UPDATE PROFILE UI
// ========================================

function updateProfileUI(userData, authUser) {

    const fullName =
        userData.name ||
        userData.fullName ||
        authUser.displayName ||
        "OJT Coordinator";

    const role =
        userData.role ||
        userData.position ||
        "Coordinator";


    const welcomeName =
        document.getElementById("welcomeName");

    const userName =
        document.getElementById("userName");

    const userRole =
        document.getElementById("userRole");

    const userAvatar =
        document.getElementById("userAvatar");


    if (welcomeName) {

        welcomeName.textContent =
            fullName;

    }


    if (userName) {

        userName.textContent =
            fullName;

    }


    if (userRole) {

        userRole.textContent =
            role.toUpperCase();

    }


    // Profile photo, if the coordinator uploaded
    // one in Account Settings (saved as photoBase64
    // or photoURL), otherwise falls back to initials.
    const photo =
        userData.photoBase64 ||
        userData.photoURL ||
        authUser.photoURL ||
        null;

    paintAvatar(userAvatar, photo, fullName);
    paintAvatar(document.getElementById("menuAvatar"), photo, fullName);


    // Profile dropdown (name + email)
    const menuName =
        document.getElementById("menuName");

    const menuEmail =
        document.getElementById("menuEmail");

    if (menuName) {

        menuName.textContent =
            fullName;

    }

    if (menuEmail) {

        menuEmail.textContent =
            authUser.email || "—";

    }

}


// ========================================
// AVATAR RENDERING
// (shows the saved photo when there is one,
// falls back to initials otherwise)
// ========================================

function paintAvatar(element, photo, name) {

    if (!element) return;

    const initials = (name || "")
        .split(" ")
        .filter(n => n.length > 0)
        .map(n => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase() || "CO";

    if (photo) {

        element.innerHTML = "";

        const img =
            document.createElement("img");

        img.alt = name || "Profile photo";
        img.src = photo;

        // If the stored image is broken, drop back to initials.
        img.onerror = () => {
            element.textContent = initials;
        };

        element.appendChild(img);

    } else {

        element.textContent = initials;

    }

}


// ========================================
// PROFILE DROPDOWN
// ========================================

function initProfileMenu() {

    const trigger =
        document.getElementById("profileMenuTrigger");

    if (!trigger) return;

    trigger.addEventListener("click", (e) => {

        // Clicks on the menu items handle themselves.
        if (e.target.closest(".profile-menu")) return;

        trigger.classList.toggle("open");

        // Close the notification dropdown if it's open.
        document.getElementById("notifBell")
            ?.classList.remove("open");

    });

    document.addEventListener("click", (e) => {

        if (!trigger.contains(e.target)) {
            trigger.classList.remove("open");
        }

    });

    document.addEventListener("keydown", (e) => {

        if (e.key === "Escape") {
            trigger.classList.remove("open");
        }

    });


    // "Account settings" -> go to the settings page.
    const showProfileBtn =
        document.getElementById("showProfileBtn");

    if (showProfileBtn) {

        showProfileBtn.addEventListener("click", () => {

            window.location.href =
                "../settings/settings.html";

        });

    }

}


// ========================================
// NOTIFICATIONS: STUDENT NAME LOOKUP
// ========================================

async function buildStudentNameMap() {

    try {

        const usersRef =
            collection(db, "users");

        const studentQuery =
            query(
                usersRef,
                where("role", "==", "student")
            );

        const snapshot =
            await getDocs(studentQuery);

        const map = {};

        snapshot.forEach((docSnap) => {

            const data = docSnap.data();

            const name =
                data.name ||
                data.fullName ||
                data.email ||
                "A student";

            map[docSnap.id] = name;

            if (data.uid) {
                map[String(data.uid).trim()] = name;
            }

            if (data.email) {
                map[String(data.email).toLowerCase().trim()] = name;
            }

        });

        studentNameMap = map;

    } catch (error) {

        console.error(
            "Error building student name map for notifications:",
            error
        );

    }

}


function getStudentNameForReport(data) {

    const studentId =
        data.userId || data.studentId;

    const possibleEmail =
        (data.email || data.studentEmail || "")
            .toLowerCase()
            .trim();

    return (
        studentNameMap[studentId] ||
        studentNameMap[possibleEmail] ||
        "A student"
    );

}


// ========================================
// NOTIFICATIONS: RELATIVE TIME
// ========================================

function notifTimeAgo(ms) {

    if (!ms) return "";

    const diffSec =
        Math.floor((Date.now() - ms) / 1000);

    if (diffSec < 60) return "Just now";

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;

    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;

    return new Date(ms).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" }
    );

}


// ========================================
// NOTIFICATIONS: RENDER LIST + BADGE
// ========================================

function renderNotifications() {

    const listEl =
        document.getElementById("notifList");

    const badgeEl =
        document.getElementById("notifBadge");

    if (!listEl) return;

    if (notifItems.length === 0) {

        listEl.innerHTML =
            '<div class="notif-empty">No report submissions yet.</div>';

    } else {

        listEl.innerHTML = notifItems.map((item) => {

            const unread =
                item.timestamp > notifLastSeenAt;

            return `
                <div class="notif-item ${unread ? "unread" : ""}" data-report-id="${item.id}">
                    <div class="notif-icon">
                        <i class="fa-solid fa-file-circle-check"></i>
                    </div>
                    <div class="notif-text">
                        <p><strong>${item.studentName}</strong> submitted a weekly report.</p>
                        <span>${notifTimeAgo(item.timestamp)}</span>
                    </div>
                    ${unread ? '<span class="notif-dot"></span>' : ""}
                </div>
            `;

        }).join("");

    }

    const unreadCount =
        notifItems.filter(
            (item) => item.timestamp > notifLastSeenAt
        ).length;

    if (badgeEl) {

        if (unreadCount > 0) {

            badgeEl.textContent =
                unreadCount > 9 ? "9+" : String(unreadCount);

            badgeEl.style.display = "flex";

        } else {

            badgeEl.style.display = "none";

        }

    }

}


function markNotificationsRead() {

    notifLastSeenAt = Date.now();

    try {
        localStorage.setItem(
            notifStorageKey,
            String(notifLastSeenAt)
        );
    } catch (error) {
        console.error("Could not save notif read state:", error);
    }

    renderNotifications();

}


// ========================================
// NOTIFICATIONS: LIVE LISTENER
// Watches the "weekly_reports" collection so
// new student submissions show up right away,
// without needing to refresh the page.
// ========================================

async function startWeeklyReportNotifications(uid) {

    notifStorageKey =
        `coordinatorNotifLastSeen_${uid}`;

    notifLastSeenAt =
        Number(localStorage.getItem(notifStorageKey)) || 0;

    await buildStudentNameMap();

    const reportsRef =
        collection(db, "weekly_reports");

    const notifQuery =
        query(
            reportsRef,
            orderBy("submittedAt", "desc"),
            limit(20)
        );

    if (notifUnsubscribe) {
        notifUnsubscribe();
    }

    notifUnsubscribe = onSnapshot(
        notifQuery,
        (snapshot) => {

            notifItems = snapshot.docs.map((docSnap) => {

                const data = docSnap.data();

                const rawDate = data.submittedAt;

                const timestamp =
                    rawDate?.seconds
                        ? rawDate.seconds * 1000
                        : (rawDate ? new Date(rawDate).getTime() : 0);

                return {
                    id: docSnap.id,
                    studentName: getStudentNameForReport(data),
                    timestamp: timestamp || 0
                };

            });

            renderNotifications();

        },
        (error) => {

            console.error(
                "Error listening for report notifications:",
                error
            );

        }
    );

}


// ========================================
// NOTIFICATIONS: BELL DROPDOWN
// ========================================

function initNotificationDropdown() {

    const bell =
        document.getElementById("notifBell");

    const markBtn =
        document.getElementById("notifMarkReadBtn");

    if (!bell) return;

    bell.addEventListener("click", (e) => {

        if (e.target.closest("#notifMarkReadBtn")) return;

        // Clicking a notification item scrolls to the
        // weekly reports table instead of just toggling.
        const clickedItem = e.target.closest(".notif-item");

        if (clickedItem) {

            bell.classList.remove("open");

            document
                .getElementById("weeklyReportsTableBody")
                ?.closest("table")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });

            return;

        }

        const isOpening =
            !bell.classList.contains("open");

        bell.classList.toggle("open");

        // Close the profile dropdown if it's open.
        document.getElementById("profileMenuTrigger")
            ?.classList.remove("open");

        if (isOpening) {

            renderNotifications();

            // Give the user a moment to see what's new
            // before quietly marking it all as read.
            setTimeout(() => {

                if (bell.classList.contains("open")) {
                    markNotificationsRead();
                }

            }, 1500);

        }

    });

    if (markBtn) {

        markBtn.addEventListener("click", (e) => {

            e.stopPropagation();

            markNotificationsRead();

        });

    }

    document.addEventListener("click", (e) => {

        if (!bell.contains(e.target)) {
            bell.classList.remove("open");
        }

    });

    document.addEventListener("keydown", (e) => {

        if (e.key === "Escape") {
            bell.classList.remove("open");
        }

    });

}


// ========================================
// DASHBOARD STATISTICS
// ========================================

async function loadDashboardStats() {

    try {

        const usersRef =
            collection(db, "users");

        const studentQuery =
            query(
                usersRef,
                where("role", "==", "student")
            );

        const snapshot =
            await getDocs(studentQuery);


        let total = 0;
        let active = 0;
        let completed = 0;
        let atRisk = 0;
        let graduated = 0;


        snapshot.forEach((docSnap) => {

            total++;

            const data =
                docSnap.data();

            /*
                IMPORTANT:
                The AI backend (app.py, /api/predict-risk)
                writes its result to the "internshipStatus"
                field on each user doc - NOT "status" - with
                values: "Completed", "At Risk",
                "Needs Monitoring", "On Track", or
                "Graduated".
            */

            const internshipStatus =
                data.internshipStatus || "";


            if (internshipStatus === "Completed") {

                completed++;

            } else if (internshipStatus === "Graduated") {

                // Graduated na = hindi na dapat mabilang
                // as active pa rin sa OJT.
                graduated++;

            } else {

                // Hindi pa completed/graduated = active
                // pa rin sa OJT (On Track, Needs
                // Monitoring, At Risk, o wala pang status).
                active++;

            }


            if (internshipStatus === "At Risk") {

                atRisk++;

            }

        });


        const totalElem =
            document.getElementById(
                "totalStudentsCount"
            );

        const activeElem =
            document.getElementById(
                "activeStudentsCount"
            );

        const completedElem =
            document.getElementById(
                "completedStudentsCount"
            );

        const atRiskElem =
            document.getElementById(
                "atRiskStudentsCount"
            );

        const graduatedElem =
            document.getElementById(
                "graduatedStudentsCount"
            );


        if (totalElem) {

            totalElem.textContent =
                total;

        }


        if (activeElem) {

            activeElem.textContent =
                active;

        }


        if (completedElem) {

            completedElem.textContent =
                completed;

        }


        if (atRiskElem) {

            atRiskElem.textContent =
                atRisk;

        }


        if (graduatedElem) {

            graduatedElem.textContent =
                graduated;

        }


    } catch (error) {

        console.error(
            "Error loading stats:",
            error
        );

    }

}


// ========================================
// OVERALL PROGRESS
// ========================================

async function loadOverallProgress() {

    try {

        const REQUIRED_HOURS_PER_STUDENT = 600;


        const usersRef =
            collection(db, "users");


        const activeStudentsQuery =
            query(
                usersRef,
                where("role", "==", "student"),
                where("status", "==", "Active")
            );


        const activeSnap =
            await getDocs(
                activeStudentsQuery
            );


        const activeCount =
            activeSnap.size;


        let totalCompletedHours = 0;


        activeSnap.forEach((docSnap) => {

            const data =
                docSnap.data();


            const studentHours =
                Number(
                    data.renderedHours ||
                    data.completedHours ||
                    data.hoursRendered ||
                    0
                );


            totalCompletedHours +=
                studentHours;

        });


        const totalRequiredHours =
            activeCount *
            REQUIRED_HOURS_PER_STUDENT;


        const remainingHours =
            Math.max(
                0,
                totalRequiredHours -
                totalCompletedHours
            );


        const percentage =
            totalRequiredHours > 0
                ? Math.min(
                    100,
                    Math.round(
                        (
                            totalCompletedHours /
                            totalRequiredHours
                        ) * 100
                    )
                )
                : 0;


        const reqElem =
            document.getElementById(
                "totalRequiredHours"
            );

        const compElem =
            document.getElementById(
                "totalCompletedHours"
            );

        const remElem =
            document.getElementById(
                "remainingHours"
            );

        const avgElem =
            document.getElementById(
                "averageCompletionPercent"
            );

        const centerPercentElem =
            document.getElementById(
                "centerProgressPercent"
            );

        const progressBarElem =
            document.getElementById(
                "overallProgressBar"
            );


        if (reqElem) {

            reqElem.textContent =
                `${totalRequiredHours.toLocaleString()} hrs`;

        }


        if (compElem) {

            compElem.textContent =
                `${totalCompletedHours.toLocaleString()} hrs`;

        }


        if (remElem) {

            remElem.textContent =
                `${remainingHours.toLocaleString()} hrs`;

        }


        if (avgElem) {

            avgElem.textContent =
                `${percentage}%`;

        }


        if (centerPercentElem) {

            centerPercentElem.textContent =
                `${percentage}%`;

        }


        if (progressBarElem) {

            progressBarElem.style.strokeDasharray =
                `${percentage}, 100`;

        }


    } catch (error) {

        console.error(
            "Error loading overall progress:",
            error
        );

    }

}


// ========================================
// PENDING COUNTS
// ========================================

async function loadPendingCounts() {

    try {

        const usersRef =
            collection(db, "users");


        const activeUsersQuery =
            query(
                usersRef,
                where("role", "==", "student"),
                where("status", "==", "Active")
            );


        const activeSnap =
            await getDocs(
                activeUsersQuery
            );


        const activeEmails =
            new Set();


        activeSnap.forEach(docSnap => {

            const data =
                docSnap.data();


            if (data.email) {

                activeEmails.add(
                    data.email
                        .toLowerCase()
                        .trim()
                );

            }

        });


        const invitesRef =
            collection(db, "invitations");


        const qInvites =
            query(
                invitesRef,
                where(
                    "status",
                    "in",
                    ["pending", "Pending"]
                )
            );


        const invitesSnap =
            await getDocs(qInvites);


        let realPendingCount = 0;


        invitesSnap.forEach((docSnap) => {

            const inviteEmail =
                (
                    docSnap.data().email ||
                    ""
                )
                .toLowerCase()
                .trim();


            if (!activeEmails.has(inviteEmail)) {

                realPendingCount++;

            }

        });


        const inviteCountElem =
            document.getElementById(
                "pendingInvitationsCount"
            );


        if (inviteCountElem) {

            inviteCountElem.textContent =
                realPendingCount;

        }


        // ========================================
        // SUPERVISOR EVALUATIONS
        // (waiting for supervisor review)
        // ========================================

        const guestEvalRef =
            collection(db, "guestEvaluationAccess");


        const qPendingEvals =
            query(
                guestEvalRef,
                where(
                    "submittedAt",
                    "==",
                    null
                )
            );


        const pendingEvalsSnap =
            await getDocs(qPendingEvals);


        const evalCountElem =
            document.getElementById(
                "supervisorEvaluationsCount"
            );


        if (evalCountElem) {

            evalCountElem.textContent =
                pendingEvalsSnap.size;

        }


    } catch (error) {

        console.error(
            "Error fetching pending counts:",
            error
        );

    }

}


// ========================================
// FETCH PENDING INVITATIONS
// ========================================

async function fetchAndDisplayPendingInvitations() {

    const listContainer =
        document.getElementById(
            "invitationsList"
        );


    if (!listContainer) return;


    listContainer.innerHTML =
        '<tr><td colspan="4" class="text-center">Loading pending items...</td></tr>';


    try {

        let combinedRows = "";

        let count = 0;


        const usersRef =
            collection(db, "users");


        const activeUsersQuery =
            query(
                usersRef,
                where("role", "==", "student"),
                where("status", "==", "Active")
            );


        const activeSnap =
            await getDocs(
                activeUsersQuery
            );


        const activeEmails =
            new Set();


        activeSnap.forEach(docSnap => {

            const data =
                docSnap.data();


            if (data.email) {

                activeEmails.add(
                    data.email
                        .toLowerCase()
                        .trim()
                );

            }

        });


        const invitesRef =
            collection(db, "invitations");


        const qInvites =
            query(
                invitesRef,
                where(
                    "status",
                    "in",
                    ["pending", "Pending"]
                )
            );


        const invitesSnap =
            await getDocs(qInvites);


        invitesSnap.forEach((docSnap) => {

            const data =
                docSnap.data();


            const inviteEmail =
                (
                    data.email ||
                    ""
                )
                .toLowerCase()
                .trim();


            if (!activeEmails.has(inviteEmail)) {

                count++;


                const dateSent =
                    data.createdAt
                        ? new Date(
                            data.createdAt.seconds
                                ? data.createdAt.seconds * 1000
                                : data.createdAt
                        ).toLocaleDateString()
                        : "N/A";


                combinedRows += `
                    <tr>
                        <td>${data.email || "-"}</td>

                        <td>${dateSent}</td>

                        <td>
                            <span class="badge-pending">
                                Invite Sent
                            </span>
                        </td>
                    </tr>
                `;

            }

        });


        if (count === 0) {

            listContainer.innerHTML =
                '<tr><td colspan="4" class="text-center">Walang pending student invitation na nahanap.</td></tr>';

        } else {

            listContainer.innerHTML =
                combinedRows;

        }


        const inviteCountElem =
            document.getElementById(
                "pendingInvitationsCount"
            );


        if (inviteCountElem) {

            inviteCountElem.textContent =
                count;

        }


    } catch (error) {

        console.error(
            "Error loading pending modal list:",
            error
        );


        listContainer.innerHTML =
            '<tr><td colspan="4" class="text-center text-danger">Error loading pending data.</td></tr>';

    }

}


// ========================================
// FETCH PENDING SUPERVISOR EVALUATIONS
// ========================================

async function fetchAndDisplayPendingEvaluations() {

    const listContainer =
        document.getElementById(
            "supervisorEvaluationsList"
        );


    if (!listContainer) return;


    listContainer.innerHTML =
        '<tr><td colspan="4" class="text-center">Loading pending items...</td></tr>';


    try {

        const guestEvalRef =
            collection(db, "guestEvaluationAccess");


        const qPendingEvals =
            query(
                guestEvalRef,
                where(
                    "submittedAt",
                    "==",
                    null
                )
            );


        const pendingEvalsSnap =
            await getDocs(qPendingEvals);


        let combinedRows = "";

        let count = 0;


        pendingEvalsSnap.forEach((docSnap) => {

            const data =
                docSnap.data();


            count++;


            const dateSent =
                data.createdAt
                    ? new Date(
                        data.createdAt.seconds
                            ? data.createdAt.seconds * 1000
                            : data.createdAt
                    ).toLocaleDateString()
                    : "N/A";


            combinedRows += `
                <tr>
                    <td>${data.companyName || "-"}</td>

                    <td>${data.supervisorEmail || "-"}</td>

                    <td>${dateSent}</td>

                    <td>
                        <span class="badge-pending">
                            Awaiting Review
                        </span>
                    </td>
                </tr>
            `;

        });


        if (count === 0) {

            listContainer.innerHTML =
                '<tr><td colspan="4" class="text-center">Walang pending supervisor evaluation na nahanap.</td></tr>';

        } else {

            listContainer.innerHTML =
                combinedRows;

        }


        const evalCountElem =
            document.getElementById(
                "supervisorEvaluationsCount"
            );


        if (evalCountElem) {

            evalCountElem.textContent =
                count;

        }


    } catch (error) {

        console.error(
            "Error loading pending evaluations modal list:",
            error
        );


        listContainer.innerHTML =
            '<tr><td colspan="4" class="text-center text-danger">Error loading pending data.</td></tr>';

    }

}


// ========================================
// PENDING MODAL EVENTS
// ========================================

function initPendingModalEvents() {

    const pendingInviteCard =
        document.getElementById(
            "pendingInviteCard"
        );


    const modal =
        document.getElementById(
            "pendingInvitationsModal"
        );


    const closeModalBtn =
        document.getElementById(
            "closeModalBtn"
        );


    if (pendingInviteCard && modal) {

        pendingInviteCard.addEventListener(
            "click",
            () => {

                modal.style.display =
                    "flex";

                fetchAndDisplayPendingInvitations();

            }
        );

    }


    if (closeModalBtn && modal) {

        closeModalBtn.addEventListener(
            "click",
            () => {

                modal.style.display =
                    "none";

            }
        );

    }


    window.addEventListener(
        "click",
        (e) => {

            if (e.target === modal) {

                modal.style.display =
                    "none";

            }

        }
    );


    // ------------------------------------
    // Supervisor Evaluations card
    // ------------------------------------

    const supervisorEvaluationCard =
        document.getElementById(
            "supervisorEvaluationCard"
        );


    const evalModal =
        document.getElementById(
            "supervisorEvaluationsModal"
        );


    const closeEvalModalBtn =
        document.getElementById(
            "closeSupervisorEvalModalBtn"
        );


    if (supervisorEvaluationCard && evalModal) {

        supervisorEvaluationCard.addEventListener(
            "click",
            () => {

                evalModal.style.display =
                    "flex";

                fetchAndDisplayPendingEvaluations();

            }
        );

    }


    if (closeEvalModalBtn && evalModal) {

        closeEvalModalBtn.addEventListener(
            "click",
            () => {

                evalModal.style.display =
                    "none";

            }
        );

    }


    window.addEventListener(
        "click",
        (e) => {

            if (e.target === evalModal) {

                evalModal.style.display =
                    "none";

            }

        }
    );

}


// ========================================
// LOAD WEEKLY REPORTS
// ========================================

// Ginagawang blangko ang mga placeholder na tulad ng "N/A" o "-"
// para ang live na company sa student profile pa rin ang mauuna
// kahit naka-save nang "N/A" ang lumang value sa report document.
function normalizeCompanyValue(value) {

    if (!value) return "";

    const cleaned = String(value).trim();

    if (
        cleaned === "" ||
        cleaned.toLowerCase() === "n/a" ||
        cleaned === "-"
    ) {
        return "";
    }

    return cleaned;
}

async function loadWeeklyReports() {

    const tableBody =
        document.getElementById(
            "weeklyReportsTableBody"
        );


    if (!tableBody) return;


    try {

        // ========================================
        // FETCH STUDENTS
        // ========================================

        const usersRef =
            collection(db, "users");


        const studentQuery =
            query(
                usersRef,
                where("role", "==", "student")
            );


        const studentsSnap =
            await getDocs(
                studentQuery
            );


        const studentMap = {};
        const studentMapByUid = {};
        const studentMapByEmail = {};
        const studentMapByNumber = {};


        studentsSnap.forEach(docSnap => {

            const sData = docSnap.data();

            studentMap[docSnap.id] =
                sData;

            if (sData.uid) {
                studentMapByUid[
                    String(sData.uid).trim()
                ] = sData;
            }

            if (sData.email) {
                studentMapByEmail[
                    String(sData.email).toLowerCase().trim()
                ] = sData;
            }

            if (sData.studentNumber) {
                studentMapByNumber[
                    String(sData.studentNumber).trim()
                ] = sData;
            }

        });


        // ========================================
        // FETCH WEEKLY REPORTS
        // ========================================

        const reportsRef =
            collection(
                db,
                "weekly_reports"
            );


        const reportsSnap =
            await getDocs(
                reportsRef
            );


        allWeeklyReports = [];


        reportsSnap.forEach(docSnap => {

            const data =
                docSnap.data();


            const studentId =
                data.userId ||
                data.studentId;


            // Unahin hanapin gamit ang "uid" field (siyang tunay
            // na Firebase Auth UID na naka-store sa bawat student
            // profile) dahil posibleng iba ang Firestore document
            // ID kumpara dito.
            let studentInfo =
                studentMapByUid[studentId] ||
                studentMap[studentId] ||
                {};


            // Fallback: kung hindi nahanap gamit ang document ID,
            // subukan hanapin gamit ang email o student number
            // na nakalagay sa report (iba-iba kasi ang reference
            // na ginagamit depende sa pinanggalingang submission).
            if (Object.keys(studentInfo).length === 0) {

                const possibleEmail =
                    data.email ||
                    data.studentEmail ||
                    (typeof studentId === "string" && studentId.includes("@")
                        ? studentId
                        : null);


                if (possibleEmail) {
                    studentInfo =
                        studentMapByEmail[
                            String(possibleEmail).toLowerCase().trim()
                        ] || {};
                }

            }


            if (Object.keys(studentInfo).length === 0) {

                const possibleNumber =
                    data.studentNumber ||
                    data.studentId;


                if (possibleNumber) {
                    studentInfo =
                        studentMapByNumber[
                            String(possibleNumber).trim()
                        ] || {};
                }

            }


            // ========================================
            // DATE
            // ========================================

            let rawDate =
                data.submittedAt ||
                data.createdAt ||
                data.date;


            let formattedDate =
                "N/A";


            let dateTimestamp =
                0;


            if (rawDate) {

                const parsedDate =
                    rawDate.seconds
                        ? new Date(
                            rawDate.seconds * 1000
                        )
                        : new Date(rawDate);


                if (!isNaN(parsedDate)) {

                    dateTimestamp =
                        parsedDate.getTime();


                    formattedDate =
                        parsedDate.toLocaleDateString(
                            "en-US",
                            {
                                month: "short",
                                day: "numeric",
                                year: "numeric"
                            }
                        );

                }

            }


            // ========================================
            // STORE REPORT
            // ========================================

            allWeeklyReports.push({

                id:
                    docSnap.id,

                studentId:
                    studentId,

                reportDate:
                    formattedDate,

                timestamp:
                    dateTimestamp,

                studentName:
                    studentInfo.fullName ||
                    studentInfo.name ||
                    data.studentName ||
                    "Unknown Student",

                studentNumber:
                    studentInfo.studentNumber ||
                    studentInfo.idNumber ||
                    data.studentNumber ||
                    "-",

                section:
                    studentInfo.section ||
                    data.section ||
                    "-",

                company:
                    normalizeCompanyValue(studentInfo.companyName) ||
                    normalizeCompanyValue(studentInfo.company) ||
                    normalizeCompanyValue(data.company) ||
                    "-",

                weekRange:
                    data.weekRange ||
                    data.week ||
                    "Week Report"

            });

        });


        // ========================================
        // RENDER TABLE
        // ========================================

        renderWeeklyReportsTable();


    } catch (error) {

        console.error(
            "Error loading weekly reports:",
            error
        );


        tableBody.innerHTML = `
            <tr>
                <td
                    colspan="6"
                    style="
                        text-align:center;
                        color:#ff5a5f;
                        padding:20px;
                    "
                >
                    Failed to load reports data.
                </td>
            </tr>
        `;

    }

}


// ========================================
// RENDER WEEKLY REPORT TABLE
// WITH PAGINATION
// ========================================

function renderWeeklyReportsTable() {

    const tableBody =
        document.getElementById(
            "weeklyReportsTableBody"
        );


    if (!tableBody) return;


    const sectionFilter =
        document.getElementById(
            "reportSectionFilter"
        )?.value || "all";


    const dateSort =
        document.getElementById(
            "reportDateSort"
        )?.value || "desc";


    const nameSort =
        document.getElementById(
            "reportNameSort"
        )?.value || "default";


    // ========================================
    // FILTER
    // ========================================

    filteredWeeklyReports =
        allWeeklyReports.filter(item => {

            const matchesSection =
                sectionFilter === "all" ||
                item.section
                    .toLowerCase()
                    .includes(
                        sectionFilter.toLowerCase()
                    );


            return matchesSection;

        });


    // ========================================
    // SORT
    // ========================================

    filteredWeeklyReports.sort(
        (a, b) => {

            // ========================================
            // SORT BY: Name (A-Z / Z-A) or Student ID
            // ========================================

            if (nameSort === "name_asc") {

                return a.studentName.localeCompare(
                    b.studentName,
                    "en",
                    { sensitivity: "base" }
                );

            }

            if (nameSort === "name_desc") {

                return b.studentName.localeCompare(
                    a.studentName,
                    "en",
                    { sensitivity: "base" }
                );

            }

            if (nameSort === "student_id") {

                return String(a.studentNumber)
                    .localeCompare(
                        String(b.studentNumber),
                        "en",
                        { numeric: true, sensitivity: "base" }
                    );

            }


            // ========================================
            // DEFAULT: Sort by report date
            // ========================================

            return dateSort === "desc"
                ? b.timestamp - a.timestamp
                : a.timestamp - b.timestamp;

        }
    );


    // ========================================
    // EMPTY DATA
    // ========================================

    if (
        filteredWeeklyReports.length === 0
    ) {

        tableBody.innerHTML = `
            <tr>
                <td
                    colspan="6"
                    style="
                        text-align:center;
                        color:#888;
                        padding:25px;
                    "
                >
                    No weekly reports found based on the selected filter.
                </td>
            </tr>
        `;


        updateReportPagination(
            0,
            0,
            0
        );


        return;

    }


    // ========================================
    // PAGINATION
    // ========================================

    const totalRecords =
        filteredWeeklyReports.length;


    const totalPages =
        Math.ceil(
            totalRecords /
            reportsPerPage
        );


    // Prevent invalid page

    if (
        currentReportPage >
        totalPages
    ) {

        currentReportPage =
            totalPages;

    }


    if (
        currentReportPage < 1
    ) {

        currentReportPage = 1;

    }


    const startIndex =
        (
            currentReportPage - 1
        ) *
        reportsPerPage;


    const endIndex =
        Math.min(
            startIndex +
            reportsPerPage,
            totalRecords
        );


    const pageData =
        filteredWeeklyReports.slice(
            startIndex,
            endIndex
        );


    // ========================================
    // RENDER CURRENT PAGE
    // ========================================

    let rowsHTML = "";


    pageData.forEach(report => {

        rowsHTML += `
            <tr>

                <td>
                    <strong>
                        ${report.reportDate}
                    </strong>
                </td>

                <td>
                    ${report.studentName}
                </td>

                <td>
                    ${report.section}
                </td>

                <td>
                    ${report.company}
                </td>

                <td>

                    <span
                        style="
                            color:#16a34a;
                            font-weight:600;
                        "
                    >

                        <i
                            class="fa-solid fa-circle-check"
                        ></i>

                        ${report.weekRange}

                    </span>

                </td>

                <td>

                    <a
                        href="../../student-page/reportform/weeklyreport.html?studentId=${report.studentId}&reportId=${report.id}"
                        target="_blank"
                        class="btn-view-report"
                    >

                        <i
                            class="fa-regular fa-eye"
                        ></i>

                        View

                    </a>

                </td>

            </tr>
        `;

    });


    tableBody.innerHTML =
        rowsHTML;


    // ========================================
    // UPDATE PAGINATION UI
    // ========================================

    updateReportPagination(
        startIndex + 1,
        endIndex,
        totalRecords
    );

}


// ========================================
// UPDATE PAGINATION UI
// ========================================

function updateReportPagination(
    start,
    end,
    total
) {

    const info =
        document.getElementById(
            "paginationInfo"
        );


    const prevBtn =
        document.getElementById(
            "prevPageBtn"
        );


    const nextBtn =
        document.getElementById(
            "nextPageBtn"
        );


    const pageNumbers =
        document.getElementById(
            "pageNumbers"
        );


    // ========================================
    // SHOWING TEXT
    // ========================================

    if (info) {

        info.textContent =
            total > 0
                ? `Showing ${start} to ${end} of ${total} records`
                : "Showing 0 records";

    }


    // ========================================
    // TOTAL PAGES
    // ========================================

    const totalPages =
        Math.ceil(
            total /
            reportsPerPage
        );


    // ========================================
    // PREVIOUS BUTTON
    // ========================================

    if (prevBtn) {

        prevBtn.disabled =
            currentReportPage <= 1;

    }


    // ========================================
    // NEXT BUTTON
    // ========================================

    if (nextBtn) {

        nextBtn.disabled =
            currentReportPage >=
                totalPages ||
            totalPages === 0;

    }


    // ========================================
    // PAGE NUMBERS
    // ========================================

    if (pageNumbers) {

        pageNumbers.innerHTML =
            "";


        for (
            let i = 1;
            i <= totalPages;
            i++
        ) {

            const btn =
                document.createElement(
                    "button"
                );


            btn.className =
                `page-number ${
                    i === currentReportPage
                        ? "active"
                        : ""
                }`;


            btn.textContent =
                i;


            btn.addEventListener(
                "click",
                () => {

                    currentReportPage =
                        i;

                    renderWeeklyReportsTable();

                }
            );


            pageNumbers.appendChild(
                btn
            );

        }

    }

}


// ========================================
// INITIALIZE PAGINATION CONTROLS
// ========================================

function initReportPagination() {

    const prevBtn =
        document.getElementById(
            "prevPageBtn"
        );


    const nextBtn =
        document.getElementById(
            "nextPageBtn"
        );


    const rowsSelect =
        document.getElementById(
            "rowsPerPageSelect"
        );


    // ========================================
    // PREVIOUS
    // ========================================

    if (prevBtn) {

        prevBtn.addEventListener(
            "click",
            () => {

                if (
                    currentReportPage > 1
                ) {

                    currentReportPage--;

                    renderWeeklyReportsTable();

                }

            }
        );

    }


    // ========================================
    // NEXT
    // ========================================

    if (nextBtn) {

        nextBtn.addEventListener(
            "click",
            () => {

                const totalPages =
                    Math.ceil(
                        filteredWeeklyReports.length /
                        reportsPerPage
                    );


                if (
                    currentReportPage <
                    totalPages
                ) {

                    currentReportPage++;

                    renderWeeklyReportsTable();

                }

            }
        );

    }


    // ========================================
    // ROWS PER PAGE
    // ========================================

    if (rowsSelect) {

        rowsSelect.addEventListener(
            "change",
            (e) => {

                reportsPerPage =
                    parseInt(
                        e.target.value,
                        10
                    );


                // Reset to page 1
                currentReportPage =
                    1;


                renderWeeklyReportsTable();

            }
        );

    }

}


// ========================================
// REPORT FILTERS
// ========================================

function initReportFilters() {

    const sectionFilter =
        document.getElementById(
            "reportSectionFilter"
        );


    const dateSort =
        document.getElementById(
            "reportDateSort"
        );


    const nameSort =
        document.getElementById(
            "reportNameSort"
        );


    // ========================================
    // SECTION FILTER
    // ========================================

    if (sectionFilter) {

        sectionFilter.addEventListener(
            "change",
            () => {

                // Reset pagination
                currentReportPage =
                    1;

                renderWeeklyReportsTable();

            }
        );

    }


    // ========================================
    // DATE SORT
    // ========================================

    if (dateSort) {

        dateSort.addEventListener(
            "change",
            () => {

                // Reset pagination
                currentReportPage =
                    1;

                renderWeeklyReportsTable();

            }
        );

    }


    // ========================================
    // SORT BY (Name A-Z / Z-A / Student ID)
    // ========================================

    if (nameSort) {

        nameSort.addEventListener(
            "change",
            () => {

                // Reset pagination
                currentReportPage =
                    1;

                renderWeeklyReportsTable();

            }
        );

    }

}

// ========================================
// COORDINATOR CALENDAR
// ========================================

let coordinatorCalendarDate =
    new Date();


let selectedCalendarDateStr =
    "";


// ========================================
// LOAD CALENDAR EXCEPTIONS
// ========================================

async function loadCalendarExceptions() {

    try {

        // Built-in holidays

        coordinatorExceptions =
            {
                ...philNationalHolidays
            };


        // Firestore custom entries

        const exceptionsRef =
            collection(
                db,
                "calendar_exceptions"
            );


        const snap =
            await getDocs(
                exceptionsRef
            );


        snap.forEach(docSnap => {

            const data =
                docSnap.data();


            if (data.date) {

                coordinatorExceptions[
                    data.date
                ] =
                    data.reason ||
                    "No Duty / Excused";

            }

        });


    } catch (error) {

        console.error(
            "Error loading calendar exceptions:",
            error
        );

    }

}


// ========================================
// INITIALIZE COORDINATOR CALENDAR
// ========================================

function initCoordinatorCalendar() {

    const calendarGrid =
        document.getElementById(
            "coordinatorCalendarGrid"
        );


    const monthTitle =
        document.getElementById(
            "coordinatorCalendarMonth"
        );


    const prevBtn =
        document.getElementById(
            "coordinatorCalendarPrev"
        );


    const nextBtn =
        document.getElementById(
            "coordinatorCalendarNext"
        );


    if (
        !calendarGrid ||
        !monthTitle
    ) {

        return;

    }


    function renderCalendar() {

        calendarGrid.innerHTML =
            "";


        const year =
            coordinatorCalendarDate
                .getFullYear();


        const month =
            coordinatorCalendarDate
                .getMonth();


        const monthName =
            coordinatorCalendarDate
                .toLocaleString(
                    "en-US",
                    {
                        month: "short"
                    }
                );


        monthTitle.textContent =
            `${monthName} ${year}`;


        const firstDay =
            new Date(
                year,
                month,
                1
            ).getDay();


        const daysInMonth =
            new Date(
                year,
                month + 1,
                0
            ).getDate();


        // Empty days

        for (
            let i = 0;
            i < firstDay;
            i++
        ) {

            const emptyDay =
                document.createElement(
                    "div"
                );


            emptyDay.className =
                "coordinator-calendar-day empty";


            calendarGrid.appendChild(
                emptyDay
            );

        }


        const today =
            new Date();


        const todayDate =
            today.getDate();


        const todayMonth =
            today.getMonth();


        const todayYear =
            today.getFullYear();


        // Calendar days

        for (
            let day = 1;
            day <= daysInMonth;
            day++
        ) {

            const dayElement =
                document.createElement(
                    "div"
                );


            dayElement.className =
                "coordinator-calendar-day";


            dayElement.textContent =
                day;


            const formattedMonth =
                String(
                    month + 1
                ).padStart(
                    2,
                    "0"
                );


            const formattedDay =
                String(
                    day
                ).padStart(
                    2,
                    "0"
                );


            const dateKey =
                `${year}-${formattedMonth}-${formattedDay}`;


            // Exception

            if (
                coordinatorExceptions[
                    dateKey
                ]
            ) {

                dayElement.classList.add(
                    "has-exception"
                );


                dayElement.title =
                    `No Duty: ${
                        coordinatorExceptions[
                            dateKey
                        ]
                    }`;

            }


            // Today

            if (
                day === todayDate &&
                month === todayMonth &&
                year === todayYear
            ) {

                dayElement.classList.add(
                    "today"
                );

            }


            // Click date

            dayElement.addEventListener(
                "click",
                () => {

                    selectedCalendarDateStr =
                        dateKey;


                    const modal =
                        document.getElementById(
                            "coordinatorCalendarModal"
                        );


                    const dateText =
                        document.getElementById(
                            "selectedCalendarDateText"
                        );


                    const reasonInput =
                        document.getElementById(
                            "calendarReasonInput"
                        );


                    const removeBtn =
                        document.getElementById(
                            "removeCalendarExceptionBtn"
                        );


                    const feedbackMsg =
                        document.getElementById(
                            "calendarFeedbackMsg"
                        );


                    if (feedbackMsg) {

                        feedbackMsg.style.display =
                            "none";

                    }


                    if (
                        modal &&
                        dateText &&
                        reasonInput
                    ) {

                        dateText.textContent =
                            `Date: ${monthName} ${day}, ${year}`;


                        reasonInput.value =
                            coordinatorExceptions[
                                dateKey
                            ] || "";


                        if (
                            coordinatorExceptions[
                                dateKey
                            ]
                        ) {

                            removeBtn.style.display =
                                "block";

                        } else {

                            removeBtn.style.display =
                                "none";

                        }


                        modal.style.display =
                            "flex";

                    }

                }
            );


            calendarGrid.appendChild(
                dayElement
            );

        }

    }


    // Previous month

    if (prevBtn) {

        prevBtn.addEventListener(
            "click",
            () => {

                coordinatorCalendarDate.setMonth(
                    coordinatorCalendarDate.getMonth() - 1
                );


                renderCalendar();

            }
        );

    }


    // Next month

    if (nextBtn) {

        nextBtn.addEventListener(
            "click",
            () => {

                coordinatorCalendarDate.setMonth(
                    coordinatorCalendarDate.getMonth() + 1
                );


                renderCalendar();

            }
        );

    }


    renderCalendar();

}


// ========================================
// CALENDAR MODAL EVENTS
// ========================================

function initCalendarModalEvents() {

    const modal =
        document.getElementById(
            "coordinatorCalendarModal"
        );


    const closeBtn =
        document.getElementById(
            "closeCalendarModalBtn"
        );


    const saveBtn =
        document.getElementById(
            "saveCalendarExceptionBtn"
        );


    const removeBtn =
        document.getElementById(
            "removeCalendarExceptionBtn"
        );


    const reasonInput =
        document.getElementById(
            "calendarReasonInput"
        );


    let feedbackMsg =
        document.getElementById(
            "calendarFeedbackMsg"
        );


    // ========================================
    // CREATE FEEDBACK MESSAGE
    // ========================================

    if (
        !feedbackMsg &&
        modal
    ) {

        const bodyDiv =
            modal.querySelector(
                ".modal-body"
            );


        if (bodyDiv) {

            feedbackMsg =
                document.createElement(
                    "div"
                );


            feedbackMsg.id =
                "calendarFeedbackMsg";


            feedbackMsg.style.cssText =
                `
                font-size:12px;
                margin-top:10px;
                padding:8px;
                border-radius:6px;
                text-align:center;
                display:none;
                `;


            bodyDiv.appendChild(
                feedbackMsg
            );

        }

    }


    // ========================================
    // CLOSE BUTTON
    // ========================================

    if (
        closeBtn &&
        modal
    ) {

        closeBtn.addEventListener(
            "click",
            () => {

                modal.style.display =
                    "none";

            }
        );

    }


    // ========================================
    // CLICK OUTSIDE MODAL
    // ========================================

    window.addEventListener(
        "click",
        (e) => {

            if (
                e.target === modal
            ) {

                modal.style.display =
                    "none";

            }

        }
    );


    // ========================================
    // SAVE / UPDATE EXCEPTION
    // ========================================

    if (saveBtn) {

        saveBtn.addEventListener(
            "click",
            async () => {

                const reason =
                    reasonInput.value.trim() ||
                    "No Duty / Excused";


                if (
                    !selectedCalendarDateStr
                ) {

                    return;

                }


                try {

                    const docRef =
                        doc(
                            db,
                            "calendar_exceptions",
                            selectedCalendarDateStr
                        );


                    await setDoc(
                        docRef,
                        {
                            date:
                                selectedCalendarDateStr,

                            reason:
                                reason,

                            updatedAt:
                                new Date()
                        }
                    );


                    coordinatorExceptions[
                        selectedCalendarDateStr
                    ] =
                        reason;


                    if (feedbackMsg) {

                        feedbackMsg.style.display =
                            "block";


                        feedbackMsg.style.background =
                            "#dcfce7";


                        feedbackMsg.style.color =
                            "#166534";


                        feedbackMsg.textContent =
                            "Successfully saved as No Duty!";

                    }


                    initCoordinatorCalendar();


                    setTimeout(
                        () => {

                            modal.style.display =
                                "none";


                            if (feedbackMsg) {

                                feedbackMsg.style.display =
                                    "none";

                            }

                        },
                        1000
                    );


                } catch (err) {

                    console.error(
                        "Error saving calendar exception:",
                        err
                    );


                    if (feedbackMsg) {

                        feedbackMsg.style.display =
                            "block";


                        feedbackMsg.style.background =
                            "#fee2e2";


                        feedbackMsg.style.color =
                            "#991b1b";


                        feedbackMsg.textContent =
                            "Failed to save. Please try again.";

                    }

                }

            }
        );

    }


    // ========================================
    // REMOVE EXCEPTION
    // ========================================

    if (removeBtn) {

        removeBtn.addEventListener(
            "click",
            async () => {

                if (
                    !selectedCalendarDateStr
                ) {

                    return;

                }


                try {

                    const docRef =
                        doc(
                            db,
                            "calendar_exceptions",
                            selectedCalendarDateStr
                        );


                    await deleteDoc(
                        docRef
                    );


                    delete coordinatorExceptions[
                        selectedCalendarDateStr
                    ];


                    if (feedbackMsg) {

                        feedbackMsg.style.display =
                            "block";


                        feedbackMsg.style.background =
                            "#fef3c7";


                        feedbackMsg.style.color =
                            "#92400e";


                        feedbackMsg.textContent =
                            "Successfully cleared date status!";

                    }


                    initCoordinatorCalendar();


                    setTimeout(
                        () => {

                            modal.style.display =
                                "none";


                            if (feedbackMsg) {

                                feedbackMsg.style.display =
                                    "none";

                            }

                        },
                        1000
                    );


                } catch (err) {

                    console.error(
                        "Error deleting calendar exception:",
                        err
                    );


                    if (feedbackMsg) {

                        feedbackMsg.style.display =
                            "block";


                        feedbackMsg.style.background =
                            "#fee2e2";


                        feedbackMsg.style.color =
                            "#991b1b";


                        feedbackMsg.textContent =
                            "Failed to remove. Please try again.";

                    }

                }

            }
        );

    }

}


// ========================================
// STAT CARD POPUPS
//
// Instead of navigating away, each stat
// card loads its own dedicated page inside
// an iframe and shows it as a modal popup
// on top of the dashboard.
// ========================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        /*
            One config entry per popup:
            - card: the clickable stat card
            - modal: the modal-overlay to show/hide
            - frame: the iframe that loads the page
            - closeBtn: the modal's close (x) button
            - src: the page to load inside the iframe
            - closeMessageType: the postMessage "type"
              that page sends when it wants to close
              (e.g. via its own Back to Dashboard button)
        */

        const popupConfigs = [
            {
                card: "registeredStudentsCard",
                modal: "registeredStudentsModal",
                frame: "registeredStudentsFrame",
                closeBtn: "closeRegisteredStudentsModalBtn",
                src: "../registered-students/registered-students.html",
                closeMessageType: "closeRegisteredStudentsModal"
            },
            {
                card: "activeStudentsCard",
                modal: "activeStudentsModal",
                frame: "activeStudentsFrame",
                closeBtn: "closeActiveStudentsModalBtn",
                src: "../active-students/active-students.html",
                closeMessageType: "closeActiveStudentsModal"
            },
            {
                card: "completedStudentsCard",
                modal: "completedStudentsModal",
                frame: "completedStudentsFrame",
                closeBtn: "closeCompletedStudentsModalBtn",
                src: "../completed-students/completed-students.html",
                closeMessageType: "closeCompletedStudentsModal"
            },
            {
                card: "atRiskStudentsCard",
                modal: "atRiskStudentsModal",
                frame: "atRiskStudentsFrame",
                closeBtn: "closeAtRiskStudentsModalBtn",
                src: "../at-risk-students/at-risk-students.html",
                closeMessageType: "closeAtRiskStudentsModal"
            }
        ];


        function openPopup(config) {

            const modal =
                document.getElementById(config.modal);

            const frame =
                document.getElementById(config.frame);

            if (!modal || !frame) {
                return;
            }

            /*
                Set the src only when opening so the
                page (and its Firestore query) loads
                fresh data every time the popup is used.
            */

            frame.src = config.src;

            modal.style.display = "flex";

            document.body.style.overflow = "hidden";

        }


        function closePopup(config) {

            const modal =
                document.getElementById(config.modal);

            const frame =
                document.getElementById(config.frame);

            if (!modal || !frame) {
                return;
            }

            modal.style.display = "none";

            /* Clear the src to stop the iframe's
               work and reset state for next open. */

            frame.src = "about:blank";

            document.body.style.overflow = "";

        }


        popupConfigs.forEach((config) => {

            const card =
                document.getElementById(config.card);

            const modal =
                document.getElementById(config.modal);

            const closeBtn =
                document.getElementById(config.closeBtn);


            if (card) {

                card.addEventListener(
                    "click",
                    () => openPopup(config)
                );

            }


            if (closeBtn) {

                closeBtn.addEventListener(
                    "click",
                    () => closePopup(config)
                );

            }


            if (modal) {

                modal.addEventListener(
                    "click",
                    (e) => {

                        if (e.target === modal) {

                            closePopup(config);

                        }

                    }
                );

            }

        });


        /*
            Listen for a message from inside any of
            the popup iframes (e.g. its own "Back to
            Dashboard" button) asking that popup to
            close.
        */

        window.addEventListener(
            "message",
            (event) => {

                if (!event.data || !event.data.type) {
                    return;
                }

                const matchingConfig =
                    popupConfigs.find(
                        (config) =>
                            config.closeMessageType ===
                            event.data.type
                    );

                if (matchingConfig) {

                    closePopup(matchingConfig);

                }

            }
        );

    }
);