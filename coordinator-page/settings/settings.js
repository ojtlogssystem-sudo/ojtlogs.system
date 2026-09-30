/* ==========================================
   SETTINGS PAGE
   OJT-LOGS  |  Firebase Connected
   ==========================================
   Loaded as: <script type="module" src="settings.js"></script>
========================================== */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged,
    signOut,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword,
    updateEmail,
    verifyBeforeUpdateEmail,
    sendEmailVerification,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
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
   STATE
========================================== */

let currentUser = null;
let currentData = {};


/* ==========================================
   SMALL HELPERS
========================================== */

const $ = (id) => document.getElementById(id);

let toastTimer = null;

function showToast(message, type = "success") {

    const toast = $("toast");
    const toastMessage = $("toastMessage");
    const toastIcon = $("toastIcon");

    if (!toast) return;

    toastMessage.textContent = message;

    toast.classList.remove("toast-error", "toast-success");
    toast.classList.add(type === "error" ? "toast-error" : "toast-success");

    if (toastIcon) {
        toastIcon.className =
            type === "error"
                ? "fa-solid fa-circle-exclamation"
                : "fa-solid fa-circle-check";
    }

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}


function setBusy(button, busy, busyLabel = "Saving...") {

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


/*
    Firebase error codes are not user friendly,
    so map the common ones to plain language.
*/

function readableError(error) {

    const map = {
        "auth/wrong-password": "Current password is incorrect.",
        "auth/invalid-credential": "Current password is incorrect.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
        "auth/requires-recent-login": "Please sign in again to continue.",
        "auth/email-already-in-use": "That email is already in use.",
        "auth/invalid-email": "That email address is not valid.",
        "auth/weak-password": "Password must be at least 8 characters.",
        "auth/network-request-failed": "No internet connection.",
        "permission-denied": "You do not have permission to save this."
    };

    return map[error?.code] || "Something went wrong. Please try again.";
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

        renderProfile();
        renderAccount();

    } catch (error) {

        console.error("Error loading settings:", error);
        showToast("Could not load your settings.", "error");

    }

});


/* ==========================================
   RENDER: PROFILE
========================================== */

function renderProfile() {

    const name =
        currentData.name ||
        currentData.fullName ||
        currentUser.displayName ||
        "";

    const role =
        currentData.role ||
        currentData.position ||
        "Coordinator";

    $("fullName").value = name;
    $("email").value = currentUser.email || "";
    $("phone").value = currentData.phone || "";
    $("position").value = role;

    $("previewImage").src =
        currentData.photoBase64 ||
        currentData.photoURL ||
        currentUser.photoURL ||
        "../images/profile.png";

    // Header widget + dropdown
    paintHeader(name, role, $("previewImage").src);
}


/* ==========================================
   RENDER: ACCOUNT
========================================== */

function renderAccount() {

    $("accountEmail").textContent = currentUser.email || "—";

    const badge = $("verifiedBadge");

    if (currentUser.emailVerified) {
        badge.className = "status-pill pill-success";
        badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Verified`;
        $("resendVerification").style.display = "none";
    } else {
        badge.className = "status-pill pill-warning";
        badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Not verified`;
        $("resendVerification").style.display = "inline-flex";
    }

    const created = currentUser.metadata?.creationTime;
    const lastLogin = currentUser.metadata?.lastSignInTime;

    const fmt = (value) =>
        value
            ? new Date(value).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short"
              })
            : "—";

    $("accountCreated").textContent = fmt(created);
    $("lastSignIn").textContent = fmt(lastLogin);
    $("accountUid").textContent = currentUser.uid;
}


/* ==========================================
   SAVE PROFILE
========================================== */

$("saveProfile").addEventListener("click", async () => {

    const name = $("fullName").value.trim();
    const phone = $("phone").value.trim();

    if (name === "") {
        showToast("Full name cannot be empty.", "error");
        $("fullName").focus();
        return;
    }

    const button = $("saveProfile");
    setBusy(button, true);

    try {

        const payload = {
            name: name,
            fullName: name,          // dashboard.js reads either field
            phone: phone,
            email: currentUser.email,
            updatedAt: serverTimestamp()
        };

        if ($("previewImage").dataset.changed === "true") {
            payload.photoBase64 = $("previewImage").src;
        }

        await setDoc(
            doc(db, "users", currentUser.uid),
            payload,
            { merge: true }
        );

        currentData = { ...currentData, ...payload };

        $("previewImage").dataset.changed = "false";

        paintHeader(
            name,
            currentData.role || currentData.position || "Coordinator",
            $("previewImage").src
        );

        showToast("Profile saved.");

    } catch (error) {

        console.error("Save profile error:", error);
        showToast(readableError(error), "error");

    } finally {

        setBusy(button, false);

    }

});


$("cancelProfile").addEventListener("click", () => {

    $("previewImage").dataset.changed = "false";
    renderProfile();
    showToast("Changes discarded.");

});


/* ==========================================
   PHOTO UPLOAD
   ------------------------------------------
   The image is resized to 256px and stored as
   a compressed data URL on the user document,
   so no Firebase Storage rules are needed.
========================================== */

$("imageUpload").addEventListener("change", (e) => {

    const file = e.target.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        showToast("Please choose an image file.", "error");
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showToast("Image must be smaller than 5 MB.", "error");
        return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {

        const img = new Image();

        img.onload = () => {

            const size = 256;
            const canvas = document.createElement("canvas");

            canvas.width = size;
            canvas.height = size;

            const ctx = canvas.getContext("2d");

            // center crop to a square
            const min = Math.min(img.width, img.height);
            const sx = (img.width - min) / 2;
            const sy = (img.height - min) / 2;

            ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);

            const preview = $("previewImage");

            preview.src = canvas.toDataURL("image/jpeg", 0.85);
            preview.dataset.changed = "true";

            showToast("Photo ready. Click Save changes to apply.");

        };

        img.src = event.target.result;

    };

    reader.readAsDataURL(file);

    e.target.value = "";

});


/* ==========================================
   PASSWORD: SHOW / HIDE
========================================== */

document.querySelectorAll(".toggle-password").forEach((button) => {

    button.addEventListener("click", () => {

        const target = $(button.dataset.target);
        const icon = button.querySelector("i");

        if (!target) return;

        const hidden = target.type === "password";

        target.type = hidden ? "text" : "password";

        icon.classList.toggle("fa-eye", !hidden);
        icon.classList.toggle("fa-eye-slash", hidden);

    });

});


/* ==========================================
   PASSWORD STRENGTH
========================================== */

const strengthLevels = [
    { width: "20%", color: "#dc2626", label: "Weak" },
    { width: "20%", color: "#dc2626", label: "Weak" },
    { width: "40%", color: "#f59e0b", label: "Fair" },
    { width: "60%", color: "#eab308", label: "Good" },
    { width: "80%", color: "#22c55e", label: "Strong" },
    { width: "100%", color: "#16a34a", label: "Very strong" }
];

$("newPassword").addEventListener("input", () => {

    const password = $("newPassword").value;
    const fill = $("strengthFill");
    const text = $("strengthText");

    if (password === "") {
        fill.style.width = "0";
        text.textContent = "Password strength";
        return;
    }

    let score = 0;

    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const level = strengthLevels[score];

    fill.style.width = level.width;
    fill.style.background = level.color;
    text.textContent = level.label;

});


/* ==========================================
   PASSWORD MATCH
========================================== */

$("confirmPassword").addEventListener("input", () => {

    const match = $("passwordMatch");
    const confirmValue = $("confirmPassword").value;

    if (confirmValue === "") {
        match.textContent = "";
        return;
    }

    const isMatch = $("newPassword").value === confirmValue;

    match.textContent = isMatch
        ? "Passwords match"
        : "Passwords do not match";

    match.style.color = isMatch ? "#16a34a" : "#dc2626";

});


/* ==========================================
   UPDATE PASSWORD (Firebase Auth)
========================================== */

$("updatePassword").addEventListener("click", async () => {

    const current = $("currentPassword").value;
    const next = $("newPassword").value;
    const confirm = $("confirmPassword").value;

    if (!current || !next || !confirm) {
        showToast("Fill in all password fields.", "error");
        return;
    }

    if (next !== confirm) {
        showToast("Passwords do not match.", "error");
        return;
    }

    if (next.length < 8) {
        showToast("Password must be at least 8 characters.", "error");
        return;
    }

    if (next === current) {
        showToast("New password must be different.", "error");
        return;
    }

    const button = $("updatePassword");
    setBusy(button, true, "Updating...");

    try {

        const credential = EmailAuthProvider.credential(
            currentUser.email,
            current
        );

        await reauthenticateWithCredential(currentUser, credential);

        await updatePassword(currentUser, next);

        await setDoc(
            doc(db, "users", currentUser.uid),
            { passwordUpdatedAt: serverTimestamp() },
            { merge: true }
        );

        $("currentPassword").value = "";
        $("newPassword").value = "";
        $("confirmPassword").value = "";

        $("strengthFill").style.width = "0";
        $("strengthText").textContent = "Password strength";
        $("passwordMatch").textContent = "";

        showToast("Password updated.");

    } catch (error) {

        console.error("Update password error:", error);
        showToast(readableError(error), "error");

    } finally {

        setBusy(button, false);

    }

});


/* ==========================================
   ACCOUNT: CHANGE EMAIL
========================================== */

$("changeEmailBtn").addEventListener("click", () => {

    const box = $("emailChangeBox");
    const isOpen = box.style.display === "block";

    box.style.display = isOpen ? "none" : "block";

    if (!isOpen) $("newEmail").focus();

});


$("confirmEmailChange").addEventListener("click", async () => {

    const newEmail = $("newEmail").value.trim();
    const password = $("emailPassword").value;

    if (!newEmail || !password) {
        showToast("Enter your new email and current password.", "error");
        return;
    }

    if (newEmail === currentUser.email) {
        showToast("That is already your email.", "error");
        return;
    }

    const button = $("confirmEmailChange");
    setBusy(button, true, "Sending...");

    try {

        const credential = EmailAuthProvider.credential(
            currentUser.email,
            password
        );

        await reauthenticateWithCredential(currentUser, credential);

        /*
            verifyBeforeUpdateEmail sends a confirmation link
            first. The address only changes once the link is
            opened, which is required when email enumeration
            protection is enabled on the project.
        */

        try {
            await verifyBeforeUpdateEmail(currentUser, newEmail);
            showToast("Verification link sent to " + newEmail);
        } catch (inner) {
            await updateEmail(currentUser, newEmail);
            await setDoc(
                doc(db, "users", currentUser.uid),
                { email: newEmail, updatedAt: serverTimestamp() },
                { merge: true }
            );
            showToast("Email updated.");
            renderAccount();
        }

        $("newEmail").value = "";
        $("emailPassword").value = "";
        $("emailChangeBox").style.display = "none";

    } catch (error) {

        console.error("Change email error:", error);
        showToast(readableError(error), "error");

    } finally {

        setBusy(button, false);

    }

});


$("cancelEmailChange").addEventListener("click", () => {

    $("newEmail").value = "";
    $("emailPassword").value = "";
    $("emailChangeBox").style.display = "none";

});


/* ==========================================
   ACCOUNT: VERIFICATION + RESET LINK
========================================== */

$("resendVerification").addEventListener("click", async () => {

    const button = $("resendVerification");
    setBusy(button, true, "Sending...");

    try {
        await sendEmailVerification(currentUser);
        showToast("Verification email sent.");
    } catch (error) {
        showToast(readableError(error), "error");
    } finally {
        setBusy(button, false);
    }

});


$("sendResetLink").addEventListener("click", async () => {

    const button = $("sendResetLink");
    setBusy(button, true, "Sending...");

    try {
        await sendPasswordResetEmail(auth, currentUser.email);
        showToast("Reset link sent to " + currentUser.email);
    } catch (error) {
        showToast(readableError(error), "error");
    } finally {
        setBusy(button, false);
    }

});


/* ==========================================
   SESSION: SIGN OUT
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


/* ==========================================
   DANGER ZONE: DEACTIVATE ACCOUNT
   ------------------------------------------
   Flags the account instead of deleting it,
   so OJT records stay intact for auditing.
========================================== */

$("deactivateAccount").addEventListener("click", async () => {

    const confirmed = window.confirm(
        "Deactivate your account? You will be signed out and an " +
        "administrator has to restore access before you can log in again."
    );

    if (!confirmed) return;

    const button = $("deactivateAccount");
    setBusy(button, true, "Deactivating...");

    try {

        await setDoc(
            doc(db, "users", currentUser.uid),
            {
                accountStatus: "deactivated",
                deactivatedAt: serverTimestamp()
            },
            { merge: true }
        );

        await signOut(auth);

        window.location.href = LOGIN_PAGE;

    } catch (error) {

        console.error("Deactivate error:", error);
        showToast(readableError(error), "error");
        setBusy(button, false);

    }

});


/* ==========================================
   ENTER KEY SUPPORT
========================================== */

document.addEventListener("keydown", (e) => {

    if (e.key !== "Enter") return;

    const active = document.activeElement;

    if (!active || active.tagName !== "INPUT") return;

    if (["currentPassword", "newPassword", "confirmPassword"].includes(active.id)) {
        $("updatePassword").click();
    }

    if (["fullName", "phone"].includes(active.id)) {
        $("saveProfile").click();
    }

    if (["newEmail", "emailPassword"].includes(active.id)) {
        $("confirmEmailChange").click();
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

    // Ang mismong header markup (avatar, dropdown, logout) ay
    // hawak na ng shared header.js - dito, i-re-paint lang agad ang
    // mga elemento nito pagkatapos mag-save, para hindi na
    // maghintay ng reload bago lumabas ang bagong pangalan/larawan.

    const nameEl = document.getElementById("userName");
    const roleEl = document.getElementById("userRole");

    if (nameEl) nameEl.textContent = name || "OJT Coordinator";
    if (roleEl) roleEl.textContent = (role || "Coordinator").toUpperCase();

    paintAvatar(document.getElementById("userAvatar"), photo, name);
    paintAvatar(document.getElementById("menuAvatar"), photo, name);

    const menuName = document.getElementById("menuName");
    const menuEmail = document.getElementById("menuEmail");

    if (menuName) menuName.textContent = name || "OJT Coordinator";
    if (menuEmail) menuEmail.textContent = currentUser?.email || "";

}