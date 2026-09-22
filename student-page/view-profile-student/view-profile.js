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
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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