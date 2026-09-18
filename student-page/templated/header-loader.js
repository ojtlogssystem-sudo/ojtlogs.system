import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

export function getInitials(fullName) {
    if (!fullName) return "ST";
    const nameParts = fullName.trim().split(" ").filter(part => part.length > 0);
    
    if (nameParts.length === 1) {
        return nameParts[0].charAt(0).toUpperCase();
    }
    
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getSeenExceptionDates() {
    try {
        const raw = localStorage.getItem("seen_exception_dates");
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function markExceptionDatesSeen(dates) {
    const seen = getSeenExceptionDates();
    const merged = Array.from(new Set([...seen, ...dates]));
    localStorage.setItem("seen_exception_dates", JSON.stringify(merged));
}

export async function updateHeaderProfile(user) {
    const avatarEl = document.querySelector(".avatar") || document.getElementById("user-avatar") || document.getElementById("user-initials");
    const nameEl = document.getElementById("dropdown-user-fullname");
    if (!avatarEl && !nameEl) return;

    const cachedInitials = localStorage.getItem("user_initials");
    if (avatarEl && cachedInitials && cachedInitials !== "--") {
        avatarEl.textContent = cachedInitials;
    }
    const cachedFullName = localStorage.getItem("user_fullname");
    if (nameEl && cachedFullName) {
        nameEl.textContent = cachedFullName;
    }

    try {
        let fullName = user.displayName || localStorage.getItem("user_fullname") || "";
        let photo = null;

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const student = userSnap.data();
            if (student.fullName) {
                fullName = student.fullName;
            } else if (student.name) {
                fullName = student.name;
            } else if (student.firstName && student.lastName) {
                fullName = `${student.firstName} ${student.lastName}`.trim();
            }
            photo = student.photo || student.profilePic || student.photoURL || student.image || student.avatar || null;
        }

        if (!fullName && user.email) {
            fullName = user.email.split('@')[0];
        }

        if (!fullName) fullName = "Student Intern";

        const initials = getInitials(fullName);
        if (avatarEl) {
            if (photo) {
                avatarEl.innerHTML = `<img src="${photo}" alt="${escapeHtml(fullName)}">`;
            } else {
                avatarEl.textContent = initials;
            }
        }
        if (nameEl) nameEl.textContent = fullName;

        localStorage.setItem("user_fullname", fullName);
        localStorage.setItem("user_initials", initials);
    } catch (error) {
        console.error("Error loading profile into header:", error);
        if (avatarEl && (!avatarEl.textContent || avatarEl.textContent === "--")) {
            avatarEl.textContent = "ST";
        }
    }
}

/* ==========================================
   AI OJT COMPLETION-DATE SUGGESTION
   Populated by pages that own the hours/attendance data
   (currently the Student Dashboard) via
   updateHeaderCompletionEstimate(). Cached in localStorage
   so the pill can instantly repaint on other pages/reloads
   while the authoritative calculation is still in flight.
========================================== */
export function updateHeaderCompletionEstimate(payload) {
    const pill = document.getElementById("ai-completion-pill");
    const textEl = document.getElementById("ai-completion-text");
    const panel = document.getElementById("ai-completion-panel");
    const panelBody = document.getElementById("ai-completion-panel-body");
    if (!pill || !textEl) return;

    if (!payload) {
        pill.style.display = "none";
        return;
    }

    const { completed, required, remaining, estimatedDate, avgHoursPerDay, dutyDaysLogged, isDone } = payload;

    pill.style.display = "flex";
    pill.classList.toggle("completed", !!isDone);

    if (isDone) {
        textEl.textContent = `OJT complete! ${completed}/${required} hrs`;
    } else if (estimatedDate) {
        textEl.textContent = `Est. finish: ${estimatedDate}`;
    } else {
        textEl.textContent = `Log more hours for an estimate`;
    }

    if (panel && panelBody) {
        panel.classList.toggle("completed-panel", !!isDone);

        if (isDone) {
            panelBody.innerHTML = `
                <div class="ai-suggestion-row"><span>Hours completed</span><strong>${completed} / ${required} hrs</strong></div>
                <p class="ai-suggestion-note">🎉 You've hit your required OJT hours. Nice work!</p>
            `;
        } else if (estimatedDate) {
            panelBody.innerHTML = `
                <div class="ai-suggestion-row"><span>Hours completed</span><strong>${completed} / ${required} hrs</strong></div>
                <div class="ai-suggestion-row"><span>Remaining</span><strong>${remaining} hrs</strong></div>
                <div class="ai-suggestion-row"><span>Your avg. per duty day</span><strong>${avgHoursPerDay} hrs</strong></div>
                <p class="ai-suggestion-note">Based on your average of ${avgHoursPerDay} hrs across ${dutyDaysLogged} duty ${dutyDaysLogged === 1 ? "day" : "days"} so far, you're on track to finish around <strong>${estimatedDate}</strong> (weekdays only).</p>
            `;
        } else {
            panelBody.innerHTML = `<p class="ai-suggestion-empty">Time in/out on a few duty days first — the estimate is based on your own average hours per day.</p>`;
        }
    }

    try {
        localStorage.setItem("ai_completion_estimate", JSON.stringify(payload));
    } catch (e) {
        console.warn("Could not cache completion estimate:", e);
    }
}

/* ==========================================
   NOTIFICATION BELL (Coordinator "No Duty" Exceptions)
   Data source: Firestore "calendar_exceptions" collection
   Doc shape: { date: "YYYY-MM-DD", reason: "...", updatedAt: Date }
========================================== */
export async function loadNotifications() {
    const notifBtn = document.getElementById("notification-btn");
    const badge = document.getElementById("notification-badge");
    const panel = document.getElementById("notification-panel");
    const listEl = document.getElementById("notification-list");
    if (!notifBtn || !panel || !listEl) return;

    let exceptions = [];
    try {
        const snap = await getDocs(collection(db, "calendar_exceptions"));
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data && data.date) {
                const postedRaw = data.updatedAt?.toDate
                    ? data.updatedAt.toDate()
                    : (data.updatedAt ? new Date(data.updatedAt) : null);
                exceptions.push({ date: data.date, reason: data.reason || "No Duty / Excused", posted: postedRaw });
            }
        });
    } catch (error) {
        console.error("Error loading calendar exceptions for notifications:", error);
        listEl.innerHTML = `<div class="notif-empty">Unable to load notifications.</div>`;
        return;
    }

    // Limit sa relevant window: 3 days na nakalipas hanggang 60 days pasulong
    const now = new Date();
    const windowStart = new Date(now); windowStart.setDate(windowStart.getDate() - 3);
    const windowEnd = new Date(now); windowEnd.setDate(windowEnd.getDate() + 60);

    exceptions = exceptions.filter(ex => {
        const d = new Date(`${ex.date}T00:00:00`);
        return !isNaN(d) && d >= windowStart && d <= windowEnd;
    });

    exceptions.sort((a, b) => new Date(a.date) - new Date(b.date));

    // "Seen" only controls the badge count and each item's read styling —
    // the notification itself always stays visible in the list.
    const seenList = getSeenExceptionDates();
    const unseenCount = exceptions.filter(ex => !seenList.includes(ex.date)).length;

    if (badge) {
        if (unseenCount > 0) {
            badge.textContent = unseenCount > 9 ? "9+" : String(unseenCount);
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    }

    if (exceptions.length === 0) {
        listEl.innerHTML = `<div class="notif-empty">No new notifications.</div>`;
    } else {
        listEl.innerHTML = exceptions.map(ex => {
            const postedLabel = (ex.posted || new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const isUnseen = !seenList.includes(ex.date);
            return `
                <div class="notif-item ${isUnseen ? "unseen" : ""}" data-date="${escapeHtml(ex.date)}">
                    <div class="notif-item-top">
                        <p class="notif-title">Suspension<br>(${escapeHtml(ex.date)})</p>
                        <span class="notif-posted">Posted: ${postedLabel}</span>
                    </div>
                    <p class="notif-note">Coordinator Note: ${escapeHtml(ex.reason)}</p>
                </div>
            `;
        }).join("");
    }

    // Per-item mark-as-read: clicking a notification only clears that item's
    // own unseen state (and decrements the badge by one). Opening the panel
    // itself no longer marks everything as seen.
    listEl.addEventListener("click", (e) => {
        const item = e.target.closest(".notif-item");
        if (!item || !item.classList.contains("unseen")) return;

        const date = item.dataset.date;
        if (date) markExceptionDatesSeen([date]);
        item.classList.remove("unseen");

        const remainingUnseen = listEl.querySelectorAll(".notif-item.unseen").length;
        if (badge) {
            if (remainingUnseen > 0) {
                badge.textContent = remainingUnseen > 9 ? "9+" : String(remainingUnseen);
            } else {
                badge.style.display = "none";
            }
        }
    });

    const clearAllBtn = document.getElementById("notification-clear-all");
    if (clearAllBtn) {
        clearAllBtn.onclick = (e) => {
            e.stopPropagation();
            const allDates = exceptions.map(ex => ex.date);
            markExceptionDatesSeen(allDates);
            if (badge) badge.style.display = "none";
            listEl.querySelectorAll(".notif-item.unseen").forEach(el => el.classList.remove("unseen"));
        };
    }
}

export async function loadHeader(title, options = {}) {
    try {
        const response = await fetch("../templated/header.html");
        const data = await response.text();
        
        const headerContainer = document.getElementById("header-container");
        if (headerContainer) {
            headerContainer.innerHTML = data;
        }

        const pageTitle = document.getElementById("page-title");
        if (pageTitle) {
            pageTitle.textContent = title;
        }

        // Instant paint from cache while the authoritative profile fetch (done by
        // the page itself, e.g. loadStudentData) is still in flight.
        const avatarEl = document.getElementById("user-avatar") || document.querySelector(".avatar");
        const cachedInitials = localStorage.getItem("user_initials");
        if (avatarEl && cachedInitials && cachedInitials !== "--") {
            avatarEl.textContent = cachedInitials;
        }

        const nameEl = document.getElementById("dropdown-user-fullname");
        const cachedFullName = localStorage.getItem("user_fullname");
        if (nameEl && cachedFullName) {
            nameEl.textContent = cachedFullName;
        }

        // Same instant-paint treatment for the AI completion-date pill: show
        // the last known estimate immediately, then whichever page owns the
        // hours data (e.g. the dashboard) will overwrite it with a fresh one.
        try {
            const cachedEstimate = localStorage.getItem("ai_completion_estimate");
            if (cachedEstimate) {
                updateHeaderCompletionEstimate(JSON.parse(cachedEstimate));
            }
        } catch (e) {
            console.warn("Could not restore cached completion estimate:", e);
        }

        // Pages that don't manage their own profile data can opt in to the
        // header's Firestore-backed profile loader.
        if (options.autoLoadProfile) {
            onAuthStateChanged(auth, (user) => {
                if (user) updateHeaderProfile(user);
            });
        }
        // The notification bell is owned by the header itself now, so it
        // always loads — no per-page opt-in needed.
        loadNotifications();

        initHeaderEvents();
    } catch (err) {
        console.error("Error loading header:", err);
    }
}

function closeDropdown(el) {
    if (!el) return;
    el.classList.remove("show");
    el.style.display = "";
}

function initHeaderEvents() {
    const notifBtn = document.getElementById("notification-btn");
    const notifPanel = document.getElementById("notification-panel");
    const profileBtn = document.getElementById("profile-btn");
    const profileMenu = document.getElementById("profile-dropdown-menu");
    const logoutBtn = document.getElementById("logout-btn");
    const aiBtn = document.getElementById("ai-completion-pill");
    const aiPanel = document.getElementById("ai-completion-panel");

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

    document.addEventListener("click", (e) => {
        const mobileMenuBtn = e.target.closest("#mobile-menu");
        const sidebar = document.getElementById("sidebar") || document.querySelector(".sidebar");

        if (mobileMenuBtn && sidebar) {
            e.stopPropagation();
            sidebar.classList.toggle("show");
            return;
        }
        if (sidebar && sidebar.classList.contains("show") && !sidebar.contains(e.target)) {
            sidebar.classList.remove("show");
        }

        const notifClick = notifBtn && notifBtn.contains(e.target);
        const profileClick = profileBtn && profileBtn.contains(e.target);
        const aiClick = aiBtn && aiBtn.contains(e.target);

        if (notifClick) {
            e.stopPropagation();
            closeDropdown(profileMenu);
            closeDropdown(aiPanel);
            if (notifPanel) notifPanel.classList.toggle("show");
            return;
        }
        if (notifPanel && !notifBtn.contains(e.target)) {
            closeDropdown(notifPanel);
        }

        if (aiClick) {
            e.stopPropagation();
            closeDropdown(notifPanel);
            closeDropdown(profileMenu);
            if (aiPanel) aiPanel.classList.toggle("show");
            return;
        }
        if (aiPanel && aiBtn && !aiBtn.contains(e.target)) {
            closeDropdown(aiPanel);
        }

        if (profileClick) {
            e.stopPropagation();
            if (notifPanel) closeDropdown(notifPanel);
            closeDropdown(aiPanel);
            if (profileMenu) profileMenu.classList.toggle("show");
            return;
        }
        if (profileMenu && !profileBtn.contains(e.target)) {
            closeDropdown(profileMenu);
        }
    });
}