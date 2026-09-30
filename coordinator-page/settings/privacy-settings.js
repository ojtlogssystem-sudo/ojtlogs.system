/* ==========================================
   PRIVACY SETTINGS PAGE
   OJT-LOGS  |  Firebase Connected
   ==========================================
   Loaded as:
   <script type="module" src="privacy-settings.js"></script>
========================================== */

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

// Reuse ang app kung na-initialize na ng shared header (header.js)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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

    toastTimer = setTimeout(
        () => toast.classList.remove("show"),
        type === "error" ? 6000 : 3000
    );
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


function readableError(error) {

    const map = {
        "permission-denied": "You do not have permission to save this.",
        "unavailable": "No internet connection.",
        "auth/network-request-failed": "No internet connection."
    };

    return map[error?.code] || "Something went wrong. Please try again.";
}


// Kahit anong hugis ng petsa mula sa Firestore (Timestamp, {seconds},
// ISO string, Date) - ibinabalik bilang Date, o null kung hindi mabasa.
function toJsDate(value) {

    if (!value) return null;

    if (typeof value.toDate === "function") return value.toDate();

    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

    const date = new Date(value);

    return isNaN(date) ? null : date;

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
   LOAD USER DOCUMENT (with retry + clear errors)
   ------------------------------------------
   Ang "Could not load ..." dati ay lumalabas sa
   kahit anong error, kaya hindi malaman ang totoong
   dahilan. Ngayon:
     - inuulit ang pagbasa ng 3 beses kapag
       "offline / unavailable" (mabagal o putol
       ang koneksyon)
     - hindi inuulit kapag permission-denied
     - sinasabi sa toast ang totoong dahilan, at
       nasa browser console (F12) ang buong error
========================================== */

async function loadUserDoc(uid, attempts = 3) {

    let lastError;

    for (let i = 0; i < attempts; i++) {

        try {

            return await getDoc(doc(db, "users", uid));

        } catch (error) {

            lastError = error;

            if (error?.code === "permission-denied") break;

            await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)));

        }

    }

    throw lastError;

}


function describeLoadError(error, what) {

    const code = error?.code || "";

    if (code === "permission-denied") {
        return `Could not load ${what}: your Firestore rules don't allow reading your user record.`;
    }

    if (code === "unavailable" || /offline/i.test(error?.message || "")) {
        return `Could not load ${what}: can't reach the server. Check your internet connection and reload.`;
    }

    return `Could not load ${what}${code ? " (" + code + ")" : ""}. Check the browser console for details.`;

}


/* ==========================================
   AUTH GATE
========================================== */

// Isang render na pumalya ay hindi dapat pumigil sa iba.
function safeRender(fn) {

    try {
        fn();
        return true;
    } catch (error) {
        console.error(`${fn.name} failed:`, error);
        return false;
    }

}


// Kung hindi nabasa ang record, i-lock ang mga kontrol para hindi
// ma-overwrite ng default values ang mga nakasave nang settings.
function lockSettings() {

    document
        .querySelectorAll(".privacy-toggle input[type='checkbox']")
        .forEach((input) => { input.disabled = true; });

    ["downloadData", "requestCorrection", "requestDeletion", "acknowledgePolicy"]
        .forEach((id) => {
            const button = $(id);
            if (button) button.disabled = true;
        });

}


onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    currentUser = user;

    let loaded = true;

    try {

        const snap = await loadUserDoc(user.uid);

        currentData = snap.exists() ? snap.data() : {};

    } catch (error) {

        loaded = false;
        currentData = {};

        console.error(
            "Error loading privacy settings:",
            error?.code,
            error?.message,
            error
        );

        showToast(describeLoadError(error, "your privacy settings"), "error");

    }

    const rendered = [renderToggles, renderActivity, renderConsent]
        .map(safeRender)
        .every(Boolean);

    if (!loaded) {

        lockSettings();
        return;

    }

    if (!rendered) {

        showToast("Some parts of this page could not be displayed.", "error");

    }

    logSignIn();

});


/* ==========================================
   RENDER
========================================== */

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

        const date = toJsDate(consent.acknowledgedAt);

        $("consentStatus").textContent =
            date ? "Acknowledged on " + formatDate(date) : "Acknowledged";

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

    const acknowledgedDate = toJsDate(consent?.acknowledgedAt);

    const acknowledgedAt = acknowledgedDate
        ? acknowledgedDate.toISOString()
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

    const trigger = e.target.closest("#signOutBtn");

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