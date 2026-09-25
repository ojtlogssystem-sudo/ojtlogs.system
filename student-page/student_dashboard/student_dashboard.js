import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc,
    collection, 
    query, 
    where, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { loadHeader, updateHeaderCompletionEstimate } from "../templated/header-loader.js";

const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let studentRequiredHours = 600;
let calendarController = null;

// Same default used by ojt-deadline.js (settings/ojtDeadline +
// users/{uid}.deadlineDate) kapag wala pa talagang na-set kahit saan.
const FALLBACK_DEADLINE = "2026-12-31";

// "YYYY-MM-DD" (o Firestore Timestamp) -> "Dec 31, 2026". Mirrors
// formatDeadline() sa ojt-deadline.js pero mas maikli para bagay sa
// maliit na "Completion Date" box.
function formatCompletionDate(value) {
    if (!value) return "--/----";

    const raw = (value && typeof value.toDate === "function")
        ? value.toDate()
        : new Date(`${String(value).slice(0, 10)}T00:00:00`);

    if (Number.isNaN(raw.getTime())) return "--/----";

    return raw.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

// Ito yung actual deadline na sine-set ng coordinator (Settings > OJT
// Deadline), hindi yung AI-projected estimate na nasa header pill.
function updateCompletionDateUI(deadlineDate) {
    const detailItems = document.querySelectorAll(".detail-item strong");
    if (detailItems.length >= 3) {
        detailItems[2].textContent = formatCompletionDate(deadlineDate);
    }
}

// Converts an exact decimal hours value (e.g. 31.816666...) into an exact
// "Xh Ym" string (e.g. "31h 49m") by rounding only to the nearest minute,
// never to the nearest 0.1 hour. Used for the "Hours Completed" display so
// it always matches the true logged time down to the minute.
function hoursToHM(hoursFloat) {
    const totalMinutes = Math.round((hoursFloat || 0) * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m}m`;
}

/* ==========================================
   INITIAL LOADING OVERLAY
   Naka-block ito sa buong dashboard hanggang
   matapos ang unang loadStudentData() fetch at
   ang unang onSnapshot() ng attendance/activity
   listeners. Dito lang dapat makikita ng user
   ang totoong Hours Completed, Status, Today's
   Attendance, at Recent Activity — hindi na yung
   mga default/placeholder na "Loading...", "0
   hours", "--".
========================================== */
function hideDashboardLoadingOverlay() {
    const overlay = document.getElementById("dashboard-loading-overlay");
    if (!overlay || overlay.dataset.hidden === "true") return;
    overlay.dataset.hidden = "true";
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 300);
}

document.addEventListener("DOMContentLoaded", async () => {
    // Safety net: kung sakaling matagal ang koneksyon o may error na
    // hindi na-catch sa fetch/listener chain, huwag hayaang ma-stuck ang
    // user sa loading screen magpakailanman — itago pa rin pagkalipas ng
    // ilang segundo.
    setTimeout(() => {
        const overlay = document.getElementById("dashboard-loading-overlay");
        if (overlay && overlay.dataset.hidden !== "true") {
            console.warn("Dashboard loading overlay auto-hidden after timeout — check network/Firestore.");
            hideDashboardLoadingOverlay();
        }
    }, 15000);

    const modalOverlay = document.getElementById("activities-modal-overlay");
    if (modalOverlay) {
        modalOverlay.classList.remove("show");
    }

    fetch("../templated/sidebar.html")
        .then(response => response.ok ? response.text() : "")
        .then(html => {
            const sidebarContainer = document.getElementById("sidebar-container");
            if (sidebarContainer && html) sidebarContainer.innerHTML = html;
            initSidebar("Dashboard");
        })
        .catch(err => console.error("Error loading sidebar:", err));

    // Header markup (bell, avatar, dropdowns) is injected async, so anything
    // that targets its elements has to wait for it to finish loading first.
    // autoLoadProfile lets the shared header module populate the avatar
    // (including profile photo) and name straight from Firestore, the same
    // way every other page (e.g. Performance) already does it. The header
    // module also owns the notification bell/panel on its own — no per-page
    // wiring needed, so the dashboard no longer keeps its own duplicate copy.
    await loadHeader("Dashboard", { autoLoadProfile: true });

    initModalFetchAndLoad();
    calendarController = initCalendar();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadStudentData(user);
            // Hintayin munang dumating ang UNANG snapshot ng attendance at
            // activity listeners (hindi lang yung isang beses na profile
            // fetch) bago tanggalin ang loading overlay — dito pa lang
            // dapat makikita ng user ang totoong Today's Attendance at
            // Recent Activity, hindi na yung mga "--"/"Loading..." default.
            await Promise.all([
                listenToStudentAttendance(user.uid),
                listenToActivities(user.uid)
            ]).finally(hideDashboardLoadingOverlay);
        } else {
            window.location.href = "../student_login/student_login.html";
        }
    });
});

async function loadStudentData(user) {
    try {
        let fullName = user.displayName || localStorage.getItem("user_fullname") || "";
        let student = {};

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            student = userSnap.data();

            if (student.lastName && student.firstName) {
                fullName = `${student.lastName} ${student.firstName} ${student.middleName || ''}`.trim();
            } else if (student.fullName || student.name) {
                fullName = student.fullName || student.name;
            }
        }

        let displayStatus = student.internshipStatus || "Active - On Track";

        try {
            const analyticsRef = doc(db, "analytics", user.uid);
            const analyticsSnap = await getDoc(analyticsRef);

            if (analyticsSnap.exists()) {
                const analyticsData = analyticsSnap.data();
                if (analyticsData.aiStatus) {
                    displayStatus = analyticsData.aiStatus;
                }
            }
        } catch (err) {
            console.warn("Could not fetch AI analytics status:", err);
        }

        if (!fullName) fullName = "Student Intern";

        // Avatar initials, dropdown name, and localStorage caching are now
        // handled by the shared header module (updateHeaderProfile via
        // autoLoadProfile) so the dashboard header stays connected/in sync
        // with the rest of the app instead of duplicating that logic here.

        studentRequiredHours = student.requiredHours || 600;
        const compHours = student.completedHours || 0;
        const remainingHours = Math.max(0, studentRequiredHours - compHours);
        const percentage = Math.min(100, Math.round((compHours / studentRequiredHours) * 100));

        updateHoursUI(compHours, studentRequiredHours, remainingHours, percentage);

        // Coordinator-set OJT deadline (global "Apply to all students" or a
        // per-student override) — same field na binabasa ng Flask AI para
        // sa at-risk projection. Ito na ngayon yung nasa "Completion Date".
        updateCompletionDateUI(student.deadlineDate || FALLBACK_DEADLINE);

        const statusElem = document.querySelector(".status-text");
        const statusHeader = document.querySelector(".summary-card.purple h2");

        // Same icon set as the coordinator's AI At-Risk cards (analytics.html):
        // fa-triangle-exclamation = At Risk, fa-eye = Needs Monitoring,
        // fa-circle-check = On Track / Completed. Dati "fa-shield-halved"
        // lang palagi ito - ngayon nagpapalit na base sa aiStatus.
        const statusIconBox = document.querySelector(".summary-card.purple .card-icon");
        const statusIcon = statusIconBox ? statusIconBox.querySelector("i") : null;

        function setStatusIcon(iconClass, colorClass) {
            if (statusIconBox) {
                statusIconBox.classList.remove("green-icon", "blue-icon", "orange-icon", "purple-icon", "red-icon", "pink-icon");
                statusIconBox.classList.add(colorClass);
            }
            if (statusIcon) statusIcon.className = iconClass;
        }

        if (statusElem) statusElem.textContent = displayStatus;

        if (statusHeader) {
            if (displayStatus.toLowerCase().includes("risk")) {
                statusHeader.textContent = "At Risk";
                statusHeader.style.color = "#ab0a0a";
                if (statusElem) statusElem.style.color = "#ab0a0a";
                setStatusIcon("fa-solid fa-triangle-exclamation", "red-icon");
            } else if (displayStatus.toLowerCase().includes("monitoring")) {
                statusHeader.textContent = "Needs Monitoring";
                statusHeader.style.color = "#f59e0b";
                if (statusElem) statusElem.style.color = "#f59e0b";
                setStatusIcon("fa-solid fa-eye", "orange-icon");
            } else if (displayStatus.toLowerCase().includes("completed")) {
                statusHeader.textContent = "Completed";
                statusHeader.style.color = "#22c55e";
                setStatusIcon("fa-solid fa-circle-check", "green-icon");
            } else {
                statusHeader.textContent = "On Track";
                statusHeader.style.color = "#3b82f6";
                setStatusIcon("fa-solid fa-circle-check", "green-icon");
            }
        }
    } catch (error) {
        console.error("Error fetching student profile:", error);
    }
}

function calculateHoursFromTime(timeIn, timeOut) {
    if (!timeIn || !timeOut || timeIn === "--" || timeOut === "--") return 0;
    try {
        const parseToMinutes = (timeStr) => {
            let parts = timeStr.trim().split(" ");
            let time = parts[0];
            let modifier = parts[1] ? parts[1].toUpperCase() : "";
            let [hours, minutes] = time.split(":").map(Number);

            if (modifier === "PM" && hours < 12) hours += 12;
            if (modifier === "AM" && hours === 12) hours = 0;
            return (hours * 60) + (minutes || 0);
        };

        const inMinutes = parseToMinutes(timeIn);
        const outMinutes = parseToMinutes(timeOut);

        if (outMinutes <= inMinutes) return 0;
        return (outMinutes - inMinutes) / 60;
    } catch (e) {
        console.error("Error parsing time string:", e);
        return 0;
    }
}

function listenToStudentAttendance(userId) {
    const attendanceQuery = query(collection(db, "attendance"), where("userId", "==", userId));

    // Ang listener mismo ay tuloy-tuloy (onSnapshot), pero ibinabalik natin
    // ito bilang Promise na nare-resolve sa UNANG snapshot lang, para may
    // mahintay ang caller (loading overlay) bago ipakita ang totoong data.
    let resolveFirstSnapshot;
    const firstSnapshotReady = new Promise((resolve) => { resolveFirstSnapshot = resolve; });

    onSnapshot(attendanceQuery, async (snapshot) => {
        let todayTimeIn = "--";
        let todayTimeOut = "--";
        let todayRendered = "0h 0m";
        let todayStatus = "";
        let totalCompletedMinutes = 0; // exact minutes, matching attendance_details.js's calculateOverview()
        const dailyHoursMap = {};

        // Dates the student was auto-marked "Absent" (status: "Absent",
        // written by attendance.js's checkAndMarkAbsences() for any missed
        // scheduled duty day). Same records/logic the coordinator's
        // Attendance page counts, so this is the accurate source of truth
        // instead of guessing from the calendar/holidays alone.
        const absentDatesMap = {};

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const todayDateStr = `${year}-${month}-${day}`;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            let netMinutes = 0;

            // Mirror attendance_details.js's calculateOverview() exactly, so the
            // student dashboard's total always matches the coordinator's total:
            // parse the actual net minutes (break already deducted, NOT capped
            // to 0/8) out of the todayHours string attendance.js saved, e.g.
            // "7h 40m (Under 8 Hours, 1hr break deducted)" -> 7h 40m, counted
            // in full even though it's under 8 hours. hoursRendered is only a
            // 0-or-8 pass/fail flag for attendance status, not a true hours
            // total, so it's never used here for the sum. Everything is kept
            // in whole minutes (not float hours) until the very end, so there's
            // no rounding drift between this total and the coordinator's.
            // Rejected ng coordinator = hindi binibilang ang oras ng araw na iyon.
            const isRejectedDay = String(data.status || "").toLowerCase() === "rejected";

            if (data.date && String(data.status || "").toLowerCase() === "absent") {
                absentDatesMap[data.date] = true;
            }

            if (isRejectedDay) {
                netMinutes = 0;
            } else if (data.todayHours) {
                const matchHours = data.todayHours.match(/(\d+)\s*h/i);
                const matchMins = data.todayHours.match(/(\d+)\s*m/i);
                if (matchHours) netMinutes += parseInt(matchHours[1]) * 60;
                if (matchMins) netMinutes += parseInt(matchMins[1]);
            } else if (data.timeIn && data.timeOut && data.timeOut !== "--") {
                // Fallback for older records saved before todayHours existed:
                // recreate the same net (break-deducted) figure manually.
                const rawHours = calculateHoursFromTime(data.timeIn, data.timeOut);
                netMinutes = Math.max(0, Math.round(rawHours * 60) - 60);
            } else if (data.hoursRendered) {
                netMinutes = Math.round((parseFloat(data.hoursRendered) || 0) * 60);
            }

            const dailyHours = netMinutes / 60;
            totalCompletedMinutes += netMinutes;

            // Track completed hours per calendar date (e.g. "2026-01-01" -> 8)
            // so the calendar can show how many hours were rendered on a
            // given duty day, and so we can project a completion date below.
            if (data.date && dailyHours > 0) {
                dailyHoursMap[data.date] = (dailyHoursMap[data.date] || 0) + dailyHours;
            }

            if (data.date === todayDateStr) {
                if (data.timeIn) todayTimeIn = data.timeIn;
                if (data.timeOut && data.timeOut.trim() !== "") todayTimeOut = data.timeOut;
                if (data.status) todayStatus = data.status;

                if (todayTimeIn !== "--" && todayTimeOut !== "--") {
                    if (data.todayHours) {
                        // Use the string attendance.js already formatted, which
                        // reflects the 1-hour break deduction (e.g. "8h 0m (1hr break deducted)").
                        todayRendered = data.todayHours;
                    } else {
                        // Fallback for older records without todayHours saved:
                        // apply the same 1-hour break deduction manually.
                        let rawHours = calculateHoursFromTime(todayTimeIn, todayTimeOut);
                        let netMinutes = Math.max(0, Math.round(rawHours * 60) - 60);
                        let hrs = Math.floor(netMinutes / 60);
                        let mins = netMinutes % 60;
                        todayRendered = `${hrs}h ${mins}m`;
                    }
                }
            }
        });

        updateTodayAttendanceUI(todayTimeIn, todayTimeOut, todayRendered, todayStatus);

        // Exact hours completed, kept at full precision (no 0.1-hour
        // rounding) so "Hours Completed" can be displayed down to the
        // minute (e.g. "31h 49m") instead of a lossy "31.8 hours".
        const completedHoursExact = totalCompletedMinutes / 60;
        const remainingHours = Math.max(0, studentRequiredHours - completedHoursExact);
        const percentage = Math.min(100, Math.round((completedHoursExact / studentRequiredHours) * 100));

        updateHoursUI(completedHoursExact, studentRequiredHours, remainingHours, percentage);

        // Push the per-day hours into the calendar so duty days display how
        // many hours were rendered that day (e.g. "8h" under Jan 1).
        if (calendarController) {
            calendarController.setDailyHours(dailyHoursMap);
            calendarController.setAbsentDates(absentDatesMap);
        }

        // AI-style projection of the OJT completion date, based on the
        // student's own average hours-per-duty-day so far.
        const estimate = estimateCompletionDate(completedHoursExact, studentRequiredHours, dailyHoursMap);
        updateHeaderCompletionEstimate(estimate);

        try {
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, { completedHours: completedHoursExact });
        } catch (updateErr) {
            console.warn("Could not sync completed hours to profile:", updateErr);
        }

        // Resolving an already-resolved Promise is a no-op, so this is safe
        // to call on every subsequent snapshot too — only the first call
        // actually matters to callers awaiting firstSnapshotReady.
        resolveFirstSnapshot();
    });

    return firstSnapshotReady;
}

/* ==========================================
   AI COMPLETION-DATE ESTIMATE
   Projects when the student will hit their required hours by
   extrapolating from their own historical average hours logged
   per duty day, then counting forward on weekdays only (Mon-Fri).
   This is a lightweight heuristic run in the browser — not a
   call to an external AI model — surfaced to the user as an
   "AI suggestion" pill in the header.
========================================== */
function estimateCompletionDate(completedHours, requiredHours, dailyHoursMap) {
    if (completedHours >= requiredHours) {
        return { completed: completedHours, required: requiredHours, remaining: 0, isDone: true, estimatedDate: null };
    }

    const remainingHours = Math.max(0, requiredHours - completedHours);
    const workedDates = Object.keys(dailyHoursMap).filter(d => dailyHoursMap[d] > 0);

    if (workedDates.length === 0) {
        return { completed: completedHours, required: requiredHours, remaining: remainingHours, isDone: false, estimatedDate: null };
    }

    const totalLoggedHours = workedDates.reduce((sum, d) => sum + dailyHoursMap[d], 0);
    const avgHoursPerDutyDay = totalLoggedHours / workedDates.length;

    if (!avgHoursPerDutyDay || avgHoursPerDutyDay <= 0) {
        return { completed: completedHours, required: requiredHours, remaining: remainingHours, isDone: false, estimatedDate: null };
    }

    const dutyDaysNeeded = Math.ceil(remainingHours / avgHoursPerDutyDay);

    // Walk forward from today, only counting Mon-Fri as duty days.
    // (Swap this for a lookup against the coordinator's holiday/exception
    // calendar if OJT can also happen on weekends for some students.)
    const projected = new Date();
    let dutyDaysCounted = 0;
    while (dutyDaysCounted < dutyDaysNeeded) {
        projected.setDate(projected.getDate() + 1);
        const dayOfWeek = projected.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            dutyDaysCounted++;
        }
    }

    const estimatedDate = projected.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });

    return {
        completed: completedHours,
        required: requiredHours,
        remaining: remainingHours,
        avgHoursPerDay: avgHoursPerDutyDay,
        dutyDaysLogged: workedDates.length,
        isDone: false,
        estimatedDate
    };
}

/* ==========================================
   NOTIFICATIONS
   Handled entirely by the shared header module
   (../templated/header-loader.js -> loadNotifications),
   which loadHeader() already calls automatically.
   The dashboard no longer keeps its own duplicate
   listener/renderer for #notification-list /
   #notification-badge.
========================================== */

function updateHoursUI(completed, required, remaining, percentage) {
    // "Hours Completed" is shown as an exact "Xh Ym" string (rounded only to
    // the nearest minute), never as a rounded decimal like "31.8 hours".
    const completedLabel = hoursToHM(completed);
    // Remaining/required stay in decimal-hours form (unaffected by this
    // change); only rounded here for a tidy display, not in the underlying
    // calculation used for percentage/estimates.
    const remainingDisplay = Math.round(remaining * 10) / 10;

    const completedHeader = document.querySelector(".summary-card.green h2");
    if (completedHeader) completedHeader.textContent = completedLabel;

    const progressFill = document.querySelector(".green-fill");
    if (progressFill) progressFill.style.width = `${percentage}%`;

    const completedSpan = document.querySelector(".summary-card.green span");
    if (completedSpan) completedSpan.textContent = `${percentage}% of required hours`;

    const requiredHeader = document.querySelector(".summary-card.blue h2");
    if (requiredHeader) requiredHeader.textContent = `${required} hours`;

    const remainingSub = document.querySelector(".card-sub");
    if (remainingSub) remainingSub.textContent = `${remainingDisplay} hours remaining`;

    const circlePercentage = document.querySelector(".circle h1");
    if (circlePercentage) circlePercentage.textContent = `${percentage}%`;

    const circleBg = document.querySelector(".circle");
    if (circleBg) circleBg.style.background = `conic-gradient(#22c55e ${percentage}%, #ececec 0)`;

    const detailItems = document.querySelectorAll(".detail-item strong");
    if (detailItems.length >= 2) {
        detailItems[0].textContent = completedLabel;
        detailItems[1].textContent = `${remainingDisplay} hrs`;
    }

    const requiredBoxVal = document.querySelector(".required-value");
    if (requiredBoxVal) requiredBoxVal.textContent = required;
}

function updateTodayAttendanceUI(timeIn, timeOut, totalToday, status = "") {
    const timeInElem = document.getElementById("today-timein-val");
    if (timeInElem) timeInElem.textContent = timeIn;

    const timeOutElem = document.getElementById("today-timeout-val");
    if (timeOutElem) timeOutElem.textContent = timeOut;

    const totalTodayElem = document.getElementById("total-rendered-today");
    // totalToday can arrive as "8h 1m (1hr break deducted)" straight from
    // attendance.js's saved todayHours string. Strip the parenthetical for
    // display only — the raw value/Firestore record is untouched, so the
    // coordinator-side parsing elsewhere that reads the same field still works.
    if (totalTodayElem) {
        totalTodayElem.textContent = String(totalToday).replace(/\s*\([^)]*\)\s*$/, "").trim();
    }

    const timeinBox = document.getElementById("timein-box");
    const timeinIcon = document.getElementById("timein-icon");
    const timeinTitle = document.getElementById("timein-title");
    const timeinDesc = document.getElementById("timein-desc");

    const timeoutBox = document.getElementById("timeout-box");
    const timeoutIcon = document.getElementById("timeout-icon");
    const timeoutTitle = document.getElementById("timeout-title");
    const timeoutDesc = document.getElementById("timeout-desc");

    if (status.toLowerCase() === "excused") {
        if (timeinBox) timeinBox.className = "attendance-box blue-box";
        if (timeinIcon) timeinIcon.className = "fa-solid fa-circle-info";
        if (timeinTitle) timeinTitle.textContent = "Excused";
        if (timeinDesc) timeinDesc.textContent = "You have an approved excuse today.";

        if (timeoutBox) timeoutBox.className = "attendance-box blue-box";
        if (timeoutIcon) timeoutIcon.className = "fa-solid fa-circle-info";
        if (timeoutTitle) timeoutTitle.textContent = "Excused";
        if (timeoutDesc) timeoutDesc.textContent = "No time out required.";
        return;
    }

    const hasTimedIn = timeIn && timeIn !== "--";
    const hasTimedOut = timeOut && timeOut !== "--";

    if (hasTimedOut) {
        if (timeinBox) timeinBox.className = "attendance-box green-box";
        if (timeinIcon) timeinIcon.className = "fa-solid fa-circle-check";
        if (timeinTitle) timeinTitle.textContent = "Timed In";
        if (timeinDesc) timeinDesc.textContent = "You timed in today.";

        if (timeoutBox) timeoutBox.className = "attendance-box green-box";
        if (timeoutIcon) timeoutIcon.className = "fa-solid fa-circle-check";
        if (timeoutTitle) timeoutTitle.textContent = "Timed Out";
        if (timeoutDesc) timeoutDesc.textContent = "You timed out today.";
    } else if (hasTimedIn) {
        if (timeinBox) timeinBox.className = "attendance-box green-box";
        if (timeinIcon) timeinIcon.className = "fa-solid fa-circle-check";
        if (timeinTitle) timeinTitle.textContent = "Timed In";
        if (timeinDesc) timeinDesc.textContent = "You timed in today.";

        if (timeoutBox) timeoutBox.className = "attendance-box orange-box";
        if (timeoutIcon) timeoutIcon.className = "fa-regular fa-clock";
        if (timeoutTitle) timeoutTitle.textContent = "Pending Time Out";
        if (timeoutDesc) timeoutDesc.textContent = "Don't forget to time out.";
    } else {
        if (timeinBox) timeinBox.className = "attendance-box orange-box";
        if (timeinIcon) timeinIcon.className = "fa-regular fa-clock";
        if (timeinTitle) timeinTitle.textContent = "Time In";
        if (timeinDesc) timeinDesc.textContent = "You haven't timed in yet.";

        if (timeoutBox) timeoutBox.className = "attendance-box orange-box";
        if (timeoutIcon) timeoutIcon.className = "fa-regular fa-clock";
        if (timeoutTitle) timeoutTitle.textContent = "Time Out";
        if (timeoutDesc) timeoutDesc.textContent = "Waiting for time in.";
    }
}

/* ==========================================
   RECENT ACTIVITY + "VIEW ALL" MODAL
   One live Firestore subscription feeds BOTH the 3-item preview
   on the dashboard card and the full list inside the modal, so
   the two can never drift apart or double-charge reads.
========================================== */
const RECENT_ACTIVITY_LIMIT = 3;
let allActivityLogs = [];

function listenToActivities(userId) {
    const attendanceQuery = query(collection(db, "attendance"), where("userId", "==", userId));

    // Same pattern as listenToStudentAttendance(): the listener keeps
    // running, but the returned Promise resolves once, on the first
    // snapshot, so the caller can wait for real activity data.
    let resolveFirstSnapshot;
    const firstSnapshotReady = new Promise((resolve) => { resolveFirstSnapshot = resolve; });

    onSnapshot(attendanceQuery, (snapshot) => {
        const logs = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            if (data.timeIn) {
                logs.push({
                    title: "Time In Recorded",
                    subtitle: `${data.date || "Recent"} \u2022 ${data.timeIn}`,
                    type: "timein",
                    durationText: "Logged In",
                    sortDate: data.date || "",
                    sortTime: data.timeIn || ""
                });
            }

            if (data.timeOut && data.timeOut !== "--") {
                let sessionHoursText = "Completed";
                if (data.todayHours) {
                    // Reuse the exact string attendance.js saved (break already deducted),
                    // stripping the "(1hr break deducted)" parenthetical for display only —
                    // the raw Firestore field itself stays untouched.
                    sessionHoursText = String(data.todayHours).replace(/\s*\([^)]*\)\s*$/, "").trim();
                } else if (data.timeIn) {
                    const rawHours = calculateHoursFromTime(data.timeIn, data.timeOut);
                    const netMinutes = Math.max(0, Math.round(rawHours * 60) - 60);
                    sessionHoursText = `${Math.floor(netMinutes / 60)}h ${netMinutes % 60}m`;
                }

                logs.push({
                    title: "Time Out Recorded",
                    subtitle: `${data.date || "Recent"} \u2022 ${data.timeOut}`,
                    type: "timeout",
                    durationText: sessionHoursText,
                    sortDate: data.date || "",
                    sortTime: data.timeOut || ""
                });
            }
        });

        // Newest first; Time Out sits above its own Time In on the same day.
        logs.sort((a, b) => {
            const dateDiff = new Date(b.sortDate) - new Date(a.sortDate);
            if (dateDiff !== 0 && !isNaN(dateDiff)) return dateDiff;
            if (a.type === b.type) return 0;
            return a.type === "timeout" ? -1 : 1;
        });

        allActivityLogs = logs;

        renderActivityList(
            document.getElementById("recent-activity-list"),
            logs.slice(0, RECENT_ACTIVITY_LIMIT)
        );

        // Keep the modal in sync if it happens to be open right now.
        const modalOverlay = document.getElementById("activities-modal-overlay");
        if (modalOverlay && modalOverlay.classList.contains("show")) {
            renderActivityList(document.getElementById("all-activities-list"), logs);
        }

        resolveFirstSnapshot();
    });

    return firstSnapshotReady;
}

function renderActivityList(listEl, activities) {
    if (!listEl) return;

    if (!activities || activities.length === 0) {
        listEl.innerHTML = `
            <div class="activity-item">
                <div class="activity-info">
                    <h4>No activity history found</h4>
                    <p>Your records will appear here.</p>
                </div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = "";

    activities.forEach(act => {
        const item = document.createElement("div");
        item.className = "activity-item";

        let iconClass = "fa-solid fa-right-to-bracket";
        let colorClass = "green";

        if (act.type === "timeout") {
            iconClass = "fa-solid fa-right-from-bracket";
            colorClass = "blue";
        } else if (act.type === "task") {
            iconClass = "fa-solid fa-list-check";
            colorClass = "blue";
        } else if (act.type === "photo") {
            iconClass = "fa-solid fa-camera";
            colorClass = "orange";
        }

        item.innerHTML = `
            <div class="activity-icon ${colorClass}">
                <i class="${iconClass}"></i>
            </div>
            <div class="activity-info">
                <h4>${act.title}</h4>
                <p>${act.subtitle}</p>
            </div>
            <span class="activity-duration">${act.durationText}</span>
        `;

        listEl.appendChild(item);
    });
}

function initModalFetchAndLoad() {
    const viewAllBtn = document.getElementById("view-all-btn");
    const modalOverlay = document.getElementById("activities-modal-overlay");
    const explicitCloseBtn = document.getElementById("explicit-close-btn");

    const openModal = () => {
        if (!modalOverlay) return;
        modalOverlay.classList.add("show");
        document.body.style.overflow = "hidden";
        renderActivityList(document.getElementById("all-activities-list"), allActivityLogs);
    };

    const closeModal = () => {
        if (!modalOverlay) return;
        modalOverlay.classList.remove("show");
        document.body.style.overflow = "";
    };

    if (viewAllBtn) {
        viewAllBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openModal();
        });
    }

    if (explicitCloseBtn) {
        explicitCloseBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    if (modalOverlay) {
        // Click on the dimmed backdrop (not the card) closes it.
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) closeModal();
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
    });
}

function initSidebar(activeMenuName) {
    const menuItems = document.querySelectorAll(".menu li");
    if (menuItems.length > 0) {
        menuItems.forEach(item => {
            const spanText = item.querySelector("span")?.textContent.trim();
            if (spanText && spanText.toLowerCase() === activeMenuName.toLowerCase()) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });
    }
}

function initCalendar() {
    const monthTitle = document.getElementById("calendar-month");
    const dayList = document.getElementById("calendar-day-list");
    const prevBtn = document.getElementById("calendar-prev");
    const nextBtn = document.getElementById("calendar-next");
    const calendarBtn = document.getElementById("calendar-btn");

    if (!monthTitle || !dayList || !prevBtn || !nextBtn) return;

    const today = new Date();
    let viewStartDate = new Date(today);
    let selectedDate = new Date(today);
    let isMonthView = false;

    let holidays = {};
    let coordinatorEvents = {};
    let calendarExceptions = {};
    let dailyHours = {}; // "YYYY-MM-DD" -> hours rendered that day, e.g. { "2026-01-01": 8 }

    // Dates with a real "Absent" attendance record (status: "Absent"),
    // pushed in from listenToStudentAttendance(). This mirrors the exact
    // same auto-marking logic attendance.js already runs (checkAndMarkAbsences:
    // only counts a day if it fell on the student's OWN assigned schedule,
    // is on/after their first-ever attendance record — i.e. effectively
    // their OJT start — and isn't a coordinator no-duty/holiday exception),
    // so the count here always matches what the coordinator sees.
    let absentDates = {};

    function isAbsentDay(dateStr) {
        return !!absentDates[dateStr];
    }

    // Keeps a just-opened "Note: ..." popup fully on-screen by nudging it
    // left/right if the centered position would run off the viewport edge
    // (this is what was cutting the text off before).
    function keepTooltipInView(popup) {
        requestAnimationFrame(() => {
            const rect = popup.getBoundingClientRect();
            const margin = 8;
            let shift = 0;
            if (rect.left < margin) {
                shift = margin - rect.left;
            } else if (rect.right > window.innerWidth - margin) {
                shift = (window.innerWidth - margin) - rect.right;
            }
            if (shift !== 0) {
                popup.style.left = `calc(50% + ${shift}px)`;
            }
        });
    }

    function formatHoursLabel(h) {
        return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
    }

    const defaultPHHolidays = {
        "2026-01-01": "New Year's Day",
        "2026-04-02": "Maundy Thursday",
        "2026-04-03": "Good Friday",
        "2026-04-09": "Araw ng Kagitingan",
        "2026-05-01": "Labor Day",
        "2026-06-12": "Independence Day",
        "2026-08-31": "National Heroes Day",
        "2026-11-30": "Bonifacio Day",
        "2026-12-25": "Christmas Day",
        "2026-12-30": "Rizal Day"
    };

    holidays = { ...defaultPHHolidays };

    async function fetchPhilippineHolidays(year) {
        try {
            const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/PH`);
            if (response.ok) {
                const data = await response.json();
                data.forEach(holiday => {
                    holidays[holiday.date] = holiday.localName;
                });
                renderCalendar();
            }
        } catch (error) {
            console.warn("Using default Philippine holidays fallback.", error);
        }
    }

    function fetchCoordinatorEvents() {
        try {
            const eventsQuery = query(collection(db, "coordinator_calendar"));
            onSnapshot(eventsQuery, (snapshot) => {
                coordinatorEvents = {};
                snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    let targetDate = data.date || docSnap.id;
                    if (targetDate) {
                        if (!coordinatorEvents[targetDate]) coordinatorEvents[targetDate] = [];
                        if (data.title) coordinatorEvents[targetDate].push(data.title);
                        if (data.reason) coordinatorEvents[targetDate].push(data.reason);
                    }
                });
                renderCalendar();
            });

            const exceptionsQuery = query(collection(db, "calendar_exceptions"));
            onSnapshot(exceptionsQuery, (snapshot) => {
                calendarExceptions = {};
                snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    let targetDate = data.date || docSnap.id;
                    if (targetDate) {
                        if (!calendarExceptions[targetDate]) calendarExceptions[targetDate] = [];
                        if (data.reason) calendarExceptions[targetDate].push(data.reason);
                        if (data.title) calendarExceptions[targetDate].push(data.title);
                    }
                });
                renderCalendar();
            });
        } catch (e) {
            console.warn("Error syncing coordinator calendar events or exceptions:", e);
        }
    }

    fetchPhilippineHolidays(viewStartDate.getFullYear());
    fetchCoordinatorEvents();

    function formatMonth(date) {
        return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }

    function isSameDate(date1, date2) {
        return (
            date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate()
        );
    }

    function renderCalendar() {
        dayList.innerHTML = "";
        dayList.className = "calendar-day-list";

        if (isMonthView) {
            monthTitle.textContent = formatMonth(viewStartDate);
            dayList.classList.add("month-view");

            const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            weekdays.forEach(day => {
                const weekday = document.createElement("div");
                weekday.className = "calendar-weekday";
                weekday.textContent = day;
                dayList.appendChild(weekday);
            });

            const firstDay = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth(), 1);
            const firstDayIndex = firstDay.getDay();

            for (let i = 0; i < firstDayIndex; i++) {
                const emptyDay = document.createElement("div");
                emptyDay.className = "calendar-empty";
                dayList.appendChild(emptyDay);
            }

            const daysInMonth = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth() + 1, 0).getDate();
            const year = viewStartDate.getFullYear();
            const month = viewStartDate.getMonth();

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                const dayButton = document.createElement("button");
                dayButton.type = "button";
                dayButton.className = "calendar-month-day";
                dayButton.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 4px; cursor: pointer;";

                if (isSameDate(date, selectedDate)) dayButton.classList.add("active");
                if (isSameDate(date, today)) dayButton.classList.add("today");
                if (dailyHours[dateStr] > 0) dayButton.classList.add("has-duty");
                if (isAbsentDay(dateStr)) dayButton.classList.add("absent-day");

                let htmlContent = `<span>${day}</span>`;
                let indicators = `<div style="display: flex; gap: 2px; margin-top: 2px;">`;
                if (holidays[dateStr]) indicators += `<span style="width: 4px; height: 4px; background: #ef4444; border-radius: 50%;"></span>`;
                if (coordinatorEvents[dateStr]) indicators += `<span style="width: 4px; height: 4px; background: #0284c7; border-radius: 50%;"></span>`;
                if (calendarExceptions[dateStr]) indicators += `<span style="width: 4px; height: 4px; background: #f97316; border-radius: 50%;"></span>`;
                if (dailyHours[dateStr] > 0) indicators += `<span style="width: 4px; height: 4px; background: #16a34a; border-radius: 50%;"></span>`;
                indicators += `</div>`;
                
                htmlContent += indicators;
                dayButton.innerHTML = htmlContent;

                dayButton.addEventListener("click", (e) => {
                    e.stopPropagation();
                    document.querySelectorAll(".calendar-popup-tooltip").forEach(el => el.remove());

                    let holidayName = holidays[dateStr] || "";
                    let eventList = coordinatorEvents[dateStr] || [];
                    let exceptionList = calendarExceptions[dateStr] || [];
                    let hoursLogged = dailyHours[dateStr] || 0;

                    let eventNames = eventList.join(", ");
                    let exceptionNames = exceptionList.join(", ");

                    if (!holidayName && !eventNames && !exceptionNames && !hoursLogged) {
                        holidayName = "No entry details available.";
                    }

                    const popup = document.createElement("div");
                    popup.className = "calendar-popup-tooltip";
                    popup.style.cssText = "position: absolute; bottom: 110%; left: 50%; transform: translateX(-50%); background: #1e293b; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; white-space: normal; max-width: min(220px, 80vw); width: max-content; text-align: left; line-height: 1.4; z-index: 9999; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);";
                    
                    let textToShow = [];
                    if (hoursLogged > 0) textToShow.push(`Hours Logged: ${formatHoursLabel(hoursLogged)}`);
                    if (holidayName) textToShow.push(`Holiday: ${holidayName}`);
                    if (eventNames) textToShow.push(`Event: ${eventNames}`);
                    if (exceptionNames) textToShow.push(`Note: ${exceptionNames}`);
                    
                    popup.innerHTML = textToShow.join("<br>");
                    dayButton.appendChild(popup);
                    keepTooltipInView(popup);

                    setTimeout(() => {
                        const closePopup = (ev) => {
                            if (!dayButton.contains(ev.target)) {
                                popup.remove();
                                document.removeEventListener("click", closePopup);
                            }
                        };
                        document.addEventListener("click", closePopup);
                    }, 100);
                });

                dayList.appendChild(dayButton);
            }

            if (calendarBtn) {
                calendarBtn.innerHTML = `<i class="fa-regular fa-calendar"></i><span>Horizontal</span>`;
            }
            return;
        }

        if (calendarBtn) {
            calendarBtn.innerHTML = `<i class="fa-regular fa-calendar-plus"></i><span>Calendar</span>`;
        }

        monthTitle.textContent = formatMonth(viewStartDate);
        dayList.classList.add("week-view");

        for (let i = 0; i < 5; i++) {
            const date = new Date(viewStartDate);
            date.setDate(viewStartDate.getDate() + i);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const dayNum = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${dayNum}`;

            const dayButton = document.createElement("button");
            dayButton.type = "button";
            dayButton.className = "calendar-day";
            dayButton.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 6px; cursor: pointer;";

            if (isSameDate(date, selectedDate)) dayButton.classList.add("active");
            if (isSameDate(date, today)) dayButton.classList.add("today");
            if (dailyHours[dateStr] > 0) dayButton.classList.add("has-duty");
            if (isAbsentDay(dateStr)) dayButton.classList.add("absent-day");

            let htmlContent = `
                <span class="day-number">${date.getDate()}</span>
                <span class="day-name">${date.toLocaleDateString("en-US", { weekday: "short" })}</span>
            `;

            if (dailyHours[dateStr] > 0) {
                htmlContent += `<span class="calendar-day-hours">${formatHoursLabel(dailyHours[dateStr])}</span>`;
            }

            let indicators = `<div style="display: flex; gap: 2px; margin-top: 2px;">`;
            if (holidays[dateStr]) indicators += `<span style="width: 4px; height: 4px; background: #ef4444; border-radius: 50%;"></span>`;
            if (coordinatorEvents[dateStr]) indicators += `<span style="width: 4px; height: 4px; background: #0284c7; border-radius: 50%;"></span>`;
            if (calendarExceptions[dateStr]) indicators += `<span style="width: 4px; height: 4px; background: #f97316; border-radius: 50%;"></span>`;
            indicators += `</div>`;

            htmlContent += indicators;
            dayButton.innerHTML = htmlContent;

            dayButton.addEventListener("click", (e) => {
                e.stopPropagation();
                document.querySelectorAll(".calendar-popup-tooltip").forEach(el => el.remove());

                let holidayName = holidays[dateStr] || "";
                let eventList = coordinatorEvents[dateStr] || [];
                let exceptionList = calendarExceptions[dateStr] || [];
                let hoursLogged = dailyHours[dateStr] || 0;

                let eventNames = eventList.join(", ");
                let exceptionNames = exceptionList.join(", ");

                if (!holidayName && !eventNames && !exceptionNames && !hoursLogged) {
                    holidayName = "No entry details available.";
                }

                const popup = document.createElement("div");
                popup.className = "calendar-popup-tooltip";
                popup.style.cssText = "position: absolute; bottom: 110%; left: 50%; transform: translateX(-50%); background: #1e293b; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; white-space: normal; max-width: min(220px, 80vw); width: max-content; text-align: left; line-height: 1.4; z-index: 9999; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);";
                
                let textToShow = [];
                if (hoursLogged > 0) textToShow.push(`Hours Logged: ${formatHoursLabel(hoursLogged)}`);
                if (holidayName) textToShow.push(`Holiday: ${holidayName}`);
                if (eventNames) textToShow.push(`Event: ${eventNames}`);
                if (exceptionNames) textToShow.push(`Note: ${exceptionNames}`);
                
                popup.innerHTML = textToShow.join("<br>");
                dayButton.appendChild(popup);
                    keepTooltipInView(popup);

                setTimeout(() => {
                    const closePopup = (ev) => {
                        if (!dayButton.contains(ev.target)) {
                            popup.remove();
                            document.removeEventListener("click", closePopup);
                        }
                    };
                    document.addEventListener("click", closePopup);
                }, 100);
            });

            dayList.appendChild(dayButton);
        }
    }

    if (calendarBtn) {
        calendarBtn.addEventListener("click", () => {
            isMonthView = !isMonthView;
            if (!isMonthView) {
                viewStartDate = new Date(selectedDate);
            } else {
                viewStartDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
            }
            renderCalendar();
        });
    }

    prevBtn.addEventListener("click", () => {
        const oldYear = viewStartDate.getFullYear();
        if (isMonthView) {
            viewStartDate = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth() - 1, 1);
        } else {
            viewStartDate.setDate(viewStartDate.getDate() - 1);
        }
        const newYear = viewStartDate.getFullYear();
        if (oldYear !== newYear) fetchPhilippineHolidays(newYear);
        else renderCalendar();
    });

    nextBtn.addEventListener("click", () => {
        const oldYear = viewStartDate.getFullYear();
        if (isMonthView) {
            viewStartDate = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth() + 1, 1);
        } else {
            viewStartDate.setDate(viewStartDate.getDate() + 1);
        }
        const newYear = viewStartDate.getFullYear();
        if (oldYear !== newYear) fetchPhilippineHolidays(newYear);
        else renderCalendar();
    });

    renderCalendar();

    // Lets callers outside this closure (e.g. the attendance listener, once
    // Firestore data comes in) push per-day hours into the calendar and
    // trigger a re-render.
    return {
        setDailyHours(map) {
            dailyHours = map || {};
            renderCalendar();
        },
        setAbsentDates(map) {
            absentDates = map || {};
            renderCalendar();
        }
    };
}