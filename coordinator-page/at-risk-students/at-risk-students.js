let riskStudents = [];
let filteredStudents = [];
let currentPage = 1;
let rowsPerPage = 10;

/* Kapag naka-load bilang popup (iframe) sa dashboard */
if (window.self !== window.top) {
    document.body.classList.add("embedded");
}


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
                Kapareho ng rules sa dashboard.js para pareho
                ang bilang:

                - accountDisabled (deleted) -> hindi binibilang
                - archived / graduated      -> hindi binibilang
                - PENDING (kulang ang email, profile setup,
                  student number o company) -> hindi at-risk
                - Completed (manual o AI)   -> hindi at-risk
                - At Risk = AI status "At Risk" o manual status
            */

            if (
                student.accountDisabled === true ||
                student.archived === true
            ) {
                return;
            }

            if (student.isPending === true) {
                return;
            }

            const manualStatus =
                String(student.manualStatus || "").toLowerCase();

            if (
                manualStatus === "completed" ||
                student.aiStatus === "Completed"
            ) {
                return;
            }

            const isAtRisk =
                student.aiStatus === "At Risk" ||
                manualStatus === "at-risk" ||
                manualStatus === "at risk";

            if (!isAtRisk) {
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


        populateFilterOptions();
        applyFilters();
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

function renderStudents(students, startIndex = 0) {

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
                        ${startIndex + index + 1}
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
        riskStudents.map((s) => s.section)
    );

    fill(
        filterCompany,
        "All Companies",
        riskStudents.map((s) => s.company)
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
        riskStudents.filter((student) => {

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


    filteredStudents = filtered;
    currentPage = 1;

    renderPage();

}


/* ========================================
   PAGINATION
======================================== */

function renderPage() {

    const total = filteredStudents.length;

    const totalPages =
        Math.max(1, Math.ceil(total / rowsPerPage));

    if (currentPage > totalPages) {
        currentPage = totalPages;
    }

    const startIndex = (currentPage - 1) * rowsPerPage;

    const endIndex =
        Math.min(startIndex + rowsPerPage, total);

    renderStudents(
        filteredStudents.slice(startIndex, endIndex),
        startIndex
    );

    updatePaginationUI(
        total > 0 ? startIndex + 1 : 0,
        endIndex,
        total,
        totalPages
    );

}


function updatePaginationUI(start, end, total, totalPages) {

    const info =
        document.getElementById("paginationInfo");

    info.textContent =
        total > 0
            ? `Showing ${start} to ${end} of ${total} records`
            : "Showing 0 records";

    document.getElementById("prevPageBtn").disabled =
        currentPage <= 1;

    document.getElementById("nextPageBtn").disabled =
        currentPage >= totalPages || total === 0;

    const pageNumbers =
        document.getElementById("pageNumbers");

    pageNumbers.innerHTML = "";

    if (total === 0) {
        return;
    }

    for (let i = 1; i <= totalPages; i++) {

        const btn = document.createElement("button");

        btn.type = "button";
        btn.className =
            `page-num ${i === currentPage ? "active" : ""}`;
        btn.textContent = i;

        btn.addEventListener("click", () => {
            currentPage = i;
            renderPage();
        });

        pageNumbers.appendChild(btn);

    }

}


document
    .getElementById("prevPageBtn")
    .addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage();
        }
    });

document
    .getElementById("nextPageBtn")
    .addEventListener("click", () => {
        const totalPages =
            Math.ceil(filteredStudents.length / rowsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderPage();
        }
    });

document
    .getElementById("rowsPerPageSelect")
    .addEventListener("change", (e) => {
        rowsPerPage = parseInt(e.target.value, 10) || 10;
        currentPage = 1;
        renderPage();
    });


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