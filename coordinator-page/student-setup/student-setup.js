// =====================================
// OJT-LOGS STUDENT SETUP SCRIPT
// =====================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    GoogleAuthProvider, 
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase Config
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Extract Email parameter from URL (?email=student@gmail.com)
const urlParams = new URLSearchParams(window.location.search);
const invitedEmail = urlParams.get('email');

const emailDisplay = document.getElementById('invitedEmail');
const errorMsg = document.getElementById('errorMsg');

if (invitedEmail) {
    emailDisplay.textContent = invitedEmail;
} else {
    emailDisplay.textContent = "No email parameter provided in link.";
    showError("Invalid or missing invitation link.");
}

function showError(msg) {
    if (errorMsg) {
        errorMsg.textContent = msg;
    }
}

// Helper Function: Save User Document & Clear Pending Invitation
async function finalizeRegistration(user, fullName) {
    try {
        // 1. Create or Overwrite Profile in 'users' Firestore Collection
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            name: fullName || user.displayName || invitedEmail || "Student Intern",
            email: user.email,
            role: "student",
            status: "Active",
            createdAt: new Date()
        });

        // 2. Remove entry from 'invitations' collection
        if (invitedEmail) {
            try {
                await deleteDoc(doc(db, "invitations", invitedEmail.toLowerCase()));
            } catch (delErr) {
                console.warn("Notice: Invitation document cleanup skipped:", delErr);
            }
        }

        alert("Account setup successful! Redirecting to Student Dashboard...");
        window.location.href = "../student_dashboard/student_dashboard.html";

    } catch (err) {
        console.error("Setup Finalize Error:", err);
        showError("Error saving student profile: " + err.message);
    }
}

// Option A: Connect via Google Sign-In
const googleBtn = document.getElementById('googleBtn');
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        showError("");
        const provider = new GoogleAuthProvider();

        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // Warning if logged-in google account differs from invited email
            if (invitedEmail && user.email.toLowerCase() !== invitedEmail.toLowerCase()) {
                console.warn(`Logged in email (${user.email}) differs from invited email (${invitedEmail}).`);
            }

            await finalizeRegistration(user, user.displayName);

        } catch (err) {
            console.error("Google Auth Error:", err);
            showError("Google Connection failed: " + err.message);
        }
    });
}

// Option B: Register via Password Form
const setupForm = document.getElementById('setupForm');
if (setupForm) {
    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showError("");

        const name = document.getElementById('fullName').value.trim();
        const password = document.getElementById('password').value;

        if (!invitedEmail) {
            showError("Cannot proceed: Missing invited email address.");
            return;
        }

        const saveBtn = document.getElementById('saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = "Setting up account...";

        try {
            // Create Firebase Auth account
            const userCredential = await createUserWithEmailAndPassword(auth, invitedEmail, password);
            await finalizeRegistration(userCredential.user, name);

        } catch (err) {
            console.error("Registration Error:", err);
            if (err.code === 'auth/email-already-in-use') {
                showError("May account na ang email na ito. Pwedeng mag-login gamit ang Google o Login page.");
            } else {
                showError("Failed to set up account: " + err.message);
            }
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Complete Setup & Login";
        }
    });
}