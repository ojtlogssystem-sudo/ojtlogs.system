/* ==========================================
   OJT-LOGS REPORTS
   Connected to the same Firebase project used
   by dashboard.js (project: ojt-logs-e1892).
========================================== */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

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

// Reuse ang app kung na-initialize na ng shared header (header.js)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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
let reportDataLoaded = false;

let currentTab = "progress";

let coordinatorName = "OJT Coordinator";

const filters = {
    search: "",
    batch: "all",
    section: "all",
    company: "all",
    status: "all",
    internCount: "all",
    deployment: "all"
};


// ========================================
// SCHOOL YEAR (mula sa shared header)
// ========================================
// Ang header.js ang may hawak ng aktwal na <select> (opt-in via
// data-school-year sa reports.html). Dalawang event ang ipinapadala
// nito sa document:
//   "header:ready"            -> paglo-load ng header
//                                 (detail.schoolYear = {value, label})
//   "header:schoolyearchange" -> tuwing magpalit ng school year
//                                 (detail = {value, label})
// Dito lang natin ina-apply ang napiling school year sa laman ng
// mismong report (ang meta info + signature block).

function applySchoolYearToReport(schoolYear) {

    if (!schoolYear || !schoolYear.label) return;

    // Ang napiling School Year (Academic Year) ang batch, kapareho ng
    // Batch Archive: "2024 - 2025" -> AY 2024-2025.
    // Lalabas lang ang mga estudyanteng ang OJT ay sa academic year
    // na iyon. Ang taon sa student number ay taon ng pagpasok, kaya
    // ang student number na 2021-... ay nasa AY 2024-2025
    // (2021 + 3 = 2024). Tingnan ang getBatch().
    const yearMatch =
        String(schoolYear.label).match(/(?:19|20)\d{2}/) ||
        String(schoolYear.value || "").match(/(?:19|20)\d{2}/);

    const newBatch = yearMatch ? yearMatch[0] : "all";

    const batchChanged = newBatch !== filters.batch;

    filters.batch = newBatch;

    if (batchChanged && reportDataLoaded) {
        populateFilterOptions();
        renderActiveTab();
    }

    const el =
        document.getElementById("metaSchoolYear");

    if (el) {
        el.textContent = schoolYear.label;
    }

    document
        .querySelectorAll(".report-school-year")
        .forEach(item => {
            item.textContent = schoolYear.label;
        });

}

document.addEventListener("header:ready", (e) => {
    applySchoolYearToReport(e.detail?.schoolYear);
});

document.addEventListener("header:schoolyearchange", (e) => {
    applySchoolYearToReport(e.detail);
});


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

    coordinatorName = fullName;

    // Note: hindi na dito pinipinta ang #userName/#userRole/#userAvatar
    // (yaon ay sa loob ng shared header) - ginagawa na 'yon ng sarili
    // niyang listener ng header.js. Dito, i-fill lang ang mga
    // pangalan na lumalabas sa laman ng report mismo (meta info +
    // signature).

    const metaCoordinator =
        document.getElementById("metaCoordinator");

    const signatureName =
        document.getElementById("signatureName");


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

        const data = docSnap.data();

        // Hindi isinasama ang mga WALANG PANG ACCESS sa system
        // (pending approval / na-invite pa lang ni coordinator).
        if (isPendingStudent(data)) {
            return;
        }

        // Hindi rin isinasama ang mga COMPLETED na (tapos na ang 600
        // hours / graduated / nasa Batch Archive).
        if (isCompletedStudent(data)) {
            return;
        }

        allStudents.push({
            id: docSnap.id,
            ...data
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


    reportDataLoaded = true;

    hideStatus();

}


// ========================================
// PENDING / NO-ACCESS STUDENTS
// (kapareho ng logic sa app.py -> _is_pending_student)
// ========================================

const PENDING_STATUS_VALUES = [
    "pending", "pending approval", "for approval", "awaiting approval",
    "unverified", "not approved",
    "invited", "invite sent", "invite pending", "pending invite",
    "pending invitation", "invitation sent", "awaiting registration",
    "unregistered", "not registered", "not activated",
    "disabled", "deactivated", "suspended", "revoked"
];

const PENDING_STATUS_FIELDS = [
    "status", "accountStatus", "approvalStatus", "registrationStatus",
    "inviteStatus", "invitationStatus", "accessStatus"
];

const ACCESS_FLAG_FIELDS = [
    "approved", "isApproved", "hasAccess", "accessGranted",
    "activated", "isActivated", "registered", "isRegistered",
    "inviteAccepted", "invitationAccepted"
];

function isPendingStudent(data) {

    if (data.pending === true || data.isPending === true) {
        return true;
    }

    if (ACCESS_FLAG_FIELDS.some(field => data[field] === false)) {
        return true;
    }

    return PENDING_STATUS_FIELDS.some(field =>
        PENDING_STATUS_VALUES.includes(
            String(data[field] || "").trim().toLowerCase()
        )
    );

}


// ========================================
// COMPLETED / ARCHIVED STUDENTS
// ========================================

function isCompletedStudent(data) {

    if (
        data.archived === true ||
        data.isArchived === true ||
        data.archivedAt ||
        data.archivedDate ||
        data.graduated === true ||
        data.isGraduated === true
    ) {
        return true;
    }

    const status =
        String(data.internshipStatus || data.status || "")
            .trim()
            .toLowerCase();

    if (
        status === "completed" ||
        status.includes("graduated") ||
        status.includes("archiv")
    ) {
        return true;
    }

    const hours = Number(
        data.renderedHours ||
        data.completedHours ||
        data.hoursRendered ||
        0
    );

    return hours >= REQUIRED_HOURS_PER_STUDENT;

}


// ========================================
// BATCH = ACADEMIC YEAR (kapareho ng Batch Archive)
// Ang taon sa umpisa ng student ID ay taon ng pagpasok.
// Sa 4-year course, ang OJT / pagtatapos ay sa ika-4 na taon:
//
//   2021-01-09980 -> AY 2024-2025  (ibabalik: "2024")
//   2022-01-11872 -> AY 2025-2026  (ibabalik: "2025")
//   2023-07-01081 -> AY 2026-2027  (ibabalik: "2026")
//
// Ibinabalik ay ang unang taon ng academic year, para tumugma sa
// napiling School Year sa header ("2024 - 2025" -> "2024").
// Kung walang taon sa ID, gagamitin ang batch / school year field
// ng student.
// ========================================

// Dapat pareho sa COURSE_YEARS sa completed-batch-archive.js
const COURSE_YEARS = 4;

const STUDENT_ID_FIELDS = [
    "studentId", "studentID", "studentNumber", "idNumber",
    "schoolId", "studentNo", "id_number"
];

const BATCH_FIELDS = [
    "batch", "batchYear", "batch_year",
    "schoolYear", "school_year",
    "academicYear", "academic_year", "sy"
];

function getBatch(student) {

    for (const field of STUDENT_ID_FIELDS) {

        const value = student[field];

        if (value === undefined || value === null || value === "") continue;

        const match =
            String(value).match(/^\s*((?:19|20)\d{2})\s*[-/\s]\s*\d/);

        if (match) return String(Number(match[1]) + COURSE_YEARS - 1);

        break;   // unang student ID lang ang titingnan

    }

    for (const field of BATCH_FIELDS) {

        const value = student[field];

        if (value !== undefined && value !== null && String(value).trim() !== "") {

            // Academic year na ang naka-save (hal. "2024-2025"):
            // unang taon ang gamitin para tumugma sa filter.
            const year = String(value).match(/(?:19|20)\d{2}/);

            return year ? year[0] : String(value).trim();

        }

    }

    return "-";

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

    for (const field of STUDENT_ID_FIELDS) {

        if (student[field] !== undefined && student[field] !== null && student[field] !== "") {
            return student[field];
        }

    }

    return "-";

}

// Ang section ay numero/letra lang (hal. "405"), kaya tinatanggal
// ang course prefix kung nakasama (hal. "BSIT 405" -> "405").
function getSection(student) {

    const raw =
        student.section
            ? String(student.section).trim()
            : "";

    if (!raw) return "-";

    const match =
        raw.match(/^[A-Za-z][A-Za-z.]*[\s-]+(\d.*)$/);

    return match ? match[1].trim() : raw;

}

// Course lang ang ilalagay (hal. "BSIT"). Kung walang course field,
// kukunin sa unahan ng section (hal. "BSIT 405" -> "BSIT").
function getCourse(student) {

    const course =
        student.course
            ? String(student.course).trim()
            : "";

    if (course) return course;

    const raw =
        student.section
            ? String(student.section).trim()
            : "";

    const match =
        raw.match(/^([A-Za-z][A-Za-z.]*)[\s-]+\d/);

    return match ? match[1].toUpperCase() : "-";

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


// ----------------------------------------
// PERCENT HELPERS
// ----------------------------------------
// Floor (hindi round) sa 1 decimal para hindi tumaas ang
// percentage nang hindi pa totoong umaabot. Halimbawa 599/600 =
// 99.83% -> 99.8% (hindi 100%). Ang maliit na epsilon ay para
// hindi magkamali dahil sa floating-point (hal. 83.3 na naging
// 83.29999...).
function roundToOneDecimal(value) {
    return Math.round((value + 1e-9) * 10) / 10;
}


function floorToOneDecimal(value) {

    return Math.floor((value + 1e-9) * 10) / 10;

}

// Oras na may hanggang 2 decimal lang (tinatanggal ang sobra, hindi nire-round).
// Halimbawa: 8.017 -> 8.01, 591.983 -> 591.98
function formatHours(value) {
    const truncated =
        Math.floor((Number(value) + 1e-9) * 100) / 100;

    return truncated.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 }
    );
}


function formatPercent(value) {

    return Number(value.toFixed(1)) + "%";

}


function getRenderedHours(student) {

    const raw =
        student.renderedHours ||
        student.completedHours ||
        student.hoursRendered ||
        0;

    const hours = Number(raw);

    // Iwas NaN / negative na oras
    return Number.isFinite(hours)
        ? Math.max(0, hours)
        : 0;

}


// Eksaktong progress (walang rounding) - ito ang gagamitin sa
// pag-average para hindi mag-ipon ang rounding error.
function getProgressExact(student) {

    const hours =
        getRenderedHours(student);

    return Math.max(
        0,
        Math.min(
            100,
            (hours * 100) /
            REQUIRED_HOURS_PER_STUDENT
        )
    );

}


// Progress na ipinapakita sa table (1 decimal, naka-floor).
// Lalabas lang ang 100% kapag talagang kumpleto na ang oras.
function getProgress(student) {

    const hours =
        getRenderedHours(student);

    if (hours >= REQUIRED_HOURS_PER_STUDENT) {
        return 100;
    }

    // Normal rounding sa 1 decimal (28/600 = 4.666... -> 4.7%).
    // Hindi lalampas sa 99.9% hangga't hindi kumpleto ang oras.
    return Math.min(
        99.9,
        roundToOneDecimal(
            getProgressExact(student)
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

    // Ang estimate (hours / 8) ay walang absent kaya laging 100%
    // ang lalabas - hindi totoong rate 'yon, kaya "-" ang ipapakita.
    if (att.isEstimate) {
        return null;
    }


    const total =
        att.present +
        att.late +
        att.absent;


    if (total === 0) {
        return null;
    }


    // Pumasok pa rin ang late, kaya kasama sa attended.
    return floorToOneDecimal(
        ((att.present + att.late) / total) * 100
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

    // Sa Company Deployment tab, company lang ang may saysay:
    // hindi ginagamit ang section at status filter dito.
    const isCompanyTab =
        currentTab === "company";

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


            const course =
                getCourse(student).toLowerCase();

            const matches =

                isCompanyTab
                    ? company.includes(keyword)
                    : (
                name.includes(keyword) ||

                company.includes(keyword) ||

                section.includes(keyword) ||

                course.includes(keyword) ||

                `${course} ${section}`.includes(keyword)
                    );


            if (!matches) {
                return false;
            }

        }


        if (
            filters.batch !== "all" &&
            getBatch(student) !==
                filters.batch
        ) {

            return false;

        }


        if (
            !isCompanyTab &&
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
            !isCompanyTab &&
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


    // Ang mga option ay galing lang sa mga estudyante ng napiling
    // school year (batch).
    const pool =
        allStudents.filter(student =>
            filters.batch === "all" ||
            getBatch(student) === filters.batch
        );


    const sections =
        [
            ...new Set(
                pool.map(getSection)
            )
        ].sort();


    const companies =
        [
            ...new Set(
                pool.map(getCompany)
            )
        ].sort();


    // Kung wala na sa listahan ang napiling section/company, ibalik sa "all"
    if (filters.section !== "all" && !sections.includes(filters.section)) {
        filters.section = "all";
    }

    if (filters.company !== "all" && !companies.includes(filters.company)) {
        filters.company = "all";
    }


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

        sectionSelect.value = filters.section;

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

        companySelect.value = filters.company;

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
    // INTERN COUNT / DEPLOYMENT (Company tab lang)
    // ------------------------------------
    const internCountFilter =
        document.getElementById("internCountFilter");

    if (internCountFilter) {
        internCountFilter.addEventListener("change", () => {
            filters.internCount = internCountFilter.value;
            renderActiveTab();
        });
    }

    const deploymentFilter =
        document.getElementById("deploymentFilter");

    if (deploymentFilter) {
        deploymentFilter.addEventListener("change", () => {
            filters.deployment = deploymentFilter.value;
            renderActiveTab();
        });
    }


    // ------------------------------------
    // SCHOOL YEAR
    // ------------------------------------
    // Ang school year selector ay nasa loob na ng shared header
    // (data-school-year sa reports.html) - hindi na ito local na
    // element dito, kaya dito na lang tayo makikinig sa mga event
    // na ipinapadala ng header.js (see applySchoolYearToReport
    // sa ibaba ng file).


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

function updateToolbarForTab() {

    const isCompany =
        currentTab === "company";

    const show = (id, visible) => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display =
                visible ? "" : "none";
        }
    };

    show("sectionFilter", !isCompany);
    show("statusFilter", !isCompany);
    show("internCountFilter", isCompany);
    show("deploymentFilter", isCompany);

    const search =
        document.getElementById("searchReport");

    if (search) {
        search.placeholder = isCompany
            ? "Search company..."
            : "Search students, company or section...";
    }

}


function renderActiveTab() {

    updateToolbarForTab();

const filtered =
        getFilteredStudents();


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


        case "company":

            renderCompanyTab(
                filtered
            );

            break;

    }

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
            getProgressExact(s);


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

                    ? roundToOneDecimal(
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


            return `

                <tr>

                    <td>
                        ${escapeHtml(
                            getName(s)
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            getCourse(s)
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
                        ${formatHours(getRenderedHours(s))}
                        hrs
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
        ).filter(g => {

            if (filters.internCount === "1" && g.total !== 1) return false;
            if (filters.internCount === "2-5" && (g.total < 2 || g.total > 5)) return false;
            if (filters.internCount === "6+" && g.total < 6) return false;

            if (filters.deployment === "completed" && g.completed === 0) return false;
            if (filters.deployment === "ongoing" && g.ongoing === 0) return false;

            return true;

        });


    document
        .querySelectorAll(".report-total-companies")
        .forEach(el => {
            el.textContent = groups.length;
        });

    document
        .querySelectorAll(".report-total-interns")
        .forEach(el => {
            el.textContent = groups.reduce(
                (sum, g) => sum + g.total,
                0
            );
        });



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
                        ${formatPercent(g.avgProgress)}
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
                    colspan="11"
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

                    const course =
                        getCourse(
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
                                    course ||
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
                                    ${formatHours(completedHours)}
                                    hrs
                                </strong>

                            </td>


                            <td>
                                ${formatHours(remainingHours)}
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
                                        ${formatPercent(progress)}
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