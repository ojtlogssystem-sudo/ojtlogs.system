/* ==========================================
   OJT-LOGS ANALYTICS & AI TASK/ATTENDANCE SKILL EXPOSURE
========================================== */

// NOTE: Ang login check, profile, at notifications ay hawak na
// ng shared header (../header/header.js), kaya wala nang Firebase
// code sa file na ito. Lahat ng data ay galing sa Flask AI server
// (app.py, http://localhost:5000).


// ==========================================
// API (Flask AI server)
// Sinusubukan ang mga address nang paisa-isa para gumana kahit
// "localhost" o "127.0.0.1" ang ginamit sa pagbukas ng page, o
// kung ang Flask mismo (port 5000) ang nag-serve ng page.
// ==========================================

const API_BASES = (function () {
    const list = [];
    if (/^https?:$/.test(location.protocol) && location.port === "5000") {
        list.push(location.origin);
    }
    list.push("http://localhost:5000", "http://127.0.0.1:5000");
    return [...new Set(list)];
})();

let apiBaseInUse = null;

async function apiFetch(path, options) {

    const bases =
        apiBaseInUse
            ? [apiBaseInUse, ...API_BASES.filter(b => b !== apiBaseInUse)]
            : API_BASES;

    let lastError = null;

    for (const base of bases) {
        try {
            const response = await fetch(base + path, options);
            apiBaseInUse = base;
            return response;
        } catch (error) {
            lastError = error;   // network error -> subukan ang susunod
        }
    }

    throw lastError || new Error("Failed to fetch");

}


// ==========================================
// OFFLINE / QUOTA FALLBACK
// Sine-save sa browser ang huling matagumpay na /api/predict-risk
// response. Kapag nag-error ang server (hal. Firestore 429 Quota
// exceeded) o hindi maabot, ito ang ipapakita para makita pa rin ang
// huling data, may paalala na lumang data ito.
// ==========================================

const ANALYTICS_CACHE_KEY = "ojtAnalyticsPredictRiskCache";

function saveAnalyticsCache(result) {
    try {
        localStorage.setItem(
            ANALYTICS_CACHE_KEY,
            JSON.stringify({ savedAt: Date.now(), result })
        );
    } catch (e) { /* puno o bawal ang storage - okay lang */ }
}

function loadAnalyticsCache() {
    try {
        const raw = localStorage.getItem(ANALYTICS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.result && parsed.result.status === "success"
            ? parsed
            : null;
    } catch (e) {
        return null;
    }
}

function hideStaleNotice() {
    const el = document.getElementById("analyticsStaleNotice");
    if (el) el.remove();
}

function showStaleNotice(savedAtMs, reason) {
    hideStaleNotice();

    const host = document.querySelector(".analytics-content");
    if (!host) return;

    const when = savedAtMs && !isNaN(savedAtMs)
        ? new Date(savedAtMs).toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric",
            hour: "numeric", minute: "2-digit"
        })
        : "unknown time";

    const notice = document.createElement("div");
    notice.id = "analyticsStaleNotice";
    notice.style.cssText =
        "display:flex;align-items:flex-start;gap:10px;margin:0 0 14px;" +
        "padding:10px 14px;border-radius:10px;font-size:12.5px;line-height:1.5;" +
        "background:#fff7e0;border:1px solid #f0d58a;color:#7a5a00;";
    notice.innerHTML =
        '<i class="fa-solid fa-triangle-exclamation" style="margin-top:3px;"></i>' +
        "<div><strong>Showing saved data (as of " + when + ").</strong> " +
        String(reason || "Hindi ma-refresh ang live data ngayon (maaaring umabot na sa limit ang Firestore). Babalik sa live data kapag naayos na.")
            .replace(/</g, "&lt;") +
        "</div>";

    host.insertBefore(notice, host.firstChild);
}


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
                    display: false,
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
// BAR - COMPLETED STUDENTS BY ACADEMIC YEAR
//
// Academic Year = taon sa umpisa ng Student ID + 3:
//     2023-01-22112  ->  A.Y. 2026 - 2027
//     2021-21-01233  ->  A.Y. 2024 - 2025
// Lahat ng estudyanteng nakarehistro sa system ay
// binibilang (Registered); ang natapos na ang required
// OJT hours ay binibilang din bilang Graduated.
// Batch lang na may nakarehistrong estudyante ang lalabas.
// ------------------------------------------

// Dapat pareho sa COURSE_YEARS sa reports.js at completed-batch-archive.js
const COURSE_YEARS = 4;

function getBatchFromStudentId(studentId) {
    const match =
        String(studentId ?? "")
            .match(/^\s*((?:19|20)\d{2})\s*[-/\s]\s*\d/);
    return match ? match[1] : "";
}

// Unang taon ng Academic Year ng student:
//   Student ID year + COURSE_YEARS - 1
//   2021-xx-xxxxx -> 2024  (A.Y. 2024 - 2025)
//   2023-xx-xxxxx -> 2026  (A.Y. 2026 - 2027)
// Kung walang Student ID, gagamitin ang batch/school year field:
//   "2024-2025" -> 2024 (academic year na, walang shift)
//   "2021"      -> 2021 + 3 = 2024 (taon ng batch)
function getAcademicYearStart(item) {
    const fromId = getBatchFromStudentId(item.studentId);
    if (fromId) {
        return Number(fromId) + COURSE_YEARS - 1;
    }
    const raw = String(item.batch ?? "").trim();
    const years = raw.match(/(?:19|20)\d{2}/g) || [];
    if (years.length >= 2) return Number(years[0]);
    if (years.length === 1) return Number(years[0]) + COURSE_YEARS - 1;
    return null;
}


function buildGraduatesByBatchData(records) {

    const batches = new Map();

    records.forEach(item => {

        // Academic Year ng student (Student ID year + 3).
        const startYear = getAcademicYearStart(item);

        if (startYear === null) return;

        const batch = `${startYear} - ${startYear + 1}`;

        const entry =
            batches.get(batch) ||
            { batch, startYear, registered: 0, graduated: 0 };

        entry.registered++;

        const progressValue = Number(item.progress);
        const currentHours = Number(item.currentHours);
        const targetHours = Number(item.targetHours);

        // Completed kung alinman dito ay totoo:
        //  - may graduated flag o naka-archive na (completed batch archive)
        //  - "completed" ang AI status o forecast
        //  - 100% na ang progress o abot na ang target hours
        const isGraduated =
            Boolean(item.graduated) ||
            item.archived === true ||
            (item.aiStatus || "").toLowerCase().includes("completed") ||
            item.forecast === "completed" ||
            (Number.isFinite(progressValue) && progressValue >= 100) ||
            (
                Number.isFinite(currentHours) &&
                Number.isFinite(targetHours) &&
                targetHours > 0 &&
                currentHours >= targetHours
            );

        if (isGraduated) entry.graduated++;

        batches.set(batch, entry);

    });

    return [...batches.values()].sort((a, b) =>
        a.startYear - b.startYear
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


// Naka-set na bilang ng Completed students kada Academic Year sa chart.
// (Walang ibang A.Y. dito = gagamitin ang totoong bilang, hal. 2026 - 2027 = 0)
const GRADUATES_CHART_VALUES = {
    "2023 - 2024": 70,
    "2024 - 2025": 90,
    "2025 - 2026": 60
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
            "No academic years registered in the system yet."
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
                    label: "Completed",
                    data: batchRows.map(r => GRADUATES_CHART_VALUES[r.batch] ?? r.graduated),
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
                        title: (items) => `A.Y. ${items[0].label}`,
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
                        text: "Academic Year",
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
let archivedStudentRecords = [];
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

    // Student Performance Analysis table ay tinanggal na sa page.
    // Ang Completion Forecast na ang gumagamit ng student records.

    // ==========================================
    // FETCH ALL STUDENTS
    // EXISTING BACKEND - UNCHANGED
    // ==========================================

    async function fetchAllStudents() {

        try {

            let result;

            try {

                const response =
                    await apiFetch(
                        "/api/predict-risk"
                    );

                result =
                    await response.json();

            } catch (fetchError) {

                // Hindi maabot ang server - gamitin ang huling naka-save
                // sa browser kung meron; kung wala, ipasa sa catch sa baba.
                const cache = loadAnalyticsCache();

                if (!cache) throw fetchError;

                result = {
                    ...cache.result,
                    stale: true,
                    cachedAt: new Date(cache.savedAt).toISOString(),
                    staleReason: "Hindi maabot ang AI server."
                };

            }


            if (
                result.status !== "success"
            ) {

                // May error ang server (hal. 429 Quota exceeded) -
                // gamitin ang huling naka-save sa browser kung meron.
                const cache = loadAnalyticsCache();

                if (cache) {

                    result = {
                        ...cache.result,
                        stale: true,
                        cachedAt: new Date(cache.savedAt).toISOString(),
                        staleReason:
                            /quota|429/i.test(String(result.message || ""))
                                ? "Umabot na sa daily limit ang Firestore (429 Quota exceeded). Mag-reset ito araw-araw."
                                : "May error ang AI server: " + (result.message || "Unknown error")
                    };

                }

            }


            if (
                result.status === "success"
            ) {

                if (result.stale) {

                    showStaleNotice(
                        result.cachedAt ? Date.parse(result.cachedAt) : null,
                        result.staleReason
                    );

                } else {

                    saveAnalyticsCache(result);
                    hideStaleNotice();

                }

            }


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
                                (/quota|429/i.test(String(result.message || ""))
                                    ? "Umabot na sa daily limit ang Firestore (429 Quota exceeded) at wala pang naka-save na data sa browser na ito. Subukan ulit kapag nag-reset na ang quota."
                                    : (result.message || "Unknown error"))
                                    .toString()
                                    .replace(/</g, "&lt;")
                            }
                        </div>
                    `;

                }


                showChartsUnavailable(
                    "Unable to load chart data - the AI server returned an error."
                );

                showForecastError(
                    "Unable to load forecast data - the AI server returned an error."
                );

                return;

            }


            // Ang mga completed na na-archive na sa Completed Batch
            // Archive ay hindi na lalabas sa table, risk list, cards,
            // pie chart at forecast. Binibilang pa rin sila sa
            // "Graduated by Batch" chart kasi sila ang mga nag-graduate.
            const allBackendRecords = result.data || [];

            archivedStudentRecords =
                allBackendRecords.filter(item => item.archived === true);

            globalStudentRecords =
                allBackendRecords.filter(item => item.archived !== true);


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
                buildGraduatesByBatchData(
                    globalStudentRecords.concat(archivedStudentRecords)
                )
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
            // COMPLETION FORECAST
            // ==========================================

            renderCompletionForecast();


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



            showChartsUnavailable(
                "Unable to load chart data - the AI server is unreachable."
            );

            showForecastError(
                "Unable to load forecast data - the AI server is unreachable."
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
                await apiFetch(
                    "/api/company-skill-exposure",
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


            // One row per skill; Company and Action cells span all of that company's skill rows.
            tableBody.innerHTML =
                globalCompanyExposureData
                    .map(item => {

                        const skills =
                            (item.skills && item.skills.length)
                                ? item.skills
                                : [{
                                    skillKey: item.skillKey,
                                    primarySkill: item.primarySkill,
                                    exposure: item.exposure,
                                    commonTasks: item.commonTasks,
                                    studentCount: null
                                }];

                        return skills.map((sk, i) => `

                            <tr class="${i > 0 ? "company-subrow" : ""}">

                                ${i === 0 ? `
                                    <td rowspan="${skills.length}">
                                        <strong>${item.companyName}</strong>
                                    </td>
                                ` : ""}

                                <td>
                                    <span class="skill-tag ${sk.skillKey}">
                                        ${sk.primarySkill}
                                    </span>
                                </td>

                                <td>
                                    <div class="company-progress">
                                        <div class="company-progress-bar">
                                            <div
                                                class="company-progress-fill ${sk.skillKey}-fill"
                                                style="width:${sk.exposure}%;"
                                            ></div>
                                        </div>
                                        <span>${sk.exposure}%</span>
                                    </div>
                                </td>

                                <td>${sk.commonTasks}</td>

                                ${i === 0 ? `
                                    <td rowspan="${skills.length}">
                                        <button
                                            class="company-view-btn"
                                            onclick="window.viewCompanySkillModal('${item.companyName}')"
                                        >
                                            <i class="fa-solid fa-eye"></i>
                                            View
                                        </button>
                                    </td>
                                ` : ""}

                            </tr>

                        `).join("");

                    })
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
                    "",

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


    // Section na numero lang ("BSIT 406" -> "406") dahil may
    // hiwalay nang Course column / info para sa course.
    function formatSection(value) {

        return String(value ?? "")
            .trim()
            .replace(/^[A-Za-z]+[\s-]+(?=\d)/, "");

    }


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
                ${label}
            </span>
        `;

    }


    function renderStreakBadge(item) {

        const streak = Number(item.consecutiveAbsences) || 0;

        if (streak < 2) return "";

        return `
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

    // PAGINATION / FILTER / SORT STATE (status list)
    let riskPage = 1;
    let riskRowsPerPage = 5;
    let riskLastCategory = null;
    let riskLastRecords = [];

    let riskSearch = "";
    let riskSectionFilter = "all";
    let riskCompanyFilter = "all";
    let riskSortKey = "attention";   // default: pinakamaraming absent muna
    let riskSortDir = "desc";

    function getRiskPageList(totalPages, page) {

        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }

        const sorted =
            [...new Set([1, totalPages, page - 1, page, page + 1])]
                .filter(p => p >= 1 && p <= totalPages)
                .sort((a, b) => a - b);

        const result = [];

        sorted.forEach((p, i) => {
            if (i > 0 && p - sorted[i - 1] > 1) result.push("...");
            result.push(p);
        });

        return result;

    }

    function renderRiskPagination(total, startIndex, shown) {

        const footer = document.getElementById("riskListFooter");

        if (!footer) return;

        if (total === 0) {
            footer.style.display = "none";
            return;
        }

        footer.style.display = "flex";

        const totalPages = Math.max(1, Math.ceil(total / riskRowsPerPage));

        const info = document.getElementById("riskPaginationInfo");
        const numbers = document.getElementById("riskPageNumbers");
        const prev = document.getElementById("riskPrevPageBtn");
        const next = document.getElementById("riskNextPageBtn");

        if (info) {
            info.textContent =
                `Showing ${startIndex + 1} to ${startIndex + shown} of ${total} students`;
        }

        if (numbers) {
            numbers.innerHTML =
                getRiskPageList(totalPages, riskPage)
                    .map(p =>
                        p === "..."
                            ? `<span style="padding:0 4px;color:#999;">…</span>`
                            : `<button type="button" class="page-num ${p === riskPage ? "active" : ""}" data-risk-page="${p}">${p}</button>`
                    )
                    .join("");
        }

        if (prev) prev.disabled = riskPage <= 1;
        if (next) next.disabled = riskPage >= totalPages;

    }

    function goToRiskPage(page) {

        riskPage = Math.max(1, page);

        renderStatusStudents(riskLastRecords, riskLastCategory, true);

    }

    // Ibalik sa default ang search/filter/sort
    function resetRiskFilters() {

        riskSearch = "";
        riskSectionFilter = "all";
        riskCompanyFilter = "all";
        riskSortKey = "attention";
        riskSortDir = "desc";

        const searchEl = document.getElementById("riskSearch");
        if (searchEl) searchEl.value = "";

    }

    // Punuin ang Section at Company dropdown galing sa mga
    // estudyante ng kasalukuyang status.
    function fillRiskFilterOptions(list) {

        const sectionEl = document.getElementById("riskSectionFilter");
        const companyEl = document.getElementById("riskCompanyFilter");

        const build = (el, allLabel, values, current) => {

            if (!el) return current;

            const unique =
                [...new Set(values.filter(Boolean))]
                    .sort((a, b) =>
                        a.localeCompare(b, undefined, { numeric: true })
                    );

            el.innerHTML =
                `<option value="all">${allLabel}</option>` +
                unique
                    .map(v =>
                        `<option value="${escapeHtml(v.toLowerCase())}">${escapeHtml(v)}</option>`
                    )
                    .join("");

            const keep =
                unique.some(v => v.toLowerCase() === current) ? current : "all";

            el.value = keep;

            return keep;

        };

        riskSectionFilter = build(
            sectionEl,
            "All Sections",
            list.map(i => formatSection(i.section)),
            riskSectionFilter
        );

        riskCompanyFilter = build(
            companyEl,
            "All Companies",
            list.map(i => String(i.company || "").trim()),
            riskCompanyFilter
        );

    }

    function compareRiskRows(a, b) {

        const text = (x, y) =>
            String(x || "").localeCompare(
                String(y || ""),
                undefined,
                { numeric: true, sensitivity: "base" }
            );

        const absent = i => Number(i.absentCount) || 0;
        const streak = i => Number(i.consecutiveAbsences) || 0;

        let result = 0;

        switch (riskSortKey) {

            case "name":    result = text(a.name, b.name); break;
            case "course":  result = text(a.course, b.course); break;
            case "section": result = text(formatSection(a.section), formatSection(b.section)); break;
            case "company": result = text(a.company, b.company); break;

            case "absences":
                result = absent(a) - absent(b) || streak(a) - streak(b);
                break;

            default: // "attention"
                result = streak(a) - streak(b) || absent(a) - absent(b);

        }

        if (result === 0) result = text(a.name, b.name);

        return riskSortDir === "asc" ? result : -result;

    }

    function riskHeaderCell(key, label) {

        const plainHeaderKeys = ["course", "section", "company"];
        if (plainHeaderKeys.includes(key)) {
            // Text lang - hindi sortable ang Course, Section, Company
            return `<th>${label}</th>`;
        }
        const active = riskSortKey === key;

        const arrow =
            active
                ? `<i class="fa-solid fa-arrow-${riskSortDir === "asc" ? "up" : "down"} risk-sort-ind"></i>`
                : `<i class="fa-solid fa-sort risk-sort-ind muted"></i>`;

        return `<th class="sortable-th" data-risk-sort="${key}">${label}${arrow}</th>`;

    }

    function renderStatusStudents(
        records,
        category,
        keepPage = false
    ) {

        const riskContainer =
            document.getElementById("riskStudentsContainer");

        const titleElement =
            document.getElementById("studentStatusListTitle");

        const toolbar =
            document.getElementById("riskToolbar");

        if (!riskContainer) return;

        // Ibang status ang pinili -> reset page, filters at sort
        if (!keepPage && category !== riskLastCategory) {
            riskPage = 1;
            resetRiskFilters();
        }

        riskLastCategory = category;
        riskLastRecords = records;

        const config = getStatusConfig(category);

        const categoryList =
            records.filter(
                item => getStudentStatusCategory(item) === category
            );

        if (titleElement) {
            titleElement.textContent = config.title;
        }

        if (categoryList.length === 0) {

            if (toolbar) toolbar.style.display = "none";

            riskContainer.innerHTML = `
                <div style="padding:20px;text-align:center;color:#777;">
                    ${config.empty}
                </div>
            `;

            renderRiskPagination(0, 0, 0);

            return;

        }

        if (toolbar) toolbar.style.display = "flex";

        fillRiskFilterOptions(categoryList);

        const keyword = riskSearch.toLowerCase().trim();

        const filteredList =
            categoryList
                .filter(item => {

                    const name = String(item.name || "").toLowerCase();
                    const sid = String(item.studentId || "").toLowerCase();
                    const section = formatSection(item.section).toLowerCase();
                    const company = String(item.company || "").trim().toLowerCase();

                    return (
                        (!keyword || name.includes(keyword) || sid.includes(keyword)) &&
                        (riskSectionFilter === "all" || section === riskSectionFilter) &&
                        (riskCompanyFilter === "all" || company === riskCompanyFilter)
                    );

                })
                .sort(compareRiskRows);

        if (filteredList.length === 0) {

            riskContainer.innerHTML = `
                <div style="padding:20px;text-align:center;color:#777;">
                    No students match your search or filters.
                </div>
            `;

            renderRiskPagination(0, 0, 0);

            return;

        }

        const riskTotalPages =
            Math.max(1, Math.ceil(filteredList.length / riskRowsPerPage));

        if (riskPage > riskTotalPages) riskPage = riskTotalPages;

        const riskStart = (riskPage - 1) * riskRowsPerPage;

        const pagedList =
            filteredList.slice(riskStart, riskStart + riskRowsPerPage);

        renderRiskPagination(filteredList.length, riskStart, pagedList.length);

        const rowsHtml =
            pagedList
                .map((item, index) => {

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
                        <tr
                            class="risk-table-row"
                            data-student-id="${escapeHtml(item.id)}"
                            tabindex="0"
                            style="cursor:pointer;"
                            title="Click to view attendance history"
                        >

                            <td class="risk-num-cell">${riskStart + index + 1}</td>

                            <td>
                                <strong>${escapeHtml(item.name || "Student")}</strong>
                                <br>
                                <small style="color:#777;">
                                    ${escapeHtml(item.studentId)}
                                </small>
                            </td>

                            <td>${escapeHtml(item.course)}</td>

                            <td>${escapeHtml(formatSection(item.section))}</td>

                            <td>${escapeHtml(item.company)}</td>

                            <td>
                                <div class="risk-attendance">
                                    ${renderAbsenceBadge(item)}
                                    ${renderStreakBadge(item)}
                                </div>
                            </td>

                            <td class="risk-reason-cell">
                                ${config.icon ? `<i
                                    class="fa-solid ${config.icon}"
                                    style="color:${config.iconColor};margin-right:5px;"
                                ></i>` : ""}
                                ${escapeHtml(reason)}
                            </td>

                            <td>
                                <span class="status ${config.badgeClass}">
                                    ${config.badge}
                                </span>
                            </td>

                        </tr>
                    `;

                })
                .join("");

        riskContainer.innerHTML = `
            <div class="table-container">
                <table class="students-table risk-table">
                    <thead>
                        <tr>
                            <th class="risk-num-cell">#</th>
                            ${riskHeaderCell("name", "Student Name")}
                            ${riskHeaderCell("course", "Course")}
                            ${riskHeaderCell("section", "Section")}
                            ${riskHeaderCell("company", "Company")}
                            ${riskHeaderCell("absences", "Absences")}
                            <th>AI Reason</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;

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
    // COMPLETION FORECAST
    //
    // Binabasa ang forecast na kinompute ng
    // /api/predict-risk (app.py): estimated completion
    // date base sa kasalukuyang pace ng estudyante, at
    // kung kaya pa ba niyang humabol bago ang deadline.
    // ==========================================

    const FORECAST_META = {
        miss:      { label: "Will Miss Deadline", cls: "fc-miss",     icon: "fa-circle-xmark",       order: 0 },
        speed_up:  { label: "Needs to Speed Up",  cls: "fc-speed",    icon: "fa-gauge-high",         order: 1 },
        catch_up:  { label: "Can Catch Up",       cls: "fc-catch",    icon: "fa-person-running",     order: 2 },
        too_early: { label: "Too Early",          cls: "fc-early",    icon: "fa-hourglass-start",    order: 3 },
        on_time:   { label: "On Time",            cls: "fc-ontime",   icon: "fa-circle-check",       order: 4 },
        completed: { label: "Completed",          cls: "fc-done",     icon: "fa-flag-checkered",     order: 5 }
    };

    let forecastPage = 1;
    let forecastRowsPerPage = 6;
    let forecastFilterValue = "all";
    let forecastSearch = "";
    let forecastSectionFilter = "all";
    let forecastCompanyFilter = "all";
    let forecastSortKey = "forecast";   // default: pinakamalala muna
    let forecastSortDir = "asc";

    function formatForecastDate(value) {

        if (!value) return "—";

        const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);

        if (Number.isNaN(d.getTime())) return "—";

        return d.toLocaleDateString("en-PH", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });

    }

    // Hindi kasama sa Completion Forecast:
    //  - mga nasa Completed Batch Archive na
    //  - mga pending / invited / disabled (wala pang access sa system)
    // Defensive check ito kahit nasala na ng backend.
    function isExcludedFromForecast(item) {

        if (!item) return true;

        if (
            item.archived === true ||
            item.isArchived === true ||
            item.archivedAt ||
            item.archivedDate
        ) {
            return true;
        }

        if (item.pending === true || item.isPending === true) {
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

        return [
            "status", "accountStatus", "approvalStatus",
            "registrationStatus", "inviteStatus",
            "invitationStatus", "accessStatus"
        ].some(field => {
            const value = String(item[field] || "").trim().toLowerCase();
            return pendingValues.includes(value) || value.includes("archiv");
        });

    }

    function getForecastKey(item) {

        if (item.forecast && FORECAST_META[item.forecast]) {
            return item.forecast;
        }

        // Fallback para sa mga record na walang forecast (hal. sample data)
        if ((item.aiStatus || "").toLowerCase().includes("completed")) {
            return "completed";
        }

        return null;

    }

    function forecastNote(item, key) {

        const needed = Number(item.hoursPerDutyDayNeeded);
        const hasNeeded = Number.isFinite(needed) && item.hoursPerDutyDayNeeded !== null;

        switch (key) {

            case "on_time": {
                const early = Number(item.daysEarly) || 0;
                return early > 0
                    ? `Finishes ${early} day${early === 1 ? "" : "s"} before the deadline`
                    : "Finishes right at the deadline";
            }

            case "catch_up":
                return hasNeeded
                    ? `Behind pace, but only ~${needed} hrs per duty day is needed`
                    : "Behind pace, but still has time to catch up";

            case "speed_up":
                return hasNeeded
                    ? `Needs ~${needed} hrs per duty day to finish in time`
                    : "Needs to speed up to finish in time";

            case "miss": {
                if ((Number(item.dutyDaysLeft) || 0) <= 0) {
                    return "Deadline reached with hours still remaining";
                }
                return hasNeeded
                    ? `Would need ~${needed} hrs per duty day - more than a full duty day`
                    : "Cannot finish the remaining hours in time";
            }

            case "too_early":
                return "Just started - not enough data yet";

            case "completed":
                return "Required hours completed";

        }

        return "";

    }

    function getForecastPageList(totalPages, page) {

        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }

        const sorted =
            [...new Set([1, totalPages, page - 1, page, page + 1])]
                .filter(p => p >= 1 && p <= totalPages)
                .sort((a, b) => a - b);

        const result = [];

        sorted.forEach((p, i) => {
            if (i > 0 && p - sorted[i - 1] > 1) result.push("...");
            result.push(p);
        });

        return result;

    }

    function showForecastError(message) {

        const body = document.getElementById("completionForecastTable");

        if (body) {
            body.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align:center;color:#dc2626;padding:30px;">
                        ${escapeHtml(message)}
                    </td>
                </tr>
            `;
        }

        const footer = document.getElementById("forecastFooter");
        if (footer) footer.style.display = "none";

        const summary = document.getElementById("forecastSummary");
        if (summary) summary.innerHTML = "";

    }

    // Ibalik sa default ang search/filter/sort
    function resetForecastFilters() {

        forecastSearch = "";
        forecastFilterValue = "all";
        forecastSectionFilter = "all";
        forecastCompanyFilter = "all";
        forecastSortKey = "forecast";
        forecastSortDir = "asc";

        const searchEl = document.getElementById("forecastSearch");
        if (searchEl) searchEl.value = "";

        const statusEl = document.getElementById("forecastFilter");
        if (statusEl) statusEl.value = "all";

    }

    // Punuin ang Section at Company dropdown galing sa mga estudyante
    function fillForecastFilterOptions(list) {

        const sectionEl = document.getElementById("forecastSectionFilter");
        const companyEl = document.getElementById("forecastCompanyFilter");

        const build = (el, allLabel, values, current) => {

            if (!el) return current;

            const unique =
                [...new Set(values.filter(Boolean))]
                    .sort((a, b) =>
                        a.localeCompare(b, undefined, { numeric: true })
                    );

            el.innerHTML =
                `<option value="all">${allLabel}</option>` +
                unique
                    .map(v =>
                        `<option value="${escapeHtml(v.toLowerCase())}">${escapeHtml(v)}</option>`
                    )
                    .join("");

            const keep =
                unique.some(v => v.toLowerCase() === current) ? current : "all";

            el.value = keep;

            return keep;

        };

        forecastSectionFilter = build(
            sectionEl,
            "All Sections",
            list.map(i => formatSection(i.section)),
            forecastSectionFilter
        );

        forecastCompanyFilter = build(
            companyEl,
            "All Companies",
            list.map(i => String(i.company || "").trim()),
            forecastCompanyFilter
        );

    }

    function getForecastRemaining(item, key) {

        if (key === "completed") return 0;

        if (item.hoursRemaining !== undefined && item.hoursRemaining !== null) {
            return Number(item.hoursRemaining) || 0;
        }

        const target = Number(item.targetHours) || 600;
        const current = Number(item.currentHours) || 0;

        return Math.max(target - current, 0);

    }

    function forecastDateValue(value) {

        if (!value) return Infinity;

        const t = new Date(`${String(value).slice(0, 10)}T00:00:00`).getTime();

        return Number.isNaN(t) ? Infinity : t;

    }

    function compareForecastRows(a, b) {

        const text = (x, y) =>
            String(x || "").localeCompare(
                String(y || ""),
                undefined,
                { numeric: true, sensitivity: "base" }
            );

        const progress = r => Number(r.item.progress) || 0;

        let result = 0;

        switch (forecastSortKey) {

            case "name":    result = text(a.item.name, b.item.name); break;
            case "course":  result = text(a.item.course, b.item.course); break;
            case "section": result = text(formatSection(a.item.section), formatSection(b.item.section)); break;
            case "company": result = text(a.item.company, b.item.company); break;

            case "progress":
                result = progress(a) - progress(b);
                break;

            case "remaining":
                result =
                    getForecastRemaining(a.item, a.key) -
                    getForecastRemaining(b.item, b.key);
                break;

            case "estimated": {
                const x = a.key === "completed" ? -Infinity : forecastDateValue(a.item.estimatedCompletion);
                const y = b.key === "completed" ? -Infinity : forecastDateValue(b.item.estimatedCompletion);
                result = x === y ? 0 : (x < y ? -1 : 1);
                break;
            }

            case "deadline": {
                const x = forecastDateValue(a.item.deadline);
                const y = forecastDateValue(b.item.deadline);
                result = x === y ? 0 : (x < y ? -1 : 1);
                break;
            }

            default: // "forecast" - pinakamalala muna, tapos pinakakaunting progress
                result =
                    FORECAST_META[a.key].order - FORECAST_META[b.key].order ||
                    progress(a) - progress(b);

        }

        if (result === 0) result = text(a.item.name, b.item.name);

        return forecastSortDir === "asc" ? result : -result;

    }

    function forecastHeaderCell(key, label) {

        const plainHeaderKeys = ["course", "section", "company"];
        if (plainHeaderKeys.includes(key)) {
            // Text lang - hindi sortable ang Course, Section, Company
            return `<th>${label}</th>`;
        }
        const active = forecastSortKey === key;

        const arrow =
            active
                ? `<i class="fa-solid fa-arrow-${forecastSortDir === "asc" ? "up" : "down"} risk-sort-ind"></i>`
                : `<i class="fa-solid fa-sort risk-sort-ind muted"></i>`;

        return `<th class="sortable-th" data-forecast-sort="${key}">${label}${arrow}</th>`;

    }

    function renderForecastHead() {

        const head = document.getElementById("forecastHead");

        if (!head) return;

        head.innerHTML = `
            <tr>
                <th class="risk-num-cell">#</th>
                ${forecastHeaderCell("name", "Student Name")}
                ${forecastHeaderCell("course", "Course")}
                ${forecastHeaderCell("section", "Section")}
                ${forecastHeaderCell("company", "Company")}
                ${forecastHeaderCell("progress", "Progress")}
                ${forecastHeaderCell("remaining", "Remaining Hours")}
                ${forecastHeaderCell("estimated", "Estimated Completion")}
                ${forecastHeaderCell("deadline", "Deadline")}
                ${forecastHeaderCell("forecast", "Forecast")}
            </tr>
        `;

    }

    function renderCompletionForecast() {

        const body = document.getElementById("completionForecastTable");

        if (!body) return;

        const summaryEl = document.getElementById("forecastSummary");
        const footer = document.getElementById("forecastFooter");

        const all =
            globalStudentRecords
                .filter(item => !isExcludedFromForecast(item))
                .map(item => ({ item, key: getForecastKey(item) }))
                .filter(row => row.key);

        // SUMMARY CHIPS
        if (summaryEl) {

            const counts = {};

            all.forEach(row => {
                counts[row.key] = (counts[row.key] || 0) + 1;
            });

            summaryEl.innerHTML =
                Object.entries(FORECAST_META)
                    .filter(([key]) => counts[key])
                    .map(([key, meta]) => `
                        <span class="forecast-chip ${meta.cls}">
                            <i class="fa-solid ${meta.icon}"></i>
                            ${meta.label}: <strong>${counts[key]}</strong>
                        </span>
                    `)
                    .join("");

        }

        // SECTION / COMPANY DROPDOWN OPTIONS
        fillForecastFilterOptions(all.map(row => row.item));

        // SORTABLE HEADERS
        renderForecastHead();

        // SEARCH + FILTERS + SORT
        const keyword = forecastSearch.toLowerCase().trim();

        const rows =
            all
                .filter(({ item, key }) => {

                    const name = String(item.name || "").toLowerCase();
                    const sid = String(item.studentId || "").toLowerCase();
                    const section = formatSection(item.section).toLowerCase();
                    const company = String(item.company || "").trim().toLowerCase();

                    return (
                        (forecastFilterValue === "all" || key === forecastFilterValue) &&
                        (!keyword || name.includes(keyword) || sid.includes(keyword)) &&
                        (forecastSectionFilter === "all" || section === forecastSectionFilter) &&
                        (forecastCompanyFilter === "all" || company === forecastCompanyFilter)
                    );

                })
                .sort(compareForecastRows);

        if (rows.length === 0) {

            body.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align:center;color:#777;padding:30px;">
                        ${all.length === 0
                            ? "No forecast data available yet."
                            : "No students match your search or filters."}
                    </td>
                </tr>
            `;

            if (footer) footer.style.display = "none";

            return;

        }

        const totalPages = Math.max(1, Math.ceil(rows.length / forecastRowsPerPage));

        if (forecastPage > totalPages) forecastPage = totalPages;

        const start = (forecastPage - 1) * forecastRowsPerPage;
        const pageRows = rows.slice(start, start + forecastRowsPerPage);

        body.innerHTML =
            pageRows
                .map(({ item, key }, index) => {

                    const meta = FORECAST_META[key];

                    const progress = Math.min(Number(item.progress) || 0, 100);

                    const target = Number(item.targetHours) || 600;
                    const current = Number(item.currentHours) || 0;

                    const remaining = getForecastRemaining(item, key);

                    let barClass = "";
                    if (key === "miss") barClass = "danger";
                    else if (key === "speed_up" || key === "catch_up") barClass = "warning";
                    else if (key === "completed") barClass = "complete";

                    let estimated = "—";

                    if (key === "completed") {
                        estimated = "Done";
                    } else if (item.estimatedCompletion) {
                        estimated = formatForecastDate(item.estimatedCompletion);
                    } else if (key === "too_early") {
                        estimated = "Not enough data";
                    } else {
                        estimated = "No pace yet";
                    }

                    const late = Number(item.daysLate) || 0;

                    const lateNote =
                        late > 0
                            ? `<br><small class="fc-late">${late} day${late === 1 ? "" : "s"} after the deadline</small>`
                            : "";

                    return `
                        <tr
                            class="risk-table-row"
                            data-student-id="${escapeHtml(item.id)}"
                            tabindex="0"
                            style="cursor:pointer;"
                            title="Click to view attendance history"
                        >
                            <td class="risk-num-cell">${start + index + 1}</td>

                            <td>
                                <strong>${escapeHtml(item.name || "Student")}</strong>
                                <br>
                                <small style="color:#777;">${escapeHtml(item.studentId)}</small>
                            </td>

                            <td>${escapeHtml(item.course)}</td>

                            <td>${escapeHtml(formatSection(item.section))}</td>

                            <td>${escapeHtml(item.company)}</td>

                            <td>
                                <div class="progress-wrapper">
                                    <div class="progress">
                                        <div class="progress-bar ${barClass}" style="width:${progress}%;"></div>
                                    </div>
                                    <span class="progress-value">${progress}%</span>
                                </div>
                                <small style="color:#777;">${escapeHtml(current)} / ${escapeHtml(target)} hrs</small>
                            </td>

                            <td>${key === "completed" ? "0 hrs" : `${escapeHtml(remaining)} hrs`}</td>

                            <td>${escapeHtml(estimated)}${lateNote}</td>

                            <td>${escapeHtml(formatForecastDate(item.deadline))}</td>

                            <td>
                                <span class="forecast-badge ${meta.cls}">${meta.label}</span>
                                <br>
                                <small class="fc-note">${escapeHtml(forecastNote(item, key))}</small>
                            </td>
                        </tr>
                    `;

                })
                .join("");

        // PAGINATION
        if (footer) footer.style.display = "flex";

        const info = document.getElementById("forecastPaginationInfo");
        const numbers = document.getElementById("forecastPageNumbers");
        const prev = document.getElementById("forecastPrevBtn");
        const next = document.getElementById("forecastNextBtn");

        if (info) {
            info.textContent =
                `Showing ${start + 1} to ${start + pageRows.length} of ${rows.length} students`;
        }

        if (numbers) {
            numbers.innerHTML =
                getForecastPageList(totalPages, forecastPage)
                    .map(p =>
                        p === "..."
                            ? `<span style="padding:0 4px;color:#999;">…</span>`
                            : `<button type="button" class="page-num ${p === forecastPage ? "active" : ""}" data-forecast-page="${p}">${p}</button>`
                    )
                    .join("");
        }

        if (prev) prev.disabled = forecastPage <= 1;
        if (next) next.disabled = forecastPage >= totalPages;

    }

    function goToForecastPage(page) {

        forecastPage = Math.max(1, page);

        renderCompletionForecast();

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
                        await apiFetch(
                            "/api/recommend-company",
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
    // COMPLETION FORECAST EVENTS
    // ==========================================

    const forecastFilterEl = document.getElementById("forecastFilter");
    const forecastRowsEl = document.getElementById("forecastRowsPerPage");
    const forecastPrevEl = document.getElementById("forecastPrevBtn");
    const forecastNextEl = document.getElementById("forecastNextBtn");
    const forecastNumbersEl = document.getElementById("forecastPageNumbers");

    if (forecastFilterEl) {
        forecastFilterEl.addEventListener("change", () => {
            forecastFilterValue = forecastFilterEl.value;
            goToForecastPage(1);
        });
    }

    if (forecastRowsEl) {
        forecastRowsEl.addEventListener("change", () => {
            forecastRowsPerPage = parseInt(forecastRowsEl.value, 10) || 6;
            goToForecastPage(1);
        });
    }

    if (forecastPrevEl) {
        forecastPrevEl.addEventListener("click", () => goToForecastPage(forecastPage - 1));
    }

    if (forecastNextEl) {
        forecastNextEl.addEventListener("click", () => goToForecastPage(forecastPage + 1));
    }

    if (forecastNumbersEl) {
        forecastNumbersEl.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-forecast-page]");
            if (btn) goToForecastPage(parseInt(btn.dataset.forecastPage, 10));
        });
    }

    // SEARCH / SECTION / COMPANY / RESET (kapareho ng Students Requiring Attention)
    const forecastSearchEl = document.getElementById("forecastSearch");
    const forecastSectionEl = document.getElementById("forecastSectionFilter");
    const forecastCompanyEl = document.getElementById("forecastCompanyFilter");
    const forecastResetEl = document.getElementById("forecastResetFilters");

    if (forecastSearchEl) {
        forecastSearchEl.addEventListener("input", () => {
            forecastSearch = forecastSearchEl.value;
            goToForecastPage(1);
        });
    }

    if (forecastSectionEl) {
        forecastSectionEl.addEventListener("change", () => {
            forecastSectionFilter = forecastSectionEl.value;
            goToForecastPage(1);
        });
    }

    if (forecastCompanyEl) {
        forecastCompanyEl.addEventListener("change", () => {
            forecastCompanyFilter = forecastCompanyEl.value;
            goToForecastPage(1);
        });
    }

    if (forecastResetEl) {
        forecastResetEl.addEventListener("click", () => {
            resetForecastFilters();
            goToForecastPage(1);
        });
    }

    // FILTER / SORT BUTTONS (popover)
    const forecastPopovers = [
        { btn: document.getElementById("forecastFilterBtn"), panel: document.getElementById("forecastFilterPanel") },
        { btn: document.getElementById("forecastSortBtn"),   panel: document.getElementById("forecastSortPanel") }
    ].filter(p => p.btn && p.panel);

    function closeForecastPopovers(except) {
        forecastPopovers.forEach(p => {
            if (p === except) return;
            p.panel.hidden = true;
            p.btn.setAttribute("aria-expanded", "false");
            p.btn.classList.remove("open");
        });
    }

    function syncForecastSortPanel() {
        document.querySelectorAll("#forecastSortPanel [data-sort-key]").forEach(b => {
            b.classList.toggle("active", b.dataset.sortKey === forecastSortKey);
        });
        document.querySelectorAll("#forecastSortPanel [data-sort-dir]").forEach(b => {
            b.classList.toggle("active", b.dataset.sortDir === forecastSortDir);
        });
    }

    function syncForecastFilterBtn() {
        const btn = document.getElementById("forecastFilterBtn");
        if (!btn) return;
        btn.classList.toggle("has-active",
            forecastFilterValue !== "all" ||
            forecastSectionFilter !== "all" ||
            forecastCompanyFilter !== "all");
    }

    forecastPopovers.forEach(p => {
        p.btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const willOpen = p.panel.hidden;
            closeForecastPopovers(p);
            p.panel.hidden = !willOpen;
            p.btn.setAttribute("aria-expanded", String(willOpen));
            p.btn.classList.toggle("open", willOpen);
            if (willOpen) syncForecastSortPanel();
        });
        p.panel.addEventListener("click", (e) => e.stopPropagation());
    });

    document.addEventListener("click", () => closeForecastPopovers(null));
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeForecastPopovers(null);
    });

    document.querySelectorAll("#forecastSortPanel [data-sort-key]").forEach(b => {
        b.addEventListener("click", () => {
            forecastSortKey = b.dataset.sortKey;
            syncForecastSortPanel();
            goToForecastPage(1);
        });
    });

    document.querySelectorAll("#forecastSortPanel [data-sort-dir]").forEach(b => {
        b.addEventListener("click", () => {
            forecastSortDir = b.dataset.sortDir;
            syncForecastSortPanel();
            goToForecastPage(1);
        });
    });

    ["forecastFilter", "forecastSectionFilter", "forecastCompanyFilter", "forecastResetFilters"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(id === "forecastResetFilters" ? "click" : "change", () => {
            setTimeout(() => { syncForecastFilterBtn(); syncForecastSortPanel(); }, 0);
        });
    });

    // SORT (header click) at OPEN ATTENDANCE MODAL (row click / Enter / Space)
    const forecastTableEl = document.getElementById("forecastTable");

    if (forecastTableEl) {

        forecastTableEl.addEventListener("click", (e) => {

            const th = e.target.closest("th[data-forecast-sort]");

            if (th) {

                const key = th.dataset.forecastSort;

                if (forecastSortKey === key) {
                    forecastSortDir = forecastSortDir === "asc" ? "desc" : "asc";
                } else {
                    forecastSortKey = key;
                    forecastSortDir = "asc";
                }

                goToForecastPage(1);
                return;

            }

            const row = e.target.closest("tr[data-student-id]");

            if (row && row.dataset.studentId) {
                window.openAttendanceModal(row.dataset.studentId);
            }

        });

        forecastTableEl.addEventListener("keydown", (e) => {

            if (e.key !== "Enter" && e.key !== " ") return;

            const row = e.target.closest("tr[data-student-id]");

            if (row && row.dataset.studentId) {
                e.preventDefault();
                window.openAttendanceModal(row.dataset.studentId);
            }

        });

    }


    // ==========================================
    // INITIALIZE CLICKABLE CARDS
    // ==========================================

    initStatusCards();


    // ==========================================
    // STATUS LIST PAGINATION EVENTS
    // ==========================================

    const riskRowsSelect = document.getElementById("riskRowsPerPageSelect");
    const riskPrevBtn = document.getElementById("riskPrevPageBtn");
    const riskNextBtn = document.getElementById("riskNextPageBtn");
    const riskNumbers = document.getElementById("riskPageNumbers");

    const riskSearchInput = document.getElementById("riskSearch");
    const riskSectionSelect = document.getElementById("riskSectionFilter");
    const riskCompanySelect = document.getElementById("riskCompanyFilter");
    const riskResetBtn = document.getElementById("riskResetFilters");

    function rerenderRiskList() {
        riskPage = 1;
        renderStatusStudents(riskLastRecords, riskLastCategory, true);
    }

    if (riskSearchInput) {
        riskSearchInput.addEventListener("input", () => {
            riskSearch = riskSearchInput.value;
            rerenderRiskList();
        });
    }

    if (riskSectionSelect) {
        riskSectionSelect.addEventListener("change", () => {
            riskSectionFilter = riskSectionSelect.value;
            rerenderRiskList();
        });
    }

    if (riskCompanySelect) {
        riskCompanySelect.addEventListener("change", () => {
            riskCompanyFilter = riskCompanySelect.value;
            rerenderRiskList();
        });
    }

    if (riskResetBtn) {
        riskResetBtn.addEventListener("click", () => {
            resetRiskFilters();
            rerenderRiskList();
        });
    }

    if (riskRowsSelect) {
        riskRowsSelect.addEventListener("change", () => {
            riskRowsPerPage = parseInt(riskRowsSelect.value, 10) || 5;
            goToRiskPage(1);
        });
    }

    if (riskPrevBtn) {
        riskPrevBtn.addEventListener("click", () => goToRiskPage(riskPage - 1));
    }

    if (riskNextBtn) {
        riskNextBtn.addEventListener("click", () => goToRiskPage(riskPage + 1));
    }

    if (riskNumbers) {
        riskNumbers.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-risk-page]");
            if (btn) goToRiskPage(parseInt(btn.dataset.riskPage, 10));
        });
    }


    // ==========================================
    // CLICK / KEYBOARD -> OPEN ATTENDANCE MODAL
    // Event delegation dahil pinapalitan ng innerHTML
    // ang laman ng riskStudentsContainer paulit-ulit
    // ==========================================

    const riskStudentsContainer =
        document.getElementById("riskStudentsContainer");

    if (riskStudentsContainer) {

        riskStudentsContainer.addEventListener(
            "click",
            (e) => {

                // Sort kapag header ang na-click
                const th = e.target.closest("th[data-risk-sort]");

                if (th) {

                    const key = th.dataset.riskSort;

                    if (riskSortKey === key) {
                        riskSortDir = riskSortDir === "asc" ? "desc" : "asc";
                    } else {
                        riskSortKey = key;
                        riskSortDir = "asc";
                    }

                    riskPage = 1;
                    renderStatusStudents(riskLastRecords, riskLastCategory, true);
                    return;

                }

                const row = e.target.closest("tr[data-student-id]");

                if (row && row.dataset.studentId) {
                    window.openAttendanceModal(row.dataset.studentId);
                }

            }
        );

        riskStudentsContainer.addEventListener(
            "keydown",
            (e) => {

                if (e.key !== "Enter" && e.key !== " ") return;

                const row = e.target.closest("tr[data-student-id]");

                if (row && row.dataset.studentId) {
                    e.preventDefault();
                    window.openAttendanceModal(row.dataset.studentId);
                }

            }
        );

    }


    // ==========================================
    // INITIAL LOAD
    // ==========================================

    fetchAllStudents();

});


// ==========================================
// STUDENT ATTENDANCE MODAL
// (Present/Absent by date - line graph)
// ==========================================

let attendanceChartInstance = null;

window.openAttendanceModal =
    async function(studentId) {

        const modal =
            document.getElementById("attendanceModal");

        const nameEl =
            document.getElementById("attendanceModalName");

        const subtitleEl =
            document.getElementById("attendanceModalSubtitle");

        const summaryRow =
            document.getElementById("attendanceSummaryRow");

        const loadingEl =
            document.getElementById("attendanceModalLoading");

        const chartEmptyEl =
            document.getElementById("attendanceChartEmpty");

        const canvas =
            document.getElementById("attendanceLineChart");

        if (!modal || !studentId) return;

        // RESET STATE
        modal.style.display = "block";
        if (loadingEl) loadingEl.style.display = "block";
        if (chartEmptyEl) chartEmptyEl.style.display = "none";
        if (canvas) canvas.style.display = "none";
        if (summaryRow) summaryRow.innerHTML = "";
        if (nameEl) nameEl.textContent = "Loading...";
        if (subtitleEl) subtitleEl.textContent = "";

        if (attendanceChartInstance) {
            attendanceChartInstance.destroy();
            attendanceChartInstance = null;
        }

        try {

            const response =
                await apiFetch(
                    `/api/student-attendance/${encodeURIComponent(studentId)}`
                );

            const result =
                await response.json();

            if (loadingEl) loadingEl.style.display = "none";

            if (result.status !== "success") {

                if (nameEl) nameEl.textContent = "Unable to load attendance";
                if (subtitleEl) {
                    subtitleEl.textContent =
                        result.message || "Unknown error from server.";
                }
                return;

            }

            const student = result.student || {};
            const attendance = result.attendance || [];
            const summary = result.summary || {};

            if (nameEl) {
                nameEl.textContent =
                    student.name || "Student Attendance";
            }

            if (subtitleEl) {
                subtitleEl.textContent =
                    [student.studentId, student.course, formatSection(student.section), student.company]
                        .filter(Boolean)
                        .join(" · ");
            }

            if (summaryRow) {

                summaryRow.innerHTML = `
                    <span
                        class="absence-badge"
                        style="background:#e8f7ee;color:#1e8449;border-color:#c6efd7;"
                    >
                        <i class="fa-solid fa-calendar-check"></i>
                        ${summary.totalPresent || 0} present
                    </span>
                    <span class="absence-badge high">
                        <i class="fa-solid fa-calendar-xmark"></i>
                        ${summary.totalAbsent || 0} absent
                    </span>
                    ${
                        (summary.consecutiveAbsences || 0) > 0
                            ? `<span class="absence-badge high">
                                    <i class="fa-solid fa-triangle-exclamation"></i>
                                    ${summary.consecutiveAbsences} consecutive absences
                                </span>`
                            : ""
                    }
                `;

            }

            if (attendance.length === 0) {

                if (chartEmptyEl) chartEmptyEl.style.display = "block";
                if (canvas) canvas.style.display = "none";
                return;

            }

            if (canvas) canvas.style.display = "block";
            if (chartEmptyEl) chartEmptyEl.style.display = "none";

            const labels =
                attendance.map(rec => rec.date);

            const dataPoints =
                attendance.map(rec => rec.status === "present" ? 1 : 0);

            const pointColors =
                attendance.map(rec => rec.status === "present" ? "#27ae60" : "#e74c3c");

            if (canvas && window.Chart) {

                attendanceChartInstance = new Chart(canvas, {
                    type: "line",
                    data: {
                        labels: labels,
                        datasets: [{
                            label: "Attendance",
                            data: dataPoints,
                            stepped: true,
                            borderColor: "#ab0a0a",
                            backgroundColor: "rgba(171,10,10,0.08)",
                            pointBackgroundColor: pointColors,
                            pointBorderColor: pointColors,
                            pointRadius: 5,
                            pointHoverRadius: 7,
                            fill: true,
                            tension: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                min: -0.2,
                                max: 1.2,
                                ticks: {
                                    stepSize: 1,
                                    callback: (value) => {
                                        if (value === 1) return "Present";
                                        if (value === 0) return "Absent";
                                        return "";
                                    }
                                }
                            },
                            x: {
                                ticks: {
                                    autoSkip: true,
                                    maxRotation: 45,
                                    minRotation: 0
                                }
                            }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (context) =>
                                        context.parsed.y === 1 ? "Present" : "Absent"
                                }
                            }
                        }
                    }
                });

            }

        } catch (err) {

            console.error("Failed to load student attendance:", err);

            if (loadingEl) loadingEl.style.display = "none";
            if (nameEl) nameEl.textContent = "Unable to load attendance";
            if (subtitleEl) {
                subtitleEl.textContent =
                    "May problema sa pagkonekta sa server (http://localhost:5000). " +
                    "Siguraduhing tumatakbo ang backend (app.py).";
            }

        }

    };


window.closeAttendanceModal =
    function() {

        const modal =
            document.getElementById("attendanceModal");

        if (modal) modal.style.display = "none";

        if (attendanceChartInstance) {
            attendanceChartInstance.destroy();
            attendanceChartInstance = null;
        }

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


        const skillSummary =
            (compData.skills && compData.skills.length)
                ? compData.skills
                    .map(sk => `${sk.primarySkill} (${sk.exposure}%)`)
                    .join(" + ")
                : `${compData.primarySkill} (${compData.exposure}%)`;

        modalSubtitle.innerHTML =
            `Primary Skills:
            <strong>${skillSummary}</strong>`;


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

        const companyModal =
            document.getElementById(
                "companyModal"
            );

        const attendanceModal =
            document.getElementById(
                "attendanceModal"
            );


        if (
            event.target === companyModal
        ) {

            companyModal.style.display =
                "none";

        }


        if (
            event.target === attendanceModal
        ) {

            window.closeAttendanceModal();

        }

    };


// ==========================================
// ANALYTICS TABS
// Student Analysis | Completion Forecast | Graduated by Batch |
// Company Skill Exposure | Company Recommendation
// ==========================================

(function initAnalyticsTabs() {

    function setup() {

        const tabs = document.querySelectorAll(".analytics-tab");
        const panels = document.querySelectorAll(".analytics-tab-panel");

        if (!tabs.length) return;

        function showTab(name) {

            if (![...panels].some(p => p.dataset.panel === name)) {
                name = "students";
            }

            tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
            panels.forEach(p => p.classList.toggle("active", p.dataset.panel === name));

            // Ang mga chart na na-render habang nakatago ang tab
            // ay 0px ang laki, kaya i-resize pagka-show.
            if (window.Chart && typeof Chart.getChart === "function") {
                document
                    .querySelectorAll(`.analytics-tab-panel[data-panel="${name}"] canvas`)
                    .forEach(canvas => {
                        const chart = Chart.getChart(canvas);
                        if (chart) chart.resize();
                    });
            }

            try { history.replaceState(null, "", "#" + name); } catch (e) { /* ignore */ }

        }

        tabs.forEach(tab =>
            tab.addEventListener("click", () => showTab(tab.dataset.tab))
        );

        // Buksan ang tab na nasa URL hash (hal. analytics.html#skills)
        const fromHash = (location.hash || "").replace("#", "");
        if (fromHash) showTab(fromHash);

    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setup);
    } else {
        setup();
    }

})();