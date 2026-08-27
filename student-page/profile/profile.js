import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

let currentUser = null;

// Helper Functions para sa Custom In-App Alert
function showAlert(message) {
    const alertBox = document.getElementById('alertMessage');
    if (alertBox) {
        alertBox.textContent = message;
        alertBox.style.display = 'block';
        alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.name) document.getElementById('fullName').value = data.name;
        }
    } else {
        window.location.href = "../login/student_login.html";
    }
});

// MULTI-STEP NAVIGATION LOGIC
const step1Content = document.getElementById('step1Content');
const step2Content = document.getElementById('step2Content');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const stepText = document.getElementById('stepText');
const progressFill = document.getElementById('progressFill');
const stepTitle = document.getElementById('stepTitle');
const stepSub = document.getElementById('stepSub');
const stepIcon = document.getElementById('stepIcon');

if (nextBtn) {
    nextBtn.addEventListener('click', () => {
        // Validation sa Step 1
        const fullName = document.getElementById('fullName').value.trim();
        const studentNumber = document.getElementById('studentNumber').value.trim();
        const companyName = document.getElementById('companyName').value.trim();
        const section = document.getElementById('sectionSelect').value;
        const course = document.getElementById('courseSelect').value;

        if (!fullName || !studentNumber || !companyName || !section || !course) {
            alert("Pakisagutan muna ang lahat ng kailangan sa Step 1.");
            return;
        }

        // Lumipat sa Step 2 (Account Security)
        step1Content.style.display = "none";
        step2Content.style.display = "block";

        stepText.textContent = "Step 2 of 2";
        progressFill.style.width = "100%";
        stepTitle.textContent = "Account Security";
        stepSub.textContent = "Create a secure password to protect your student account.";
        stepIcon.className = "fa-solid fa-lock";
    });
}

if (backBtn) {
    backBtn.addEventListener('click', () => {
        hideAlert();
        // Bumalik sa Step 1 (Profile Information)
        step2Content.style.display = "none";
        step1Content.style.display = "block";

        stepText.textContent = "Step 1 of 2";
        progressFill.style.width = "50%";
        stepTitle.textContent = "Complete Your Profile";
        stepSub.textContent = "Please fill in the required information below to complete your account setup.";
        stepIcon.className = "fa-regular fa-user";
    });
}

// Profile Image Preview
const profileImageInput = document.getElementById('profileImage');
const previewImage = document.getElementById('previewImage');

if (profileImageInput) {
    profileImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                previewImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

// Password Show/Hide Toggle
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

// Final Form Submit Handler
const profileForm = document.getElementById('profileForm');
if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const fullName = document.getElementById('fullName').value.trim();
        const studentNumber = document.getElementById('studentNumber').value.trim();
        const companyName = document.getElementById('companyName').value.trim();
        const section = document.getElementById('sectionSelect').value;
        const course = document.getElementById('courseSelect').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const saveBtn = document.getElementById('saveProfileBtn');

        // Validation para sa Password Matches at Rules
        if (password !== confirmPassword) {
            showAlert("Hindi magkatugma ang Password at Confirm Password.");
            return;
        }

        const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
        if (!passwordRegex.test(password)) {
            showAlert("The password must be at least 8 characters long, include at least 1 uppercase letter, and 1 number.");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
            if (currentUser) {
                // 1. Subukang i-update ang Auth Password
                try {
                    await updatePassword(currentUser, password);
                } catch (pwError) {
                    console.warn("Could not update auth password directly:", pwError.code);
                    // Kung 'auth/requires-recent-login', i-bypass ang password update para sa Google/existing sessions
                    if (pwError.code !== 'auth/requires-recent-login') {
                        throw pwError;
                    }
                }

                // 2. I-update pa rin ang Firestore Profile Data at i-mark na Complete
                const userDocRef = doc(db, "users", currentUser.uid);
                await updateDoc(userDocRef, {
                    name: fullName,
                    studentNumber: studentNumber,
                    companyName: companyName,
                    section: section,
                    course: course,
                    isProfileComplete: true,
                    updatedAt: new Date()
                });

                // Redirection sa Dashboard
                window.location.href = "../student_dashboard/student_dashboard.html";
            }
        } catch (error) {
            console.error("Error saving profile:", error);
            showAlert("Nagkaroon ng error sa pag-save: " + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Submit & Continue";
        }
    });
}