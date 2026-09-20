// ==========================================
// 1. FIREBASE IMPORTS (v10 Modular SDK)
// ==========================================
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
    addDoc, 
    onSnapshot,
    query,
    where,
    orderBy,
    limit,
    updateDoc,
    getDocs,
    deleteDoc
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

// Reuse the app kung na-initialize na ng shared ../header/header.js
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// GLOBAL STATE FOR DATA & PAGINATION
let allStudents = [];
let filteredStudents = [];
let currentPage = 1;
let rowsPerPage = 6;
let studentToDelete = null;

// ==========================================
// TOAST NOTIFICATION (pumapalit sa alert())
// ==========================================
function showToast(message, type = "success", duration = 3000) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const icons = {
        success: "fa-solid fa-circle-check",
        error: "fa-solid fa-circle-exclamation",
        info: "fa-solid fa-circle-info"
    };

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="${icons[type] || icons.success}"></i><span>${message}</span>`;

    container.appendChild(toast);

    // Trigger ang fade/slide in
    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    setTimeout(() => {
        toast.classList.remove("show");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, duration);
}

// Helper function para kumuha ng initials ng pangalan
function getInitials(fullName) {
    if (!fullName) return "ST";
    const nameParts = fullName.trim().split(" ").filter(part => part.length > 0);
    if (nameParts.length === 1) return nameParts[0].charAt(0).toUpperCase();
    return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase();
}

// Helper function para i-convert ang 24-hour time papuntang 12-hour format na may AM/PM
function formatTime12Hour(timeStr) {
    if (!timeStr) return timeStr;
    const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return timeStr;

    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = hours >= 12 ? "PM" : "AM";

    hours = hours % 12;
    if (hours === 0) hours = 12;

    return `${hours}:${minutes} ${period}`;
}

// ==========================================
// 4. MAIN APP LOGIC
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    // (Profile menu, notification bell, at logout ay hawak na ng
    // shared header - see ../header/header.js. Ito rin ang nagre-
    // redirect papuntang login kapag walang naka-login.)
    onAuthStateChanged(auth, (user) => {
        if (user) {
            listenToStudentData();
        }
    });

    // Each init runs in its own try/catch so that if one of
    // them throws, it doesn't stop the rest from wiring up.
    safeInit(initStudentTableFilters, "initStudentTableFilters");
    safeInit(initPaginationControls, "initPaginationControls");
    safeInit(initInviteModal, "initInviteModal");
    safeInit(initEditModal, "initEditModal");
    safeInit(initDeleteModalListeners, "initDeleteModalListeners");
    safeInit(initExportCsv, "initExportCsv");
});

function safeInit(fn, label) {
    try {
        fn();
    } catch (error) {
        console.error(`Error running ${label}:`, error);
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

        invitesSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const emailKey = (data.email || "").toLowerCase().trim();
            if (!emailKey) return;

            studentMap.set(emailKey, {
                photo: null,
                studentId: "-",
                name: "",
                email: data.email,
                section: "",
                company: data.company || "Pending Assignment",
                status: data.status || "Pending",
                profileDone: false,
                gender: "",
                schedule: null
            });
        });

        usersSnapshot.forEach((docSnap) => {
            const userData = docSnap.data();
            const emailKey = (userData.email || "").toLowerCase().trim();
            if (!emailKey) return;

            const existingData = studentMap.get(emailKey) || {};

            const isProfileDone = userData.isProfileComplete === true || userData.profileCompleted === true;

            const rawStudentNumber = userData.studentNumber || userData.studentId || existingData.studentId;

            const userCourse = userData.course || "";
            const userSection = userData.section || "";
            let combinedSection = "";

            if (isProfileDone && userSection) {
                combinedSection = userSection.toLowerCase().startsWith(userCourse.toLowerCase())
                    ? userSection
                    : `${userCourse} ${userSection}`.trim();
            }

            const rawCompany = userData.companyName || userData.company || existingData.company;
            const hasCompany = !!rawCompany;
            const company = rawCompany || "Pending Assignment";

            // Fully "Active" lang kapag: (1) tapos na sa profile setup steps,
            // (2) may student number na, at (3) may assigned company na.
            // "Completed" is a manual, final status coordinators set themselves,
            // so once that's saved, keep it as-is regardless of the checks above.
            const isMarkedCompleted = (userData.status || "").toLowerCase() === "completed";
            const isFullyActive = isProfileDone && !!rawStudentNumber && hasCompany;

            const status = isMarkedCompleted
                ? "Completed"
                : (isFullyActive ? "Active" : "Pending");

            // Hanggat hindi pa tapos ang profile setup ng student, itago muna ang
            // photo, student ID, name, course, at section sa table (blangko lang).
            const fullName = isProfileDone
                ? (userData.fullName || userData.name ||
                    (userData.firstName ? `${userData.firstName} ${userData.lastName}` : existingData.name || "Student Intern"))
                : "";

            const studentNumber = (isProfileDone && rawStudentNumber) ? rawStudentNumber : "-";
            const profilePic = isProfileDone
                ? (userData.photo || userData.profilePic || userData.photoURL || userData.image || userData.avatar || existingData.photo)
                : null;

            studentMap.set(emailKey, {
                docId: docSnap.id,
                photo: profilePic,
                studentId: studentNumber,
                name: fullName,
                email: userData.email || existingData.email,
                section: combinedSection,
                company: company,
                status: status,
                profileDone: isProfileDone,
                gender: normalizeGender(userData.gender || userData.sex || existingData.gender),
                schedule: userData.schedule || null
            });
        });

        allStudents = Array.from(studentMap.values());
        populateYearFilter();
        applyFiltersAndPagination();

    } catch (error) {
        console.error("Error refreshing students list:", error);
    }
}

/* ==========================================
   GENDER (profile)
   Kinukuha sa "gender" field ng user sa Firestore
   (o "sex" bilang fallback).
========================================== */
function normalizeGender(value) {
    const v = String(value || "").trim();
    if (!v) return "";

    const lower = v.toLowerCase();
    if (lower === "m" || lower === "male") return "Male";
    if (lower === "f" || lower === "female") return "Female";

    return v.charAt(0).toUpperCase() + v.slice(1);
}

// Ipinapakita sa kanan ng profile header card
function setViewStudentGender(gender) {
    const textEl = document.getElementById("viewStudentGender");
    const iconEl = document.getElementById("viewStudentGenderIcon");
    if (!textEl) return;

    const value = normalizeGender(gender);
    textEl.textContent = value || "Not specified";

    if (iconEl) {
        const lower = value.toLowerCase();
        const iconClass = lower === "male"
            ? "fa-mars"
            : (lower === "female" ? "fa-venus" : "fa-venus-mars");
        iconEl.className = `fa-solid ${iconClass}`;
    }
}

// Pino-populate ang gender select sa Edit modal
function setEditStudentGender(gender) {
    const select = document.getElementById("editStudentGender");
    if (!select) return;

    const value = normalizeGender(gender);

    // Kung may ibang value na wala sa listahan, idagdag para hindi mawala.
    if (value && !Array.from(select.options).some(opt => opt.value === value)) {
        const extra = document.createElement("option");
        extra.value = value;
        extra.textContent = value;
        select.appendChild(extra);
    }

    select.value = value;
}

/* ==========================================
   YEAR FILTER (base sa Student Number)
   Sinusuportahan ang mga format tulad ng:
   "2023001", "2023-0001", "23-0001"
========================================== */
function getStudentYear(studentNumber) {
    const s = String(studentNumber || "").trim();
    if (!s || s === "-") return "";

    // 4-digit na taon sa unahan (hal. 2023001 / 2023-0001)
    const full = s.match(/^((?:19|20)\d{2})/);
    if (full) return full[1];

    // 2-digit na taon sa unahan na may separator (hal. 23-0001)
    const short = s.match(/^(\d{2})\D/);
    if (short) return String(2000 + parseInt(short[1], 10));

    return "";
}

// Binubuo ang listahan ng years mula sa mga student (pinakabago muna)
// at pinapanatili ang kasalukuyang napili kung nandoon pa rin.
function populateYearFilter() {
    const yearSelect = document.getElementById("yearFilter");
    if (!yearSelect) return;

    const previous = yearSelect.value || "All Years";

    const years = Array.from(
        new Set(
            allStudents
                .map(student => getStudentYear(student.studentId))
                .filter(Boolean)
        )
    ).sort((a, b) => b.localeCompare(a));

    yearSelect.innerHTML = `<option value="All Years">All Years</option>` +
        years.map(year => `<option value="${year}">${year}</option>`).join("");

    yearSelect.value = years.includes(previous) ? previous : "All Years";
}

/* ==========================================
   PAGINATION & TABLE RENDER LOGIC
========================================== */
function applyFiltersAndPagination() {
    const searchVal = (document.getElementById("searchStudent")?.value || "").toLowerCase();
    const statusVal = (document.getElementById("statusFilter")?.value || "All Status").toLowerCase();
    const sortVal = document.getElementById("sortSelect")?.value || "Sort By";
    const yearVal = document.getElementById("yearFilter")?.value || "All Years";

    filteredStudents = allStudents.filter(student => {
        const matchesSearch = student.name.toLowerCase().includes(searchVal) ||
                              student.email.toLowerCase().includes(searchVal) ||
                              student.studentId.toLowerCase().includes(searchVal) ||
                              student.section.toLowerCase().includes(searchVal);
        
        const matchesStatus = (statusVal === "all status") || (student.status.toLowerCase() === statusVal);
        
        // Year filter: base sa taon na nasa student number
        const matchesYear = (yearVal === "All Years") || (getStudentYear(student.studentId) === yearVal);

        return matchesSearch && matchesStatus && matchesYear;
    });

    if (sortVal === "Name (A-Z)") {
        filteredStudents.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortVal === "Name (Z-A)") {
        filteredStudents.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortVal === "Student ID") {
        filteredStudents.sort((a, b) => a.studentId.localeCompare(b.studentId));
    }

    renderTablePage();
}

// Hinihiwalay ang Course (e.g. "BSIT") at Section number (e.g. "403") mula sa isang string tulad ng "BSIT 403"
function splitCourseSection(sectionStr) {
    const str = (sectionStr || "").trim();
    if (!str) return { course: "-", section: "-" };

    const match = str.match(/^([A-Za-z]+)\s*(.*)$/);
    if (match) {
        const course = match[1] || "-";
        const section = match[2] ? match[2].trim() : "-";
        return { course, section: section || "-" };
    }
    return { course: str, section: "-" };
}

/* ==========================================
   EXPORT STUDENT LIST TO CSV
========================================== */
function escapeCSVValue(value) {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function exportStudentsToCSV() {
    if (!filteredStudents || filteredStudents.length === 0) {
        showToast("No student records to export.", "error");
        return;
    }

    const headers = ["Student ID", "Name", "Email", "Course", "Section", "Company", "Status"];

    const rows = filteredStudents.map((student) => {
        const { course, section } = splitCourseSection(student.section);
        const displayName = student.profileDone ? student.name : "-";

        return [
            student.studentId,
            displayName,
            student.email || "-",
            course,
            section,
            student.company,
            student.status
        ].map(escapeCSVValue).join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\r\n");

    // Prepend BOM so Excel reads UTF-8 special characters correctly
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().slice(0, 10);

    const link = document.createElement("a");
    link.href = url;
    link.download = `students_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("Student list exported successfully!", "success");
}

function initExportCsv() {
    const exportBtn = document.getElementById("exportCsvBtn");
    if (exportBtn) {
        exportBtn.addEventListener("click", exportStudentsToCSV);
    }
}

function renderTablePage() {
    const tableBody = document.getElementById("studentTable");
    if (!tableBody) return;

    tableBody.innerHTML = "";

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

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalRecords);
    const paginatedItems = filteredStudents.slice(startIndex, endIndex);

    paginatedItems.forEach((student) => {
        const row = document.createElement("tr");
        const statusClass = student.status.toLowerCase();
        const profileDone = !!student.profileDone;
        const initials = getInitials(student.name);

        let photoMarkup = "";
        if (!profileDone) {
            photoMarkup = `<div class="student-avatar-fallback"></div>`;
        } else if (student.photo && student.photo.trim() !== "") {
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

        const { course: courseCode, section: sectionNum } = splitCourseSection(student.section);
        const displayName = profileDone ? student.name : "-";

        row.innerHTML = `
            <td>${photoMarkup}</td>
            <td>${student.studentId}</td>
            <td>
                <strong>${displayName}</strong><br>
                <small style="color:#777;">${student.email}</small>
            </td>
            <td>${courseCode}</td>
            <td>${sectionNum}</td>
            <td>${student.company}</td>
            <td><span class="status ${statusClass}">${student.status}</span></td>
            <td class="actions">
                <button class="action-btn view-btn"><i class="fa-solid fa-eye"></i></button>
                <button class="action-btn archive-btn"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;

        tableBody.appendChild(row);
    });

    const emptySlots = rowsPerPage - paginatedItems.length;
    for (let i = 0; i < emptySlots; i++) {
        const emptyRow = document.createElement("tr");
        emptyRow.className = "empty-slot-row";
        emptyRow.innerHTML = `<td colspan="8">&nbsp;</td>`;
        tableBody.appendChild(emptyRow);
    }

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
   FILTERS
========================================== */
function initStudentTableFilters() {
    const searchInput = document.getElementById("searchStudent");
    const statusFilter = document.getElementById("statusFilter");
    const sortSelect = document.getElementById("sortSelect");
    const yearFilter = document.getElementById("yearFilter");

    const triggerFilter = () => {
        currentPage = 1;
        applyFiltersAndPagination();
    };

    if (searchInput) searchInput.addEventListener("keyup", triggerFilter);
    if (statusFilter) statusFilter.addEventListener("change", triggerFilter);
    if (sortSelect) sortSelect.addEventListener("change", triggerFilter);
    if (yearFilter) yearFilter.addEventListener("change", triggerFilter);
}

/* ==========================================
   ATTACH ACTION EVENTS (VIEW, EDIT, DELETE)
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
            
            const courseCode = row.children[3].textContent.trim();
            const sectionNum = row.children[4].textContent.trim();
            const section = [courseCode, sectionNum].filter(v => v && v !== "-").join(" ");
            const company = row.children[5].textContent.trim();
            const status = row.children[6].textContent.trim();

            const nameEl = document.getElementById("viewStudentName");
            const emailEl = document.getElementById("viewStudentEmail");
            const idEl = document.getElementById("viewStudentId");
            const courseDetailEl = document.getElementById("viewStudentCourseDetail");
            const companyEl = document.getElementById("viewStudentCompany");
            const scheduleEl = document.getElementById("viewStudentSchedule");

            if (nameEl) nameEl.textContent = studentName;
            if (emailEl) emailEl.textContent = studentEmail;
            if (idEl) idEl.textContent = studentId;
            if (courseDetailEl) courseDetailEl.textContent = section;
            if (companyEl) companyEl.textContent = company;
            
            const cleanEmail = studentEmail.toLowerCase().trim();
            const currentStudent = allStudents.find(s => s.email && s.email.toLowerCase().trim() === cleanEmail);

            // Gender (nasa kanan ng profile header)
            setViewStudentGender(currentStudent ? currentStudent.gender : "");

            if (scheduleEl) {
                if (currentStudent && currentStudent.schedule) {
                    const sched = currentStudent.schedule;

                    let daysArray = null;
                    if (Array.isArray(sched.days)) {
                        daysArray = sched.days;
                    } else if (sched.days && typeof sched.days === 'object') {
                        daysArray = Object.values(sched.days);
                    }
                    const normalizedDays = (daysArray || []).map(d => String(d).toLowerCase().trim());

                    const weekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                    const dayChipsHtml = weekDays.map(day => {
                        const isActive = normalizedDays.includes(day.toLowerCase()) || normalizedDays.includes(day.slice(0, 3).toLowerCase());
                        return `<span class="day-chip ${isActive ? 'active' : ''}">${day.slice(0, 1)}</span>`;
                    }).join("");

                    let timeBadges = [];

                    const mIn = sched.morning?.timeIn || sched.morning?.time_in || sched.morning?.start;
                    const mOut = sched.morning?.timeOut || sched.morning?.timeout || sched.morning?.time_out || sched.morning?.end;
                    const isMorningActive = sched.morning?.morningEnabled !== false && sched.morning?.enabled !== false;

                    if (mIn && mOut && isMorningActive) {
                        timeBadges.push(`<span class="schedule-badge morning">Morning: ${formatTime12Hour(mIn)} - ${formatTime12Hour(mOut)}</span>`);
                    }

                    const aIn = sched.afternoon?.timeIn || sched.afternoon?.time_in || sched.afternoon?.start;
                    const aOut = sched.afternoon?.timeOut || sched.afternoon?.timeout || sched.afternoon?.time_out || sched.afternoon?.end;
                    const isAfternoonActive = sched.afternoon?.afternoonEnabled !== false && sched.afternoon?.enabled !== false;

                    if (aIn && aOut && isAfternoonActive) {
                        timeBadges.push(`<span class="schedule-badge afternoon"> Afternoon: ${formatTime12Hour(aIn)} - ${formatTime12Hour(aOut)}</span>`);
                    }

                    if (timeBadges.length > 0) {
                        scheduleEl.innerHTML = `
                            <div class="schedule-badges">${timeBadges.join("")}</div>
                            <div class="schedule-days-row">
                                <div class="day-chips">${dayChipsHtml}</div>
                            </div>
                        `;
                    } else {
                        scheduleEl.textContent = sched.shift ? `Shift: ${sched.shift}` : "Schedule format incomplete";
                    }
                } else {
                    scheduleEl.textContent = "No schedule assigned yet";
                }
            }

            const elStatus = document.getElementById("viewStudentStatus");
            if (elStatus) {
                elStatus.textContent = status;
                elStatus.className = `status-pill ${status.toLowerCase()}`;
            }

            const avatarBox = document.getElementById("viewStudentAvatar");
            if (avatarBox) {
                if (photoImg && photoImg.src && photoImg.style.display !== "none") {
                    avatarBox.innerHTML = `<img src="${photoImg.src}" alt="${studentName}">`;
                } else {
                    avatarBox.textContent = getInitials(studentName);
                }
            }

            const viewModal = document.getElementById("viewStudentModal");
            if (viewModal) viewModal.classList.add("active");
            return;
        }

        // 2. ARCHIVE / DELETE BUTTON CLICK
        if (btn.classList.contains("archive-btn")) {
            e.stopPropagation();
            const email = row.children[2].querySelector("small") ? row.children[2].querySelector("small").innerText.trim() : "";
            studentToDelete = { email, row };

            const deleteModal = document.getElementById("deleteConfirmModal");
            if (deleteModal) deleteModal.classList.add("active");
            return;
        }
    };

    initViewModalCloseListeners();
}

/* ==========================================
   DELETE CONFIRMATION MODAL LOGIC
========================================== */
function initDeleteModalListeners() {
    const deleteModal = document.getElementById("deleteConfirmModal");
    const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
    const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

    const closeDeleteModal = () => {
        if (deleteModal) deleteModal.classList.remove("active");
        studentToDelete = null;
    };

    if (cancelDeleteBtn) cancelDeleteBtn.onclick = closeDeleteModal;

    if (deleteModal) {
        deleteModal.onclick = (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        };
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.onclick = async () => {
            if (!studentToDelete) return;
            const { email, row } = studentToDelete;

            try {
                const userSnapshot = await getDocs(query(collection(db, "users"), where("email", "==", email)));
                userSnapshot.forEach(async (documentSnap) => {
                    await deleteDoc(doc(db, "users", documentSnap.id));
                });

                const inviteSnapshot = await getDocs(query(collection(db, "invitations"), where("email", "==", email)));
                inviteSnapshot.forEach(async (documentSnap) => {
                    await deleteDoc(doc(db, "invitations", documentSnap.id));
                });

                if (row) row.remove();
                closeDeleteModal();
            } catch (error) {
                console.error("Error sa pag-delete ng student:", error);
            }
        };
    }
}

/* ==========================================
   EDIT MODAL LOGIC & SUBMISSION
========================================== */
// Nag-uupdate ng visual state (label at disabled state) ng Morning toggle
function updateMorningToggleUI() {
    const checkbox = document.getElementById("editMorningEnabled");
    const statusText = document.getElementById("morningToggleStatusText");
    const morningCard = document.getElementById("morningTimeCard");
    if (!checkbox) return;

    const isEnabled = checkbox.checked;

    if (statusText) {
        statusText.textContent = isEnabled ? "Enabled" : "Disabled";
        statusText.classList.toggle("enabled", isEnabled);
        statusText.classList.toggle("disabled", !isEnabled);
    }

    if (morningCard) {
        morningCard.classList.toggle("schedule-disabled", !isEnabled);
    }
}

// Nag-uupdate ng visual state (label at disabled state) ng Afternoon toggle
function updateAfternoonToggleUI() {
    const checkbox = document.getElementById("editAfternoonEnabled");
    const statusText = document.getElementById("afternoonToggleStatusText");
    const afternoonCard = document.getElementById("afternoonTimeCard");
    if (!checkbox) return;

    const isEnabled = checkbox.checked;

    if (statusText) {
        statusText.textContent = isEnabled ? "Enabled" : "Disabled";
        statusText.classList.toggle("enabled", isEnabled);
        statusText.classList.toggle("disabled", !isEnabled);
    }

    if (afternoonCard) {
        afternoonCard.classList.toggle("schedule-disabled", !isEnabled);
    }
}

function initEditModal() {
    const editModal = document.getElementById("editModal");
    const closeEditModal = document.getElementById("closeEditModalBtn");
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

    // Morning Session toggle listener
    const morningToggle = document.getElementById("editMorningEnabled");
    if (morningToggle) {
        morningToggle.addEventListener("change", updateMorningToggleUI);
    }

    // Afternoon Session toggle listener
    const afternoonToggle = document.getElementById("editAfternoonEnabled");
    if (afternoonToggle) {
        afternoonToggle.addEventListener("change", updateAfternoonToggleUI);
    }

    const editStudentForm = document.getElementById("editStudentForm");
    if (editStudentForm) {
        editStudentForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const studentEmail = document.getElementById("editStudentEmail").value.trim();
            if (!studentEmail) return;

            const name = document.getElementById("editStudentName").value.trim();
            const studentId = document.getElementById("editStudentId").value.trim();
            const section = document.getElementById("editStudentSection").value.trim();
            const company = document.getElementById("editStudentCompany").value.trim();
            const status = document.getElementById("editStudentStatus").value;
            const gender = document.getElementById("editStudentGender")?.value || "";

            // Kunin ang mga in-input na oras mula sa modal inputs
            const morningIn = document.getElementById("editMorningIn")?.value || "";
            const morningOut = document.getElementById("editMorningOut")?.value || "";
            const morningEnabled = document.getElementById("editMorningEnabled")?.checked ?? true;
            const afternoonIn = document.getElementById("editAfternoonIn")?.value || "";
            const afternoonOut = document.getElementById("editAfternoonOut")?.value || "";
            const afternoonEnabled = document.getElementById("editAfternoonEnabled")?.checked ?? true;

            const selectedDays = [];
            document.querySelectorAll('input[name="editDays"]:checked').forEach(cb => {
                selectedDays.push(cb.value);
            });

            try {
                const usersSnapshot = await getDocs(query(collection(db, "users"), where("email", "==", studentEmail)));
                
                if (!usersSnapshot.empty) {
                    usersSnapshot.forEach(async (documentSnap) => {
                        const userDocRef = doc(db, "users", documentSnap.id);
                        await updateDoc(userDocRef, {
                            fullName: name,
                            studentNumber: studentId,
                            section: section,
                            companyName: company,
                            status: status,
                            gender: gender,
                            "schedule.days": selectedDays,
                            "schedule.morning": {
                                timeIn: morningIn,
                                timeOut: morningOut,
                                morningEnabled: morningEnabled
                            },
                            "schedule.afternoon": {
                                timeIn: afternoonIn,
                                timeOut: afternoonOut,
                                afternoonEnabled: afternoonEnabled
                            },
                            updatedAt: new Date().toISOString()
                        });
                    });
                }

                hideModal();
                await refreshAndRenderStudents();
                showToast("Student profile updated successfully!", "success");
            } catch (error) {
                console.error("Error updating profile:", error);
                showToast("Failed to update student profile.", "error");
            }
        });
    }
}

function initViewModalCloseListeners() {
    const viewModal = document.getElementById("viewStudentModal");
    const closeViewModal = document.getElementById("closeViewModal");

    const hideViewModal = () => {
        if (viewModal) viewModal.classList.remove("active");
    };

    if (closeViewModal) closeViewModal.onclick = hideViewModal;
    
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
            }
        });
    }
}

window.openEditModalFromProfile = function() {
    const viewModal = document.getElementById("viewStudentModal");
    if (viewModal) viewModal.classList.remove("active");

    const studentEmail = document.getElementById("viewStudentEmail")?.textContent.trim() || "";
    const studentName = document.getElementById("viewStudentName")?.textContent.trim() || "";
    const studentId = document.getElementById("viewStudentId")?.textContent.trim() || "";
    const sectionText = document.getElementById("viewStudentCourseDetail")?.textContent.trim() || "";
    const company = document.getElementById("viewStudentCompany")?.textContent.trim() || "";
    const status = document.getElementById("viewStudentStatus")?.textContent.trim() || "Pending";

    if (document.getElementById("editStudentEmail")) document.getElementById("editStudentEmail").value = studentEmail;
    if (document.getElementById("editStudentId")) document.getElementById("editStudentId").value = (studentId === "-") ? "" : studentId;
    if (document.getElementById("editStudentName")) document.getElementById("editStudentName").value = studentName;
    if (document.getElementById("editStudentSection")) document.getElementById("editStudentSection").value = (sectionText === "-") ? "" : sectionText;
    if (document.getElementById("editStudentCompany")) document.getElementById("editStudentCompany").value = (company === "Pending Assignment") ? "" : company;
    
    const editStatusSelect = document.getElementById("editStudentStatus");
    if (editStatusSelect) {
        const matchingOption = Array.from(editStatusSelect.options).find(
            opt => opt.value.toLowerCase() === status.toLowerCase()
        );
        if (matchingOption) editStatusSelect.value = matchingOption.value;
    }

    // Populate schedule details & times mula sa current loaded student state
    const currentStudent = allStudents.find(s => s.email && s.email.toLowerCase().trim() === studentEmail.toLowerCase().trim());
    setEditStudentGender(currentStudent ? currentStudent.gender : "");
    if (currentStudent && currentStudent.schedule) {
        const sched = currentStudent.schedule;

        // Ilagay ang Morning Times
        if (sched.morning) {
            const mIn = sched.morning.timeIn || sched.morning.time_in || sched.morning.start || "";
            const mOut = sched.morning.timeOut || sched.morning.timeout || sched.morning.time_out || sched.morning.end || "";
            if (document.getElementById("editMorningIn")) document.getElementById("editMorningIn").value = mIn;
            if (document.getElementById("editMorningOut")) document.getElementById("editMorningOut").value = mOut;

            const morningEnabled = sched.morning.morningEnabled !== false && sched.morning.enabled !== false;
            const morningToggleCheckbox = document.getElementById("editMorningEnabled");
            if (morningToggleCheckbox) morningToggleCheckbox.checked = morningEnabled;
        } else {
            if (document.getElementById("editMorningIn")) document.getElementById("editMorningIn").value = "";
            if (document.getElementById("editMorningOut")) document.getElementById("editMorningOut").value = "";

            const morningToggleCheckbox = document.getElementById("editMorningEnabled");
            if (morningToggleCheckbox) morningToggleCheckbox.checked = true;
        }
        updateMorningToggleUI();

        // Ilagay ang Afternoon Times
        if (sched.afternoon) {
            const aIn = sched.afternoon.timeIn || sched.afternoon.time_in || sched.afternoon.start || "";
            const aOut = sched.afternoon.timeOut || sched.afternoon.timeout || sched.afternoon.time_out || sched.afternoon.end || "";
            if (document.getElementById("editAfternoonIn")) document.getElementById("editAfternoonIn").value = aIn;
            if (document.getElementById("editAfternoonOut")) document.getElementById("editAfternoonOut").value = aOut;

            const afternoonEnabled = sched.afternoon.afternoonEnabled !== false && sched.afternoon.enabled !== false;
            const toggleCheckbox = document.getElementById("editAfternoonEnabled");
            if (toggleCheckbox) toggleCheckbox.checked = afternoonEnabled;
        } else {
            if (document.getElementById("editAfternoonIn")) document.getElementById("editAfternoonIn").value = "";
            if (document.getElementById("editAfternoonOut")) document.getElementById("editAfternoonOut").value = "";

            const toggleCheckbox = document.getElementById("editAfternoonEnabled");
            if (toggleCheckbox) toggleCheckbox.checked = true;
        }
        updateAfternoonToggleUI();

        let daysArray = [];
        if (Array.isArray(sched.days)) {
            daysArray = sched.days.map(d => String(d).slice(0, 3));
        } else if (sched.days && typeof sched.days === 'object') {
            daysArray = Object.values(sched.days).map(d => String(d).slice(0, 3));
        }

        document.querySelectorAll('input[name="editDays"]').forEach(cb => {
            cb.checked = daysArray.some(d => d.toLowerCase() === cb.value.toLowerCase());
        });
    } else {
        if (document.getElementById("editMorningIn")) document.getElementById("editMorningIn").value = "";
        if (document.getElementById("editMorningOut")) document.getElementById("editMorningOut").value = "";
        if (document.getElementById("editAfternoonIn")) document.getElementById("editAfternoonIn").value = "";
        if (document.getElementById("editAfternoonOut")) document.getElementById("editAfternoonOut").value = "";
        const morningToggleCheckbox = document.getElementById("editMorningEnabled");
        if (morningToggleCheckbox) morningToggleCheckbox.checked = true;
        updateMorningToggleUI();
        const toggleCheckbox = document.getElementById("editAfternoonEnabled");
        if (toggleCheckbox) toggleCheckbox.checked = true;
        updateAfternoonToggleUI();
        document.querySelectorAll('input[name="editDays"]').forEach(cb => cb.checked = false);
    }

    const editModal = document.getElementById("editModal");
    if (editModal) editModal.classList.add("active");
};

window.viewFullAccountDetails = function() {
    const studentEmail = document.getElementById("viewStudentEmail")?.textContent.trim() || "";
    const studentName = document.getElementById("viewStudentName")?.textContent.trim() || "";
    const studentId = document.getElementById("viewStudentId")?.textContent.trim() || "";

    if (!studentEmail || studentEmail === "-") return;
    
    const targetUrl = `/coordinator-page/attendance/attendance_details.html?email=${encodeURIComponent(studentEmail)}&name=${encodeURIComponent(studentName)}&id=${encodeURIComponent(studentId)}&from=students`;
window.location.href = targetUrl;
};