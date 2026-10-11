import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// header-loader.js exports loadHeader as an ES module export — it does NOT
// attach to the global scope, so it must be imported directly (not called
// via `typeof loadHeader === "function"` in a plain script, which will
// always be false and silently skip loading the header).
import { loadHeader } from "../templated/header-loader.js";

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

let currentUser = null;

/* ==========================================
   HEADER + SIDEBAR
========================================== */
document.addEventListener("DOMContentLoaded", () => {
    // sidebar-loader.js is a classic script, so loadSidebar is global.
    if (typeof loadSidebar === "function") {
        loadSidebar("Settings");
    } else {
        console.error(
            "[change-pass.js] loadSidebar() is not defined. Check that " +
            "../templated/sidebar-loader.js loaded successfully."
        );
    }

    loadHeader("Change Password", { autoLoadProfile: true }).catch((err) => {
        console.error("[change-pass.js] Failed to load header:", err);
    });
});

// Custom Alert Helpers — the same #alertMessage banner is reused for both
// errors (default, red) and the success message after a password change
// (green, via the "success" class) so nothing pops up as a native alert().
function showAlert(message) {
    const alertBox = document.getElementById('alertMessage');
    if (alertBox) {
        alertBox.classList.remove('success');
        alertBox.textContent = message;
        alertBox.style.display = 'block';
    }
}

function showSuccessAlert(message) {
    const alertBox = document.getElementById('alertMessage');
    if (alertBox) {
        alertBox.classList.add('success');
        alertBox.textContent = message;
        alertBox.style.display = 'block';
    }
}

function hideAlert() {
    const alertBox = document.getElementById('alertMessage');
    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.classList.remove('success');
        alertBox.textContent = '';
    }
}

// Ipinapakita yung success popup pagkatapos ma-update ang password, tapos
// mag-a-auto redirect pabalik sa Settings pagkalipas ng ilang saglit.
function showSuccessModal(redirectUrl, delayMs = 1500) {
    const overlay = document.getElementById('successModalOverlay');
    if (!overlay) {
        window.location.href = redirectUrl;
        return;
    }

    overlay.classList.add('show');

    setTimeout(() => {
        window.location.href = redirectUrl;
    }, delayMs);
}

// Auth State Check
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
    } else {
        window.location.href = "../student_login/student_login.html";
    }
});

// Eye Toggle for Passwords
document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', function() {
        const input = this.previousElementSibling.previousElementSibling;
        if (input.type === 'password') {
            input.type = 'text';
            this.classList.remove('fa-eye');
            this.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            this.classList.remove('fa-eye-slash');
            this.classList.add('fa-eye');
        }
    });
});

// Cancel Button - Return to Settings
document.getElementById('cancelBtn').addEventListener('click', () => {
    window.location.href = "../settings/settings.html";
});

// Submit Form Handler
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const saveBtn = document.getElementById('savePasswordBtn');

    // 1. Password Match Validation
    if (newPassword !== confirmPassword) {
        showAlert("The New Password and Confirm New Password do not match.");
        return;
    }

    // 2. Password Regex Validation (At least 8 chars, 1 uppercase, 1 number)
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
        showAlert("The new password must be at least 8 characters long, contain at least 1 uppercase letter, and include 1 number.");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Updating...";
    let succeeded = false;

    try {
        if (currentUser && currentUser.email) {
            // Re-authenticate user gamit ang Current Password bago baguhin
            const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
            await reauthenticateWithCredential(currentUser, credential);

            // Pagkatapos ma-verify, i-update ang password
            await updatePassword(currentUser, newPassword);

            // In-app success banner instead of a native browser alert() —
            // give the user a moment to see it, then head back to Settings.
            succeeded = true;
            document.getElementById('changePasswordForm').reset();
            saveBtn.textContent = "Updated!";

            showSuccessModal("../settings/settings.html");
        }
    } catch (error) {
        console.error("Error changing password:", error);
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
            showAlert("The current password is incorrect. Please try again.");
        } else {
            showAlert("Nagkaroon ng error sa pag-update: " + error.message);
        }
    } finally {
        // Leave the "Updated!" state alone while the redirect timer is
        // pending — only reset the button back to normal on failure.
        if (!succeeded) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Update Password";
        }
    }
});