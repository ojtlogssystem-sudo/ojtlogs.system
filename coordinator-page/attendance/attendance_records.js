import {
    loadScheduledUsers,
    subscribeAttendance,
    buildTodayRows,
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

    let scheduledUsers = [];      // lahat ng student na may valid na schedule
    let attendanceDocs = [];      // raw attendance docs (realtime)
    let allRecords = [];          // rows para sa ngayong araw
    let filteredRecords = [];

    let dataReady = false;
    let currentPage = 1;
    let rowsPerPage = 6;
    let lastRebuiltMinute = -1;


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

        allRecords = buildTodayRows(scheduledUsers, attendanceDocs, now);

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

            const dayName = new Date().toLocaleDateString("en-US", { weekday: "long" });

            attendanceTable.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align:center; color:#777; padding:30px;">
                        ${allRecords.length === 0
                            ? `No students are scheduled today (${dayName}).`
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
                        <td>${escapeHtml(item.section)}</td>
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

        const total = allRecords.length;

        const count = (status) =>
            allRecords.filter((r) => r.status === status).length;

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
        {
            card: "scheduledCard",
            title: "Scheduled Today",
            icon: "fa-solid fa-users",
            src: "attendance_scheduled.html"
        },
        {
            card: "presentCard",
            title: "Present Today",
            icon: "fa-solid fa-user-check",
            src: "attendance_present.html"
        },
        {
            card: "lateCard",
            title: "Late Today",
            icon: "fa-solid fa-clock",
            src: "attendance_late.html"
        },
        {
            card: "absentCard",
            title: "Absent Today",
            icon: "fa-solid fa-user-xmark",
            src: "attendance_absent.html"
        }
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
                            <td colspan="10" style="text-align:center; color:#e74c3c; padding:30px;">
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
                        <td colspan="10" style="text-align:center; color:#e74c3c; padding:30px;">
                            Unable to load attendance records.
                        </td>
                    </tr>`;
            }

        }

    })();

});