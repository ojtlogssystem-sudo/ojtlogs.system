import {
    loadScheduledUsers,
    subscribeAttendance,
    buildTodayRows,
    buildRowsForRange,
    MAX_RANGE_DAYS,
    escapeHtml
} from "./attendance_shared.js";


// =====================================================
// PAGE
// =====================================================

document.addEventListener("DOMContentLoaded", () => {

    const attendanceTable = document.getElementById("attendanceTable");
    const searchInput = document.getElementById("attendanceSearch");
    const sectionFilter = document.getElementById("sectionFilter");
    const statusFilter = document.getElementById("statusFilter");
    const paginationInfo = document.getElementById("paginationInfo");
    const prevPageBtn = document.getElementById("prevPageBtn");
    const nextPageBtn = document.getElementById("nextPageBtn");
    const pageNumbers = document.getElementById("pageNumbers");
    const rowsPerPageSelect = document.getElementById("rowsPerPageSelect");

    const currentDateEl = document.getElementById("currentDate");
    const currentTimeEl = document.getElementById("currentTime");

    const fromDateInput = document.getElementById("fromDate");
    const toDateInput = document.getElementById("toDate");
    const applyRangeBtn = document.getElementById("applyRangeBtn");
    const tableTitle = document.getElementById("tableTitle");

    let scheduledUsers = [];      // lahat ng student na may valid na schedule
    let attendanceDocs = [];      // raw attendance docs (realtime)
    let todayRecords = [];        // rows para sa ngayong araw (summary cards)
    let allRecords = [];          // rows na ipapakita sa table (today o napiling range)
    let filteredRecords = [];

    let rangeFrom = null;         // History range (default: huling 7 araw)
    let rangeTo = null;

    let dataReady = false;
    let currentPage = 1;
    let rowsPerPage = 6;
    let lastRebuiltMinute = -1;


    // "BSIT 403" -> "403" (tinatanggal ang course prefix sa section)
    function shortSection(section) {
        return String(section || "").replace(/^[A-Za-z]+[\s-]+(?=\d)/, "");
    }


    // =================================================
    // LIVE DATE & TIME
    // =================================================

    function tickClock() {

        const now = new Date();

        if (currentDateEl) {
            currentDateEl.textContent =
                now.toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                });
        }

        if (currentTimeEl) {
            currentTimeEl.textContent =
                now.toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
        }

        // Kada bagong minuto, i-recompute ang status
        // (hal. Pending -> Absent kapag lampas na sa schedule)
        const minuteKey = now.getHours() * 60 + now.getMinutes();

        if (dataReady && minuteKey !== lastRebuiltMinute) {
            rebuild();
        }
    }


    // =================================================
    // LOAD STUDENTS + SCHEDULES
    // =================================================

    async function loadUsers() {

        scheduledUsers = await loadScheduledUsers();

        if (!sectionFilter) {
            return;
        }

        const sections = [
            ...new Set(
                scheduledUsers
                    .map((user) => user.section)
                    .filter((section) => section !== "N/A")
            )
        ].sort();

        const previous = sectionFilter.value;

        sectionFilter.innerHTML =
            `<option value="All Sections">All Sections</option>`;

        sections.forEach((section) => {
            sectionFilter.innerHTML +=
                `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`;
        });

        if (sections.includes(previous)) {
            sectionFilter.value = previous;
        }

    }


    // =================================================
    // BUILD TODAY'S ROWS (schedule-based)
    // =================================================

    function rebuild() {

        const now = new Date();

        lastRebuiltMinute = now.getHours() * 60 + now.getMinutes();

        todayRecords = buildTodayRows(scheduledUsers, attendanceDocs, now);

        allRecords = (rangeFrom && rangeTo)
            ? buildRowsForRange(scheduledUsers, attendanceDocs, rangeFrom, rangeTo, now)
            : todayRecords;

        renderStudentList();

        applyFilters(true);
        updateSummaryCards();
    }


    // =================================================
    // FILTER
    // =================================================

    function applyFilters(keepPage = false) {

        const keyword = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const section = sectionFilter ? sectionFilter.value.toLowerCase() : "all sections";
        const status = statusFilter ? statusFilter.value.toLowerCase() : "all status";

        filteredRecords = allRecords.filter((item) => {

            const matchSearch =
                item.studentName.toLowerCase().includes(keyword) ||
                item.studentEmail.toLowerCase().includes(keyword) ||
                item.company.toLowerCase().includes(keyword);

            const matchSection =
                section === "all sections" ||
                item.section.toLowerCase() === section;

            const matchStatus =
                status === "all status" ||
                item.status.toLowerCase() === status;

            return matchSearch && matchSection && matchStatus;

        });

        const totalPages = Math.max(1, Math.ceil(filteredRecords.length / rowsPerPage));

        currentPage = keepPage
            ? Math.min(currentPage, totalPages)
            : 1;

        renderTable();
    }


    // =================================================
    // RENDER TABLE
    // =================================================

    function renderTable() {

        if (!attendanceTable) {
            return;
        }

        if (filteredRecords.length === 0) {

            attendanceTable.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align:center; color:#777; padding:30px;">
                        ${allRecords.length === 0
                            ? "No attendance history found for the selected dates."
                            : "No attendance records found."}
                    </td>
                </tr>`;

            if (paginationInfo) {
                paginationInfo.textContent = "Showing 0 to 0 of 0 records";
            }

            updatePagination();
            return;
        }


        const start = (currentPage - 1) * rowsPerPage;
        const end = Math.min(start + rowsPerPage, filteredRecords.length);

        attendanceTable.innerHTML = filteredRecords
            .slice(start, end)
            .map((item) => {

                const statusClass = item.status.toLowerCase();

                return `
                    <tr>
                        <td class="date-cell">${escapeHtml(item.dateText)}</td>

                        <td>
                            <strong>${escapeHtml(item.studentName)}</strong>
                            <br>
                            <small style="color:#777;">${escapeHtml(item.studentEmail)}</small>
                            <br>
                            <small style="color:#aaa;">
                                <i class="fa-regular fa-calendar-check"></i>
                                ${escapeHtml(item.scheduleText)}
                            </small>
                        </td>

                        <td>${escapeHtml(item.course)}</td>
                        <td>${escapeHtml(shortSection(item.section))}</td>
                        <td>${escapeHtml(item.company)}</td>
                        <td>${escapeHtml(item.timeIn)}</td>
                        <td>${escapeHtml(item.timeOut)}</td>
                        <td>${escapeHtml(item.totalHours)}</td>

                        <td class="photo-proof-cell">
                            ${item.photoProof
                                ? `<button type="button" class="photo-proof-btn"
                                        data-photo="${escapeHtml(item.photoProof)}">
                                        <i class="fa-solid fa-image"></i> View
                                   </button>`
                                : `<span class="no-photo-proof">No Photo</span>`}
                        </td>

                        <td>
                            <span class="status ${statusClass}">${item.status}</span>
                        </td>

                        <td class="actions">
                            <button class="action-btn view-btn"
                                data-id="${escapeHtml(item.userId || item.id)}"
                                title="View Details">
                                <i class="fa-regular fa-eye"></i> View
                            </button>
                        </td>
                    </tr>`;

            }).join("");

        if (paginationInfo) {
            paginationInfo.textContent =
                `Showing ${start + 1} to ${end} of ${filteredRecords.length} records`;
        }

        updatePagination();
    }


    // =================================================
    // PAGINATION
    // =================================================

    function updatePagination() {

        const totalPages = Math.max(1, Math.ceil(filteredRecords.length / rowsPerPage));

        if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
        if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;

        if (!pageNumbers) {
            return;
        }

        pageNumbers.innerHTML = "";

        for (let page = 1; page <= totalPages; page++) {

            const button = document.createElement("button");

            button.className = "page-num";

            if (page === currentPage) {
                button.classList.add("active");
            }

            button.textContent = page;

            button.addEventListener("click", () => {
                currentPage = page;
                renderTable();
            });

            pageNumbers.appendChild(button);
        }
    }


    // =================================================
    // SUMMARY CARDS (based on today's schedule)
    // =================================================

    function updateSummaryCards() {

        // Laging ngayong araw lang ang summary cards (kahit may napiling range)
        const total = todayRecords.length;

        const count = (status) =>
            todayRecords.filter((r) => r.status === status).length;

        const present = count("Present");
        const late = count("Late");
        const absent = count("Absent");
        const pending = count("Pending");

        const pct = (value) =>
            total ? `${Math.round((value / total) * 100)}%` : "0%";

        const set = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        set("statScheduled", total);
        set("statPending", `${pending} pending`);

        set("statPresent", present);
        set("statPresentPct", pct(present));

        set("statLate", late);
        set("statLatePct", pct(late));

        set("statAbsent", absent);
        set("statAbsentPct", pct(absent));
    }


    // =================================================
    // EVENTS
    // =================================================

    if (searchInput) searchInput.addEventListener("input", () => applyFilters());
    if (sectionFilter) sectionFilter.addEventListener("change", () => applyFilters());
    if (statusFilter) statusFilter.addEventListener("change", () => applyFilters());

    // =================================================
    // DATE RANGE (From / To / Apply)
    // =================================================

    function toInputValue(date) {
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${date.getFullYear()}-${m}-${d}`;
    }

    function parseInputValue(value) {
        if (!value) return null;
        const [y, m, d] = value.split("-").map(Number);
        return new Date(y, m - 1, d);
    }

    function formatShort(date) {
        return date.toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric"
        });
    }

    function initRangeInputs() {

        if (!fromDateInput || !toDateInput) return;

        const todayValue = toInputValue(new Date());

        // Hindi puwedeng pumili ng petsa sa hinaharap
        fromDateInput.max = todayValue;
        toDateInput.max = todayValue;

        // Default: huling 7 araw (kasama ngayon), hindi lalampas sa MAX_RANGE_DAYS
        const span = Math.min(7, MAX_RANGE_DAYS || 7);
        const from = new Date();
        from.setDate(from.getDate() - (span - 1));

        fromDateInput.value = toInputValue(from);
        toDateInput.value = todayValue;

        rangeFrom = parseInputValue(fromDateInput.value);
        rangeTo = parseInputValue(toDateInput.value);
    }

    function applyRange() {

        const from = parseInputValue(fromDateInput.value);
        const to = parseInputValue(toDateInput.value);

        toDateInput.setCustomValidity("");

        if (!from || !to) {
            toDateInput.setCustomValidity("Please choose both From and To dates.");
            toDateInput.reportValidity();
            return;
        }

        if (from > to) {
            toDateInput.setCustomValidity("The From date must not be later than the To date.");
            toDateInput.reportValidity();
            return;
        }

        const days = Math.round((to - from) / 86400000) + 1;

        if (days > MAX_RANGE_DAYS) {
            toDateInput.setCustomValidity(`Please choose a range of ${MAX_RANGE_DAYS} days or less.`);
            toDateInput.reportValidity();
            return;
        }

        rangeFrom = from;
        rangeTo = to;

        if (dataReady) {
            rebuild();
            applyFilters();     // balik sa page 1
        }
    }

    if (applyRangeBtn) applyRangeBtn.addEventListener("click", applyRange);

    [fromDateInput, toDateInput].forEach((input) => {
        if (input) input.addEventListener("input", () => toDateInput.setCustomValidity(""));
    });

    initRangeInputs();


    if (rowsPerPageSelect) {
        rowsPerPageSelect.addEventListener("change", () => {
            rowsPerPage = parseInt(rowsPerPageSelect.value, 10);
            currentPage = 1;
            renderTable();
        });
    }

    if (prevPageBtn) {
        prevPageBtn.addEventListener("click", () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
            }
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener("click", () => {
            const totalPages = Math.ceil(filteredRecords.length / rowsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                renderTable();
            }
        });
    }


    // VIEW DETAILS
    document.addEventListener("click", (event) => {

        const button = event.target.closest(".view-btn");

        if (!button) {
            return;
        }

        const id = button.getAttribute("data-id");

        if (id) {
            window.location.href = `attendance_details.html?id=${id}`;
        }

    });


    // PHOTO PROOF
    document.addEventListener("click", (event) => {

        const button = event.target.closest(".photo-proof-btn");

        if (!button) {
            return;
        }

        const photo = button.getAttribute("data-photo");
        const modal = document.getElementById("photoProofModal");
        const image = document.getElementById("photoProofImage");

        if (!photo || !modal || !image) {
            return;
        }

        image.src = photo;
        modal.classList.add("show");

    });


    // CLOSE PHOTO MODAL
    document.addEventListener("click", (event) => {

        const closeButton = event.target.closest("#photoProofClose");
        const modal = document.getElementById("photoProofModal");
        const image = document.getElementById("photoProofImage");

        if (closeButton || event.target === modal) {

            if (modal) modal.classList.remove("show");
            if (image) image.src = "";

        }

    });


    // =================================================
    // CARD POPUPS
    //
    // Bawat summary card ay may sariling page na
    // nilo-load sa iframe at lumalabas bilang popup
    // (kagaya ng stat cards sa dashboard).
    // =================================================

    const listModal = document.getElementById("attendanceListModal");
    const listFrame = document.getElementById("attendanceListFrame");
    const listModalTitle = document.getElementById("attendanceListModalTitle");
    const listModalIcon = document.getElementById("attendanceListModalIcon");
    const listModalClose = document.getElementById("closeAttendanceListModalBtn");

    const cardPopups = [
    ];

    function openListPopup(config) {

        if (!listModal || !listFrame) {
            return;
        }

        if (listModalTitle) listModalTitle.textContent = config.title;
        if (listModalIcon) listModalIcon.className = config.icon;

        // I-set ang src pagbukas lang para laging bago ang data
        listFrame.src = config.src;

        listModal.classList.add("show");

        document.body.style.overflow = "hidden";
    }

    function closeListPopup() {

        if (!listModal || !listFrame) {
            return;
        }

        listModal.classList.remove("show");

        listFrame.src = "about:blank";

        document.body.style.overflow = "";
    }

    cardPopups.forEach((config) => {

        const card = document.getElementById(config.card);

        if (!card) {
            return;
        }

        card.addEventListener("click", () => openListPopup(config));

        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openListPopup(config);
            }
        });

    });

    // Itago ang "Back" button sa loob ng iframe pages (Late / Absent)
    if (listFrame) {
        listFrame.addEventListener("load", () => {
            try {
                const doc = listFrame.contentDocument;

                if (!doc || !doc.body) {
                    return;
                }

                doc.querySelectorAll("button, a").forEach((el) => {
                    const label = (el.textContent || "").trim().toLowerCase();
                    const hint = `${el.id} ${el.className}`.toLowerCase();

                    if (label === "back" || hint.includes("back")) {
                        el.style.display = "none";
                    }
                });
            } catch (error) {
                // cross-origin / blank page - walang gagawin
            }
        });
    }

    if (listModalClose) {
        listModalClose.addEventListener("click", closeListPopup);
    }

    if (listModal) {
        listModal.addEventListener("click", (event) => {
            if (event.target === listModal) {
                closeListPopup();
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && listModal && listModal.classList.contains("show")) {
            closeListPopup();
        }
    });

    // Message galing sa loob ng popup (hal. "Back" button)
    window.addEventListener("message", (event) => {
        if (event.data && event.data.type === "closeAttendanceListModal") {
            closeListPopup();
        }
    });


    // =================================================
    // STUDENT LIST POPUP (Scheduled Today / Present Today)
    // Galing sa todayRecords - walang hiwalay na page.
    // =================================================

    const studentListModal = document.getElementById("studentListModal");
    const studentListTable = document.getElementById("studentListTable");
    const studentListSearch = document.getElementById("studentListSearch");

    const listConfigs = {
        scheduled: {
            title: "Scheduled Today",
            icon: "fa-solid fa-users",
            filter: () => true,
            empty: "No students are scheduled to duty today."
        },
        present: {
            title: "Present Today",
            icon: "fa-solid fa-user-check",
            filter: (r) => r.status === "Present",
            empty: "No students are present today."
        },
        late: {
            title: "Late Today",
            icon: "fa-solid fa-clock",
            filter: (r) => r.status === "Late",
            empty: "No late students today."
        },
        absent: {
            title: "Absent Today",
            icon: "fa-solid fa-user-xmark",
            filter: (r) => r.status === "Absent",
            empty: "No absent students today."
        }
    };

    let activeList = null;

    function getListRows() {

        if (!activeList) {
            return [];
        }

        const keyword = studentListSearch
            ? studentListSearch.value.toLowerCase().trim()
            : "";

        return todayRecords
            .filter(listConfigs[activeList].filter)
            .filter((r) =>
                r.studentName.toLowerCase().includes(keyword) ||
                r.studentEmail.toLowerCase().includes(keyword) ||
                r.company.toLowerCase().includes(keyword)
            );
    }

    function renderStudentList() {

        if (!activeList || !studentListTable) {
            return;
        }

        const config = listConfigs[activeList];
        const rows = getListRows();
        const now = new Date();

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        setText("studentListHeaderTitle", config.title);
        setText("studentListTitle", config.title);

        setText(
            "studentListSubtitle",
            `${now.toLocaleDateString("en-US", {
                weekday: "long", year: "numeric", month: "long", day: "numeric"
            })} \u2022 as of ${now.toLocaleTimeString("en-US", {
                hour: "2-digit", minute: "2-digit"
            })}`
        );

        setText(
            "studentListCount",
            `${rows.length} ${rows.length === 1 ? "student" : "students"}`
        );

        if (rows.length === 0) {

            studentListTable.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align:center; color:#777; padding:30px;">
                        ${studentListSearch && studentListSearch.value.trim()
                            ? "No students match your search."
                            : config.empty}
                    </td>
                </tr>`;

            return;
        }

        studentListTable.innerHTML = rows.map((item, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>
                    <strong>${escapeHtml(item.studentName)}</strong>
                    <br>
                    <small style="color:#777;">${escapeHtml(item.studentEmail)}</small>
                </td>
                <td>${escapeHtml(item.course)}</td>
                <td>${escapeHtml(shortSection(item.section))}</td>
                <td>${escapeHtml(item.company)}</td>
                <td>${escapeHtml(item.scheduleText)}</td>
                <td>${escapeHtml(item.timeIn)}</td>
                <td>${escapeHtml(item.timeOut)}</td>
                <td>${escapeHtml(item.totalHours)}</td>
                <td><span class="status ${item.status.toLowerCase()}">${item.status}</span></td>
            </tr>`).join("");
    }

    function openStudentList(type) {

        if (!studentListModal) {
            return;
        }

        activeList = type;

        const icon = document.getElementById("studentListIcon");
        if (icon) icon.className = listConfigs[type].icon;

        if (studentListSearch) studentListSearch.value = "";

        renderStudentList();

        studentListModal.classList.add("show");

        document.body.style.overflow = "hidden";
    }

    function closeStudentList() {

        if (!studentListModal) {
            return;
        }

        studentListModal.classList.remove("show");

        activeList = null;

        document.body.style.overflow = "";
    }

    function printStudentList() {

        const rows = getListRows();

        if (!activeList || rows.length === 0) {
            return;
        }

        const win = window.open("", "_blank");

        if (!win) {
            return;
        }

        const body = rows.map((item, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(item.studentName)}<br><small>${escapeHtml(item.studentEmail)}</small></td>
                <td>${escapeHtml(item.course)}</td>
                <td>${escapeHtml(shortSection(item.section))}</td>
                <td>${escapeHtml(item.company)}</td>
                <td>${escapeHtml(item.scheduleText)}</td>
                <td>${escapeHtml(item.timeIn)}</td>
                <td>${escapeHtml(item.timeOut)}</td>
                <td>${escapeHtml(item.totalHours)}</td>
                <td>${item.status}</td>
            </tr>`).join("");

        win.document.write(`
            <html><head><title>${listConfigs[activeList].title}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 24px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
                th { background: #f3f3f3; }
                small { color: #666; }
            </style></head><body>
            <h2>${listConfigs[activeList].title}</h2>
            <p>${new Date().toLocaleString("en-US")}</p>
            <table>
                <thead><tr><th>#</th><th>Student Name</th><th>Course</th><th>Section</th>
                <th>Company</th><th>Schedule</th><th>Time In</th><th>Time Out</th>
                <th>Total Hours</th><th>Status</th></tr></thead>
                <tbody>${body}</tbody>
            </table></body></html>`);

        win.document.close();
        win.focus();
        win.print();
    }

    const bindCard = (id, type) => {

        const card = document.getElementById(id);

        if (!card) {
            return;
        }

        card.addEventListener("click", () => openStudentList(type));

        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openStudentList(type);
            }
        });
    };

    bindCard("scheduledCard", "scheduled");
    bindCard("presentCard", "present");
    bindCard("lateCard", "late");
    bindCard("absentCard", "absent");

    const bindClick = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("click", handler);
    };

    bindClick("closeStudentListBtn", closeStudentList);
    bindClick("studentListPrintBtn", printStudentList);

    if (studentListSearch) {
        studentListSearch.addEventListener("input", renderStudentList);
    }

    if (studentListModal) {
        studentListModal.addEventListener("click", (event) => {
            if (event.target === studentListModal) {
                closeStudentList();
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && studentListModal && studentListModal.classList.contains("show")) {
            closeStudentList();
        }
    });


    // =================================================
    // RUN
    // =================================================

    tickClock();

    setInterval(tickClock, 1000);


    (async function init() {

        try {

            await loadUsers();

            // Realtime: lalabas agad ang bagong time-in / time-out
            subscribeAttendance(
                (docs) => {

                    attendanceDocs = docs;

                    dataReady = true;

                    rebuild();

                },
                (error) => {

                    console.error("Attendance listener error:", error);

                    attendanceTable.innerHTML = `
                        <tr>
                            <td colspan="11" style="text-align:center; color:#e74c3c; padding:30px;">
                                Unable to load attendance records.
                            </td>
                        </tr>`;

                }
            );

        } catch (error) {

            console.error("Error loading attendance:", error);

            if (attendanceTable) {
                attendanceTable.innerHTML = `
                    <tr>
                        <td colspan="11" style="text-align:center; color:#e74c3c; padding:30px;">
                            Unable to load attendance records.
                        </td>
                    </tr>`;
            }

        }

    })();

});