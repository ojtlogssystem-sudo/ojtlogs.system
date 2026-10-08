import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc,
    serverTimestamp,
    collection,
    getDocs,
    query,
    orderBy
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

// Naka-save na company/supervisor ng user (kung meron), ise-select balik
// ito sa mga dropdown pagkatapos ma-load ang listahan mula sa Firestore.
let pendingCompanyName = null;
let pendingSupervisorName = null;

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
            if (data.companyName) pendingCompanyName = data.companyName;
            if (data.supervisorName) pendingSupervisorName = data.supervisorName;

            const previewImageEl = document.getElementById('previewImage');
            if (data.photo && previewImageEl) {
                previewImageEl.src = data.photo;
            }

            applyPendingCompanySelection();
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


// ==========================================
// COMPANY & SUPERVISOR TYPEAHEAD (mula sa Firestore "companies" collection,
// yung parehong data na pinapamahalaan ng coordinator sa companies.html)
// Puwedeng mag-type para mag-search, at puwede ring piliin sa listahan.
// ==========================================

// companyName -> array ng supervisor names para sa company na yun
let companiesMap = {};
let selectedCompany = null; // yung eksaktong company name na "committed"

const companyNameInput = document.getElementById('companyName');
const companyNameList = document.getElementById('companyNameList');
const supervisorNameInput = document.getElementById('supervisorName');
const supervisorNameList = document.getElementById('supervisorNameList');

// Generic na typeahead combobox: input + <ul> na listahan sa ibaba.
// getOptions(query) -> array ng string na dapat ipakita.
// onSelect(value) -> tatawagin kapag pinili (click o Enter) ang isang item.
function setupCombobox(inputEl, listEl, getOptions, onSelect) {
    if (!inputEl || !listEl) return { render: () => {} };

    let activeIndex = -1;

    function render(query) {
        const options = getOptions(query);
        activeIndex = -1;

        if (options.length === 0) {
            listEl.innerHTML = `<li class="empty-option">No matches found</li>`;
        } else {
            listEl.innerHTML = options
                .map((opt, i) => `<li data-index="${i}" data-value="${opt.replace(/"/g, '&quot;')}">${opt}</li>`)
                .join('');
        }
    }

    function openList() {
        if (inputEl.disabled) return;
        render(inputEl.value);
        listEl.classList.add('open');
    }

    function closeList() {
        listEl.classList.remove('open');
    }

    function highlight(index) {
        listEl.querySelectorAll('li[data-value]').forEach(li => li.classList.remove('active'));
        const items = listEl.querySelectorAll('li[data-value]');
        if (items[index]) {
            items[index].classList.add('active');
            items[index].scrollIntoView({ block: 'nearest' });
        }
    }

    inputEl.addEventListener('focus', openList);

    inputEl.addEventListener('input', () => {
        openList();
    });

    inputEl.addEventListener('keydown', (e) => {
        const items = listEl.querySelectorAll('li[data-value]');
        if (!listEl.classList.contains('open') || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            highlight(activeIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            highlight(activeIndex);
        } else if (e.key === 'Enter') {
            if (activeIndex >= 0 && items[activeIndex]) {
                e.preventDefault();
                const value = items[activeIndex].dataset.value;
                inputEl.value = value;
                closeList();
                onSelect(value);
            }
        } else if (e.key === 'Escape') {
            closeList();
        }
    });

    // mousedown (hindi click) para mauna ito bago mag-fire ang blur ng input
    listEl.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li[data-value]');
        if (!li) return;
        e.preventDefault();
        const value = li.dataset.value;
        inputEl.value = value;
        closeList();
        onSelect(value);
    });

    inputEl.addEventListener('blur', () => {
        // konting delay para umabot muna ang mousedown handler sa itaas
        setTimeout(closeList, 120);
    });

    return { render, openList, closeList };
}

// I-filter ang mga company base sa tinype (case-insensitive, "contains")
function getCompanyOptions(query) {
    const q = query.trim().toLowerCase();
    const names = Object.keys(companiesMap);
    if (!q) return names;
    return names.filter(name => name.toLowerCase().includes(q));
}

// I-filter ang mga supervisor. Kung may valid na napiling company, doon lang
// mula sa company na yun. Kung wala pa (o wala pang companies sa coordinator),
// ipakita na lang lahat ng supervisor na naka-record sa buong system - type
// pa rin siya + pumipili sa listahan, hindi kailangang mauna ang company.
function getAllKnownSupervisors() {
    const all = new Set();
    Object.values(companiesMap).forEach(list => {
        (list || []).forEach(name => all.add(name));
    });
    return Array.from(all);
}

function getSupervisorOptions(query) {
    const pool = selectedCompany
        ? (companiesMap[selectedCompany] || [])
        : getAllKnownSupervisors();

    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(name => name.toLowerCase().includes(q));
}

function commitCompanySelection(companyName, preselectSupervisor = null) {
    selectedCompany = companyName;

    if (supervisorNameInput && preselectSupervisor !== null) {
        supervisorNameInput.value = preselectSupervisor;
    }
}

// Kapag lumabas o na-edit ang company field, tingnan kung eksaktong tugma
// (case-insensitive) sa isang tunay na company. Kung tugma, i-commit at
// i-enable ang supervisor field; kung hindi, i-clear/disable ito.
function reconcileCompanyValue() {
    if (!companyNameInput) return;

    const typedValue = companyNameInput.value.trim();
    const match = Object.keys(companiesMap).find(
        name => name.toLowerCase() === typedValue.toLowerCase()
    );

    if (match) {
        companyNameInput.value = match;
        const keepSupervisor =
            selectedCompany === match ? supervisorNameInput?.value || null : null;
        commitCompanySelection(match, keepSupervisor);
    } else {
        selectedCompany = null;
    }
}

if (companyNameInput) {
    companyNameInput.addEventListener('blur', () => {
        // konting delay din dito para hindi masagabal sa pag-pili sa listahan
        setTimeout(reconcileCompanyValue, 130);
    });
}

setupCombobox(companyNameInput, companyNameList, getCompanyOptions, (value) => {
    commitCompanySelection(value);
});

setupCombobox(supervisorNameInput, supervisorNameList, getSupervisorOptions, (value) => {
    // pinili mula sa listahan, wala nang kailangang gawin bukod sa pag-set ng value
});

// Kung na-fetch na ang mga company at may naka-save nang company/supervisor
// ang user (galing sa Firestore user doc), ise-select ito bilang default.
function applyPendingCompanySelection() {
    if (!companyNameInput || Object.keys(companiesMap).length === 0) return;
    if (!pendingCompanyName) return;

    const match = Object.keys(companiesMap).find(
        name => name.toLowerCase() === pendingCompanyName.toLowerCase()
    );

    if (match) {
        companyNameInput.value = match;
        commitCompanySelection(match, pendingSupervisorName);
    }

    pendingCompanyName = null;
    pendingSupervisorName = null;
}

async function loadCompanies() {
    if (!companyNameInput) return;

    try {
        const companiesQuery = query(collection(db, "companies"), orderBy("companyName"));
        const snapshot = await getDocs(companiesQuery);

        companiesMap = {};
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.companyName) return;
            companiesMap[data.companyName] = Array.isArray(data.supervisorNames)
                ? data.supervisorNames
                : [];
        });

        applyPendingCompanySelection();
    } catch (error) {
        console.error("Error loading companies:", error);
    }
}

loadCompanies();

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
// STUDENT NUMBER FORMAT  (YYYY-MM-00000, e.g. 2023-07-00975)
// Numbers lang ang tinatanggap; kusang nilalagyan ng "-" habang nagta-type.
// ==========================================

const STUDENT_NUMBER_REGEX = /^\d{4}-\d{2}-\d{5}$/;

function formatStudentNumber(raw) {
    const digits = String(raw).replace(/\D/g, '').slice(0, 11);

    let formatted = digits.slice(0, 4);
    if (digits.length > 4) formatted += '-' + digits.slice(4, 6);
    if (digits.length > 6) formatted += '-' + digits.slice(6, 11);

    return formatted;
}

const studentNumberInput = document.getElementById('studentNumber');

if (studentNumberInput) {
    studentNumberInput.addEventListener('input', () => {
        studentNumberInput.value = formatStudentNumber(studentNumberInput.value);
    });
}


// ==========================================
// STEP 1 → STEP 2
// ==========================================

if (nextBtn) {
    nextBtn.addEventListener('click', () => {
        const fullName = document.getElementById('fullName').value.trim();
        const studentNumber = document.getElementById('studentNumber').value.trim();
        const gender = document.getElementById('genderInput').value.trim();
        const companyName = document.getElementById('companyName').value.trim();
        const supervisorName = document.getElementById('supervisorName').value.trim();
        const section = document.getElementById('sectionInput').value.trim();

        if (!fullName || !studentNumber || !gender || !companyName || !section) {
            showAlert("Pakisagutan muna ang lahat ng kailangan sa Step 1.", 'alertMessageStep1');
            return;
        }

        if (!STUDENT_NUMBER_REGEX.test(studentNumber)) {
            showAlert("Mali ang format ng Student Number. Gamitin ang format na 2023-07-00975.", 'alertMessageStep1');
            return;
        }

        if (!selectedCompany || selectedCompany.toLowerCase() !== companyName.toLowerCase()) {
            showAlert("Pumili ng company mula sa listahan.", 'alertMessageStep1');
            return;
        }

        if (!supervisorName) {
            showAlert("Pumili ng supervisor mula sa listahan.", 'alertMessageStep1');
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

        const dutyStartDate = document.getElementById('dutyStartDate').value;

        if (!dutyStartDate) {
            showAlert("Please select your duty start date.", 'alertMessageStep2');
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

const toggleReauthPassword = document.getElementById('toggleReauthPassword');
const reauthPasswordInput = document.getElementById('reauthPassword');
const reauthGroup = document.getElementById('reauthGroup');

if (toggleReauthPassword && reauthPasswordInput) {
    toggleReauthPassword.addEventListener('click', () => {
        const type = reauthPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        reauthPasswordInput.setAttribute('type', type);

        toggleReauthPassword.classList.toggle('fa-eye');
        toggleReauthPassword.classList.toggle('fa-eye-slash');
    });
}


// ==========================================
// FINAL FORM SUBMISSION (STEP 3 SAVE & REDIRECT)
// ==========================================

const profileForm = document.getElementById('profileForm');

// Ang aktwal na pag-save ng bagong password + profile data. Hiwalay na
// function ito para ma-retry agad pagkatapos mag-reauthenticate, kung
// kailangan, nang hindi na-re-render/nawawala ang mga sagot ng estudyante.
async function saveProfileData(password) {
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

        // DUTY START DATE (format: YYYY-MM-DD)
        startDate: document.getElementById('dutyStartDate').value,

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
        // Oras ng pagkumpleto - ginagamit ng notification bell ng
        // coordinator (../header/header.js) para malaman kung kailan
        // natapos ng estudyante ang profile.
        profileCompletedAt: serverTimestamp(),
        ...(selectedPhotoBase64 ? { photo: selectedPhotoBase64 } : {})
    });

    // Redirect to Dashboard
    window.location.href = "/student-page/student_dashboard/student_dashboard.html";
}

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

        const submitBtn = document.getElementById('saveProfileBtn');

        // Kung nag-request na ng reauthentication dati (nag-appear na ang
        // "Confirm Current Password" field), i-verify muna ang current
        // password bago subukan ulit i-save ang bagong password + profile.
        if (reauthGroup && reauthGroup.style.display !== 'none') {
            const currentPasswordValue = reauthPasswordInput ? reauthPasswordInput.value : "";

            if (!currentPasswordValue) {
                showAlert("Please enter your current password to continue.");
                return;
            }

            try {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = "Verifying...";
                }

                const credential = EmailAuthProvider.credential(currentUser.email, currentPasswordValue);
                await reauthenticateWithCredential(currentUser, credential);

                // Matagumpay na na-verify - itago na ang field at ituloy ang save.
                reauthGroup.style.display = 'none';
                reauthPasswordInput.value = '';
                hideAlert();

                await saveProfileData(password);
            } catch (error) {
                console.error("Reauthentication error:", error);

                if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                    showAlert("Incorrect current password. Please try again.");
                } else {
                    showAlert("Failed to verify your account: " + error.message);
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Continue";
                }
            }

            return;
        }

        // Normal na flow: i-save agad ang password + profile.
        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Saving...";
            }

            await saveProfileData(password);
        } catch (error) {
            console.error("Error updating profile:", error);

            if (error.code === 'auth/requires-recent-login') {
                // Matagal na ang huling login ng user - kailangan muna
                // i-verify ang current password bago payagang baguhin ito.
                showAlert("For your security, please confirm your current password to continue.");
                if (reauthGroup) reauthGroup.style.display = 'block';
                if (reauthPasswordInput) reauthPasswordInput.focus();
            } else {
                showAlert("An error occurred: " + error.message);
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Continue";
            }
        }
    });
}