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
   LOAD ACTIVE STUDENTS
======================================== */

async function loadActiveStudents() {

    const tableBody =
        document.getElementById("students-body");

    try {

        const usersSnapshot =
            await getDocs(collection(db, "users"));

        activeStudents = [];


        usersSnapshot.forEach((docSnap) => {

            const data = docSnap.data();


            /* STUDENTS ONLY */

            if (
                data.role &&
                data.role.toLowerCase() !== "student"
            ) {
                return;
            }


            /*
                ACTIVE CONDITION

                Student is considered active when
                their status is explicitly "Active".
            */

            if (data.status !== "Active") {
                return;
            }


            const requiredHours =
                Number(data.requiredHours) ||
                Number(data.requiredHoursTotal) ||
                600;

            const renderedHours =
                Number(
                    data.renderedHours ||
                    data.completedHours ||
                    data.totalHours ||
                    0
                );


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


        renderStudents(activeStudents);
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
                        ${student.requiredHours} hrs
                    </td>

                    <td>
                        ${student.renderedHours} hrs
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
        `${totalHours.toFixed(1)} hrs`;

}


/* ========================================
   SEARCH
======================================== */

const searchInput =
    document.getElementById("student-search");


searchInput.addEventListener("input", () => {

    const keyword =
        searchInput.value
            .toLowerCase()
            .trim();


    const filtered =
        activeStudents.filter(student => {

            return (

                student.name
                    .toLowerCase()
                    .includes(keyword)

                ||

                student.studentId
                    .toLowerCase()
                    .includes(keyword)

                ||

                student.section
                    .toLowerCase()
                    .includes(keyword)

                ||

                student.company
                    .toLowerCase()
                    .includes(keyword)

            );

        });


    renderStudents(filtered);

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
        totalRequired.toLocaleString();

    document.getElementById(
        "print-rendered-hours"
    ).textContent =
        totalRendered.toLocaleString();

    document.getElementById(
        "print-completion-rate"
    ).textContent =
        completionRate;

    document.getElementById(
        "print-total-hours"
    ).textContent =
        `${totalRendered.toLocaleString()} hrs`;


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
                        ${student.requiredHours} hrs
                    </td>

                    <td class="hours">
                        ${student.renderedHours} hrs
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