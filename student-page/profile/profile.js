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

// ==========================================
// MULTI-STEP NAVIGATION LOGIC
// ==========================================

const step1Content = document.getElementById('step1Content');
const step2Content = document.getElementById('step2Content');
const step3Content = document.getElementById('step3Content');

const nextBtn = document.getElementById('nextBtn');
const scheduleNextBtn = document.getElementById('scheduleNextBtn');

const backBtn = document.getElementById('backBtn');
const scheduleBackBtn = document.getElementById('scheduleBackBtn');

const stepText = document.getElementById('stepText');
const progressFill = document.getElementById('progressFill');
const stepTitle = document.getElementById('stepTitle');
const stepSub = document.getElementById('stepSub');
const stepIcon = document.getElementById('stepIcon');


// ==========================================
// STEP 1 → STEP 2
// ==========================================

if (nextBtn) {

    nextBtn.addEventListener('click', () => {

        const fullName =
            document.getElementById('fullName').value.trim();

        const studentNumber =
            document.getElementById('studentNumber').value.trim();

        const companyName =
            document.getElementById('companyName').value.trim();

        const section =
            document.getElementById('sectionSelect').value;

        const course =
            document.getElementById('courseSelect').value;


        if (
            !fullName ||
            !studentNumber ||
            !companyName ||
            !section ||
            !course
        ) {

            alert(
                "Pakisagutan muna ang lahat ng kailangan sa Step 1."
            );

            return;
        }


        // Hide Step 1
        step1Content.style.display = "none";

        // Show Step 2
        step2Content.style.display = "block";

        // Update progress
        stepText.textContent = "Step 2 of 3";
        progressFill.style.width = "66.66%";

        stepTitle.textContent = "Internship Schedule";

        stepSub.textContent =
            "Set your internship days and working hours.";

        stepIcon.className =
            "fa-regular fa-calendar";

    });

}


// ==========================================
// STEP 2 → STEP 3
// ==========================================

if (scheduleNextBtn) {

    scheduleNextBtn.addEventListener('click', () => {

        const selectedDays =
            document.querySelectorAll(
                '.day-btn.active'
            );


        const morningTimeIn =
            document.getElementById(
                'morningTimeIn'
            ).value;

        const morningTimeOut =
            document.getElementById(
                'morningTimeOut'
            ).value;


        // Check days
        if (selectedDays.length === 0) {

            alert(
                "Please select at least one internship day."
            );

            return;
        }


        // Check morning schedule
        if (
            !morningTimeIn ||
            !morningTimeOut
        ) {

            alert(
                "Please set your morning Time In and Time Out."
            );

            return;
        }


        // Check if afternoon is enabled
        const afternoonEnabled =
            document.getElementById(
                'afternoonEnabled'
            ).checked;


        if (afternoonEnabled) {

            const afternoonTimeIn =
                document.getElementById(
                    'afternoonTimeIn'
                ).value;

            const afternoonTimeOut =
                document.getElementById(
                    'afternoonTimeOut'
                ).value;


            if (
                !afternoonTimeIn ||
                !afternoonTimeOut
            ) {

                alert(
                    "Please set your afternoon Time In and Time Out."
                );

                return;
            }

        }


        // Hide Step 2
        step2Content.style.display = "none";

        // Show Step 3
        step3Content.style.display = "block";


        // Update progress
        stepText.textContent = "Step 3 of 3";
        progressFill.style.width = "100%";

        stepTitle.textContent = "Account Security";

        stepSub.textContent =
            "Create a secure password to protect your student account.";

        stepIcon.className =
            "fa-solid fa-lock";

    });

}


// ==========================================
// STEP 2 → STEP 1
// ==========================================

if (scheduleBackBtn) {

    scheduleBackBtn.addEventListener('click', () => {

        step2Content.style.display = "none";

        step1Content.style.display = "block";


        stepText.textContent = "Step 1 of 3";

        progressFill.style.width = "33.33%";

        stepTitle.textContent =
            "Complete Your Profile";

        stepSub.textContent =
            "Please fill in the required information below to complete your account setup.";

        stepIcon.className =
            "fa-regular fa-user";

    });

}


// ==========================================
// STEP 3 → STEP 2
// ==========================================

if (backBtn) {

    backBtn.addEventListener('click', () => {

        hideAlert();


        step3Content.style.display = "none";

        step2Content.style.display = "block";


        stepText.textContent = "Step 2 of 3";

        progressFill.style.width = "66.66%";

        stepTitle.textContent =
            "Internship Schedule";

        stepSub.textContent =
            "Set your internship days and working hours.";

        stepIcon.className =
            "fa-regular fa-calendar";

    });

}

// ==========================================
// INTERNSHIP DAYS SELECTION
// ==========================================

const dayButtons = document.querySelectorAll(".day-btn");

dayButtons.forEach((button) => {
    button.addEventListener("click", () => {
        button.classList.toggle("active");
    });
});


// ==========================================
// AFTERNOON SESSION ENABLE / DISABLE
// ==========================================

const afternoonToggle = document.getElementById("afternoonEnabled");
const afternoonSchedule = document.getElementById("afternoonSchedule");
const afternoonStatus = document.getElementById("afternoonStatus");

const afternoonTimeIn = document.getElementById("afternoonTimeIn");
const afternoonTimeOut = document.getElementById("afternoonTimeOut");


function updateAfternoonState() {

    if (!afternoonToggle || !afternoonSchedule) {
        return;
    }

    const enabled = afternoonToggle.checked;

    if (enabled) {

        // Show afternoon schedule
        afternoonSchedule.style.display = "block";

        // Enable time inputs
        if (afternoonTimeIn) {
            afternoonTimeIn.disabled = false;
        }

        if (afternoonTimeOut) {
            afternoonTimeOut.disabled = false;
        }

        // Change status
        if (afternoonStatus) {
            afternoonStatus.textContent = "Enabled";
            afternoonStatus.classList.remove("disabled");
        }

    } else {

        // Hide afternoon schedule
        afternoonSchedule.style.display = "none";

        // Disable time inputs
        if (afternoonTimeIn) {
            afternoonTimeIn.disabled = true;
        }

        if (afternoonTimeOut) {
            afternoonTimeOut.disabled = true;
        }

        // Change status
        if (afternoonStatus) {
            afternoonStatus.textContent = "Disabled";
            afternoonStatus.classList.add("disabled");
        }
    }
}


// Run when switch is clicked
if (afternoonToggle) {

    afternoonToggle.addEventListener("change", () => {
        updateAfternoonState();
    });

    // Set correct state when page loads
    updateAfternoonState();
}


// ==========================================
// GET SELECTED INTERNSHIP DAYS
// ==========================================

function getSelectedInternshipDays() {

    const selectedDays = [];

    document.querySelectorAll(".day-btn.active").forEach((button) => {
        selectedDays.push(button.dataset.day);
    });

    return selectedDays;
}