import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

export async function updateHeaderProfile(user) {
    const avatarEl = document.querySelector(".avatar") || document.getElementById("user-avatar") || document.getElementById("user-initials");
    if (!avatarEl) return;

    // Direct render from cache to avoid delays kung valid cached initials
    const cachedInitials = localStorage.getItem("user_initials");
    if (cachedInitials && cachedInitials !== "--") {
        avatarEl.textContent = cachedInitials;
    }

    try {
        let fullName = user.displayName || localStorage.getItem("user_fullname") || "";

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const student = userSnap.data();
            // Sinisigurong nababasa ang fullName o name mula sa Firestore mo
            if (student.fullName) {
                fullName = student.fullName;
            } else if (student.name) {
                fullName = student.name;
            } else if (student.firstName && student.lastName) {
                fullName = `${student.firstName} ${student.lastName}`.trim();
            }
        }

        if (!fullName && user.email) {
            fullName = user.email.split('@')[0];
        }

        if (!fullName) fullName = "Student Intern";

        const initials = getInitials(fullName);
        avatarEl.textContent = initials;

        localStorage.setItem("user_fullname", fullName);
        localStorage.setItem("user_initials", initials);
    } catch (error) {
        console.error("Error loading profile into header:", error);
        if (!avatarEl.textContent || avatarEl.textContent === "--") {
            avatarEl.textContent = "ST";
        }
    }
}

export async function loadHeader(title) {
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

        const avatarEl = document.querySelector(".avatar") || document.getElementById("user-avatar");
        const cachedInitials = localStorage.getItem("user_initials");
        if (avatarEl && cachedInitials && cachedInitials !== "--") {
            avatarEl.textContent = cachedInitials;
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                updateHeaderProfile(user);
            }
        });

        initHeaderEvents();
    } catch (err) {
        console.error("Error loading header:", err);
    }
}

function initHeaderEvents() {
    document.addEventListener("click", (e) => {
        const mobileMenuBtn = e.target.closest("#mobile-menu");
        const sidebar = document.getElementById("sidebar") || document.querySelector(".sidebar");

        if (mobileMenuBtn && sidebar) {
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