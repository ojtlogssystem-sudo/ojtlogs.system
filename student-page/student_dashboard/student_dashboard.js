import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc,
    collection, 
    query, 
    where, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

let studentRequiredHours = 600;

document.addEventListener("DOMContentLoaded", () => {
    // SIGURUHING NAKATAGO ANG MODAL SA SIMULA PA LANG
    const modalOverlay = document.getElementById("activities-modal-overlay");
    if (modalOverlay) {
        modalOverlay.style.display = "none";
    }

    fetch("../templated/sidebar.html")
        .then(response => response.ok ? response.text() : "")
        .then(html => {
            const sidebarContainer = document.getElementById("sidebar-container");
            if (sidebarContainer && html) sidebarContainer.innerHTML = html;
            initSidebar("Dashboard");
        })
        .catch(err => console.error("Error loading sidebar:", err));

    initDropdownAndLogout();
    setupMobileMenuToggle();
    initModalFetchAndLoad();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadStudentData(user);
            listenToStudentAttendance(user.uid);
        } else {
            window.location.href = "../student_login/student_login.html";
        }
    });
});

function getInitials(fullName) {
    if (!fullName) return "ST";
    const nameParts = fullName.trim().split(" ").filter(part => part.length > 0);
    if (nameParts.length === 1) return nameParts[0].charAt(0).toUpperCase();
    return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase();
}

async function loadStudentData(user) {
    try {
        let fullName = user.displayName || localStorage.getItem("user_fullname") || "";
        let student = {};

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            student = userSnap.data();
            if (student.lastName && student.firstName) {
                fullName = `${student.lastName} ${student.firstName} ${student.middleName || ''}`.trim();
            } else if (student.fullName || student.name) {
                fullName = student.fullName || student.name;
            }
        }

        // --- KUNIN ANG AI STATUS MULA SA 'analytics' COLLECTION NG PYTHON AI ---
        let displayStatus = student.internshipStatus || "Active - On Track";
        try {
            const analyticsRef = doc(db, "analytics", user.uid);
            const analyticsSnap = await getDoc(analyticsRef);
            if (analyticsSnap.exists()) {
                const analyticsData = analyticsSnap.data();
                if (analyticsData.aiStatus) {
                    displayStatus = analyticsData.aiStatus; // Halimbawa: "At Risk" o "On Track"[cite: 3]
                }
            }
        } catch (err) {
            console.warn("Could not fetch AI analytics status:", err);
        }

        if (!fullName) fullName = "Student Intern";

        const avatarCircle = document.getElementById("user-initials") || document.querySelector(".profile-circle");
        if (avatarCircle) avatarCircle.textContent = getInitials(fullName);

        const dropdownNameEl = document.getElementById("dropdown-user-fullname");
        if (dropdownNameEl) dropdownNameEl.textContent = fullName;

        studentRequiredHours = student.requiredHours || 600;
        const compHours = student.completedHours || 0;
        const remainingHours = Math.max(0, studentRequiredHours - compHours);
        const percentage = Math.min(100, Math.round((compHours / studentRequiredHours) * 100));

        updateHoursUI(compHours, studentRequiredHours, remainingHours, percentage);
        
        // --- I-UPDATE ANG INTERNSHIP STATUS UI KASAMA ANG AI STATUS KULAY ---
        const statusElem = document.querySelector(".status-text");
        const statusHeader = document.querySelector(".summary-card.purple h2");
        
        if (statusElem) statusElem.textContent = displayStatus;
        
        if (statusHeader) {
            if (displayStatus.toLowerCase().includes("risk")) {
                statusHeader.textContent = "At Risk";
                statusHeader.style.color = "#ef4444"; // Kulay pula kapag At Risk[cite: 3]
                if (statusElem) statusElem.style.color = "#ef4444";
            } else if (displayStatus.toLowerCase().includes("completed")) {
                statusHeader.textContent = "Completed";
                statusHeader.style.color = "#22c55e"; // Kulay berde kapag tapos na[cite: 3]
            } else {
                statusHeader.textContent = "On Track";
                statusHeader.style.color = "#3b82f6"; // Kulay asul kapag maayos[cite: 3]
            }
        }
    } catch (error) {
        console.error("Error fetching student profile:", error);
    }
}

function calculateHoursFromTime(timeIn, timeOut) {
    if (!timeIn || !timeOut || timeIn === "--" || timeOut === "--") return 0;

    try {
        const parseToMinutes = (timeStr) => {
            let parts = timeStr.trim().split(" ");
            let time = parts[0];
            let modifier = parts[1] ? parts[1].toUpperCase() : "";
            
            let [hours, minutes] = time.split(":").map(Number);

            if (modifier === "PM" && hours < 12) hours += 12;
            if (modifier === "AM" && hours === 12) hours = 0;
            
            return (hours * 60) + (minutes || 0);
        };

        const inMinutes = parseToMinutes(timeIn);
        const outMinutes = parseToMinutes(timeOut);

        if (outMinutes <= inMinutes) return 0;

        return (outMinutes - inMinutes) / 60;
    } catch (e) {
        console.error("Error parsing time string:", e);
        return 0;
    }
}

function listenToStudentAttendance(userId) {
    const attendanceQuery = query(
        collection(db, "attendance"),
        where("userId", "==", userId)
    );

    onSnapshot(attendanceQuery, async (snapshot) => {
        let todayTimeIn = "--";
        let todayTimeOut = "--";
        let todayRendered = "0h 0m";
        let totalCompletedHours = 0;

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayDateStr = `${year}-${month}-${day}`;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            let dailyHours = 0;
            if (data.timeIn && data.timeOut && data.timeOut !== "--") {
                dailyHours = calculateHoursFromTime(data.timeIn, data.timeOut);
            } else if (data.hoursRendered) {
                dailyHours = parseFloat(data.hoursRendered) || 0;
            }

            totalCompletedHours += dailyHours;

            if (data.date === todayDateStr) {
                if (data.timeIn) todayTimeIn = data.timeIn;
                if (data.timeOut && data.timeOut.trim() !== "") todayTimeOut = data.timeOut;

                if (todayTimeIn !== "--" && todayTimeOut !== "--") {
                    let dHours = calculateHoursFromTime(todayTimeIn, todayTimeOut);
                    let hrs = Math.floor(dHours);
                    let mins = Math.round((dHours - hrs) * 60);
                    todayRendered = `${hrs}h ${mins}m`;
                }
            }
        });

        updateTodayAttendanceUI(todayTimeIn, todayTimeOut, todayRendered);

        const roundedCompleted = Math.round(totalCompletedHours * 10) / 10;
        const remainingHours = Math.max(0, studentRequiredHours - roundedCompleted);
        const percentage = Math.min(100, Math.round((roundedCompleted / studentRequiredHours) * 100));

        updateHoursUI(roundedCompleted, studentRequiredHours, remainingHours, percentage);

        try {
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, {
                completedHours: roundedCompleted
            });
        } catch (updateErr) {
            console.warn("Could not sync completed hours to profile:", updateErr);
        }
    });
}

function updateHoursUI(completed, required, remaining, percentage) {
    const completedHeader = document.querySelector(".summary-card.green h2");
    if (completedHeader) completedHeader.textContent = `${completed} hours`;

    const progressFill = document.querySelector(".green-fill");
    if (progressFill) progressFill.style.width = `${percentage}%`;

    const completedSpan = document.querySelector(".summary-card.green span");
    if (completedSpan) completedSpan.textContent = `${percentage}% of required hours`;

    const requiredHeader = document.querySelector(".summary-card.blue h2");
    if (requiredHeader) requiredHeader.textContent = `${required} hours`;

    const remainingSub = document.querySelector(".card-sub");
    if (remainingSub) remainingSub.textContent = `${remaining} hours remaining`;

    const circlePercentage = document.querySelector(".circle h1");
    if (circlePercentage) circlePercentage.textContent = `${percentage}%`;

    const circleBg = document.querySelector(".circle");
    if (circleBg) {
        circleBg.style.background = `conic-gradient(#22c55e ${percentage}%, #ececec 0)`;
    }

    const detailItems = document.querySelectorAll(".detail-item strong");
    if (detailItems.length >= 2) {
        detailItems[0].textContent = `${completed} hrs`;
        detailItems[1].textContent = `${remaining} hrs`;
    }

    const requiredBoxVal = document.querySelector(".required-value");
    if (requiredBoxVal) requiredBoxVal.textContent = required;
}

function updateTodayAttendanceUI(timeIn, timeOut, totalToday) {
    const timeInElem = document.getElementById("today-timein-val");
    if (timeInElem) timeInElem.textContent = timeIn;

    const timeOutElem = document.getElementById("today-timeout-val");
    if (timeOutElem) timeOutElem.textContent = timeOut;

    const totalTodayElem = document.getElementById("total-rendered-today");
    if (totalTodayElem) totalTodayElem.textContent = totalToday;

    const timeinBox = document.getElementById("timein-box");
    const timeinIcon = document.getElementById("timein-icon");
    const timeinTitle = document.getElementById("timein-title");
    const timeinDesc = document.getElementById("timein-desc");

    const timeoutBox = document.getElementById("timeout-box");
    const timeoutIcon = document.getElementById("timeout-icon");
    const timeoutTitle = document.getElementById("timeout-title");
    const timeoutDesc = document.getElementById("timeout-desc");

    const hasTimedIn = timeIn && timeIn !== "--";
    const hasTimedOut = timeOut && timeOut !== "--";

    if (hasTimedOut) {
        if (timeinBox) timeinBox.className = "attendance-box green-box";
        if (timeinIcon) timeinIcon.className = "fa-solid fa-circle-check";
        if (timeinTitle) timeinTitle.textContent = "Timed In";
        if (timeinDesc) timeinDesc.textContent = "You timed in today.";

        if (timeoutBox) timeoutBox.className = "attendance-box green-box";
        if (timeoutIcon) timeoutIcon.className = "fa-solid fa-circle-check";
        if (timeoutTitle) timeoutTitle.textContent = "Timed Out";
        if (timeoutDesc) timeoutDesc.textContent = "You timed out today.";
    } else if (hasTimedIn) {
        if (timeinBox) timeinBox.className = "attendance-box green-box";
        if (timeinIcon) timeinIcon.className = "fa-solid fa-circle-check";
        if (timeinTitle) timeinTitle.textContent = "Timed In";
        if (timeinDesc) timeinDesc.textContent = "You timed in today.";

        if (timeoutBox) timeoutBox.className = "attendance-box orange-box";
        if (timeoutIcon) timeoutIcon.className = "fa-regular fa-clock";
        if (timeoutTitle) timeoutTitle.textContent = "Pending Time Out";
        if (timeoutDesc) timeoutDesc.textContent = "Don't forget to time out.";
    } else {
        if (timeinBox) timeinBox.className = "attendance-box orange-box";
        if (timeinIcon) timeinIcon.className = "fa-regular fa-clock";
        if (timeinTitle) timeinTitle.textContent = "Time In";
        if (timeinDesc) timeinDesc.textContent = "You haven't timed in yet.";

        if (timeoutBox) timeoutBox.className = "attendance-box orange-box";
        if (timeoutIcon) timeoutIcon.className = "fa-regular fa-clock";
        if (timeoutTitle) timeoutTitle.textContent = "Time Out";
        if (timeoutDesc) timeoutDesc.textContent = "Waiting for time in.";
    }
}

function initDropdownAndLogout() {
    const dropdownBtn = document.getElementById("profile-dropdown-btn");
    const dropdownMenu = document.getElementById("profile-dropdown-menu");
    const logoutBtn = document.getElementById("logout-btn");

    if (dropdownBtn && dropdownMenu) {
        dropdownBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle("show");
        });

        document.addEventListener("click", (e) => {
            if (!dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.remove("show");
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                localStorage.clear();
                window.location.href = "../student_login/student_login.html";
            } catch (err) {
                console.error("Logout error:", err);
            }
        });
    }
}

function initModalFetchAndLoad() {
    const viewAllBtn = document.getElementById("view-all-btn");
    const modalOverlay = document.getElementById("activities-modal-overlay");
    const explicitCloseBtn = document.getElementById("explicit-close-btn");

    if (viewAllBtn && modalOverlay) {
        viewAllBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            modalOverlay.style.display = "flex";

            if (auth.currentUser) {
                loadModalActivities(auth.currentUser.uid);
            }
        });
    }

    const closeModal = () => {
        if (modalOverlay) {
            modalOverlay.style.display = "none";
        }
    };

    if (explicitCloseBtn) {
        explicitCloseBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    if (modalOverlay) {
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }
}

function loadModalActivities(userId) {
    const attendanceQuery = query(
        collection(db, "attendance"),
        where("userId", "==", userId)
    );

    onSnapshot(attendanceQuery, (snapshot) => {
        let activityLogs = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            if (data.timeIn) {
                activityLogs.push({ 
                    title: "Time In Recorded", 
                    subtitle: `${data.date || "Recent"} • ${data.timeIn}`,
                    type: "timein",
                    durationText: "Logged In",
                    sortDate: data.date || ""
                });
            }

            if (data.timeOut && data.timeOut !== "--") {
                let sessionHoursText = "Completed";
                if (data.timeIn) {
                    let dHours = calculateHoursFromTime(data.timeIn, data.timeOut);
                    let hrs = Math.floor(dHours);
                    let mins = Math.round((dHours - hrs) * 60);
                    sessionHoursText = `${hrs}h ${mins}m`;
                }

                activityLogs.push({ 
                    title: "Time Out Recorded", 
                    subtitle: `${data.date || "Recent"} • ${data.timeOut}`,
                    type: "timeout",
                    durationText: sessionHoursText,
                    sortDate: data.date || ""
                });
            }
        });

        activityLogs.sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));
        
        const modalList = document.getElementById("all-activities-list");
        if (!modalList) return;

        modalList.innerHTML = "";

        if (activityLogs.length === 0) {
            modalList.innerHTML = `<div class="activity-item"><div class="activity-info"><h4>No activity history found</h4><p>Your records will appear here.</p></div></div>`;
            return;
        }

        activityLogs.forEach(act => {
            const item = document.createElement("div");
            item.className = "activity-item";
            
            let iconClass = "fa-solid fa-right-to-bracket";
            let colorClass = "green";

            if (act.type === "timeout") {
                iconClass = "fa-solid fa-right-from-bracket";
                colorClass = "blue";
            }

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div class="activity-icon ${colorClass}">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="activity-info">
                        <h4>${act.title}</h4>
                        <p>${act.subtitle}</p>
                    </div>
                </div>
                <span style="font-size: 13px; font-weight: 600; color: #64748b;">${act.durationText}</span>
            `;
            modalList.appendChild(item);
        });
    });
}

function initSidebar(activeMenuName) {
    const menuItems = document.querySelectorAll(".menu li");
    if (menuItems.length > 0) {
        menuItems.forEach(item => {
            const spanText = item.querySelector("span")?.textContent.trim();
            if (spanText && spanText.toLowerCase() === activeMenuName.toLowerCase()) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });
    }
}

function setupMobileMenuToggle() {
    document.addEventListener("click", (e) => {
        const mobileBtn = e.target.closest("#mobile-menu");
        const sidebar = document.getElementById("sidebar");

        if (mobileBtn && sidebar) {
            e.stopPropagation();
            sidebar.classList.toggle("show");
            return;
        }

        if (sidebar && sidebar.classList.contains("show")) {
            if (!sidebar.contains(e.target)) {
                sidebar.classList.remove("show");
            }
        }
    });
}