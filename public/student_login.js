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

// Function para sa checking ng User at pagpuno ng Requirements Form
async function processStudentLogin(user) {
    const userDocRef = doc(db, "users", user.uid);
    let userDoc = await getDoc(userDocRef);

    // 1. KUNG MAY EXISTING PROFILE NA SA FIRESTORE
    if (userDoc.exists()) {

    const userData = userDoc.data();

    const role =
        (userData.role || userData.userType || "student")
            .toString()
            .toLowerCase();

    // Record student login
    if (role === "student") {
        await addDoc(collection(db, "logs"), {
            type: "login",
            action: "Login",
            title: "Student Login",
            description: `${userData.fullName || userData.name || "Student"} logged into the system.`,
            studentName: userData.fullName || userData.name || "Student",
            timestamp: serverTimestamp()
        });
    }

    if (role === "coordinator" || role === "admin") {

        window.location.href =
            "../coordinator-page/dashboard/dashboard.html";

    } else {

        console.log("DEBUG isProfileComplete value:", userData.isProfileComplete, userData.profileCompleted);

        const isComplete =
            userData.profileCompleted === true ||
            userData.isProfileComplete === true;

        if (isComplete) {

            window.location.href =
                "../student_dashboard/student_dashboard.html";

        } else {

            window.location.href =
                "../profile/profile.html";

        }
    }

    return;
}

    // 2. KUNG BAGONG LOG-IN (GOOGLE O EMAIL)
    const emailKey = user.email.toLowerCase();
    
    // Subukan muna i-check sa invitations collection
    let inviteDocRef = doc(db, "invitations", emailKey);
    let inviteDoc = await getDoc(inviteDocRef);

    if (!inviteDoc.exists()) {
        inviteDocRef = doc(db, "invitations", user.email);
        inviteDoc = await getDoc(inviteDocRef);
    }

    let coordinatorId = null;
    let studentName = user.displayName || "Student User";

    if (inviteDoc.exists()) {
        const inviteData = inviteDoc.data();
        coordinatorId = inviteData.coordinatorId || null;
        if (inviteData.name) studentName = inviteData.name;
    }

    // Gagawa ng paunang record sa users collection na may flag na profileCompleted: false
    await setDoc(userDocRef, {
        uid: user.uid,
        name: studentName,
        email: emailKey,
        role: "student",
        status: "Active",
        profileCompleted: false, // Priority Flag para sa profile form
        invitedBy: coordinatorId,
        createdAt: new Date()
    });

    // Diretso papuntang Requirements Form
    window.location.href = "../profile/profile.html";
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
            await processStudentLogin(userCredential.user);
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
            await processStudentLogin(result.user);
        } catch (error) {
            console.error("Google Auth Error:", error);
            if (error.code !== 'auth/popup-closed-by-user') {
                showError("Nabigo ang Google Sign-In: " + error.message);
            }
        }
    });
}