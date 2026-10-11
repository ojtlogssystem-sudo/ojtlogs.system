import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc,
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    serverTimestamp,
    query,
    where,
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};

// Reuse the app kung na-initialize na ng shared ../header/header.js
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

if (window.emailjs) {
    emailjs.init("9tYTBTAGQWPgHHTSW"); 
}

// ==========================================================
// STUDENT COUNT HELPERS
// Kapareho ng rules sa dashboard.js (loadDashboardStats) para
// pare-pareho ang bilang ng student sa buong system.
// ==========================================================
const ARCHIVE_COURSE_YEARS = 4;
const ARCHIVE_AY_END_MONTH = 6;
const ARCHIVE_AY_END_DAY = 30;

function getBatchLabel(data) {
    const num = String(data.studentNumber || data.studentId || data.idNumber || "").trim();
    let startYear = null;
    const full = num.match(/^((?:19|20)\d{2})/);
    if (full) {
        startYear = parseInt(full[1], 10);
    } else {
        const short = num.match(/^(\d{2})\D/);
        if (short) startYear = 2000 + parseInt(short[1], 10);
    }
    if (startYear) {
        const start = startYear + ARCHIVE_COURSE_YEARS - 1;
        return `AY ${start}-${start + 1}`;
    }
    return data.batch || "Unassigned Batch";
}

function hasBatchEnded(batchName, now = new Date()) {
    const m = String(batchName || "").match(/(\d{4})\s*[-\u2013\u2014]\s*(\d{4})/);
    if (!m) return false;
    const end = new Date(Number(m[2]), ARCHIVE_AY_END_MONTH - 1, ARCHIVE_AY_END_DAY, 23, 59, 59);
    return now > end;
}

function normalizeName(value) {
    return String(value || "").trim().toLowerCase();
}

// Company ng student: companyName muna, tapos company (ginagamit ng dashboard)
function getStudentCompany(data) {
    const pick = (v) => {
        const c = String(v || "").trim();
        return (c === "" || c.toLowerCase() === "n/a" || c === "-") ? "" : c;
    };
    return pick(data.companyName) || pick(data.company);
}

function isCompletedStudent(data) {
    return normalizeName(data.status) === "completed" ||
           String(data.internshipStatus || "") === "Completed";
}

// true = registered at current student (kasama sa bilang ng company)
function isCountableStudent(data) {
    const role = normalizeName(data.role);
    if (role !== "student" && role !== "intern") return false;

    // Deleted account: hindi binibilang
    if (data.accountDisabled === true) return false;

    const internshipStatus = String(data.internshipStatus || "");
    const isDone = isCompletedStudent(data);

    // Archived / Graduated / tapos na ang batch -> Batch Archive na ito
    const isArchived =
        data.archived === true ||
        (hasBatchEnded(getBatchLabel(data)) &&
         !(data.allowContinueHours === true && !isDone));
    if (isArchived || internshipStatus === "Graduated") return false;

    // Pending (hindi pa tapos mag-register) -> hindi binibilang
    // Kapareho ng students.js: flag O kumpletong profile data
    const hasProfileData =
        !!(data.fullName || data.name || data.firstName) &&
        !!(data.studentNumber || data.studentId || data.course || data.section);
    const profileDone =
        data.isProfileComplete === true ||
        data.profileCompleted === true ||
        hasProfileData;
    const isPending =
        normalizeName(data.status) !== "completed" &&
        !(String(data.email || data.userEmail || "").trim() &&
          profileDone &&
          (data.studentNumber || data.studentId) &&
          (data.companyName || data.company));
    if (isPending) return false;

    return true;
}

// Kunin lahat ng countable na student ng isang company (by name, case-insensitive)
async function fetchCompanyStudents(companyName) {
    const [snap1, snap2] = await Promise.all([
        getDocs(query(collection(db, "users"), where("company", "==", companyName))),
        getDocs(query(collection(db, "users"), where("companyName", "==", companyName)))
    ]);
    const map = new Map();
    [...snap1.docs, ...snap2.docs].forEach(docSnap => {
        const data = docSnap.data();
        if (!isCountableStudent(data)) return;
        if (normalizeName(getStudentCompany(data)) !== normalizeName(companyName)) return;
        map.set(docSnap.id, { id: docSnap.id, data });
    });
    return map;
}

document.addEventListener("DOMContentLoaded", () => {
    let activeQrData = {};
    let activeEvaluationData = {};

    // (Profile, notification bell, at logout ay hawak na ng shared
    // header - see ../header/header.js. Ito rin ang nagre-redirect
    // papuntang login kapag walang naka-login.)
    onAuthStateChanged(auth, (user) => {
        if (user) {
            loadCompaniesWithStudentCounts();
        }
    });

    // LOAD COMPANIES & RENDER CARDS WITH PROPER DATA-ID
    function loadCompaniesWithStudentCounts() {
        const companyGrid = document.getElementById("companyGrid");
        if (!companyGrid) return;

        const companiesCol = collection(db, "companies");
        const usersCol = collection(db, "users");

        onSnapshot(companiesCol, (companySnapshot) => {
            onSnapshot(usersCol, (userSnapshot) => {
                companyGrid.innerHTML = ""; 

                if (companySnapshot.empty) {
                    companyGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 20px;">Walang kumpanyang nakatala.</p>`;
                    return;
                }

                const allStudents = [];
                userSnapshot.forEach(docSnap => {
                    const userData = docSnap.data();
                    if (isCountableStudent(userData)) {
                        allStudents.push(userData);
                    }
                });

                companySnapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    const companyId = docSnap.id; 
                    const companyName = data.companyName ? data.companyName.trim().toLowerCase() : "";

                    const companyStudents = allStudents.filter(s =>
                        normalizeName(getStudentCompany(s)) === companyName
                    );

                    const totalStudents = companyStudents.length;
                    const completedStudents = companyStudents.filter(isCompletedStudent).length;
                    const activeStudents = totalStudents - completedStudents;

                    // ==========================================
                    // SUPERVISOR DISPLAY
                    // ==========================================

                    const supervisorList =
                        Array.isArray(data.supervisorNames) &&
                        data.supervisorNames.length > 0
                            ? data.supervisorNames
                            : (
                                data.supervisorName
                                    ? data.supervisorName
                                        .split(",")
                                        .map(name => name.trim())
                                        .filter(Boolean)
                                    : []
                            );


                    // Get initials
                    function getSupervisorInitials(name) {

                        if (!name) return "";

                        const parts =
                            name.trim().split(/\s+/);

                        if (parts.length === 1) {
                            return parts[0]
                                .substring(0, 2)
                                .toUpperCase();
                        }

                        return (
                            parts[0].charAt(0) +
                            parts[parts.length - 1].charAt(0)
                        ).toUpperCase();

                    }


                    const visibleSupervisors =
                        supervisorList.slice(0, 2);

                    const remainingSupervisors =
                        Math.max(
                            supervisorList.length - 2,
                            0
                        );
                    
                    const cardHtml = `
                        <div class="company-card" data-id="${companyId}" data-name="${data.companyName || ''}" data-total="${totalStudents}" data-active="${activeStudents}">
                            <div class="card-header">
                                <div class="company-brand">
                                    <div class="brand-icon red"><i class="fa-solid fa-building"></i></div>
                                    <div class="brand-info">

                                        <h3>
                                            ${data.companyName}
                                        </h3>

                                        <p class="supervisor-label">
                                            Supervisor
                                        </p>

                                        <div class="supervisor-display">

                                            ${
                                                visibleSupervisors.length > 0
                                                ? visibleSupervisors.map((name, index) => `

                                                    <span
                                                        class="supervisor-avatar supervisor-color-${index}">

                                                        ${getSupervisorInitials(name)}

                                                    </span>

                                                `).join("")
                                                : `

                                                    <span class="no-supervisor">
                                                        No supervisor
                                                    </span>

                                                `
                                            }


                                            ${
                                                remainingSupervisors > 0
                                                ? `

                                                    <span
                                                        class="supervisor-more">

                                                        +${remainingSupervisors}

                                                    </span>

                                                `
                                                : ""
                                            }


                                            ${
                                                visibleSupervisors.length > 0
                                                ? `

                                                    <span
                                                        class="primary-supervisor">

                                                        ${visibleSupervisors[0]}

                                                    </span>

                                                `
                                                : ""
                                            }
                                        </div>
                                    </div>
                                </div>
                                <button class="more-btn" type="button"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                                <div class="card-menu-dropdown">
                                    <button type="button" class="edit-company-btn" data-id="${companyId}"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                                    <button type="button" class="delete-company-btn delete-option" data-id="${companyId}" data-name="${data.companyName}"><i class="fa-solid fa-trash"></i> Delete</button>
                                </div>
                            </div>

                            <div class="card-tags">
                                <span><i class="fa-solid fa-location-dot"></i> ${data.location || 'N/A'}</span>
                            </div>

                            <div class="card-stats">
                                <div class="stat-item"><p>Total Students</p><h4>${totalStudents}</h4></div>
                                <div class="stat-item"><p>Active</p><h4 class="text-green">${activeStudents}</h4></div>
                                <div class="stat-item"><p>Completed</p><h4 class="text-blue">${completedStudents}</h4></div>
                            </div>

                            <div class="card-actions">
                                <button class="btn-primary-action view-students-btn"><i class="fa-solid fa-user-graduate"></i> View Students</button>
                                <button class="btn-secondary-action view-qr-btn" 
                                    data-company="${data.companyName}" 
                                    data-email="${data.supervisorEmail}"
                                    data-token="${data.qrToken}"
                                    data-qrurl="${data.qrImageUrl}">
                                    <i class="fa-solid fa-qrcode"></i> QR Attendance
                                </button>
                            </div>

                            <div style="margin-top: 10px;">
                                <button class="btn-secondary-action view-evaluation-btn" style="width: 100%; justify-content: center;" 
                                    data-company="${data.companyName}" 
                                    data-emails='${JSON.stringify(data.supervisorEmails || [data.supervisorEmail] || [])}'>
                                    <i class="fa-solid fa-square-check"></i> Evaluation
                                </button>
                            </div>
                        </div>
                    `;
                    companyGrid.insertAdjacentHTML("beforeend", cardHtml);
                });
                applyCompanyView();
            });
        });
    }

    // ADD COMPANY CHIPS & FORM
    let addSupNamesList = [];
    let addSupEmailsList = [];
    const addCompanyModal = document.getElementById("addCompanyModal");
    const openAddCompanyBtn = document.getElementById("openAddCompanyBtn");
    const closeAddModal = document.getElementById("closeAddModal");
    const addCompanyForm = document.getElementById("addCompanyForm");
    const addSupNameInput = document.getElementById("addSupNameInput");
    const addSupNameChipsContainer = document.getElementById("addSupNameChipsContainer");
    const addSupEmailInput = document.getElementById("addSupEmailInput");
    const addSupEmailChipsContainer = document.getElementById("addSupEmailChipsContainer");

    function renderChips(list, container, inputElement) {
        if (!container) return;
        container.querySelectorAll(".email-chip").forEach(chip => chip.remove());
        list.forEach((item, index) => {
            const chip = document.createElement("div");
            chip.className = "email-chip";
            chip.innerHTML = `<span>${item}</span><button type="button" class="remove-chip" data-index="${index}">&times;</button>`;
            container.insertBefore(chip, inputElement);
        });
    }

    if (addSupNameInput) {
        addSupNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                const val = addSupNameInput.value.trim().replace(",", "");
                if (val && !addSupNamesList.includes(val)) {
                    addSupNamesList.push(val);
                    addSupNameInput.value = "";
                    renderChips(addSupNamesList, addSupNameChipsContainer, addSupNameInput);
                }
            }
        });
    }

    if (addSupNameChipsContainer) {
        addSupNameChipsContainer.addEventListener("click", (e) => {
            if (e.target.closest(".remove-chip")) {
                const index = e.target.closest(".remove-chip").dataset.index;
                addSupNamesList.splice(index, 1);
                renderChips(addSupNamesList, addSupNameChipsContainer, addSupNameInput);
            }
        });
    }

    if (addSupEmailInput) {
        addSupEmailInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                const val = addSupEmailInput.value.trim().replace(",", "");
                if (val && val.includes("@") && !addSupEmailsList.includes(val)) {
                    addSupEmailsList.push(val);
                    addSupEmailInput.value = "";
                    renderChips(addSupEmailsList, addSupEmailChipsContainer, addSupEmailInput);
                }
            }
        });
    }

    if (addSupEmailChipsContainer) {
        addSupEmailChipsContainer.addEventListener("click", (e) => {
            if (e.target.closest(".remove-chip")) {
                const index = e.target.closest(".remove-chip").dataset.index;
                addSupEmailsList.splice(index, 1);
                renderChips(addSupEmailsList, addSupEmailChipsContainer, addSupEmailInput);
            }
        });
    }

    if (openAddCompanyBtn) {
        openAddCompanyBtn.addEventListener("click", () => {
            addSupNamesList = [];
            addSupEmailsList = [];
            renderChips(addSupNamesList, addSupNameChipsContainer, addSupNameInput);
            renderChips(addSupEmailsList, addSupEmailChipsContainer, addSupEmailInput);
            if (addCompanyModal) addCompanyModal.classList.add("active");
        });
    }

    if (closeAddModal) {
        closeAddModal.addEventListener("click", () => {
            if (addCompanyModal) addCompanyModal.classList.remove("active");
        });
    }

    if (addCompanyForm) {
        addCompanyForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (addSupNamesList.length === 0 || addSupEmailsList.length === 0) {
                showModalAlert("addModalAlert", "Maglagay kahit isang Supervisor Name at Supervisor Email.", "error");
                return;
            }

            const companyName = document.getElementById("newCompanyName").value.trim();
            const location = document.getElementById("newCompanyLocation").value.trim();
            const saveBtn = document.getElementById("saveCompanyBtn");
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

            try {
                const generatedQrToken = "OJT-TOKEN-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
                const qrPayload = JSON.stringify({ system: "OJT_LOGS_SYSTEM", company: companyName, token: generatedQrToken });
                const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrPayload)}&size=300&margin=2&format=png`;

                await addDoc(collection(db, "companies"), {
                    companyName,
                    supervisorNames: addSupNamesList,
                    supervisorEmails: addSupEmailsList,
                    supervisorName: addSupNamesList.join(", "),
                    supervisorEmail: addSupEmailsList[0] || "",
                    location,
                    qrToken: generatedQrToken,
                    qrImageUrl,
                    createdAt: serverTimestamp()
                });

                addCompanyForm.reset();
                addSupNamesList = [];
                addSupEmailsList = [];
                if (addCompanyModal) addCompanyModal.classList.remove("active");
                showToastNotification("Company successfully added", "success");
            } catch (err) {
                showModalAlert("addModalAlert", "Failed to save: " + err.message, "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Company & Generate QR Code`;
            }
        });
    }

    // ==========================================
    // SEARCH + FILTER + SORT (company cards)
    // Ang Filter at Sort buttons ay UI lang; dito nagsasama ang
    // search, filter, at sort at ina-apply ulit pagkatapos ng bawat render.
    // ==========================================
    let companyStatusFilter = "All";
    let companySortMode = "default";

    function applyCompanyView() {
        const grid = document.getElementById("companyGrid");
        if (!grid) return;

        const cards = Array.from(grid.querySelectorAll(".company-card"));
        if (cards.length === 0) return;

        const keyword = (document.getElementById("searchCompany")?.value || "").toLowerCase().trim();

        // Itabi ang orihinal na pagkakasunod-sunod para sa "Default"
        cards.forEach((card, i) => {
            if (card.dataset.order === undefined) card.dataset.order = i;
        });

        let visibleCount = 0;
        cards.forEach((card) => {
            const searchable = [
                card.querySelector(".brand-info"),
                card.querySelector(".card-tags")
            ].map(el => (el ? el.textContent : "")).join(" ").toLowerCase();

            const hasActiveStudents = Number(card.dataset.active) > 0;
            const matchesSearch = searchable.includes(keyword);
            const matchesFilter =
                companyStatusFilter === "All" ||
                (companyStatusFilter === "Active" && hasActiveStudents) ||
                (companyStatusFilter === "Inactive" && !hasActiveStudents);

            const show = matchesSearch && matchesFilter;
            card.style.display = show ? "flex" : "none";
            if (show) visibleCount++;
        });

        // Sort (muling ina-append ang mga card ayon sa napiling order)
        const byName = (a, b) => (a.dataset.name || "").localeCompare(b.dataset.name || "");
        const sorted = cards.slice().sort((a, b) => {
            switch (companySortMode) {
                case "name-asc": return byName(a, b);
                case "name-desc": return byName(b, a);
                case "students-high": return Number(b.dataset.total) - Number(a.dataset.total);
                case "students-low": return Number(a.dataset.total) - Number(b.dataset.total);
                default: return Number(a.dataset.order) - Number(b.dataset.order);
            }
        });
        sorted.forEach(card => grid.appendChild(card));

        // Empty state kapag walang tumugma
        let empty = document.getElementById("companyEmptyState");
        if (visibleCount === 0) {
            if (!empty) {
                empty = document.createElement("p");
                empty.id = "companyEmptyState";
                empty.className = "company-empty-state";
                empty.textContent = "No companies found.";
            }
            grid.appendChild(empty);
        } else if (empty) {
            empty.remove();
        }
    }

    const searchInput = document.getElementById("searchCompany");
    if (searchInput) {
        searchInput.addEventListener("input", applyCompanyView);
    }

    // Filter & Sort popover buttons
    (function initToolbarMenus() {
        const filterBtn = document.getElementById("filterBtn");
        const filterPopover = document.getElementById("filterPopover");
        const sortBtn = document.getElementById("sortBtn");
        const sortPopover = document.getElementById("sortPopover");
        const filterBadge = document.getElementById("filterBadge");

        const menus = [
            { btn: filterBtn, pop: filterPopover },
            { btn: sortBtn, pop: sortPopover }
        ].filter(m => m.btn && m.pop);

        const closeAll = () => {
            menus.forEach(({ btn, pop }) => {
                pop.classList.remove("open");
                btn.setAttribute("aria-expanded", "false");
            });
        };

        menus.forEach(({ btn, pop }) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const willOpen = !pop.classList.contains("open");
                closeAll();
                if (willOpen) {
                    pop.classList.add("open");
                    btn.setAttribute("aria-expanded", "true");
                }
            });
            pop.addEventListener("click", (e) => e.stopPropagation());
        });

        document.addEventListener("click", closeAll);
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeAll();
        });

        const wireOptions = (pop, attr, onPick) => {
            if (!pop) return;
            const options = pop.querySelectorAll(".menu-option");
            options.forEach((opt) => {
                opt.addEventListener("click", () => {
                    options.forEach(o => o.classList.toggle("active", o === opt));
                    onPick(opt.getAttribute(attr));
                    applyCompanyView();
                    closeAll();
                });
            });
        };

        wireOptions(filterPopover, "data-filter", (value) => {
            companyStatusFilter = value;
            if (filterBadge) filterBadge.hidden = value === "All";
        });

        wireOptions(sortPopover, "data-sort", (value) => {
            companySortMode = value;
        });
    })();

// QR MODAL
const qrModal = document.getElementById("qrModal");
const closeQrModal = document.getElementById("closeQrModal");

document.addEventListener("click", (e) => {
    const qrBtn = e.target.closest(".view-qr-btn");
    if (qrBtn) {
        activeQrData = {
            company: qrBtn.dataset.company,
            email: qrBtn.dataset.email, // Eto yung email na naka-save sa company
            token: qrBtn.dataset.token,
            qrUrl: qrBtn.dataset.qrurl
        };
        
        document.getElementById("qrCompanyTitle").textContent = activeQrData.company;
        
        // Automatic na ilalagay at ili-lock ang email dito
        const emailInput = document.getElementById("supervisorEmailInput");
        if (emailInput) {
            emailInput.value = activeQrData.email || "";
        }

        document.getElementById("qrcode").innerHTML = `<img src="${activeQrData.qrUrl}" width="180" height="180" alt="QR Code" style="border-radius: 8px;" />`;
        
        if (qrModal) qrModal.classList.add("active");
    }
});
    if (closeQrModal) closeQrModal.addEventListener("click", () => qrModal.classList.remove("active"));

    // ==========================================
    // EVALUATION MODAL & SEND LINK HANDLERS (IBINALIK)
    // ==========================================
    const evaluationModal = document.getElementById("evaluationModal");
    const closeEvaluationModal = document.getElementById("closeEvaluationModal");
    const sendEvaluationBtn = document.getElementById("sendEvaluationBtn");
    const previewEvaluationBtn = document.getElementById("previewEvaluationBtn");

    let evalEmailList = [];
    const evalChipsContainer = document.getElementById("evalEmailChipsContainer");

    function renderEvalEmailChips() {
        if (!evalChipsContainer) return;
        evalChipsContainer.innerHTML = "";

        if (evalEmailList.length === 0) {
            evalChipsContainer.innerHTML = `<span style="font-size: 12px; color: #94a3b8; padding: 4px;">Walang nakatalang supervisor email ang kumpanyang ito.</span>`;
            return;
        }

        evalEmailList.forEach((email, index) => {
            const chip = document.createElement("div");
            chip.className = "email-chip";
            chip.innerHTML = `
                <span>${email}</span>
                <button type="button" class="remove-chip" data-index="${index}">&times;</button>
            `;
            evalChipsContainer.appendChild(chip);
        });
    }

    if (evalChipsContainer) {
        evalChipsContainer.addEventListener("click", (e) => {
            if (e.target.closest(".remove-chip")) {
                const index = e.target.closest(".remove-chip").dataset.index;
                evalEmailList.splice(index, 1);
                renderEvalEmailChips();
            }
        });
    }

    document.addEventListener("click", (e) => {
        const evalBtn = e.target.closest(".view-evaluation-btn");
        if (evalBtn) {
            activeEvaluationData = {
                company: evalBtn.dataset.company
            };

            const evalTitle = document.getElementById("evaluationCompanyTitle");
            if (evalTitle) evalTitle.textContent = activeEvaluationData.company;

            try {
                const rawEmails = evalBtn.dataset.emails;
                evalEmailList = rawEmails ? JSON.parse(decodeURIComponent(rawEmails)) : [];
            } catch (err) {
                evalEmailList = [];
            }

            renderEvalEmailChips();
            if (evaluationModal) evaluationModal.classList.add("active");
        }
    });

    if (closeEvaluationModal) {
        closeEvaluationModal.addEventListener("click", () => {
            if (evaluationModal) evaluationModal.classList.remove("active");
        });
    }

    if (previewEvaluationBtn) {
        previewEvaluationBtn.addEventListener("click", () => {
            const companyName = activeEvaluationData.company;
            if (!companyName) return;
            openEvaluationStatusModal(companyName);
        });
    }

    // ==========================================
    // EVALUATION STATUS PREVIEW (PER STUDENT)
    // ==========================================
    const evaluationStatusModal = document.getElementById("evaluationStatusModal");
    const closeEvaluationStatusModal = document.getElementById("closeEvaluationStatusModal");
    const evaluationStatusList = document.getElementById("evaluationStatusList");
    const evaluationStatusCompanyLabel = document.getElementById("evaluationStatusCompanyLabel");

    const evaluationAnswersModal = document.getElementById("evaluationAnswersModal");
    const closeEvaluationAnswersModal = document.getElementById("closeEvaluationAnswersModal");
    const evaluationAnswersTitle = document.getElementById("evaluationAnswersTitle");
    const evaluationAnswersContent = document.getElementById("evaluationAnswersContent");

    let currentEvaluationsMap = new Map();

    function escapeHtml(value = "") {
        const el = document.createElement("div");
        el.textContent = value == null ? "" : String(value);
        return el.innerHTML;
    }

    const RATING_CATEGORIES = [
        { prefix: "integration", label: "Integration of Basic Theory in Practice" },
        { prefix: "profession", label: "Understanding of the Profession" },
        { prefix: "quality", label: "Quality and Quantity of Work" },
        { prefix: "skills", label: "Practicumer's Skill in Program Settings" },
        { prefix: "interpersonal", label: "Intrapersonal and Interpersonal Skills" },
        { prefix: "program", label: "Practicum Program Evaluation" }
    ];

    async function openEvaluationStatusModal(companyName) {
        if (evaluationStatusCompanyLabel) {
            evaluationStatusCompanyLabel.textContent = `Students under ${companyName}`;
        }

        if (evaluationStatusList) {
            evaluationStatusList.innerHTML = `<p class="eval-empty-note"><i class="fa-solid fa-spinner fa-spin"></i> Loading students...</p>`;
        }

        if (evaluationStatusModal) evaluationStatusModal.classList.add("active");

        try {
            // Kunin lahat ng estudyante/intern ng company na ito (same rules sa card count)
            const fetched = await fetchCompanyStudents(companyName);
            const studentsMap = new Map();
            fetched.forEach(({ id, data }) => {
                studentsMap.set(id, {
                    id,
                    fullName: data.fullName || data.name || "Unnamed Student",
                    studentNumber: data.studentNumber || data.idNumber || ""
                });
            });

            // Kunin lahat ng na-submit nang evaluation ng company na ito
            const evaluationsQuery = query(collection(db, "evaluations"), where("companyName", "==", companyName));
            const evalSnap = await getDocs(evaluationsQuery);

            currentEvaluationsMap = new Map();
            evalSnap.forEach(docSnap => {
                const data = docSnap.data();
                if (data.internId) {
                    currentEvaluationsMap.set(data.internId, { id: docSnap.id, ...data });
                }
            });

            renderEvaluationStatusList(studentsMap);

        } catch (err) {
            console.error("Evaluation status load error:", err);
            if (evaluationStatusList) {
                evaluationStatusList.innerHTML = `<p class="eval-empty-note">Hindi na-load ang listahan ng estudyante. Subukan muli.</p>`;
            }
        }
    }

    function renderEvaluationStatusList(studentsMap) {
        if (!evaluationStatusList) return;

        if (studentsMap.size === 0) {
            evaluationStatusList.innerHTML = `<p class="eval-empty-note">Walang naitalang estudyante para sa kumpanyang ito.</p>`;
            return;
        }

        const students = Array.from(studentsMap.values())
            .sort((a, b) => a.fullName.localeCompare(b.fullName));

        evaluationStatusList.innerHTML = students.map(student => {
            const evaluation = currentEvaluationsMap.get(student.id);
            const isAnswered = !!evaluation;

            return `
                <div class="eval-status-item">
                    <div class="eval-status-info">
                        <h4>${escapeHtml(student.fullName)}</h4>
                        <span>${escapeHtml(student.studentNumber || "No student number")}</span>
                    </div>
                    <div class="eval-status-right">
                        ${isAnswered
                            ? `<span class="eval-status-badge answered"><i class="fa-solid fa-circle-check"></i> Evaluated</span>
                               <button type="button" class="eval-view-answers-btn" data-intern-id="${student.id}">View Answers</button>`
                            : `<span class="eval-status-badge waiting"><i class="fa-solid fa-clock"></i> Waiting for Supervisor</span>`
                        }
                    </div>
                </div>
            `;
        }).join("");
    }

    if (evaluationStatusList) {
        evaluationStatusList.addEventListener("click", (e) => {
            const btn = e.target.closest(".eval-view-answers-btn");
            if (!btn) return;
            const internId = btn.dataset.internId;
            const evaluation = currentEvaluationsMap.get(internId);
            if (evaluation) openEvaluationAnswersModal(evaluation);
        });
    }

    function openEvaluationAnswersModal(evaluation) {
        if (evaluationAnswersTitle) {
            evaluationAnswersTitle.textContent = `Evaluation — ${evaluation.internName || "Student"}`;
        }

        const ratings = evaluation.ratings || {};

        const categoryScoresHtml = RATING_CATEGORIES.map(cat => {
            const values = Object.keys(ratings)
                .filter(key => key.startsWith(cat.prefix + "_"))
                .map(key => Number(ratings[key]))
                .filter(v => !isNaN(v) && v > 0);

            if (values.length === 0) return "";

            const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);

            return `
                <div class="eval-category-score-row">
                    <span>${escapeHtml(cat.label)}</span>
                    <strong>${avg} / 5</strong>
                </div>
            `;
        }).join("");

        const hire = (evaluation.wouldHire || "").toLowerCase();
        const hirePillHtml = evaluation.wouldHire
            ? `<span class="eval-hire-pill ${hire === "yes" ? "yes" : "no"}">
                   <i class="fa-solid ${hire === "yes" ? "fa-thumbs-up" : "fa-thumbs-down"}"></i>
                   ${escapeHtml(evaluation.wouldHire)}
               </span>`
            : "—";

        if (evaluationAnswersContent) {
            evaluationAnswersContent.innerHTML = `
                <div class="eval-answers-meta">
                    <div>
                        <span>Evaluator</span>
                        <strong>${escapeHtml(evaluation.evaluatorName || "—")}</strong>
                    </div>
                    <div>
                        <span>Position</span>
                        <strong>${escapeHtml(evaluation.evaluatorPosition || "—")}</strong>
                    </div>
                    <div>
                        <span>Date Accomplished</span>
                        <strong>${escapeHtml(evaluation.dateAccomplished || "—")}</strong>
                    </div>
                    <div>
                        <span>Would Hire?</span>
                        <strong>${hirePillHtml}</strong>
                    </div>
                </div>

                <div class="eval-category-scores">
                    ${categoryScoresHtml || `<p class="eval-empty-note" style="padding:8px 0;">No rating data available.</p>`}
                </div>

                <div class="eval-answer-block">
                    <h5>Strong Points</h5>
                    <p>${escapeHtml(evaluation.strongPoints || "—")}</p>
                </div>

                <div class="eval-answer-block">
                    <h5>Significant Limitations</h5>
                    <p>${escapeHtml(evaluation.limitations || "—")}</p>
                </div>

                <div class="eval-answer-block">
                    <h5>Professional Improvement</h5>
                    <p>${escapeHtml(evaluation.professionalImprovement || "—")}</p>
                </div>

                <div class="eval-answer-block">
                    <h5>Program Suggestion</h5>
                    <p>${escapeHtml(evaluation.programSuggestion || "—")}</p>
                </div>
            `;
        }

        if (evaluationAnswersModal) evaluationAnswersModal.classList.add("active");
    }

    if (closeEvaluationStatusModal) {
        closeEvaluationStatusModal.addEventListener("click", () => {
            if (evaluationStatusModal) evaluationStatusModal.classList.remove("active");
        });
    }

    if (closeEvaluationAnswersModal) {
        closeEvaluationAnswersModal.addEventListener("click", () => {
            if (evaluationAnswersModal) evaluationAnswersModal.classList.remove("active");
        });
    }

    if (sendEvaluationBtn) {
        sendEvaluationBtn.addEventListener("click", async () => {
            if (!evalEmailList || evalEmailList.length === 0) {
                showModalAlert("evaluationAlert", "Walang mapadalhang supervisor email para sa kumpanyang ito.", "error");
                return;
            }

            const companyName = activeEvaluationData.company;
            sendEvaluationBtn.disabled = true;
            sendEvaluationBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending via EmailJS...`;

            try {
                const companiesQuery = query(collection(db, "companies"), where("companyName", "==", companyName));
                const companySnap = await getDocs(companiesQuery);
                
                if (companySnap.empty) {
                    throw new Error("Hindi makita ang kumpanyang ito sa database.");
                }
                const companyDocRef = companySnap.docs[0];
                const companyId = companyDocRef.id;

                const fetchedInterns = await fetchCompanyStudents(companyName);
                const internsMap = new Map();
                fetchedInterns.forEach(({ id, data }) => {
                    internsMap.set(id, {
                        id,
                        fullName: data.fullName || data.name || "Pangalan ng Intern",
                        studentNumber: data.studentNumber || data.idNumber || ""
                    });
                });

                let companyInterns = Array.from(internsMap.values());

                // ONE-TIME LANG: huwag nang magpadala sa supervisor email na napadalhan na dati
                const existingSnap = await getDocs(
                    query(collection(db, "guestEvaluationAccess"), where("companyId", "==", companyId))
                );
                const alreadySent = new Set();
                existingSnap.forEach(docSnap => {
                    const sentTo = String(docSnap.data().supervisorEmail || "").trim().toLowerCase();
                    if (sentTo) alreadySent.add(sentTo);
                });

                const normalize = (value) => String(value || "").trim().toLowerCase();
                const emailsToSend = evalEmailList.filter(email => !alreadySent.has(normalize(email)));
                const skippedEmails = evalEmailList.filter(email => alreadySent.has(normalize(email)));

                if (emailsToSend.length === 0) {
                    showModalAlert(
                        "evaluationAlert",
                        `The evaluation link was already sent to ${skippedEmails.join(", ")}. It can only be sent once.`,
                        "error"
                    );
                    return;
                }

                for (const email of emailsToSend) {
                    const guestToken = "EVAL-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10).toUpperCase();
                    const evaluationLink = `${window.location.origin}/guest-access/guest-evaluation.html?token=${guestToken}`;

                    await addDoc(collection(db, "guestEvaluationAccess"), {
                        companyId: companyId,
                        companyName: companyName,
                        supervisorEmail: email,
                        token: guestToken,
                        interns: companyInterns,
                        createdAt: serverTimestamp(),
                        submittedAt: null
                    });

                    const templateParams = {
                        to_email: email,
                        company_name: companyName,
                        evaluation_link: evaluationLink,
                        message: evaluationLink
                    };

                    await emailjs.send(
                        "service_4ybmsuq", 
                        "template_lj1idvy", 
                        templateParams,
                        "9tYTBTAGQWPgHHTSW"
                    );
                }

                const skippedNote = skippedEmails.length
                    ? ` (Skipped, already sent before: ${skippedEmails.join(", ")})`
                    : "";
                showModalAlert("evaluationAlert", `The link has been sent via email! Please check your Gmail.${skippedNote}`, "success");
                
                setTimeout(() => {
                    if (evaluationModal) evaluationModal.classList.remove("active");
                }, 2000);

            } catch (err) {
                console.error("EmailJS Error:", err);
                showModalAlert("evaluationAlert", `Error: ${err.text || err.message}`, "error");
            } finally {
                sendEvaluationBtn.disabled = false;
                sendEvaluationBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Guest Evaluation Link`;
            }
        });
    }
});

// DROPDOWN & EDIT/DELETE HANDLERS
document.addEventListener("click", (e) => {
    const moreBtn = e.target.closest(".more-btn");
    document.querySelectorAll(".card-menu-dropdown").forEach(menu => {
        if (!moreBtn || menu.previousElementSibling !== moreBtn) menu.classList.remove("active");
    });
    if (moreBtn) {
        e.stopPropagation();
        moreBtn.nextElementSibling?.classList.toggle("active");
    }
});

// EDIT & DELETE LOGIC WITH FALLBACK
let editSupNamesList = [];
let editSupEmailsList = [];
const editCompanyModal = document.getElementById("editCompanyModal");
const closeEditModal = document.getElementById("closeEditModal");
const editCompanyForm = document.getElementById("editCompanyForm");
const editSupNameInput = document.getElementById("editSupNameInput");
const editSupNameChipsContainer = document.getElementById("editSupNameChipsContainer");
const editSupEmailInput = document.getElementById("editSupEmailInput");
const editSupEmailChipsContainer = document.getElementById("editSupEmailChipsContainer");
const deleteConfirmModal = document.getElementById("deleteConfirmModal");
const closeDeleteModal = document.getElementById("closeDeleteModal");
const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
let companyIdToDelete = null;

function renderEditChips(list, container, inputEl) {
    if (!container) return;
    container.querySelectorAll(".email-chip").forEach(c => c.remove());
    list.forEach((item, idx) => {
        const chip = document.createElement("div");
        chip.className = "email-chip";

        const label = document.createElement("span");
        label.textContent = item;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "remove-chip";
        removeBtn.dataset.index = idx;
        removeBtn.innerHTML = "&times;";

        chip.append(label, removeBtn);
        container.insertBefore(chip, inputEl);
    });
}

// ----- EDIT MODAL: add / remove ng Supervisor Names at Emails -----
// Idagdag ang laman ng input bilang chip. Ibabalik ang "added", "empty" o "invalid".
function commitEditName() {
    if (!editSupNameInput) return "empty";
    const val = editSupNameInput.value.trim().replace(/,/g, "");
    if (!val) return "empty";
    if (!editSupNamesList.some(n => String(n).toLowerCase() === val.toLowerCase())) {
        editSupNamesList.push(val);
    }
    editSupNameInput.value = "";
    renderEditChips(editSupNamesList, editSupNameChipsContainer, editSupNameInput);
    return "added";
}

function commitEditEmail() {
    if (!editSupEmailInput) return "empty";
    const val = editSupEmailInput.value.trim().replace(/,/g, "");
    if (!val) return "empty";
    if (!val.includes("@")) return "invalid";
    if (!editSupEmailsList.some(m => String(m).toLowerCase() === val.toLowerCase())) {
        editSupEmailsList.push(val);
    }
    editSupEmailInput.value = "";
    renderEditChips(editSupEmailsList, editSupEmailChipsContainer, editSupEmailInput);
    return "added";
}

if (editSupNameInput) {
    editSupNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitEditName();
        }
    });
}

if (editSupEmailInput) {
    editSupEmailInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (commitEditEmail() === "invalid") {
                showModalAlert("editModalAlert", "Maglagay ng valid na email (may @).", "error");
            }
        }
    });
}

if (editSupNameChipsContainer) {
    editSupNameChipsContainer.addEventListener("click", (e) => {
        const removeBtn = e.target.closest(".remove-chip");
        if (!removeBtn) return;
        editSupNamesList.splice(Number(removeBtn.dataset.index), 1);
        renderEditChips(editSupNamesList, editSupNameChipsContainer, editSupNameInput);
    });
}

if (editSupEmailChipsContainer) {
    editSupEmailChipsContainer.addEventListener("click", (e) => {
        const removeBtn = e.target.closest(".remove-chip");
        if (!removeBtn) return;
        editSupEmailsList.splice(Number(removeBtn.dataset.index), 1);
        renderEditChips(editSupEmailsList, editSupEmailChipsContainer, editSupEmailInput);
    });
}

function createElementFromHTML(htmlString) {
    const div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstChild;
}

document.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-company-btn");
    const deleteBtn = e.target.closest(".delete-company-btn");

    if (editBtn) {
        let companyId = editBtn.getAttribute("data-id");
        if (!companyId) {
            const card = editBtn.closest(".company-card");
            companyId = card ? card.getAttribute("data-id") : null;
        }

        if (!companyId) {
            showToastNotification("Hindi makuha ang ID ng kumpanya", "error");
            return;
        }

        try {
            const docSnap = await getDoc(doc(db, "companies", companyId));
            if (docSnap.exists()) {
                const data = docSnap.data();
                document.getElementById("editCompanyId").value = companyId;
                document.getElementById("editCompanyName").value = data.companyName || "";
                document.getElementById("editCompanyLocation").value = data.location || "";

                editSupNamesList = data.supervisorNames || (data.supervisorName ? [data.supervisorName] : []);
                editSupEmailsList = data.supervisorEmails || (data.supervisorEmail ? [data.supervisorEmail] : []);

                renderEditChips(editSupNamesList, editSupNameChipsContainer, editSupNameInput);
                renderEditChips(editSupEmailsList, editSupEmailChipsContainer, editSupEmailInput);

                if (editSupNameInput) editSupNameInput.value = "";
                if (editSupEmailInput) editSupEmailInput.value = "";

                if (editCompanyModal) editCompanyModal.classList.add("active");
            } else {
                showToastNotification("Hindi matagpuan sa database", "error");
            }
        } catch (err) {
            showToastNotification("Hindi makuha ang detalye ng kumpanya", "error");
        }
    }

    if (deleteBtn) {
        companyIdToDelete = deleteBtn.getAttribute("data-id") || deleteBtn.closest(".company-card")?.getAttribute("data-id");
        const companyName = deleteBtn.dataset.name;
        document.getElementById("deleteConfirmText").innerHTML = `Are you sure you want to delete <b>"${companyName}"</b>?`;
        deleteConfirmModal?.classList.add("active");
    }
});

if (closeEditModal) closeEditModal.addEventListener("click", () => editCompanyModal.classList.remove("active"));
const closeDel = () => deleteConfirmModal?.classList.remove("active");
closeDeleteModal?.addEventListener("click", closeDel);
cancelDeleteBtn?.addEventListener("click", closeDel);

if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
        if (!companyIdToDelete) return;
        try {
            await deleteDoc(doc(db, "companies", companyIdToDelete));
            closeDel();
            showToastNotification("Company deleted successfully", "success");
        } catch (err) {
            closeDel();
            showToastNotification("Failed to delete", "error");
        }
    });
}

if (editCompanyForm) {
    editCompanyForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        // Kung may naka-type na hindi pa na-Enter, isama muna bago i-save.
        commitEditName();
        if (commitEditEmail() === "invalid") {
            showModalAlert("editModalAlert", "Maglagay ng valid na email (may @).", "error");
            return;
        }

        const companyId = document.getElementById("editCompanyId").value;
        const companyName = document.getElementById("editCompanyName").value.trim();
        const location = document.getElementById("editCompanyLocation").value.trim();

        if (editSupNamesList.length === 0 || editSupEmailsList.length === 0) {
            showModalAlert("editModalAlert", "Maglagay kahit isang Supervisor Name at Email.", "error");
            return;
        }

        const updateBtn = document.getElementById("updateCompanyBtn");
        updateBtn.disabled = true;
        updateBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating...`;

        try {
            await updateDoc(doc(db, "companies", companyId), {
                companyName,
                supervisorNames: editSupNamesList,
                supervisorEmails: editSupEmailsList,
                supervisorName: editSupNamesList.join(", "),
                supervisorEmail: editSupEmailsList[0] || "",
                location,
                updatedAt: serverTimestamp()
            });
            editCompanyModal.classList.remove("active");
            showToastNotification("Company successfully updated", "success");
        } catch (err) {
            showModalAlert("editModalAlert", "Failed to update: " + err.message, "error");
        } finally {
            updateBtn.disabled = false;
            updateBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Company`;
        }
    });
}

// VIEW STUDENTS REDIRECT
document.addEventListener("click", (e) => {
    const viewStudentsBtn = e.target.closest(".view-students-btn");
    if (viewStudentsBtn) {
        const card = viewStudentsBtn.closest(".company-card");
        const companyName = card?.querySelector(".brand-info h3")?.textContent.trim();
        if (companyName) {
            window.location.href = `../company-student/company-student.html?company=${encodeURIComponent(companyName)}`;
        }
    }
});

function showToastNotification(message, type = "success") {
    const toast = document.getElementById("toastNotification");
    if (!toast) return;
    
    // Set class at nilalagyan ng icon depende kung success o error
    toast.className = `toast-notification ${type} show`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> <span>${message}</span>`;
    
    // Mawawala siya kusa pagkalipas ng 4 na segundo (4000ms)
    setTimeout(() => {
        toast.classList.remove("show");
    }, 4000);
}

function showModalAlert(containerId, message, type = "success") {
    const alertBox = document.getElementById(containerId);
    if (!alertBox) return;
    alertBox.className = `custom-alert ${type}`;
    alertBox.style.display = "flex";
    alertBox.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> <span>${message}</span>`;
    setTimeout(() => alertBox.style.display = "none", 4000);
}