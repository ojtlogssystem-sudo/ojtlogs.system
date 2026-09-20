/* ==========================================
   OJT-LOGS ANALYTICS & AI TASK/ATTENDANCE SKILL EXPOSURE
========================================== */

// NOTE: Ang login check, profile, at notifications ay hawak na
// ng shared header (../header/header.js), kaya wala nang Firebase
// code sa file na ito. Lahat ng data ay galing sa Flask AI server
// (app.py, http://localhost:5000).


// ==========================================
// CHARTS (BAR + PIE) - gamit ang Chart.js
//
// Kulay ng system:
//   maroon  #ab0a0a  -> primary (sidebar/buttons/accent)
//   red     #e74c3c  -> At Risk
//   orange  #f19c14  -> Needs Monitoring
//   green   #27ae60  -> On Track
// ==========================================

const CHART_COLORS = {
    primary: "#ab0a0a",
    primaryHover: "#8f0808",
    primarySoft: "#e9b8b8",
    primarySoftHover: "#dea0a0",
    risk: "#e74c3c",
    monitoring: "#f19c14",
    onTrack: "#27ae60",
    text: "#666666",
    muted: "#999999",
    grid: "#ececec",
    surface: "#ffffff"
};

let riskStatusPieChartInstance = null;
let graduatesByBatchChartInstance = null;


function applyChartDefaults() {

    if (typeof Chart === "undefined") return;

    Chart.defaults.font.family = "'Poppins', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = CHART_COLORS.text;

}


// Mensahe sa loob ng chart (loading / walang data / error)
function setChartMessage(elementId, message, isError = false) {

    const el = document.getElementById(elementId);

    if (!el) return;

    el.textContent = message;
    el.classList.toggle("error", isError);
    el.hidden = false;

}


function clearChartMessage(elementId) {

    const el = document.getElementById(elementId);

    if (el) el.hidden = true;

}


function showChartsUnavailable(message) {

    if (riskStatusPieChartInstance) {
        riskStatusPieChartInstance.destroy();
        riskStatusPieChartInstance = null;
    }

    if (graduatesByBatchChartInstance) {
        graduatesByBatchChartInstance.destroy();
        graduatesByBatchChartInstance = null;
    }

    setChartMessage("riskStatusPieEmpty", message, true);
    setChartMessage("graduatesByBatchEmpty", message, true);

}


const CHART_LOAD_ERROR =
    "Chart.js failed to load. Check your internet connection or ad blocker (cdn.jsdelivr.net).";


// ------------------------------------------
// PIE - STUDENT STATUS DISTRIBUTION
// ------------------------------------------

function renderRiskStatusCharts(atRiskCount, monitoringCount, onTrackCount) {

    const canvas = document.getElementById("riskStatusPieChart");

    if (!canvas) return;

    if (typeof Chart === "undefined") {

        console.error(CHART_LOAD_ERROR);
        setChartMessage("riskStatusPieEmpty", CHART_LOAD_ERROR, true);
        return;

    }

    applyChartDefaults();

    if (riskStatusPieChartInstance) {

        riskStatusPieChartInstance.destroy();
        riskStatusPieChartInstance = null;

    }

    const total = atRiskCount + monitoringCount + onTrackCount;

    if (total === 0) {

        setChartMessage("riskStatusPieEmpty", "No registered students yet.");
        return;

    }

    clearChartMessage("riskStatusPieEmpty");

    riskStatusPieChartInstance = new Chart(canvas, {
        type: "pie",
        data: {
            labels: ["At Risk", "Needs Monitoring", "On Track"],
            datasets: [{
                data: [atRiskCount, monitoringCount, onTrackCount],
                backgroundColor: [
                    CHART_COLORS.risk,
                    CHART_COLORS.monitoring,
                    CHART_COLORS.onTrack
                ],
                borderColor: CHART_COLORS.surface,
                borderWidth: 3,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        usePointStyle: true,
                        pointStyle: "circle",
                        boxWidth: 8,
                        padding: 16,

                        // Kasama ang bilang sa legend, hal. "At Risk (2)"
                        generateLabels: (chart) => {

                            const dataset = chart.data.datasets[0];

                            return chart.data.labels.map((label, i) => ({
                                text: `${label} (${dataset.data[i]})`,
                                fillStyle: dataset.backgroundColor[i],
                                strokeStyle: dataset.backgroundColor[i],
                                lineWidth: 0,
                                pointStyle: "circle",
                                hidden: !chart.getDataVisibility(i),
                                index: i
                            }));

                        }
                    }
                },
                tooltip: {
                    backgroundColor: "#1d1d1d",
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => {

                            const pct =
                                Math.round((ctx.parsed / total) * 100);

                            return ` ${ctx.parsed} of ${total} students (${pct}%)`;

                        }
                    }
                }
            }
        }
    });

}


// ------------------------------------------
// BAR - GRADUATED STUDENTS BY BATCH
//
// Ang batch ay ang TAON sa umpisa ng Student ID:
//     2023-01-22112  ->  2023
//     2026-21-01233  ->  2026
// Lahat ng estudyanteng nakarehistro sa system ay
// binibilang (Registered); ang natapos na ang required
// OJT hours ay binibilang din bilang Graduated.
// Batch lang na may nakarehistrong estudyante ang lalabas.
// ------------------------------------------

function getBatchFromStudentId(studentId) {

    const match =
        String(studentId ?? "")
            .match(/^\s*((?:19|20)\d{2})\s*[-/\s]\s*\d/);

    return match ? match[1] : "";

}


function buildGraduatesByBatchData(records) {

    const batches = new Map();

    records.forEach(item => {

        // Unahin ang batch mula sa backend (app.py); kung wala,
        // basahin mismo sa Student ID.
        const batch =
            String(item.batch ?? "").trim() ||
            getBatchFromStudentId(item.studentId);

        if (!batch) return;

        const entry =
            batches.get(batch) ||
            { batch, registered: 0, graduated: 0 };

        entry.registered++;

        const isGraduated =
            Boolean(item.graduated) ||
            (item.aiStatus || "").toLowerCase().includes("completed");

        if (isGraduated) entry.graduated++;

        batches.set(batch, entry);

    });

    return [...batches.values()].sort((a, b) =>
        a.batch.localeCompare(b.batch, undefined, { numeric: true })
    );

}


// Nagsusulat ng bilang sa ibabaw ng bawat bar
const barValueLabelsPlugin = {

    id: "barValueLabels",

    afterDatasetsDraw(chart) {

        const { ctx } = chart;

        ctx.save();
        ctx.font = "600 12px 'Poppins', sans-serif";
        ctx.fillStyle = "#333333";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        chart.data.datasets.forEach((dataset, datasetIndex) => {

            chart.getDatasetMeta(datasetIndex).data.forEach((bar, i) => {

                ctx.fillText(dataset.data[i], bar.x, bar.y - 4);

            });

        });

        ctx.restore();

    }

};


function renderGraduatesByBatchChart(batchRows) {

    const canvas = document.getElementById("graduatesByBatchChart");

    if (!canvas) return;

    if (typeof Chart === "undefined") {

        console.error(CHART_LOAD_ERROR);
        setChartMessage("graduatesByBatchEmpty", CHART_LOAD_ERROR, true);
        return;

    }

    applyChartDefaults();

    if (graduatesByBatchChartInstance) {

        graduatesByBatchChartInstance.destroy();
        graduatesByBatchChartInstance = null;

    }

    if (!batchRows || batchRows.length === 0) {

        setChartMessage(
            "graduatesByBatchEmpty",
            "No batches registered in the system yet."
        );
        return;

    }

    clearChartMessage("graduatesByBatchEmpty");

    graduatesByBatchChartInstance = new Chart(canvas, {
        type: "bar",
        data: {
            labels: batchRows.map(r => r.batch),
            datasets: [
                {
                    label: "Registered",
                    data: batchRows.map(r => r.registered),
                    backgroundColor: CHART_COLORS.primarySoft,
                    hoverBackgroundColor: CHART_COLORS.primarySoftHover,
                    borderRadius: 6,
                    maxBarThickness: 40
                },
                {
                    label: "Graduated",
                    data: batchRows.map(r => r.graduated),
                    backgroundColor: CHART_COLORS.primary,
                    hoverBackgroundColor: CHART_COLORS.primaryHover,
                    borderRadius: 6,
                    maxBarThickness: 40
                }
            ]
        },
        plugins: [barValueLabelsPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 22 } },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        usePointStyle: true,
                        pointStyle: "circle",
                        boxWidth: 8,
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: "#1d1d1d",
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        title: (items) => `Batch ${items[0].label}`,
                        label: (ctx) =>
                            ` ${ctx.dataset.label}: ${ctx.parsed.y}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { color: CHART_COLORS.grid },
                    title: {
                        display: true,
                        text: "Batch (year in Student ID)",
                        color: CHART_COLORS.muted
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    grid: { color: CHART_COLORS.grid },
                    border: { display: false },
                    title: {
                        display: true,
                        text: "Number of Students",
                        color: CHART_COLORS.muted
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
// NAKA-OFF NA ITO (false) para totoong absences at status
// na galing sa attendance records ng mga estudyante ang
// makita sa page. Kung gusto mong ibalik ang demo data
// (halimbawa para sa presentation), gawing true lang.
// ==========================================

const ENABLE_SAMPLE_RISK_DATA = false;

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
    // TABLE ERROR MESSAGE
    // Para hindi mag-"Loading..." nang walang katapusan
    // kapag hindi maabot ang AI server.
    // ==========================================

    function showStudentTableError(message) {

        studentTable.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    style="text-align:center;color:#dc2626;padding:30px;"
                >
                    ${escapeHtml(message)}
                </td>
            </tr>
        `;

        if (paginationInfo) {

            paginationInfo.textContent = "Showing 0 to 0 students";

        }

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

                showStudentTableError(
                    "Hindi ma-load ang student records - may error mula sa AI server."
                );

                showChartsUnavailable(
                    "Unable to load chart data - the AI server returned an error."
                );

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

            });


            // ==========================================
            // I-UPDATE ANG BAR AT PIE CHART
            // ==========================================

            renderRiskStatusCharts(
                atRiskCount,
                monitoringCount,
                onTrackCount
            );

            renderGraduatesByBatchChart(
                buildGraduatesByBatchData(globalStudentRecords)
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
            // STUDENT TABLE
            // ==========================================

            populateSectionFilter();

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


            showStudentTableError(
                "Hindi maabot ang AI Server (Flask, port 5000). Siguraduhing tumatakbo ang app.py."
            );

            showChartsUnavailable(
                "Unable to load chart data - the AI server is unreachable."
            );

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
                    "monitoring",

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
    // HELPERS - ESCAPE + ABSENCES
    //
    // Ang absentCount at consecutiveAbsences ay
    // galing sa attendance records ng bawat estudyante
    // (binabasa ng /api/predict-risk sa app.py).
    // Dapat kapareho ng thresholds sa app.py ang
    // mga numero sa ibaba.
    // ==========================================

    const ABSENCE_MONITORING_THRESHOLD = 5;
    const ABSENCE_RISK_THRESHOLD = 8;
    const CONSECUTIVE_ABSENCE_RISK_THRESHOLD = 3;


    function escapeHtml(value) {

        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    }


    function getAbsenceLevel(item) {

        const absent = Number(item.absentCount) || 0;
        const streak = Number(item.consecutiveAbsences) || 0;

        if (
            absent >= ABSENCE_RISK_THRESHOLD ||
            streak >= CONSECUTIVE_ABSENCE_RISK_THRESHOLD
        ) {
            return "high";
        }

        if (absent >= ABSENCE_MONITORING_THRESHOLD) {
            return "watch";
        }

        return "";

    }


    function renderAbsenceBadge(item) {

        const absent = Number(item.absentCount) || 0;
        const streak = Number(item.consecutiveAbsences) || 0;

        // 0 record = wala pang nababasang attendance para sa
        // estudyante (iba ito sa "0 absences" na perfect attendance)
        if (item.attendanceRecords === 0 && absent === 0) {

            return `
                <span
                    class="absence-badge"
                    title="Wala pang nababasang attendance record para sa estudyanteng ito"
                >
                    <i class="fa-solid fa-calendar-xmark"></i>
                    No attendance yet
                </span>
            `;

        }

        const label =
            `${absent} ${absent === 1 ? "absence" : "absences"}`;

        const title =
            streak > 0
                ? `${absent} kabuuang absence · ${streak} sunod-sunod ngayon`
                : `${absent} kabuuang absence`;

        return `
            <span
                class="absence-badge ${getAbsenceLevel(item)}"
                title="${title}"
            >
                <i class="fa-solid fa-calendar-xmark"></i>
                ${label}
            </span>
        `;

    }


    function renderStreakBadge(item) {

        const streak = Number(item.consecutiveAbsences) || 0;

        if (streak < 2) return "";

        return `
            <span
                class="absence-badge ${
                    streak >= CONSECUTIVE_ABSENCE_RISK_THRESHOLD
                        ? "high"
                        : "watch"
                }"
                title="Magkakasunod na absent simula sa pinakahuling duty day"
            >
                <i class="fa-solid fa-link-slash"></i>
                ${streak} sunod-sunod
            </span>
        `;

    }


    // ==========================================
    // RENDER STATUS STUDENTS
    // (AI At-Risk Analysis list)
    //
    // Kasama na ngayon ang bilang ng absences ng
    // bawat estudyante, at nauuna sa listahan ang
    // pinakamaraming absent / pinakamahabang streak.
    // ==========================================

    function renderStatusStudents(
        records,
        category
    ) {

        const riskContainer =
            document.getElementById("riskStudentsContainer");

        const titleElement =
            document.getElementById("studentStatusListTitle");

        if (!riskContainer) return;

        const config = getStatusConfig(category);

        const filteredList =
            records
                .filter(
                    item =>
                        getStudentStatusCategory(item) === category
                )
                .sort((a, b) =>
                    (Number(b.consecutiveAbsences) || 0) -
                        (Number(a.consecutiveAbsences) || 0) ||
                    (Number(b.absentCount) || 0) -
                        (Number(a.absentCount) || 0)
                );

        if (titleElement) {

            titleElement.textContent = config.title;

        }

        if (filteredList.length === 0) {

            riskContainer.innerHTML = `
                <div style="padding:20px;text-align:center;color:#777;">
                    ${config.empty}
                </div>
            `;

            return;

        }

        riskContainer.innerHTML =
            filteredList
                .map(item => {

                    const studentName = item.name || "Student";

                    const initials =
                        studentName
                            .split(" ")
                            .filter(Boolean)
                            .map(part => part[0])
                            .join("")
                            .toUpperCase()
                            .substring(0, 2) || "ST";

                    const subInfo =
                        [item.course, item.section, item.company]
                            .filter(Boolean)
                            .join(" · ");

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
                        <div class="risk-row">

                            <!-- STUDENT -->
                            <div class="student-mini">

                                <div class="student-avatar">
                                    ${escapeHtml(initials)}
                                </div>

                                <div>
                                    <strong>${escapeHtml(studentName)}</strong>
                                    <small>${escapeHtml(subInfo)}</small>
                                </div>

                            </div>


                            <!-- REASON + ATTENDANCE -->
                            <div class="risk-reason">

                                <span>
                                    <i
                                        class="fa-solid ${config.icon}"
                                        style="color:${config.iconColor};margin-right:5px;"
                                    ></i>
                                    ${escapeHtml(reason)}
                                </span>

                                <div class="risk-attendance">
                                    ${renderAbsenceBadge(item)}
                                    ${renderStreakBadge(item)}
                                </div>

                            </div>


                            <!-- STATUS -->
                            <span class="status ${config.badgeClass}">
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
    // SECTION FILTER
    // Ang mga section ay galing na sa totoong
    // student records (hindi na hardcoded 3A / 3B).
    // ==========================================

    function populateSectionFilter() {

        if (!sectionFilter) return;

        const previous = sectionFilter.value;

        const sections = new Map();

        globalStudentRecords.forEach(item => {

            const section = String(item.section || "").trim();

            if (!section || sections.has(section.toLowerCase())) return;

            sections.set(
                section.toLowerCase(),
                [item.course, section].filter(Boolean).join(" ")
            );

        });

        sectionFilter.innerHTML =
            `<option value="all">All Sections</option>` +
            [...sections.entries()]
                .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
                .map(([value, label]) =>
                    `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
                )
                .join("");

        if (previous && sections.has(previous)) {

            sectionFilter.value = previous;

        }

    }


    // ==========================================
    // STATUS FILTER MATCHER
    // (gumagamit ng parehong category rules gaya
    // ng AI At-Risk Analysis para pare-pareho ang
    // resulta sa buong page)
    // ==========================================

    function matchesStatusFilter(item, filterValue) {

        if (filterValue === "all") return true;

        const status = (item.aiStatus || "").toLowerCase();

        if (filterValue === "completed") {

            return status.includes("completed");

        }

        const category = getStudentStatusCategory(item);

        if (filterValue === "atrisk") return category === "risk";

        if (filterValue === "monitoring") return category === "monitoring";

        if (filterValue === "ontrack") {

            return category === "ontrack" && !status.includes("completed");

        }

        return true;

    }


    // ==========================================
    // STUDENT TABLE FILTER
    // ==========================================

    function filterAndRenderTable() {

        const keyword =
            searchInput ? searchInput.value.toLowerCase().trim() : "";

        const sectionVal =
            sectionFilter ? sectionFilter.value.toLowerCase() : "all";

        const progressVal =
            progressFilter ? progressFilter.value.toLowerCase() : "all";

        const filtered =
            globalStudentRecords.filter(item => {

                const name = String(item.name || "").toLowerCase();

                const studentId = String(item.studentId || "").toLowerCase();

                const section = String(item.section || "").trim().toLowerCase();

                return (
                    (name.includes(keyword) || studentId.includes(keyword)) &&
                    (sectionVal === "all" || section === sectionVal) &&
                    matchesStatusFilter(item, progressVal)
                );

            });

        renderTableRows(filtered);

    }


    // ==========================================
    // RENDER STUDENT TABLE
    // ==========================================

    function renderTableRows(
        records
    ) {

        if (records.length === 0) {

            studentTable.innerHTML = `
                <tr>
                    <td
                        colspan="9"
                        style="text-align:center;color:#777;padding:30px;"
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

                    const category = getStudentStatusCategory(item);

                    const isCompleted =
                        (item.aiStatus || "").toLowerCase().includes("completed");

                    let statusClass = "ongoing";
                    let barClass = "";

                    if (isCompleted) {

                        statusClass = "completed";
                        barClass = "complete";

                    } else if (category === "risk") {

                        statusClass = "atrisk";
                        barClass = "danger";

                    } else if (category === "monitoring") {

                        statusClass = "monitoring";
                        barClass = "warning";

                    }

                    const progress = Number(item.progress) || 0;

                    return `
                        <tr>

                            <td>
                                <strong>${escapeHtml(item.name)}</strong>
                                <br>
                                <small style="color:#777;">
                                    ${escapeHtml(item.studentId)}
                                </small>
                            </td>

                            <td>${escapeHtml(item.course)}</td>

                            <td>${escapeHtml(item.section)}</td>

                            <td>${escapeHtml(item.company)}</td>

                            <td>
                                <div class="progress-wrapper">
                                    <div class="progress">
                                        <div
                                            class="progress-bar ${barClass}"
                                            style="width:${progress}%;"
                                        ></div>
                                    </div>
                                    <span class="progress-value">
                                        ${progress}%
                                    </span>
                                </div>
                            </td>

                            <td>
                                ${escapeHtml(item.currentHours)}
                                /
                                ${escapeHtml(item.targetHours)}
                            </td>

                            <td>${renderAbsenceBadge(item)}</td>

                            <td>
                                <span class="status ${statusClass}">
                                    ${escapeHtml(item.aiStatus)}
                                </span>
                            </td>

                            <td>
                                <button
                                    class="action-btn view-btn"
                                    onclick="window.viewStudentProgress('${escapeHtml(item.id)}')"
                                >
                                    <i class="fa-solid fa-eye"></i>
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