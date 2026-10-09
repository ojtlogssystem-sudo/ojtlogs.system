// =====================================================
// ATTENDANCE LIST (popup page ng bawat summary card)
//
// Ginagamit ng:
//   attendance_scheduled.html
//   attendance_present.html
//   attendance_late.html
//   attendance_absent.html
//
// Alin ang ipapakita ay galing sa <body data-type="...">
// =====================================================

import {
    loadScheduledUsers,
    subscribeAttendance,
    buildTodayRows,
    escapeHtml
} from "./attendance_shared.js";


const LIST_TYPES = {

    scheduled: {
        title: "Scheduled Today",
        statuses: null,                 // lahat ng naka-schedule
        empty: "No students are scheduled today."
    },

    present: {
        title: "Present Today",
        statuses: ["Present"],
        empty: "No students are marked present yet."
    },

    late: {
        title: "Late Today",
        statuses: ["Late"],
        empty: "No late students today."
    },

    absent: {
        title: "Absent Today",
        statuses: ["Absent"],
        empty: "No absent students today."
    }

};


document.addEventListener("DOMContentLoaded", () => {

    const type = document.body.dataset.type || "scheduled";

    const config = LIST_TYPES[type] || LIST_TYPES.scheduled;

    const titleEl = document.getElementById("listTitle");
    const subtitleEl = document.getElementById("listSubtitle");
    const countEl = document.getElementById("listCount");
    const searchInput = document.getElementById("listSearch");
    const tableBody = document.getElementById("listBody");
    const printBtn = document.getElementById("printBtn");
    const backBtn = document.getElementById("backBtn");

    const printTitleEl = document.getElementById("printTitle");
    const printMetaEl = document.getElementById("printMeta");

    let scheduledUsers = [];
    let attendanceDocs = [];
    let rows = [];

    let dataReady = false;
    let lastMinute = -1;
    let asOf = new Date();


    if (titleEl) titleEl.textContent = config.title;
    if (printTitleEl) printTitleEl.textContent = config.title;


    // "Back" button ay lalabas lang kapag nasa loob ng popup (iframe)
    if (backBtn) {

        if (window.parent !== window) {

            backBtn.hidden = false;

            backBtn.addEventListener("click", () => {
                window.parent.postMessage(
                    { type: "closeAttendanceListModal" },
                    "*"
                );
            });

        }

    }


    if (printBtn) {
        printBtn.addEventListener("click", () => window.print());
    }


    if (searchInput) {
        searchInput.addEventListener("input", render);
    }


    // =================================================
    // BUILD ROWS
    // =================================================

    function rebuild() {

        const now = new Date();

        lastMinute = now.getHours() * 60 + now.getMinutes();

        asOf = now;

        const all = buildTodayRows(scheduledUsers, attendanceDocs, now);

        rows = config.statuses
            ? all.filter((row) => config.statuses.includes(row.status))
            : all;

        render();
    }


    // =================================================
    // RENDER
    // =================================================

    function render() {

        const keyword = searchInput
            ? searchInput.value.toLowerCase().trim()
            : "";

        const visible = rows.filter((row) =>
            row.studentName.toLowerCase().includes(keyword) ||
            row.studentEmail.toLowerCase().includes(keyword) ||
            row.company.toLowerCase().includes(keyword) ||
            row.section.toLowerCase().includes(keyword)
        );


        const dateText = asOf.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });

        const timeText = asOf.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit"
        });

        if (subtitleEl) {
            subtitleEl.textContent = `${dateText} \u2022 as of ${timeText}`;
        }

        if (countEl) {
            countEl.textContent =
                `${visible.length} ${visible.length === 1 ? "student" : "students"}`;
        }

        if (printMetaEl) {
            printMetaEl.textContent =
                `${dateText}  |  Printed ${timeText}  |  Total: ${visible.length}`;
        }


        if (visible.length === 0) {

            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="empty-cell">
                        ${keyword ? "No matching students found." : config.empty}
                    </td>
                </tr>`;

            return;
        }


        tableBody.innerHTML = visible.map((row, index) => `
            <tr>
                <td>${index + 1}</td>

                <td>
                    <strong>${escapeHtml(row.studentName)}</strong>
                    <br>
                    <small>${escapeHtml(row.studentEmail)}</small>
                </td>

                <td>${escapeHtml(row.course)}</td>
                <td>${escapeHtml(row.section)}</td>
                <td>${escapeHtml(row.company)}</td>
                <td>${escapeHtml(row.scheduleText)}</td>
                <td>${escapeHtml(row.timeIn)}</td>
                <td>${escapeHtml(row.timeOut)}</td>
                <td>${escapeHtml(row.totalHours)}</td>

                <td>
                    <span class="status ${row.status.toLowerCase()}">
                        ${row.status}
                    </span>
                </td>
            </tr>
        `).join("");
    }


    // =================================================
    // RUN
    // =================================================

    // Kada bagong minuto, i-recompute (hal. Pending -> Absent)
    setInterval(() => {

        const now = new Date();

        const minuteKey = now.getHours() * 60 + now.getMinutes();

        if (dataReady && minuteKey !== lastMinute) {
            rebuild();
        }

    }, 1000);


    function showError() {

        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-cell" style="color:#e74c3c;">
                    Unable to load attendance records.
                </td>
            </tr>`;

    }


    (async function init() {

        try {

            scheduledUsers = await loadScheduledUsers();

            subscribeAttendance(
                (docs) => {

                    attendanceDocs = docs;

                    dataReady = true;

                    rebuild();

                },
                (error) => {

                    console.error("Attendance listener error:", error);

                    showError();

                }
            );

        } catch (error) {

            console.error("Error loading attendance list:", error);

            showError();

        }

    })();

});