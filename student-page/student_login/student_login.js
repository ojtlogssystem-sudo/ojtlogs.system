// Import Firebase SDK Functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    GoogleAuthProvider, 
    signInWithPopup,
    sendPasswordResetEmail,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc,
    collection,
    addDoc,
    getDocs,
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
const forgotBtn = document.getElementById('forgotBtn');

// Forgot Password Modal elements
const forgotModal = document.getElementById('forgotModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const resetForm = document.getElementById('resetForm');
const resetEmailInput = document.getElementById('resetEmail');
const resetBtn = document.getElementById('resetBtn');
const modalMessage = document.getElementById('modalMessage');

// Entrance transition: alisin ang "pre-load" class isang frame after
// load, para maka-trigger ang CSS transition (fade + slide-in) imbes
// na basta lumitaw agad ang page.
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get("email");

    if (emailParam) {
        const emailInput = document.getElementById("email");
        if (emailInput) {
            emailInput.value = emailParam;
        }
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.body.classList.remove("pre-load");
        });
    });
});

// Page Transition Overlay - ginagamit sa halip na direktang
// `window.location.href = ...` sa loob ng processUserLogin, para may
// maayos na fade/spinner transition bago mag-navigate sa susunod na page.
const transitionOverlay = document.getElementById('pageTransitionOverlay');
const transitionText = document.getElementById('pageTransitionText');

function goTo(url, message = "Loading...") {
    if (!transitionOverlay) {
        window.location.href = url;
        return;
    }

    if (transitionText) transitionText.textContent = message;
    transitionOverlay.classList.add('active');

    // Konting delay lang para makita ang transition bago mag-navigate -
    // hindi ito hinihintay ng anumang async na trabaho.
    setTimeout(() => {
        window.location.href = url;
    }, 350);
}

// Show/Hide Password Toggle
if (togglePassword) {
    togglePassword.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        togglePassword.classList.toggle('fa-eye');
        togglePassword.classList.toggle('fa-eye-slash');
    });
}

function showMessage(el, msg, isSuccess = false) {
    if (!el) {
        alert(msg);
        return;
    }
    el.textContent = msg;
    el.classList.toggle('success', isSuccess);
    el.style.display = 'block';
}

function hideMessage(el) {
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
    el.classList.remove('success');
}

function showError(msg) {
    showMessage(errorMessage, msg, false);
}

function hideError() {
    hideMessage(errorMessage);
}

function showSuccess(msg) {
    showMessage(errorMessage, msg, true);
}

// Function for checking the Role and Redirecting
async function processUserLogin(user) {
    const userDocRef = doc(db, "users", user.uid);
    let userDoc = await getDoc(userDocRef);

    // 1. IF THE PROFILE ALREADY EXISTS IN FIRESTORE (USERS COLLECTION)
    if (userDoc.exists()) {
        const userData = userDoc.data();

        // Na-"delete" (soft delete) ng coordinator ang account na ito sa
        // Students page. Hindi natin tinatanggal ang aktwal na Firebase
        // Auth account (kailangan ng Admin SDK/Cloud Function para dun),
        // kaya dito natin ito hinaharang bago pa man makapasok sa dashboard
        // o sa profile-completion page.
        if (userData.accountDisabled === true) {
            await signOut(auth);
            showError("This account has been removed by the coordinator. Please contact the coordinator.");
            return;
        }

        // Get the role from 'role' or 'userType'
        const role = (userData.role || userData.userType || "student").toString().toLowerCase();

        // IF COORDINATOR OR ADMIN -> REDIRECT TO COORDINATOR DASHBOARD
        if (role === "coordinator" || role === "admin") {
            goTo("/coordinator-page/dashboard/dashboard.html", "Opening dashboard...");
            return;
        }

        // IF STUDENT -> Check the Profile Status before going to the Dashboard
        if (role === "student") {
            // Record the Student Login
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
                // If the profile is complete -> Student Dashboard
                goTo("/student-page/student_dashboard/student_dashboard.html", "Opening your dashboard...");
            } else {
                // If not yet complete -> Complete Profile Page
                goTo("/student-page/profile/profile.html", "Almost there...");
            }
            return;
        }
    }

    // 2. IF THIS IS A NEW LOGIN NOT YET IN THE USERS COLLECTION
    const emailKey = user.email.toLowerCase();
    
    // Hanapin ang invitation doc gamit ang "email" FIELD, hindi ang
    // document ID - dahil sa students.js, gamit ang addDoc (random/
    // auto-generated ang document ID) ang paggawa ng invitation, kaya
    // hindi kailanman tutugma ang naunang doc(db, "invitations", email)
    // na lookup. Ito ang dahilan kung bakit "gumagana" (sa maling paraan)
    // ang hindi-invited na Google accounts dati - hindi talaga natatagpuan
    // ang invite, kaya bumabagsak lang sa default na "student" account
    // creation sa halip na tanggihan.
    const invitesSnapshot = await getDocs(collection(db, "invitations"));
    const matchedInvite = invitesSnapshot.docs.find(
        (docSnap) => (docSnap.data().email || "").toLowerCase().trim() === emailKey
    );
    const inviteDoc = matchedInvite || null;

    // Walang invitation mula sa coordinator para sa email na ito. Sa
    // Google Sign-In, awtomatikong gumagawa si Firebase ng bagong Auth
    // account kahit random na Google account ang piliin - kaya kailangan
    // dito i-block bago pa ito maka-gawa ng "users" doc at makarating sa
    // profile page. Tinatanggal din natin ang kaka-create lang na Auth
    // account (sarili pa lang niyang account kaya kaya niya itong i-delete
    // gamit ang client SDK, walang Admin SDK na kailangan) para hindi na
    // ito magamit ulit sa susunod na pagtatangka.
    if (!inviteDoc) {
        try {
            await user.delete();
        } catch (cleanupError) {
            console.error("Could not remove unauthorized auto-created account:", cleanupError);
            await signOut(auth);
        }
        showError("No access. This Google account has not been invited by your coordinator.");
        return;
    }

    // May invitation - kunin ang details galing dito (coordinator, pangalan,
    // role) para sa bagong account.
    const inviteData = inviteDoc.data();
    let coordinatorId = inviteData.coordinatorId || null;
    let userName = inviteData.name || user.displayName || "User";
    let detectedRole = inviteData.role ? inviteData.role.toLowerCase() : "student";

    // Create an initial record in the Firestore `users` collection
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

    // Determine which page to go to based on the detected role
    if (detectedRole === "coordinator" || detectedRole === "admin") {
        goTo("/coordinator-page/dashboard/dashboard.html", "Opening dashboard...");
    } else {
        goTo("/student-page/profile/profile.html", "Setting up your profile...");
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
            showError("Incorrect email or password. Please try again.");
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = "Login";
        }
    });
}

// FORGOT PASSWORD MODAL — OPEN / CLOSE
function openForgotModal() {
    if (!forgotModal) return;

    // Pre-fill using the value of the email field on the login form, if any
    const mainEmail = document.getElementById('email').value.trim();
    resetEmailInput.value = mainEmail;
    hideMessage(modalMessage);

    forgotModal.classList.add('active');
    resetEmailInput.focus();
}

function closeForgotModal() {
    if (!forgotModal) return;
    forgotModal.classList.remove('active');
    hideMessage(modalMessage);
    resetForm.reset();
}

if (forgotBtn) {
    forgotBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openForgotModal();
    });
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeForgotModal);
}

// Close the modal when clicking outside the card
if (forgotModal) {
    forgotModal.addEventListener('click', (e) => {
        if (e.target === forgotModal) {
            closeForgotModal();
        }
    });
}

// Close the modal using the Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && forgotModal && forgotModal.classList.contains('active')) {
        closeForgotModal();
    }
});

// FORGOT PASSWORD MODAL — SUBMIT (send reset email)
if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(modalMessage);

        const email = resetEmailInput.value.trim();
        if (!email) {
            showMessage(modalMessage, "Please enter your email.", false);
            return;
        }

        const originalText = resetBtn.textContent;
        resetBtn.disabled = true;
        resetBtn.textContent = "Sending...";

        try {
            await sendPasswordResetEmail(auth, email);
            showMessage(modalMessage, `A password reset link has been sent to ${email}. Please check your inbox (or spam folder).`, true);
        } catch (error) {
            console.error("Password Reset Error:", error);

            switch (error.code) {
                case 'auth/invalid-email':
                    showMessage(modalMessage, "Invalid email format. Please check and try again.", false);
                    break;
                case 'auth/user-not-found':
                    // We don't reveal whether an account exists, for security —
                    // use the same message as the successful case.
                    showMessage(modalMessage, `If an account is registered with ${email}, a reset link will be sent.`, true);
                    break;
                case 'auth/too-many-requests':
                    showMessage(modalMessage, "Too many requests. Please try again later.", false);
                    break;
                default:
                    showMessage(modalMessage, "Something went wrong. Please try again later.", false);
            }
        } finally {
            resetBtn.disabled = false;
            resetBtn.textContent = originalText;
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
                showError("Google Sign-In failed: " + error.message);
            }
        }
    });
}