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


let activeStudents = [];


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
   PENDING CHECK (same rule as students.js)
   Kailangan: email, tapos na ang profile
   setup, may student number, at may company.
======================================== */

function isProfileSetupDone(data) {

    // Kapareho ng students.js: tapos na ang profile kung naka-set ang flag,
    // O kung kumpleto na talaga ang laman (pangalan + student number/course/section).
    // Hindi umaasa sa flag lang, kasi may mga account na nakapag-setup na
    // pero hindi naisulat ang flag.

    const hasProfileData =
        !!(data.fullName || data.name || data.firstName) &&
        !!(data.studentNumber || data.studentId ||
           data.course || data.section);

    return (
        data.isProfileComplete === true ||
        data.profileCompleted === true ||
        hasProfileData
    );

}

function isPendingStudent(data) {

    const email =
        String(data.email || data.userEmail || "").trim();

    const hasStudentNumber =
        !!(data.studentNumber || data.studentId);

    const hasCompany =
        !!(data.companyName || data.company);

    return !(
        email &&
        isProfileSetupDone(data) &&
        hasStudentNumber &&
        hasCompany
    );

}


/* ========================================
   BATCH / ACADEMIC YEAR
   Kapareho ng students.js: tapos na ang
   Academic Year -> Batch Archive na, hindi
   na Active (maliban kung allowContinueHours).
======================================== */

function getStudentAcademicYear(studentNumber) {

    const sn = String(studentNumber || "").trim();
    if (!sn || sn === "-") return "";

    let startYear = null;

    const full = sn.match(/^((?:19|20)\d{2})/);

    if (full) {
        startYear = parseInt(full[1], 10);
    } else {
        const short = sn.match(/^(\d{2})\D/);
        if (short) startYear = 2000 + parseInt(short[1], 10);
    }

    if (!startYear) return "";

    const gradYear = startYear + 3;

    return `${gradYear}-${gradYear + 1}`;

}

function hasAcademicYearEnded(academicYear) {

    const m = String(academicYear || "").match(/^(\d{4})-(\d{4})$/);
    if (!m) return false;

    const end = new Date(Number(m[2]), 5, 30, 23, 59, 59);

    return new Date() > end;

}

// Kapag maraming user doc na iisa ang email, ang pinakakumpleto ang gagamitin
// (kapareho ng scoreUserDoc sa students.js).
function scoreUserDoc(u) {

    return (
        ((u.accountDisabled === true || u.archived === true) ? -100 : 0) +
        ((u.isProfileComplete === true || u.profileCompleted === true) ? 10 : 0) +
        ((u.studentNumber || u.studentId) ? 3 : 0) +
        ((u.fullName || u.name || u.firstName) ? 2 : 0) +
        ((u.course || u.section) ? 1 : 0)
    );

}


/* ========================================
   HINDI PA NAG-START ANG OJT
   Kapareho ng rule sa reports.js: kapag 0 hours,
   walang attendance record, at hindi pa lumalampas
   ang schedule.startDate, hindi siya pwedeng
   "At Risk" - Active siya.
======================================== */

async function loadStartedStudentIds() {

    const ids = new Set();

    try {

        const snap = await getDocs(collection(db, "attendance"));

        snap.forEach(d => {
            const r = d.data();
            const owner = r.userId || r.uid;
            if (owner) ids.add(owner);
        });

    } catch (err) {

        console.warn("attendance collection not available:", err);

    }

    return ids;

}

function hasNotStartedOjt(docId, data, startedIds) {

    if (startedIds.has(docId)) return false;

    const hours = [
        data.renderedHours,
        data.hoursRendered,
        data.completedHours,
        data.totalHours
    ].some(v => Number(v) > 0);

    if (hours) return false;

    const startStr = data.schedule && data.schedule.startDate;

    if (startStr) {

        const [y, m, d] = String(startStr).split("-").map(Number);
        const start = new Date(y, (m || 1) - 1, d || 1);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!isNaN(start) && start < today) return false;

    }

    return true;

}


/* ========================================
   LOAD ACTIVE STUDENTS
======================================== */

async function loadActiveStudents() {

    const tableBody =
        document.getElementById("students-body");

    try {

        const usersSnapshot =
            await getDocs(collection(db, "users"));

        const startedIds = await loadStartedStudentIds();

        activeStudents = [];


        // Isang user doc lang bawat email (pinakakumpleto), para walang
        // dobleng entry at hindi mapalitan ng luma/disabled na doc ang tama.
        const bestByEmail = new Map();

        usersSnapshot.forEach((docSnap) => {

            const u = docSnap.data();

            if (String(u.role || "").toLowerCase() !== "student") return;

            const key = String(u.email || u.userEmail || "")
                .toLowerCase().trim();

            // Walang email = pending, kaya hindi Active.
            if (!key) return;

            const current = bestByEmail.get(key);

            if (!current || scoreUserDoc(u) > scoreUserDoc(current.data())) {
                bestByEmail.set(key, docSnap);
            }

        });

        Array.from(bestByEmail.values()).forEach((docSnap) => {

            const data = docSnap.data();


            /* ARCHIVED (completed batch) - nasa Completed
               Batch Archive na, hindi na active. */

            if (data.archived === true) {
                return;
            }


            /* DELETED (soft delete) na ng coordinator */

            if (data.accountDisabled === true) {
                return;
            }


            /* TAPOS NA ANG ACADEMIC YEAR - Batch Archive na
               (maliban sa pinayagang magpatuloy ng hours) */

            const isDone =
                String(data.status || "").toLowerCase() === "completed" ||
                data.internshipStatus === "Completed";

            const studentNumber =
                data.studentNumber || data.studentId || data.idNumber;

            if (
                hasAcademicYearEnded(getStudentAcademicYear(studentNumber)) &&
                !(data.allowContinueHours === true && !isDone)
            ) {
                return;
            }


            /*
                ACTIVE CONDITION

                Kapareho ng rule sa students.js:
                Active = hindi pending (tapos na ang
                profile setup, may student number, at
                may company) at hindi pa Completed /
                At-Risk.
            */

            const rawStatus =
                String(data.status || "").toLowerCase();

            const aiStatus =
                String(data.internshipStatus || "");

            // Hindi pa nag-start: huwag ituring na At Risk
            const notStarted =
                hasNotStartedOjt(docSnap.id, data, startedIds);

            if (
                rawStatus === "completed" ||
                (!notStarted && (
                    rawStatus === "at-risk" ||
                    rawStatus === "at risk" ||
                    aiStatus === "At Risk"
                )) ||
                aiStatus === "Completed" ||
                aiStatus === "Graduated"
            ) {
                return;
            }

            if (isPendingStudent(data)) {
                return;
            }


            const requiredHours =
                Number(data.requiredHours) ||
                Number(data.requiredHoursTotal) ||
                600;

            const renderedHours =
                getRenderedHours(data);


            activeStudents.push({

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
                    "Active"

            });

        });


        populateFilterOptions();
        applyFilters();
        updateSummary(activeStudents);

    }

    catch (error) {

        console.error(
            "Error loading active students:",
            error
        );

        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-row">
                    Unable to load active students.<br>
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
                    No active internship students found.
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
                        <span class="status-badge status-active">
                            Active
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
        activeStudents.map((s) => s.section)
    );

    fill(
        filterCompany,
        "All Companies",
        activeStudents.map((s) => s.company)
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

    }

    return 0;

}


function applyFilters() {

    const keyword =
        searchInput.value
            .toLowerCase()
            .trim();


    const filtered =
        activeStudents.filter((student) => {

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
   "Missing or insufficient permissions")
======================================== */

onAuthStateChanged(auth, (user) => {

    if (!user) {

        const tableBody =
            document.getElementById("students-body");

        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-row">
                    Hindi ka naka-login. Mag-login muna
                    bago tingnan ang active students.
                </td>
            </tr>
        `;

        return;
    }

    loadActiveStudents();

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
    ).textContent = activeStudents.length;


    const totalRequired =
        activeStudents.reduce(
            (total, student) =>
                total + Number(student.requiredHours || 0),
            0
        );

    const totalRendered =
        activeStudents.reduce(
            (total, student) =>
                total + Number(student.renderedHours || 0),
            0
        );

    const completionRate =
        totalRequired > 0
            ? Math.round((totalRendered / totalRequired) * 100)
            : 0;


    document.getElementById(
        "print-required-hours"
    ).textContent =
        formatHours(totalRequired);

    document.getElementById(
        "print-rendered-hours"
    ).textContent =
        formatHours(totalRendered);

    document.getElementById(
        "print-completion-rate"
    ).textContent =
        completionRate;

    document.getElementById(
        "print-total-hours"
    ).textContent =
        `${formatHours(totalRendered)} hrs`;


    const printBody =
        document.getElementById("print-students-body");


    printBody.innerHTML =
        activeStudents.map((student, index) => {

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

                    <td class="print-status-active">
                        Active
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
                { type: "closeActiveStudentsModal" },
                "*"
            );

        } else {

            window.history.back();

        }

    });

}