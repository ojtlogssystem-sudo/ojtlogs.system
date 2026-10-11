import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query, 
    where, 
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { loadHeader } from "../templated/header-loader.js";

// FIREBASE CONFIGURATION
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

// Guarded init: header-loader.js also initializes the default Firebase app,
// and whichever module's top-level code runs first "wins" — this avoids a
// duplicate-app error regardless of import order.
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

let rawUserDocs = [];

let selectedFilterStart = null;
let selectedFilterEnd = null;

// Flatpickr instance + set of YYYY-MM-DD dates that have at least one task
// (used to draw the red dot under those dates in the calendar popup).
// Pagination state
let currentPage = 1;
const rowsPerPage = 8;

let taskDatePicker = null;
let taskDatesSet = new Set();

/* ==========================================
   INITIAL LOADING OVERLAY
   Naka-block ito sa buong page hanggang matapos
   ang unang onSnapshot() ng attendance/task data.
   Dito lang dapat makikita ng user ang totoong
   Task History — hindi na yung "Loading logged-in
   user tasks..." placeholder.
========================================== */
function hideTasksLoadingOverlay() {
    const overlay = document.getElementById("tasks-loading-overlay");
    if (!overlay || overlay.dataset.hidden === "true") return;
    overlay.dataset.hidden = "true";
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 300);
}

document.addEventListener("DOMContentLoaded", () => {
    // Safety net: kung sakaling matagal ang koneksyon o may error na
    // hindi na-catch sa fetch/listener chain, huwag hayaang ma-stuck ang
    // user sa loading screen magpakailanman — itago pa rin pagkalipas ng
    // ilang segundo.
    setTimeout(() => {
        const overlay = document.getElementById("tasks-loading-overlay");
        if (overlay && overlay.dataset.hidden !== "true") {
            console.warn("Tasks loading overlay auto-hidden after timeout — check network/Firestore.");
            hideTasksLoadingOverlay();
        }
    }, 15000);

    // 1. Load Sidebar at i-highlight ang "Tasks"
    loadSidebar("Tasks");

    // 2. Load Header at i-setup ang pamagat (shared header now also handles
    // the profile avatar/name and the notification bell on its own).
    loadHeader("Tasks", { autoLoadProfile: true });
    initTaskFlatpickr();
    initPagination();

    // 3. Auth State Observer para sa User Session at Firestore Data
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "../student_login/student_login.html";
            return;
        }

        fetchUserTasks(user.uid);
    });
});

// --- SIDEBAR LOADER & HIGHLIGHT LOGIC ---

function loadSidebar(activeMenuName) {
    fetch("../templated/sidebar.html")
        .then(response => {
            if (!response.ok) throw new Error("Could not load sidebar.");
            return response.text();
        })
        .then(data => {
            const container = document.getElementById("sidebar-container");
            if (container) {
                container.innerHTML = data;

                // Awtomatikong hahanapin ang menu item at lalagyan ng .active class
                const menuLinks = container.querySelectorAll(".menu li");
                menuLinks.forEach(li => {
                    const spanText = li.querySelector("span")?.textContent.trim();
                    if (spanText && spanText.toLowerCase() === activeMenuName.toLowerCase()) {
                        li.classList.add("active");
                    } else {
                        li.classList.remove("active");
                    }
                });

                initSidebarEvents();
            }
        })
        .catch(err => console.error("Error loading sidebar:", err));
}

function initSidebarEvents() {
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.getElementById("menu-btn");
    const menuBtn2 = document.getElementById("menu-btn2");
    const mobileMenu = document.getElementById("mobile-menu");

    if (menuBtn) {
        menuBtn.addEventListener("click", () => sidebar.classList.add("close"));
    }

    if (menuBtn2) {
        menuBtn2.addEventListener("click", () => sidebar.classList.remove("close"));
    }

    if (mobileMenu) {
        mobileMenu.onclick = (e) => {
            e.stopPropagation();
            if (sidebar) {
                sidebar.classList.remove("close");
                sidebar.classList.toggle("show");
                mobileMenu.style.display = sidebar.classList.contains("show") ? "none" : "flex";
            }
        };
    }

    document.addEventListener("click", (e) => {
        if (!sidebar) return;
        if (window.innerWidth <= 768 && sidebar.classList.contains("show") && !sidebar.contains(e.target)) {
            sidebar.classList.remove("show");
            if (mobileMenu) {
                mobileMenu.style.display = "flex";
            }
        }
    });
}

// --- HEADER, NOTIFICATIONS & PROFILE ---
// All handled globally now by the shared header (see header-loader.js's
// loadHeader/loadNotifications/updateHeaderProfile), loaded above with
// { autoLoadProfile: true }.

// --- TASKS FETCHING & RENDERING LOGIC ---

function fetchUserTasks(userId) {
    const container = document.getElementById("user-tasks-container");
    const attendanceRef = collection(db, "attendance");
    const q = query(attendanceRef, where("userId", "==", userId));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 30px; color: #9ca3af; font-size: 13px;">
                        <mat-icon class="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color" style="font-size: 28px; margin-bottom: 8px; color: #d1d5db;" aria-hidden="true">folder_open</mat-icon><br>
                        No task records found for your account.
                    </div>
                `;
            }
            rawUserDocs = [];
            updatePagination(0, 1);
            refreshTaskDateMarks();
            hideTasksLoadingOverlay();
            return;
        }

        rawUserDocs = [];
        snapshot.forEach(docSnap => rawUserDocs.push({ id: docSnap.id, ...docSnap.data() }));

        rawUserDocs.sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || a.date || 0);
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || b.date || 0);
            return timeB - timeA;
        });

        renderFilteredTasks();
        refreshTaskDateMarks();
        hideTasksLoadingOverlay();
    }, (error) => {
        console.error("Firestore Error:", error);
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #ef4444; font-size: 13px;">
                    Failed to load task history: ${error.message}
                </div>
            `;
        }
        hideTasksLoadingOverlay();
    });
}

function getLocalYMD(d) {
    if (!d || isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* ==========================================
   TASK DATA HELPERS
========================================== */

// Date ng attendance doc bilang local Date (o null kung hindi mabasa).
function getDocDate(docData) {
    const raw = docData.date || docData.formattedDate;
    if (!raw) return null;

    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split("-").map(Number);
        return new Date(y, m - 1, d);
    }

    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
}

// Posibleng pangalan ng fields (para gumana rin sa mga lumang record na
// iba ang pagkaka-save).
const TASK_TITLE_KEYS = ["title", "name", "taskTitle", "task_title", "task", "category", "label"];
const TASK_DESC_KEYS = ["description", "desc", "details", "detail", "taskDescription", "task_description", "summary", "notes", "note", "content", "text"];

function pickText(obj, keys) {
    for (const key of keys) {
        const val = obj?.[key];
        if (typeof val === "string" && val.trim()) return val.trim();
    }
    return "";
}

// "Title: Description" -> { title, description }
function parseTaskString(str) {
    const trimmed = String(str ?? "").trim();
    if (!trimmed) return null;

    const idx = trimmed.indexOf(":");
    if (idx === -1) return { title: "General Task", description: trimmed };

    return {
        title: trimmed.slice(0, idx).trim() || "General Task",
        description: trimmed.slice(idx + 1).trim()
    };
}

function normalizeTaskItem(item) {
    if (typeof item === "string") return parseTaskString(item);

    if (item && typeof item === "object") {
        const title = pickText(item, TASK_TITLE_KEYS);
        const description = pickText(item, TASK_DESC_KEYS);
        if (!title && !description) return null;
        return { title: title || "General Task", description };
    }

    return null;
}

// `tasks` ay pwedeng string ("A: x | B: y") o array.
function parseTasksField(tasks) {
    if (Array.isArray(tasks)) return tasks.map(normalizeTaskItem).filter(Boolean);
    if (typeof tasks === "string") return tasks.split("|").map(parseTaskString).filter(Boolean);
    return [];
}

/* ==========================================
   HOURS RENDERED HELPERS
   Kinukuwenta ang na-render na oras mula timeIn -> timeOut
   (o gamitin ang naka-save na hours field kung meron).
========================================== */

const HOURS_FIELD_KEYS = ["hoursRendered", "renderedHours", "totalHours", "hours", "hoursWorked", "workHours"];

// "08:30 AM", "8:30AM", "14:05", "14:05:30", Firestore Timestamp, Date -> minuto mula hatinggabi
function parseTimeToMinutes(value) {
    if (value === null || value === undefined || value === "" || value === "--") return null;

    if (typeof value?.toDate === "function") {
        const d = value.toDate();
        return d.getHours() * 60 + d.getMinutes();
    }
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value.getHours() * 60 + value.getMinutes();
    }

    const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3] ? match[3].toLowerCase() : null;

    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
}

function formatDuration(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;

    // Laging ipinapakita ang hours at minutes, kahit 0
    return `${h} hr${h === 1 ? "" : "s"} ${m} min${m === 1 ? "" : "s"}`;
}

// Hours rendered ng isang attendance doc, o "--" kung hindi makuwenta.
function getRenderedHours(docData) {
    // 1) Kung may naka-save nang numeric na oras sa Firestore, iyon ang gamitin
    for (const key of HOURS_FIELD_KEYS) {
        const val = Number(docData?.[key]);
        if (docData?.[key] !== "" && docData?.[key] != null && Number.isFinite(val) && val > 0) {
            return formatDuration(val * 60);
        }
    }

    // 2) Kung wala, kuwentahin mula timeIn at timeOut
    const start = parseTimeToMinutes(docData?.timeIn);
    const end = parseTimeToMinutes(docData?.timeOut);
    if (start === null || end === null) return "--";

    let diff = end - start;
    if (diff < 0) diff += 24 * 60; // lumampas ng hatinggabi
    if (diff <= 0) return "--";

    return formatDuration(diff);
}

// Lahat ng tasks ng isang attendance doc: [{ title, description }]
function getTaskEntries(docData) {
    const fromList = Array.isArray(docData.taskList)
        ? docData.taskList.map(normalizeTaskItem).filter(Boolean)
        : [];
    const fromString = parseTasksField(docData.tasks);

    if (!fromList.length) return fromString;

    // Kung walang description ang taskList, subukang kunin sa `tasks` na text.
    return fromList.map((entry, i) => {
        if (entry.description) return entry;

        const match =
            fromString.find(s => s.title.toLowerCase() === entry.title.toLowerCase()) ||
            (fromString.length === fromList.length ? fromString[i] : null);

        return match && match.description ? { ...entry, description: match.description } : entry;
    });
}

/* ==========================================
   CALENDAR MARKS (dot under dates with tasks)
   Same behavior as the Attendance page.
========================================== */

function computeTaskDates() {
    const dates = new Set();

    rawUserDocs.forEach(docData => {
        if (!getTaskEntries(docData).length) return;

        const d = getDocDate(docData);
        if (d) dates.add(getLocalYMD(d));
    });

    return dates;
}

function markTaskDate(dayElem) {
    if (!dayElem || !dayElem.dateObj) return;

    if (taskDatesSet.has(getLocalYMD(dayElem.dateObj))) {
        dayElem.classList.add("has-task");
    } else {
        dayElem.classList.remove("has-task");
    }
}

function markAllTaskDates(instance) {
    if (!instance || !instance.calendarContainer) return;

    instance.calendarContainer
        .querySelectorAll(".flatpickr-day")
        .forEach(markTaskDate);
}

// Tinatawag tuwing may bagong data galing Firestore.
function refreshTaskDateMarks() {
    taskDatesSet = computeTaskDates();

    if (taskDatePicker) {
        taskDatePicker.redraw();
    }
}

/* ==========================================
   FLATPICKR DATE RANGE PICKER
   MATCHED WITH ATTENDANCE HISTORY
========================================== */

function initTaskFlatpickr() {
    const datePickerInput = document.getElementById("dateRangePicker");

    if (!datePickerInput || typeof flatpickr === "undefined") {
        return;
    }

    taskDatePicker = flatpickr(datePickerInput, {
        mode: "range",
        dateFormat: "M j, Y",
        allowInput: false,
        clickOpens: true,

        // Bawat date cell na ginagawa ng Flatpickr: lagyan ng dot kung may task.
        onDayCreate: function (selectedDates, dateStr, instance, dayElem) {
            markTaskDate(dayElem);
        },

        onOpen: function (selectedDates, dateStr, instance) {
            markAllTaskDates(instance);
        },

        onMonthChange: function (selectedDates, dateStr, instance) {
            markAllTaskDates(instance);
        },

        onYearChange: function (selectedDates, dateStr, instance) {
            markAllTaskDates(instance);
        },

        onChange: function (selectedDates) {
            if (selectedDates.length === 2) {
                filterTasksByDateRange(selectedDates[0], selectedDates[1]);
            } else if (selectedDates.length === 0) {
                selectedFilterStart = null;
                selectedFilterEnd = null;
                currentPage = 1;
                renderFilteredTasks();
            }
        }
    });
}

/* ==========================================
   FILTER + RENDER
========================================== */

/* ==========================================
   DEBUG VIEW — buksan ang tasks.html?debug=1
   Ipinapakita ang aktwal na laman ng Firestore
   (walang photoProof) para makita kung talagang
   naka-save ang description ng mga task.
========================================== */
function renderDebugPanel() {
    if (new URLSearchParams(window.location.search).get("debug") !== "1") return;

    const container = document.getElementById("user-tasks-container");
    if (!container) return;

    const rows = rawUserDocs.slice(0, 15).map(d => ({
        id: d.id,
        date: d.date,
        formattedDate: d.formattedDate,
        timeIn: d.timeIn,
        timeOut: d.timeOut,
        status: d.status,
        taskList: d.taskList,
        tasks: d.tasks
    }));

    container.insertAdjacentHTML("beforeend", `
        <details open style="margin-top:12px; padding:10px; border:1px dashed #d1d5db; border-radius:10px; background:#f9fafb;">
            <summary style="font-size:12px; font-weight:600; cursor:pointer;">DEBUG: raw attendance data (${rawUserDocs.length} docs)</summary>
            <pre style="font-size:11px; white-space:pre-wrap; overflow-wrap:anywhere; margin-top:8px;">${escapeHtml(JSON.stringify(rows, null, 2))}</pre>
        </details>
    `);
}

function filterTasksByDateRange(startDate, endDate) {
    selectedFilterStart = getLocalYMD(startDate);
    selectedFilterEnd = getLocalYMD(endDate);
    currentPage = 1;
    renderFilteredTasks();
}

function renderFilteredTasks() {
    const container = document.getElementById("user-tasks-container");
    if (!container) return;

    const hasRange = selectedFilterStart && selectedFilterEnd;
    const items = [];

    rawUserDocs.forEach(docData => {
        const docDate = getDocDate(docData);
        if (!docDate) return;

        if (hasRange) {
            const ymd = getLocalYMD(docDate);
            if (ymd < selectedFilterStart || ymd > selectedFilterEnd) return;
        }

        const displayDate =
            docData.formattedDate ||
            docDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

        const hoursRendered = getRenderedHours(docData);

        getTaskEntries(docData).forEach(task => {
            const badge = getCategoryBadge(task.title);
            items.push({
                date: escapeHtml(displayDate),
                description: escapeHtml(task.description),
                time: escapeHtml(hoursRendered),
                category: { ...badge, label: escapeHtml(task.title) }
            });
        });
    });

    if (!items.length) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: #9ca3af; font-size: 13px;">
                <mat-icon class="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color" style="font-size: 28px; margin-bottom: 8px; color: #d1d5db;" aria-hidden="true">folder_open</mat-icon><br>
                ${hasRange ? "No tasks found for the selected dates." : "No task records found for your account."}
            </div>
        `;
        updatePagination(0, 1);
        return;
    }

    // Pagination: keep currentPage inside the valid range, then slice
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const startIdx = (currentPage - 1) * rowsPerPage;
    const pageItems = items.slice(startIdx, startIdx + rowsPerPage);

    container.innerHTML = pageItems.map(renderTaskItem).join("");
    renderDebugPanel();

    updatePagination(totalItems, totalPages);
}

/* ==========================================
   PAGINATION FOOTER
========================================== */

function updatePagination(total, totalPages = 1) {
    const bar = document.getElementById("pagination-bar");
    if (!bar) return;

    // Walang tasks, o isang page lang = walang pagination
    if (!total || totalPages <= 1) {
        bar.hidden = true;
        return;
    }

    bar.hidden = false;

    const prevBtn = document.getElementById("page-prev");
    const nextBtn = document.getElementById("page-next");
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

function scrollToTaskList() {
    const card = document.querySelector(".history-card");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function initPagination() {
    document.getElementById("page-prev")?.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderFilteredTasks();
            scrollToTaskList();
        }
    });

    document.getElementById("page-next")?.addEventListener("click", () => {
        currentPage++; // renderFilteredTasks() clamps it to the last page
        renderFilteredTasks();
        scrollToTaskList();
    });
}

function renderTaskItem({ date, description, time, category }) {
    return `
        <div class="task-history-item">
            <div class="task-item-top">
                <div class="task-item-left">
                    <div class="task-date-info">
                        <h4>${date}</h4>
                    </div>
                </div>
                <div class="task-item-right">
                    <span class="category-tag ${category.colorClass}">${category.label}</span>
                </div>
            </div>

            <p class="task-description">${description || "No description provided."}</p>

            <div class="task-item-divider"></div>

            <div class="task-item-bottom">
                <div class="time-added-info">
                    <mat-icon class="mat-icon notranslate lm-icon-xl lumi-symbols mat-ligature-font mat-icon-no-color" aria-hidden="true">schedule</mat-icon>
                    <span>HOURS RENDERED: <strong>${time}</strong></span>
                </div>
            </div>
        </div>
    `;
}



function getCategoryBadge(title = "") {
    const text = title.toLowerCase();

    if (text.includes("network") || text.includes("cloud") || text.includes("data") || text.includes("database")) {
        return { label: title, colorClass: "blue" };
    } else if (text.includes("doc") || text.includes("report") || text.includes("file") || text.includes("paper")) {
        return { label: title, colorClass: "purple" };
    } else if (text.includes("admin") || text.includes("office") || text.includes("system") || text.includes("manage")) {
        return { label: title, colorClass: "orange" };
    } else {
        return { label: title, colorClass: "green" };
    }
}