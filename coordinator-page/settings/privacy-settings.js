/* ==========================================
   PRIVACY SETTINGS PAGE
   OJT-LOGS  |  Firebase Connected
   ==========================================
   Loaded as:
   <script type="module" src="privacy-settings.js"></script>
========================================== */

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
    setDoc,
    addDoc,
    collection,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ==========================================
   FIREBASE CONFIGURATION
   (same project as dashboard.js)
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const LOGIN_PAGE = "../coordinator_login/coordinator_login.html";


/* ==========================================
   DEFAULT PREFERENCES
   ------------------------------------------
   Anything not yet saved on the user document
   falls back to these values.
========================================== */

const defaultPrivacy = {
    // Profile visibility
    showEmail: true,
    showPhone: false,
    showPhoto: true,
    listedInDirectory: true,
    activityStatus: true,

    // Communication
    allowStudentMessages: true,
    emailAlerts: true,
    readReceipts: false,

    // Data and analytics
    analyticsConsent: true,
    shareStatsWithAdmin: true,
    loginHistory: true
};


/* ==========================================
   STATE + HELPERS
========================================== */

let currentUser = null;
let currentData = {};

const $ = (id) => document.getElementById(id);

let toastTimer = null;

function showToast(message, type = "success") {

    const toast = $("toast");

    if (!toast) return;

    $("toastMessage").textContent = message;

    toast.classList.remove("toast-error", "toast-success");
    toast.classList.add(type === "error" ? "toast-error" : "toast-success");

    const icon = $("toastIcon");

    if (icon) {
        icon.className =
            type === "error"
                ? "fa-solid fa-circle-exclamation"
                : "fa-solid fa-circle-check";
    }

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}


function setBusy(button, busy, busyLabel = "Sending...") {

    if (!button) return;

    if (busy) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML =
            `<i class="fa-solid fa-spinner fa-spin"></i> ${busyLabel}`;
    } else {
        button.disabled = false;
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
        }
    }
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


function readableError(error) {

    const map = {
        "permission-denied": "You do not have permission to save this.",
        "unavailable": "No internet connection.",
        "auth/network-request-failed": "No internet connection."
    };

    return map[error?.code] || "Something went wrong. Please try again.";
}


function formatDate(value) {

    return value
        ? new Date(value).toLocaleString("en-PH", {
              dateStyle: "medium",
              timeStyle: "short"
          })
        : "—";
}


/* ==========================================
   AUTH GATE
========================================== */

onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    currentUser = user;

    try {

        const snap = await getDoc(doc(db, "users", user.uid));

        currentData = snap.exists() ? snap.data() : {};

        renderHeader();
        renderToggles();
        renderActivity();
        renderConsent();

        logSignIn();

    } catch (error) {

        console.error("Error loading privacy settings:", error);
        showToast("Could not load your privacy settings.", "error");

    }

});


/* ==========================================
   RENDER
========================================== */

function renderHeader() {

    const name =
        currentData.name ||
        currentData.fullName ||
        currentUser.displayName ||
        "OJT Coordinator";

    const role =
        currentData.role ||
        currentData.position ||
        "Coordinator";

    const photo =
        currentData.photoBase64 ||
        currentData.photoURL ||
        currentUser.photoURL ||
        "";

    paintHeader(name, role, photo);
}


function renderToggles() {

    const privacy = { ...defaultPrivacy, ...(currentData.privacy || {}) };

    document
        .querySelectorAll(".privacy-toggle input[type='checkbox']")
        .forEach((input) => {
            input.checked = Boolean(privacy[input.dataset.key]);
        });
}


function renderActivity() {

    $("lastSignIn").textContent =
        formatDate(currentUser.metadata?.lastSignInTime);

    $("deviceInfo").textContent =
        "Device: " + describeDevice();
}


function describeDevice() {

    const ua = navigator.userAgent;

    const browser =
        /Edg\//.test(ua) ? "Edge" :
        /OPR\//.test(ua) ? "Opera" :
        /Chrome\//.test(ua) ? "Chrome" :
        /Safari\//.test(ua) ? "Safari" :
        /Firefox\//.test(ua) ? "Firefox" :
        "Browser";

    const os =
        /Windows/.test(ua) ? "Windows" :
        /Android/.test(ua) ? "Android" :
        /iPhone|iPad/.test(ua) ? "iOS" :
        /Mac OS X/.test(ua) ? "macOS" :
        /Linux/.test(ua) ? "Linux" :
        "Unknown OS";

    return `${browser} on ${os}`;
}


function renderConsent() {

    const consent = currentData.privacyConsent;
    const button = $("acknowledgePolicy");

    if (consent?.acknowledgedAt) {

        const date = consent.acknowledgedAt.toDate
            ? consent.acknowledgedAt.toDate()
            : new Date(consent.acknowledgedAt);

        $("consentStatus").textContent =
            "Acknowledged on " + formatDate(date);

        button.disabled = true;
        button.innerHTML =
            `<i class="fa-solid fa-circle-check"></i> Acknowledged`;

    } else {

        $("consentStatus").textContent =
            "You haven't acknowledged the privacy notice yet.";

    }
}


/* ==========================================
   SIGN-IN HISTORY
   ------------------------------------------
   Only recorded when the user allows it.
========================================== */

async function logSignIn() {

    const privacy = { ...defaultPrivacy, ...(currentData.privacy || {}) };

    if (!privacy.loginHistory) return;

    try {

        await addDoc(collection(db, "users", currentUser.uid, "loginHistory"), {
            at: serverTimestamp(),
            device: describeDevice()
        });

    } catch (error) {

        // Not critical enough to interrupt the page.
        console.warn("Could not record sign-in:", error);

    }

}


/* ==========================================
   TOGGLES (auto-save)
========================================== */

document
    .querySelectorAll(".privacy-toggle input[type='checkbox']")
    .forEach((input) => {

        input.addEventListener("change", async () => {

            const key = input.dataset.key;
            const value = input.checked;

            const privacy = {
                ...defaultPrivacy,
                ...(currentData.privacy || {}),
                [key]: value
            };

            input.disabled = true;

            try {

                await setDoc(
                    doc(db, "users", currentUser.uid),
                    { privacy: privacy, updatedAt: serverTimestamp() },
                    { merge: true }
                );

                currentData.privacy = privacy;

                showToast(value ? "Turned on." : "Turned off.");

            } catch (error) {

                console.error("Privacy save error:", error);

                input.checked = !value;   // roll the switch back

                showToast(readableError(error), "error");

            } finally {

                input.disabled = false;

            }

        });

    });


/* ==========================================
   DOWNLOAD MY DATA
========================================== */

$("downloadData").addEventListener("click", () => {

    // Only fields this page actually shows are included below —
    // not the full raw user document — to keep the export scoped
    // to what the coordinator can see on this screen.

    const consent = currentData.privacyConsent;

    const acknowledgedAt = consent?.acknowledgedAt
        ? (consent.acknowledgedAt.toDate
            ? consent.acknowledgedAt.toDate().toISOString()
            : new Date(consent.acknowledgedAt).toISOString())
        : null;

    const exportData = {
        exportedAt: new Date().toISOString(),
        account: {
            uid: currentUser.uid,
            email: currentUser.email,
            emailVerified: currentUser.emailVerified,
            createdAt: currentUser.metadata?.creationTime,
            lastSignIn: currentUser.metadata?.lastSignInTime
        },
        profile: {
            name: currentData.name || currentData.fullName || currentUser.displayName || "",
            role: currentData.role || currentData.position || "",
            photoURL: currentData.photoURL || currentUser.photoURL || ""
        },
        privacy: { ...defaultPrivacy, ...(currentData.privacy || {}) },
        privacyNotice: {
            version: consent?.version || null,
            acknowledgedAt: acknowledgedAt
        }
    };

    const blob = new Blob(
        [JSON.stringify(exportData, null, 2)],
        { type: "application/json" }
    );

    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = `ojt-logs-my-data-${Date.now()}.json`;
    link.click();

    URL.revokeObjectURL(link.href);

    showToast("Your data file was downloaded.");

});


/* ==========================================
   DATA REQUESTS
   ------------------------------------------
   Written to "privacy_requests" for an admin
   to review. Nothing is deleted automatically.
========================================== */

async function submitRequest(type, details, button) {

    setBusy(button, true);

    try {

        await addDoc(collection(db, "privacy_requests"), {
            uid: currentUser.uid,
            email: currentUser.email,
            name: currentData.name || currentData.fullName || "",
            type: type,
            details: details,
            status: "pending",
            createdAt: serverTimestamp()
        });

        showToast("Request sent. An administrator will review it.");

    } catch (error) {

        console.error("Request error:", error);
        showToast(readableError(error), "error");

    } finally {

        setBusy(button, false);

    }

}


$("requestCorrection").addEventListener("click", () => {

    const details = window.prompt(
        "What needs to be corrected? Be specific, for example: " +
        "\"My role should be OJT Coordinator, not Adviser.\""
    );

    if (!details || details.trim() === "") return;

    submitRequest("correction", details.trim(), $("requestCorrection"));

});


$("requestDeletion").addEventListener("click", () => {

    const confirmed = window.confirm(
        "Send a data deletion request? An administrator reviews it first, " +
        "and records required for OJT compliance are kept."
    );

    if (!confirmed) return;

    const details = window.prompt("Reason for the request (optional):") || "";

    submitRequest("deletion", details.trim(), $("requestDeletion"));

});


/* ==========================================
   PRIVACY NOTICE ACKNOWLEDGEMENT
========================================== */

$("acknowledgePolicy").addEventListener("click", async () => {

    const button = $("acknowledgePolicy");
    setBusy(button, true, "Saving...");

    try {

        await setDoc(
            doc(db, "users", currentUser.uid),
            {
                privacyConsent: {
                    version: "1.0",
                    acknowledgedAt: serverTimestamp()
                }
            },
            { merge: true }
        );

        currentData.privacyConsent = {
            version: "1.0",
            acknowledgedAt: new Date()
        };

        setBusy(button, false);
        renderConsent();

        showToast("Thanks, that's recorded.");

    } catch (error) {

        console.error("Consent error:", error);
        showToast(readableError(error), "error");
        setBusy(button, false);

    }

});


/* ==========================================
   SIGN OUT
========================================== */

document.addEventListener("click", async (e) => {

    const trigger = e.target.closest("#signOutBtn, #logoutBtn");

    if (!trigger) return;

    e.preventDefault();

    try {
        await signOut(auth);
        window.location.href = LOGIN_PAGE;
    } catch (error) {
        console.error("Sign out error:", error);
        showToast("Could not sign out.", "error");
    }

});


/* ==========================================
   HEADER AVATAR
   ------------------------------------------
   Shows the saved photo when there is one,
   and falls back to initials otherwise.
========================================== */

function paintAvatar(element, photo, name) {

    if (!element) return;

    const initials = getInitials(name);

    if (photo) {

        element.innerHTML = "";

        const img = document.createElement("img");

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


function paintHeader(name, role, photo) {

    const nameEl = document.getElementById("profileName");
    const roleEl = document.getElementById("profileRole");

    if (nameEl) nameEl.textContent = name || "OJT Coordinator";
    if (roleEl) roleEl.textContent = role || "Coordinator";

    paintAvatar(document.getElementById("profileAvatar"), photo, name);
    paintAvatar(document.getElementById("menuAvatar"), photo, name);

    const menuName = document.getElementById("menuName");
    const menuEmail = document.getElementById("menuEmail");

    if (menuName) menuName.textContent = name || "OJT Coordinator";
    if (menuEmail) menuEmail.textContent = currentUser?.email || "";

}


/* ==========================================
   PROFILE DROPDOWN
========================================== */

(function initProfileMenu() {

    const trigger = document.getElementById("profileMenuTrigger");

    if (!trigger) return;

    trigger.addEventListener("click", (e) => {

        // Clicks on the menu items handle themselves.
        if (e.target.closest(".profile-menu")) return;

        trigger.classList.toggle("open");

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

})();


/* ==========================================
   MENU: SHOW PROFILE
   ------------------------------------------
   Adjust ACCOUNT_PAGE if your folder for the
   account settings page is named differently.
========================================== */

const ACCOUNT_PAGE = "../settings/settings.html";

document.getElementById("showProfileBtn")?.addEventListener("click", () => {

    window.location.href = ACCOUNT_PAGE;

});