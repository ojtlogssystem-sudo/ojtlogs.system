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
    setDoc,
    deleteDoc,
    updateDoc,
    serverTimestamp,
    collection,
    getDocs,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { extractFromAcceptanceFile } from "./requirementExtractor.js";

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

// True kapag nabasa na ang user doc (para hindi itago ang fields bago pa dumating ang data)

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

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Auth State Check
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            existingRequirements = normalizeRequirements(data.requirements || {});
            refreshAllRequirementUI();
            // Kung may naka-save nang detalye (bumalik si student), i-prefill
            [['companyName', data.companyName], ['supervisorName', data.supervisorName],
             ['jobTitle', data.jobTitle], ['requiredHours', data.requiredHours]]
                .forEach(([id, value]) => {
                    const el = document.getElementById(id);
                    if (el && value && !el.value) el.value = value;
                });
        }
    } else {
        window.location.href = "/student-page/student_login/student_login.html";
    }
});

// I-resize/compress ang image papuntang JPEG bago i-convert sa base64.
// Ginagamit ng requirements upload (mga image na attachment).
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

// ==========================================
// INTERNSHIP DETAILS (company, supervisor, job title, required hours)
// Awtomatikong napupunan mula sa OJT Acceptance ni student pagka-click ng
// Next (tingnan ang requirementExtractor.js). Puwede pa ring i-edit.
// Ang listahan ng "companies" ng coordinator ay ginagamit na lang bilang
// suggestions (datalist) at para i-match ang pangalan ng company kung kamukha.
// ==========================================

// companyName -> array ng supervisor names para sa company na yun
let companiesMap = {};

const companyNameInput = document.getElementById('companyName');
const supervisorNameInput = document.getElementById('supervisorName');
const jobTitleInput = document.getElementById('jobTitle');
const requiredHoursInput = document.getElementById('requiredHours');
const companyOptions = document.getElementById('companyOptions');
const supervisorOptions = document.getElementById('supervisorOptions');

function fillDatalist(listEl, values) {
    if (!listEl) return;
    listEl.innerHTML = values
        .map((v) => `<option value="${String(v).replace(/"/g, '&quot;')}"></option>`)
        .join('');
}

function refreshSupervisorOptions() {
    const company = Object.keys(companiesMap).find(
        (n) => n.toLowerCase() === (companyNameInput?.value || '').trim().toLowerCase()
    );
    const pool = company
        ? companiesMap[company]
        : Array.from(new Set(Object.values(companiesMap).flat()));
    fillDatalist(supervisorOptions, pool);
}

if (companyNameInput) companyNameInput.addEventListener('input', refreshSupervisorOptions);

// Pangalan na pinakamalapit sa nakuha natin (hal. "Acme Software Solutions"
// vs "ACME SOFTWARE SOLUTIONS INC.") - kung sapat ang tugma, gamitin ang
// eksaktong pangalan na nasa system ng coordinator.
function normalizeName(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t && !['inc', 'corp', 'corporation', 'co', 'ltd', 'company', 'the', 'and', 'of'].includes(t));
}

function closestMatch(value, candidates) {
    const target = normalizeName(value);
    if (!target.length) return null;

    let best = null;
    let bestScore = 0;
    candidates.forEach((candidate) => {
        const tokens = normalizeName(candidate);
        if (!tokens.length) return;
        const overlap = target.filter((t) => tokens.includes(t)).length;
        const score = overlap / Math.max(target.length, tokens.length);
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    });
    return bestScore >= 0.75 ? best : null;
}

async function loadCompanies() {
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

        fillDatalist(companyOptions, Object.keys(companiesMap));
        refreshSupervisorOptions();
    } catch (error) {
        console.error("Error loading companies:", error);
    }
}

loadCompanies();

// ==========================================
// REQUIREMENT DOCUMENTS (Endorsement Letter, OJT Acceptance, MOA)
// Naka-save sa Firestore bilang base64, hinahati sa chunks para hindi
// lumagpas sa 1MB document limit:
//   users/{uid}/requirements/{key}_{index}  -> { key, index, total, data }
// Metadata ng bawat file ay nasa users/{uid}.requirements
// ==========================================
const REQUIREMENT_LABELS = {
    endorsementLetter: "Endorsement Letter",
    ojtAcceptance: "OJT Acceptance",
    moa: "MOA (Memorandum of Agreement)"
};
const REQUIREMENT_KEYS = Object.keys(REQUIREMENT_LABELS);
const MAX_REQUIREMENT_BYTES = 3 * 1024 * 1024; // 3MB bawat file
const REQUIREMENT_CHUNK_SIZE = 750 * 1024;     // characters bawat chunk

// Kahit ilang file bawat requirement:
const requirementFiles = {};      // key -> [File, ...] na napili ngayon (hindi pa naka-save)
let existingRequirements = {};    // key -> { ...legacy fields, files: [meta, ...] } na naka-save na

REQUIREMENT_KEYS.forEach((key) => { requirementFiles[key] = []; });

// Metadata ng naka-save na files. Ang lumang format (isang file lang) ay
// ginagawang listahan; ang unang file ay laging nasa chunks na `${key}_${i}`
// (prefix = key) para gumana pa rin ang lumang pagbasa ng coordinator.
function normalizeRequirements(raw) {
    const result = {};
    REQUIREMENT_KEYS.forEach((key) => {
        const meta = raw[key];
        if (!meta) return;
        const files = Array.isArray(meta.files) && meta.files.length
            ? meta.files
            : [{
                fileName: meta.fileName,
                fileType: meta.fileType,
                fileSize: meta.fileSize,
                chunks: meta.chunks,
                uploadedAt: meta.uploadedAt,
                prefix: key
            }];
        result[key] = { ...meta, files };
    });
    return result;
}

function savedFilesOf(key) {
    return (existingRequirements[key] && existingRequirements[key].files) || [];
}

function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function hasRequirement(key) {
    return requirementFiles[key].length > 0 || savedFilesOf(key).length > 0;
}

function fileRowHTML(name, size, removable, index) {
    const safeName = String(name).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const sizeText = formatFileSize(size);
    return `
        <li class="requirement-file">
            <i class="fa-regular fa-file"></i>
            <span class="requirement-file-info">
                <span class="requirement-file-name">${safeName}</span>
                <span class="requirement-file-meta">${removable ? 'Ready to upload' : 'Uploaded'}${sizeText ? ' · ' + sizeText : ''}</span>
            </span>
            ${removable ? `<button type="button" class="requirement-remove" data-index="${index}" aria-label="Remove ${safeName}"><i class="fa-solid fa-xmark"></i></button>` : ''}
        </li>`;
}

function refreshRequirementUI(key) {
    const item = document.querySelector(`.requirement-item[data-req="${key}"]`);
    if (!item) return;

    const statusEl = item.querySelector('.requirement-status');
    const attachBtn = item.querySelector('.requirement-btn');
    const listEl = item.querySelector('.requirement-files');
    const pending = requirementFiles[key];
    const saved = savedFilesOf(key);
    const total = pending.length + saved.length;

    item.classList.toggle('has-file', total > 0);

    statusEl.textContent = total === 0
        ? "No file attached"
        : `${total} file${total > 1 ? 's' : ''} attached`;

    attachBtn.textContent = total > 0 ? "Add more" : "Attach";

    listEl.innerHTML =
        saved.map((f) => fileRowHTML(f.fileName || "file", f.fileSize, false)).join('') +
        pending.map((f, i) => fileRowHTML(f.name, f.size, true, i)).join('');
    listEl.hidden = total === 0;
}

function refreshAllRequirementUI() {
    REQUIREMENT_KEYS.forEach(refreshRequirementUI);
}

REQUIREMENT_KEYS.forEach((key) => {
    const input = document.getElementById(`req_${key}`);
    const item = document.querySelector(`.requirement-item[data-req="${key}"]`);
    if (!input || !item) return;

    input.addEventListener('change', () => {
        const picked = Array.from(input.files || []);
        input.value = ""; // para puwedeng piliin ulit ang parehong file
        if (!picked.length) return;

        const problems = [];
        let added = 0;

        picked.forEach((file) => {
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
            const isImage = file.type.startsWith('image/');

            if (!isPdf && !isImage) {
                problems.push(`${file.name}: PDF, JPG or PNG only.`);
                return;
            }
            if (file.size > MAX_REQUIREMENT_BYTES) {
                problems.push(`${file.name} is too large (max 3MB per file).`);
                return;
            }
            const duplicate = requirementFiles[key].some(
                (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
            );
            if (duplicate) return;

            requirementFiles[key].push(file);
            added++;
        });

        if (problems.length) {
            showAlert(`${REQUIREMENT_LABELS[key]} — ${problems.join(' ')}`, 'alertMessageStep1');
        } else {
            hideAlert('alertMessageStep1');
        }
        if (added) refreshRequirementUI(key);
    });

    // Remove button ng bawat file (event delegation dahil nire-render ang listahan)
    item.querySelector('.requirement-files').addEventListener('click', (e) => {
        const btn = e.target.closest('.requirement-remove');
        if (!btn) return;
        requirementFiles[key].splice(Number(btn.dataset.index), 1);
        refreshRequirementUI(key);
    });
});

// ==========================================
// VIEW BUTTON - nagbubukas ng container (modal) na may reference form
// na kailangang ipasa ni student. Nasa student-page/requirementform/ ang form.
// ==========================================
const reqFormModal = document.getElementById('reqFormModal');
const reqFormFrame = document.getElementById('reqFormFrame');
const reqFormTitle = document.getElementById('reqFormModalTitle');
const reqFormLoading = document.getElementById('reqFormModalLoading');
const reqFormClose = document.getElementById('reqFormModalClose');

function openRequirementForm(formKey, title) {
    if (!reqFormModal || !reqFormFrame) return;

    const params = new URLSearchParams({ form: formKey });

    // Gamitin ang company na kasalukuyang tinype/pinili ni student (kung meron na)
    const typedCompany = companyNameInput ? companyNameInput.value.trim() : "";
    if (typedCompany) params.set('company', typedCompany);

    reqFormTitle.textContent = title || "Requirement Form";
    reqFormLoading.hidden = false;
    reqFormFrame.src = `../requirementform/requirementform.html?${params.toString()}`;

    reqFormModal.hidden = false;
    document.body.classList.add('req-modal-open');
    reqFormClose.focus();
}

function closeRequirementForm() {
    if (!reqFormModal || reqFormModal.hidden) return;
    reqFormModal.hidden = true;
    reqFormFrame.src = 'about:blank';
    document.body.classList.remove('req-modal-open');
}

if (reqFormFrame) {
    reqFormFrame.addEventListener('load', () => {
        if (reqFormFrame.src && !reqFormFrame.src.startsWith('about:')) reqFormLoading.hidden = true;
    });
}

document.querySelectorAll('.requirement-view').forEach((btn) => {
    btn.addEventListener('click', () => openRequirementForm(btn.dataset.form, btn.dataset.title));
});

if (reqFormClose) reqFormClose.addEventListener('click', closeRequirementForm);

// Click sa madilim na bahagi sa labas = isara
if (reqFormModal) {
    reqFormModal.addEventListener('click', (e) => {
        if (e.target === reqFormModal) closeRequirementForm();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRequirementForm();
});

// Back button sa loob ng form -> isasara ang container
window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data && e.data.type === 'closeRequirementFormModal') closeRequirementForm();
});

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read " + file.name));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
    });
}

// Larawan: i-compress muna. PDF: kunin as-is.
async function prepareRequirementData(file) {
    if (file.type.startsWith('image/')) {
        return compressImageToBase64(file, 1600, 0.75);
    }
    return readFileAsDataURL(file);
}

// I-save ang mga napiling file; ibabalik ang metadata para sa user doc.
async function saveRequirementFiles(uid) {
    const metadata = {};

    for (const key of REQUIREMENT_KEYS) {
        const newFiles = requirementFiles[key];
        const savedFiles = savedFilesOf(key);
        const allFiles = [...savedFiles];

        for (const file of newFiles) {
            const dataUrl = await prepareRequirementData(file);
            const total = Math.ceil(dataUrl.length / REQUIREMENT_CHUNK_SIZE);

            // Ang pinakaunang file ng requirement ay gumagamit ng lumang
            // pangalan (`${key}_${i}`); ang iba ay may sariling unique prefix.
            const prefix = allFiles.length === 0
                ? key
                : `${key}_f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

            for (let i = 0; i < total; i++) {
                await setDoc(doc(db, "users", uid, "requirements", `${prefix}_${i}`), {
                    key,
                    prefix,
                    index: i,
                    total,
                    data: dataUrl.slice(i * REQUIREMENT_CHUNK_SIZE, (i + 1) * REQUIREMENT_CHUNK_SIZE)
                });
            }

            const mimeMatch = dataUrl.match(/^data:([^;,]+)/);
            allFiles.push({
                fileName: file.name,
                fileType: mimeMatch ? mimeMatch[1] : file.type,
                fileSize: file.size,
                chunks: total,
                uploadedAt: new Date().toISOString(),
                prefix
            });
        }

        if (!allFiles.length) continue;

        // Top-level fields = unang file (compatible sa lumang format),
        // `files` = buong listahan.
        const first = allFiles[0];
        metadata[key] = {
            fileName: first.fileName,
            fileType: first.fileType,
            fileSize: first.fileSize,
            chunks: first.chunks,
            uploadedAt: first.uploadedAt,
            fileCount: allFiles.length,
            files: allFiles
        };
    }

    return metadata;
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

// ----- Kunin ang file ng OJT Acceptance (bagong pili, o yung naka-save na) -----
// Ibinabalik ang lahat ng file ng OJT Acceptance (bago + naka-save na), ayon
// sa pagkakasunod. Subukan ang bawat isa hanggang may mabasa.
async function getAcceptanceFiles() {
    const files = [...requirementFiles.ojtAcceptance];
    if (files.length) return files;

    // Walang bagong pinili - gamitin ang mga naka-save na
    if (!currentUser) return files;
    for (const meta of savedFilesOf('ojtAcceptance')) {
        const parts = [];
        let complete = true;
        for (let i = 0; i < (meta.chunks || 0); i++) {
            const snap = await getDoc(doc(db, "users", currentUser.uid, "requirements", `${meta.prefix || 'ojtAcceptance'}_${i}`));
            if (!snap.exists()) { complete = false; break; }
            parts.push(snap.data().data);
        }
        if (!complete || !parts.length) continue;
        const blob = await (await fetch(parts.join(''))).blob();
        files.push(new File([blob], meta.fileName || "ojt-acceptance", { type: meta.fileType || blob.type }));
    }
    return files;
}

// Para hindi mabura ang mga na-edit ni student kapag bumalik at nag-Next ulit
let lastExtractedSource = null;

function setNextLoading(isLoading, message = '') {
    const status = document.getElementById('extractStatus');
    if (nextBtn) {
        nextBtn.disabled = isLoading;
        nextBtn.classList.toggle('is-loading', isLoading);
        const label = nextBtn.querySelector('.btn-label');
        if (label) label.textContent = isLoading ? 'Reading your requirements…' : 'Next';
    }
    if (status) {
        status.hidden = !isLoading;
        status.textContent = message;
    }
}

// Lagyan ng highlight ang mga field na kusang napunan
function markAutofilled(el) {
    if (!el) return;
    el.classList.add('autofilled');
    el.addEventListener('input', () => el.classList.remove('autofilled'), { once: true });
}

function setValue(el, value) {
    if (!el || value === null || value === undefined || value === '') return false;
    el.value = value;
    markAutofilled(el);
    return true;
}

function applyExtractedDetails(info) {
    const missing = [];
    const filled = [];

    // Company - i-snap sa pangalang nasa listahan ng coordinator kung kamukha
    const companyValue = info.company
        ? (closestMatch(info.company, Object.keys(companiesMap)) || info.company)
        : '';
    (setValue(companyNameInput, companyValue) ? filled : missing).push('Company name');
    refreshSupervisorOptions();

    const supervisorPool = companiesMap[companyValue] || [];
    const supervisorValue = info.supervisor
        ? (closestMatch(info.supervisor.replace(/^(mr|ms|mrs|engr|atty|dr)\.?\s+/i, ''), supervisorPool) || info.supervisor)
        : '';
    (setValue(supervisorNameInput, supervisorValue) ? filled : missing).push("Supervisor's name");

    (setValue(jobTitleInput, info.jobTitle) ? filled : missing).push('Job title');
    (setValue(requiredHoursInput, info.requiredHours) ? filled : missing).push('Required hours');
    (setValue(document.getElementById('dutyStartDate'), info.effectiveDate) ? filled : missing).push('Effective date');

    // Araw
    if (info.days && info.days.length) {
        document.querySelectorAll('.day-btn').forEach((btn) => {
            btn.classList.toggle('active', info.days.includes(btn.dataset.day));
        });
        filled.push('Working days');
    } else {
        missing.push('Working days');
    }

    // Oras
    if (info.morning || info.afternoon) {
        const mToggle = document.getElementById('morningEnabled');
        const aToggle = document.getElementById('afternoonEnabled');
        mToggle.checked = !!info.morning;
        aToggle.checked = !!info.afternoon;
        updateMorningState();
        updateAfternoonState();

        if (info.morning) {
            setValue(document.getElementById('morningTimeIn'), info.morning.timeIn);
            setValue(document.getElementById('morningTimeOut'), info.morning.timeOut);
        }
        if (info.afternoon) {
            setValue(document.getElementById('afternoonTimeIn'), info.afternoon.timeIn);
            setValue(document.getElementById('afternoonTimeOut'), info.afternoon.timeOut);
        }
        filled.push('Working hours');
    } else {
        missing.push('Working hours');
    }

    // Abiso sa taas ng Step 2
    const notice = document.getElementById('autofillNotice');
    if (notice) {
        const parts = [];
        if (filled.length) {
            parts.push(`<strong>Filled in from your OJT Acceptance:</strong> ${filled.join(', ')}. Please review and correct anything that looks wrong.`);
        }
        if (info.lunchAssumed) {
            parts.push('Your form shows one continuous time range, so we assumed a 12:00–1:00 PM lunch break. Adjust the morning/afternoon times if needed.');
        }
        if (missing.length) {
            parts.push(`<strong>Couldn't read:</strong> ${missing.join(', ')}. Please fill these in manually.`);
        }
        const iconClass = missing.length ? 'fa-triangle-exclamation' : 'fa-wand-magic-sparkles';
        notice.innerHTML = `<i class="fa-solid ${iconClass}"></i><div class="autofill-body">${parts.map((p) => `<p>${p}</p>`).join('')}</div>`;
        notice.classList.toggle('warn', missing.length > 0);
        notice.hidden = false;
    }
}

function showStep2() {
    step1Content.style.display = "none";
    step2Content.style.display = "block";

    stepText.textContent = "Step 2 of 3";
    progressFill.style.width = "66.66%";
    stepTitle.textContent = "Internship Schedule";
    stepSub.textContent = "Review the details we read from your OJT Acceptance.";
    stepIcon.className = "fa-regular fa-calendar";
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
        // 1. Kailangan ang 3 requirement documents
        const missingDocs = REQUIREMENT_KEYS.filter((key) => !hasRequirement(key));
        if (missingDocs.length > 0) {
            showAlert(
                `Please attach: ${missingDocs.map((key) => REQUIREMENT_LABELS[key]).join(", ")}.`,
                'alertMessageStep1'
            );
            return;
        }

        hideAlert('alertMessageStep1');

        // 2. Basahin ang OJT Acceptance at i-prefill ang mga input
        //    (kung nabasa na dati at walang binago sa file, huwag nang ulitin)
        const sourceKey = requirementFiles.ojtAcceptance.length
            ? requirementFiles.ojtAcceptance.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|')
            : 'saved-file:' + savedFilesOf('ojtAcceptance').length;

        if (sourceKey !== lastExtractedSource) {
            lastExtractedSource = sourceKey;
            setNextLoading(true, 'Loading… this can take a few seconds for scanned files.');
            try {
                const files = await getAcceptanceFiles();
                if (!files.length) throw new Error('No OJT Acceptance file found.');

                // Subukan ang bawat file hanggang may matagumpay na mabasa
                let info = null;
                let lastError = null;
                for (const file of files) {
                    try {
                        info = await extractFromAcceptanceFile(file, (msg) => setNextLoading(true, msg));
                        if (info) break;
                    } catch (err) {
                        lastError = err;
                    }
                }
                if (!info) throw lastError || new Error('Could not read any OJT Acceptance file.');
                applyExtractedDetails(info);
            } catch (error) {
                console.error('Could not read OJT Acceptance:', error);
                const notice = document.getElementById('autofillNotice');
                if (notice) {
                    notice.innerHTML = '<p><strong>We couldn\'t read your OJT Acceptance automatically.</strong> Please fill in the details below manually.</p>';
                    notice.classList.add('warn');
                    notice.hidden = false;
                }
            } finally {
                setNextLoading(false);
            }
        }

        showStep2();
    });
}


// ==========================================
// STEP 2 → STEP 3
// ==========================================

if (scheduleNextBtn) {
    scheduleNextBtn.addEventListener('click', () => {
        const detailChecks = [
            [companyNameInput, "Please enter your company name."],
            [supervisorNameInput, "Please enter your supervisor's name."],
            [jobTitleInput, "Please enter your job title."]
        ];
        for (const [el, message] of detailChecks) {
            if (!el || !el.value.trim()) {
                showAlert(message, 'alertMessageStep2');
                if (el) el.focus();
                return;
            }
        }

        const requiredHours = parseInt(requiredHoursInput?.value, 10);
        if (!requiredHours || requiredHours < 1) {
            showAlert("Please enter your required hours to complete.", 'alertMessageStep2');
            if (requiredHoursInput) requiredHoursInput.focus();
            return;
        }

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
        stepTitle.textContent = "Upload Requirements";
        stepSub.textContent = "Attach your required documents to continue your account setup.";
        stepIcon.className = "fa-regular fa-file-lines";
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
// TERMS & CONDITIONS / PRIVACY POLICY GATE
// Lalabas pagka-click ng "Continue" sa Step 3, bago mai-save ang profile
// at makapasok sa student dashboard. Kailangang i-scroll hanggang baba
// ang terms bago ma-enable ang checkbox, at kailangang naka-check ito
// bago ma-enable ang "I Agree".
// ==========================================

const termsModal = document.getElementById('termsModal');
const termsBody = document.getElementById('termsBody');
const termsCheckbox = document.getElementById('termsCheckbox');
const termsCheckLabel = document.getElementById('termsCheckLabel');
const termsAgreeBtn = document.getElementById('termsAgreeBtn');
const termsCancelBtn = document.getElementById('termsCancelBtn');

// Kapag nag-agree na sa session na ito (hal. nag-reauthenticate pa
// pagkatapos), hindi na ipapakita ulit.
let termsAgreed = false;

// Nagre-resolve ng true kapag nag-"I Agree", false kapag nag-Cancel.
function requireTermsAgreement() {
    if (termsAgreed) return Promise.resolve(true);

    if (!termsModal || !termsBody || !termsCheckbox || !termsAgreeBtn || !termsCancelBtn) {
        console.error("Terms modal markup is missing in profile.html.");
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        let reachedBottom = false;

        // Reset sa bawat bukas ng modal
        termsBody.scrollTop = 0;
        termsCheckbox.checked = false;
        termsCheckbox.disabled = true;
        termsCheckLabel.classList.add('disabled');
        termsAgreeBtn.disabled = true;

        function checkScroll() {
            if (reachedBottom) return;
            // 8px na tolerance para sa rounding ng browser
            const atBottom = termsBody.scrollTop + termsBody.clientHeight >= termsBody.scrollHeight - 8;
            if (!atBottom) return;

            reachedBottom = true;
            termsCheckbox.disabled = false;
            termsCheckLabel.classList.remove('disabled');
        }

        function finish(result) {
            termsBody.onscroll = null;
            termsCheckbox.onchange = null;
            termsAgreeBtn.onclick = null;
            termsCancelBtn.onclick = null;
            window.removeEventListener('resize', checkScroll);
            termsModal.classList.remove('active');
            document.body.style.overflow = '';
            resolve(result);
        }

        termsBody.onscroll = checkScroll;
        window.addEventListener('resize', checkScroll);

        termsCheckbox.onchange = () => {
            termsAgreeBtn.disabled = !termsCheckbox.checked;
        };

        termsAgreeBtn.onclick = () => {
            if (!termsCheckbox.checked) return;
            termsAgreed = true;
            finish(true);
        };

        termsCancelBtn.onclick = () => finish(false);

        document.body.style.overflow = 'hidden';
        termsModal.classList.add('active');

        // Pagkatapos lumabas ng modal, i-check kung sapat na ang laki ng
        // screen kaya hindi na kailangang mag-scroll.
        requestAnimationFrame(checkScroll);
    });
}


// ==========================================
// FINAL FORM SUBMISSION (STEP 3 SAVE & REDIRECT)
// ==========================================

const profileForm = document.getElementById('profileForm');

// Nilalagyan ng pangalan ng hakbang ang error (hal. "[saving requirement files] ...")
// para malaman agad kung saan pumalya ang pag-save.
async function runSaveStage(stage, fn) {
    try {
        return await fn();
    } catch (err) {
        try { err.message = `[${stage}] ${err.message}`; } catch (_) { /* read-only */ }
        throw err;
    }
}

// Ang aktwal na pag-save ng bagong password + profile data. Hiwalay na
// function ito para ma-retry agad pagkatapos mag-reauthenticate, kung
// kailangan, nang hindi na-re-render/nawawala ang mga sagot ng estudyante.
async function saveProfileData(password) {
    const companyName = document.getElementById('companyName').value.trim();
    const supervisorName = document.getElementById('supervisorName').value.trim();
    const jobTitle = document.getElementById('jobTitle').value.trim();
    const requiredHours = parseInt(document.getElementById('requiredHours').value, 10) || null;

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
    await runSaveStage('updating password', () => updatePassword(currentUser, password));

    // I-save ang 3 requirement documents (Endorsement Letter, OJT Acceptance, MOA)
    const requirementsMeta = await runSaveStage('saving requirement files', () => saveRequirementFiles(currentUser.uid));

    // Update Firestore Profile Data
    const userDocRef = doc(db, "users", currentUser.uid);
    await runSaveStage('saving profile', () => updateDoc(userDocRef, {
        companyName: companyName,
        supervisorName: supervisorName,
        jobTitle: jobTitle,
        requiredHours: requiredHours,
        schedule: scheduleData,
        requirements: requirementsMeta,
        requirementsSubmittedAt: serverTimestamp(),
        profileCompleted: true,
        // Pagka-submit ng student, "Review Documents" na ang status niya sa
        // coordinator hanggang ma-approve (o ma-return) ang mga documents.
        documentsStatus: "review",
        documentsReviewNote: "",
        // Record ng pagsang-ayon sa Terms & Conditions / Privacy Policy
        termsAccepted: true,
        termsAcceptedAt: serverTimestamp(),
        // Oras ng pagkumpleto - ginagamit ng notification bell ng
        // coordinator (../header/header.js) para malaman kung kailan
        // natapos ng estudyante ang profile.
        profileCompletedAt: serverTimestamp()
    }));

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

        // Terms & Conditions / Privacy Policy - kailangan munang mag-agree
        // bago mai-save ang profile at makapasok sa dashboard.
        const agreedToTerms = await requireTermsAgreement();
        if (!agreedToTerms) {
            showAlert("You need to agree to the Terms & Conditions and Privacy Policy to continue.");
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