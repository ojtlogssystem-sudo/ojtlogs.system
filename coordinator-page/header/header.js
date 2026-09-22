import { auth, db } from "../config/firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeNotifications = null;

// ========================================
// LOAD HEADER HTML & INITIALIZE
// ========================================
export function loadHeader() {
    const headerContainer = document.getElementById("header-container");
    if (!headerContainer) return;

    // Isaksak ang HTML structure ng Header
    headerContainer.innerHTML = `
        <header class="top-header">
            <div class="header-left">
                <h2 id="pageTitle">Dashboard</h2>
            </div>
            <div class="header-right">
                <div class="notification-wrapper">
                    <button id="notifBtn" class="icon-btn">
                        <i class="fas fa-bell"></i>
                        <span id="notifBadge" class="badge hidden">0</span>
                    </button>
                    <div id="notifDropdown" class="dropdown-menu hidden">
                        <div class="dropdown-header">
                            <h3>Notifications</h3>
                            <button id="markAllRead">Mark all as read</button>
                        </div>
                        <div id="notifList" class="notif-list">
                            <p class="empty-notif">No new notifications</p>
                        </div>
                    </div>
                </div>
                <div class="user-profile">
                    <img id="userAvatar" src="../assets/default-avatar.png" alt="Profile" class="avatar">
                    <span id="userName">Loading...</span>
                    <button id="logoutBtn" class="logout-btn" title="Logout">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                </div>
            </div>
        </header>
    `;

    // Initialize Auth Listener & UI Events
    initAuthListener();
    initLogout();
    initNotificationDropdown();
}

// ========================================
// AUTH STATE LISTENER
// ========================================
function initAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            // REDIRECT SA STUDENT LOGIN KAPAG WALANG USER
            window.location.href = "../student_login/student_login.html";
            return;
        }

        try {
            // Kunin ang User Profile Data mula sa Firestore
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
                const userData = userDoc.data();
                const userNameEl = document.getElementById("userName");
                const userAvatarEl = document.getElementById("userAvatar");

                if (userNameEl) {
                    userNameEl.textContent = userData.fullName || userData.name || "User";
                }
                if (userAvatarEl && userData.profilePic) {
                    userAvatarEl.src = userData.profilePic;
                }
            }

            // Simulan ang pakikinig sa notifications
            listenForNotifications(user.uid);

        } catch (error) {
            console.error("Error loading user profile in header:", error);
        }
    });
}

// ========================================
// LOGOUT FUNCTIONALITY
// ========================================
function initLogout() {
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();

        try {
            stopNotifications();
            await signOut(auth);

            // REDIRECT SA STUDENT LOGIN KAPAG NAG-LOGOUT
            window.location.href = "../student_login/student_login.html";

        } catch (err) {
            console.error("Logout Error:", err);
            alert("Failed to log out. Please try again.");
        }
    });
}

// ========================================
// NOTIFICATIONS REALTIME LISTENER
// ========================================
function listenForNotifications(userId) {
    const notifRef = collection(db, "notifications");
    const q = query(
        notifRef,
        where("userId", "==", userId)
    );

    unsubscribeNotifications = onSnapshot(q, (snapshot) => {
        const notifBadge = document.getElementById("notifBadge");
        const notifList = document.getElementById("notifList");

        if (!notifList) return;

        let unreadCount = 0;
        let htmlContent = "";

        if (snapshot.empty) {
            notifList.innerHTML = `<p class="empty-notif">No new notifications</p>`;
            if (notifBadge) notifBadge.classList.add("hidden");
            return;
        }

        snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.isRead) unreadCount++;

            htmlContent += `
                <div class="notif-item ${data.isRead ? 'read' : 'unread'}" data-id="${docSnap.id}">
                    <p class="notif-title">${data.title || 'Notification'}</p>
                    <p class="notif-message">${data.message || ''}</p>
                    <span class="notif-time">${data.createdAt ? new Date(data.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
            `;
        });

        notifList.innerHTML = htmlContent;

        if (notifBadge) {
            if (unreadCount > 0) {
                notifBadge.textContent = unreadCount;
                notifBadge.classList.remove("hidden");
            } else {
                notifBadge.classList.add("hidden");
            }
        }
    }, (error) => {
        console.error("Error listening to notifications:", error);
    });
}

function stopNotifications() {
    if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
    }
}

// ========================================
// DROPDOWN TOGGLE & MARK AS READ
// ========================================
function initNotificationDropdown() {
    const notifBtn = document.getElementById("notifBtn");
    const notifDropdown = document.getElementById("notifDropdown");
    const markAllReadBtn = document.getElementById("markAllRead");

    if (notifBtn && notifDropdown) {
        notifBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle("hidden");
        });

        // Isara ang dropdown kapag nag-click sa labas
        document.addEventListener("click", (e) => {
            if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
                notifDropdown.classList.add("hidden");
            }
        });
    }

    if (markAllReadBtn) {
        markAllReadBtn.addEventListener("click", async () => {
            const user = auth.currentUser;
            if (!user) return;

            try {
                // Halimbawa ng pag-mark as read sa UI state
                const unreadItems = document.querySelectorAll(".notif-item.unread");
                unreadItems.forEach((item) => {
                    item.classList.remove("unread");
                    item.classList.add("read");
                });

                const notifBadge = document.getElementById("notifBadge");
                if (notifBadge) notifBadge.classList.add("hidden");

            } catch (err) {
                console.error("Error marking notifications as read:", err);
            }
        });
    }
}

// Awtomatikong i-load kapag na-import ang script kung kinakailangan
document.addEventListener("DOMContentLoaded", () => {
    loadHeader();
});