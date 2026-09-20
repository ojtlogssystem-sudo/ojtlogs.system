/* ================================================================
   SHARED COORDINATOR HEADER (logic)
   ================================================================
   Isang beses lang ito i-eedit kapag may babaguhin sa header
   (profile dropdown, notification bell, logout, page title/
   subtitle) - awtomatiko nang maaapply ang bago sa LAHAT ng
   coordinator page na naglo-load ng file na ito.

   PAANO GAMITIN SA IBANG PAGE:

       <header
           id="header-container"
           data-page-title="Attendance"
           data-page-subtitle="Monitor student attendance and view complete attendance records."
       ></header>

       <link rel="stylesheet" href="../header/header.css">
       <script type="module" src="../header/header.js"></script>

   - data-page-title: text na lalabas sa <h2> ng header.
   - data-page-subtitle: text sa ilalim ng title. Kung gusto mong
     lumabas dito ang pangalan ng naka-login na coordinator (tulad
     ng sa Dashboard na "Welcome back, Juan."), maglagay ng {name}
     placeholder sa loob ng subtitle, hal:
         data-page-subtitle="Welcome back, {name}."
     Papalitan ito ni header.js ng aktwal na pangalan pagkatapos
     ma-fetch ang profile mula sa Firestore.
================================================================= */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    where,
    onSnapshot,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// ========================================
// FIREBASE (reuse the app if some other
// script on the page already initialized
// it, para hindi mag-crash sa "duplicate
// app" error)
// ========================================

const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// ========================================
// NOTIFICATION STATE (weekly report submissions)
// ========================================

let studentNameMap = {};
let notifItems = [];
let notifLastSeenAt = 0;
let notifStorageKey = "coordinatorNotifLastSeen";
let notifUnsubscribe = null;


// ========================================
// LOAD + WIRE UP THE HEADER
// ========================================

async function loadHeader() {

    const container =
        document.getElementById("header-container");

    if (!container) {
        return;
    }

    const pageTitle =
        container.getAttribute("data-page-title") || "Dashboard";

    const pageSubtitleTemplate =
        container.getAttribute("data-page-subtitle") ||
        "Welcome back, {name}.";

    try {

        // Resolve the partial relative to header.js itself, so this
        // still works regardless of which page (and folder depth)
        // included it.
        const partialUrl =
            new URL("header.html", import.meta.url);

        const response =
            await fetch(partialUrl);

        container.innerHTML =
            await response.text();

    } catch (error) {

        console.error("Could not load shared header:", error);
        return;

    }

    const titleEl =
        document.getElementById("headerPageTitle");

    if (titleEl) {
        titleEl.textContent = pageTitle;
    }

    // Ilalagay muna ang subtitle na may "Coordinator" bilang
    // default placeholder - papalitan ito ng tunay na pangalan
    // pagkatapos ma-fetch ang profile (see updateProfileUI).
    applySubtitle(pageSubtitleTemplate, "Coordinator");

    initProfileMenu();
    initNotificationDropdown();
    initLogout();

    onAuthStateChanged(auth, async (user) => {

        if (!user) {

            window.location.href =
                "../coordinator_login/coordinator_login.html";

            return;

        }

        try {

            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            const userData =
                userDoc.exists() ? userDoc.data() : {};

            updateProfileUI(userData, user, pageSubtitleTemplate);

            startWeeklyReportNotifications(user.uid);

        } catch (error) {

            console.error(
                "Error fetching coordinator details for header:",
                error
            );

        }

    });

}


function applySubtitle(template, name) {

    const subtitleEl =
        document.getElementById("headerPageSubtitle");

    if (!subtitleEl) {
        return;
    }

    if (template.includes("{name}")) {

        subtitleEl.textContent =
            template.replace("{name}", name);

    } else {

        subtitleEl.textContent = template;

    }

}


// ========================================
// PROFILE UI
// ========================================

function updateProfileUI(userData, authUser, pageSubtitleTemplate) {

    const fullName =
        userData.name ||
        userData.fullName ||
        authUser.displayName ||
        "OJT Coordinator";

    const role =
        userData.role ||
        userData.position ||
        "Coordinator";

    const userName =
        document.getElementById("userName");

    const userRole =
        document.getElementById("userRole");

    const userAvatar =
        document.getElementById("userAvatar");

    if (userName) {
        userName.textContent = fullName;
    }

    if (userRole) {
        userRole.textContent = role.toUpperCase();
    }

    applySubtitle(pageSubtitleTemplate, fullName);

    // Profile photo, if the coordinator uploaded one in Account
    // Settings (saved as photoBase64 or photoURL), otherwise
    // falls back to initials.
    const photo =
        userData.photoBase64 ||
        userData.photoURL ||
        authUser.photoURL ||
        null;

    paintAvatar(userAvatar, photo, fullName);
    paintAvatar(document.getElementById("menuAvatar"), photo, fullName);

    const menuName =
        document.getElementById("menuName");

    const menuEmail =
        document.getElementById("menuEmail");

    if (menuName) {
        menuName.textContent = fullName;
    }

    if (menuEmail) {
        menuEmail.textContent = authUser.email || "—";
    }

}


function paintAvatar(element, photo, name) {

    if (!element) return;

    const initials = (name || "")
        .split(" ")
        .filter(n => n.length > 0)
        .map(n => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase() || "CO";

    if (photo) {

        element.innerHTML = "";

        const img =
            document.createElement("img");

        img.alt = name || "Profile photo";
        img.src = photo;

        // If the stored image is broken, drop back to initials.
        img.onerror = () => {
            element.textContent = initials;
        };

        element.appendChild(img);

    } else {

        element.textContent = initials;

    }

}


// ========================================
// PROFILE DROPDOWN
// ========================================

function initProfileMenu() {

    const trigger =
        document.getElementById("profileMenuTrigger");

    if (!trigger) return;

    trigger.addEventListener("click", (e) => {

        // Clicks on the menu items handle themselves.
        if (e.target.closest(".profile-menu")) return;

        trigger.classList.toggle("open");

        // Close the notification dropdown if it's open.
        document.getElementById("notifBell")
            ?.classList.remove("open");

    });

    document.addEventListener("click", (e) => {

        if (!trigger.contains(e.target)) {
            trigger.classList.remove("open");
        }

    });

    document.addEventListener("keydown", (e) => {

        if (e.key === "Escape") {
            trigger.classList.remove("open");
        }

    });

    // "Account settings" -> go to the settings page.
    const showProfileBtn =
        document.getElementById("showProfileBtn");

    if (showProfileBtn) {

        showProfileBtn.addEventListener("click", () => {

            window.location.href =
                "../settings/settings.html";

        });

    }

}


// ========================================
// LOGOUT
// ========================================

function initLogout() {

    const logoutBtn =
        document.getElementById("logoutBtn");

    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", async (e) => {

        e.preventDefault();

        try {

            if (notifUnsubscribe) {
                notifUnsubscribe();
            }

            await signOut(auth);

            window.location.href =
                "../coordinator_login/coordinator_login.html";

        } catch (err) {

            console.error("Logout Error:", err);

        }

    });

}


// ========================================
// NOTIFICATIONS: STUDENT NAME LOOKUP
// ========================================

async function buildStudentNameMap() {

    try {

        const usersRef =
            collection(db, "users");

        const studentQuery =
            query(
                usersRef,
                where("role", "==", "student")
            );

        const snapshot =
            await getDocs(studentQuery);

        const map = {};

        snapshot.forEach((docSnap) => {

            const data = docSnap.data();

            const name =
                data.name ||
                data.fullName ||
                data.email ||
                "A student";

            map[docSnap.id] = name;

            if (data.uid) {
                map[String(data.uid).trim()] = name;
            }

            if (data.email) {
                map[String(data.email).toLowerCase().trim()] = name;
            }

        });

        studentNameMap = map;

    } catch (error) {

        console.error(
            "Error building student name map for notifications:",
            error
        );

    }

}


function getStudentNameForReport(data) {

    const studentId =
        data.userId || data.studentId;

    const possibleEmail =
        (data.email || data.studentEmail || "")
            .toLowerCase()
            .trim();

    return (
        studentNameMap[studentId] ||
        studentNameMap[possibleEmail] ||
        "A student"
    );

}


// ========================================
// NOTIFICATIONS: RELATIVE TIME
// ========================================

function notifTimeAgo(ms) {

    if (!ms) return "";

    const diffSec =
        Math.floor((Date.now() - ms) / 1000);

    if (diffSec < 60) return "Just now";

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;

    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;

    return new Date(ms).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" }
    );

}


// ========================================
// NOTIFICATIONS: RENDER LIST + BADGE
// ========================================

function renderNotifications() {

    const listEl =
        document.getElementById("notifList");

    const badgeEl =
        document.getElementById("notifBadge");

    if (!listEl) return;

    if (notifItems.length === 0) {

        listEl.innerHTML =
            '<div class="notif-empty">No report submissions yet.</div>';

    } else {

        listEl.innerHTML = notifItems.map((item) => {

            const unread =
                item.timestamp > notifLastSeenAt;

            return `
                <div class="notif-item ${unread ? "unread" : ""}" data-report-id="${item.id}">
                    <div class="notif-icon">
                        <i class="fa-solid fa-file-circle-check"></i>
                    </div>
                    <div class="notif-text">
                        <p><strong>${item.studentName}</strong> submitted a weekly report.</p>
                        <span>${notifTimeAgo(item.timestamp)}</span>
                    </div>
                    ${unread ? '<span class="notif-dot"></span>' : ""}
                </div>
            `;

        }).join("");

    }

    const unreadCount =
        notifItems.filter(
            (item) => item.timestamp > notifLastSeenAt
        ).length;

    if (badgeEl) {

        if (unreadCount > 0) {

            badgeEl.textContent =
                unreadCount > 9 ? "9+" : String(unreadCount);

            badgeEl.style.display = "flex";

        } else {

            badgeEl.style.display = "none";

        }

    }

}


function markNotificationsRead() {

    notifLastSeenAt = Date.now();

    try {
        localStorage.setItem(
            notifStorageKey,
            String(notifLastSeenAt)
        );
    } catch (error) {
        console.error("Could not save notif read state:", error);
    }

    renderNotifications();

}


// ========================================
// NOTIFICATIONS: LIVE LISTENER
// Watches the "weekly_reports" collection so
// new student submissions show up right away,
// without needing to refresh the page - sa
// ANUMANG coordinator page na may header na ito.
// ========================================

async function startWeeklyReportNotifications(uid) {

    notifStorageKey =
        `coordinatorNotifLastSeen_${uid}`;

    notifLastSeenAt =
        Number(localStorage.getItem(notifStorageKey)) || 0;

    await buildStudentNameMap();

    const reportsRef =
        collection(db, "weekly_reports");

    const notifQuery =
        query(
            reportsRef,
            orderBy("submittedAt", "desc"),
            limit(20)
        );

    if (notifUnsubscribe) {
        notifUnsubscribe();
    }

    notifUnsubscribe = onSnapshot(
        notifQuery,
        (snapshot) => {

            notifItems = snapshot.docs.map((docSnap) => {

                const data = docSnap.data();

                const rawDate = data.submittedAt;

                const timestamp =
                    rawDate?.seconds
                        ? rawDate.seconds * 1000
                        : (rawDate ? new Date(rawDate).getTime() : 0);

                return {
                    id: docSnap.id,
                    studentName: getStudentNameForReport(data),
                    timestamp: timestamp || 0
                };

            });

            renderNotifications();

        },
        (error) => {

            console.error(
                "Error listening for report notifications:",
                error
            );

        }
    );

}


// ========================================
// NOTIFICATIONS: BELL DROPDOWN
// ========================================

function initNotificationDropdown() {

    const bell =
        document.getElementById("notifBell");

    const markBtn =
        document.getElementById("notifMarkReadBtn");

    if (!bell) return;

    bell.addEventListener("click", (e) => {

        if (e.target.closest("#notifMarkReadBtn")) return;

        // Clicking a notification item scrolls to the weekly
        // reports table INSTEAD of just toggling - only does
        // anything on pages that actually have that table
        // (e.g. the Dashboard); harmless no-op elsewhere.
        const clickedItem = e.target.closest(".notif-item");

        if (clickedItem) {

            bell.classList.remove("open");

            document
                .getElementById("weeklyReportsTableBody")
                ?.closest("table")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });

            return;

        }

        const isOpening =
            !bell.classList.contains("open");

        bell.classList.toggle("open");

        // Close the profile dropdown if it's open.
        document.getElementById("profileMenuTrigger")
            ?.classList.remove("open");

        if (isOpening) {

            renderNotifications();

            // Give the user a moment to see what's new
            // before quietly marking it all as read.
            setTimeout(() => {

                if (bell.classList.contains("open")) {
                    markNotificationsRead();
                }

            }, 1500);

        }

    });

    if (markBtn) {

        markBtn.addEventListener("click", (e) => {

            e.stopPropagation();

            markNotificationsRead();

        });

    }

    document.addEventListener("click", (e) => {

        if (!bell.contains(e.target)) {
            bell.classList.remove("open");
        }

    });

    document.addEventListener("keydown", (e) => {

        if (e.key === "Escape") {
            bell.classList.remove("open");
        }

    });

}


// ========================================
// RUN
// ========================================

document.addEventListener("DOMContentLoaded", loadHeader);