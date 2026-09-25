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
let selectedFilterDate = null;

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
    loadHeader("Task History", { autoLoadProfile: true });

    // Date Picker Logic
    const dateInput = document.getElementById("filter-date-input");
    const dateBtn = document.getElementById("date-picker-btn");

    if (dateBtn && dateInput) {
        dateBtn.addEventListener("click", () => {
            if (typeof dateInput.showPicker === "function") {
                dateInput.showPicker();
            } else {
                dateInput.click();
            }
        });

        dateInput.addEventListener("change", (e) => {
            selectedFilterDate = e.target.value;
            renderFilteredTasks();
        });
    }

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
                        <i class="fa-regular fa-folder-open" style="font-size: 28px; margin-bottom: 8px; color: #d1d5db;"></i><br>
                        No task records found for your account.
                    </div>
                `;
            }
            rawUserDocs = [];
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

function renderFilteredTasks() {
    const container = document.getElementById("user-tasks-container");
    const dateRangeText = document.getElementById("date-range-text");
    
    let htmlContent = "";
    let taskCount = 0;

    const curr = new Date();
    const first = curr.getDate() - curr.getDay() + (curr.getDay() === 0 ? -6 : 1); 
    const monday = new Date(new Date().setDate(first));
    monday.setHours(0,0,0,0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23,59,59,999);

    if (dateRangeText) {
        if (selectedFilterDate) {
            const [y, m, d] = selectedFilterDate.split('-');
            const localSelect = new Date(y, m - 1, d);
            const formattedSelect = localSelect.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            dateRangeText.textContent = `Tasks for ${formattedSelect}`;
        } else {
            const startStr = monday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const endStr = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            dateRangeText.textContent = `${startStr} - ${endStr}`;
        }
    }

    rawUserDocs.forEach((data) => {
        let docDate = null;
        let docYMDString = "";

        if (data.createdAt?.toDate) {
            docDate = data.createdAt.toDate();
        } else if (data.date) {
            if (typeof data.date === "string" && data.date.includes("-")) {
                const [y, m, d] = data.date.split('-');
                docDate = new Date(y, m - 1, d);
            } else {
                docDate = new Date(data.date);
            }
        }

        if (docDate) {
            docYMDString = getLocalYMD(docDate);
        }

        let isMatched = false;

        if (selectedFilterDate) {
            if (data.date === selectedFilterDate || docYMDString === selectedFilterDate) {
                isMatched = true;
            }
        } else {
            if (docDate && docDate >= monday && docDate <= sunday) {
                isMatched = true;
            }
        }

        if (isMatched) {
            const rawTaskString = data.tasks || "";
            
            if (rawTaskString.trim() !== "") {
                const taskItems = rawTaskString.split('|');

                taskItems.forEach((taskStr) => {
                    const trimmed = taskStr.trim();
                    if (!trimmed) return;

                    taskCount++;

                    let title = "General Task";
                    let description = trimmed;

                    if (trimmed.includes(":")) {
                        const parts = trimmed.split(":");
                        title = parts[0].trim();
                        description = parts.slice(1).join(":").trim();
                    }

                    htmlContent += renderTaskItem({
                        date: data.formattedDate || (docDate ? docDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"),
                        description: description || title,
                        time: data.timeOut || data.timeIn || "--:--",
                        category: getCategoryBadge(title)
                    });
                });
            }
        }
    });

    if (taskCount === 0) {
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 30px; color: #9ca3af; font-size: 13px;">
                    No submitted tasks recorded for this period.
                </div>
            `;
        }
    } else {
        if (container) container.innerHTML = htmlContent;
    }
}

function renderTaskItem({ date, description, time, category }) {
    return `
        <div class="task-history-item">
            <div class="task-item-top">
                <div class="task-item-left">
                    <div class="task-icon-box">
                        <i class="${category.icon}"></i>
                    </div>
                    <div class="task-date-info">
                        <h4>${date}</h4>
                        <p>${description}</p>
                    </div>
                </div>
                <div class="task-item-right">
                    <span class="category-tag ${category.colorClass}">${category.label}</span>
                </div>
            </div>
            
            <div class="task-item-divider"></div>

            <div class="task-item-bottom">
                <div class="time-added-info">
                    <i class="fa-regular fa-clock"></i>
                    <span>TIME ADDED: <strong>${time}</strong></span>
                </div>
            </div>
        </div>
    `;
}



function getCategoryBadge(title = "") {
    const text = title.toLowerCase();

    if (text.includes("network") || text.includes("cloud") || text.includes("data") || text.includes("database")) {
        return { label: title, colorClass: "blue", icon: "fa-solid fa-network-wired" };
    } else if (text.includes("doc") || text.includes("report") || text.includes("file") || text.includes("paper")) {
        return { label: title, colorClass: "purple", icon: "fa-regular fa-file-lines" };
    } else if (text.includes("admin") || text.includes("office") || text.includes("system") || text.includes("manage")) {
        return { label: title, colorClass: "orange", icon: "fa-solid fa-gears" };
    } else {
        return { label: title, colorClass: "green", icon: "fa-solid fa-circle-check" };
    }
}