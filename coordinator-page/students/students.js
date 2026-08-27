// ==========================================
// 1. FIREBASE IMPORTS (v10 Modular SDK)
// ==========================================
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
    collection, 
    addDoc, 
    onSnapshot,
    query,
    where,
    orderBy,
    updateDoc,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ==========================================
// 2. EMAILJS INITIALIZATION
// ==========================================
const EMAILJS_PUBLIC_KEY = "OfIuebbqczYbDAnFP"; 
const EMAILJS_SERVICE_ID = "service_sx7my0a"; 
const EMAILJS_TEMPLATE_ID = "template_abcn74d"; 

(function() {
    if (window.emailjs) {
        emailjs.init(EMAILJS_PUBLIC_KEY);
    }
})();

// ==========================================
// 3. FIREBASE CONFIGURATION
// ==========================================
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

// GLOBAL STATE FOR DATA & PAGINATION
let allStudents = [];
let filteredStudents = [];
let currentPage = 1;
let rowsPerPage = 8;

// Helper function para kumuha ng initials ng pangalan
function getInitials(fullName) {
    if (!fullName) return "ST";
    const nameParts = fullName.trim().split(" ").filter(part => part.length > 0);
    if (nameParts.length === 1) return nameParts[0].charAt(0).toUpperCase();
    return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase();
}

// ==========================================
// 4. MAIN APP LOGIC
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadUserData(user);
            listenToStudentData(); 
        } else {
            window.location.href = "../login/login.html";
        }
    });

    initDropdownAndLogout();
    initStudentTableFilters();
    initPaginationControls();
    initInviteModal();
    initEditModal();
});

/* ==========================================
   FETCH LOGGED-IN COORDINATOR PROFILE DATA
========================================== */
async function loadUserData(user) {
    try {
        let fullName = user.displayName || localStorage.getItem("user_fullname") || "";
        let role = "OJT Coordinator";

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.firstName && userData.lastName) {
                fullName = `${userData.firstName} ${userData.middleName ? userData.middleName + ' ' : ''}${userData.lastName}`.trim();
            } else if (userData.fullName || userData.name) {
                fullName = userData.fullName || userData.name;
            }
            if (userData.role) role = userData.role;
        }

        if (!fullName) fullName = "Mark Daniel Beato";

        const initials = getInitials(fullName);
        const avatarCircle = document.getElementById("userAvatar");
        if (avatarCircle) avatarCircle.textContent = initials;

        const userNameEl = document.getElementById("userName");
        if (userNameEl) userNameEl.textContent = fullName;

        const userRoleEl = document.getElementById("userRole");
        if (userRoleEl) userRoleEl.textContent = role;

    } catch (error) {
        console.error("Error fetching coordinator profile:", error);
    }
}

/* ==========================================
   REAL-TIME LISTENER & DATA MERGING
========================================== */
function listenToStudentData() {
    const usersRef = collection(db, "users");
    const usersQuery = query(usersRef, where("role", "==", "student"));

    const invitesRef = collection(db, "invitations");
    const invitesQuery = query(invitesRef, orderBy("createdAt", "desc"));

    // Listener sa pagbabago ng alinman sa dalawang collection
    onSnapshot(usersQuery, async () => {
        await refreshAndRenderStudents();
    });

    onSnapshot(invitesQuery, async () => {
        await refreshAndRenderStudents();
    });
}

async function refreshAndRenderStudents() {
    try {
        const usersRef = collection(db, "users");
        const usersQuery = query(usersRef, where("role", "==", "student"));
        const usersSnapshot = await getDocs(usersQuery);

        const invitesRef = collection(db, "invitations");
        const invitesQuery = query(invitesRef, orderBy("createdAt", "desc"));
        const invitesSnapshot = await getDocs(invitesQuery);

        const studentMap = new Map();

        // 1. Unang kuhanin ang Invitations (Pending)
        invitesSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const emailKey = (data.email || "").toLowerCase().trim();
            if (!emailKey) return;

            const rawName = emailKey.split("@")[0].replace(".", " ");
            const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

            studentMap.set(emailKey, {
                photo: null,
                studentId: "-",
                name: displayName,
                email: data.email,
                course: data.course || "-",
                section: data.section || "-",
                company: data.company || "Pending Assignment",
                status: data.status || "Pending"
            });
        });

        // 2. I-overwrite gamit ang Users collection data
        usersSnapshot.forEach((docSnap) => {
            const userData = docSnap.data();
            const emailKey = (userData.email || "").toLowerCase().trim();
            if (!emailKey) return;

            const existingData = studentMap.get(emailKey) || {};

            const isComplete = userData.isProfileComplete === true || userData.profileCompleted === true;
            const status = isComplete ? "Active" : (userData.status || existingData.status || "Pending");

            const fullName = userData.fullName || userData.name || 
                (userData.firstName ? `${userData.firstName} ${userData.lastName}` : existingData.name || "Student Intern");
            
            const rawStudentNumber = userData.studentNumber || userData.studentId || existingData.studentId;
            const studentNumber = (status === "Active" && rawStudentNumber) ? rawStudentNumber : "-";

            const courseCode = userData.course || existingData.course || "BSIT";
            const studentSection = userData.section || existingData.section || "N/A";
            const company = userData.companyName || userData.company || existingData.company || "Pending Assignment";
            const profilePic = userData.photo || userData.profilePic || userData.photoURL || userData.image || userData.avatar || existingData.photo;

            studentMap.set(emailKey, {
                photo: profilePic,
                studentId: studentNumber,
                name: fullName,
                email: userData.email || existingData.email,
                course: courseCode,
                section: studentSection,
                company: company,
                status: status
            });
        });

        // I-set sa global array at i-render
        allStudents = Array.from(studentMap.values());
        applyFiltersAndPagination();

    } catch (error) {
        console.error("Error refreshing students list:", error);
    }
}

/* ==========================================
   PAGINATION & TABLE RENDER LOGIC
========================================== */
function applyFiltersAndPagination() {
    const searchVal = (document.getElementById("searchStudent")?.value || "").toLowerCase();
    const statusVal = (document.getElementById("statusFilter")?.value || "All Status").toLowerCase();
    const sortVal = document.getElementById("sortSelect")?.value || "Sort By";

    // Filter Logic
    filteredStudents = allStudents.filter(student => {
        const matchesSearch = student.name.toLowerCase().includes(searchVal) ||
                              student.email.toLowerCase().includes(searchVal) ||
                              student.studentId.toLowerCase().includes(searchVal);
        
        const matchesStatus = (statusVal === "all status") || (student.status.toLowerCase() === statusVal);
        
        return matchesSearch && matchesStatus;
    });

    // Sort Logic
    if (sortVal === "Name (A-Z)") {
        filteredStudents.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortVal === "Name (Z-A)") {
        filteredStudents.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortVal === "Student ID") {
        filteredStudents.sort((a, b) => a.studentId.localeCompare(b.studentId));
    }

    renderTablePage();
}

function renderTablePage() {
    const tableBody = document.getElementById("studentTable");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    // Dito direktang kinokontrol ng JS ang height ng table container para WALANG BAKANTE pababa
    const tableContainer = tableBody.closest('.table-container') || tableBody.closest('.card') || tableBody.parentElement;
    if (tableContainer) {
        tableContainer.style.height = "auto";
        tableContainer.style.minHeight = "0px";
        tableContainer.style.display = "block";
    }

    if (filteredStudents.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 25px; color: #888;">
                    No student intern records found.
                </td>
            </tr>
        `;
        updatePaginationUI(0, 0, 0);
        return;
    }

    const totalRecords = filteredStudents.length;
    const totalPages = Math.ceil(totalRecords / rowsPerPage);

    if (currentPage > totalPages) currentPage = totalPages || 1;

    // Slice para makuha lang ang eksaktong 6 rows
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalRecords);
    const paginatedItems = filteredStudents.slice(startIndex, endIndex);

    paginatedItems.forEach((student) => {
        const row = document.createElement("tr");
        const statusClass = student.status.toLowerCase();
        const initials = getInitials(student.name);

        let photoMarkup = "";
        if (student.photo && student.photo.trim() !== "") {
            photoMarkup = `
                <div class="photo-wrapper">
                    <img src="${student.photo}" class="student-photo" alt="Student Profile" 
                         onload="this.nextElementSibling.style.display='none';"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="student-avatar-fallback" style="display:none;">${initials}</div>
                </div>
            `;
        } else {
            photoMarkup = `<div class="student-avatar-fallback">${initials}</div>`;
        }

        row.innerHTML = `
            <td>${photoMarkup}</td>
            <td>${student.studentId}</td>
            <td>
                <strong>${student.name}</strong><br>
                <small style="color:#777;">${student.email}</small>
            </td>
            <td>${student.course}</td>
            <td>${student.section}</td>
            <td>${student.company}</td>
            <td><span class="status ${statusClass}">${student.status}</span></td>
            <td class="actions">
                <button class="action-btn view-btn"><i class="fa-solid fa-eye"></i></button>
                <button class="action-btn archive-btn"><i class="fa-solid fa-box-archive"></i></button>
            </td>
        `;

        tableBody.appendChild(row);
    });

    attachActionEvents();
    updatePaginationUI(startIndex + 1, endIndex, totalRecords);
}

function updatePaginationUI(start, end, total) {
    const info = document.getElementById("paginationInfo");
    if (info) {
        info.textContent = total > 0 ? `Showing ${start} to ${end} of ${total} records` : "Showing 0 records";
    }

    const totalPages = Math.ceil(total / rowsPerPage);
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
    const pageNumbers = document.getElementById("pageNumbers");

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages || totalPages === 0;

    if (pageNumbers) {
        pageNumbers.innerHTML = "";
        for (let i = 1; i <= totalPages; i++) {
            const btn = document.createElement("button");
            btn.className = `page-num ${i === currentPage ? 'active' : ''}`;
            btn.textContent = i;
            btn.addEventListener("click", () => {
                currentPage = i;
                renderTablePage();
            });
            pageNumbers.appendChild(btn);
        }
    }
}

function initPaginationControls() {
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
    const rowsSelect = document.getElementById("rowsPerPageSelect");

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (currentPage > 1) {
                currentPage--;
                renderTablePage();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            const totalPages = Math.ceil(filteredStudents.length / rowsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                renderTablePage();
            }
        });
    }

    if (rowsSelect) {
        rowsSelect.addEventListener("change", (e) => {
            rowsPerPage = parseInt(e.target.value, 10);
            currentPage = 1;
            renderTablePage();
        });
    }
}

/* ==========================================
   LOGOUT & FILTERS
========================================== */
function initDropdownAndLogout() {
    document.addEventListener("click", async (e) => {
        const logoutBtn = e.target.closest("#logoutBtn");
        if (logoutBtn) {
            e.preventDefault();
            try {
                await signOut(auth);
                localStorage.clear();
                window.location.href = "../login/login.html";
            } catch (err) {
                console.error("Logout error:", err);
            }
        }
    });
}

function initStudentTableFilters() {
    const searchInput = document.getElementById("searchStudent");
    const statusFilter = document.getElementById("statusFilter");
    const sortSelect = document.getElementById("sortSelect");

    const triggerFilter = () => {
        currentPage = 1;
        applyFiltersAndPagination();
    };

    if (searchInput) searchInput.addEventListener("keyup", triggerFilter);
    if (statusFilter) statusFilter.addEventListener("change", triggerFilter);
    if (sortSelect) sortSelect.addEventListener("change", triggerFilter);
}

/* ==========================================
   ATTACH ACTION EVENTS (VIEW, EDIT, ARCHIVE)
========================================== */
function attachActionEvents() {
    const tableBody = document.getElementById("studentTable");
    if (!tableBody) return;

    tableBody.onclick = (e) => {
        const btn = e.target.closest("button.action-btn");
        if (!btn) return;

        const row = btn.closest("tr");
        if (!row) return;

        // 1. VIEW BUTTON CLICK
        if (btn.classList.contains("view-btn")) {
            e.stopPropagation();

            const photoImg = row.children[0].querySelector("img");
            const studentId = row.children[1].textContent.trim();
            const nameContainer = row.children[2];
            const studentName = nameContainer.querySelector("strong") ? nameContainer.querySelector("strong").innerText : "";
            const studentEmail = nameContainer.querySelector("small") ? nameContainer.querySelector("small").innerText : "";
            
            const course = row.children[3].textContent.trim();
            const section = row.children[4].textContent.trim();
            const company = row.children[5].textContent.trim();
            const status = row.children[6].textContent.trim();

            const fullCourseSection = `${course} ${section !== '-' ? section : ''}`.trim();

            // Populate View Profile Modal Elements
            const nameEl = document.getElementById("viewStudentName");
            const emailEl = document.getElementById("viewStudentEmail");
            const idEl = document.getElementById("viewStudentId");
            const courseDetailEl = document.getElementById("viewStudentCourseDetail");
            const companyEl = document.getElementById("viewStudentCompany");

            if (nameEl) nameEl.textContent = studentName;
            if (emailEl) emailEl.textContent = studentEmail;
            if (idEl) idEl.textContent = studentId;
            if (courseDetailEl) courseDetailEl.textContent = fullCourseSection;
            if (companyEl) companyEl.textContent = company;
            
            const elStatus = document.getElementById("viewStudentStatus");
            if (elStatus) {
                elStatus.textContent = status;
                elStatus.className = `status-pill ${status.toLowerCase()}`;
            }

            // Avatar / Profile Picture Handle
            const avatarBox = document.getElementById("viewStudentAvatar");
            if (avatarBox) {
                if (photoImg && photoImg.src && photoImg.style.display !== "none") {
                    avatarBox.innerHTML = `<img src="${photoImg.src}" alt="${studentName}">`;
                } else {
                    avatarBox.textContent = getInitials(studentName);
                }
            }

            // Show View Modal
            const viewModal = document.getElementById("viewStudentModal");
            if (viewModal) viewModal.classList.add("active");
            return;
        }

        // 2. ARCHIVE BUTTON CLICK
        if (btn.classList.contains("archive-btn")) {
            e.stopPropagation();
            let name = row.children[2].querySelector("strong") ? row.children[2].querySelector("strong").innerText : "student";
            if (confirm("Are you sure you want to remove/archive " + name + "?")) {
                row.remove();
            }
            return;
        }
    };

    initViewModalCloseListeners();
}

function initEditModal() {
    const editModal = document.getElementById("editModal");
    const closeEditModal = document.getElementById("closeEditModal");
    const cancelEditModal = document.getElementById("cancelEditModal");

    const hideModal = () => {
        if (editModal) editModal.classList.remove("active");
    };

    if (closeEditModal) closeEditModal.onclick = hideModal;
    if (cancelEditModal) cancelEditModal.onclick = hideModal;
    if (editModal) {
        editModal.onclick = (e) => {
            if (e.target === editModal) hideModal();
        };
    }
}

function initViewModalCloseListeners() {
    const viewModal = document.getElementById("viewStudentModal");
    const closeViewModal = document.getElementById("closeViewModal");
    const cancelViewModal = document.getElementById("cancelViewModal");

    const hideViewModal = () => {
        if (viewModal) viewModal.classList.remove("active");
    };

    if (closeViewModal) closeViewModal.onclick = hideViewModal;
    if (cancelViewModal) cancelViewModal.onclick = hideViewModal;
    
    if (viewModal) {
        viewModal.onclick = (e) => {
            if (e.target === viewModal) hideViewModal();
        };
    }
}

/* ==========================================
   INVITE MODAL LOGIC
========================================== */
function initInviteModal() {
    const addBtn = document.getElementById("addStudentBtn");
    const inviteModal = document.getElementById("inviteModal");
    const closeModal = document.getElementById("closeModal");
    const cancelModal = document.getElementById("cancelModal");
    const inviteForm = document.getElementById("inviteForm");
    const successMessage = document.getElementById("successMessage");
    const sentEmailText = document.getElementById("sentEmailText");

    if (addBtn && inviteModal) {
        addBtn.addEventListener("click", () => {
            inviteModal.classList.add("active");
            if (successMessage) successMessage.classList.remove("active");
        });
    }

    const hideModal = () => {
        if (inviteModal) {
            inviteModal.classList.remove("active");
            if (inviteForm) inviteForm.reset();
            if (successMessage) successMessage.classList.remove("active");
        }
    };

    if (closeModal) closeModal.addEventListener("click", hideModal);
    if (cancelModal) cancelModal.addEventListener("click", hideModal);

    if (inviteModal) {
        inviteModal.addEventListener("click", (e) => {
            if (e.target === inviteModal) hideModal();
        });
    }

    if (inviteForm) {
        inviteForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const emailInput = document.getElementById("studentEmail").value.trim();
            if (!emailInput) return;

            const loginUrl = `${window.location.origin}/student-page/student_login/student_login.html?email=${encodeURIComponent(emailInput)}`;

            try {
                await addDoc(collection(db, "invitations"), {
                    email: emailInput,
                    status: "Pending",
                    role: "student",
                    createdAt: new Date().toISOString()
                });

                if (window.emailjs) {
                    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
                        to_email: emailInput,
                        invite_link: loginUrl
                    });
                }

                if (sentEmailText) sentEmailText.textContent = emailInput;
                if (successMessage) successMessage.classList.add("active");

                setTimeout(() => {
                    hideModal();
                }, 2000);

            } catch (error) {
                console.error("Error inviting student:", error);
                alert("Failed to send invite: " + error.message);
            }
        });
    }
}

// Ilagay ito sa pinakailalim ng students.js

window.openEditModalFromProfile = function() {
    // 1. Isara muna ang View Profile Modal
    const viewModal = document.getElementById("viewStudentModal");
    if (viewModal) viewModal.classList.remove("active");

    // 2. Kuhanin ang data mula sa View Profile Modal elements
    const studentEmail = document.getElementById("viewStudentEmail")?.textContent.trim() || "";
    const studentName = document.getElementById("viewStudentName")?.textContent.trim() || "";
    const studentId = document.getElementById("viewStudentId")?.textContent.trim() || "";
    const courseSectionText = document.getElementById("viewStudentCourseDetail")?.textContent.trim() || "";
    const company = document.getElementById("viewStudentCompany")?.textContent.trim() || "";
    const status = document.getElementById("viewStudentStatus")?.textContent.trim() || "Pending";

    // Hatiin ang Course at Section
    const parts = courseSectionText.split(" ");
    const course = parts[0] && parts[0] !== "-" ? parts[0] : "";
    const section = parts.slice(1).join(" ") || "";

    // 3. I-populate ang inputs sa Edit Student Modal
    if (document.getElementById("editStudentEmail")) document.getElementById("editStudentEmail").value = studentEmail;
    if (document.getElementById("editStudentId")) document.getElementById("editStudentId").value = (studentId === "-") ? "" : studentId;
    if (document.getElementById("editStudentName")) document.getElementById("editStudentName").value = studentName;
    if (document.getElementById("editStudentCourse")) document.getElementById("editStudentCourse").value = course;
    if (document.getElementById("editStudentSection")) document.getElementById("editStudentSection").value = (section === "-") ? "" : section;
    if (document.getElementById("editStudentCompany")) document.getElementById("editStudentCompany").value = (company === "Pending Assignment") ? "" : company;
    
    // Set Status Dropdown value
    const editStatusSelect = document.getElementById("editStudentStatus");
    if (editStatusSelect) {
        const matchingOption = Array.from(editStatusSelect.options).find(
            opt => opt.value.toLowerCase() === status.toLowerCase()
        );
        if (matchingOption) {
            editStatusSelect.value = matchingOption.value;
        }
    }

    // 4. Buksan ang Edit Modal
    const editModal = document.getElementById("editModal");
    if (editModal) editModal.classList.add("active");
};

window.viewFullAccountDetails = function() {
    const studentEmail = document.getElementById("viewStudentEmail")?.textContent.trim() || "";
    const studentName = document.getElementById("viewStudentName")?.textContent.trim() || "";
    const studentId = document.getElementById("viewStudentId")?.textContent.trim() || "";

    if (!studentEmail || studentEmail === "-") {
        alert("Walang valid na email account ang estudyanteng ito.");
        return;
    }
    
    const targetUrl = `attendance_details.html?email=${encodeURIComponent(studentEmail)}&name=${encodeURIComponent(studentName)}&id=${encodeURIComponent(studentId)}`;
    window.location.href = targetUrl;
};