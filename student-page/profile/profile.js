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

// Base64 string ng na-compress na profile picture (Firestore field: 'photo')
let selectedPhotoBase64 = null;

let currentUser = null;

// Helper Functions para sa Custom In-App Alert
function showAlert(message, alertId = 'alertMessage') {
    const alertBox = document.getElementById(alertId);
    if (alertBox) {
        alertBox.textContent = message;
        alertBox.style.display = 'block';
        alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function hideAlert(alertId = 'alertMessage') {
    const alertBox = document.getElementById(alertId);
    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.textContent = '';
    }
}

function hideAllAlerts() {
    hideAlert('alertMessageStep1');
    hideAlert('alertMessageStep2');
    hideAlert('alertMessage');
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
            if (data.gender) document.getElementById('genderInput').value = data.gender;

            const previewImageEl = document.getElementById('previewImage');
            if (data.photo && previewImageEl) {
                previewImageEl.src = data.photo;
            }
        }
    } else {
        window.location.href = "../login/student_login.html";
    }
});

// ==========================================
// PROFILE PICTURE UPLOAD & PREVIEW (base64 sa Firestore)
// ==========================================
const profileImageInput = document.getElementById('profileImage');
const previewImage = document.getElementById('previewImage');

// I-resize/compress ang image papuntang maliit na JPEG bago i-convert sa
// base64, para hindi lumagpas sa 1MB Firestore document limit.
function compressImageToBase64(file, maxDimension = 400, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Hindi mabasa ang file."));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error("Hindi ma-load ang image."));
            img.onload = () => {
                let { width, height } = img;

                if (width > height && width > maxDimension) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

if (profileImageInput && previewImage) {
    profileImageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Payagan lang ang totoong image files
        if (!file.type.startsWith('image/')) {
            showAlert("Pumili ng valid image file lang (JPG, PNG, atbp.).");
            profileImageInput.value = "";
            return;
        }

        // Sanity check muna sa original file size (10MB) bago pa i-compress
        const maxSizeBytes = 10 * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            showAlert("Masyadong malaki ang image. Pumili ng file na 10MB o mas mababa.");
            profileImageInput.value = "";
            return;
        }

        try {
            let base64 = await compressImageToBase64(file, 400, 0.7);

            // Kung malaki pa rin pagkatapos i-compress, i-lower pa yung quality
            if (base64.length > 700 * 1024) {
                base64 = await compressImageToBase64(file, 300, 0.5);
            }

            if (base64.length > 900 * 1024) {
                showAlert("Hindi ma-compress ang image sa sapat na laki. Sumubok ng ibang photo.");
                profileImageInput.value = "";
                return;
            }

            selectedPhotoBase64 = base64;
            previewImage.src = base64;
        } catch (error) {
            console.error("Image compression error:", error);
            showAlert("May problema sa pag-process ng image. Subukan ulit.");
            profileImageInput.value = "";
        }
    });
}


// I-edit/dagdagan lang ang listahan dito. Ang key (company name) ay
// case-insensitive kaya "Globe", "globe", o "GLOBE" ay tutugma.
const COMPANY_SUPERVISORS = {
    "globe": ["Juan Dela Cruz", "Maria Santos", "Ramon Lopez"],
    "smart": ["Angelo Reyes", "Bea Fernandez"],
    "accenture": ["Michael Tan", "Kristine Uy", "Paolo Garcia"],
    "concentrix": ["Andrea Villanueva", "Jasper Mendoza"],
    "ibm": ["Carlos Ramirez"],
    "converge": ["Nicole Aquino", "Erwin Castro"]
};

function normalizeCompanyName(value) {
    return value.trim().toLowerCase();
}

function findSupervisorsForCompany(typedValue) {
    const key = normalizeCompanyName(typedValue);
    if (!key) return [];

    // Exact match muna
    if (COMPANY_SUPERVISORS[key]) return COMPANY_SUPERVISORS[key];

    // Kung walang exact match, tingnan kung naka-contain yung company key
    // sa tinype (hal. "Globe Telecom" → matches "globe")
    const partialMatch = Object.keys(COMPANY_SUPERVISORS).find(
        companyKey => key.includes(companyKey) || companyKey.includes(key)
    );

    return partialMatch ? COMPANY_SUPERVISORS[partialMatch] : [];
}

function updateSupervisorSuggestions() {
    const companyInput = document.getElementById('companyName');
    const supervisorInput = document.getElementById('supervisorName');
    const datalist = document.getElementById('supervisorList');
    if (!companyInput || !supervisorInput || !datalist) return;

    const matches = findSupervisorsForCompany(companyInput.value);

    // I-populate ang <datalist> options base sa company na na-type
    datalist.innerHTML = matches.map(name => `<option value="${name}"></option>`).join('');

    // Kung iisa lang ang supervisor sa company na yun, i-auto-type na siya
    // sa Supervisor's Name field (basta hindi pa in-eedit ng user manually).
    if (matches.length === 1 && !supervisorInput.dataset.userEdited) {
        supervisorInput.value = matches[0];
    } else if (matches.length === 0 && !supervisorInput.dataset.userEdited) {
        supervisorInput.value = "";
    }
}

const companyNameInput = document.getElementById('companyName');
const supervisorNameInput = document.getElementById('supervisorName');

if (companyNameInput) {
    companyNameInput.addEventListener('input', updateSupervisorSuggestions);
}

if (supervisorNameInput) {
    // Kapag mismong ni-edit ng user ang supervisor field, itigil na ang
    // auto-fill sa field na iyon para hindi ma-overwrite yung pinili niya.
    supervisorNameInput.addEventListener('input', () => {
        supervisorNameInput.dataset.userEdited = "true";
    });
}

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
        const fullName = document.getElementById('fullName').value.trim();
        const studentNumber = document.getElementById('studentNumber').value.trim();
        const gender = document.getElementById('genderInput').value.trim();
        const companyName = document.getElementById('companyName').value.trim();
        const section = document.getElementById('sectionInput').value.trim();

        if (!fullName || !studentNumber || !gender || !companyName || !section) {
            showAlert("Pakisagutan muna ang lahat ng kailangan sa Step 1.", 'alertMessageStep1');
            return;
        }

        hideAlert('alertMessageStep1');
        step1Content.style.display = "none";
        step2Content.style.display = "block";

        stepText.textContent = "Step 2 of 3";
        progressFill.style.width = "66.66%";
        stepTitle.textContent = "Internship Schedule";
        stepSub.textContent = "Set your internship days and working hours.";
        stepIcon.className = "fa-regular fa-calendar";
    });
}


// ==========================================
// STEP 2 → STEP 3
// ==========================================

if (scheduleNextBtn) {
    scheduleNextBtn.addEventListener('click', () => {
        const selectedDays = document.querySelectorAll('.day-btn.active');

        if (selectedDays.length === 0) {
            showAlert("Please select at least one internship day.", 'alertMessageStep2');
            return;
        }

        const morningEnabled = document.getElementById('morningEnabled').checked;
        const afternoonEnabled = document.getElementById('afternoonEnabled').checked;

        if (!morningEnabled && !afternoonEnabled) {
            showAlert("Please enable at least one session (Morning or Afternoon).", 'alertMessageStep2');
            return;
        }

        if (morningEnabled) {
            const morningTimeIn = document.getElementById('morningTimeIn').value;
            const morningTimeOut = document.getElementById('morningTimeOut').value;

            if (!morningTimeIn || !morningTimeOut) {
                showAlert("Please set your morning Time In and Time Out.", 'alertMessageStep2');
                return;
            }
        }

        if (afternoonEnabled) {
            const afternoonTimeIn = document.getElementById('afternoonTimeIn').value;
            const afternoonTimeOut = document.getElementById('afternoonTimeOut').value;

            if (!afternoonTimeIn || !afternoonTimeOut) {
                showAlert("Please set your afternoon Time In and Time Out.", 'alertMessageStep2');
                return;
            }
        }

        hideAlert('alertMessageStep2');
        step2Content.style.display = "none";
        step3Content.style.display = "block";

        stepText.textContent = "Step 3 of 3";
        progressFill.style.width = "100%";
        stepTitle.textContent = "Account Security";
        stepSub.textContent = "Create a secure password to protect your student account.";
        stepIcon.className = "fa-solid fa-lock";
    });
}


// ==========================================
// STEP 2 → STEP 1
// ==========================================

if (scheduleBackBtn) {
    scheduleBackBtn.addEventListener('click', () => {
        hideAlert('alertMessageStep2');
        step2Content.style.display = "none";
        step1Content.style.display = "block";

        stepText.textContent = "Step 1 of 3";
        progressFill.style.width = "33.33%";
        stepTitle.textContent = "Complete Your Profile";
        stepSub.textContent = "Please fill in the required information below to complete your account setup.";
        stepIcon.className = "fa-regular fa-user";
    });
}


// ==========================================
// STEP 3 → STEP 2
// ==========================================

if (backBtn) {
    backBtn.addEventListener('click', () => {
        hideAlert();
        hideAlert('alertMessageStep2');
        step3Content.style.display = "none";
        step2Content.style.display = "block";

        stepText.textContent = "Step 2 of 3";
        progressFill.style.width = "66.66%";
        stepTitle.textContent = "Internship Schedule";
        stepSub.textContent = "Set your internship days and working hours.";
        stepIcon.className = "fa-regular fa-calendar";
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
    if (!afternoonToggle || !afternoonSchedule) return;

    const enabled = afternoonToggle.checked;

    if (enabled) {
        afternoonSchedule.style.display = "block";
        if (afternoonTimeIn) afternoonTimeIn.disabled = false;
        if (afternoonTimeOut) afternoonTimeOut.disabled = false;
        if (afternoonStatus) {
            afternoonStatus.textContent = "Enabled";
            afternoonStatus.classList.remove("disabled");
        }
    } else {
        afternoonSchedule.style.display = "none";
        if (afternoonTimeIn) afternoonTimeIn.disabled = true;
        if (afternoonTimeOut) afternoonTimeOut.disabled = true;
        if (afternoonStatus) {
            afternoonStatus.textContent = "Disabled";
            afternoonStatus.classList.add("disabled");
        }
    }
}

if (afternoonToggle) {
    afternoonToggle.addEventListener("change", () => {
        updateAfternoonState();
    });
    updateAfternoonState();
}


// ==========================================
// MORNING SESSION ENABLE / DISABLE
// ==========================================

const morningToggle = document.getElementById("morningEnabled");
const morningSchedule = document.getElementById("morningSchedule");
const morningStatus = document.getElementById("morningStatus");
const morningTimeIn = document.getElementById("morningTimeIn");
const morningTimeOut = document.getElementById("morningTimeOut");

function updateMorningState() {
    if (!morningToggle || !morningSchedule) return;

    const enabled = morningToggle.checked;

    if (enabled) {
        morningSchedule.style.display = "block";
        if (morningTimeIn) morningTimeIn.disabled = false;
        if (morningTimeOut) morningTimeOut.disabled = false;
        if (morningStatus) {
            morningStatus.textContent = "Enabled";
            morningStatus.classList.remove("disabled");
        }
    } else {
        morningSchedule.style.display = "none";
        if (morningTimeIn) morningTimeIn.disabled = true;
        if (morningTimeOut) morningTimeOut.disabled = true;
        if (morningStatus) {
            morningStatus.textContent = "Disabled";
            morningStatus.classList.add("disabled");
        }
    }
}

if (morningToggle) {
    morningToggle.addEventListener("change", () => {
        updateMorningState();
    });
    updateMorningState();
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


// ==========================================
// SHOW / HIDE PASSWORD TOGGLE LOGIC
// ==========================================

const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');

if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        togglePassword.classList.toggle('fa-eye');
        togglePassword.classList.toggle('fa-eye-slash');
    });
}

const toggleConfirmPassword = document.getElementById('toggleConfirmPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');

if (toggleConfirmPassword && confirmPasswordInput) {
    toggleConfirmPassword.addEventListener('click', () => {
        const type = confirmPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        confirmPasswordInput.setAttribute('type', type);
        
        toggleConfirmPassword.classList.toggle('fa-eye');
        toggleConfirmPassword.classList.toggle('fa-eye-slash');
    });
}


// ==========================================
// FINAL FORM SUBMISSION (STEP 3 SAVE & REDIRECT)
// ==========================================

const profileForm = document.getElementById('profileForm');

if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        // Password Validation Rules
        const minLength = password.length >= 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasNumber = /\d/.test(password);

        if (!minLength || !hasUpperCase || !hasNumber) {
            showAlert("Password must be at least 8 characters long, contain at least 1 uppercase letter, and at least 1 number.");
            return;
        }

        if (password !== confirmPassword) {
            showAlert("Passwords do not match.");
            return;
        }

        if (!currentUser) {
            showAlert("No authenticated user found. Please log in again.");
            return;
        }

        try {
            const fullName = document.getElementById('fullName').value.trim();
            const studentNumber = document.getElementById('studentNumber').value.trim();
            const gender = document.getElementById('genderInput').value.trim();
            const companyName = document.getElementById('companyName').value.trim();
            const supervisorName = document.getElementById('supervisorName').value.trim();
            
            // Kukunin ang Course (BSIT) at i-kokombina sa Section input para maging "BSIT 401"
            const course = document.getElementById('courseInput').value.trim();
            const rawSection = document.getElementById('sectionInput').value.trim();
            const cleanSection = rawSection.replace(/^bsit\s*/i, '');
            const section = `${course} ${cleanSection}`;
            
            const selectedDays = getSelectedInternshipDays();

            const workModality =
                document.querySelector(
                    'input[name="workModality"]:checked'
                )?.value || "On-site";

            const morningEnabled =
                document.getElementById('morningEnabled').checked;

            const morningTimeIn =
                document.getElementById('morningTimeIn').value;

            const morningTimeOut =
                document.getElementById('morningTimeOut').value;

            const afternoonEnabled =
                document.getElementById('afternoonEnabled').checked;
            
            const scheduleData = {
                // WORK MODALITY
                modality: workModality,

                // INTERNSHIP DAYS
                days: selectedDays,

                // MORNING
                morningEnabled: morningEnabled,

                morning: morningEnabled ? {
                    timeIn: morningTimeIn,
                    timeOut: morningTimeOut
                } : null,

                // AFTERNOON
                afternoonEnabled: afternoonEnabled,

                afternoon: afternoonEnabled ? {
                    timeIn: document.getElementById('afternoonTimeIn').value,
                    timeOut: document.getElementById('afternoonTimeOut').value
                } : null
            };

            // Update Firebase Auth Password
            await updatePassword(currentUser, password);

            // Update Firestore Profile Data
            const userDocRef = doc(db, "users", currentUser.uid);
            await updateDoc(userDocRef, {
                name: fullName,
                studentNumber: studentNumber,
                gender: gender,
                companyName: companyName,
                supervisorName: supervisorName,
                course: course,
                section: section,
                schedule: scheduleData,
                profileCompleted: true,
                ...(selectedPhotoBase64 ? { photo: selectedPhotoBase64 } : {})
            });

            // Redirect to Dashboard
            window.location.href ="/student-page/student_dashboard/student_dashboard.html";

        } catch (error) {
            console.error("Error updating profile:", error);
            showAlert("An error occurred: " + error.message);
        }
    });
}