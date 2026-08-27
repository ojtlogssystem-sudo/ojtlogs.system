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
    setDoc
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

// Password Visibility Toggle
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

// Function para suriin ang Coordinator Account
async function processCoordinatorLogin(user) {
    const userDocRef = doc(db, "users", user.uid);
    let userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
        const userData = userDoc.data();
        const role = (userData.role || userData.userType || '').toString().toLowerCase();

        if (role === 'coordinator' || role === 'admin') {
            window.location.href = "../dashboard/dashboard.html";
        } else {
            await auth.signOut();
            showError("Ang account na ito ay para sa Student login lamang.");
        }
    } else {
        // Unang beses mag-login ang Coordinator via Google Sign-In -> Auto-create profile
        await setDoc(userDocRef, {
            uid: user.uid,
            name: user.displayName || "OJT Coordinator",
            email: user.email.toLowerCase(),
            role: "coordinator",
            status: "Active",
            createdAt: new Date()
        });

        window.location.href = "../dashboard/dashboard.html";
    }
}

// =====================================
// 1. EMAIL & PASSWORD LOGIN HANDLER
// =====================================
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
            await processCoordinatorLogin(userCredential.user);
        } catch (error) {
            console.error("Login Error:", error);
            showError("Mali ang email o password. Subukan ulit.");
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = "Login";
        }
    });
}

// =====================================
// 2. GOOGLE SIGN-IN HANDLER
// =====================================
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        hideError();
        const provider = new GoogleAuthProvider();

        try {
            const result = await signInWithPopup(auth, provider);
            await processCoordinatorLogin(result.user);
        } catch (error) {
            console.error("Google Auth Error:", error);
            if (error.code !== 'auth/popup-closed-by-user') {
                showError("Nabigo ang Google Sign-In: " + error.message);
            }
        }
    });
}