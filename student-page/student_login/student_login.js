// Import Firebase SDK Functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    GoogleAuthProvider, 
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    sendPasswordResetEmail,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc,
    updateDoc,
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

let isNavigating = false;

function goTo(url, message = "Loading...") {
    isNavigating = true;
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

// Hanapin ang pinakamainam na invitation para sa email. Kung may higit sa
// isa (hal. na-import ulit ng coordinator), uunahin ang may profile info
// galing sa CSV, tapos ang pinakabago.
async function findInviteForEmail(emailKey) {
    const invitesSnapshot = await getDocs(collection(db, "invitations"));
    const matches = invitesSnapshot.docs.filter(
        (docSnap) => (docSnap.data().email || "").toLowerCase().trim() === emailKey
    );
    if (matches.length === 0) return null;

    matches.sort((a, b) => {
        const A = a.data();
        const B = b.data();
        const hasA = A.fullName ? 1 : 0;
        const hasB = B.fullName ? 1 : 0;
        if (hasA !== hasB) return hasB - hasA;
        return String(B.createdAt || "").localeCompare(String(A.createdAt || ""));
    });
    return matches[0];
}

// Kinukuha ang student info na in-import ng coordinator (CSV) at ginagawang
// fields na naiintindihan ng profile page / students table.
// Wala itong ibabalik na field kung blangko sa invitation.
function buildProfileFromInvite(inviteData) {
    const result = {};
    const fullName = String(inviteData.fullName || "").trim();
    const studentId = String(inviteData.studentId || "").trim();
    const gender = String(inviteData.gender || "").trim();
    const course = String(inviteData.course || "").trim();
    const sec = String(inviteData.section || "").trim();

    if (fullName) result.name = fullName;
    if (studentId) result.studentNumber = studentId;
    if (gender) result.gender = gender;
    if (course) result.course = course;
    if (sec) {
        result.section = (course && !sec.toLowerCase().startsWith(course.toLowerCase()))
            ? `${course} ${sec}`
            : sec;
    }
    return result;
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

            // Hindi pa tapos ang profile -> ilagay sa user doc ang info na
            // in-import ng coordinator (CSV), para lumabas ito sa profile page.
            // Kasama dito ang mga account na na-reset/na-re-invite, kung saan
            // blangko na ang dating user doc.
            if (!isComplete) {
                try {
                    const invite = await findInviteForEmail((user.email || "").toLowerCase().trim());
                    if (invite) {
                        const fromInvite = buildProfileFromInvite(invite.data());
                        if (fromInvite.name) {
                            await updateDoc(userDocRef, fromInvite);
                        }
                    }
                } catch (inviteError) {
                    console.error("Could not apply imported student info:", inviteError);
                }
            }

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
    
    const inviteDoc = await findInviteForEmail(emailKey);

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

    const inviteData = inviteDoc.data();
    let coordinatorId = inviteData.coordinatorId || null;
    const importedProfile = buildProfileFromInvite(inviteData);
    let userName = importedProfile.name || inviteData.name || user.displayName || "User";
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
        createdAt: new Date(),
        // Info na in-import ng coordinator (studentNumber, gender, course, section)
        ...importedProfile,
        name: userName
    });

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
            await handleSignedIn(userCredential.user);
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

if (forgotModal) {
    forgotModal.addEventListener('click', (e) => {
        if (e.target === forgotModal) {
            closeForgotModal();
        }
    });
}

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

// ==========================================
// SIGN-IN HANDLING (Google / session restore)
// ==========================================

// Iisang beses lang dapat tumakbo ang processUserLogin sa bawat login,
// kahit sabay-sabay dumating ang popup result, redirect result, at
// auth state event.
let isProcessingLogin = false;

async function handleSignedIn(user) {
    if (isProcessingLogin) return;
    isProcessingLogin = true;
    isNavigating = false;

    try {
        await processUserLogin(user);
    } catch (error) {
        // Hindi na itatago ang totoong error (hal. Firestore permission denied)
        console.error("Login processing error:", error);
        showError("Could not finish signing in: " + (error && error.message ? error.message : error));
    } finally {
        // Kapag hindi naman lilipat ng page (may error / walang access), payagan ulit mag-login
        if (!isNavigating) isProcessingLogin = false;
    }
}

// Kung may naka-sign in na (hal. bumalik galing Google redirect, o may natirang
// session), ituloy ang login. Hindi na umaasa lang sa getRedirectResult, na
// pwedeng bumalik ng null kapag naka-block ang third-party storage ng browser
// - kaya dati bumabalik lang sa login page na parang walang nangyari.
let initialAuthChecked = false;
onAuthStateChanged(auth, (user) => {
    if (initialAuthChecked) return;
    initialAuthChecked = true;
    if (user && !isProcessingLogin) {
        handleSignedIn(user);
    }
});

// CATCH GOOGLE REDIRECT RESULT (fallback lang, kapag na-block ang popup)
getRedirectResult(auth)
    .then(async (result) => {
        if (result && result.user) {
            await handleSignedIn(result.user);
        }
    })
    .catch((error) => {
        console.error("Google Redirect Error:", error);
        if (error.code !== 'auth/popup-closed-by-user') {
            showError("Google Sign-In failed: " + error.message);
        }
    });

// GOOGLE SIGN-IN HANDLER
// Popup ang gamit (gumagana kahit naka-block ang third-party storage, na
// sumisira sa redirect). Kapag na-block ang popup, saka lang mag-re-redirect.
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        hideError();
        if (isProcessingLogin) return;

        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        googleBtn.disabled = true;
        try {
            const result = await signInWithPopup(auth, provider);
            await handleSignedIn(result.user);
        } catch (error) {
            console.error("Google Sign-In Error:", error);

            if (error.code === 'auth/popup-blocked' ||
                error.code === 'auth/operation-not-supported-in-this-environment') {
                signInWithRedirect(auth, provider);
                return;
            }

            if (error.code === 'auth/popup-closed-by-user' ||
                error.code === 'auth/cancelled-popup-request') {
                return;
            }

            if (error.code === 'auth/unauthorized-domain') {
                showError("This website's domain is not authorized in Firebase. Add it under Authentication > Settings > Authorized domains.");
                return;
            }

            showError("Google Sign-In failed: " + (error.message || error.code));
        } finally {
            googleBtn.disabled = false;
        }
    });
}