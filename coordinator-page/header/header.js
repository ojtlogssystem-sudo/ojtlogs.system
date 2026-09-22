/* ================================================================
   SHARED COORDINATOR HEADER (logic)
   ================================================================
   Isang beses lang ito i-eedit kapag may babaguhin sa header
   (profile dropdown, notification bell, logout, page title/
   subtitle) - awtomatiko nang maaapply ang bago sa LAHAT ng
   coordinator page na naglo-load ng file na ito.

   PAANO GAMITIN SA IBANG PAGE:

       <header
           id="header-container"
           data-page-title="Attendance"
           data-page-subtitle="Monitor student attendance and view complete attendance records."
       ></header>

       <link rel="stylesheet" href="../header/header.css">
       <script type="module" src="../header/header.js"></script>

   - data-page-title: text na lalabas sa <h2> ng header.
   - data-page-subtitle: text sa ilalim ng title. Kung gusto mong
     lumabas dito ang pangalan ng naka-login na coordinator (tulad
     ng sa Dashboard na "Welcome back, Juan."), maglagay ng {name}
     placeholder sa loob ng subtitle, hal:
         data-page-subtitle="Welcome back, {name}."
     Papalitan ito ni header.js ng aktwal na pangalan pagkatapos
     ma-fetch ang profile mula sa Firestore.

   NOTIFICATIONS (bell) - 4 na klase, live (walang refresh):
     1) Weekly report na na-submit ng estudyante   ("weekly_reports")
     2) At-risk na estudyante                      ("analytics", aiStatus = "At Risk")
     3) Na-evaluate ng supervisor ang estudyante   (EVALUATIONS_COLLECTION sa ibaba)
     4) Natapos ng estudyante ang profile          ("users", profileCompleted = true)
   Ang mga setting (pangalan ng collection, mga field, link) ay nasa
   "NOTIFICATION SETTINGS" sa ibaba ng import section.

   SCHOOL YEAR SELECTOR (opt-in, Reports page lang):

       <header
           id="header-container"
           data-page-title="Reports"
           data-page-subtitle="..."
           data-school-year
       ></header>

   - Kapag may  data-school-year,  lalabas ang school year dropdown
     sa header (current school year ang naka-select). Kapag WALA,
     tinatanggal ito ni header.js, kaya sa Reports page lang ito
     makikita ng user.
   - Nagpapadala ang header ng dalawang event sa  document:
         "header:ready"             -> tapos nang ma-load ang header
                                       (detail.schoolYear = {value, label} o null)
         "header:schoolyearchange"  -> nagpalit ng school year
                                       (detail = {value: "2026-2027", label: "2026 \u2013 2027"})
     Ang page script (ex. reports.js) ang makikinig sa mga ito.
================================================================= */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

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
    onSnapshot,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// ========================================
// FIREBASE (reuse the app if some other
// script on the page already initialized
// it, para hindi mag-crash sa "duplicate
// app" error)
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// ========================================
// NOTIFICATION SETTINGS
// ========================================

// Maximum na bilang ng notification na ipinapakita sa bell
const NOTIF_MAX_ITEMS = 30;

// AT-RISK: binabasa ang "analytics" collection na sinusulatan ng
// Flask AI (app.py) - ang status ay eksaktong "At Risk".
const ANALYTICS_COLLECTION = "analytics";
const AT_RISK_STATUS = "At Risk";

// SUPERVISOR EVALUATION: pangalan ng Firestore collection kung saan
// nase-save ang evaluation ng supervisor. PALITAN kung iba ang tawag
// sa Firebase mo (ex. "supervisor_evaluations").
const EVALUATIONS_COLLECTION = "evaluations";

// Mga field ng evaluation document - ayon sa Companies page
// (companies.js / guest evaluation form):
//   internId, internName, companyName, evaluatorName, ...
// Ang mga ibang pangalan ay pang-backup lang. Kukunin ang una na may laman.
const EVAL_STUDENT_ID_FIELDS = ["internId", "studentId", "studentUid", "userId", "uid"];
const EVAL_STUDENT_NAME_FIELDS = ["internName", "studentName", "student"];
const EVAL_SUPERVISOR_FIELDS = ["evaluatorName", "supervisorName", "evaluatedBy", "supervisor", "companySupervisor"];
const EVAL_COMPANY_FIELDS = ["companyName", "company"];
const EVAL_TIME_FIELDS = ["submittedAt", "evaluatedAt", "createdAt", "timestamp", "updatedAt", "dateAccomplished", "date"];

// Evaluation na mas luma rito (sa araw) ay hindi na ilalabas sa bell
// para hindi bumaha ng "unread" ang mga lumang record.
const NOTIF_EVALUATION_MAX_AGE_DAYS = 30;

// PROFILE COMPLETED: lumalabas kapag natapos ng estudyante ang pagsagot
// ng profile information pagkatapos gumawa ng account (profile.js ang
// nagse-set ng users/{uid}.profileCompleted = true at profileCompletedAt).
// Ang mga lumang record (walang profileCompletedAt) ay sinusubaybayan
// ayon sa unang pagkakita, at ang mga nauna nang natapos bago mag-umpisa
// ang tracking ay hindi ilalabas (para hindi bumaha ang bell).
const NOTIF_PROFILE_MAX_AGE_DAYS = 30;

// Saan pupunta kapag pinindot ang notification (null = walang pupuntahan).
// Ang at-risk ay pupunta sa Analytics page - baguhin kung iba ang folder.
const NOTIF_LINKS = {
    report: null,
    risk: "../analytics/analytics.html",
    evaluation: null,
    profile: null
};


// ========================================
// NOTIFICATION STATE
// ========================================

let studentNameMap = {};

// Hiwalay ang listahan ng bawat klase, tapos pinagsasama at
// inaayos ayon sa pinakabago (see rebuildNotifications).
let notifBuckets = { report: [], risk: [], evaluation: [], profile: [] };
let notifItems = [];

let notifLastSeenAt = 0;
let notifStorageKey = "coordinatorNotifLastSeen";

// Mga notification na pinindot na ang "Mark all as read" (by id + oras).
// Hiwalay ito sa notifLastSeenAt dahil ang oras lang ay hindi sapat: kapag
// mas maaga ang orasan ng server (o may petsang nasa hinaharap) kaysa sa
// computer, mananatiling "unread" ang notification at hindi mawawala ang badge.
const NOTIF_READ_KEYS_MAX = 300;
let notifReadKeys = new Set();
let notifReadKeysStorageKey = "coordinatorNotifReadKeys";
let notifUnsubscribers = [];


// ========================================
// LOAD + WIRE UP THE HEADER
// ========================================

async function loadHeader() {

    const container =
        document.getElementById("header-container");

    if (!container) {
        return;
    }

    const pageTitle =
        container.getAttribute("data-page-title") || "Dashboard";

    const pageSubtitleTemplate =
        container.getAttribute("data-page-subtitle") ||
        "Welcome back, {name}.";

    try {

        // Resolve the partial relative to header.js itself, so this
        // still works regardless of which page (and folder depth)
        // included it.
        const partialUrl =
            new URL("header.html", import.meta.url);

        const response =
            await fetch(partialUrl);

        container.innerHTML =
            await response.text();

    } catch (error) {

        console.error("Could not load shared header:", error);
        return;

    }

    const titleEl =
        document.getElementById("headerPageTitle");

    if (titleEl) {
        titleEl.textContent = pageTitle;
    }

    // Ilalagay muna ang subtitle na may "Coordinator" bilang
    // default placeholder - papalitan ito ng tunay na pangalan
    // pagkatapos ma-fetch ang profile (see updateProfileUI).
    applySubtitle(pageSubtitleTemplate, "Coordinator");

    const schoolYear = initSchoolYearSelect(container);

    initProfileMenu();
    initNotificationDropdown();
    initLogout();

    // Sabihan ang page script na tapos nang ma-inject ang header
    // (asynchronous ang pag-load nito, kaya hindi puwedeng
    // basta-basta hanapin ang mga element sa DOMContentLoaded).
    document.dispatchEvent(
        new CustomEvent("header:ready", {
            detail: { schoolYear }
        })
    );

    onAuthStateChanged(auth, async (user) => {

        if (!user) {

            window.location.href =
                "../student_login/student_login.html";

            return;

        }

        try {

            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            const userData =
                userDoc.exists() ? userDoc.data() : {};

            updateProfileUI(userData, user, pageSubtitleTemplate);

            startNotifications(user.uid);

        } catch (error) {

            console.error(
                "Error fetching coordinator details for header:",
                error
            );

        }

    });

}


// ========================================
// SCHOOL YEAR SELECTOR (opt-in via data-school-year)
// ========================================

// Current school year + ilang nakaraan. Nagsisimula ang school
// year tuwing June (ex. Sept 2026 -> "2026 - 2027").
function getSchoolYearOptions(count = 4) {

    const now = new Date();

    const startYear =
        now.getMonth() >= 5
            ? now.getFullYear()
            : now.getFullYear() - 1;

    return Array.from({ length: count }, (_, i) => {

        const year = startYear - i;

        return {
            value: `${year}-${year + 1}`,
            label: `${year} \u2013 ${year + 1}`
        };

    });

}


function initSchoolYearSelect(container) {

    const wrap =
        document.getElementById("headerSchoolYear");

    if (!wrap) return null;

    // Hindi hiningi ng page -> tanggalin, para hindi lumabas
    // sa ibang coordinator page (dashboard, attendance, atbp.)
    if (!container.hasAttribute("data-school-year")) {

        wrap.remove();

        return null;

    }

    const select =
        document.getElementById("schoolYearSelect");

    const options = getSchoolYearOptions();

    select.innerHTML =
        options
            .map(o => `<option value="${o.value}">${o.label}</option>`)
            .join("");

    select.value = options[0].value;

    const current = () => {

        const chosen =
            options.find(o => o.value === select.value) || options[0];

        return { value: chosen.value, label: chosen.label };

    };

    select.addEventListener("change", () => {

        document.dispatchEvent(
            new CustomEvent("header:schoolyearchange", {
                detail: current()
            })
        );

    });

    return current();

}


function applySubtitle(template, name) {

    const subtitleEl =
        document.getElementById("headerPageSubtitle");

    if (!subtitleEl) {
        return;
    }

    if (template.includes("{name}")) {

        subtitleEl.textContent =
            template.replace("{name}", name);

    } else {

        subtitleEl.textContent = template;

    }

}


// ========================================
// PROFILE UI
// ========================================

function updateProfileUI(userData, authUser, pageSubtitleTemplate) {

    const fullName =
        userData.name ||
        userData.fullName ||
        authUser.displayName ||
        "OJT Coordinator";

    const role =
        userData.role ||
        userData.position ||
        "Coordinator";

    const userName =
        document.getElementById("userName");

    const userRole =
        document.getElementById("userRole");

    const userAvatar =
        document.getElementById("userAvatar");

    if (userName) {
        userName.textContent = fullName;
    }

    if (userRole) {
        userRole.textContent = role.toUpperCase();
    }

    applySubtitle(pageSubtitleTemplate, fullName);

    // Profile photo, if the coordinator uploaded one in Account
    // Settings (saved as photoBase64 or photoURL), otherwise
    // falls back to initials.
    const photo =
        userData.photoBase64 ||
        userData.photoURL ||
        authUser.photoURL ||
        null;

    paintAvatar(userAvatar, photo, fullName);
    paintAvatar(document.getElementById("menuAvatar"), photo, fullName);

    const menuName =
        document.getElementById("menuName");

    const menuEmail =
        document.getElementById("menuEmail");

    if (menuName) {
        menuName.textContent = fullName;
    }

    if (menuEmail) {
        menuEmail.textContent = authUser.email || "—";
    }

}


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

    // "View profile" -> go to the profile page.
    const viewProfileBtn =
        document.getElementById("viewProfileBtn");

    if (viewProfileBtn) {

        viewProfileBtn.addEventListener("click", () => {

            trigger.classList.remove("open");

            // Nasa profile.html na - huwag nang mag-reload, i-scroll
            // na lang pataas.
            if (/\/profile\.html$/.test(window.location.pathname)) {

                window.scrollTo({ top: 0, behavior: "smooth" });

                return;

            }

            window.location.href =
                "../view-profile/profile.html";

        });

    }

    // "Account settings" -> go to the settings page.
    const showProfileBtn =
        document.getElementById("showProfileBtn");

    if (showProfileBtn) {

        showProfileBtn.addEventListener("click", () => {

            // Kung nasa Account Settings page na, huwag nang mag-reload
            // (mawawala ang mga hindi pa nase-save) - i-scroll at i-highlight
            // na lang ang Profile card. Ang "privacy-settings.html" ay
            // hindi tumutugma dito, kaya doon ay mag-navigate pa rin.
            if (/\/settings\.html$/.test(window.location.pathname)) {

                trigger.classList.remove("open");

                const card =
                    document.querySelector(".settings-card");

                if (card) {

                    card.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });

                    card.classList.add("flash");

                    setTimeout(
                        () => card.classList.remove("flash"),
                        1200
                    );

                }

                return;

            }

            window.location.href =
                "../settings/settings.html";

        });

    }

}


// ========================================
// LOGOUT
// ========================================

function initLogout() {

    const logoutBtn =
        document.getElementById("logoutBtn");

    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", async (e) => {

        e.preventDefault();

        try {

            stopNotifications();

            await signOut(auth);

            window.location.href =
                "../coordinator_login/coordinator_login.html";

        } catch (err) {

            console.error("Logout Error:", err);

        }

    });

}


// ========================================
// NOTIFICATIONS: STUDENT NAME LOOKUP
// ========================================

async function buildStudentNameMap() {

    // Pinag-aaralan ang lahat ng user (student AT intern - ang Companies
    // page ay tumatanggap ng role na "student" o "intern"). Kung hindi
    // pinapayagan ng rules ang buong collection, babalik sa role = student.
    let snapshot = null;

    try {

        snapshot = await getDocs(collection(db, "users"));

    } catch (error) {

        try {

            snapshot = await getDocs(
                query(
                    collection(db, "users"),
                    where("role", "==", "student")
                )
            );

        } catch (fallbackError) {

            console.error(
                "Error building student name map for notifications:",
                fallbackError
            );

            return;

        }

    }

    const map = {};

    snapshot.forEach((docSnap) => {

        const data = docSnap.data();

        const name =
            data.fullName ||
            data.name ||
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

}


function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}


// Unang field na may laman sa isang document
function firstValue(data, fields) {

    for (const field of fields) {

        const value = data[field];

        if (value !== undefined && value !== null && value !== "") {
            return value;
        }

    }

    return null;

}


// Firestore Timestamp / Date / string / number -> milliseconds
function toMillis(value) {

    if (!value) return 0;

    if (typeof value.toMillis === "function") return value.toMillis();

    if (typeof value.seconds === "number") return value.seconds * 1000;

    const ms = new Date(value).getTime();

    return Number.isNaN(ms) ? 0 : ms;

}


// Pangalan ng estudyante mula sa isang report / evaluation record.
// Una: hanapin sa listahan ng users (sa pamamagitan ng id / email),
// pangalawa: ang pangalang naka-save mismo sa record (ex. "internName"
// ng evaluation), huli lang ang "A student".
function getStudentNameForReport(data) {

    const ids =
        [...EVAL_STUDENT_ID_FIELDS, "studentUID"]
            .map((field) => data[field]);

    const emails = [
        data.email,
        data.studentEmail
    ].map((e) => String(e || "").toLowerCase().trim());

    for (const key of [...ids, ...emails]) {

        if (key && studentNameMap[key]) {
            return studentNameMap[key];
        }

    }

    return firstValue(data, EVAL_STUDENT_NAME_FIELDS) || "A student";

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

const NOTIF_TYPES = {
    report:     { icon: "fa-file-circle-check",   cls: "" },
    risk:       { icon: "fa-triangle-exclamation", cls: "risk" },
    evaluation: { icon: "fa-clipboard-check",      cls: "eval" },
    profile:    { icon: "fa-user-check",           cls: "profile" }
};


function notifMessageHtml(item) {

    const student = `<strong>${escapeHtml(item.studentName)}</strong>`;

    if (item.type === "risk") {

        const detail = item.detail
            ? `<span class="notif-detail">${escapeHtml(item.detail)}</span>`
            : "";

        return `<p>${student} is now <strong>At Risk</strong>.</p>${detail}`;

    }

    if (item.type === "profile") {

        const detail = item.detail
            ? `<span class="notif-detail">${escapeHtml(item.detail)}</span>`
            : "";

        return `<p>${student} completed their profile information.</p>${detail}`;

    }

    if (item.type === "evaluation") {

        const company = item.company
            ? ` <span class="notif-company">(${escapeHtml(item.company)})</span>`
            : "";

        return `<p><strong>${escapeHtml(item.supervisorName)}</strong> evaluated ${student}${company}.</p>`;

    }

    return `<p>${student} submitted a weekly report.</p>`;

}


function notifKey(item) {

    return `${item.type}:${item.id}:${item.timestamp}`;

}


// Unread lang kung MAS BAGO sa huling "mark as read" AT hindi pa nakalista bilang nabasa na
function isNotifUnread(item) {

    return item.timestamp > notifLastSeenAt &&
        !notifReadKeys.has(notifKey(item));

}


function renderNotifications() {

    const listEl =
        document.getElementById("notifList");

    const badgeEl =
        document.getElementById("notifBadge");

    if (!listEl) return;

    if (notifItems.length === 0) {

        listEl.innerHTML =
            '<div class="notif-empty">No notifications yet.</div>';

    } else {

        listEl.innerHTML = notifItems.map((item) => {

            const unread = isNotifUnread(item);

            const meta =
                NOTIF_TYPES[item.type] || NOTIF_TYPES.report;

            return `
                <div class="notif-item ${unread ? "unread" : ""}"
                     data-type="${item.type}"
                     data-notif-id="${escapeHtml(item.id)}">
                    <div class="notif-icon ${meta.cls}">
                        <i class="fa-solid ${meta.icon}"></i>
                    </div>
                    <div class="notif-text">
                        ${notifMessageHtml(item)}
                        <span>${notifTimeAgo(item.timestamp)}</span>
                    </div>
                    ${unread ? '<span class="notif-dot"></span>' : ""}
                </div>
            `;

        }).join("");

    }

    const unreadCount =
        notifItems.filter(isNotifUnread).length;

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


// Pinagsasama ang 3 klase ng notification, pinakabago sa itaas
function rebuildNotifications() {

    notifItems =
        [
            ...notifBuckets.report,
            ...notifBuckets.risk,
            ...notifBuckets.evaluation,
            ...notifBuckets.profile
        ]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, NOTIF_MAX_ITEMS);

    renderNotifications();

}


function markNotificationsRead() {

    notifLastSeenAt = Date.now();

    // Isama ang LAHAT ng nakikita ngayon (kahit nasa hinaharap ang timestamp)
    notifItems.forEach((item) => notifReadKeys.add(notifKey(item)));

    if (notifReadKeys.size > NOTIF_READ_KEYS_MAX) {
        notifReadKeys = new Set(
            Array.from(notifReadKeys).slice(-NOTIF_READ_KEYS_MAX)
        );
    }

    try {
        localStorage.setItem(
            notifStorageKey,
            String(notifLastSeenAt)
        );

        localStorage.setItem(
            notifReadKeysStorageKey,
            JSON.stringify(Array.from(notifReadKeys))
        );
    } catch (error) {
        console.error("Could not save notif read state:", error);
    }

    renderNotifications();

}


// ========================================
// NOTIFICATIONS: LIVE LISTENERS
// Tatlong live listener (weekly reports, at-risk na estudyante,
// evaluation ng supervisor) para lumabas agad ang bago nang
// hindi nagre-refresh - sa ANUMANG coordinator page na may
// header na ito.
// ========================================

function stopNotifications() {

    notifUnsubscribers.forEach((unsubscribe) => {

        try { unsubscribe(); } catch (error) { /* ignore */ }

    });

    notifUnsubscribers = [];

}


// Bawat estudyanteng at-risk ay may "unang nakita" na oras na
// naka-save sa browser. Iyon ang oras ng notification - kaya hindi
// nagiging "bago" ulit ang lahat tuwing nag-re-run ang AI, at lalabas
// lang ulit kapag nag-recover at nag-at-risk uli ang estudyante.
function riskSeenKey(uid) {

    return `coordinatorRiskSeen_${uid}`;

}


function loadRiskSeen(uid) {

    try {

        return JSON.parse(localStorage.getItem(riskSeenKey(uid))) || {};

    } catch (error) {

        return {};

    }

}


function saveRiskSeen(uid, map) {

    try {

        localStorage.setItem(riskSeenKey(uid), JSON.stringify(map));

    } catch (error) {

        console.error("Could not save at-risk notif state:", error);

    }

}


// "Unang nakita" na oras ng mga estudyanteng natapos na ang profile pero
// walang profileCompletedAt (lumang record / lumang profile.js).
// null = wala pang tracking sa browser na ito (unang beses).
function profileSeenKey(uid) {

    return `coordinatorProfileSeen_${uid}`;

}


function loadProfileSeen(uid) {

    try {

        const raw = localStorage.getItem(profileSeenKey(uid));

        return raw ? JSON.parse(raw) : null;

    } catch (error) {

        return null;

    }

}


function saveProfileSeen(uid, map) {

    try {

        localStorage.setItem(profileSeenKey(uid), JSON.stringify(map));

    } catch (error) {

        console.error("Could not save profile notif state:", error);

    }

}


function isSubmittedEvaluation(data) {

    const status =
        String(data.status || data.evaluationStatus || "").toLowerCase();

    return !/draft|pending|incomplete|in.?progress|unsubmitted/.test(status);

}


async function startNotifications(uid) {

    notifStorageKey =
        `coordinatorNotifLastSeen_${uid}`;

    notifLastSeenAt =
        Number(localStorage.getItem(notifStorageKey)) || 0;

    notifReadKeysStorageKey =
        `coordinatorNotifReadKeys_${uid}`;

    try {
        const savedKeys =
            JSON.parse(localStorage.getItem(notifReadKeysStorageKey));

        notifReadKeys =
            new Set(Array.isArray(savedKeys) ? savedKeys : []);
    } catch (error) {
        notifReadKeys = new Set();
    }

    await buildStudentNameMap();

    stopNotifications();

    // ------------------------------------
    // 1) WEEKLY REPORTS
    // ------------------------------------

    try {

        const reportsQuery =
            query(
                collection(db, "weekly_reports"),
                orderBy("submittedAt", "desc"),
                limit(20)
            );

        notifUnsubscribers.push(onSnapshot(
            reportsQuery,
            (snapshot) => {

                notifBuckets.report = snapshot.docs.map((docSnap) => {

                    const data = docSnap.data();

                    return {
                        type: "report",
                        id: docSnap.id,
                        studentName: getStudentNameForReport(data),
                        timestamp: toMillis(data.submittedAt)
                    };

                });

                rebuildNotifications();

            },
            (error) => {

                console.error(
                    "Error listening for report notifications:",
                    error
                );

            }
        ));

    } catch (error) {

        console.error("Could not start report notifications:", error);

    }

    // ------------------------------------
    // 2) AT-RISK STUDENTS
    // ------------------------------------

    try {

        const riskQuery =
            query(
                collection(db, ANALYTICS_COLLECTION),
                where("aiStatus", "==", AT_RISK_STATUS)
            );

        notifUnsubscribers.push(onSnapshot(
            riskQuery,
            (snapshot) => {

                const now = Date.now();
                const seen = loadRiskSeen(uid);
                const current = {};
                const items = [];

                const hasStudentList =
                    Object.keys(studentNameMap).length > 0;

                snapshot.docs.forEach((docSnap) => {

                    const data = docSnap.data();

                    const studentId = data.studentUid || docSnap.id;

                    // Lumang analytics record ng estudyanteng wala na
                    // sa users - huwag i-notify.
                    if (hasStudentList && !studentNameMap[studentId]) return;

                    current[studentId] = seen[studentId] || now;

                    items.push({
                        type: "risk",
                        id: studentId,
                        studentName:
                            studentNameMap[studentId] ||
                            data.studentName ||
                            "A student",
                        detail: data.riskReason || "",
                        timestamp: current[studentId]
                    });

                });

                // Kapag galing lang sa cache ang data, huwag munang burahin
                // ang mga na-recover na (baka hindi pa kumpleto ang cache).
                saveRiskSeen(
                    uid,
                    snapshot.metadata?.fromCache
                        ? { ...seen, ...current }
                        : current
                );

                notifBuckets.risk = items;

                rebuildNotifications();

            },
            (error) => {

                console.error(
                    "Error listening for at-risk notifications:",
                    error
                );

            }
        ));

    } catch (error) {

        console.error("Could not start at-risk notifications:", error);

    }

    // ------------------------------------
    // 3) SUPERVISOR EVALUATIONS
    // (walang orderBy - hindi alam kung anong field ng petsa ang
    // meron ang mga document, kaya inaayos dito sa browser.)
    // ------------------------------------

    try {

        notifUnsubscribers.push(onSnapshot(
            collection(db, EVALUATIONS_COLLECTION),
            (snapshot) => {

                const oldestAllowed =
                    Date.now() -
                    NOTIF_EVALUATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

                notifBuckets.evaluation =
                    snapshot.docs
                        .map((docSnap) => {

                            const data = docSnap.data();

                            if (!isSubmittedEvaluation(data)) return null;

                            return {
                                type: "evaluation",
                                id: docSnap.id,
                                studentName: getStudentNameForReport(data),
                                supervisorName:
                                    firstValue(data, EVAL_SUPERVISOR_FIELDS) ||
                                    "A supervisor",
                                company: firstValue(data, EVAL_COMPANY_FIELDS) || "",
                                timestamp: toMillis(firstValue(data, EVAL_TIME_FIELDS))
                            };

                        })
                        .filter((item) => item && item.timestamp >= oldestAllowed)
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 20);

                rebuildNotifications();

            },
            (error) => {

                console.error(
                    `Error listening for evaluation notifications ("${EVALUATIONS_COLLECTION}"):`,
                    error
                );

            }
        ));

    } catch (error) {

        console.error("Could not start evaluation notifications:", error);

    }

    // ------------------------------------
    // 4) PROFILE COMPLETED (bagong account na natapos ang profile)
    // ------------------------------------

    try {

        const profileQuery =
            query(
                collection(db, "users"),
                where("profileCompleted", "==", true)
            );

        notifUnsubscribers.push(onSnapshot(
            profileQuery,
            (snapshot) => {

                const fromCache = Boolean(snapshot.metadata?.fromCache);

                let seen = loadProfileSeen(uid);

                const isBaseline = seen === null;

                // Unang beses: hintayin ang totoong data mula sa server bago
                // i-baseline, kung hindi ay magmumukhang "bago" ang lahat.
                if (isBaseline && fromCache) return;

                seen = seen || {};

                const now = Date.now();

                const oldestAllowed =
                    now - NOTIF_PROFILE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

                let seenChanged = isBaseline;

                const items = [];

                snapshot.docs.forEach((docSnap) => {

                    const data = docSnap.data();

                    // Eksaktong oras kung galing sa bagong profile.js
                    let timestamp = toMillis(data.profileCompletedAt);

                    // Kung wala, gamitin ang oras ng unang pagkakita
                    // (0 = natapos na bago nag-umpisa ang tracking)
                    if (!timestamp) {

                        if (!(docSnap.id in seen)) {

                            seen[docSnap.id] = isBaseline ? 0 : now;
                            seenChanged = true;

                        }

                        timestamp = seen[docSnap.id];

                    }

                    if (timestamp < oldestAllowed) return;

                    const course =
                        [data.section || data.course]
                            .filter(Boolean)
                            .join("");

                    const company =
                        data.companyName || data.company || "";

                    items.push({
                        type: "profile",
                        id: docSnap.id,
                        studentName:
                            data.fullName || data.name || data.email || "A student",
                        detail: [course, company].filter(Boolean).join(" · "),
                        timestamp
                    });

                });

                if (seenChanged) saveProfileSeen(uid, seen);

                notifBuckets.profile =
                    items
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 20);

                rebuildNotifications();

            },
            (error) => {

                console.error(
                    "Error listening for profile-completed notifications:",
                    error
                );

            }
        ));

    } catch (error) {

        console.error("Could not start profile notifications:", error);

    }

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

        // Pagpindot sa isang notification:
        //   - weekly report  -> i-scroll sa weekly reports table (kung
        //                       nasa page na may ganoong table, ex. Dashboard)
        //   - at-risk        -> i-scroll sa at-risk list kung nasa Analytics;
        //                       kung hindi, pumunta sa Analytics page
        //   - evaluation     -> isara lang ang dropdown
        const clickedItem = e.target.closest(".notif-item");

        if (clickedItem) {

            bell.classList.remove("open");

            const type = clickedItem.dataset.type;

            if (type === "risk") {

                const riskList =
                    document.getElementById("riskStudentsContainer");

                if (riskList) {

                    riskList.scrollIntoView({ behavior: "smooth", block: "center" });

                } else if (NOTIF_LINKS.risk) {

                    window.location.href = NOTIF_LINKS.risk;

                }

            } else if (type === "evaluation" || type === "profile") {

                if (NOTIF_LINKS[type]) {
                    window.location.href = NOTIF_LINKS[type];
                }

            } else {

                document
                    .getElementById("weeklyReportsTableBody")
                    ?.closest("table")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });

            }

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
// RUN
// ========================================

document.addEventListener("DOMContentLoaded", loadHeader);