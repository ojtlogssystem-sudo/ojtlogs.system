import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { loadHeader } from "../templated/header-loader.js";

// Same project as student_dashboard.js so both pages read/write the same
// users/{uid} document.
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

// Defaults used when a student's document doesn't have these fields yet
// (e.g. their account was created before this settings page existed).
const DEFAULT_PRIVACY_SETTINGS = {
    showPhoto: true,
    showContactInfo: true,
    showProgress: true
};

const DEFAULT_NOTIFICATION_SETTINGS = {
    emailNotifications: true,
    pushNotifications: true,
    attendanceReminders: true,
    announcementNotifications: true,
    deadlineReminders: true
};

// Maps each checkbox's id to the Firestore field it controls and which
// settings group (privacySettings / notificationSettings) it lives under.
const TOGGLE_MAP = {
    "toggle-show-photo": { group: "privacySettings", field: "showPhoto" },
    "toggle-show-contact": { group: "privacySettings", field: "showContactInfo" },
    "toggle-show-progress": { group: "privacySettings", field: "showProgress" },
    "toggle-email-notif": { group: "notificationSettings", field: "emailNotifications" },
    "toggle-push-notif": { group: "notificationSettings", field: "pushNotifications" },
    "toggle-attendance-notif": { group: "notificationSettings", field: "attendanceReminders" },
    "toggle-announcement-notif": { group: "notificationSettings", field: "announcementNotifications" },
    "toggle-deadline-notif": { group: "notificationSettings", field: "deadlineReminders" }
};

let currentUser = null;

document.addEventListener("DOMContentLoaded", async () => {
    fetch("../templated/sidebar.html")
        .then(response => response.ok ? response.text() : "")
        .then(html => {
            const sidebarContainer = document.getElementById("sidebar-container");
            if (sidebarContainer && html) sidebarContainer.innerHTML = html;
            // "Settings" assumes that's the sidebar menu label for this page —
            // rename this string to match whatever ../templated/sidebar.html
            // actually calls it, so the active menu item highlights correctly.
            initSidebar("Settings");
        })
        .catch(err => console.error("Error loading sidebar:", err));

    await loadHeader("Settings", { autoLoadProfile: true });

    initPasswordVisibilityToggles();
    initPasswordForm();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            await loadUserSettings(user.uid);
            initToggleListeners();
        } else {
            window.location.href = "../student_login/student_login.html";
        }
    });
});

// Reads users/{uid}.privacySettings and .notificationSettings and checks/
// unchecks each switch accordingly, falling back to the defaults above for
// any field that isn't set yet.
async function loadUserSettings(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        const data = userSnap.exists() ? userSnap.data() : {};

        const privacy = { ...DEFAULT_PRIVACY_SETTINGS, ...(data.privacySettings || {}) };
        const notifications = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(data.notificationSettings || {}) };

        setToggleState("toggle-show-photo", privacy.showPhoto);
        setToggleState("toggle-show-contact", privacy.showContactInfo);
        setToggleState("toggle-show-progress", privacy.showProgress);

        setToggleState("toggle-email-notif", notifications.emailNotifications);
        setToggleState("toggle-push-notif", notifications.pushNotifications);
        setToggleState("toggle-attendance-notif", notifications.attendanceReminders);
        setToggleState("toggle-announcement-notif", notifications.announcementNotifications);
        setToggleState("toggle-deadline-notif", notifications.deadlineReminders);
    } catch (err) {
        console.error("Error loading privacy/notification settings:", err);
    }
}

function setToggleState(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

// Every switch auto-saves on change (no separate "Save" button needed) —
// each write only touches its own field so toggles never clobber each other.
function initToggleListeners() {
    Object.keys(TOGGLE_MAP).forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;

        el.addEventListener("change", async () => {
            const { group, field } = TOGGLE_MAP[id];
            el.disabled = true;

            try {
                const userRef = doc(db, "users", currentUser.uid);
                await setDoc(userRef, { [group]: { [field]: el.checked } }, { merge: true });
                flashSaved(field);
            } catch (err) {
                console.error(`Error saving ${group}.${field}:`, err);
                // Revert the switch visually since the save failed.
                el.checked = !el.checked;
                alert("Hindi na-save yung setting. Subukan ulit.");
            } finally {
                el.disabled = false;
            }
        });
    });
}

function flashSaved(field) {
    const flashEl = document.querySelector(`.save-flash[data-flash-for="${field}"]`);
    if (!flashEl) return;

    flashEl.classList.add("show");
    clearTimeout(flashEl._hideTimeout);
    flashEl._hideTimeout = setTimeout(() => flashEl.classList.remove("show"), 1500);
}

// Eye-icon buttons next to each password field toggle between
// type="password" and type="text".
function initPasswordVisibilityToggles() {
    document.querySelectorAll(".toggle-visibility").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-target");
            const input = document.getElementById(targetId);
            if (!input) return;

            const icon = btn.querySelector("i");
            const isHidden = input.type === "password";

            input.type = isHidden ? "text" : "password";
            if (icon) {
                icon.className = isHidden ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
            }
            btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        });
    });
}

function initPasswordForm() {
    const form = document.getElementById("password-form");
    if (!form) return;

    const feedbackEl = document.getElementById("password-feedback");
    const submitBtn = document.getElementById("update-password-btn");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const currentPassword = document.getElementById("current-password").value;
        const newPassword = document.getElementById("new-password").value;
        const confirmPassword = document.getElementById("confirm-password").value;

        const setFeedback = (message, type) => {
            feedbackEl.textContent = message;
            feedbackEl.className = `password-feedback ${type || ""}`.trim();
        };

        if (!currentPassword || !newPassword || !confirmPassword) {
            setFeedback("Punan lahat ng fields.", "error");
            return;
        }

        if (newPassword.length < 8) {
            setFeedback("Ang bagong password ay dapat hindi bababa sa 8 characters.", "error");
            return;
        }

        if (newPassword !== confirmPassword) {
            setFeedback("Hindi magkatugma ang new password at confirm password.", "error");
            return;
        }

        if (newPassword === currentPassword) {
            setFeedback("Ang bagong password ay dapat iba sa kasalukuyang password.", "error");
            return;
        }

        submitBtn.disabled = true;
        setFeedback("Ina-update ang password...", "");

        try {
            const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
            await reauthenticateWithCredential(currentUser, credential);
            await updatePassword(currentUser, newPassword);

            setFeedback("Na-update na ang password mo.", "success");
            form.reset();
        } catch (err) {
            console.error("Error updating password:", err);

            if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
                setFeedback("Mali ang kasalukuyang password.", "error");
            } else if (err.code === "auth/too-many-requests") {
                setFeedback("Masyadong maraming pagtatangka. Subukan ulit mamaya.", "error");
            } else if (err.code === "auth/requires-recent-login") {
                setFeedback("Kailangan mo munang mag-login ulit bago palitan ang password.", "error");
            } else {
                setFeedback("May error nangyari. Subukan ulit.", "error");
            }
        } finally {
            submitBtn.disabled = false;
        }
    });
}