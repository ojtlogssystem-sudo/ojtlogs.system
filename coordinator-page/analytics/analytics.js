/* ==========================================
   OJT-LOGS ANALYTICS & AI TASK/ATTENDANCE SKILL EXPOSURE
========================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import {
    getFirestore,
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";


// ==========================================
// FIREBASE CONFIGURATION
// ==========================================

const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38",
    measurementId: "G-DJ3JW7QH27"
};


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const usersRef = collection(db, "users");


// ==========================================
// AI STATUS CHARTS (BAR + PIE)
// gamit ang Chart.js (idinagdag sa HTML)
// ==========================================

let riskStatusPieChartInstance = null;

function renderRiskStatusCharts(atRiskCount, monitoringCount, onTrackCount) {

    if (typeof Chart === "undefined") {
        // Hindi pa na-load ang Chart.js library
        console.error(
            "Chart.js library failed to load - check internet connection or CDN block."
        );

        ["riskStatusPieChart"].forEach((canvasId) => {

            const canvasEl =
                document.getElementById(canvasId);

            if (canvasEl && canvasEl.parentElement) {

                canvasEl.parentElement.innerHTML = `
                    <div style="padding:20px;text-align:center;color:#dc2626;font-size:12px;">
                        Hindi na-load ang Chart.js library.<br>
                        Check ang internet connection o kung na-block
                        ng adblocker/firewall ang cdn.jsdelivr.net.
                    </div>
                `;

            }

        });

        return;
    }

    const labels = [
        "At Risk",
        "Needs Monitoring",
        "On Track"
    ];

    const dataValues = [
        atRiskCount,
        monitoringCount,
        onTrackCount
    ];

    const colors = [
        "#dc2626", // pula - At Risk
        "#f19c14", // orange - Needs Monitoring
        "#27ae60"  // berde - On Track
    ];


    // ----------- PIE CHART -----------

    const pieCanvas =
        document.getElementById("riskStatusPieChart");

    if (pieCanvas) {

        if (riskStatusPieChartInstance) {
            riskStatusPieChartInstance.destroy();
        }

        riskStatusPieChartInstance = new Chart(pieCanvas, {
            type: "pie",
            data: {
                labels: labels,
                datasets: [{
                    data: dataValues,
                    backgroundColor: colors,
                    borderColor: "#ffffff",
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { boxWidth: 12, font: { size: 12 } }
                    }
                }
            }
        });

    }

}


// ==========================================
// GRADUATED STUDENTS PER BATCH (BAR CHART)
// gamit ang Chart.js
//
// I-edit lang ang GRADUATES_PER_BATCH object sa ibaba
// kapag may bagong batch o na-update na bilang ng
// nakapagtapos na estudyante.
// ==========================================

let graduatesByBatchChartInstance = null;

const GRADUATES_PER_BATCH = {
    "2023-2024": 20,
    "2024-2025": 50,
    "2025-2026": 30
};

function renderGraduatesByBatchChart(batchData = GRADUATES_PER_BATCH) {

    if (typeof Chart === "undefined") {
        console.error(
            "Chart.js library failed to load - check internet connection or CDN block."
        );

        const canvasEl =
            document.getElementById("graduatesByBatchChart");

        if (canvasEl && canvasEl.parentElement) {
            canvasEl.parentElement.innerHTML = `
                <div style="padding:20px;text-align:center;color:#dc2626;font-size:12px;">
                    Hindi na-load ang Chart.js library.<br>
                    Check ang internet connection o kung na-block
                    ng adblocker/firewall ang cdn.jsdelivr.net.
                </div>
            `;
        }

        return;
    }

    const labels = Object.keys(batchData);
    const dataValues = Object.values(batchData);

    const barCanvas =
        document.getElementById("graduatesByBatchChart");

    if (!barCanvas) return;

    if (graduatesByBatchChartInstance) {
        graduatesByBatchChartInstance.destroy();
    }

    graduatesByBatchChartInstance = new Chart(barCanvas, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [{
                label: "Graduated Students",
                data: dataValues,
                backgroundColor: "#2563eb",
                borderRadius: 6,
                maxBarThickness: 90
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) =>
                            ` ${ctx.parsed.y} graduated students`
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: "Batch (School Year)"
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    title: {
                        display: true,
                        text: "Number of Graduates"
                    }
                }
            }
        }
    });

}


// ==========================================
// GLOBAL DATA
// ==========================================

let globalStudentRecords = [];
let globalCompanyExposureData = [];


// ==========================================
// SAMPLE / DEMO DATA - "AT RISK" & "NEEDS MONITORING"
//
// Idinagdag lang para may laman muna ang
// "At Risk" at "Needs Monitoring" sa pie chart,
// summary cards, at student table habang wala
// pang totoong estudyanteng na-flag ng backend
// (bago pa lang ang batch / lahat "On Track" pa).
//
// PAANO TANGGALIN ANG SAMPLE DATA PAG MAY REAL DATA NA:
//   1) I-set ang ENABLE_SAMPLE_RISK_DATA = false, o
//   2) Burahin na lang itong buong block pati na
//      ang linyang nag-a-apply nito sa fetchAllStudents().
// ==========================================

const ENABLE_SAMPLE_RISK_DATA = true;

const SAMPLE_RISK_MONITORING_RECORDS = [
    {
        id: "sample-risk-1",
        name: "Jhoana Reyes (Sample)",
        studentId: "SAMPLE-001",
        course: "BSIT",
        section: "403",
        company: "TechNova Solutions",
        progress: 42,
        currentHours: 252,
        targetHours: 600,
        deadline: "2026-12-31",
        absentCount: 6,
        aiStatus: "At Risk",
        riskReason: "Scikit-learn: 6 absences have been recorded — the trainee has been absent from duty too frequently and requires immediate action from the coordinator."
    },

    {
        id: "sample-risk-2",
        name: "Marco Villanueva (Sample)",
        studentId: "SAMPLE-002",
        course: "BSIT",
        section: "403",
        company: "NetLink Systems",
        progress: 30,
        currentHours: 180,
        targetHours: 600,
        deadline: "2026-12-15",
        absentCount: 3,
        aiStatus: "At Risk",
        riskReason: "Scikit-learn: At the current progress rate, the trainee is predicted to complete only 410 out of 600 hours before the deadline."
    },
    {
        id: "sample-monitor-1",
        name: "Andrea Santos (Sample)",
        studentId: "SAMPLE-003",
        course: "BSIT",
        section: "404",
        company: "ByteWorks Inc.",
        progress: 55,
        currentHours: 330,
        targetHours: 600,
        deadline: "2026-12-31",
        absentCount: 2,
        aiStatus: "Needs Monitoring",
        riskReason: "Scikit-learn: The student has 2 recorded absences from duty — this is still relatively low, but attendance should be monitored."
    },
    {
        id: "sample-monitor-2",
        name: "Karl Mendoza (Sample)",
        studentId: "SAMPLE-004",
        course: "BSIT",
        section: "404",
        company: "CloudPeak Hosting",
        progress: 60,
        currentHours: 360,
        targetHours: 600,
        deadline: "2026-11-30",
        absentCount: 1,
        aiStatus: "Needs Monitoring",
        riskReason: "Scikit-learn: Close to the target, but still needs monitoring — predicted to reach 540 out of 600 hours before the deadline."
    }
];


// ==========================================
// DOM CONTENT LOADED
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    const studentTable =
        document.getElementById("studentTable");

    renderGraduatesByBatchChart();

    if (!studentTable) return;


    const searchInput =
        document.getElementById("searchStudent");

    const sectionFilter =
        document.getElementById("sectionFilter");

    const progressFilter =
        document.getElementById("progressFilter");

    const paginationInfo =
        document.getElementById("paginationInfo");


    // ==========================================
    // SYNC USER PROFILE
    // ==========================================

    function syncUserProfile() {

        const profileNameEl =
            document.getElementById("profileName");

        const profileAvatarEl =
            document.getElementById("profileAvatar");

        const profileRoleEl =
            document.getElementById("profileRole");


        onAuthStateChanged(auth, async (user) => {

            if (user) {

                try {

                    const querySnapshot =
                        await getDocs(usersRef);

                    let foundUser = null;


                    querySnapshot.forEach(docSnap => {

                        const data =
                            docSnap.data();


                        if (
                            data.email === user.email ||
                            docSnap.id === user.uid
                        ) {

                            foundUser = data;

                        }

                    });


                    const displayName =
                        foundUser?.name ||
                        foundUser?.fullName ||
                        user.displayName ||
                        user.email ||
                        "Coordinator";


                    const displayRole =
                        foundUser?.role ||
                        foundUser?.userType ||
                        "OJT Coordinator";


                    if (profileNameEl) {

                        profileNameEl.textContent =
                            displayName;

                    }


                    if (profileRoleEl) {

                        profileRoleEl.textContent =
                            displayRole;

                    }


                    if (profileAvatarEl) {

                        const initials =
                            displayName
                                .split(" ")
                                .map(n => n[0])
                                .join("")
                                .toUpperCase()
                                .substring(0, 2);


                        profileAvatarEl.textContent =
                            initials || "MS";

                    }


                } catch (err) {

                    console.error(
                        "Error fetching user profile from Firestore:",
                        err
                    );

                }


            } else {

                const localUser =
                    JSON.parse(
                        localStorage.getItem(
                            "loggedInUser"
                        )
                    ) ||
                    JSON.parse(
                        sessionStorage.getItem(
                            "loggedInUser"
                        )
                    );


                if (localUser) {

                    const name =
                        localUser.name ||
                        localUser.email ||
                        "Coordinator";


                    if (profileNameEl) {

                        profileNameEl.textContent =
                            name;

                    }


                    if (profileAvatarEl) {

                        profileAvatarEl.textContent =
                            name
                                .split(" ")
                                .map(n => n[0])
                                .join("")
                                .toUpperCase()
                                .substring(0, 2);

                    }

                }

            }

        });

    }


    // ==========================================
    // FETCH ALL STUDENTS
    // EXISTING BACKEND - UNCHANGED
    // ==========================================

    async function fetchAllStudents() {

        try {

            const response =
                await fetch(
                    "http://localhost:5000/api/predict-risk"
                );


            const result =
                await response.json();


            if (
                result.status !== "success"
            ) {

                console.error(
                    "predict-risk returned an error:",
                    result.message || result
                );

                const riskContainer =
                    document.getElementById(
                        "riskStudentsContainer"
                    );

                if (riskContainer) {

                    riskContainer.innerHTML = `
                        <div style="padding:20px;text-align:center;color:#dc2626;">
                            AI Server Error: ${
                                (result.message || "Unknown error")
                                    .toString()
                                    .replace(/</g, "&lt;")
                            }
                        </div>
                    `;

                }

                return;

            }


            // KEEP ALL EXISTING BACKEND DATA
            globalStudentRecords =
                result.data;


            // I-DAGDAG ANG SAMPLE "AT RISK" / "NEEDS
            // MONITORING" RECORDS (kung naka-ON ang
            // ENABLE_SAMPLE_RISK_DATA sa itaas) para
            // may makita agad sa pie chart, summary
            // cards, at table habang wala pang totoong
            // estudyanteng na-flag ng AI backend.
            if (ENABLE_SAMPLE_RISK_DATA) {

                globalStudentRecords =
                    globalStudentRecords.concat(
                        SAMPLE_RISK_MONITORING_RECORDS
                    );

            }


            let atRiskCount = 0;
            let monitoringCount = 0;
            let onTrackCount = 0;

            let totalCompletedHours = 0;


            globalStudentRecords.forEach(item => {

                const category =
                    getStudentStatusCategory(item);


                if (
                    category === "risk"
                ) {

                    atRiskCount++;

                } else if (
                    category === "monitoring"
                ) {

                    monitoringCount++;

                } else {

                    onTrackCount++;

                }


                totalCompletedHours +=
                    Number(item.progress) || 0;

            });


            const totalStudents =
                globalStudentRecords.length;


            const avgProgress =
                totalStudents > 0
                    ? Math.round(
                        totalCompletedHours /
                        totalStudents
                    )
                    : 0;


            // ==========================================
            // EXISTING SUMMARY CARDS
            // ==========================================

            const summaryCards =
                document.querySelectorAll(
                    ".summary-card h3"
                );


            if (
                summaryCards.length >= 4
            ) {

                summaryCards[0].textContent =
                    totalStudents;


                summaryCards[1].textContent =
                    avgProgress + "%";


                summaryCards[2].textContent =
                    atRiskCount;


                summaryCards[3].textContent =
                    onTrackCount;

            }


            // ==========================================
            // I-UPDATE ANG BAR AT PIE CHART
            // ==========================================

            renderRiskStatusCharts(
                atRiskCount,
                monitoringCount,
                onTrackCount
            );


            // ==========================================
            // AI STATUS CARD COUNTS
            // ==========================================

            const atRiskDisplay =
                document.getElementById(
                    "atRiskCountDisplay"
                );


            if (atRiskDisplay) {

                atRiskDisplay.textContent =
                    atRiskCount;

            }


            const monitoringDisplay =
                document.getElementById(
                    "monitoringCountDisplay"
                );


            if (monitoringDisplay) {

                monitoringDisplay.textContent =
                    monitoringCount;

            }


            const onTrackDisplay =
                document.getElementById(
                    "onTrackCountDisplay"
                );


            if (onTrackDisplay) {

                onTrackDisplay.textContent =
                    onTrackCount;

            }


            // ==========================================
            // EXISTING STUDENT TABLE
            // ==========================================

            filterAndRenderTable();


            // ==========================================
            // DEFAULT:
            // SHOW AT RISK RECORDS
            // ==========================================

            renderStatusStudents(
                globalStudentRecords,
                "risk"
            );


            setActiveStatusCard(
                "risk"
            );


            // ==========================================
            // EXISTING COMPANY AI
            // ==========================================

            fetchCompanySkillExposureAI();


        } catch (error) {

            console.error(
                "Error connecting to Python AI Server:",
                error
            );


            const riskContainer =
                document.getElementById(
                    "riskStudentsContainer"
                );

            if (riskContainer) {

                riskContainer.innerHTML = `
                    <div style="padding:20px;text-align:center;color:#dc2626;">
                        Hindi maabot ang AI Server (Flask, port 5000).<br>
                        <small>${
                            (error && error.message ? error.message : String(error))
                                .toString()
                                .replace(/</g, "&lt;")
                        }</small><br><br>
                        <small style="color:#777;">
                            I-check: (1) tumatakbo ba ang <code>python app.py</code>,
                            (2) puro <code>http://localhost:5000</code> ba binuksan
                            ang page na ito (hindi https), (3) walang firewall/adblocker
                            na humaharang sa localhost:5000.
                        </small>
                    </div>
                `;

            }


            fetchCompanySkillExposureAI();

        }

    }


    // ==========================================
    // COMPANY SKILL EXPOSURE AI
    // EXISTING BACKEND - UNCHANGED
    // ==========================================

    async function fetchCompanySkillExposureAI() {

        const tableBody =
            document.getElementById(
                "companySkillTableBody"
            );


        if (!tableBody) return;


        try {

            const response =
                await fetch(
                    "http://localhost:5000/api/company-skill-exposure",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        }
                    }
                );


            const result =
                await response.json();


            if (
                result.status !== "success"
            ) {

                tableBody.innerHTML = `
                    <tr>
                        <td
                            colspan="5"
                            style="
                                text-align:center;
                                color:#ff6b6b;
                                padding:30px;
                            "
                        >
                            Error from Python AI Server.
                        </td>
                    </tr>
                `;

                return;

            }


            globalCompanyExposureData =
                result.data;


            if (
                globalCompanyExposureData.length === 0
            ) {

                tableBody.innerHTML = `
                    <tr>
                        <td
                            colspan="5"
                            style="
                                text-align:center;
                                color:#777;
                                padding:30px;
                            "
                        >
                            No companies found.
                        </td>
                    </tr>
                `;

                return;

            }


            tableBody.innerHTML =
                globalCompanyExposureData
                    .map(item => `

                        <tr>

                            <td>
                                <strong>
                                    ${item.companyName}
                                </strong>
                            </td>


                            <td>
                                <span
                                    class="skill-tag ${item.skillKey}"
                                >
                                    ${item.primarySkill}
                                </span>
                            </td>


                            <td>

                                <div
                                    class="company-progress"
                                >

                                    <div
                                        class="company-progress-bar"
                                    >

                                        <div
                                            class="company-progress-fill ${item.skillKey}-fill"
                                            style="
                                                width:${item.exposure}%;
                                            "
                                        ></div>

                                    </div>

                                    <span>
                                        ${item.exposure}%
                                    </span>

                                </div>

                            </td>


                            <td>
                                ${item.commonTasks}
                            </td>


                            <td>

                                <button
                                    class="company-view-btn"
                                    onclick="
                                        window.viewCompanySkillModal(
                                            '${item.companyName}'
                                        )
                                    "
                                >

                                    <i
                                        class="fa-solid fa-eye"
                                    ></i>

                                    View

                                </button>

                            </td>

                        </tr>

                    `)
                    .join("");


        } catch (error) {

            console.error(
                "Error fetching Python AI company exposure:",
                error
            );


            tableBody.innerHTML = `
                <tr>
                    <td
                        colspan="5"
                        style="
                            text-align:center;
                            color:#ff6b6b;
                            padding:30px;
                        "
                    >
                        Server connection failed.
                    </td>
                </tr>
            `;

        }

    }


    // ==========================================
    // STATUS CLASSIFICATION
    //
    // IMPORTANT:
    // This DOES NOT create new backend data.
    // It only reads the existing aiStatus.
    // ==========================================

    function getStudentStatusCategory(item) {

        const status =
            (item.aiStatus || "")
                .toLowerCase()
                .trim();


        // ==========================================
        // AT RISK
        // ==========================================

        if (
            status.includes("risk")
        ) {

            return "risk";

        }


        // ==========================================
        // NEEDS MONITORING
        // ==========================================

        if (
            status.includes("monitor") ||
            status.includes("watch") ||
            status.includes("needs attention") ||
            status.includes("need attention")
        ) {

            return "monitoring";

        }


        // ==========================================
        // ON TRACK
        // ==========================================

        return "ontrack";

    }


    // ==========================================
    // STATUS CARD CONFIG
    // ==========================================

    function getStatusConfig(category) {

        if (
            category === "risk"
        ) {

            return {

                title:
                    "Students Requiring Attention",

                empty:
                    "No students currently flagged as At Risk.",

                badge:
                    "At Risk",

                badgeClass:
                    "atrisk",

                icon:
                    "fa-brain",

                iconColor:
                    "#ff6b6b"

            };

        }


        if (
            category === "monitoring"
        ) {

            return {

                title:
                    "Students Needing Monitoring",

                empty:
                    "No students currently need monitoring.",

                badge:
                    "Needs Monitoring",

                badgeClass:
                    "ongoing",

                icon:
                    "fa-eye",

                iconColor:
                    "#f19c14"

            };

        }


        return {

            title:
                "Students On Track",

            empty:
                "No students are currently classified as On Track.",

            badge:
                "On Track",

            badgeClass:
                "completed",

            icon:
                "fa-circle-check",

            iconColor:
                "#27ae60"

        };

    }


    // ==========================================
    // RENDER STATUS STUDENTS
    //
    // SAME EXISTING RECORD DATA:
    // name
    // course
    // section
    // company
    // riskReason
    // aiStatus
    // ==========================================

    function renderStatusStudents(
        records,
        category
    ) {

        const riskContainer =
            document.getElementById(
                "riskStudentsContainer"
            );


        const titleElement =
            document.getElementById(
                "studentStatusListTitle"
            );


        if (!riskContainer) return;


        const config =
            getStatusConfig(
                category
            );


        // ==========================================
        // FILTER EXISTING BACKEND RECORDS
        // ==========================================

        const filteredList =
            records.filter(
                item =>
                    getStudentStatusCategory(
                        item
                    ) === category
            );


        // ==========================================
        // CHANGE LIST TITLE
        // ==========================================

        if (titleElement) {

            titleElement.textContent =
                config.title;

        }


        // ==========================================
        // EMPTY
        // ==========================================

        if (
            filteredList.length === 0
        ) {

            riskContainer.innerHTML = `

                <div
                    style="
                        padding:20px;
                        text-align:center;
                        color:#777;
                    "
                >

                    ${config.empty}

                </div>

            `;

            return;

        }


        // ==========================================
        // EXISTING DATA DISPLAY
        // ==========================================

        riskContainer.innerHTML =
            filteredList
                .map(item => {

                    const studentName =
                        item.name ||
                        "Student";


                    const initials =
                        studentName
                            .split(" ")
                            .filter(Boolean)
                            .map(
                                part =>
                                    part[0]
                            )
                            .join("")
                            .toUpperCase()
                            .substring(0, 2) ||
                        "ST";


                    const course =
                        item.course ||
                        "";


                    const section =
                        item.section ||
                        "";


                    const company =
                        item.company ||
                        "";


                    const subInfo =
                        [
                            course,
                            section,
                            company
                        ]
                            .filter(Boolean)
                            .join(" · ");


                    /*
                        IMPORTANT:
                        For At Risk, this is the SAME
                        riskReason coming from your backend.

                        For other statuses, if your backend
                        provides a reason, it will also use it.
                    */

                    const reason =
                        item.riskReason ||
                        (
                            category === "monitoring"
                                ? "Student progress should be monitored."
                                : category === "ontrack"
                                    ? "Student is progressing normally."
                                    : "Student may need intervention."
                        );


                    return `

                        <div
                            class="risk-row"
                        >


                            <!-- STUDENT -->
                            <div
                                class="student-mini"
                            >

                                <div
                                    class="student-avatar"
                                >
                                    ${initials}
                                </div>


                                <div>

                                    <strong>
                                        ${studentName}
                                    </strong>


                                    <small>
                                        ${subInfo}
                                    </small>

                                </div>

                            </div>


                            <!-- REASON -->
                            <div
                                class="risk-reason"
                            >

                                <span>

                                    <i
                                        class="fa-solid ${config.icon}"
                                        style="
                                            color:${config.iconColor};
                                            margin-right:5px;
                                        "
                                    ></i>

                                    ${reason}

                                </span>

                            </div>


                            <!-- STATUS -->
                            <span
                                class="status ${config.badgeClass}"
                            >

                                ${config.badge}

                            </span>


                        </div>

                    `;

                })
                .join("");

    }


    // ==========================================
    // ACTIVE CARD
    // ==========================================

    function setActiveStatusCard(
        category
    ) {

        const riskCard =
            document.getElementById(
                "riskCard"
            );


        const monitoringCard =
            document.getElementById(
                "monitoringCard"
            );


        const onTrackCard =
            document.getElementById(
                "onTrackCard"
            );


        if (riskCard) {

            riskCard.classList.remove(
                "selected"
            );

        }


        if (monitoringCard) {

            monitoringCard.classList.remove(
                "selected"
            );

        }


        if (onTrackCard) {

            onTrackCard.classList.remove(
                "selected"
            );

        }


        if (
            category === "risk" &&
            riskCard
        ) {

            riskCard.classList.add(
                "selected"
            );

        }


        if (
            category === "monitoring" &&
            monitoringCard
        ) {

            monitoringCard.classList.add(
                "selected"
            );

        }


        if (
            category === "ontrack" &&
            onTrackCard
        ) {

            onTrackCard.classList.add(
                "selected"
            );

        }

    }


    // ==========================================
    // CLICKABLE STATUS CARDS
    // ==========================================

    function initStatusCards() {

        const riskCard =
            document.getElementById(
                "riskCard"
            );


        const monitoringCard =
            document.getElementById(
                "monitoringCard"
            );


        const onTrackCard =
            document.getElementById(
                "onTrackCard"
            );


        // ==========================================
        // AT RISK
        // ==========================================

        if (riskCard) {

            riskCard.addEventListener(
                "click",
                () => {

                    renderStatusStudents(
                        globalStudentRecords,
                        "risk"
                    );


                    setActiveStatusCard(
                        "risk"
                    );

                }
            );

        }


        // ==========================================
        // NEEDS MONITORING
        // ==========================================

        if (monitoringCard) {

            monitoringCard.addEventListener(
                "click",
                () => {

                    renderStatusStudents(
                        globalStudentRecords,
                        "monitoring"
                    );


                    setActiveStatusCard(
                        "monitoring"
                    );

                }
            );

        }


        // ==========================================
        // ON TRACK
        // ==========================================

        if (onTrackCard) {

            onTrackCard.addEventListener(
                "click",
                () => {

                    renderStatusStudents(
                        globalStudentRecords,
                        "ontrack"
                    );


                    setActiveStatusCard(
                        "ontrack"
                    );

                }
            );

        }

    }


    // ==========================================
    // STUDENT TABLE FILTER
    // EXISTING FUNCTION
    // ==========================================

    function filterAndRenderTable() {

        const keyword =
            searchInput
                ? searchInput.value
                    .toLowerCase()
                    .trim()
                : "";


        const sectionVal =
            sectionFilter
                ? sectionFilter.value
                    .toLowerCase()
                : "all";


        const progressVal =
            progressFilter
                ? progressFilter.value
                    .toLowerCase()
                : "all";


        const filtered =
            globalStudentRecords.filter(
                item => {

                    const name =
                        (
                            item.name ||
                            ""
                        ).toLowerCase();


                    const studentId =
                        (
                            item.studentId ||
                            ""
                        ).toLowerCase();


                    const section =
                        (
                            item.section ||
                            ""
                        ).toLowerCase();


                    const status =
                        (
                            item.aiStatus ||
                            ""
                        ).toLowerCase();


                    return (

                        (
                            name.includes(
                                keyword
                            ) ||

                            studentId.includes(
                                keyword
                            )
                        )

                        &&

                        (
                            sectionVal === "all" ||

                            section.includes(
                                sectionVal
                            )
                        )

                        &&

                        (
                            progressVal === "all" ||

                            status.includes(
                                progressVal
                            )
                        )

                    );

                }
            );


        renderTableRows(
            filtered
        );

    }


    // ==========================================
    // RENDER STUDENT TABLE
    // ==========================================

    function renderTableRows(
        records
    ) {

        if (
            records.length === 0
        ) {

            studentTable.innerHTML = `

                <tr>

                    <td
                        colspan="8"
                        style="
                            text-align:center;
                            color:#777;
                            padding:30px;
                        "
                    >

                        No student records found.

                    </td>

                </tr>

            `;


            if (paginationInfo) {

                paginationInfo.textContent =
                    "Showing 0 to 0 students";

            }


            return;

        }


        studentTable.innerHTML =
            records
                .map(item => {

                    let statusClass =
                        "ongoing";


                    let barClass =
                        "";


                    if (
                        (
                            item.aiStatus ||
                            ""
                        )
                            .toLowerCase()
                            .includes(
                                "completed"
                            )
                    ) {

                        statusClass =
                            "completed";


                        barClass =
                            "complete";

                    }

                    else if (
                        (
                            item.aiStatus ||
                            ""
                        )
                            .toLowerCase()
                            .includes(
                                "risk"
                            )
                    ) {

                        statusClass =
                            "atrisk";


                        barClass =
                            "danger";

                    }


                    return `

                        <tr>

                            <td>

                                <strong>
                                    ${item.name}
                                </strong>

                                <br>

                                <small
                                    style="color:#777;"
                                >
                                    ${item.studentId}
                                </small>

                            </td>


                            <td>
                                ${item.course}
                            </td>


                            <td>
                                ${item.section}
                            </td>


                            <td>
                                ${item.company}
                            </td>


                            <td>

                                <div
                                    class="progress-wrapper"
                                >

                                    <div
                                        class="progress"
                                    >

                                        <div
                                            class="progress-bar ${barClass}"
                                            style="
                                                width:${item.progress}%;
                                            "
                                        ></div>

                                    </div>


                                    <span
                                        class="progress-value"
                                    >

                                        ${item.progress}%

                                    </span>

                                </div>

                            </td>


                            <td>

                                ${item.currentHours}
                                /
                                ${item.targetHours}

                            </td>


                            <td>

                                <span
                                    class="status ${statusClass}"
                                >

                                    ${item.aiStatus}

                                </span>

                            </td>


                            <td>

                                <button
                                    class="action-btn view-btn"
                                    onclick="
                                        window.viewStudentProgress(
                                            '${item.id}'
                                        )
                                    "
                                >

                                    <i
                                        class="fa-solid fa-eye"
                                    ></i>

                                </button>

                            </td>

                        </tr>

                    `;

                })
                .join("");


        if (paginationInfo) {

            paginationInfo.textContent =
                `Showing 1 to ${records.length} of ${records.length} students`;

        }

    }


    // ==========================================
    // AI COMPANY RECOMMENDATION
    // EXISTING FUNCTION - UNCHANGED
    // ==========================================

    const recommendBtn =
        document.getElementById(
            "recommendCompanyBtn"
        );


    const skillFocusSelect =
        document.getElementById(
            "skillFocus"
        );


    const recommendationResults =
        document.getElementById(
            "recommendationResults"
        );


    if (recommendBtn) {

        recommendBtn.addEventListener(
            "click",
            async () => {

                const skillFocus =
                    skillFocusSelect
                        ? skillFocusSelect.value.trim()
                        : "";


                if (!skillFocus) {

                    alert(
                        "Mangyaring pumili muna ng Skill Focus."
                    );


                    return;

                }


                recommendationResults.innerHTML = `

                    <div
                        style="
                            text-align:center;
                            color:#777;
                            padding:20px;
                        "
                    >

                        AI is finding companies
                        based on your skills…

                    </div>

                `;


                try {

                    const response =
                        await fetch(
                            "http://localhost:5000/api/recommend-company",
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({
                                        skillFocus:
                                            skillFocus
                                    })
                            }
                        );


                    const result =
                        await response.json();


                    if (
                        result.status !== "success" ||
                        !result.data ||
                        result.data.length === 0
                    ) {

                        recommendationResults.innerHTML = `

                            <div
                                style="
                                    text-align:center;
                                    color:#ff6b6b;
                                    padding:20px;
                                "
                            >

                                Not Found Skills..

                            </div>

                        `;


                        return;

                    }


                    recommendationResults.innerHTML =
                        result.data
                            .map(comp => `

                                <div
                                    class="recommendation-company"
                                    style="
                                        background:#f8f9fa;
                                        padding:15px;
                                        border-radius:8px;
                                        margin-bottom:10px;
                                        display:flex;
                                        justify-content:space-between;
                                        align-items:center;
                                        border-left:4px solid #4e73df;
                                    "
                                >

                                    <div
                                        class="recommendation-company-info"
                                        style="
                                            display:flex;
                                            align-items:center;
                                            gap:15px;
                                        "
                                    >

                                        <div
                                            class="company-icon"
                                            style="
                                                background:#e3e6f0;
                                                color:#4e73df;
                                                width:40px;
                                                height:40px;
                                                display:flex;
                                                align-items:center;
                                                justify-content:center;
                                                border-radius:50%;
                                            "
                                        >

                                            <i
                                                class="fa-solid fa-building"
                                            ></i>

                                        </div>


                                        <div>

                                            <h4
                                                style="
                                                    margin:0;
                                                    color:#333;
                                                "
                                            >

                                                ${comp.companyName}

                                            </h4>


                                            <p
                                                style="
                                                    margin:3px 0;
                                                    color:#666;
                                                    font-size:13px;
                                                "
                                            >

                                                Primary Skill:

                                                <strong>
                                                    ${comp.primarySkill}
                                                </strong>

                                            </p>


                                            <p
                                                style="
                                                    margin:3px 0;
                                                    color:#4e73df;
                                                    font-size:12px;
                                                "
                                            >

                                                <em>
                                                    ${comp.reasons.join(" | ")}
                                                </em>

                                            </p>

                                        </div>

                                    </div>


                                    <div
                                        style="
                                            text-align:right;
                                        "
                                    >

                                        <span
                                            style="
                                                background:#d4edda;
                                                color:#155724;
                                                padding:5px 10px;
                                                border-radius:20px;
                                                font-size:12px;
                                                font-weight:bold;
                                            "
                                        >

                                            AI Score:
                                            ${comp.aiScore}%

                                        </span>

                                    </div>

                                </div>

                            `)
                            .join("");


                } catch (error) {

                    console.error(
                        "Error fetching AI recommendations:",
                        error
                    );


                    recommendationResults.innerHTML = `

                        <div
                            style="
                                text-align:center;
                                color:#ff6b6b;
                                padding:20px;
                            "
                        >

                            Nabigong kumonekta
                            sa AI server.

                        </div>

                    `;

                }

            }
        );

    }


    // ==========================================
    // SEARCH / FILTER EVENTS
    // ==========================================

    if (searchInput) {

        searchInput.addEventListener(
            "keyup",
            filterAndRenderTable
        );

    }


    if (sectionFilter) {

        sectionFilter.addEventListener(
            "change",
            filterAndRenderTable
        );

    }


    if (progressFilter) {

        progressFilter.addEventListener(
            "change",
            filterAndRenderTable
        );

    }


    // ==========================================
    // INITIALIZE CLICKABLE CARDS
    // ==========================================

    initStatusCards();


    // ==========================================
    // INITIAL LOAD
    // ==========================================

    syncUserProfile();

    fetchAllStudents();

});


// ==========================================
// VIEW STUDENT PROGRESS
// EXISTING FUNCTION
// ==========================================

window.viewStudentProgress =
    (id) => {

        alert(
            `Opening student profile: ${id}`
        );

    };


// ==========================================
// COMPANY SKILL DRILL-DOWN MODAL
// EXISTING FUNCTION
// ==========================================

window.viewCompanySkillModal =
    function(companyName) {

        const modal =
            document.getElementById(
                "companyModal"
            );


        const modalTitle =
            document.getElementById(
                "modalCompanyName"
            );


        const modalSubtitle =
            document.getElementById(
                "modalCompanySubtitle"
            );


        const modalTableBody =
            document.getElementById(
                "modalStudentTableBody"
            );


        if (!modal) return;


        const compData =
            globalCompanyExposureData.find(
                c =>
                    c.companyName
                        .toLowerCase() ===
                    companyName
                        .toLowerCase()
            );


        if (!compData) {

            alert(
                `Details not found for company: ${companyName}`
            );


            return;

        }


        modalTitle.textContent =
            `${compData.companyName} - Skill Exposure Breakdown`;


        modalSubtitle.innerHTML =
            `Primary Skill Focus:
            <strong>
                ${compData.primarySkill}
            </strong>
            |
            Skill Exposure Rate:
            <strong>
                ${compData.exposure}%
            </strong>`;


        if (
            compData.matchedStudents.length === 0
        ) {

            modalTableBody.innerHTML = `

                <tr>

                    <td
                        colspan="4"
                        style="
                            text-align:center;
                            color:#777;
                            padding:20px;
                        "
                    >

                        No students matched
                        the primary skill criteria
                        for this company yet.

                    </td>

                </tr>

            `;

        }

        else {

            modalTableBody.innerHTML =
                compData.matchedStudents
                    .map(st => `

                        <tr
                            style="
                                border-bottom:
                                1px solid #f1f1f1;
                            "
                        >

                            <td
                                style="
                                    padding:10px;
                                "
                            >

                                <strong>
                                    ${st.name}
                                </strong>

                            </td>


                            <td
                                style="
                                    padding:10px;
                                "
                            >

                                ${st.courseSection}

                            </td>


                            <td
                                style="
                                    padding:10px;
                                    color:#555;
                                    font-size:13px;
                                "
                            >

                                ${st.tasks}

                            </td>


                            <td
                                style="
                                    padding:10px;
                                "
                            >

                                <span
                                    style="
                                        background:#d4edda;
                                        color:#155724;
                                        padding:3px 8px;
                                        border-radius:4px;
                                        font-size:11px;
                                        font-weight:bold;
                                    "
                                >

                                    ${st.status}

                                </span>

                            </td>

                        </tr>

                    `)
                    .join("");

        }


        modal.style.display =
            "block";

    };


// ==========================================
// CLOSE COMPANY MODAL
// ==========================================

window.closeCompanyModal =
    function() {

        const modal =
            document.getElementById(
                "companyModal"
            );


        if (modal) {

            modal.style.display =
                "none";

        }

    };


// ==========================================
// CLOSE MODAL OUTSIDE CLICK
// ==========================================

window.onclick =
    function(event) {

        const modal =
            document.getElementById(
                "companyModal"
            );


        if (
            event.target === modal
        ) {

            modal.style.display =
                "none";

        }

    };