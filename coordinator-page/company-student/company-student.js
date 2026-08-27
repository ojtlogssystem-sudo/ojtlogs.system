// company-student.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    onSnapshot,
    query,
    where 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase Config
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

// Kunin ang URL Parameter (Kumpanyang Pinindot)
const urlParams = new URLSearchParams(window.location.search);
const selectedCompany = urlParams.get("company") || "";

function getInitials(fullName) {
    if (!fullName) return "ST";
    const nameParts = fullName.trim().split(" ").filter(part => part.length > 0);
    if (nameParts.length === 1) return nameParts[0].charAt(0).toUpperCase();
    return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase();
}

document.addEventListener("DOMContentLoaded", () => {
    if (selectedCompany) {
        document.getElementById("companyPageTitle").textContent = `${selectedCompany} Students`;
        document.getElementById("companyPageSubtitle").textContent = `View and manage student interns assigned to ${selectedCompany}.`;
    }

    // Back button
    document.getElementById("backToCompaniesBtn")?.addEventListener("click", () => {
        window.location.href = "../companies/companies.html";
    });

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            listenToCompanyStudents();
        } else {
            window.location.href = "../login/login.html";
        }
    });

    initTableFilters();
});

/* ==========================================
   LISTEN & FILTER STUDENTS BY COMPANY
========================================== */
function listenToCompanyStudents() {
    const tableBody = document.getElementById("studentTable");
    if (!tableBody) return;

    const usersRef = collection(db, "users");
    const usersQuery = query(usersRef, where("role", "==", "student"));

    onSnapshot(usersQuery, (snapshot) => {
        tableBody.innerHTML = "";
        let matchedCount = 0;

        snapshot.forEach((docSnap) => {
            const userData = docSnap.data();
            const studentCompany = userData.companyName || userData.company || "";

            if (studentCompany.toLowerCase() === selectedCompany.toLowerCase()) {
                matchedCount++;

                const isComplete = userData.isProfileComplete === true || userData.profileCompleted === true;
                const status = isComplete ? "Active" : (userData.status || "Pending");

                const fullName = userData.fullName || userData.name || 
                    (userData.firstName ? `${userData.firstName} ${userData.lastName}` : "Student Intern");
                
                const studentNumber = userData.studentNumber || userData.studentId || "N/A";
                const course = userData.course || "BSIT";
                const section = userData.section || "N/A";
                const profilePic = userData.photo || userData.profilePic || userData.photoURL || userData.image || userData.avatar;

                const initials = getInitials(fullName);
                const statusClass = status.toLowerCase();

                let photoMarkup = "";
                if (profilePic && profilePic.trim() !== "") {
                    photoMarkup = `
                        <div class="photo-wrapper">
                            <img src="${profilePic}" class="student-photo" alt="Student Profile" 
                                 onload="this.nextElementSibling.style.display='none';"
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                            <div class="student-avatar-fallback" style="display:none;">${initials}</div>
                        </div>
                    `;
                } else {
                    photoMarkup = `<div class="student-avatar-fallback">${initials}</div>`;
                }

                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${photoMarkup}</td>
                    <td>${studentNumber}</td>
                    <td>
                        <strong>${fullName}</strong><br>
                        <small style="color:#777;">${userData.email || ''}</small>
                    </td>
                    <td>${course}</td>
                    <td>${section}</td>
                    <td>${studentCompany}</td>
                    <td><span class="status ${statusClass}">${status}</span></td>
                    <td class="actions">
                        <button class="action-btn view-btn"><i class="fa-solid fa-eye"></i></button>
                        <button class="action-btn edit-btn"><i class="fa-solid fa-pen"></i></button>
                    </td>
                `;

                tableBody.appendChild(row);
            }
        });

        if (matchedCount === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 25px; color: #888;">
                        No interns found currently deployed at <strong>${selectedCompany || 'this company'}</strong>.
                    </td>
                </tr>
            `;
        }
    });
}

/* ==========================================
   SEARCH, SORT & STATUS FILTER LOGIC
========================================== */
function initTableFilters() {
    const searchInput = document.getElementById("searchStudent");
    const statusFilter = document.getElementById("statusFilter");
    const sortSelect = document.getElementById("sortSelect");
    const table = document.getElementById("studentTable");

    if (searchInput && table) {
        searchInput.addEventListener("keyup", function () {
            let value = this.value.toLowerCase();
            let rows = table.querySelectorAll("tr");
            rows.forEach(row => {
                let text = row.textContent.toLowerCase();
                row.style.display = text.includes(value) ? "" : "none";
            });
        });
    }

    if (statusFilter && table) {
        statusFilter.addEventListener("change", function () {
            let selected = this.value.toLowerCase();
            let rows = table.querySelectorAll("tr");

            rows.forEach(row => {
                let statusEl = row.querySelector(".status");
                if (!statusEl) return;
                let currentStatus = statusEl.textContent.trim().toLowerCase();
                if (selected === "all status" || currentStatus === selected) {
                    row.style.display = "";
                } else {
                    row.style.display = "none";
                }
            });
        });
    }

    if (sortSelect && table) {
        sortSelect.addEventListener("change", function () {
            let value = this.value;
            let rows = Array.from(table.querySelectorAll("tr"));

            rows.sort((a, b) => {
                let nameA = a.children[2] ? a.children[2].textContent.toLowerCase() : "";
                let nameB = b.children[2] ? b.children[2].textContent.toLowerCase() : "";
                let idA = a.children[1] ? a.children[1].textContent : "";
                let idB = b.children[1] ? b.children[1].textContent : "";

                if (value === "Name (A-Z)") return nameA.localeCompare(nameB);
                if (value === "Name (Z-A)") return nameB.localeCompare(nameA);
                if (value === "Student ID") return idA.localeCompare(idB);
                return 0;
            });

            rows.forEach(row => table.appendChild(row));
        });
    }
}