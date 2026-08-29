import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

if (window.emailjs) {
    emailjs.init("9tYTBTAGQWPgHHTSW"); 
}

document.addEventListener("DOMContentLoaded", () => {
    let activeQrData = {};
    let activeEvaluationData = {};

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                const userDocRef = doc(db, "users", user.uid);
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists()) {
                    updateProfileUI(userDoc.data(), user);
                } else {
                    updateProfileUI({}, user);
                }
            } catch (error) {
                console.error("Error fetching coordinator details:", error);
            }
            loadCompaniesWithStudentCounts();
        } else {
            window.location.href = "../coordinator_login/coordinator_login.html";
        }
    });

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                window.location.href = "../coordinator_login/coordinator_login.html";
            } catch (err) {
                console.error("Logout Error:", err);
            }
        });
    }

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
                    if (userData.role && userData.role.toLowerCase() === "student") {
                        allStudents.push(userData);
                    }
                });

                companySnapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    const companyId = docSnap.id; 
                    const companyName = data.companyName ? data.companyName.trim().toLowerCase() : "";

                    const companyStudents = allStudents.filter(s => {
                        const sCompany = s.companyName ? s.companyName.trim().toLowerCase() : "";
                        return sCompany === companyName;
                    });

                    const totalStudents = companyStudents.length;
                    const activeStudents = companyStudents.filter(s => {
                        const status = s.status ? s.status.trim().toLowerCase() : "";
                        return status === "active" || status === "ongoing";
                    }).length;
                    const completedStudents = companyStudents.filter(s => {
                        const status = s.status ? s.status.trim().toLowerCase() : "";
                        return status === "completed" || status === "finished" || status === "done";
                    }).length;

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
                        <div class="company-card" data-id="${companyId}" data-name="${data.companyName || ''}">
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
                                <span><i class="fa-solid fa-tag"></i> ${data.industry || 'General'}</span>
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
            const industry = document.getElementById("newCompanyIndustry").value.trim();
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
                    industry,
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

    // SEARCH FILTER
    const searchInput = document.getElementById("searchCompany");
    if (searchInput) {
        searchInput.addEventListener("keyup", () => {
            const keyword = searchInput.value.toLowerCase();
            document.querySelectorAll(".company-card").forEach(card => {
                card.style.display = card.innerText.toLowerCase().includes(keyword) ? "flex" : "none";
            });
        });
    }

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
            const previewUrl = `/guest-access/guest-evaluation.html?preview=1`; 
            window.open(previewUrl, '_blank');
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

                const internsQuery1 = query(collection(db, "users"), where("company", "==", companyName));
                const internsQuery2 = query(collection(db, "users"), where("companyName", "==", companyName));

                const [snap1, snap2] = await Promise.all([getDocs(internsQuery1), getDocs(internsQuery2)]);
                const internsMap = new Map();

                [...snap1.docs, ...snap2.docs].forEach(docSnap => {
                    const data = docSnap.data();
                    const role = (data.role || "").toLowerCase();
                    if (role === "intern" || role === "student") {
                        internsMap.set(docSnap.id, {
                            id: docSnap.id,
                            fullName: data.fullName || data.name || "Pangalan ng Intern",
                            studentNumber: data.studentNumber || data.idNumber || ""
                        });
                    }
                });

                let companyInterns = Array.from(internsMap.values());

                for (const email of evalEmailList) {
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

                showModalAlert("evaluationAlert", `Na-send na ang link gamit ang EmailJS! I-check ang Gmail.`, "success");
                
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
        container.insertBefore(createElementFromHTML(`<div class="email-chip"><span>${item}</span><button type="button" class="remove-chip" data-index="${idx}">&times;</button></div>`), inputEl);
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
                document.getElementById("editCompanyIndustry").value = data.industry || "";

                editSupNamesList = data.supervisorNames || (data.supervisorName ? [data.supervisorName] : []);
                editSupEmailsList = data.supervisorEmails || (data.supervisorEmail ? [data.supervisorEmail] : []);

                renderEditChips(editSupNamesList, editSupNameChipsContainer, editSupNameInput);
                renderEditChips(editSupEmailsList, editSupEmailChipsContainer, editSupEmailInput);

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
        const companyId = document.getElementById("editCompanyId").value;
        const companyName = document.getElementById("editCompanyName").value.trim();
        const location = document.getElementById("editCompanyLocation").value.trim();
        const industry = document.getElementById("editCompanyIndustry").value.trim();

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
                industry,
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

function updateProfileUI(userData, authUser) {
    const fullName = userData.name || userData.fullName || authUser.displayName || "OJT Coordinator";
    const role = userData.role || userData.position || "Coordinator";
    const userName = document.getElementById("userName");
    const userRole = document.getElementById("userRole");
    const userAvatar = document.getElementById("userAvatar");
    if (userName) userName.textContent = fullName;
    if (userRole) userRole.textContent = role.toUpperCase();
    if (userAvatar) {
        userAvatar.textContent = fullName.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase() || "CO";
    }
}