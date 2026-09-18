/* ==========================================
   OJT-LOGS REPORTS
   Connected to the same Firebase project used
   by dashboard.js (project: ojt-logs-e1892).
========================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// ========================================
// FIREBASE CONFIGURATION
// ========================================

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


// ========================================
// CONSTANTS
// ========================================

const REQUIRED_HOURS_PER_STUDENT = 600;

const ASSUMED_HOURS_PER_WEEK = 20;

const ESTIMATED_HOURS_PER_DAY = 8;


// ========================================
// STATE
// ========================================

let allStudents = [];
let allWeeklyReports = [];
let attendanceIsEstimated = false;

let currentTab = "overview";

let coordinatorName = "OJT Coordinator";

const filters = {
    search: "",
    section: "all",
    company: "all",
    status: "all"
};


// ========================================
// DOM CONTENT LOADED
// ========================================

document.addEventListener("DOMContentLoaded", () => {

    onAuthStateChanged(auth, async (user) => {

        if (!user) {

            window.location.href =
                "../coordinator_login/coordinator_login.html";

            return;

        }

        try {

            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            const userData = userDoc.exists()
                ? userDoc.data()
                : {};

            updateProfileUI(userData, user);

            await loadAllData();

            populateFilterOptions();

            setGeneratedOnNow();

            renderActiveTab();

        } catch (error) {

            console.error(
                "Error initializing reports page:",
                error
            );

            showStatus(
                "Nagka-error sa pag-load ng data. Subukan muling i-refresh.",
                true
            );

        }

    });

    initTabs();
    initToolbar();
    initExportButtons();

});


// ========================================
// PROFILE UI
// ========================================

function updateProfileUI(userData, authUser) {

    const fullName =
        userData.name ||
        userData.fullName ||
        authUser.displayName ||
        "OJT Coordinator";

    const role =
        userData.role ||
        userData.position ||
        "Coordinator";

    coordinatorName = fullName;

    const userName =
        document.getElementById("userName");

    const userRole =
        document.getElementById("userRole");

    const userAvatar =
        document.getElementById("userAvatar");

    const metaCoordinator =
        document.getElementById("metaCoordinator");

    const signatureName =
        document.getElementById("signatureName");


    if (userName) {
        userName.textContent = fullName;
    }

    if (userRole) {
        userRole.textContent =
            String(role).toUpperCase();
    }

    if (metaCoordinator) {
        metaCoordinator.textContent = fullName;
    }

    if (signatureName) {
        signatureName.textContent = fullName;
    }


    document
        .querySelectorAll(".report-coordinator")
        .forEach(el => {
            el.textContent = fullName;
        });


    document
        .querySelectorAll(".report-signature-name")
        .forEach(el => {
            el.textContent = fullName;
        });


    if (userAvatar) {

        const initials = fullName
            .split(" ")
            .filter(n => n.length > 0)
            .map(n => n[0])
            .join("")
            .substring(0, 2)
            .toUpperCase();

        userAvatar.textContent =
            initials || "CO";

    }

}


// ========================================
// LOAD DATA FROM FIRESTORE
// ========================================

async function loadAllData() {

    showStatus(
        "Loading report data&hellip;",
        false
    );


    // ------------------------------------
    // STUDENTS
    // ------------------------------------

    const usersRef =
        collection(db, "users");

    const studentQuery = query(
        usersRef,
        where("role", "==", "student")
    );

    const studentsSnap =
        await getDocs(studentQuery);

    allStudents = [];


    studentsSnap.forEach(docSnap => {

        allStudents.push({
            id: docSnap.id,
            ...docSnap.data()
        });

    });


    // ------------------------------------
    // WEEKLY REPORTS
    // ------------------------------------

    try {

        const reportsRef =
            collection(db, "weekly_reports");

        const reportsSnap =
            await getDocs(reportsRef);

        allWeeklyReports = [];


        reportsSnap.forEach(docSnap => {

            const data =
                docSnap.data();

            const rawDate =
                data.submittedAt ||
                data.createdAt ||
                data.date;

            let timestamp = 0;
            let formattedDate = "N/A";


            if (rawDate) {

                const parsedDate =
                    rawDate.seconds
                        ? new Date(
                            rawDate.seconds * 1000
                        )
                        : new Date(rawDate);


                if (!isNaN(parsedDate)) {

                    timestamp =
                        parsedDate.getTime();

                    formattedDate =
                        parsedDate.toLocaleDateString(
                            "en-US",
                            {
                                month: "short",
                                day: "numeric",
                                year: "numeric"
                            }
                        );

                }

            }


            allWeeklyReports.push({

                id: docSnap.id,

                studentId:
                    data.userId ||
                    data.studentId ||
                    "",

                weekRange:
                    data.weekRange ||
                    data.week ||
                    "Week Report",

                timestamp,

                formattedDate

            });

        });


    } catch (err) {

        console.warn(
            "weekly_reports not available:",
            err
        );

        allWeeklyReports = [];

    }


    hideStatus();

}


// ========================================
// FIELD HELPERS
// ========================================

function normalizeCompanyValue(value) {

    if (!value) return "";

    const cleaned =
        String(value).trim();


    if (
        cleaned === "" ||
        cleaned.toLowerCase() === "n/a" ||
        cleaned === "-"
    ) {

        return "";

    }


    return cleaned;

}


function getName(student) {

    return (
        student.fullName ||
        student.name ||
        "Unnamed Student"
    );

}

function getStudentNumber(student) {

    return (
        student.studentNumber ||
        student.idNumber ||
        "-"
    );

}

function getSection(student) {

    return (
        student.section &&
        String(student.section).trim()
            ? String(student.section).trim()
            : "-"
    );

}


function getCompany(student) {

    return (
        normalizeCompanyValue(
            student.companyName
        ) ||

        normalizeCompanyValue(
            student.company
        ) ||

        "-"
    );

}


function getRenderedHours(student) {

    return Number(

        student.renderedHours ||

        student.completedHours ||

        student.hoursRendered ||

        0

    );

}


function getProgress(student) {

    const hours =
        getRenderedHours(student);

    return Math.max(

        0,

        Math.min(

            100,

            Math.round(
                (hours /
                    REQUIRED_HOURS_PER_STUDENT) *
                100
            )

        )

    );

}


function normalizeStatus(student) {

    const known = [

        "Completed",

        "Graduated",

        "At Risk",

        "Needs Monitoring",

        "On Track"

    ];


    const status =
        student.internshipStatus || "";


    return known.includes(status)
        ? status
        : "On Track";

}


// ========================================
// ATTENDANCE
// ========================================

function getAttendance(student) {

    if (
        student.attendance &&
        typeof student.attendance === "object"
    ) {

        const a =
            student.attendance;


        return {

            present:
                Number(
                    a.presentDays ??
                    a.present ??
                    0
                ),

            late:
                Number(
                    a.lateDays ??
                    a.late ??
                    0
                ),

            absent:
                Number(
                    a.absentDays ??
                    a.absent ??
                    0
                ),

            isEstimate: false

        };

    }


    if (

        student.presentDays !== undefined ||

        student.lateDays !== undefined ||

        student.absentDays !== undefined

    ) {

        return {

            present:
                Number(
                    student.presentDays || 0
                ),

            late:
                Number(
                    student.lateDays || 0
                ),

            absent:
                Number(
                    student.absentDays || 0
                ),

            isEstimate: false

        };

    }


    const hours =
        getRenderedHours(student);

    const present =
        Math.round(
            hours /
            ESTIMATED_HOURS_PER_DAY
        );


    return {

        present,

        late: 0,

        absent: 0,

        isEstimate: true

    };

}


function getAttendanceRate(att) {

    const total =
        att.present +
        att.late +
        att.absent;


    if (total === 0) {
        return null;
    }


    return Math.round(
        (att.present / total) * 100
    );

}


// ========================================
// RISK
// ========================================

function getRiskReason(
    student,
    attendanceRate,
    progress
) {

    if (
        attendanceRate !== null &&
        attendanceRate < 80
    ) {

        return "Low attendance";

    }


    if (progress < 50) {

        return "Insufficient hours";

    }


    return "Needs monitoring";

}


function getRecommendedAction(reason) {

    switch (reason) {

        case "Low attendance":

            return (
                "Review attendance and coordinate " +
                "with the company supervisor."
            );


        case "Insufficient hours":

            return (
                "Monitor progress and provide " +
                "additional support."
            );


        default:

            return (
                "Schedule a check-in and review " +
                "recent activity."
            );

    }

}


function statusPillClass(status) {

    switch (status) {

        case "Completed":
        case "Graduated":

            return "completed";


        case "At Risk":

            return "risk";


        case "Needs Monitoring":

            return "monitoring";


        default:

            return "ontrack";

    }

}


// ========================================
// FILTERING
// ========================================

function getFilteredStudents() {

    return allStudents.filter(student => {

        const name =
            getName(student).toLowerCase();

        const company =
            getCompany(student).toLowerCase();

        const section =
            getSection(student).toLowerCase();

        const status =
            normalizeStatus(student);


        if (filters.search) {

            const keyword =
                filters.search.toLowerCase();


            const matches =

                name.includes(keyword) ||

                company.includes(keyword) ||

                section.includes(keyword);


            if (!matches) {
                return false;
            }

        }


        if (
            filters.section !== "all" &&
            getSection(student) !==
                filters.section
        ) {

            return false;

        }


        if (
            filters.company !== "all" &&
            getCompany(student) !==
                filters.company
        ) {

            return false;

        }


        if (
            filters.status !== "all" &&
            status !== filters.status
        ) {

            return false;

        }


        return true;

    });

}


// ========================================
// FILTER OPTIONS
// ========================================

function populateFilterOptions() {

    const sectionSelect =
        document.getElementById(
            "sectionFilter"
        );

    const companySelect =
        document.getElementById(
            "companyFilter"
        );


    const sections =
        [
            ...new Set(
                allStudents.map(getSection)
            )
        ].sort();


    const companies =
        [
            ...new Set(
                allStudents.map(getCompany)
            )
        ].sort();


    if (sectionSelect) {

        sectionSelect.innerHTML =

            `<option value="all">
                All Sections
            </option>` +

            sections
                .map(
                    s =>
                        `<option value="${escapeHtml(s)}">
                            ${escapeHtml(s)}
                        </option>`
                )
                .join("");

    }


    if (companySelect) {

        companySelect.innerHTML =

            `<option value="all">
                All Companies
            </option>` +

            companies
                .map(
                    c =>
                        `<option value="${escapeHtml(c)}">
                            ${escapeHtml(c)}
                        </option>`
                )
                .join("");

    }

}


// ========================================
// TOOLBAR
// ========================================

function initToolbar() {

    const search =
        document.getElementById(
            "searchReport"
        );

    const sectionFilter =
        document.getElementById(
            "sectionFilter"
        );

    const companyFilter =
        document.getElementById(
            "companyFilter"
        );

    const statusFilter =
        document.getElementById(
            "statusFilter"
        );

    const generateBtn =
        document.getElementById(
            "generateReportBtn"
        );

    const schoolYearSelect =
        document.getElementById(
            "schoolYearSelect"
        );

    const semesterSelect =
        document.getElementById(
            "semesterSelect"
        );


    // ------------------------------------
    // SEARCH
    // ------------------------------------

    if (search) {

        search.addEventListener(
            "keyup",
            () => {

                filters.search =
                    search.value;

                renderActiveTab();

            }
        );

    }


    // ------------------------------------
    // SECTION FILTER
    // ------------------------------------

    if (sectionFilter) {

        sectionFilter.addEventListener(
            "change",
            () => {

                filters.section =
                    sectionFilter.value;

                renderActiveTab();

            }
        );

    }


    // ------------------------------------
    // COMPANY FILTER
    // ------------------------------------

    if (companyFilter) {

        companyFilter.addEventListener(
            "change",
            () => {

                filters.company =
                    companyFilter.value;

                renderActiveTab();

            }
        );

    }


    // ------------------------------------
    // STATUS FILTER
    // ------------------------------------

    if (statusFilter) {

        statusFilter.addEventListener(
            "change",
            () => {

                filters.status =
                    statusFilter.value;

                renderActiveTab();

            }
        );

    }


    // ------------------------------------
    // SCHOOL YEAR
    // ------------------------------------

    if (schoolYearSelect) {

        schoolYearSelect.addEventListener(
            "change",
            () => {

                const formattedYear =
                    schoolYearSelect.value.replace(
                        "-",
                        " \u2013 "
                    );


                const el =
                    document.getElementById(
                        "metaSchoolYear"
                    );


                if (el) {
                    el.textContent =
                        formattedYear;
                }


                document
                    .querySelectorAll(
                        ".report-school-year"
                    )
                    .forEach(item => {

                        item.textContent =
                            formattedYear;

                    });

            }
        );

    }


    // ------------------------------------
    // SEMESTER
    // ------------------------------------

    if (semesterSelect) {

        semesterSelect.addEventListener(
            "change",
            () => {

                const el =
                    document.getElementById(
                        "metaSemester"
                    );


                if (el) {
                    el.textContent =
                        semesterSelect.value;
                }


                document
                    .querySelectorAll(
                        ".report-semester"
                    )
                    .forEach(item => {

                        item.textContent =
                            semesterSelect.value;

                    });

            }
        );

    }


    // ------------------------------------
    // GENERATE REPORT
    // ------------------------------------

    if (generateBtn) {

        generateBtn.addEventListener(
            "click",
            async () => {

                generateBtn.disabled =
                    true;


                const originalHtml =
                    generateBtn.innerHTML;


                generateBtn.innerHTML =

                    `<i class="fa-solid fa-spinner fa-spin"></i>
                    Generating&hellip;`;


                try {

                    await loadAllData();

                    populateFilterOptions();

                    setGeneratedOnNow();

                    renderActiveTab();

                } catch (err) {

                    console.error(
                        "Error generating report:",
                        err
                    );

                    showStatus(
                        "Failed to generate report. Please try again.",
                        true
                    );

                } finally {

                    generateBtn.disabled =
                        false;

                    generateBtn.innerHTML =
                        originalHtml;

                }

            }
        );

    }

}


// ========================================
// GENERATED DATE
// ========================================

function setGeneratedOnNow() {

    const formatted =
        new Date().toLocaleString(
            "en-US",
            {
                month: "long",
                day: "2-digit",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit"
            }
        );


    const el =
        document.getElementById(
            "metaGeneratedOn"
        );


    if (el) {
        el.textContent =
            formatted;
    }


    document
        .querySelectorAll(
            ".report-generated-on"
        )
        .forEach(item => {

            item.textContent =
                formatted;

        });

}


// ========================================
// TABS
// ========================================

function initTabs() {

    const tabs =
        document.querySelectorAll(
            ".report-tab"
        );


    tabs.forEach(tab => {

        tab.addEventListener(
            "click",
            () => {

                tabs.forEach(t =>
                    t.classList.remove(
                        "active"
                    )
                );


                tab.classList.add(
                    "active"
                );


                document
                    .querySelectorAll(
                        ".report-panel"
                    )
                    .forEach(p => {

                        p.classList.remove(
                            "active"
                        );

                    });


                currentTab =
                    tab.dataset.tab;


                const panel =
                    document.getElementById(
                        `panel-${currentTab}`
                    );


                if (panel) {

                    panel.classList.add(
                        "active"
                    );

                }


                renderActiveTab();

            }
        );

    });

}


// ========================================
// RENDER ACTIVE TAB
// ========================================

function renderActiveTab() {

    const filtered =
        getFilteredStudents();


    const metaSection =
        document.getElementById(
            "metaSection"
        );

    const metaCompany =
        document.getElementById(
            "metaCompany"
        );


    if (metaSection) {

        metaSection.textContent =
            filters.section === "all"
                ? "All Sections"
                : filters.section;

    }


    if (metaCompany) {

        metaCompany.textContent =
            filters.company === "all"
                ? "All Companies"
                : filters.company;

    }


    document
        .querySelectorAll(
            ".report-section-filter"
        )
        .forEach(el => {

            el.textContent =
                filters.section === "all"
                    ? "All Sections"
                    : filters.section;

        });


    document
        .querySelectorAll(
            ".report-company-filter"
        )
        .forEach(el => {

            el.textContent =
                filters.company === "all"
                    ? "All Companies"
                    : filters.company;

        });


    switch (currentTab) {

        case "overview":

            renderOverview(filtered);

            break;


        case "progress":

            renderStudentProgressTab(
                filtered
            );

            break;


        case "attendance":

            renderAttendanceTab(
                filtered
            );

            break;


        case "risk":

            renderRiskTab(
                filtered
            );

            break;


        case "company":

            renderCompanyTab(
                filtered
            );

            break;

    }

}


// ========================================
// OVERVIEW REPORT
// ========================================

function renderOverview(students) {

    const total =
        students.length;


    const completed =
        students.filter(
            s =>
                [
                    "Completed",
                    "Graduated"
                ].includes(
                    normalizeStatus(s)
                )
        ).length;


    const atRisk =
        students.filter(
            s =>
                normalizeStatus(s) ===
                "At Risk"
        ).length;


    const ongoing =
        Math.max(
            0,
            total -
            completed -
            atRisk
        );


    const completionRate =
        total > 0
            ? Math.round(
                (completed / total) *
                100
            )
            : 0;


    const ongoingRate =
        total > 0
            ? Math.round(
                (ongoing / total) *
                100
            )
            : 0;


    const atRiskRate =
        total > 0
            ? Math.round(
                (atRisk / total) *
                100
            )
            : 0;


    const avgProgress =
        total > 0

            ? Math.round(

                students.reduce(
                    (sum, s) =>
                        sum +
                        getProgress(s),
                    0
                ) / total

            )

            : 0;


    const statsContainer =
        document.getElementById(
            "overviewStats"
        );


    if (statsContainer) {

        statsContainer.innerHTML = `

            <div class="stat-pill">
                <i class="fa-solid fa-users"></i>
                <h3>${total}</h3>
                <p>
                    Total Interns<br>
                    100% of deployed students
                </p>
            </div>

            <div class="stat-pill">
                <i class="fa-solid fa-circle-check"></i>
                <h3>${completed}</h3>
                <p>
                    Completed<br>
                    ${completionRate}% completion rate
                </p>
            </div>

            <div class="stat-pill">
                <i class="fa-regular fa-clock"></i>
                <h3>${ongoing}</h3>
                <p>
                    Ongoing<br>
                    ${ongoingRate}% currently active
                </p>
            </div>

            <div class="stat-pill warn">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <h3>${atRisk}</h3>
                <p>
                    At Risk<br>
                    ${atRiskRate}% needs intervention
                </p>
            </div>

            <div class="stat-pill">
                <i class="fa-solid fa-book"></i>
                <h3>
                    ${REQUIRED_HOURS_PER_STUDENT} hrs
                </h3>
                <p>
                    Required Hours<br>
                    Per student
                </p>
            </div>

            <div class="stat-pill">
                <i class="fa-solid fa-chart-line"></i>
                <h3>${avgProgress}%</h3>
                <p>
                    Average Progress<br>
                    Overall performance
                </p>
            </div>

        `;

    }


    renderAttendanceSummary(
        students
    );

    renderProgressSummary(
        students
    );

    renderAtRiskOverviewTable(
        students
    );

    renderCompanyOverviewTable(
        students
    );

}


// ========================================
// ATTENDANCE SUMMARY
// ========================================

function renderAttendanceSummary(
    students
) {

    const body =
        document.getElementById(
            "attendanceSummaryBody"
        );


    const badge =
        document.getElementById(
            "attendanceEstimateBadge"
        );


    if (!body) return;


    let present = 0;
    let late = 0;
    let absent = 0;
    let totalHours = 0;

    let isEstimate = false;


    students.forEach(s => {

        const att =
            getAttendance(s);


        present +=
            att.present;

        late +=
            att.late;

        absent +=
            att.absent;


        if (att.isEstimate) {

            isEstimate = true;

        }


        totalHours +=
            getRenderedHours(s);

    });


    attendanceIsEstimated =
        isEstimate;


    if (badge) {

        badge.style.display =
            isEstimate
                ? "inline-flex"
                : "none";

    }


    const totalDays =
        present +
        late +
        absent;


    const pct = n =>

        totalDays > 0

            ? `${Math.round(
                (n / totalDays) * 100
            )}%`

            : "-";


    body.innerHTML = `

        <tr>
            <td>Present</td>
            <td>
                ${present.toLocaleString()}
            </td>
            <td>
                ${pct(present)}
            </td>
            <td>
                ${totalHours.toLocaleString()} hrs
            </td>
        </tr>

        <tr>
            <td>Late</td>
            <td>
                ${late.toLocaleString()}
            </td>
            <td>
                ${pct(late)}
            </td>
            <td>-</td>
        </tr>

        <tr>
            <td>Absent</td>
            <td>
                ${absent.toLocaleString()}
            </td>
            <td>
                ${pct(absent)}
            </td>
            <td>-</td>
        </tr>

        <tr class="total-row">
            <td>Total</td>
            <td>
                ${totalDays.toLocaleString()}
            </td>
            <td>100%</td>
            <td>
                ${totalHours.toLocaleString()} hrs
            </td>
        </tr>

    `;

}


// ========================================
// PROGRESS SUMMARY
// ========================================

function renderProgressSummary(
    students
) {

    const body =
        document.getElementById(
            "progressSummaryBody"
        );


    if (!body) return;


    const buckets = [

        {
            label: "90% - 100%",
            min: 90,
            max: 100,
            count: 0
        },

        {
            label: "70% - 89%",
            min: 70,
            max: 89,
            count: 0
        },

        {
            label: "50% - 69%",
            min: 50,
            max: 69,
            count: 0
        },

        {
            label: "Below 50%",
            min: 0,
            max: 49,
            count: 0
        }

    ];


    students.forEach(s => {

        const progress =
            getProgress(s);


        const bucket =
            buckets.find(
                b =>
                    progress >= b.min &&
                    progress <= b.max
            );


        if (bucket) {

            bucket.count++;

        }

    });


    const total =
        students.length;


    body.innerHTML =

        buckets
            .map(
                b => `

                    <tr>

                        <td>
                            ${b.label}
                        </td>

                        <td>
                            ${b.count}
                        </td>

                        <td>
                            ${
                                total > 0
                                    ? Math.round(
                                        (b.count /
                                            total) *
                                        100
                                    )
                                    : 0
                            }%
                        </td>

                    </tr>

                `
            )
            .join("")

        +

        `

            <tr class="total-row">

                <td>Total</td>

                <td>${total}</td>

                <td>100%</td>

            </tr>

        `;

}


// ========================================
// AT-RISK OVERVIEW
// ========================================

function renderAtRiskOverviewTable(
    students
) {

    const body =
        document.getElementById(
            "atRiskOverviewBody"
        );


    if (!body) return;


    const atRiskStudents =
        students.filter(
            s =>
                normalizeStatus(s) ===
                "At Risk"
        );


    if (
        atRiskStudents.length === 0
    ) {

        body.innerHTML = `

            <tr>

                <td
                    colspan="6"
                    style="
                        text-align:center;
                        color:#999;
                    "
                >
                    No at-risk students
                    for the current filters.
                </td>

            </tr>

        `;

        return;

    }


    body.innerHTML =
        atRiskStudents
            .map((s, i) => {

                const att =
                    getAttendance(s);

                const rate =
                    getAttendanceRate(
                        att
                    );

                const progress =
                    getProgress(s);

                const reason =
                    getRiskReason(
                        s,
                        rate,
                        progress
                    );

                const action =
                    getRecommendedAction(
                        reason
                    );


                return `

                    <tr>

                        <td>
                            ${i + 1}
                        </td>

                        <td>
                            ${escapeHtml(
                                getName(s)
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                getCompany(s)
                            )}
                        </td>

                        <td>
                            ${progress}%
                        </td>

                        <td>
                            ${reason}
                        </td>

                        <td>
                            ${action}
                        </td>

                    </tr>

                `;

            })
            .join("");

}


// ========================================
// COMPANY OVERVIEW
// ========================================

function renderCompanyOverviewTable(
    students
) {

    const body =
        document.getElementById(
            "companyOverviewBody"
        );


    if (!body) return;


    const groups =
        groupByCompany(
            students
        );


    if (groups.length === 0) {

        body.innerHTML = `

            <tr>

                <td
                    colspan="6"
                    style="
                        text-align:center;
                        color:#999;
                    "
                >
                    No company data
                    for the current filters.
                </td>

            </tr>

        `;

        return;

    }


    let totalInterns = 0;
    let totalCompleted = 0;
    let totalOngoing = 0;
    let totalAtRisk = 0;


    const rows =
        groups.map((g, i) => {

            totalInterns +=
                g.total;

            totalCompleted +=
                g.completed;

            totalOngoing +=
                g.ongoing;

            totalAtRisk +=
                g.atRisk;


            return `

                <tr>

                    <td>
                        ${i + 1}
                    </td>

                    <td>
                        ${escapeHtml(
                            g.company
                        )}
                    </td>

                    <td>
                        ${g.total}
                    </td>

                    <td>
                        ${g.completed}
                    </td>

                    <td>
                        ${g.ongoing}
                    </td>

                    <td>
                        ${g.atRisk}
                    </td>

                </tr>

            `;

        }).join("");


    body.innerHTML =
        rows +

        `

            <tr class="total-row">

                <td></td>

                <td>Total</td>

                <td>
                    ${totalInterns}
                </td>

                <td>
                    ${totalCompleted}
                </td>

                <td>
                    ${totalOngoing}
                </td>

                <td>
                    ${totalAtRisk}
                </td>

            </tr>

        `;

}


// ========================================
// GROUP BY COMPANY
// ========================================

function groupByCompany(
    students
) {

    const map = {};


    students.forEach(s => {

        const company =
            getCompany(s);

        const status =
            normalizeStatus(s);


        if (!map[company]) {

            map[company] = {

                company,

                total: 0,

                completed: 0,

                ongoing: 0,

                atRisk: 0,

                progressSum: 0

            };

        }


        const entry =
            map[company];


        entry.total++;

        entry.progressSum +=
            getProgress(s);


        if (
            [
                "Completed",
                "Graduated"
            ].includes(status)
        ) {

            entry.completed++;

        }

        else if (
            status === "At Risk"
        ) {

            entry.atRisk++;

        }

        else {

            entry.ongoing++;

        }

    });


    return Object.values(map)

        .map(g => ({

            ...g,

            avgProgress:
                g.total > 0

                    ? Math.round(
                        g.progressSum /
                        g.total
                    )

                    : 0

        }))

        .sort(
            (a, b) =>
                b.total -
                a.total
        );

}


// ========================================
// ATTENDANCE TAB
// ========================================

function renderAttendanceTab(
    students
) {

    const body =
        document.getElementById(
            "attendanceTableBody"
        );


    const badge =
        document.getElementById(
            "attendanceEstimateBadge"
        );


    if (!body) return;


    if (students.length === 0) {

        body.innerHTML = `

            <tr>

                <td
                    colspan="8"
                    style="
                        text-align:center;
                        color:#999;
                    "
                >
                    No students match
                    the current filters.
                </td>

            </tr>

        `;

        return;

    }


    let isEstimate = false;


    body.innerHTML =
        students.map(s => {

            const att =
                getAttendance(s);


            if (att.isEstimate) {

                isEstimate = true;

            }


            const rate =
                getAttendanceRate(
                    att
                );


            return `

                <tr>

                    <td>
                        ${escapeHtml(
                            getName(s)
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            getSection(s)
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            getCompany(s)
                        )}
                    </td>

                    <td>
                        ${att.present}
                    </td>

                    <td>
                        ${att.late}
                    </td>

                    <td>
                        ${att.absent}
                    </td>

                    <td>
                        ${getRenderedHours(
                            s
                        ).toLocaleString()}
                        hrs
                    </td>

                    <td>
                        ${
                            rate !== null
                                ? rate + "%"
                                : "-"
                        }
                    </td>

                </tr>

            `;

        }).join("");


    if (badge) {

        badge.style.display =
            isEstimate
                ? "inline-flex"
                : "none";

    }


    const reportNote =
        document.getElementById(
            "attendanceReportNote"
        );


    if (reportNote) {

        reportNote.style.display =
            isEstimate
                ? "block"
                : "none";

    }

}


// ========================================
// AT-RISK TAB
// ========================================

function renderRiskTab(
    students
) {

    const body =
        document.getElementById(
            "riskTableBody"
        );


    if (!body) return;


    const atRiskStudents =
        students.filter(
            s =>
                normalizeStatus(s) ===
                "At Risk"
        );


    if (
        atRiskStudents.length === 0
    ) {

        body.innerHTML = `

            <tr>

                <td
                    colspan="7"
                    style="
                        text-align:center;
                        color:#999;
                    "
                >
                    No at-risk students
                    for the current filters.
                </td>

            </tr>

        `;

        return;

    }


    body.innerHTML =
        atRiskStudents
            .map(s => {

                const att =
                    getAttendance(s);

                const rate =
                    getAttendanceRate(
                        att
                    );

                const progress =
                    getProgress(s);

                const reason =
                    getRiskReason(
                        s,
                        rate,
                        progress
                    );

                const action =
                    getRecommendedAction(
                        reason
                    );


                return `

                    <tr>

                        <td>
                            ${escapeHtml(
                                getName(s)
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                getSection(s)
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                getCompany(s)
                            )}
                        </td>

                        <td>
                            ${progress}%
                        </td>

                        <td>
                            ${
                                rate !== null
                                    ? rate + "%"
                                    : "-"
                            }
                        </td>

                        <td>

                            <span
                                class="status risk"
                            >
                                ${reason}
                            </span>

                        </td>

                        <td>
                            ${action}
                        </td>

                    </tr>

                `;

            })
            .join("");

}


// ========================================
// COMPANY DEPLOYMENT TAB
// ========================================

function renderCompanyTab(
    students
) {

    const body =
        document.getElementById(
            "companyTableBody"
        );


    if (!body) return;


    const groups =
        groupByCompany(
            students
        );


    if (groups.length === 0) {

        body.innerHTML = `

            <tr>

                <td
                    colspan="6"
                    style="
                        text-align:center;
                        color:#999;
                    "
                >
                    No company data
                    for the current filters.
                </td>

            </tr>

        `;

        return;

    }


    body.innerHTML =
        groups
            .map(g => `

                <tr>

                    <td>
                        ${escapeHtml(
                            g.company
                        )}
                    </td>

                    <td>
                        ${g.total}
                    </td>

                    <td>
                        ${g.completed}
                    </td>

                    <td>
                        ${g.ongoing}
                    </td>

                    <td>
                        ${g.atRisk}
                    </td>

                    <td>
                        ${g.avgProgress}%
                    </td>

                </tr>

            `)
            .join("");

}


// ========================================
// STUDENT PROGRESS TAB
// ========================================

function renderStudentProgressTab(
    students
) {

    const body =
        document.getElementById(
            "studentProgressTableBody"
        );


    if (!body) return;


    // ------------------------------------
    // EMPTY STATE
    // ------------------------------------

    if (
        !students ||
        students.length === 0
    ) {

        body.innerHTML = `

            <tr>

                <td
                    colspan="10"
                    class="table-empty"
                >
                    No student records found
                    for the current filters.
                </td>

            </tr>

        `;

        return;

    }


    // ------------------------------------
    // SORT BY NAME
    // ------------------------------------

    const sortedStudents =
        [...students].sort(
            (a, b) =>
                getName(a).localeCompare(
                    getName(b)
                )
        );


    // ------------------------------------
    // TABLE ROWS
    // ------------------------------------

    body.innerHTML =
        sortedStudents
            .map(
                (
                    student,
                    index
                ) => {

                    const name =
                        getName(student);

                    const studentNumber =
                        getStudentNumber(
                            student
                        );

                    const section =
                        getSection(
                            student
                        );

                    const company =
                        getCompany(
                            student
                        );


                    const requiredHours =
                        REQUIRED_HOURS_PER_STUDENT;


                    const completedHours =
                        getRenderedHours(
                            student
                        );


                    const remainingHours =
                        Math.max(
                            0,
                            requiredHours -
                            completedHours
                        );


                    const progress =
                        getProgress(
                            student
                        );


                    const status =
                        normalizeStatus(
                            student
                        );


                    // ----------------------------
                    // STATUS CLASS
                    // ----------------------------

                    let statusClass =
                        "ongoing";


                    if (
                        [
                            "Completed",
                            "Graduated"
                        ].includes(
                            status
                        )
                    ) {

                        statusClass =
                            "completed";

                    }

                    else if (
                        status ===
                        "At Risk"
                    ) {

                        statusClass =
                            "risk";

                    }

                    else if (

                        status ===
                            "Needs Monitoring" ||

                        status ===
                            "Monitoring"

                    ) {

                        statusClass =
                            "monitoring";

                    }


                    // ----------------------------
                    // PROGRESS CLASS
                    // ----------------------------

                    let progressClass =
                        "low";


                    if (
                        progress >= 90
                    ) {

                        progressClass =
                            "excellent";

                    }

                    else if (
                        progress >= 70
                    ) {

                        progressClass =
                            "good";

                    }

                    else if (
                        progress >= 50
                    ) {

                        progressClass =
                            "medium";

                    }


                    return `

                        <tr>

                            <td>
                                ${index + 1}
                            </td>


                            <td>

                                <div
                                    class="progress-student-name"
                                >

                                    <strong>
                                        ${escapeHtml(
                                            name
                                        )}
                                    </strong>

                                </div>

                            </td>


                            <td>
                                ${escapeHtml(
                                    studentNumber ||
                                    "-"
                                )}
                            </td>


                            <td>
                                ${escapeHtml(
                                    section ||
                                    "-"
                                )}
                            </td>


                            <td>
                                ${escapeHtml(
                                    company ||
                                    "-"
                                )}
                            </td>


                            <td>
                                ${requiredHours.toLocaleString()}
                                hrs
                            </td>


                            <td>

                                <strong>
                                    ${completedHours.toLocaleString()}
                                    hrs
                                </strong>

                            </td>


                            <td>
                                ${remainingHours.toLocaleString()}
                                hrs
                            </td>


                            <td>

                                <div
                                    class="progress-cell"
                                >

                                    <div
                                        class="
                                            progress-value
                                            ${progressClass}
                                        "
                                    >
                                        ${progress}%
                                    </div>


                                    <div
                                        class="progress-bar"
                                    >

                                        <div
                                            class="
                                                progress-bar-fill
                                                ${progressClass}
                                            "
                                            style="
                                                width:
                                                ${Math.min(
                                                    progress,
                                                    100
                                                )}%;
                                            "
                                        ></div>

                                    </div>

                                </div>

                            </td>


                            <td>

                                <span
                                    class="
                                        progress-status
                                        ${statusClass}
                                    "
                                >
                                    ${escapeHtml(
                                        status
                                    )}
                                </span>

                            </td>

                        </tr>

                    `;

                }
            )
            .join("");

}


// ========================================
// EXPORT / PRINT
// ========================================

function initExportButtons() {

    const pdfBtn =
        document.getElementById(
            "exportPdfBtn"
        );

    const excelBtn =
        document.getElementById(
            "exportExcelBtn"
        );

    const printBtn =
        document.getElementById(
            "printReportBtn"
        );


    if (pdfBtn) {

        pdfBtn.addEventListener(
            "click",
            exportActivePanelToPdf
        );

    }


    if (excelBtn) {

        excelBtn.addEventListener(
            "click",
            exportActivePanelToExcel
        );

    }


    if (printBtn) {

        printBtn.addEventListener(
            "click",
            () => window.print()
        );

    }

}


// ========================================
// GET ACTIVE REPORT
// ========================================

function getActivePanel() {

    return document.querySelector(
        ".report-panel.active"
    );

}


// ========================================
// EXPORT PDF
// ========================================

function exportActivePanelToPdf() {

    const panel =
        getActivePanel();


    if (!panel) return;


    const target =
        panel.querySelector(
            ".printable-report"
        ) || panel;


    if (
        getComputedStyle(target)
            .display === "none"
    ) {

        alert(
            "Wala pang laman na ipi-print dito. " +
            "Pumili muna ng student o i-adjust " +
            "ang mga filter."
        );

        return;

    }


    if (
        typeof html2canvas ===
            "undefined" ||

        !window.jspdf
    ) {

        alert(
            "PDF export library failed to load. " +
            "Check your internet connection."
        );

        return;

    }


    html2canvas(
        target,
        {
            scale: 2,
            useCORS: true
        }
    )
        .then(canvas => {

            const imgData =
                canvas.toDataURL(
                    "image/png"
                );


            const { jsPDF } =
                window.jspdf;


            const pdf =
                new jsPDF(
                    "p",
                    "mm",
                    "a4"
                );


            const pageWidth =
                pdf.internal.pageSize
                    .getWidth();


            const pageHeight =
                pdf.internal.pageSize
                    .getHeight();


            const imgWidth =
                pageWidth;


            const imgHeight =
                (
                    canvas.height *
                    imgWidth
                ) /
                canvas.width;


            let heightLeft =
                imgHeight;


            let position = 0;


            pdf.addImage(

                imgData,

                "PNG",

                0,

                position,

                imgWidth,

                imgHeight

            );


            heightLeft -=
                pageHeight;


            while (
                heightLeft > 0
            ) {

                position =
                    heightLeft -
                    imgHeight;


                pdf.addPage();


                pdf.addImage(

                    imgData,

                    "PNG",

                    0,

                    position,

                    imgWidth,

                    imgHeight

                );


                heightLeft -=
                    pageHeight;

            }


            pdf.save(
                `OJT_${currentTab}_report_${Date.now()}.pdf`
            );

        })

        .catch(err => {

            console.error(
                "PDF export failed:",
                err
            );

            alert(
                "Failed to export PDF. " +
                "Please try again."
            );

        });

}


// ========================================
// EXPORT EXCEL
// ========================================

function exportActivePanelToExcel() {

    const panel =
        getActivePanel();


    if (
        !panel ||
        typeof XLSX ===
            "undefined"
    ) {

        alert(
            "Excel export library failed to load. " +
            "Check your internet connection."
        );

        return;

    }


    const tables =
        panel.querySelectorAll(
            "table"
        );


    const visibleTables =
        [
            ...tables
        ].filter(
            table =>
                getComputedStyle(
                    table.closest(
                        "[id]"
                    ) || table
                ).display !==
                "none"
        );


    if (
        visibleTables.length === 0
    ) {

        alert(
            "Walang table na makikita " +
            "para i-export dito."
        );

        return;

    }


    const wb =
        XLSX.utils.book_new();


    visibleTables.forEach(
        (table, i) => {

            const ws =
                XLSX.utils.table_to_sheet(
                    table
                );


            XLSX.utils.book_append_sheet(
                wb,
                ws,
                `Sheet${i + 1}`
            );

        }
    );


    XLSX.writeFile(
        wb,
        `OJT_${currentTab}_report_${Date.now()}.xlsx`
    );

}


// ========================================
// UTILITIES
// ========================================

function setText(
    id,
    value
) {

    const el =
        document.getElementById(
            id
        );


    if (el) {

        el.textContent =
            value;

    }

}


function escapeHtml(str) {

    return String(str)

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        );

}


function showStatus(
    message,
    isError
) {

    const el =
        document.getElementById(
            "reportStatus"
        );


    if (!el) return;


    el.style.display =
        "block";


    el.className =
        isError
            ? "report-status error"
            : "report-status";


    el.innerHTML =
        `<p>${message}</p>`;

}


function hideStatus() {

    const el =
        document.getElementById(
            "reportStatus"
        );


    if (el) {

        el.style.display =
            "none";

    }

}