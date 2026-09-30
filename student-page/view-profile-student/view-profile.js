/* ==========================================
   STUDENT PROFILE PAGE
   OJT-LOGS  |  Firebase Connected
   ==========================================
   Loaded as: <script type="module" src="profile.js"></script>
   Binabasa ang parehong users/{uid} document na ginagamit
   ng student dashboard at attendance page.
========================================== */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadHeader, getInitials } from "../templated/header-loader.js";

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
// kaya walang duplicate-app error kahit alin ang unang tumakbo.
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

const LOGIN_PAGE = "../student_login/student_login.html";
const DEFAULT_REQUIRED_HOURS = 600;


/* ==========================================
   HELPERS
========================================== */

const $ = (id) => document.getElementById(id);

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = (value === undefined || value === null || value === "") ? "\u2014" : value;
}

// Unang field na may laman
function pick(data, fields) {
    for (const field of fields) {
        const value = data[field];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value).trim();
        }
    }
    return "";
}

/*
    firstName / middleName / lastName, o isang fullName / name lang.
    Kapag isa lang ang meron, hahatiin para mapunan pa rin ang tatlong field.
*/
function resolveName(data, user) {

    let first = (data.firstName || "").trim();
    let middle = (data.middleName || "").trim();
    let last = (data.lastName || "").trim();

    const single = (data.fullName || data.name || user.displayName || "").trim();

    if (!first && !last && single) {
        const parts = single.split(/\s+/);
        first = parts[0];
        if (parts.length > 1) last = parts[parts.length - 1];
        if (parts.length > 2) middle = parts.slice(1, -1).join(" ");
    }

    const full =
        (first && last)
            ? [first, middle, last].join(" ").replace(/\s+/g, " ").trim()
            : single || first || last;

    return { first, middle, last, full };
}

function paintAvatar(element, photo, name) {

    if (!element) return;

    const initials = getInitials(name);

    if (!photo) {
        element.textContent = initials;
        return;
    }

    element.innerHTML = "";

    const img = document.createElement("img");
    img.alt = name || "Profile photo";
    img.src = photo;
    img.onerror = () => { element.textContent = initials; };

    element.appendChild(img);
}

// 31.8166 -> "31h 49m"  (parehong format ng Hours Completed sa dashboard)
function hoursToHM(hoursFloat) {
    const totalMinutes = Math.round((hoursFloat || 0) * 60);
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

/* ==========================================
   SCHEDULE + ATTENDANCE
   Ang present / late / absent ay base lang sa
   schedule na naka-save sa users/{uid}.
========================================== */

// Parehong collection/field na ginagamit ng student dashboard
const ATTENDANCE_COLLECTION = "attendance";
const ATTENDANCE_UID_FIELD = "userId";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "08:00" o "8:30 AM" -> minuto mula hatinggabi (null kung hindi mabasa)
function parseTime(value) {
    if (value === undefined || value === null) return null;
    const m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return h * 60 + min;
}

function formatTime(mins) {
    if (mins === null) return "";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function dayIndex(value) {
    if (typeof value === "number") return value;
    const s = String(value || "").trim().toLowerCase();
    return DAY_NAMES.findIndex((d) => d.toLowerCase() === s || d.slice(0, 3).toLowerCase() === s.slice(0, 3));
}

/*
    users/{uid}.schedule, gaya ng sa Students page:
      { days: ["Monday", ...],
        morning:   { timeIn, timeOut, morningEnabled },
        afternoon: { timeIn, timeOut, afternoonEnabled } }
    Ibabalik: { days: [0-6], sessions: [{ key, start, end }], start, end } o null
    (start = simula ng unang session, end = katapusan ng huling session)
*/
function normalizeSchedule(sched) {

    if (!sched || typeof sched !== "object") return null;

    const rawDays = Array.isArray(sched.days)
        ? sched.days
        : (sched.days && typeof sched.days === "object" ? Object.values(sched.days) : []);

    const days = [...new Set(rawDays.map(dayIndex).filter((i) => i >= 0))];

    const sessions = [];

    [["morning", "morningEnabled"], ["afternoon", "afternoonEnabled"]].forEach(([key, flag]) => {
        const s = sched[key];
        if (!s || sched[flag] === false || s[flag] === false || s.enabled === false) return;

        const start = parseTime(s.timeIn ?? s.time_in ?? s.start);
        const end = parseTime(s.timeOut ?? s.timeout ?? s.time_out ?? s.end);

        if (start !== null && end !== null) sessions.push({ key, start, end });
    });

    if (!days.length || !sessions.length) return null;

    return {
        days,
        sessions,
        start: Math.min(...sessions.map((s) => s.start)),
        end: Math.max(...sessions.map((s) => s.end))
    };
}

// "On-site" / "Work From Home" galing sa users/{uid}.schedule.modality
function renderModality(modality) {

    const el = $("fModality");
    if (!el) return;

    const value = String(modality || "").trim();

    if (!value) {
        el.textContent = "\u2014";
        return;
    }

    const isWfh = /home|wfh|remote/i.test(value);

    el.innerHTML = isWfh
        ? '<span class="modality-pill wfh"><i class="fa-solid fa-house"></i>Work From Home</span>'
        : '<span class="modality-pill onsite"><i class="fa-solid fa-building"></i>On-site</span>';
}

function renderSchedule(schedule) {

    const box = $("scheduleBox");
    if (!box) return;

    if (!schedule) {
        box.innerHTML = '<span class="sched-empty">No schedule assigned yet</span>';
        return;
    }

    const badges = schedule.sessions.map((s) => {
        const label = s.key === "morning" ? "Morning" : "Afternoon";
        return `<span class="schedule-badge ${s.key}">${label}: ${formatTime(s.start)} - ${formatTime(s.end)}</span>`;
    }).join("");

    const today = new Date().getDay();

    const chips = DAY_NAMES.map((day, i) => {
        const cls = ["day-chip", schedule.days.includes(i) ? "active" : "", i === today ? "today" : ""].join(" ").trim();
        return `<span class="${cls}" title="${day}">${day.charAt(0)}</span>`;
    }).join("");

    box.innerHTML = `<div class="schedule-badges">${badges}</div><div class="day-chips">${chips}</div>`;
}

// Local "YYYY-MM-DD"
function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// String, Firestore Timestamp, o Date -> "YYYY-MM-DD"
function toDateKey(value) {
    if (!value) return "";
    if (typeof value === "string") return value.slice(0, 10);
    if (typeof value.toDate === "function") return dateKey(value.toDate());
    if (value instanceof Date) return dateKey(value);
    return "";
}

/*
    Bilang mula mismo sa attendance records ng student (attendance where userId == uid),
    gaya ng student dashboard at coordinator Attendance page.
    - Ang "Absent" ay records na may status "Absent" (isinusulat ng attendance.js
      para sa bawat na-miss na scheduled duty day, kaya kasama na ang holiday/exception rules).
    - "Late" / "Present": ginagamit muna ang status ng record; kung walang malinaw na status,
      ikinukumpara ang timeIn sa simula ng session sa schedule ng user.
    - Excused at Rejected ay hindi binibilang sa tatlo.
*/
function classifyRecord(rec, schedule) {

    const status = String(rec.status || "").trim().toLowerCase();

    if (status.includes("absent")) return "absent";
    if (status.includes("excus") || status.includes("reject")) return null;
    if (status.includes("late")) return "late";
    if (status.includes("present")) return "present";

    // Walang malinaw na status -> tingnan ang timeIn laban sa schedule
    const timeIn = parseTime(rec.timeIn ?? rec.time_in);
    if (timeIn === null) return null;   // wala pang time-in, hindi mabibilang

    if (!schedule) return "present";

    const sessions = [...schedule.sessions].sort((a, b) => a.start - b.start);
    const target = sessions.find((s) => timeIn <= s.end) || sessions[sessions.length - 1];

    return timeIn > target.start ? "late" : "present";
}

async function loadAttendance(user, schedule) {

    const result = { present: 0, late: 0, absent: 0 };

    let snap;
    try {
        snap = await getDocs(query(collection(db, ATTENDANCE_COLLECTION), where(ATTENDANCE_UID_FIELD, "==", user.uid)));
    } catch (error) {
        console.error("Error loading attendance:", error);
        return result;
    }

    // Isang record kada araw (kung may doble, mas pinipili yung may timeIn)
    const byDate = new Map();

    snap.forEach((d) => {
        const rec = d.data();
        const key = toDateKey(rec.date ?? rec.dateKey);
        if (!key) return;

        const existing = byDate.get(key);
        if (!existing || (!existing.timeIn && rec.timeIn)) byDate.set(key, rec);
    });

    byDate.forEach((rec) => {
        const kind = classifyRecord(rec, schedule);
        if (kind) result[kind]++;
    });

    return result;
}

function initSidebar(activeMenuName) {
    const menuItems = document.querySelectorAll(".menu li");
    menuItems.forEach((item) => {
        const spanText = item.querySelector("span")?.textContent.trim();
        const isActive = spanText && spanText.toLowerCase() === activeMenuName.toLowerCase();
        item.classList.toggle("active", Boolean(isActive));
    });
}


/* ==========================================
   PAGE START
========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    // Header (bell, avatar, dropdown) ay in-i-inject nang async - hintayin muna.
    await loadHeader("My Profile", { autoLoadProfile: true });

    fetch("../templated/sidebar.html?v=" + new Date().getTime())
        .then((response) => response.ok ? response.text() : Promise.reject())
        .then((html) => {
            const sidebarContainer = $("sidebar-container");
            if (sidebarContainer) sidebarContainer.innerHTML = html;
            // Walang "Profile" sa sidebar menu, kaya walang naka-active - ayos lang.
            initSidebar("Profile");
        })
        .catch((err) => console.error("Error loading sidebar:", err));

    initTabs();

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = LOGIN_PAGE;
            return;
        }

        let data = {};

        try {
            const snap = await getDoc(doc(db, "users", user.uid));
            data = snap.exists() ? snap.data() : {};
        } catch (error) {
            console.error("Error loading profile:", error);
        }

        render(user, data);
    });
});


/* ==========================================
   RENDER
========================================== */

function render(user, data) {

    const name = resolveName(data, user);
    const displayName = name.full || (user.email ? user.email.split("@")[0] : "Student Intern");

    const photo =
        data.photoBase64 ||
        data.photoURL ||
        data.photo ||
        data.profilePic ||
        data.image ||
        data.avatar ||
        user.photoURL ||
        "";

    const deactivated = String(data.accountStatus || "").toLowerCase() === "deactivated";
    const statusLabel = deactivated ? "Deactivated" : "Active";

    const created = user.metadata?.creationTime;

    /* ---------- HERO ---------- */

    setText("heroName", displayName);
    paintAvatar($("heroAvatar"), photo, displayName);

    $("heroDot")?.classList.toggle("off", deactivated);

    setText(
        "chipJoined",
        created
            ? "Joined " + new Date(created).toLocaleDateString("en-PH", { month: "short", year: "numeric" })
            : ""
    );

    const chipStatus = $("chipStatus");
    if (chipStatus) {
        chipStatus.classList.toggle("off", deactivated);
        chipStatus.innerHTML = `<i class="fa-solid fa-circle"></i>${statusLabel}`;
    }

    /* ---------- OJT NUMBERS ---------- */

    const requiredHours = Number(data.requiredHours) || DEFAULT_REQUIRED_HOURS;
    const completedHours = Math.max(0, Number(data.completedHours) || 0);
    const remainingHours = Math.max(0, requiredHours - completedHours);
    const percent = Math.min(100, Math.round((completedHours / requiredHours) * 100));

    setText("statDone", hoursToHM(completedHours));
    setText("statRequired", `${requiredHours} hrs`);
    setText("statProgress", `${percent}%`);

    /* ---------- PERSONAL ---------- */

    setText("fFull", name.full);
    setText("fFirst", name.first);
    setText("fMiddle", name.middle);
    setText("fLast", name.last);
    setText("fStudentNo", pick(data, ["studentNumber", "studentNo", "studentId", "idNumber", "schoolId"]));
    setText("fCourse", pick(data, ["course", "program", "degree"]));
    setText("fSection", pick(data, ["section"]));

    const fStatus = $("fStatus");
    if (fStatus) {
        fStatus.innerHTML = `<span class="pill ${deactivated ? "off" : "ok"}">${statusLabel}</span>`;
    }

    /* ---------- CONTACT ---------- */

    setText("fEmail", user.email || data.email);
    setText("fPhone", pick(data, ["phone", "contactNumber", "mobile", "phoneNumber"]));
    setText("fAddress", pick(data, ["address", "homeAddress"]));

    /* ---------- OJT ---------- */

    setText("fCompany", pick(data, ["companyName", "company"]));
    setText("fSupervisor", pick(data, ["supervisorName", "supervisor"]));
    setText("fRequired", `${requiredHours} hrs`);
    setText("fDone", hoursToHM(completedHours));
    setText("fRemaining", hoursToHM(remainingHours));

    setText("ojtPercent", `${percent}%`);
    const bar = $("ojtBar");
    if (bar) bar.style.width = `${percent}%`;

    /* ---------- SCHEDULE + ATTENDANCE ---------- */

    const schedule = normalizeSchedule(data.schedule);
    renderSchedule(schedule);
    renderModality(data.schedule?.modality);

    loadAttendance(user, schedule).then((counts) => {
        setText("statPresent", String(counts.present));
        setText("statLate", String(counts.late));
        setText("statAbsent", String(counts.absent));
    });
}


/* ==========================================
   TABS
========================================== */

function initTabs() {

    const tabs = Array.from(document.querySelectorAll(".tab"));

    function select(name) {
        tabs.forEach((tab) => {
            const on = tab.dataset.tab === name;
            tab.classList.toggle("active", on);
            tab.setAttribute("aria-selected", String(on));
            const panel = $("panel-" + tab.dataset.tab);
            if (panel) panel.hidden = !on;
        });
    }

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            select(tab.dataset.tab);
            history.replaceState(null, "", "#" + tab.dataset.tab);
        });
    });

    // Deep link, e.g. profile.html#ojt
    const fromHash = location.hash.replace("#", "");

    if (tabs.some((tab) => tab.dataset.tab === fromHash)) {
        select(fromHash);
    }
}