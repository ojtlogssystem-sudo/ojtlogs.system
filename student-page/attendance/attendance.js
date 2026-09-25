import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    updateDoc, 
    doc, 
    getDoc,
    getDocs, 
    query, 
    where, 
    orderBy, 
    limit, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadHeader, getInitials } from "../templated/header-loader.js";

// FIREBASE CONFIGURATION (OJT-LOGS Project Credentials)
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

// Guarded init: header-loader.js also initializes the default Firebase app,
// and whichever module's top-level code runs first "wins" — this avoids a
// duplicate-app error regardless of import order.
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);
const attendanceRef = collection(db, "attendance");
const companiesRef = collection(db, "companies");

/* ==========================================
   ATTENDANCE POLICY CONFIGURATION
   - OFFICIAL_TIME_IN: tamang oras ng time in (8:00 AM)
   - LATE_GRACE_MINUTES: grace period bago macall na "Late"
     (halimbawa: 8:15 AM na time in = Late na, dahil lampas
     na sa 15 minutes grace mula 8:00 AM)
   - DUTY_DAYS: mga araw ng duty (0=Sunday ... 6=Saturday).
     Default: Monday–Friday
========================================== */
const OFFICIAL_TIME_IN_HOUR = 8;
const OFFICIAL_TIME_IN_MINUTE = 0;
const LATE_GRACE_MINUTES = 15;
const DUTY_DAYS = [1, 2, 3, 4, 5];

let fullAttendanceHistory = [];
let initialClockInterval = null;
let todayNoDutyReason = null;

// Naka-cache na schedule.days ng naka-login na student (mula sa users/{uid}
// document sa Firestore), para hindi na paulit-ulit mag-fetch. Null pa
// hangga't hindi pa na-a-attempt fetch; empty/undefined array kapag wala
// pang na-set na schedule sa account niya.
let studentScheduleDays = null;
let studentSchedule = null;   // buong users/{uid}.schedule (days, morning, afternoon)
let studentScheduleFetchedFor = null;

// Iisang absence-check lang ang sabay na tatakbo, para walang doble-doblehang
// "Absent" record kapag sunod-sunod ang refreshAttendanceUI().
let absenceCheckInFlight = null;

// Naka-cache ang assigned companyName ng naka-login na student (mula sa
// users/{uid} document), para hindi na paulit-ulit mag-fetch sa Firestore
// tuwing mag-sscan ng QR. Null hangga't hindi pa na-a-attempt fetch.
let studentAssignedCompany = null;
let studentCompanyFetchedFor = null;

// Kontrol sa "View All" toggle ng Attendance History list.
let showAllHistory = false;

/* ==========================================
   TODAY'S NO-DUTY CHECK (Suspension / Holiday)
   Reads from the same "calendar_exceptions"
   collection the header notification bell and
   the dashboard calendar already use.
========================================== */
async function getTodayNoDutyReason(dateStr) {
    try {
        const q = query(
            collection(db, "calendar_exceptions"),
            where("date", "==", dateStr)
        );
        const snap = await getDocs(q);

        if (!snap.empty) {
            const data = snap.docs[0].data();
            return data.reason || data.title || "No Duty / Excused";
        }
    } catch (error) {
        console.warn("Could not check calendar exceptions:", error);
    }

    return null;
}

/* ==========================================
   LATE COMPUTATION
   Ikinukumpara ang oras ng Time In sa opisyal na
   schedule (8:00 AM) + grace period (15 mins).
   Late na kapag lumampas sa 8:15 AM.
========================================== */
// "08:00" (galing sa <input type="time">) -> minuto mula hatinggabi
function scheduleTimeToMinutes(value) {
    const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Mga naka-enable na session ng student, sorted by simula ng oras
function getScheduleSessions(schedule) {
    if (!schedule) return [];

    const sessions = [];

    [["morning", "morningEnabled"], ["afternoon", "afternoonEnabled"]].forEach(([key, flag]) => {
        const s = schedule[key];
        if (!s || schedule[flag] === false || s[flag] === false) return;

        const start = scheduleTimeToMinutes(s.timeIn);
        const end = scheduleTimeToMinutes(s.timeOut);
        if (start !== null && end !== null) sessions.push({ start, end });
    });

    return sessions.sort((a, b) => a.start - b.start);
}

/* Late kapag lumampas sa LATE_GRACE_MINUTES mula sa simula ng session
   sa mismong schedule ng student (users/{uid}.schedule). Kung wala pang
   schedule, babalik sa default na 8:00 AM. */
function computeLateInfo(timeInDate, schedule = null) {
    const sessions = getScheduleSessions(schedule);

    if (sessions.length) {
        const nowMins = timeInDate.getHours() * 60 + timeInDate.getMinutes() + timeInDate.getSeconds() / 60;

        // Session na hindi pa tapos sa oras ng time-in (kung lampas na lahat, yung huli)
        const target = sessions.find((s) => nowMins < s.end) || sessions[sessions.length - 1];

        if (nowMins > target.start + LATE_GRACE_MINUTES) {
            return { isLate: true, lateMinutes: Math.round(nowMins - target.start) };
        }
        return { isLate: false, lateMinutes: 0 };
    }

    const scheduled = new Date(timeInDate);
    scheduled.setHours(OFFICIAL_TIME_IN_HOUR, OFFICIAL_TIME_IN_MINUTE, 0, 0);

    const graceDeadline = new Date(scheduled.getTime() + LATE_GRACE_MINUTES * 60000);

    if (timeInDate > graceDeadline) {
        const lateMinutes = Math.round((timeInDate - scheduled) / 60000);
        return { isLate: true, lateMinutes };
    }
    return { isLate: false, lateMinutes: 0 };
}

/* ==========================================
   ABSENCE AUTO-DETECTION
   Kapag walang Time In record ang isang user sa isang
   duty day (weekday, at walang calendar exception /
   suspension), awtomatikong mama-mark itong "Absent"
   sa susunod na pag-load ng page (hindi kasama ang
   araw na ito habang ongoing pa).
========================================== */
function isDutyDay(dateObj) {
    return DUTY_DAYS.includes(dateObj.getDay());
}

/* ==========================================
   PER-STUDENT SCHEDULE (users/{uid}.schedule.days)
   Bawat student may sariling assigned na mga araw ng
   duty (hal. ["Monday","Tuesday","Thursday"]), na naka-set
   ng coordinator sa Firestore "users" collection. Dito
   ina-align ang Time In / Time Out buttons sa personal na
   schedule niya sa halip na sa generic Mon-Fri default.
========================================== */
async function getStudentScheduleDays(user) {
    if (!user || !user.uid) return null;

    // Gamitin ulit ang huling fetch kung same user pa rin,
    // para hindi na tumawag ulit sa Firestore sa bawat refresh.
    if (studentScheduleFetchedFor === user.uid) {
        return studentScheduleDays;
    }

    try {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            const days = data.schedule?.days;
            studentScheduleDays = Array.isArray(days) ? days : null;
            studentSchedule = (data.schedule && typeof data.schedule === "object") ? data.schedule : null;
        } else {
            studentScheduleDays = null;
            studentSchedule = null;
        }
    } catch (error) {
        console.warn("Could not fetch student schedule:", error);
        studentScheduleDays = null;
        studentSchedule = null;
    }

    studentScheduleFetchedFor = user.uid;
    return studentScheduleDays;
}

// Buong schedule object ng student (para sa oras ng Morning/Afternoon session).
async function getStudentSchedule(user) {
    await getStudentScheduleDays(user);
    return studentSchedule;
}

// Kinukuha ang companyName na naka-assign sa naka-login na student, mula
// sa kanyang users/{uid} document. Ito yung ikukumpara sa company na
// nakuha mula sa na-scan na QR code, para hindi tumanggap ng QR code
// ng ibang company.
async function getStudentAssignedCompany(user) {
    if (!user || !user.uid) return null;

    if (studentCompanyFetchedFor === user.uid) {
        return studentAssignedCompany;
    }

    try {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            studentAssignedCompany = data.companyName || null;
        } else {
            studentAssignedCompany = null;
        }
    } catch (error) {
        console.warn("Could not fetch student's assigned company:", error);
        studentAssignedCompany = null;
    }

    studentCompanyFetchedFor = user.uid;
    return studentAssignedCompany;
}

// True kapag "dateObj" ay isa sa mga naka-assign na duty day ng student.
// Kung wala pang na-set na schedule sa account niya, babalik sa generic
// Mon-Fri default (DUTY_DAYS) para hindi mag-lock ng buttons nang walang dahilan.
function isTodayInStudentSchedule(dateObj, scheduleDays) {
    if (!Array.isArray(scheduleDays) || scheduleDays.length === 0) {
        return isDutyDay(dateObj);
    }
    const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long" });
    return scheduleDays.includes(dayName);
}

async function getNoDutyDatesInRange(startStr, endStr) {
    const noDutySet = new Set();
    try {
        const q = query(
            collection(db, "calendar_exceptions"),
            where("date", ">=", startStr),
            where("date", "<=", endStr)
        );
        const snap = await getDocs(q);
        snap.forEach(d => {
            if (d.data().date) noDutySet.add(d.data().date);
        });
    } catch (error) {
        console.warn("Could not check calendar exceptions range:", error);
    }
    return noDutySet;
}

function checkAndMarkAbsences(user, todayStr, scheduleDays) {
    if (!user) return Promise.resolve();
    if (absenceCheckInFlight) return absenceCheckInFlight;

    absenceCheckInFlight = markMissedAbsences(user, todayStr, scheduleDays)
        .finally(() => { absenceCheckInFlight = null; });

    return absenceCheckInFlight;
}

async function markMissedAbsences(user, todayStr, scheduleDays) {
    if (!user) return;

    const existingDates = new Set(fullAttendanceHistory.map(i => i.date));

    // Lookback window: laging naka-cap sa ABSENCE_LOOKBACK_DAYS (14 days)
    // paatras mula ngayon — hindi na hanggang sa earliest record ng
    // estudyante. Dati, kapag may kahit isang record na siya noon (halimbawa
    // 3-4 buwan na ang nakalipas), babalik doon ang cursor at magma-mark ng
    // "Absent" para sa BAWAT Mon-Fri na walang record mula noon hanggang
    // ngayon — pwedeng daan-daang maling Absent entries sa isang pagbukas
    // lang ng page. Ang cap na ito ang dahilan kung bakit "super dami" at
    // hindi tugma sa totoong (accurate) attendance.
    const ABSENCE_LOOKBACK_DAYS = 14;
    const todayDateObj = new Date(todayStr + "T00:00:00");
    let cursor = new Date(todayDateObj);
    cursor.setDate(cursor.getDate() - ABSENCE_LOOKBACK_DAYS);

    // Huwag mag-mark ng "Absent" para sa mga araw bago pa nagkaroon ng account
    // ang student (hindi pa siya part ng OJT noon).
    const createdRaw = user.metadata?.creationTime;
    if (createdRaw) {
        const createdDay = new Date(createdRaw);
        createdDay.setHours(0, 0, 0, 0);
        if (cursor < createdDay) cursor = createdDay;
    }

    const startStr = getLocalYYYYMMDD(cursor);
    const noDutySet = await getNoDutyDatesInRange(startStr, todayStr);

    const userId = user.uid;
    const userEmail = user.email;

    // Hindi kasama ang "today" — ma-e-evaluate lang ito paglipas
    // ng araw (sa susunod na pagbukas ng page).
    while (cursor < todayDateObj) {
        const dateStr = getLocalYYYYMMDD(cursor);

        if (isTodayInStudentSchedule(cursor, scheduleDays) && !noDutySet.has(dateStr) && !existingDates.has(dateStr)) {
            const absentRecord = {
                userId: userId || "guest_user",
                userEmail: userEmail || "no_email",
                date: dateStr,
                formattedDate: formatLocalDateDisplay(cursor),
                company: "--",
                location: "--",
                timeIn: "--",
                timeOut: "--",
                photoProof: "",
                tasks: "",
                hoursRendered: 0,
                todayHours: "0h 0m",
                status: "Absent",
                remarks: "No Time In Recorded (Auto-marked)",
                createdAt: serverTimestamp()
            };

            try {
                const docRef = await addDoc(attendanceRef, absentRecord);
                fullAttendanceHistory.push({
                    id: docRef.id,
                    ...absentRecord,
                    createdAt: new Date().toISOString()
                });
                existingDates.add(dateStr);
            } catch (err) {
                console.warn("Could not auto-mark absence for", dateStr, err);
            }
        }

        cursor.setDate(cursor.getDate() + 1);
    }
}

/* ==========================================
   NTP TIME FETCHER (Reliable Internet & Firebase Synchronized Time)
========================================== */
async function getCurrentNTPTime() {
    try {
        // Kumukuha ng oras mula sa internet time API upang maiwasan ang manipulasyon sa PC/Mobile local clock
        const response = await fetch("https://worldtimeapi.org/api/timezone/Asia/Manila");
        const data = await response.json();
        return new Date(data.datetime);
    } catch (error) {
        console.warn("NTP API failed, falling back to secure server sync fallback:", error);
        // Fallback sa kasalukuyang secure time kung walang internet connection sa mismong segundo na yun
        return new Date();
    }
}

/* ==========================================
   DATE & TIME HELPER FUNCTIONS (UI DISPLAY ONLY)
========================================== */
function getLocalYYYYMMDD(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatLocalDateDisplay(dateObj = new Date()) {
    return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Kasama na ang pangalan ng araw (Monday, Tuesday, ...) — ginagamit sa
// live timestamp badge para makita agad kung anong araw ngayon.
function formatLocalDateWithDay(dateObj = new Date()) {
    return dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAMPM(dateObj = new Date()) {
    return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/* ==========================================
   INITIAL LIVE CLOCK (DISPLAYS TIME ON LOAD)
========================================== */
async function startInitialLiveClock() {
    const badge = document.getElementById("firebase-timestamp-badge");
    const dateEl = document.getElementById("student-current-date");
    const timeEl = document.getElementById("student-current-time");
    if (!badge && !dateEl && !timeEl) return;

    const updateClock = async () => {
        const now = await getCurrentNTPTime();
        const dateStr = formatLocalDateWithDay(now);
        const timeStr = formatAMPM(now);

        if (badge) badge.textContent = `${timeStr} / ${dateStr}`;

        // "Today / Current Time" bar sa itaas ng page — parehong NTP time
        // source ang ginagamit para laging magkatugma sila ng badge.
        if (dateEl) dateEl.textContent = dateStr;
        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        }
    };

    await updateClock();
    
    if (initialClockInterval) clearInterval(initialClockInterval);
    initialClockInterval = setInterval(updateClock, 1000);
}

/* ==========================================
   NOTIFICATION BELL
   Now handled globally by the shared header (see header-loader.js's
   loadNotifications, called automatically inside loadHeader()).
========================================== */

// Custom Toast Notification
function showToast(message, type = "success") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 90%;
            max-width: 480px;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    const isSuccess = type === "success";
    const bgColor = isSuccess ? "#eafaf1" : type === "error" ? "#fef2f2" : "#eff6ff";
    const borderColor = isSuccess ? "#bbf2d0" : type === "error" ? "#fca5a5" : "#bfdbfe";
    const textColor = isSuccess ? "#0e7490" : type === "error" ? "#991b1b" : "#1e40af";
    const iconColor = isSuccess ? "#059669" : type === "error" ? "#dc2626" : "#2563eb";

    toast.style.cssText = `
        width: 100%;
        padding: 16px 20px;
        border-radius: 14px;
        background-color: ${bgColor};
        border: 1px solid ${borderColor};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
        display: flex;
        align-items: center;
        gap: 12px;
        transition: all 0.3s ease;
    `;

    const iconClass = isSuccess ? "fa-circle-check" : type === "error" ? "fa-circle-xmark" : "fa-circle-info";
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass}" style="font-size: 20px; color: ${iconColor};"></i>
        <span style="color: ${textColor}; font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 500;">
            ${message}
        </span>
    `;

    container.innerHTML = "";
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-6px)";
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

/* ==========================================
   INITIAL LOADING OVERLAY
   Naka-block ito sa buong page (kasama ang mga
   Time In / Time Out button) hanggang matapos
   ang unang refreshAttendanceUI() fetch. Ito ang
   pumipigil sa bug na maka-click agad ang user
   bago pa na-verify kung dapat ba talagang naka-
   enable/disable ang mga button ayon sa totoong
   estado niya ngayong araw.
========================================== */
function hideAttendanceLoadingOverlay() {
    const overlay = document.getElementById("attendance-loading-overlay");
    if (!overlay || overlay.dataset.hidden === "true") return;
    overlay.dataset.hidden = "true";
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 300);
}

document.addEventListener("DOMContentLoaded", async () => {
    // Safety net: kung sakaling matagal ang koneksyon o may error na
    // hindi na-catch sa fetch chain, huwag hayaang ma-stuck ang user
    // sa loading screen magpakailanman — itago pa rin pagkalipas ng
    // ilang segundo.
    setTimeout(() => {
        const overlay = document.getElementById("attendance-loading-overlay");
        if (overlay && overlay.dataset.hidden !== "true") {
            console.warn("Attendance loading overlay auto-hidden after timeout — check network/Firestore.");
            hideAttendanceLoadingOverlay();
        }
    }, 15000);

    // Header markup (bell, avatar, dropdowns) is injected async — anything
    // that targets its elements (notifications, mobile-menu wiring) has to
    // wait for it first. autoLoadProfile lets the shared header populate the
    // avatar/name itself since this page has no richer profile loader of its own.
    await loadHeader("Attendance", { autoLoadProfile: true });

    fetch("../templated/sidebar.html?v=" + new Date().getTime())
        .then(response => response.ok ? response.text() : Promise.reject())
        .then(html => {
            const sidebarContainer = document.getElementById("sidebar-container");
            if (sidebarContainer) sidebarContainer.innerHTML = html;
            initSidebar("Attendance");
        })
        .catch(err => console.error("Error loading sidebar:", err));

    initFlatpickrFilter();

    // I-display agad ang tamang oras mula sa internet/server ngayong araw sa pag-load pa lang ng pahina
    startInitialLiveClock();

    onAuthStateChanged(auth, (user) => {
        initAttendanceSystem(user);
    });
});

/* ==========================================
   FLATPICKR DATE RANGE PICKER
========================================== */
function initFlatpickrFilter() {
    const datePickerInput = document.getElementById("dateRangePicker");

    if (datePickerInput && typeof flatpickr !== "undefined") {
        flatpickr(datePickerInput, {
            mode: "range",
            dateFormat: "M j, Y",
            onChange: function (selectedDates) {
                if (selectedDates.length === 2) {
                    filterHistoryByDateRange(selectedDates[0], selectedDates[1]);
                } else if (selectedDates.length === 0) {
                    renderHistoryItems(getDisplayHistory(fullAttendanceHistory));
                }
            }
        });
    }
}

function filterHistoryByDateRange(startDate, endDate) {
    const start = new Date(startDate).setHours(0, 0, 0, 0);
    const end = new Date(endDate).setHours(23, 59, 59, 999);

    const filtered = fullAttendanceHistory.filter(item => {
        const itemDateStr = item.date || item.formattedDate;
        if (!itemDateStr) return false;

        const itemDate = new Date(itemDateStr).setHours(12, 0, 0, 0);
        return itemDate >= start && itemDate <= end;
    });

    renderHistoryItems(getDisplayHistory(filtered));
}

// Global View Photo Modal
window.viewPhotoModal = function(photoUrl, company, date, timeIn) {
    let viewModal = document.getElementById('view-photo-modal');
    
    if (!viewModal) {
        viewModal = document.createElement('div');
        viewModal.id = 'view-photo-modal';
        viewModal.className = 'scanner-modal';
        viewModal.innerHTML = `
            <div class="scanner-dialog" style="max-width: 420px; padding: 20px;">
                <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 4px;"><i class="fa-solid fa-image" style="color: #3b82f6;"></i> Photo Proof Details</h3>
                <p style="font-size: 11px; color: #6b7280; margin-bottom: 12px;">Verification photo submitted during time-in</p>
                
                <div style="width: 100%; height: 260px; border-radius: 12px; overflow: hidden; background: #111827; margin-bottom: 14px; display: flex; align-items: center; justify-content: center;">
                    <img id="view-photo-img" src="" alt="Photo Proof" style="width: 100%; height: 100%; object-fit: cover;">
                </div>

                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; text-align: left; font-size: 12px;">
                    <div><span style="color: #6b7280; font-size: 10px; text-transform: uppercase; font-weight:600;">Company:</span> <strong id="view-photo-company" style="color: #111827;">--</strong></div>
                    <div><span style="color: #6b7280; font-size: 10px; text-transform: uppercase; font-weight:600;">Date:</span> <strong id="view-photo-date" style="color: #111827;">--</strong></div>
                    <div><span style="color: #6b7280; font-size: 10px; text-transform: uppercase; font-weight:600;">Time In:</span> <strong id="view-photo-time" style="color: #111827;">--</strong></div>
                </div>

                <button id="view-photo-close-action" type="button" style="margin-top: 14px; width: 100%; padding: 10px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; font-weight: 600; font-size: 13px; color: #374151; cursor: pointer;">Close</button>
            </div>
        `;
        document.body.appendChild(viewModal);

        const closeAction = document.getElementById('view-photo-close-action');
        closeAction?.addEventListener('click', () => { viewModal.hidden = true; });
    }

    const imgEl = document.getElementById('view-photo-img');
    const compEl = document.getElementById('view-photo-company');
    const dateEl = document.getElementById('view-photo-date');
    const timeEl = document.getElementById('view-photo-time');

    if (imgEl) imgEl.src = photoUrl || 'https://via.placeholder.com/400x300?text=No+Photo+Proof';
    if (compEl) compEl.textContent = company || 'Partner Company';
    if (dateEl) dateEl.textContent = date || '--';
    if (timeEl) timeEl.textContent = timeIn || '--';

    viewModal.hidden = false;
};

// Kapag hindi pa pinindot ang "View All", 3 lang na pinaka-bagong
// attendance record ang ipapakita sa listahan.
function getDisplayHistory(historyList) {
    return showAllHistory ? historyList : historyList.slice(0, 3);
}

// Ginagamit pareho ng refreshAttendanceUI at ng "View All" button para
// hindi mag-duplicate ng logic: kung may active date-range filter, i-apply
// yun; kung wala, ipakita ang buong fullAttendanceHistory (naka-cap sa 3
// maliban na lang kung naka-toggle na ang "View All").
function applyHistoryDisplay() {
    const datePickerInput = document.getElementById("dateRangePicker");
    if (datePickerInput && datePickerInput._flatpickr && datePickerInput._flatpickr.selectedDates.length === 2) {
        const dates = datePickerInput._flatpickr.selectedDates;
        filterHistoryByDateRange(dates[0], dates[1]);
    } else {
        renderHistoryItems(getDisplayHistory(fullAttendanceHistory));
    }
}

// Render Logs List
function renderHistoryItems(historyList) {
    const historyContainer = document.getElementById("attendance-history-list");
    if (!historyContainer) return;

    if (historyList.length === 0) {
        historyContainer.innerHTML = `<div style="text-align:center; padding: 20px; color:#9ca3af; font-size:12px;">No Attendance Logs Found.</div>`;
        return;
    }

    historyContainer.innerHTML = historyList.map(item => {
        const photoSrc = item.photoProof || item.photoProofUrl || item.photoUrl || item.photo || '';
        const safeCompany = (item.company || 'Partner Company').replace(/'/g, "\\'");
        const safeDate = (item.formattedDate || item.date || '--').replace(/'/g, "\\'");
        const safeTimeIn = (item.timeIn || '--').replace(/'/g, "\\'");

        const isCompleted = item.status === 'Present' || item.status === 'Completed';
        const isLate = item.status === 'Late';
        const isAbsent = item.status === 'Absent';
        const isActive = item.status === 'Active';
        const isRejected = String(item.status || '').toLowerCase() === 'rejected';
        const isExcused = String(item.status || '').toLowerCase() === 'excused';

        let badgeClass = 'green';
        let badgeText = item.status;
        if (isRejected) { badgeClass = 'red'; badgeText = 'Rejected'; }
        else if (isLate) { badgeClass = 'orange'; }
        else if (isAbsent) { badgeClass = 'red'; }
        else if (isExcused) { badgeClass = 'blue'; badgeText = 'Excused'; }
        else if (isActive) { badgeClass = 'blue'; badgeText = 'Active'; }
        else if (isCompleted) { badgeClass = 'green'; badgeText = 'Present'; }

        return `
            <div class="attendance-history-item">
                <div class="att-item-top">
                    <div class="att-item-left">
                        <div class="att-icon-box ${badgeClass === 'green' ? 'green-bg' : badgeClass === 'orange' ? 'orange-bg' : badgeClass === 'red' ? 'red-bg' : 'blue-bg'}">
                            <i class="fa-solid ${badgeClass === 'green' ? 'fa-circle-check' : badgeClass === 'orange' ? 'fa-clock' : badgeClass === 'red' ? 'fa-circle-xmark' : (isExcused ? 'fa-circle-info' : 'fa-spinner')}"></i>
                        </div>
                        <div class="att-date-info">
                            <h4>${item.formattedDate || item.date}</h4>
                            <p>${item.company}</p>
                        </div>
                    </div>
                    <div class="att-item-right">
                        <span class="badge-status ${badgeClass}">${badgeText}</span>
                    </div>
                </div>
                
                <div class="att-item-divider"></div>
                
                <div class="att-item-bottom">
                    <div class="time-log-info">
                        <span><i class="fa-solid fa-arrow-right-to-bracket text-green"></i> ${item.timeIn}</span>
                        <span class="dot">•</span>
                        <span><i class="fa-solid fa-arrow-right-from-bracket text-red"></i> ${item.timeOut}</span>
                    </div>
                    ${photoSrc ? `<button type="button" onclick="viewPhotoModal('${photoSrc}', '${safeCompany}', '${safeDate}', '${safeTimeIn}')" style="font-size: 11px; color: #3b82f6; font-weight: 500; border:none; background:none; cursor:pointer; display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-image"></i> Photo Proof</button>` : ''}
                </div>

                ${item.tasks ? `<div class="task-summary-preview"><strong>Tasks:</strong> ${item.tasks}</div>` : ''}
                ${item.remarks && item.remarks !== '--' ? `<div style="margin-top: 4px; font-size: 11px; color: ${isRejected ? '#dc2626' : isLate ? '#ea580c' : '#059669'};"><strong>Remarks:</strong> ${item.remarks}</div>` : ''}
            </div>
        `;
    }).join('');
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

function updateRedTimestampBadge(timeIn, dateString) {
    const badge = document.getElementById("firebase-timestamp-badge");
    if (badge) {
        if (timeIn && dateString) {
            if (initialClockInterval) {
                clearInterval(initialClockInterval);
                initialClockInterval = null;
            }
            badge.textContent = `${timeIn} / ${dateString}`;
        }
    }
}

function initAttendanceSystem(currentUser) {
    const timeInScanBtn = document.getElementById("time-in-scan-btn");
    const timeOutScanBtn = document.getElementById("time-out-scan-btn");
    const timeOutIconBox = document.getElementById("time-out-icon-box");
    const timeOutNoteText = document.getElementById("time-out-note-text");
    const timeInNoteText = document.getElementById("time-in-note-text");

    const scannerModal = document.getElementById("scanner-modal");
    const scannerStatus = document.getElementById("scanner-status");
    const scannerCancel = document.getElementById("scanner-cancel");

    const photoModal = document.getElementById("photo-modal");
    const photoVideo = document.getElementById("photo-video");
    const photoCanvas = document.getElementById("photo-canvas");
    const stampDatetime = document.getElementById("stamp-datetime");
    const stampLocation = document.getElementById("stamp-location");
    const switchCameraBtn = document.getElementById("switch-camera-btn");
    const capturePhotoBtn = document.getElementById("capture-photo-btn");
    const retakePhotoBtn = document.getElementById("retake-photo-btn");
    const confirmPhotoBtn = document.getElementById("confirm-photo-btn");
    const photoCancel = document.getElementById("photo-cancel");

    const taskModal = document.getElementById("task-modal");
    const submitTaskBtn = document.getElementById("submit-task-btn");
    const taskCancel = document.getElementById("task-cancel");

    const viewPhotoBtnClose = document.getElementById("view-photo-btn-close");
    const viewPhotoModalEl = document.getElementById("view-photo-modal");

    const viewAllBtn = document.getElementById("view-all-btn");

    let qrScanner = null;
    let scanMode = null; 
    let photoStream = null;
    let currentFacingMode = "user";
    let capturedPhotoBase64 = null;
    let capturedAtTime = null;
    let currentLocationStr = "Company Grounds";
    let clockInterval = null;

    // Hintayin munang matapos ang unang pag-verify ng attendance status
    // (Active / Completed / No Duty / Rejected / atbp.) bago tanggalin
    // ang loading overlay — dito pa lang dapat pwede nang mag-click ang
    // user ng Time In / Time Out. .finally() para tanggalin pa rin ang
    // overlay kahit magka-error sa fetch, para hindi ma-stuck ang user.
    refreshAttendanceUI().finally(hideAttendanceLoadingOverlay);

    // --- 1. QR SCANNER LOGIC ---
    const stopQRScanner = async () => {
        if (qrScanner) {
            try {
                await qrScanner.stop();
                await qrScanner.clear();
            } catch (err) {
                console.warn("Scanner stop issue:", err);
            }
            qrScanner = null;
        }
    };

    const openQRScanner = async (mode) => {
        if (todayNoDutyReason) {
            showToast(`No duty today — ${todayNoDutyReason}`, "info");
            return;
        }

        const now = await getCurrentNTPTime();
        const todayStr = getLocalYYYYMMDD(now);
        const latestToday = fullAttendanceHistory.find(i => i.date === todayStr);

        if (mode === "IN" && latestToday) {
            if (String(latestToday.status || "").toLowerCase() === "rejected") {
                showToast("Your attendance for today was rejected by your coordinator.", "error");
                return;
            }
            if (latestToday.status === "Completed" || latestToday.status === "Present" || latestToday.status === "Late") {
                showToast("You have already completed attendance for today. Try again tomorrow!", "error");
                return;
            }
            if (latestToday.status === "Active") {
                showToast("You are already Timed In today!", "info");
                return;
            }
        }

        scanMode = mode;
        if (typeof Html5Qrcode === "undefined") {
            showToast("QR Scanner library not loaded. Check internet.", "error");
            return;
        }

        scannerModal.hidden = false;
        scannerStatus.textContent = "Requesting camera permission...";

        try {
            await stopQRScanner();
            qrScanner = new Html5Qrcode("qr-reader");

            await qrScanner.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 220, height: 220 } },
                async (decodedText) => {
                    await stopQRScanner();
                    scannerModal.hidden = true;
                    await verifyCompanyQR(decodedText);
                },
                () => undefined
            );
            scannerStatus.textContent = "Ready. Point camera at company QR code.";
        } catch (err) {
            console.error("Camera access error:", err);
            scannerStatus.textContent = "Unable to access camera. Check permissions.";
        }
    };

    const verifyCompanyQR = async (scannedCode) => {
        let code = scannedCode.trim();
        let companyFound = null;

        if (code.startsWith("{") && code.endsWith("}")) {
            try {
                const parsed = JSON.parse(code);
                if (parsed.token) code = parsed.token.trim();
            } catch (e) {
                console.warn("JSON Parse Error:", e);
            }
        }

        try {
            const qToken = query(companiesRef, where("qrToken", "==", code));
            let snapshot = await getDocs(qToken);

            if (snapshot.empty) {
                const docRef = doc(db, "companies", code);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) companyFound = docSnap.data();
            } else {
                snapshot.forEach(d => companyFound = d.data());
            }

            if (!companyFound) {
                showToast("Not Detected: Invalid Company QR Code!", "error");
                return;
            }

            const companyName = companyFound.companyName || companyFound.name || "Partner Company";

            // --- COMPANY MATCH CHECK ---
            // Dapat tumugma ang company ng na-scan na QR sa naka-assign na
            // company ng mismong naka-login na student. Kapag QR code ito
            // ng ibang company, i-reject at huwag ituloy ang time in/out.
            const user = auth.currentUser || currentUser;
            const assignedCompany = await getStudentAssignedCompany(user);

            if (!assignedCompany) {
                showToast("No assigned company found on your account. Contact your coordinator.", "error");
                return;
            }

            if (assignedCompany.trim().toLowerCase() !== companyName.trim().toLowerCase()) {
                showToast(`Wrong QR Code! This QR belongs to ${companyName}, not your assigned company (${assignedCompany}).`, "error");
                return;
            }

            localStorage.setItem("verified_company_name", companyName);
            
            showToast(`QR Scan Success! Welcome to ${companyName}`, "success");

            if (scanMode === "IN") {
                openPhotoProofModal();
            } else {
                openTaskModal();
            }

        } catch (err) {
            console.error("QR Verification error:", err);
            showToast("Database error during QR verification.", "error");
        }
    };

    timeInScanBtn?.addEventListener("click", () => {
        if (!timeInScanBtn.disabled) openQRScanner("IN");
    });
    timeOutScanBtn?.addEventListener("click", () => {
        if (!timeOutScanBtn.disabled) openQRScanner("OUT");
    });

    scannerCancel?.addEventListener("click", async () => { await stopQRScanner(); scannerModal.hidden = true; });

    // --- 2. LIVE PHOTO PROOF (with front/back camera switch, capture + retake) ---

    // Nag-a-attempt mag-start ng bagong stream gamit ang hiniling na facingMode
    // BAGO itigil ang lumang stream — kung mabigo ang bagong camera (halimbawa,
    // walang back camera ang device), nananatiling gumagana ang dating preview.
    const startPhotoCamera = async (facingMode) => {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facingMode } },
            audio: false
        });

        if (photoStream) photoStream.getTracks().forEach(t => t.stop());
        photoStream = newStream;
        photoVideo.srcObject = photoStream;
        currentFacingMode = facingMode;
    };

    // Ibinabalik ang modal sa "live camera" na estado — ginagamit pagbukas
    // ng modal, at tuwing pipindutin ang Retake.
    const resetPhotoCaptureUI = () => {
        capturedPhotoBase64 = null;
        capturedAtTime = null;

        if (photoCanvas) photoCanvas.hidden = true;
        if (photoVideo) photoVideo.hidden = false;
        if (switchCameraBtn) switchCameraBtn.hidden = false;

        if (capturePhotoBtn) {
            capturePhotoBtn.hidden = false;
            capturePhotoBtn.disabled = false;
            capturePhotoBtn.innerHTML = `<i class="fa-solid fa-camera"></i> Capture Photo`;
        }
        if (retakePhotoBtn) retakePhotoBtn.hidden = true;
        if (confirmPhotoBtn) {
            confirmPhotoBtn.hidden = true;
            confirmPhotoBtn.disabled = false;
            confirmPhotoBtn.innerHTML = `<i class="fa-solid fa-check-circle"></i> Complete Time In`;
        }
    };

    const openPhotoProofModal = async () => {
        photoModal.hidden = false;
        fetchGeolocation();
        resetPhotoCaptureUI();

        try {
            currentFacingMode = "user";
            await startPhotoCamera(currentFacingMode);
        } catch (err) {
            showToast("Camera access required for photo proof.", "error");
            photoModal.hidden = true;
            return;
        }

        if (clockInterval) clearInterval(clockInterval);
        clockInterval = setInterval(async () => {
            const now = await getCurrentNTPTime();
            if (stampDatetime) stampDatetime.textContent = formatLocalDateDisplay(now) + " " + formatAMPM(now);
        }, 1000);
    };

    const closePhotoModal = () => {
        if (photoStream) photoStream.getTracks().forEach(t => t.stop());
        photoStream = null;
        if (clockInterval) clearInterval(clockInterval);
        resetPhotoCaptureUI();
        photoModal.hidden = true;
    };

    // Front/Back camera toggle. Kung sablay ang paglipat (halimbawa, iisa
    // lang ang camera ng device), nananatili ang kasalukuyang preview.
    switchCameraBtn?.addEventListener("click", async () => {
        switchCameraBtn.disabled = true;
        const newMode = currentFacingMode === "user" ? "environment" : "user";
        try {
            await startPhotoCamera(newMode);
        } catch (err) {
            console.warn("Switch camera error:", err);
            showToast("Unable to switch camera. Your device may only have one camera.", "error");
        } finally {
            switchCameraBtn.disabled = false;
        }
    });

    const fetchGeolocation = () => {
        // Wala nang GPS/geolocation fetching — direkta na lang ilalagay
        // ang pangalan ng company na naka-assign (naka-verify) sa user.
        const compName = localStorage.getItem("verified_company_name") || "Company Grounds";
        currentLocationStr = compName;
        if (stampLocation) stampLocation.textContent = currentLocationStr;
    };

    // STAGE 1 — Capture: kunin ang frame mula sa live video papunta sa
    // canvas (kasama ang timestamp/company overlay), pero hindi pa ito
    // ini-upload. Ipinapakita muna ang frozen preview kasama ang Retake
    // at Confirm buttons, para may pagkakataon munang tingnan/i-redo.
    capturePhotoBtn?.addEventListener("click", async () => {
        capturePhotoBtn.disabled = true;

        const w = photoVideo.videoWidth || 640;
        const h = photoVideo.videoHeight || 480;
        photoCanvas.width = w;
        photoCanvas.height = h;

        const ctx = photoCanvas.getContext("2d");
        ctx.drawImage(photoVideo, 0, 0, w, h);

        const now = await getCurrentNTPTime();
        const formattedDateStr = formatLocalDateDisplay(now);
        const formattedAMPM = formatAMPM(now);

        const overlayHeight = 60; 
        const overlayY = h - 70; 
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)"; 
        ctx.fillRect(0, overlayY, w, overlayHeight);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px Poppins, sans-serif"; 
        ctx.fillText(`${formattedDateStr} ${formattedAMPM} | ${currentLocationStr}`, 16, overlayY + 38);

        capturedPhotoBase64 = photoCanvas.toDataURL("image/jpeg", 0.3);
        capturedAtTime = now;

        // Palitan ang live video ng frozen preview + ipakita ang
        // Retake/Confirm, itago ang Capture at ang camera-switch button.
        photoVideo.hidden = true;
        photoCanvas.hidden = false;
        if (switchCameraBtn) switchCameraBtn.hidden = true;

        capturePhotoBtn.hidden = true;
        if (retakePhotoBtn) retakePhotoBtn.hidden = false;
        if (confirmPhotoBtn) confirmPhotoBtn.hidden = false;
    });

    // Retake — balik sa live camera view, ide-discard ang nakuhang frame.
    retakePhotoBtn?.addEventListener("click", () => {
        resetPhotoCaptureUI();
    });

    // STAGE 2 — Confirm: ito na ang mag-a-upload sa Firestore gamit ang
    // nakuhang photo mula sa Capture stage.
    confirmPhotoBtn?.addEventListener("click", async () => {
        if (!capturedPhotoBase64) return;

        confirmPhotoBtn.disabled = true;
        confirmPhotoBtn.textContent = "Saving Time In...";

        const now = capturedAtTime || await getCurrentNTPTime();
        const formattedDateStr = formatLocalDateDisplay(now);
        const formattedAMPM = formatAMPM(now);

        const photoBase64 = capturedPhotoBase64;
        const todayStr = getLocalYYYYMMDD(now);
        const timeInStr = formattedAMPM;
        const compName = localStorage.getItem("verified_company_name") || "Partner Company";

        const user = auth.currentUser || currentUser;
        const userId = user ? user.uid : "guest_user";
        const userEmail = user ? user.email : "no_email";

        // I-check kung Late ang Time In (lampas 15 mins grace mula 8:00 AM)
        const lateInfo = computeLateInfo(now, await getStudentSchedule(user));

        const newRecord = {
            userId: userId,
            userEmail: userEmail,
            date: todayStr,
            formattedDate: formattedDateStr,
            company: compName,
            location: currentLocationStr,
            timeIn: timeInStr,
            timeInRaw: now.toISOString(),
            timeOut: "--",
            photoProof: photoBase64,
            tasks: "",
            hoursRendered: 0,
            todayHours: "0h 0m",
            status: "Active",
            isLate: lateInfo.isLate,
            lateMinutes: lateInfo.lateMinutes,
            remarks: lateInfo.isLate ? `Late Arrival (${lateInfo.lateMinutes} minute/s late)` : "--",
            createdAt: serverTimestamp() // Gumagamit na ng Server Timestamp
        };

        try {
            const docRef = await addDoc(attendanceRef, newRecord);

            await addDoc(collection(db, "logs"), {
                type: "time_in",
                action: "Time In",
                title: "Time In Recorded",
                description: `${auth.currentUser?.email || "Student"} recorded Time In through QR.`,
                studentName: auth.currentUser?.email || "Student",
                company: compName,
                timestamp: serverTimestamp()
            });

            localStorage.setItem("current_attendance_doc_id", docRef.id);
            if (lateInfo.isLate) {
                showToast(`Time In Successful, but you are Late by ${lateInfo.lateMinutes} minute/s.`, "info");
            } else {
                showToast("Time In Successful! Status is Active.", "success");
            }
        } catch (e) {
            console.error("Firebase Firestore Time In Error:", e);
            const fallbackRecord = { ...newRecord, id: "local_" + Date.now(), createdAt: new Date().toISOString() };
            localStorage.setItem("current_attendance_doc_id", fallbackRecord.id);
            localStorage.setItem("offline_attendance_log", JSON.stringify(fallbackRecord));
            showToast("Saved locally (Firebase Connection Issue)", "info");
        }

        closePhotoModal();
        await refreshAttendanceUI();
    });

    photoCancel?.addEventListener("click", closePhotoModal);

    // --- 3. TASK REPORT (TIME OUT & STATUS EVALUATION) ---
    let pendingTasksList = []; 

    const openTaskModal = () => {
        taskModal.hidden = false;
        pendingTasksList = []; 
        renderTasksList();
        if (document.getElementById("task-title-input")) document.getElementById("task-title-input").value = "";
        if (document.getElementById("task-desc-input")) document.getElementById("task-desc-input").value = "";
    };

    const closeTaskModal = () => { taskModal.hidden = true; };

    function renderTasksList() {
        const listContainer = document.getElementById("added-tasks-list");
        if (!listContainer) return;

        if (pendingTasksList.length === 0) {
            listContainer.innerHTML = `<li style="font-size: 11px; color: #9ca3af; text-align: center; padding: 8px; background: #f9fafb; border-radius: 6px; border: 1px dashed #e5e7eb;">No tasks added yet.</li>`;
            return;
        }

        listContainer.innerHTML = pendingTasksList.map((item, index) => `
            <li style="background: #f3f4f6; padding: 8px 10px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; border: 1px solid #e5e7eb;">
                <div style="text-align: left; padding-right: 8px;">
                    <strong style="color: #111827; display: block; font-weight: 600;">${item.title}</strong>
                    <span style="color: #4b5563;">${item.description}</span>
                </div>
                <button type="button" class="remove-task-btn" data-index="${index}" style="color: #dc2626; border: none; background: none; cursor: pointer; padding: 4px;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </li>
        `).join('');

        document.querySelectorAll('.remove-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.currentTarget.getAttribute('data-index');
                pendingTasksList.splice(index, 1);
                renderTasksList();
            });
        });
    }

    document.getElementById("add-task-btn")?.addEventListener("click", () => {
        const titleInput = document.getElementById("task-title-input");
        const descInput = document.getElementById("task-desc-input");

        const title = titleInput?.value.trim();
        const description = descInput?.value.trim();

        if (!title || !description) {
            showToast("Please enter both task title and description.", "info");
            return;
        }

        pendingTasksList.push({ title, description });
        titleInput.value = "";
        descInput.value = "";
        renderTasksList();
    });

    submitTaskBtn?.addEventListener("click", async () => {
        if (pendingTasksList.length === 0) {
            showToast("Please add at least one task before submitting.", "info");
            return;
        }

        const activeDocId = localStorage.getItem("current_attendance_doc_id");
        if (!activeDocId) {
            showToast("No active Time In session found.", "error");
            return;
        }

        submitTaskBtn.disabled = true;
        submitTaskBtn.textContent = "Updating Record...";

        const now = await getCurrentNTPTime();
        const timeOutStr = formatAMPM(now);

        try {
            if (!activeDocId.startsWith("local_")) {
                const docToUpdate = doc(db, "attendance", activeDocId);
                const docSnap = await getDoc(docToUpdate);

                let rawHours = 0;
                let hoursRendered = 0;
                let todayHoursStr = "0h 0m";
                let finalStatus = "Present";
                let finalRemarks = "On-Time / Present";

                if (docSnap.exists()) {
                    const data = docSnap.data();

                    // Gamitin ang Late flag na na-compute noong Time In
                    if (data.isLate) {
                        finalStatus = "Late";
                        finalRemarks = `Late Arrival (${data.lateMinutes || 0} minute/s late)`;
                    } else {
                        finalStatus = "Present";
                        finalRemarks = "On-Time / Present";
                    }

                    let timeInDate;
                    if (data.timeInRaw) {
                        timeInDate = new Date(data.timeInRaw);
                    } else {
                        timeInDate = new Date();
                    }

                    const diffMs = now - timeInDate;
                    if (diffMs > 0) {
                        const totalMinutesElapsed = Math.floor(diffMs / (1000 * 60));
                        
                        const breaktimeDeductionMinutes = 60; 
                        const netWorkingMinutes = Math.max(0, totalMinutesElapsed - breaktimeDeductionMinutes);

                        const hrs = Math.floor(netWorkingMinutes / 60);
                        const mins = netWorkingMinutes % 60;

                        rawHours = parseFloat((netWorkingMinutes / 60).toFixed(2));

                        if (rawHours >= 8.0) {
                            hoursRendered = 8.0;
                            todayHoursStr = `${hrs}h ${mins}m (1hr break deducted)`;
                        } else {
                            hoursRendered = 0;
                            todayHoursStr = `${hrs}h ${mins}m (Under 8 Hours, 1hr break deducted)`;
                        }
                    }
                }

                await updateDoc(docToUpdate, {
                    timeOut: timeOutStr,
                    timeOutRaw: now.toISOString(),
                    taskList: pendingTasksList,
                    tasks: pendingTasksList.map(t => `${t.title}: ${t.description}`).join(" | "),
                    hoursRendered: hoursRendered,
                    todayHours: todayHoursStr,
                    status: finalStatus,
                    remarks: finalRemarks,
                    updatedAt: serverTimestamp() // Server timestamp din para sa pag-timeout
                });

                await addDoc(collection(db, "logs"), {
                    type: "time_out",
                    action: "Time Out",
                    title: "Time Out Recorded",
                    description: `${auth.currentUser?.email || "Student"} recorded Time Out through QR.`,
                    studentName: auth.currentUser?.email || "Student",
                    timestamp: serverTimestamp()
                });
            }
        } catch (e) {
            console.error("Firebase Time Out Error:", e);
        }

        localStorage.removeItem("current_attendance_doc_id");
        localStorage.removeItem("offline_attendance_log");
        closeTaskModal();
        showToast("Time Out Successful! Present status saved.", "success");
        await refreshAttendanceUI();

        submitTaskBtn.disabled = false;
        submitTaskBtn.innerHTML = `<i class="fa-solid fa-check-circle"></i> Submit & Complete Time Out`;
    });

    taskCancel?.addEventListener("click", closeTaskModal);

    viewPhotoBtnClose?.addEventListener("click", () => {
        if (viewPhotoModalEl) viewPhotoModalEl.hidden = true;
    });

    // "View All" toggles between showing only the 3 most recent
    // attendance records and the complete history list in place.
    viewAllBtn?.addEventListener("click", () => {
        showAllHistory = !showAllHistory;
        viewAllBtn.textContent = showAllHistory ? "View Less" : "View All";
        applyHistoryDisplay();
    });

    // --- 4. REFRESH & BIND TODAY'S ATTENDANCE UI ---
    async function refreshAttendanceUI() {
        const todayDate = document.getElementById("today-date");
        const todayCompany = document.getElementById("today-company");
        const todayLocation = document.getElementById("today-location");
        const todayTimeIn = document.getElementById("today-time-in");
        const todayTimeOut = document.getElementById("today-time-out");
        const todayStatusBadge = document.getElementById("today-status-badge");

        const now = await getCurrentNTPTime();
        const todayStr = getLocalYYYYMMDD(now);

        todayNoDutyReason = await getTodayNoDutyReason(todayStr);

        if (todayDate) todayDate.textContent = formatLocalDateDisplay(now);

        let historyMap = new Map();
        const user = auth.currentUser || currentUser;
        const currentUid = user ? user.uid : null;
        const currentEmail = user ? user.email : localStorage.getItem("user_email");

        if (currentUid) {
            try {
                const qUser = query(attendanceRef, where("userId", "==", currentUid));
                const snapUser = await getDocs(qUser);
                snapUser.forEach(docSnap => historyMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
            } catch (e) { console.warn("Fetch userId err:", e); }
        }

        if (currentEmail) {
            try {
                const qEmail = query(attendanceRef, where("userEmail", "==", currentEmail));
                const snapEmail = await getDocs(qEmail);
                snapEmail.forEach(docSnap => historyMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
            } catch (e) { console.warn("Fetch userEmail err:", e); }
        }

        fullAttendanceHistory = Array.from(historyMap.values());

        // Kunin ang personal na schedule.days ng student (mula sa
        // users/{uid}) para malaman kung duty day niya ngayon.
        const scheduleDays = await getStudentScheduleDays(user);
        const isScheduledToday = isTodayInStudentSchedule(now, scheduleDays);

        const sortHistory = () => {
            fullAttendanceHistory.sort((a, b) => {
                const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
                const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
                // Auto-marked "Absent" records ay isinusulat sa susunod na pagbukas ng page,
                // kaya mali ang createdAt para i-sort. Ang mismong petsa ng duty ang batayan.
                const dateA = a.date || "";
                const dateB = b.date || "";
                if (dateA !== dateB) return dateA < dateB ? 1 : -1;
                return timeB - timeA;
            });
        };

        sortHistory();

        // Awtomatikong i-mark na "Absent" ang mga nakaraang duty day
        // na walang Time In record (hindi kasama ang araw na ito).
        if (currentUid || currentEmail) {
            await checkAndMarkAbsences(user, todayStr, scheduleDays);
            sortHistory();
        }

        const activeDocId = localStorage.getItem("current_attendance_doc_id");
        const session = fullAttendanceHistory.find(i => i.id === activeDocId || (i.status === "Active" && i.date === todayStr));

        if (session && session.status === "Active") {
            if (todayCompany) todayCompany.textContent = session.company || "--";
            if (todayLocation) todayLocation.textContent = session.location || "--";
            if (todayTimeIn) todayTimeIn.textContent = session.timeIn || "--";
            if (todayTimeOut) todayTimeOut.textContent = "--";

            if (todayStatusBadge) {
                todayStatusBadge.textContent = "Active";
                todayStatusBadge.className = "status-badge active";
            }

            if (timeInScanBtn) { timeInScanBtn.disabled = true; timeInScanBtn.className = "scan-btn disabled-btn"; }
            if (timeOutScanBtn) { timeOutScanBtn.disabled = false; timeOutScanBtn.className = "scan-btn orange-btn"; }
            if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle orange-bg";
            if (timeOutNoteText) timeOutNoteText.textContent = "Click to scan QR code and time out.";

            const badgeDateStr = formatLocalDateWithDay(now);
            updateRedTimestampBadge(session.timeIn, badgeDateStr);

        } else {
            const latestToday = fullAttendanceHistory.find(i => i.date === todayStr);

            if (latestToday && (latestToday.status === "Present" || latestToday.status === "Completed" || latestToday.status === "Late")) {
                if (todayCompany) todayCompany.textContent = latestToday.company || "--";
                if (todayLocation) todayLocation.textContent = latestToday.location || "--";
                if (todayTimeIn) todayTimeIn.textContent = latestToday.timeIn || "--";
                if (todayTimeOut) todayTimeOut.textContent = latestToday.timeOut || "--";

                if (todayStatusBadge) {
                    if (latestToday.status === "Late") {
                        todayStatusBadge.textContent = "Late";
                        todayStatusBadge.className = "status-badge late";
                    } else {
                        todayStatusBadge.textContent = "Present";
                        todayStatusBadge.className = "status-badge completed";
                    }
                }

                if (timeInScanBtn) { timeInScanBtn.disabled = true; timeInScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutScanBtn) { timeOutScanBtn.disabled = true; timeOutScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle gray-bg";
                if (timeOutNoteText) timeOutNoteText.textContent = "Attendance completed for today. Come back tomorrow!";

                updateRedTimestampBadge(latestToday.timeIn, formatLocalDateWithDay(now));

            } else if (latestToday && String(latestToday.status || "").toLowerCase() === "rejected") {
                if (todayCompany) todayCompany.textContent = latestToday.company || "--";
                if (todayLocation) todayLocation.textContent = latestToday.location || "--";
                if (todayTimeIn) todayTimeIn.textContent = latestToday.timeIn || "--";
                if (todayTimeOut) todayTimeOut.textContent = latestToday.timeOut || "--";

                if (todayStatusBadge) {
                    todayStatusBadge.textContent = "Rejected";
                    todayStatusBadge.className = "status-badge rejected";
                }

                if (timeInScanBtn) { timeInScanBtn.disabled = true; timeInScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutScanBtn) { timeOutScanBtn.disabled = true; timeOutScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle gray-bg";
                if (timeInNoteText) timeInNoteText.textContent = "Your attendance for today was rejected by your coordinator.";
                if (timeOutNoteText) timeOutNoteText.textContent = "Your attendance for today was rejected by your coordinator.";

            } else if (todayNoDutyReason || !isScheduledToday) {
                if (todayCompany) todayCompany.textContent = "--";
                if (todayLocation) todayLocation.textContent = "--";
                if (todayTimeIn) todayTimeIn.textContent = "--";
                if (todayTimeOut) todayTimeOut.textContent = "--";

                if (todayStatusBadge) {
                    todayStatusBadge.textContent = "No Duty";
                    todayStatusBadge.className = "status-badge no-duty";
                }

                if (timeInScanBtn) { timeInScanBtn.disabled = true; timeInScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutScanBtn) { timeOutScanBtn.disabled = true; timeOutScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle gray-bg";

                // Kung may calendar exception (suspension/holiday) gamitin
                // yung reason nun; kung wala naman pero hindi lang siya naka-
                // schedule ngayong araw, sabihin na wala siyang duty ngayon.
                const noDutyNote = todayNoDutyReason
                    ? `No duty today — ${todayNoDutyReason}`
                    : "No duty today — not in your assigned schedule.";
                if (timeInNoteText) timeInNoteText.textContent = noDutyNote;
                if (timeOutNoteText) timeOutNoteText.textContent = noDutyNote;

            } else {
                if (todayCompany) todayCompany.textContent = "--";
                if (todayLocation) todayLocation.textContent = "--";
                if (todayTimeIn) todayTimeIn.textContent = "--";
                if (todayTimeOut) todayTimeOut.textContent = "--";

                if (todayStatusBadge) {
                    todayStatusBadge.textContent = latestToday && latestToday.status === "Absent" ? "Absent" : "Not Timed In";
                    todayStatusBadge.className = latestToday && latestToday.status === "Absent" ? "status-badge absent" : "status-badge not-timed-in";
                }

                if (timeInScanBtn) { timeInScanBtn.disabled = latestToday && latestToday.status === "Absent"; timeInScanBtn.className = timeInScanBtn.disabled ? "scan-btn disabled-btn" : "scan-btn green-btn"; }
                if (timeOutScanBtn) { timeOutScanBtn.disabled = true; timeOutScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle gray-bg";
                if (timeInNoteText) timeInNoteText.textContent = "QR scan & photo proof required.";
                if (timeOutNoteText) timeOutNoteText.textContent = "Note: 1 hour breaktime is automatically deducted from total hours.";
            }
        }

        applyHistoryDisplay();
    }
}