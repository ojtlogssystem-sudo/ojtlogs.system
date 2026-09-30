// Import Firebase SDK Functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase Config (same project as the rest of OJT-LOGS)
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- CHANGE THIS to wherever Step 3 should go after a successful save ----
const NEXT_PAGE_URL = "/student-page/student_dashboard/student_dashboard.html";
const LOGIN_PAGE_URL = "/student-page/student_login/student_login.html";

// DOM Elements
const form = document.getElementById("accountSecurityForm");
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");
const errorMessage = document.getElementById("errorMessage");
const continueBtn = document.getElementById("continueBtn");
const backBtn = document.getElementById("backBtn");

const reqLength = document.getElementById("reqLength");
const reqUpper = document.getElementById("reqUpper");
const reqNumber = document.getElementById("reqNumber");
const reqMatch = document.getElementById("reqMatch");

// Reauth modal elements
const reauthModal = document.getElementById("reauthModal");
const reauthForm = document.getElementById("reauthForm");
const reauthPasswordInput = document.getElementById("reauthPassword");
const reauthMessage = document.getElementById("reauthMessage");
const reauthSubmitBtn = document.getElementById("reauthSubmitBtn");
const closeReauthModalBtn = document.getElementById("closeReauthModalBtn");

let currentUser = null;

/* ==========================================
   TRACK LOGGED-IN USER
========================================== */
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
    } else {
        // No active session — user must log in again before setting a password
        window.location.href = LOGIN_PAGE_URL;
    }
});

/* ==========================================
   SHOW / HIDE PASSWORD TOGGLES (works for all eye icons on the page)
========================================== */
document.querySelectorAll(".toggle-icon").forEach((icon) => {
    icon.addEventListener("click", () => {
        const targetId = icon.getAttribute("data-target");
        const input = document.getElementById(targetId);
        if (!input) return;

        const isPassword = input.getAttribute("type") === "password";
        input.setAttribute("type", isPassword ? "text" : "password");
        icon.classList.toggle("fa-eye");
        icon.classList.toggle("fa-eye-slash");
    });
});

/* ==========================================
   MESSAGE HELPERS
========================================== */
function showMessage(el, msg) {
    if (!el) {
        alert(msg);
        return;
    }
    el.textContent = msg;
    el.style.display = "block";
}

function hideMessage(el) {
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
}

/* ==========================================
   LIVE PASSWORD REQUIREMENTS CHECKLIST
========================================== */
function setRequirementState(el, isValid) {
    el.classList.toggle("valid", isValid);
}

function validatePasswordRequirements() {
    const password = newPasswordInput.value;
    const confirm = confirmPasswordInput.value;

    const hasLength = password.length >= 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const matches = password.length > 0 && password === confirm;

    setRequirementState(reqLength, hasLength);
    setRequirementState(reqUpper, hasUpper);
    setRequirementState(reqNumber, hasNumber);
    setRequirementState(reqMatch, matches);

    return hasLength && hasUpper && hasNumber && matches;
}

newPasswordInput.addEventListener("input", validatePasswordRequirements);
confirmPasswordInput.addEventListener("input", validatePasswordRequirements);

/* ==========================================
   BACK BUTTON
========================================== */
backBtn.addEventListener("click", () => {
    window.history.back();
});

/* ==========================================
   REAUTH MODAL CONTROLS
========================================== */
function openReauthModal() {
    hideMessage(reauthMessage);
    reauthPasswordInput.value = "";
    reauthModal.classList.add("active");
    reauthPasswordInput.focus();
}

function closeReauthModal() {
    reauthModal.classList.remove("active");
    hideMessage(reauthMessage);
    reauthForm.reset();
}

closeReauthModalBtn.addEventListener("click", closeReauthModal);

reauthModal.addEventListener("click", (e) => {
    if (e.target === reauthModal) closeReauthModal();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && reauthModal.classList.contains("active")) {
        closeReauthModal();
    }
});

/* ==========================================
   CORE: SAVE THE NEW PASSWORD
   This is the part that actually fixes the bug in the screenshot.
   `updatePassword` throws `auth/requires-recent-login` whenever the
   user's sign-in session isn't fresh. Instead of letting that error
   surface raw to the user, we catch it, ask them to confirm their
   current password, reauthenticate, then retry automatically.
========================================== */
async function savePassword(newPassword) {
    if (!currentUser) {
        showMessage(errorMessage, "You are not signed in. Please log in again.");
        setTimeout(() => (window.location.href = LOGIN_PAGE_URL), 1500);
        return;
    }

    try {
        await updatePassword(currentUser, newPassword);
        await finalizeAccountSetup();
    } catch (error) {
        if (error.code === "auth/requires-recent-login") {
            // Stale session — ask the user to confirm their current
            // password, then retry the update once reauthenticated.
            openReauthModal();

            // Store the pending new password so the reauth handler
            // below can finish the job once the user confirms.
            pendingNewPassword = newPassword;
        } else if (error.code === "auth/weak-password") {
            showMessage(errorMessage, "Password is too weak. Please choose a stronger password.");
        } else {
            console.error("Update Password Error:", error);
            showMessage(errorMessage, "An error occurred: " + error.message);
        }
    }
}

let pendingNewPassword = null;

/* ==========================================
   REAUTH FORM SUBMIT — confirms identity, then retries updatePassword
========================================== */
reauthForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMessage(reauthMessage);

    const currentPassword = reauthPasswordInput.value;
    if (!currentPassword) {
        showMessage(reauthMessage, "Please enter your current password.");
        return;
    }

    reauthSubmitBtn.disabled = true;
    reauthSubmitBtn.textContent = "Confirming...";

    try {
        const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
        await reauthenticateWithCredential(currentUser, credential);

        // Session is fresh again — retry the password update.
        await updatePassword(currentUser, pendingNewPassword);
        pendingNewPassword = null;

        closeReauthModal();
        await finalizeAccountSetup();
    } catch (error) {
        console.error("Reauthentication Error:", error);
        if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
            showMessage(reauthMessage, "That password is incorrect. Please try again.");
        } else if (error.code === "auth/too-many-requests") {
            showMessage(reauthMessage, "Too many attempts. Please wait a moment and try again.");
        } else {
            showMessage(reauthMessage, "Something went wrong: " + error.message);
        }
    } finally {
        reauthSubmitBtn.disabled = false;
        reauthSubmitBtn.textContent = "Confirm";
    }
});

/* ==========================================
   FINALIZE: mark account setup complete + redirect
   Adjust the field name/value below to match your actual Firestore schema.
========================================== */
async function finalizeAccountSetup() {
    try {
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
            passwordSet: true,
            accountSetupComplete: true,
            updatedAt: new Date()
        });
    } catch (err) {
        // Non-fatal: the password itself was already updated successfully,
        // so we still proceed even if this bookkeeping write fails.
        console.error("Failed to update account setup flag:", err);
    }

    window.location.href = NEXT_PAGE_URL;
}

/* ==========================================
   FORM SUBMIT HANDLER
========================================== */
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMessage(errorMessage);

    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    const isValid = validatePasswordRequirements();

    if (!isValid) {
        if (newPassword !== confirmPassword) {
            showMessage(errorMessage, "Passwords do not match.");
        } else {
            showMessage(errorMessage, "Please meet all password requirements below.");
        }
        return;
    }

    continueBtn.disabled = true;
    continueBtn.textContent = "Saving...";

    await savePassword(newPassword);

    continueBtn.disabled = false;
    continueBtn.textContent = "Continue";
});