import { initializeApp } from
"https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import {
    getFirestore,
    collection,
    getDocs
} from
"https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
    getAuth,
    onAuthStateChanged
} from
"https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";


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
const db = getFirestore(app);
const auth = getAuth(app);


let registeredStudents = [];


/* ========================================
   RENDERED HOURS (single source of truth)
   Kinukuha ang unang field na may valid
   na numero, hindi lang ang unang truthy,
   at hindi kailanman negative/NaN.
======================================== */

function getRenderedHours(data) {

    const fields = [
        data.renderedHours,
        data.hoursRendered,
        data.completedHours,
        data.totalHours
    ];

    for (const value of fields) {

        if (value === undefined || value === null || value === "") {
            continue;
        }

        const n = Number(value);

        if (Number.isFinite(n) && n >= 0) {
            return n;
        }

    }

    return 0;

}


/* ========================================
   HOURS FORMAT
   (max 2 decimals, walang trailing zeros)
   8.016666666666667 -> 8.02
   600               -> 600
======================================== */

function formatHours(value) {

    const n = Number(value) || 0;

    return (Math.round(n * 100) / 100)
        .toLocaleString(
            "en-US",
            { maximumFractionDigits: 2 }
        );

}


/* ========================================
   STATUS HELPERS
======================================== */

function normalizeStatus(rawStatus) {

    const status =
        String(rawStatus || "").toLowerCase();

    if (status === "completed") {
        return "Completed";
    }

    if (status === "at-risk" || status === "at risk") {
        return "At-Risk";
    }

    return "Registered";

}


function statusBadgeClass(status) {

    if (status === "Completed") {
        return "status-badge status-completed";
    }

    if (status === "At-Risk") {
        return "status-badge status-risk";
    }

    return "status-badge status-active";

}


function printStatusClass(status) {

    if (status === "Completed") {
        return "print-status-completed";
    }

    if (status === "At-Risk") {
        return "print-status-risk";
    }

    return "print-status-active";

}


/* ========================================
   PENDING CHECK (same rule as students.js)
======================================== */

function isPendingStudent(data) {

    /* Kapareho ng _is_pending_student() sa app.py para
       pareho ang bilang dito at sa Completion Forecast. */

    if (data.pending === true || data.isPending === true) {
        return true;
    }

    const accessFlags = [
        "approved", "isApproved", "hasAccess", "accessGranted",
        "activated", "isActivated", "registered", "isRegistered",
        "inviteAccepted", "invitationAccepted"
    ];

    if (accessFlags.some((field) => data[field] === false)) {
        return true;
    }

    const pendingValues = [
        "pending", "pending approval", "for approval",
        "awaiting approval", "unverified", "not approved",
        "invited", "invite sent", "invite pending",
        "pending invite", "pending invitation",
        "invitation sent", "awaiting registration",
        "unregistered", "not registered", "not activated",
        "disabled", "deactivated", "suspended", "revoked"
    ];

    const statusFields = [
        "status", "accountStatus", "approvalStatus",
        "registrationStatus", "inviteStatus",
        "invitationStatus", "accessStatus"
    ];

    const hasPendingStatus = statusFields.some((field) =>
        pendingValues.includes(
            String(data[field] || "").trim().toLowerCase()
        )
    );

    if (hasPendingStatus) {
        return true;
    }

    const isCompleted =
        String(data.status || "").toLowerCase() === "completed";

    if (isCompleted) {
        return false;
    }

    const email =
        String(data.email || "").trim();

    const profileDone =
        data.isProfileComplete === true ||
        data.profileCompleted === true;

    const hasStudentNumber =
        !!(data.studentNumber || data.studentId);

    const hasCompany =
        !!(data.companyName || data.company);

    return !(
        email &&
        profileDone &&
        hasStudentNumber &&
        hasCompany
    );

}


/* ========================================
   ARCHIVED CHECK (same rule as _is_archived
   sa app.py)
======================================== */

function isArchivedStudent(data) {

    if (data.archived === true || data.isArchived === true) {
        return true;
    }

    if (data.archivedAt || data.archivedDate) {
        return true;
    }

    const archiveFlags = [
        "batchArchived", "inArchive", "isCompletedBatch",
        "completedBatchArchived", "archiveId", "archivedBatch"
    ];

    if (archiveFlags.some((field) => data[field])) {
        return true;
    }

    return ["status", "accountStatus", "internshipStatus"].some(
        (field) =>
            String(data[field] || "").toLowerCase().includes("archiv")
    );

}


/* ========================================
   LOAD REGISTERED STUDENTS
======================================== */

async function loadRegisteredStudents() {

    const tableBody =
        document.getElementById("students-body");

    try {

        const usersSnapshot =
            await getDocs(collection(db, "users"));

        registeredStudents = [];


        usersSnapshot.forEach((docSnap) => {

            const data = docSnap.data();


            /* ARCHIVED (completed batch) - hindi na kasama
               sa registered students. Nasa Completed Batch
               Archive na sila. */

            if (isArchivedStudent(data)) {
                return;
            }


            /* DELETED (soft delete) na ng coordinator */

            if (data.accountDisabled === true) {
                return;
            }


            /* PENDING pa lang - hindi pa registered.
               Kapareho ng rule sa students.js:
               kailangan tapos na ang profile setup,
               may student number, at may company.
               (Completed = manual final status, kaya
               hindi na dumadaan sa check na ito.) */

            if (isPendingStudent(data)) {
                return;
            }


            /* STUDENTS ONLY */

            if (
                data.role &&
                data.role.toLowerCase() !== "student"
            ) {
                return;
            }


            const requiredHours =
                Number(data.requiredHours) ||
                Number(data.requiredHoursTotal) ||
                600;

            const renderedHours =
                getRenderedHours(data);


            registeredStudents.push({

                id: docSnap.id,

                studentId:
                    data.studentId ||
                    data.studentID ||
                    data.studentNumber ||
                    data.idNumber ||
                    data.schoolId ||
                    data.studentNo ||
                    data.id_number ||
                    "",

                name:
                    data.fullName ||
                    data.name ||
                    "",

                section:
                    data.section || "",

                company:
                    data.companyName ||
                    data.company ||
                    "",

                requiredHours:
                    requiredHours,

                renderedHours:
                    renderedHours,

                status:
                    normalizeStatus(data.status)

            });

        });


        populateFilterOptions();
        applyFilters();
        updateSummary(registeredStudents);

    }

    catch (error) {

        console.error(
            "Error loading registered students:",
            error
        );

        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-row">
                    Unable to load registered students.<br>
                    <small style="color:#dc2626;">
                        ${escapeHtml(
                            (error && error.message) ||
                            String(error)
                        )}
                    </small>
                </td>
            </tr>
        `;

    }

}


/* ========================================
   DISPLAY TABLE
======================================== */

function renderStudents(students) {

    const tableBody =
        document.getElementById("students-body");


    if (students.length === 0) {

        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-row">
                    No registered students found.
                </td>
            </tr>
        `;

        return;
    }


    tableBody.innerHTML =
        students.map((student, index) => {

            return `

                <tr>

                    <td>
                        ${index + 1}
                    </td>

                    <td>
                        ${escapeHtml(student.studentId)}
                    </td>

                    <td class="student-name">
                        ${escapeHtml(student.name)}
                    </td>

                    <td>
                        ${escapeHtml(student.section)}
                    </td>

                    <td>
                        ${escapeHtml(student.company)}
                    </td>

                    <td>
                        ${formatHours(student.requiredHours)} hrs
                    </td>

                    <td>
                        ${formatHours(student.renderedHours)} hrs
                    </td>

                    <td>
                        <span class="${statusBadgeClass(student.status)}">
                            ${student.status}
                        </span>
                    </td>

                </tr>

            `;

        }).join("");

}


/* ========================================
   SUMMARY
======================================== */

function updateSummary(students) {

    document.getElementById(
        "total-count"
    ).textContent = students.length;


    const totalHours =
        students.reduce(
            (total, student) =>
                total + student.renderedHours,
            0
        );


    document.getElementById(
        "total-rendered-hours"
    ).textContent =
        `${formatHours(totalHours)} hrs`;

}


/* ========================================
   SEARCH + FILTER + SORT
======================================== */

const searchInput =
    document.getElementById("student-search");

const filterSection =
    document.getElementById("filter-section");

const filterCompany =
    document.getElementById("filter-company");

const sortSelect =
    document.getElementById("sort-students");

const resetFiltersBtn =
    document.getElementById("reset-filters");


/* Fill Section / Company dropdowns from the loaded data */

function populateFilterOptions() {

    const fill = (select, label, values) => {

        const current = select.value;

        const unique =
            [...new Set(values.filter(Boolean))]
                .sort((a, b) =>
                    a.localeCompare(
                        b,
                        undefined,
                        { numeric: true }
                    )
                );

        select.innerHTML =
            `<option value="">${label}</option>` +
            unique.map((v) =>
                `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
            ).join("");

        select.value =
            unique.includes(current) ? current : "";

    };

    fill(
        filterSection,
        "All Sections",
        registeredStudents.map((s) => s.section)
    );

    fill(
        filterCompany,
        "All Companies",
        registeredStudents.map((s) => s.company)
    );

}


function compareStudents(a, b, mode) {

    const [key, dir] = mode.split("-");

    const m = dir === "desc" ? -1 : 1;

    const text = (x, y) =>
        String(x).localeCompare(
            String(y),
            undefined,
            { numeric: true, sensitivity: "base" }
        );

    switch (key) {

        case "name":
            return m * text(a.name, b.name);

        case "id":
            return m * text(a.studentId, b.studentId);

        case "section":
            return m * text(a.section, b.section) ||
                   text(a.name, b.name);

        case "company":
            return m * text(a.company, b.company) ||
                   text(a.name, b.name);

        case "hours":
            return m * (a.renderedHours - b.renderedHours) ||
                   text(a.name, b.name);

        case "status":
            return m * text(a.status, b.status) ||
                   text(a.name, b.name);

    }

    return 0;

}


function applyFilters() {

    const keyword =
        searchInput.value
            .toLowerCase()
            .trim();


    const filtered =
        registeredStudents.filter((student) => {

            if (
                filterSection.value &&
                student.section !== filterSection.value
            ) {
                return false;
            }

            if (
                filterCompany.value &&
                student.company !== filterCompany.value
            ) {
                return false;
            }

            if (!keyword) {
                return true;
            }

            return (

                student.name.toLowerCase().includes(keyword) ||

                student.studentId.toLowerCase().includes(keyword) ||

                student.section.toLowerCase().includes(keyword) ||

                student.company.toLowerCase().includes(keyword)

            );

        });


    filtered.sort((a, b) =>
        compareStudents(a, b, sortSelect.value)
    );


    renderStudents(filtered);

}


searchInput.addEventListener("input", applyFilters);
filterSection.addEventListener("change", applyFilters);
filterCompany.addEventListener("change", applyFilters);
sortSelect.addEventListener("change", applyFilters);


resetFiltersBtn.addEventListener("click", () => {

    searchInput.value = "";
    filterSection.value = "";
    filterCompany.value = "";
    sortSelect.value = "name-asc";

    applyFilters();

});


/* ========================================
   ESCAPE HTML
======================================== */

function escapeHtml(value) {

    return String(value ?? "")

        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


/* ========================================
   START
   (naghihintay muna ng auth state bago
   mag-fetch, para maiwasan ang
   "Missing or insufficient permissions"
   kapag natawag ang query bago pa
   ma-restore ang login session)
======================================== */

onAuthStateChanged(auth, (user) => {

    if (!user) {

        const tableBody =
            document.getElementById("students-body");

        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-row">
                    Hindi ka naka-login. Mag-login muna
                    bago tingnan ang registered students.
                </td>
            </tr>
        `;

        return;
    }

    loadRegisteredStudents();

});

function preparePrintReport() {

    const today = new Date();

    document.getElementById(
        "print-report-date"
    ).textContent = today.toLocaleDateString(
        "en-US",
        {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        }
    );


    document.getElementById(
        "print-total-students"
    ).textContent = registeredStudents.length;


    const activeCount =
        registeredStudents.filter(
            (student) => student.status === "Registered"
        ).length;

    const completedCount =
        registeredStudents.filter(
            (student) => student.status === "Completed"
        ).length;

    const riskCount =
        registeredStudents.filter(
            (student) => student.status === "At-Risk"
        ).length;


    document.getElementById(
        "print-active-count"
    ).textContent = activeCount;

    document.getElementById(
        "print-completed-count"
    ).textContent = completedCount;

    document.getElementById(
        "print-risk-count"
    ).textContent = riskCount;


    const totalRendered =
        registeredStudents.reduce(
            (total, student) =>
                total + Number(student.renderedHours || 0),
            0
        );


    document.getElementById(
        "print-total-hours"
    ).textContent =
        `${formatHours(totalRendered)} hrs`;


    const printBody =
        document.getElementById("print-students-body");


    printBody.innerHTML =
        registeredStudents.map((student, index) => {

            return `
                <tr>

                    <td>
                        ${index + 1}
                    </td>

                    <td>
                        ${escapeHtml(student.studentId)}
                    </td>

                    <td>
                        <strong>
                            ${escapeHtml(student.name)}
                        </strong>
                    </td>

                    <td>
                        ${escapeHtml(student.section)}
                    </td>

                    <td>
                        ${escapeHtml(student.company)}
                    </td>

                    <td>
                        ${formatHours(student.requiredHours)} hrs
                    </td>

                    <td class="hours">
                        ${formatHours(student.renderedHours)} hrs
                    </td>

                    <td class="${printStatusClass(student.status)}">
                        ${student.status}
                    </td>

                </tr>
            `;

        }).join("");

}


/* ========================================
   PRINT BUTTON
======================================== */

document
    .querySelector(".print-btn")
    .addEventListener("click", () => {

        preparePrintReport();

        setTimeout(() => {
            window.print();
        }, 100);

    });

// ========================================
// BACK TO DASHBOARD
// ========================================

const backToDashboardBtn =
    document.getElementById("backToDashboardBtn");

if (backToDashboardBtn) {

    backToDashboardBtn.addEventListener("click", () => {

        /*
            When this page is loaded as a popup inside
            the dashboard's iframe, tell the parent
            (dashboard.js) to close the modal instead
            of navigating history.
        */

        const isInsideDashboardPopup =
            window.self !== window.top;

        if (isInsideDashboardPopup) {

            window.parent.postMessage(
                { type: "closeRegisteredStudentsModal" },
                "*"
            );

        } else {

            window.history.back();

        }

    });

}