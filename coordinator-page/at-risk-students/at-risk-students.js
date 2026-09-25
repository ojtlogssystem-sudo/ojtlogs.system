let riskStudents = [];


/* ========================================
   LOAD AT-RISK STUDENTS

   IMPORTANT:
   Kinukuha na natin ang data mula sa Flask AI
   server (app.py, /api/predict-risk) sa halip na
   direktang mag-query sa Firestore mula sa browser.
   Ginagawa rin ito ng analytics.js, kaya wala nang
   Firestore Security Rules na kailangang i-configure
   dito - ang Flask server (Admin SDK) na ang bahalang
   kumuha ng data mula sa Firestore.
======================================== */

async function loadAtRiskStudents() {

    const tableBody =
        document.getElementById("students-body");

    try {

        const response =
            await fetch(
                "http://localhost:5000/api/predict-risk"
            );

        const result =
            await response.json();

        if (result.status !== "success") {

            throw new Error(
                result.message || "AI server returned an error."
            );

        }


        riskStudents = [];


        (result.data || []).forEach((student) => {

            /*
                AT-RISK CONDITION

                Student is considered at-risk when the
                AI backend's aiStatus is exactly "At Risk"
                (set by app.py's /api/predict-risk).
            */

            if ((student.aiStatus || "") !== "At Risk") {
                return;
            }


            riskStudents.push({

                id: student.id,

                studentId:
                    student.studentId || "",

                name:
                    student.name || "",

                section:
                    student.section || "",

                company:
                    student.company || "",

                requiredHours:
                    Number(student.targetHours || 0),

                renderedHours:
                    Number(student.currentHours || 0),

                absentCount:
                    typeof student.absentCount === "number"
                        ? student.absentCount
                        : null,

                riskReason:
                    student.riskReason || "",

                status:
                    "At Risk"

            });

        });


        renderStudents(riskStudents);
        updateSummary(riskStudents);

    }

    catch (error) {

        console.error(
            "Error loading at-risk students:",
            error
        );

        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-row">
                    Unable to load at-risk students.<br>
                    <small style="color:#dc2626;">
                        ${escapeHtml(
                            (error && error.message) ||
                            String(error)
                        )}
                    </small>
                    <br>
                    <small style="color:#9ca3af;">
                        I-check: tumatakbo ba ang
                        <code>python app.py</code> sa port 5000?
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
                    No at-risk students found.
                </td>
            </tr>
        `;

        return;
    }


    tableBody.innerHTML =
        students.map((student, index) => {

            const absenceNote =
                typeof student.absentCount === "number"
                    ? ` &middot; ${student.absentCount} absence${student.absentCount === 1 ? "" : "s"}`
                    : "";

            return `

                <tr title="${escapeHtml(student.riskReason || "")}">

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
                        ${student.renderedHours} hrs${absenceNote}
                    </td>

                    <td>
                        <span class="status-badge status-risk">
                            At Risk
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
        riskStudents.filter(student => {

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
======================================== */

loadAtRiskStudents();

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
    ).textContent = riskStudents.length;


    const totalRequired =
        riskStudents.reduce(
            (total, student) =>
                total + Number(student.requiredHours || 0),
            0
        );

    const totalRendered =
        riskStudents.reduce(
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
        riskStudents.map((student, index) => {

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

                    <td class="print-status-risk">
                        At Risk
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
                { type: "closeAtRiskStudentsModal" },
                "*"
            );

        } else {

            window.history.back();

        }

    });

}