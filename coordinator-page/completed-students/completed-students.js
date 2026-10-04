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


let completedStudents = [];


/* ========================================
   RENDERED HOURS (single source of truth)
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


/* HOURS FORMAT (max 2 decimals, walang trailing zeros) */

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
======================================== */

function isPendingStudent(data) {

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
   COMPLETION DATE
   (kapareho ng fields sa completed archive)
======================================== */

function toDate(v) {

    if (!v) {
        return null;
    }

    if (typeof v.toDate === "function") {
        return v.toDate();
    }

    const dt = new Date(v);

    return isNaN(dt) ? null : dt;

}

function formatDate(d) {

    return d
        ? d.toLocaleDateString(
            "en-US",
            { year: "numeric", month: "short", day: "numeric" }
        )
        : "";

}



/* ========================================
   LOAD COMPLETED STUDENTS
======================================== */

async function loadCompletedStudents() {

    const tableBody =
        document.getElementById("completed-students-body");

    try {

        const usersSnapshot =
            await getDocs(collection(db, "users"));

        completedStudents = [];


        usersSnapshot.forEach((docSnap) => {

            const data = docSnap.data();


            /* STUDENTS ONLY */

            if (
                data.role &&
                data.role.toLowerCase() !== "student"
            ) {
                return;
            }


            /* ARCHIVED - nasa Completed Batch Archive na,
               hindi na dapat lumabas dito. */

            if (data.archived === true) {
                return;
            }


            /* DELETED (soft delete) na ng coordinator */

            if (data.accountDisabled === true) {
                return;
            }


            const requiredHours =
                Number(data.requiredHours) ||
                Number(data.requiredHoursTotal) ||
                600;

            const renderedHours =
                getRenderedHours(data);


            /*
                COMPLETED CONDITION

                Completed kapag:
                (a) na-mark na "Completed" ang status
                    (kapareho ng nasa Completed Batch
                    Archive / students.js), O
                (b) rendered hours >= required hours
                    (at hindi pa pending ang student)
            */

            const isMarkedCompleted =
                String(data.status || "").toLowerCase() === "completed";

            const reachedHours =
                requiredHours > 0 &&
                renderedHours >= requiredHours &&
                !isPendingStudent(data);

            if (!isMarkedCompleted && !reachedHours) {
                return;
            }


            const completedOn =
                toDate(
                    data.completedAt ||
                    data.completionDate ||
                    data.completedDate ||
                    data.dateCompleted
                );

            completedStudents.push({

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

                completionDate:
                    completedOn ? formatDate(completedOn) : "",

                completionTime:
                    completedOn ? completedOn.getTime() : 0,

                status:
                    "Completed"
            });

        });


        populateFilterOptions();
        applyFilters();
        updateSummary(completedStudents);

    }

    catch (error) {

        console.error(
            "Error loading completed students:",
            error
        );

        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-row">
                    Unable to load completed students.
                </td>
            </tr>
        `;

    }

}


/* ========================================
   DISPLAY TABLE
======================================== */

function renderCompletedStudents(students) {

    const tableBody =
        document.getElementById("completed-students-body");


    if (students.length === 0) {

        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-row">
                    No completed internship students found.
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
                        ${escapeHtml(
                            student.completionDate || "—"
                        )}
                    </td>

                    <td>
                        <span class="completed-status">
                            Completed
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
        "total-completed"
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
        completedStudents.map((s) => s.section)
    );

    fill(
        filterCompany,
        "All Companies",
        completedStudents.map((s) => s.company)
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

        case "date":
            return m * (a.completionTime - b.completionTime) ||
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
        completedStudents.filter((student) => {

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


    renderCompletedStudents(filtered);

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
            document.getElementById("completed-students-body");

        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-row">
                    Hindi ka naka-login. Mag-login muna
                    bago tingnan ang completed students.
                </td>
            </tr>
        `;

        return;
    }

    loadCompletedStudents();

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
    ).textContent = completedStudents.length;


    const totalRendered =
        completedStudents.reduce(
            (total, student) =>
                total + Number(student.renderedHours || 0),
            0
        );


    document.getElementById(
        "print-rendered-hours"
    ).textContent =
        formatHours(totalRendered);


    document.getElementById(
        "print-total-hours"
    ).textContent =
        `${formatHours(totalRendered)} hrs`;


    const printBody =
        document.getElementById("print-students-body");


    printBody.innerHTML =
        completedStudents.map((student, index) => {

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

                    <td>
                        ${escapeHtml(
                            student.completionDate || "—"
                        )}
                    </td>

                    <td class="print-completed">
                        Completed
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
                { type: "closeCompletedStudentsModal" },
                "*"
            );

        } else {

            window.history.back();

        }

    });

}