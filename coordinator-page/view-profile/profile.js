/* ==========================================
   PROFILE VIEW PAGE
   OJT-LOGS  |  Firebase Connected
   ==========================================
   Loaded as: <script type="module" src="profile.js"></script>
   Reads the same users/{uid} document that
   settings.js and students.js use.
========================================== */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ==========================================
   FIREBASE CONFIGURATION (same project)
========================================== */

const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};

// Reuse ang app kung na-initialize na ng shared header (header.js)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const LOGIN_PAGE = "../coordinator_login/coordinator_login.html";


/* ==========================================
   HELPERS
========================================== */

const $ = (id) => document.getElementById(id);

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value || "—";
}

function getInitials(name) {
    return (name || "")
        .split(" ")
        .filter(n => n.length > 0)
        .map(n => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase() || "CO";
}

function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/*
    Same name fields as students.js:
    firstName / middleName / lastName, or a single
    fullName / name. When only the single field exists,
    split it so the three boxes are still filled.
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


/* ==========================================
   AUTH GATE + RENDER
========================================== */

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

function render(user, data) {

    const name = resolveName(data, user);
    const displayName = name.full || "OJT Coordinator";

    const role = capitalize(data.role || data.position || "Coordinator");

    const photo =
        data.photoBase64 ||
        data.photoURL ||
        data.photo ||
        data.profilePic ||
        user.photoURL ||
        "";

    const deactivated = (data.accountStatus || "").toLowerCase() === "deactivated";
    const statusLabel = deactivated ? "Deactivated" : "Active";

    const created = user.metadata?.creationTime;

    // Note: hindi na dito pinipinta ang header (#userName, #userAvatar,
    // #menuName, atbp.) - ginagawa na 'yon ng sarili niyang listener
    // ng shared header.js.

    /* ---------- HERO ---------- */

    setText("heroName", displayName);
    paintAvatar($("heroAvatar"), photo, displayName);

    $("heroDot").classList.toggle("off", deactivated);

    setText("chipRole", role);

    setText(
        "chipJoined",
        created
            ? "Joined " + new Date(created).toLocaleDateString("en-PH", {
                  month: "short",
                  year: "numeric"
              })
            : ""
    );

    const chipStatus = $("chipStatus");
    chipStatus.classList.toggle("off", deactivated);
    chipStatus.innerHTML = `<i class="fa-solid fa-circle"></i>${statusLabel}`;

    /* ---------- PERSONAL ---------- */

    setText("fFirst", name.first);
    setText("fMiddle", name.middle);
    setText("fLast", name.last);
    setText("fRole", role);
    setText("fFull", name.full);
    setText("fStatus", statusLabel);

    /* ---------- CONTACT ---------- */

    setText("fEmail", user.email);
    setText("fPhone", data.phone);

}


/* ==========================================
   TABS
========================================== */

(function initTabs() {

    const tabs = Array.from(document.querySelectorAll(".tab"));

    function select(name) {

        tabs.forEach((tab) => {
            const on = tab.dataset.tab === name;
            tab.classList.toggle("active", on);
            tab.setAttribute("aria-selected", String(on));
            $("panel-" + tab.dataset.tab).hidden = !on;
        });

    }

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            select(tab.dataset.tab);
            history.replaceState(null, "", "#" + tab.dataset.tab);
        });
    });

    // Deep link, e.g. profile.html#contact
    const fromHash = location.hash.replace("#", "");

    if (tabs.some((tab) => tab.dataset.tab === fromHash)) {
        select(fromHash);
    }

})();


/* ==========================================
   PROFILE DROPDOWN
   ------------------------------------------
   Hawak na ito ng shared header.js (toggle,
   "View profile", "Account settings", "Log out")
   - wala nang sarili pang logic dito.
========================================== */