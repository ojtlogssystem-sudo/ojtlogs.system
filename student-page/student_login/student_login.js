// Import Firebase SDK Functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    GoogleAuthProvider, 
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc,
    collection,
    addDoc,
    serverTimestamp
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

// DOM Elements
const loginForm = document.getElementById('loginForm');
const googleBtn = document.getElementById('googleBtn');
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('errorMessage');

// Auto pre-fill ng email mula sa Link Query Parameter (?email=student@gmail.com)
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get("email");

    if (emailParam) {
        const emailInput = document.getElementById("email");
        if (emailInput) {
            emailInput.value = emailParam;
        }
    }
});

// Show/Hide Password Toggle
if (togglePassword) {
    togglePassword.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        togglePassword.classList.toggle('fa-eye');
        togglePassword.classList.toggle('fa-eye-slash');
    });
}

function showError(msg) {
    if (errorMessage) {
        errorMessage.textContent = msg;
        errorMessage.style.display = 'block';
    } else {
        alert(msg);
    }
}

function hideError() {
    if (errorMessage) {
        errorMessage.style.display = 'none';
        errorMessage.textContent = '';
    }
}

// Function para sa checking ng Role at Pag-redirect
async function processUserLogin(user) {
    const userDocRef = doc(db, "users", user.uid);
    let userDoc = await getDoc(userDocRef);

    // 1. KUNG MAY EXISTING PROFILE NA SA FIRESTORE (USERS COLLECTION)
    if (userDoc.exists()) {
        const userData = userDoc.data();

        // Kunin ang role mula sa 'role' o 'userType'
        const role = (userData.role || userData.userType || "student").toString().toLowerCase();

        // KUNG COORDINATOR O ADMIN -> REDIRECT SA COORDINATOR DASHBOARD
        if (role === "coordinator" || role === "admin") {
            window.location.href = "/coordinator-page/dashboard/dashboard.html";
            return;
        }

        // KUNG STUDENT -> I-check ang Profile Status bago pumunta sa Dashboard
        if (role === "student") {
            // I-record ang Student Login
            await addDoc(collection(db, "logs"), {
                type: "login",
                action: "Login",
                title: "Student Login",
                description: `${userData.fullName || userData.name || "Student"} logged into the system.`,
                studentName: userData.fullName || userData.name || "Student",
                timestamp: serverTimestamp()
            });

            const isComplete = userData.profileCompleted === true || userData.isProfileComplete === true;

            if (isComplete) {
                // Pag kumpleto na ang profile -> Student Dashboard
                window.location.href = "/student-page/student_dashboard/student_dashboard.html";
            } else {
                // Pag hindi pa kumpleto -> Complete Profile Page
                window.location.href = "/student-page/profile/profile.html";
            }
            return;
        }
    }

    // 2. KUNG BAGONG LOG-IN NA WALA PA SA USERS COLLECTION
    const emailKey = user.email.toLowerCase();
    
    // I-check kung invited student ito mula sa invitations collection
    let inviteDocRef = doc(db, "invitations", emailKey);
    let inviteDoc = await getDoc(inviteDocRef);

    if (!inviteDoc.exists()) {
        inviteDocRef = doc(db, "invitations", user.email);
        inviteDoc = await getDoc(inviteDocRef);
    }

    let coordinatorId = null;
    let userName = user.displayName || "User";
    let detectedRole = "student"; // Default role

    if (inviteDoc.exists()) {
        const inviteData = inviteDoc.data();
        coordinatorId = inviteData.coordinatorId || null;
        if (inviteData.name) userName = inviteData.name;
        if (inviteData.role) detectedRole = inviteData.role.toLowerCase();
    }

    // Gagawa ng paunang record sa Firestore `users` collection
    await setDoc(userDocRef, {
        uid: user.uid,
        name: userName,
        email: emailKey,
        role: detectedRole,
        status: "Active",
        profileCompleted: detectedRole === "student" ? false : true,
        invitedBy: coordinatorId,
        createdAt: new Date()
    });

    // Pagtukoy sa pupuntahang page depende sa natukoy na role
    if (detectedRole === "coordinator" || detectedRole === "admin") {
        window.location.href = "/coordinator-page/dashboard/dashboard.html";
    } else {
        window.location.href = "/student-page/profile/profile.html";
    }
}

// EMAIL & PASSWORD LOGIN HANDLER
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const loginBtn = document.getElementById('loginBtn');

        loginBtn.disabled = true;
        loginBtn.textContent = "Logging in...";

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            await processUserLogin(userCredential.user);
        } catch (error) {
            console.error("Login Error:", error);
            showError("Mali ang email o password. Subukan ulit.");
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = "Login";
        }
    });
}

// GOOGLE SIGN-IN HANDLER
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        hideError();
        const provider = new GoogleAuthProvider();

        try {
            const result = await signInWithPopup(auth, provider);
            await processUserLogin(result.user);
        } catch (error) {
            console.error("Google Auth Error:", error);
            if (error.code !== 'auth/popup-closed-by-user') {
                showError("Nabigo ang Google Sign-In: " + error.message);
            }
        }
    });
}