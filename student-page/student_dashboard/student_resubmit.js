import {
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

/* ==========================================
   RESUBMIT FLOW (nasa loob ng student dashboard)
   Pareho ng profile page: Step 1 (Requirements) -> Step 2 (Internship
   Schedule), PERO walang password at walang Terms. Pinapalitan ang lumang
   3 requirements ng bago, sa parehong format ng profile.js:
     users/{uid}/requirements/{prefix}_{index} -> { key, prefix, index, total, data }
     users/{uid}.requirements -> metadata ng bawat file
   Pagka-submit, documentsStatus = "review" kaya kusang babalik ang
   Approval Gate sa "Waiting for Approval".
========================================== */

// I-adjust kung iba ang lokasyon ng requirementExtractor.js (ginagamit ng profile.js)
const EXTRACTOR_URL = "../profile/requirementExtractor.js";

const REQUIREMENT_LABELS = {
    endorsementLetter: "Endorsement Letter",
    ojtAcceptance: "OJT Acceptance",
    moa: "MOA (Memorandum of Agreement)"
};
const REQUIREMENT_KEYS = Object.keys(REQUIREMENT_LABELS);
const MAX_REQUIREMENT_BYTES = 3 * 1024 * 1024; // 3MB bawat file
const REQUIREMENT_CHUNK_SIZE = 750 * 1024;     // characters bawat chunk

const $ = (id) => document.getElementById(id);

let ctx = null;                 // { db, uid }
let wired = false;
let previousRequirements = {};  // lumang metadata, para mabura ang lumang chunks
let companiesMap = {};          // companyName -> [supervisor names]
let companiesLoaded = false;
let lastExtractedSource = null;
const requirementFiles = {};    // key -> [File, ...] na napili ngayon
REQUIREMENT_KEYS.forEach((key) => { requirementFiles[key] = []; });

/* ---------- alerts ---------- */
function showAlert(message, alertId) {
    const box = $(alertId);
    if (!box) return;
    box.textContent = message;
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert(alertId) {
    const box = $(alertId);
    if (!box) return;
    box.style.display = 'none';
    box.textContent = '';
}

/* ---------- steps ---------- */
function setStep(step) {
    $('stepText').textContent = `Step ${step} of 2`;
    $('progressFill').style.width = `${step * 50}%`;

    if (step === 1) {
        $('stepTitle').textContent = "Resubmit Requirements";
        $('stepSub').textContent = "Attach corrected copies of all 3 documents to submit them again.";
        $('stepIcon').className = "fa-regular fa-file-lines";
    } else {
        $('stepTitle').textContent = "Internship Schedule";
        $('stepSub').textContent = "Review the details we read from your OJT Acceptance.";
        $('stepIcon').className = "fa-regular fa-calendar";
    }
}

function showStep(step) {
    $('step1Content').style.display = step === 1 ? 'block' : 'none';
    $('step2Content').style.display = step === 2 ? 'block' : 'none';
    setStep(step);
    $('resubmitPanel').scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- image / file helpers ---------- */
function compressImageToBase64(file, maxDimension = 400, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error("Could not load the image."));
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
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

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
    if (file.type.startsWith('image/')) return compressImageToBase64(file, 1600, 0.75);
    return readFileAsDataURL(file);
}

function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/* ---------- requirement cards ---------- */
function fileRowHTML(name, size, index) {
    const safeName = String(name).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const sizeText = formatFileSize(size);
    return `
        <li class="requirement-file">
            <i class="fa-regular fa-file"></i>
            <span class="requirement-file-info">
                <span class="requirement-file-name">${safeName}</span>
                <span class="requirement-file-meta">Ready to upload${sizeText ? ' · ' + sizeText : ''}</span>
            </span>
            <button type="button" class="requirement-remove" data-index="${index}" aria-label="Remove ${safeName}"><i class="fa-solid fa-xmark"></i></button>
        </li>`;
}

function refreshRequirementUI(key) {
    const item = document.querySelector(`#resubmitPanel .requirement-item[data-req="${key}"]`);
    if (!item) return;

    const statusEl = item.querySelector('.requirement-status');
    const attachBtn = item.querySelector('.requirement-btn');
    const listEl = item.querySelector('.requirement-files');
    const pending = requirementFiles[key];
    const total = pending.length;

    item.classList.toggle('has-file', total > 0);
    statusEl.textContent = total === 0 ? "No file attached" : `${total} file${total > 1 ? 's' : ''} attached`;
    attachBtn.textContent = total > 0 ? "Add more" : "Attach";
    listEl.innerHTML = pending.map((f, i) => fileRowHTML(f.name, f.size, i)).join('');
    listEl.hidden = total === 0;
}

function refreshAllRequirementUI() {
    REQUIREMENT_KEYS.forEach(refreshRequirementUI);
}

/* ---------- saving (same format as profile.js) ---------- */
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

// Dapat BAGO mag-save ng bago: ang unang file ay gumagamit ulit ng `${key}_${i}`.
async function deletePreviousRequirementFiles(uid) {
    for (const key of REQUIREMENT_KEYS) {
        const files = (previousRequirements[key] && previousRequirements[key].files) || [];
        for (const meta of files) {
            for (let i = 0; i < (meta.chunks || 0); i++) {
                try {
                    await deleteDoc(doc(ctx.db, "users", uid, "requirements", `${meta.prefix || key}_${i}`));
                } catch (err) {
                    console.warn("Could not delete old requirement chunk:", err);
                }
            }
        }
    }
}

async function saveRequirementFiles(uid) {
    const metadata = {};

    for (const key of REQUIREMENT_KEYS) {
        const allFiles = [];

        for (const file of requirementFiles[key]) {
            const dataUrl = await prepareRequirementData(file);
            const total = Math.ceil(dataUrl.length / REQUIREMENT_CHUNK_SIZE);

            const prefix = allFiles.length === 0
                ? key
                : `${key}_f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

            for (let i = 0; i < total; i++) {
                await setDoc(doc(ctx.db, "users", uid, "requirements", `${prefix}_${i}`), {
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

async function runSaveStage(stage, fn) {
    try {
        return await fn();
    } catch (err) {
        try { err.message = `[${stage}] ${err.message}`; } catch (_) { /* read-only */ }
        throw err;
    }
}

/* ---------- company suggestions + name matching ---------- */
function fillDatalist(listEl, values) {
    if (!listEl) return;
    listEl.innerHTML = values
        .map((v) => `<option value="${String(v).replace(/"/g, '&quot;')}"></option>`)
        .join('');
}

function refreshSupervisorOptions() {
    const typed = ($('companyName').value || '').trim().toLowerCase();
    const company = Object.keys(companiesMap).find((n) => n.toLowerCase() === typed);
    const pool = company ? companiesMap[company] : Array.from(new Set(Object.values(companiesMap).flat()));
    fillDatalist($('supervisorOptions'), pool);
}

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
    if (companiesLoaded) return;
    try {
        const snapshot = await getDocs(query(collection(ctx.db, "companies"), orderBy("companyName")));
        companiesMap = {};
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.companyName) return;
            companiesMap[data.companyName] = Array.isArray(data.supervisorNames) ? data.supervisorNames : [];
        });
        fillDatalist($('companyOptions'), Object.keys(companiesMap));
        refreshSupervisorOptions();
        companiesLoaded = true;
    } catch (error) {
        console.error("Error loading companies:", error);
    }
}

/* ---------- morning / afternoon toggles ---------- */
function updateSessionState(prefix) {
    const toggle = $(`${prefix}Enabled`);
    const schedule = $(`${prefix}Schedule`);
    const status = $(`${prefix}Status`);
    const timeIn = $(`${prefix}TimeIn`);
    const timeOut = $(`${prefix}TimeOut`);
    if (!toggle || !schedule) return;

    const enabled = toggle.checked;
    schedule.style.display = enabled ? "block" : "none";
    if (timeIn) timeIn.disabled = !enabled;
    if (timeOut) timeOut.disabled = !enabled;
    if (status) {
        status.textContent = enabled ? "Enabled" : "Disabled";
        status.classList.toggle("disabled", !enabled);
    }
}

function getSelectedInternshipDays() {
    return Array.from(document.querySelectorAll("#resubmitPanel .day-btn.active")).map((b) => b.dataset.day);
}

/* ---------- autofill from OJT Acceptance ---------- */
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

    const companyValue = info.company
        ? (closestMatch(info.company, Object.keys(companiesMap)) || info.company)
        : '';
    (setValue($('companyName'), companyValue) ? filled : missing).push('Company name');
    refreshSupervisorOptions();

    const supervisorPool = companiesMap[companyValue] || [];
    const supervisorValue = info.supervisor
        ? (closestMatch(info.supervisor.replace(/^(mr|ms|mrs|engr|atty|dr)\.?\s+/i, ''), supervisorPool) || info.supervisor)
        : '';
    (setValue($('supervisorName'), supervisorValue) ? filled : missing).push("Supervisor's name");

    (setValue($('jobTitle'), info.jobTitle) ? filled : missing).push('Job title');
    (setValue($('requiredHours'), info.requiredHours) ? filled : missing).push('Required hours');
    (setValue($('dutyStartDate'), info.effectiveDate) ? filled : missing).push('Effective date');

    if (info.days && info.days.length) {
        document.querySelectorAll('#resubmitPanel .day-btn').forEach((btn) => {
            btn.classList.toggle('active', info.days.includes(btn.dataset.day));
        });
        filled.push('Working days');
    } else {
        missing.push('Working days');
    }

    if (info.morning || info.afternoon) {
        $('morningEnabled').checked = !!info.morning;
        $('afternoonEnabled').checked = !!info.afternoon;
        updateSessionState('morning');
        updateSessionState('afternoon');

        if (info.morning) {
            setValue($('morningTimeIn'), info.morning.timeIn);
            setValue($('morningTimeOut'), info.morning.timeOut);
        }
        if (info.afternoon) {
            setValue($('afternoonTimeIn'), info.afternoon.timeIn);
            setValue($('afternoonTimeOut'), info.afternoon.timeOut);
        }
        filled.push('Working hours');
    } else {
        missing.push('Working hours');
    }

    const notice = $('autofillNotice');
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

function setNextLoading(isLoading, message = '') {
    const nextBtn = $('nextBtn');
    const status = $('extractStatus');
    nextBtn.disabled = isLoading;
    nextBtn.classList.toggle('is-loading', isLoading);
    const label = nextBtn.querySelector('.btn-label');
    if (label) label.textContent = isLoading ? 'Reading your requirements…' : 'Next';
    status.hidden = !isLoading;
    status.textContent = message;
}

/* ---------- Step 1 -> Step 2 ---------- */
async function handleNext() {
    const missingDocs = REQUIREMENT_KEYS.filter((key) => requirementFiles[key].length === 0);
    if (missingDocs.length > 0) {
        showAlert(`Please attach: ${missingDocs.map((key) => REQUIREMENT_LABELS[key]).join(", ")}.`, 'alertMessageStep1');
        return;
    }
    hideAlert('alertMessageStep1');

    const sourceKey = requirementFiles.ojtAcceptance
        .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
        .join('|');

    if (sourceKey !== lastExtractedSource) {
        lastExtractedSource = sourceKey;
        setNextLoading(true, 'Loading… this can take a few seconds for scanned files.');
        try {
            // Dynamic import: kung mali ang path, hindi masisira ang dashboard,
            // manual na lang ang pagpuno ng student.
            const { extractFromAcceptanceFile } = await import(EXTRACTOR_URL);

            let info = null;
            let lastError = null;
            for (const file of requirementFiles.ojtAcceptance) {
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
            const notice = $('autofillNotice');
            notice.innerHTML = '<p><strong>We couldn\'t read your OJT Acceptance automatically.</strong> Please review and fill in the details below.</p>';
            notice.classList.add('warn');
            notice.hidden = false;
        } finally {
            setNextLoading(false);
        }
    }

    showStep(2);
}

/* ---------- Step 2 -> Submit ---------- */
function validateStep2() {
    const detailChecks = [
        [$('companyName'), "Please enter your company name."],
        [$('supervisorName'), "Please enter your supervisor's name."],
        [$('jobTitle'), "Please enter your job title."]
    ];
    for (const [el, message] of detailChecks) {
        if (!el.value.trim()) {
            showAlert(message, 'alertMessageStep2');
            el.focus();
            return false;
        }
    }

    const requiredHours = parseInt($('requiredHours').value, 10);
    if (!requiredHours || requiredHours < 1) {
        showAlert("Please enter your required hours to complete.", 'alertMessageStep2');
        $('requiredHours').focus();
        return false;
    }

    if (getSelectedInternshipDays().length === 0) {
        showAlert("Please select at least one internship day.", 'alertMessageStep2');
        return false;
    }

    if (!$('dutyStartDate').value) {
        showAlert("Please select your duty start date.", 'alertMessageStep2');
        return false;
    }

    const morningEnabled = $('morningEnabled').checked;
    const afternoonEnabled = $('afternoonEnabled').checked;

    if (!morningEnabled && !afternoonEnabled) {
        showAlert("Please enable at least one session (Morning or Afternoon).", 'alertMessageStep2');
        return false;
    }
    if (morningEnabled && (!$('morningTimeIn').value || !$('morningTimeOut').value)) {
        showAlert("Please set your morning Time In and Time Out.", 'alertMessageStep2');
        return false;
    }
    if (afternoonEnabled && (!$('afternoonTimeIn').value || !$('afternoonTimeOut').value)) {
        showAlert("Please set your afternoon Time In and Time Out.", 'alertMessageStep2');
        return false;
    }

    hideAlert('alertMessageStep2');
    return true;
}

function buildScheduleData() {
    const morningEnabled = $('morningEnabled').checked;
    const afternoonEnabled = $('afternoonEnabled').checked;

    return {
        modality: document.querySelector('#resubmitPanel input[name="workModality"]:checked')?.value || "On-site",
        days: getSelectedInternshipDays(),
        startDate: $('dutyStartDate').value,
        morningEnabled,
        morning: morningEnabled ? { timeIn: $('morningTimeIn').value, timeOut: $('morningTimeOut').value } : null,
        afternoonEnabled,
        afternoon: afternoonEnabled ? { timeIn: $('afternoonTimeIn').value, timeOut: $('afternoonTimeOut').value } : null
    };
}

async function handleSubmit() {
    if (!validateStep2()) return;

    const btn = $('scheduleNextBtn');
    const backBtn = $('scheduleBackBtn');
    btn.disabled = true;
    backBtn.disabled = true;
    btn.textContent = "Submitting...";

    try {
        const uid = ctx.uid;
        const scheduleData = buildScheduleData();

        await runSaveStage('removing old requirement files', () => deletePreviousRequirementFiles(uid));
        const requirementsMeta = await runSaveStage('saving requirement files', () => saveRequirementFiles(uid));

        await runSaveStage('saving profile', () => updateDoc(doc(ctx.db, "users", uid), {
            companyName: $('companyName').value.trim(),
            supervisorName: $('supervisorName').value.trim(),
            jobTitle: $('jobTitle').value.trim(),
            requiredHours: parseInt($('requiredHours').value, 10) || null,
            schedule: scheduleData,
            requirements: requirementsMeta,
            requirementsSubmittedAt: serverTimestamp(),
            requirementsResubmittedAt: serverTimestamp(),
            // Balik sa "Review Documents" ng coordinator
            documentsStatus: "review",
            documentsReviewNote: ""
        }));

        // Ang onSnapshot ng Approval Gate na ang bahala sa "Waiting for Approval"
        closePanel();
    } catch (error) {
        console.error("Error resubmitting documents:", error);
        showAlert("An error occurred: " + error.message, 'alertMessageStep2');
    } finally {
        btn.disabled = false;
        backBtn.disabled = false;
        btn.textContent = "Submit";
    }
}

/* ---------- View button -> requirement form modal ---------- */
function openRequirementForm(formKey, title) {
    const modal = $('reqFormModal');
    const frame = $('reqFormFrame');
    const params = new URLSearchParams({ form: formKey });

    const typedCompany = $('companyName').value.trim();
    if (typedCompany) params.set('company', typedCompany);

    $('reqFormModalTitle').textContent = title || "Requirement Form";
    $('reqFormModalLoading').hidden = false;
    frame.src = `../requirementform/requirementform.html?${params.toString()}`;

    modal.hidden = false;
    document.body.classList.add('req-modal-open');
    $('reqFormModalClose').focus();
}

function closeRequirementForm() {
    const modal = $('reqFormModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    $('reqFormFrame').src = 'about:blank';
    document.body.classList.remove('req-modal-open');
}

/* ---------- one-time event wiring ---------- */
function wire() {
    REQUIREMENT_KEYS.forEach((key) => {
        const input = $(`req_${key}`);
        const item = document.querySelector(`#resubmitPanel .requirement-item[data-req="${key}"]`);
        if (!input || !item) return;

        input.addEventListener('change', () => {
            const picked = Array.from(input.files || []);
            input.value = "";
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

            if (problems.length) showAlert(`${REQUIREMENT_LABELS[key]} — ${problems.join(' ')}`, 'alertMessageStep1');
            else hideAlert('alertMessageStep1');
            if (added) refreshRequirementUI(key);
        });

        item.querySelector('.requirement-files').addEventListener('click', (e) => {
            const btn = e.target.closest('.requirement-remove');
            if (!btn) return;
            requirementFiles[key].splice(Number(btn.dataset.index), 1);
            refreshRequirementUI(key);
        });
    });

    document.querySelectorAll('#resubmitPanel .requirement-view').forEach((btn) => {
        btn.addEventListener('click', () => openRequirementForm(btn.dataset.form, btn.dataset.title));
    });
    $('reqFormModalClose').addEventListener('click', closeRequirementForm);
    $('reqFormModal').addEventListener('click', (e) => {
        if (e.target === $('reqFormModal')) closeRequirementForm();
    });
    $('reqFormFrame').addEventListener('load', () => {
        const src = $('reqFormFrame').src;
        if (src && !src.startsWith('about:')) $('reqFormModalLoading').hidden = true;
    });
    window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data && e.data.type === 'closeRequirementFormModal') closeRequirementForm();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeRequirementForm();
    });

    document.querySelectorAll('#resubmitPanel .day-btn').forEach((button) => {
        button.addEventListener('click', () => button.classList.toggle('active'));
    });
    $('morningEnabled').addEventListener('change', () => updateSessionState('morning'));
    $('afternoonEnabled').addEventListener('change', () => updateSessionState('afternoon'));
    $('companyName').addEventListener('input', refreshSupervisorOptions);

    $('nextBtn').addEventListener('click', handleNext);
    $('scheduleBackBtn').addEventListener('click', () => {
        hideAlert('alertMessageStep2');
        showStep(1);
    });
    $('scheduleNextBtn').addEventListener('click', handleSubmit);
    $('rsCloseBtn').addEventListener('click', closePanel);
}

/* ---------- open / close ---------- */
function closePanel() {
    closeRequirementForm();
    $('resubmitPanel').hidden = true;
    document.body.style.overflow = '';
}

function resetFlow(note) {
    REQUIREMENT_KEYS.forEach((key) => { requirementFiles[key] = []; });
    refreshAllRequirementUI();
    lastExtractedSource = null;

    ['alertMessageStep1', 'alertMessageStep2'].forEach(hideAlert);
    const autofill = $('autofillNotice');
    autofill.hidden = true;
    autofill.replaceChildren();

    document.querySelectorAll('#resubmitPanel .autofilled').forEach((el) => el.classList.remove('autofilled'));

    // Dahilan ng coordinator sa taas ng Step 1
    const notice = $('resubmitNotice');
    notice.replaceChildren();
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-triangle-exclamation';
    const body = document.createElement('div');
    body.className = 'autofill-body';
    const title = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = "Your coordinator returned your documents.";
    title.appendChild(strong);
    body.appendChild(title);
    const items = String(note || '').split(';').map((s) => s.trim()).filter(Boolean);
    if (items.length) {
        const list = document.createElement('ul');
        items.forEach((text) => {
            const li = document.createElement('li');
            const idx = text.indexOf(':');
            if (idx > 0) {
                const label = document.createElement('strong');
                label.textContent = text.slice(0, idx).trim();
                const reason = document.createElement('span');
                reason.textContent = text.slice(idx + 1).trim();
                li.append(label, reason);
            } else {
                li.textContent = text;
            }
            list.appendChild(li);
        });
        body.appendChild(list);
    }
    notice.append(icon, body);
    notice.hidden = false;

    const submitBtn = $('scheduleNextBtn');
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
    $('scheduleBackBtn').disabled = false;
    setNextLoading(false);

    updateSessionState('morning');
    updateSessionState('afternoon');
    showStep(1);
}

// I-prefill ang dating detalye at schedule ni student (napapalitan ng bagong
// nabasa sa OJT Acceptance pagka-Next).
async function loadPreviousData() {
    try {
        const snap = await getDoc(doc(ctx.db, "users", ctx.uid));
        if (!snap.exists()) return;
        const data = snap.data();

        previousRequirements = normalizeRequirements(data.requirements || {});

        [['companyName', data.companyName], ['supervisorName', data.supervisorName],
         ['jobTitle', data.jobTitle], ['requiredHours', data.requiredHours]]
            .forEach(([id, value]) => {
                const el = $(id);
                if (el && value && !el.value) el.value = value;
            });

        const s = data.schedule;
        if (s && typeof s === 'object') {
            if (s.startDate && !$('dutyStartDate').value) $('dutyStartDate').value = s.startDate;
            if (Array.isArray(s.days)) {
                document.querySelectorAll('#resubmitPanel .day-btn').forEach((btn) => {
                    btn.classList.toggle('active', s.days.includes(btn.dataset.day));
                });
            }
            const modality = [...document.querySelectorAll('#resubmitPanel input[name="workModality"]')]
                .find((r) => r.value === s.modality);
            if (modality) modality.checked = true;

            $('morningEnabled').checked = s.morningEnabled !== false && !!s.morning;
            $('afternoonEnabled').checked = s.afternoonEnabled !== false && !!s.afternoon;
            if (s.morning) {
                $('morningTimeIn').value = s.morning.timeIn || "08:00";
                $('morningTimeOut').value = s.morning.timeOut || "12:00";
            }
            if (s.afternoon) {
                $('afternoonTimeIn').value = s.afternoon.timeIn || "13:00";
                $('afternoonTimeOut').value = s.afternoon.timeOut || "17:00";
            }
            updateSessionState('morning');
            updateSessionState('afternoon');
        }
    } catch (error) {
        console.error("Could not load previous submission data:", error);
    }
}

// Tinatawag ng "Resubmit documents" button sa Approval Gate.
export function openResubmit({ db, uid, note }) {
    ctx = { db, uid };
    if (!wired) {
        wire();
        wired = true;
    }
    resetFlow(note);

    $('resubmitPanel').hidden = false;
    document.body.style.overflow = 'hidden';

    loadPreviousData();
    loadCompanies();
}