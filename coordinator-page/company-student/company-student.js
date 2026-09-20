// company-student.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    onSnapshot,
    query,
    where,
    doc,
    updateDoc
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

// Reuse the app kung na-initialize na ng shared ../header/header.js
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Kunin ang URL Parameter (Kumpanyang Pinindot)
const urlParams = new URLSearchParams(window.location.search);
const selectedCompany = urlParams.get("company") || "";

// Mga estudyante ng company na ito (docId -> student data).
// Ginagamit ng View / Edit buttons para kunin ang buong detalye.
let companyStudents = new Map();

// Ang estudyanteng kasalukuyang nakabukas sa View/Edit modal
let activeStudent = null;

/* ==========================================
   HELPERS
========================================== */
function getInitials(fullName) {
    if (!fullName) return "ST";
    const nameParts = fullName.trim().split(" ").filter(part => part.length > 0);
    if (nameParts.length === 1) return nameParts[0].charAt(0).toUpperCase();
    return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase();
}

// I-convert ang 24-hour time papuntang 12-hour format na may AM/PM
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

    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    setTimeout(() => {
        toast.classList.remove("show");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, duration);
}

// "N/A" at "-" ay placeholder lang - ituring na blangko
function cleanValue(value) {
    const v = String(value ?? "").trim();
    return (v === "" || v === "N/A" || v === "-") ? "" : v;
}

function normalizeGender(value) {
    const v = String(value || "").trim();
    if (!v) return "";

    const lower = v.toLowerCase();
    if (lower === "m" || lower === "male") return "Male";
    if (lower === "f" || lower === "female") return "Female";

    return v.charAt(0).toUpperCase() + v.slice(1);
}

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

function setEditStudentGender(gender) {
    const select = document.getElementById("editStudentGender");
    if (!select) return;

    const value = normalizeGender(gender);

    if (value && !Array.from(select.options).some(opt => opt.value === value)) {
        const extra = document.createElement("option");
        extra.value = value;
        extra.textContent = value;
        select.appendChild(extra);
    }

    select.value = value;
}

/* ==========================================
   MAIN
========================================== */
document.addEventListener("DOMContentLoaded", () => {
    if (selectedCompany) {
        document.getElementById("companyPageTitle").textContent = `${selectedCompany} Students`;
        document.getElementById("companyPageSubtitle").textContent = `View and manage student interns assigned to ${selectedCompany}.`;
    }

    // Back button
    document.getElementById("backToCompaniesBtn")?.addEventListener("click", () => {
        window.location.href = "../companies/companies.html";
    });

    // (Profile menu, notification bell, at logout ay hawak na ng
    // shared header - see ../header/header.js. Ito rin ang nagre-
    // redirect papuntang login kapag walang naka-login.)
    onAuthStateChanged(auth, (user) => {
        if (user) {
            listenToCompanyStudents();
        }
    });

    initTableFilters();
    initStudentActions();
    initViewModalCloseListeners();
    initEditModal();
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
        companyStudents = new Map();
        let matchedCount = 0;

        snapshot.forEach((docSnap) => {
            const userData = docSnap.data();
            const studentCompany = userData.companyName || userData.company || "";

            if (studentCompany.toLowerCase() === selectedCompany.toLowerCase()) {
                matchedCount++;

                const isComplete = userData.isProfileComplete === true || userData.profileCompleted === true;

                // "Completed" ay manual na status ng coordinator - panatilihin.
                const isMarkedCompleted = (userData.status || "").toLowerCase() === "completed";
                const status = isMarkedCompleted
                    ? "Completed"
                    : (isComplete ? "Active" : (userData.status || "Pending"));

                const fullName = userData.fullName || userData.name || 
                    (userData.firstName ? `${userData.firstName} ${userData.lastName}` : "Student Intern");
                
                const studentNumber = userData.studentNumber || userData.studentId || "N/A";
                const course = userData.course || "BSIT";
                const section = userData.section || "N/A";
                const profilePic = userData.photo || userData.profilePic || userData.photoURL || userData.image || userData.avatar;

                // Isave ang buong detalye para sa View / Edit modal
                companyStudents.set(docSnap.id, {
                    docId: docSnap.id,
                    name: fullName,
                    email: userData.email || "",
                    studentNumber,
                    course,
                    section,
                    company: studentCompany,
                    status,
                    photo: profilePic || "",
                    gender: normalizeGender(userData.gender || userData.sex),
                    schedule: userData.schedule || null
                });

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
                row.dataset.docId = docSnap.id;
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
                        <button type="button" class="action-btn view-btn" title="View profile"><i class="fa-solid fa-eye"></i></button>
                        <button type="button" class="action-btn edit-btn" title="Edit profile"><i class="fa-solid fa-pen"></i></button>
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

/* ==========================================
   VIEW & EDIT BUTTONS (kapareho ng Students page)
========================================== */
function initStudentActions() {
    const tableBody = document.getElementById("studentTable");
    if (!tableBody) return;

    // Event delegation - gumagana kahit paulit-ulit ang re-render ng table.
    tableBody.addEventListener("click", (e) => {
        const btn = e.target.closest("button.action-btn");
        if (!btn) return;

        const row = btn.closest("tr");
        const student = row ? companyStudents.get(row.dataset.docId) : null;
        if (!student) return;

        e.stopPropagation();

        if (btn.classList.contains("view-btn")) {
            openViewModal(student);
        } else if (btn.classList.contains("edit-btn")) {
            activeStudent = student;
            window.openEditModalFromProfile();
        }
    });
}

// Ang "Section" na ipinapakita: course + section (hal. "BSIT 403")
function getCombinedSection(student) {
    const course = cleanValue(student.course);
    const section = cleanValue(student.section);

    if (!section) return course;
    if (!course) return section;

    return section.toLowerCase().startsWith(course.toLowerCase())
        ? section
        : `${course} ${section}`;
}

function openViewModal(student) {
    activeStudent = student;

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText("viewStudentName", student.name);
    setText("viewStudentEmail", student.email || "-");
    setText("viewStudentId", cleanValue(student.studentNumber) || "-");
    setText("viewStudentCourseDetail", getCombinedSection(student) || "-");
    setText("viewStudentCompany", student.company || "Pending Assignment");

    // Gender (nasa kanan ng profile header)
    setViewStudentGender(student.gender);

    // Schedule
    const scheduleEl = document.getElementById("viewStudentSchedule");
    if (scheduleEl) {
        if (student.schedule) {
            const sched = student.schedule;

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

    // Status pill
    const elStatus = document.getElementById("viewStudentStatus");
    if (elStatus) {
        elStatus.textContent = student.status;
        elStatus.className = `status-pill ${student.status.toLowerCase()}`;
    }

    // Avatar (photo o initials)
    const avatarBox = document.getElementById("viewStudentAvatar");
    if (avatarBox) {
        avatarBox.innerHTML = "";
        if (student.photo && student.photo.trim() !== "") {
            const img = document.createElement("img");
            img.alt = student.name;
            img.src = student.photo;
            img.onerror = () => {
                avatarBox.textContent = getInitials(student.name);
            };
            avatarBox.appendChild(img);
        } else {
            avatarBox.textContent = getInitials(student.name);
        }
    }

    document.getElementById("viewStudentModal")?.classList.add("active");
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
   EDIT MODAL (kapareho ng Students page)
========================================== */
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

// Ginagamit ng "Edit Profile" button sa View modal at ng pen button sa table
window.openEditModalFromProfile = function () {
    const student = activeStudent;
    if (!student) return;

    document.getElementById("viewStudentModal")?.classList.remove("active");

    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };

    setValue("editStudentEmail", student.email || "");
    setValue("editStudentId", cleanValue(student.studentNumber));
    setValue("editStudentName", student.name || "");
    setValue("editStudentSection", getCombinedSection(student));
    setValue("editStudentCompany", student.company || "");
    setEditStudentGender(student.gender);

    const editStatusSelect = document.getElementById("editStudentStatus");
    if (editStatusSelect) {
        const matchingOption = Array.from(editStatusSelect.options).find(
            opt => opt.value.toLowerCase() === String(student.status).toLowerCase()
        );
        if (matchingOption) editStatusSelect.value = matchingOption.value;
    }

    // Schedule
    const sched = student.schedule;
    if (sched) {
        if (sched.morning) {
            const mIn = sched.morning.timeIn || sched.morning.time_in || sched.morning.start || "";
            const mOut = sched.morning.timeOut || sched.morning.timeout || sched.morning.time_out || sched.morning.end || "";
            setValue("editMorningIn", mIn);
            setValue("editMorningOut", mOut);

            const morningEnabled = sched.morning.morningEnabled !== false && sched.morning.enabled !== false;
            const morningToggleCheckbox = document.getElementById("editMorningEnabled");
            if (morningToggleCheckbox) morningToggleCheckbox.checked = morningEnabled;
        } else {
            setValue("editMorningIn", "");
            setValue("editMorningOut", "");
            const morningToggleCheckbox = document.getElementById("editMorningEnabled");
            if (morningToggleCheckbox) morningToggleCheckbox.checked = true;
        }
        updateMorningToggleUI();

        if (sched.afternoon) {
            const aIn = sched.afternoon.timeIn || sched.afternoon.time_in || sched.afternoon.start || "";
            const aOut = sched.afternoon.timeOut || sched.afternoon.timeout || sched.afternoon.time_out || sched.afternoon.end || "";
            setValue("editAfternoonIn", aIn);
            setValue("editAfternoonOut", aOut);

            const afternoonEnabled = sched.afternoon.afternoonEnabled !== false && sched.afternoon.enabled !== false;
            const toggleCheckbox = document.getElementById("editAfternoonEnabled");
            if (toggleCheckbox) toggleCheckbox.checked = afternoonEnabled;
        } else {
            setValue("editAfternoonIn", "");
            setValue("editAfternoonOut", "");
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
        setValue("editMorningIn", "");
        setValue("editMorningOut", "");
        setValue("editAfternoonIn", "");
        setValue("editAfternoonOut", "");
        const morningToggleCheckbox = document.getElementById("editMorningEnabled");
        if (morningToggleCheckbox) morningToggleCheckbox.checked = true;
        updateMorningToggleUI();
        const toggleCheckbox = document.getElementById("editAfternoonEnabled");
        if (toggleCheckbox) toggleCheckbox.checked = true;
        updateAfternoonToggleUI();
        document.querySelectorAll('input[name="editDays"]').forEach(cb => cb.checked = false);
    }

    document.getElementById("editModal")?.classList.add("active");
};

window.viewFullAccountDetails = function () {
    const student = activeStudent;
    if (!student || !student.email) return;

    const targetUrl = `/coordinator-page/attendance/attendance_details.html?email=${encodeURIComponent(student.email)}&name=${encodeURIComponent(student.name)}&id=${encodeURIComponent(cleanValue(student.studentNumber) || "-")}&from=students`;
    window.location.href = targetUrl;
};

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

    document.getElementById("editMorningEnabled")
        ?.addEventListener("change", updateMorningToggleUI);
    document.getElementById("editAfternoonEnabled")
        ?.addEventListener("change", updateAfternoonToggleUI);

    const editStudentForm = document.getElementById("editStudentForm");
    if (!editStudentForm) return;

    editStudentForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!activeStudent || !activeStudent.docId) return;

        const name = document.getElementById("editStudentName").value.trim();
        const studentId = document.getElementById("editStudentId").value.trim();
        const section = document.getElementById("editStudentSection").value.trim();
        const company = document.getElementById("editStudentCompany").value.trim();
        const status = document.getElementById("editStudentStatus").value;
        const gender = document.getElementById("editStudentGender")?.value || "";

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
            // Direkta gamit ang document ID ng estudyante
            await updateDoc(doc(db, "users", activeStudent.docId), {
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

            hideModal();
            // Awtomatikong mag-a-update ang table (onSnapshot listener).
            showToast("Student profile updated successfully!", "success");
        } catch (error) {
            console.error("Error updating profile:", error);
            showToast("Failed to update student profile.", "error");
        }
    });
}