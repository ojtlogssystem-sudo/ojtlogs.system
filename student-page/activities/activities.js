import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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

document.addEventListener("DOMContentLoaded", () => {
    // Load Sidebar Template
    fetch("../templated/sidebar.html")
        .then(response => response.ok ? response.text() : "")
        .then(html => {
            const sidebarContainer = document.getElementById("sidebar-container");
            if (sidebarContainer && html) sidebarContainer.innerHTML = html;
            initSidebar("Activities");
        })
        .catch(err => console.error("Error loading sidebar:", err));

    setupMobileMenuToggle();

    onAuthStateChanged(auth, (user) => {
        if (user) {
            loadAllActivities(user.uid);
        } else {
            window.location.href = "../student_login/student_login.html";
        }
    });
});

// Helper para sa oras calculation
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
        return 0;
    }
}

function loadAllActivities(userId) {
    const attendanceQuery = query(
        collection(db, "attendance"),
        where("userId", "==", userId)
    );

    onSnapshot(attendanceQuery, (snapshot) => {
        let activityLogs = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            // 1. Time In Log
            if (data.timeIn) {
                activityLogs.push({ 
                    title: "Time In Recorded", 
                    subtitle: `${data.date || "Recent"} • ${data.timeIn}`,
                    type: "timein",
                    durationText: "Logged In",
                    sortDate: data.date || ""
                });
            }

            // 2. Time Out Log
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

            // 3. Task Submitted Log
            if (data.taskSubmitted || data.taskName) {
                activityLogs.push({
                    title: "Task Submitted",
                    subtitle: data.taskName || "Daily Task Completed",
                    type: "task",
                    durationText: "Submitted",
                    sortDate: data.date || ""
                });
            }

            // 4. Daily Photo Uploaded Log
            if (data.photoUploaded || data.photoUrl) {
                activityLogs.push({
                    title: "Daily Photo Uploaded",
                    subtitle: "Verification Complete",
                    type: "photo",
                    durationText: "Uploaded",
                    sortDate: data.date || ""
                });
            }
        });

        // I-sort ang lahat ng activities (pinakabago muna)
        activityLogs.sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));

        // I-render sa HTML nang walang limit
        renderAllActivitiesUI(activityLogs);
    });
}

function renderAllActivitiesUI(activities) {
    const activityList = document.getElementById("all-activities-list");
    if (!activityList) return;

    activityList.innerHTML = "";

    if (activities.length === 0) {
        activityList.innerHTML = `<div class="activity-item"><div class="activity-info"><h4>No activity history found</h4><p>Your records will appear here.</p></div></div>`;
        return;
    }

    activities.forEach(act => {
        const item = document.createElement("div");
        item.className = "activity-item";
        
        let iconClass = "fa-solid fa-right-to-bracket";
        let colorClass = "green";

        if (act.type === "timeout") {
            iconClass = "fa-solid fa-right-from-bracket";
            colorClass = "blue";
        } else if (act.type === "task") {
            iconClass = "fa-solid fa-list-check";
            colorClass = "blue";
        } else if (act.type === "photo") {
            iconClass = "fa-solid fa-camera";
            colorClass = "orange";
        }

        item.innerHTML = `
            <div class="activity-icon ${colorClass}">
                <i class="${iconClass}"></i>
            </div>
            <div class="activity-info">
                <h4>${act.title}</h4>
                <p>${act.subtitle}</p>
            </div>
            <span style="font-size: 13px; font-weight: 600; color: #64748b;">${act.durationText}</span>
        `;
        activityList.appendChild(item);
    });
}

function initSidebar(activeMenuName) {
    const menuItems = document.querySelectorAll(".menu li");
    menuItems.forEach(item => {
        const spanText = item.querySelector("span")?.textContent.trim();
        if (spanText && spanText.toLowerCase() === activeMenuName.toLowerCase()) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });
}

function setupMobileMenuToggle() {
    document.addEventListener("click", (e) => {
        const mobileBtn = e.target.closest("#mobile-menu");
        const sidebar = document.getElementById("sidebar");
        if (mobileBtn && sidebar) {
            e.stopPropagation();
            sidebar.classList.toggle("show");
        }
    });
}