import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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

// Custom Alert Helpers
function showAlert(message) {
    const alertBox = document.getElementById('alertMessage');
    if (alertBox) {
        alertBox.textContent = message;
        alertBox.style.display = 'block';
    }
}

function hideAlert() {
    const alertBox = document.getElementById('alertMessage');
    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.textContent = '';
    }
}

// Auth State Check
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
    } else {
        window.location.href = "../login/student_login.html";
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
    window.location.href = "settings.html";
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
        showAlert("Hindi magkatugma ang New Password at Confirm New Password.");
        return;
    }

    // 2. Password Regex Validation (At least 8 chars, 1 uppercase, 1 number)
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
        showAlert("Ang bagong password ay dapat mayroong hindi bababa sa 8 characters, may 1 uppercase letter, at 1 number.");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Updating...";

    try {
        if (currentUser && currentUser.email) {
            // Re-authenticate user gamit ang Current Password bago baguhin
            const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
            await reauthenticateWithCredential(currentUser, credential);

            // Pagkatapos ma-verify, i-update ang password
            await updatePassword(currentUser, newPassword);

            alert("Matawaging matagumpay na nabago ang iyong password!");
            window.location.href = "settings.html";
        }
    } catch (error) {
        console.error("Error changing password:", error);
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
            showAlert("Mali ang kasalukuyang password (Current Password). Subukan muli.");
        } else {
            showAlert("Nagkaroon ng error sa pag-update: " + error.message);
        }
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Update Password";
    }
});