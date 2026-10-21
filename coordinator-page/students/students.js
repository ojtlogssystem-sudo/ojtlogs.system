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
    serverTimestamp,
    getDocs,
    deleteDoc,
    deleteField
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
let lastRenderedPage = null;      // para i-reset ang scroll ng table kapag lumipat ng page / nagpalit ng rows per page
let lastRenderedRowsKey = null;
// "auto" (default) = auto-fit kung ilang rows ang kasya sa visible height
// ng table bago mag-increment ng page. Kapag pinili ng user ang isang
// specific na number sa "Rows per page" dropdown, doon na gagamitin
// ang fixed value na 'yun imbes na auto-fit.
let rowsPerPage = "auto";
let autoRowsPerPage = 6; // current computed auto-fit value (may fallback default)
let isReflowingAutoRows = false;
let resizeDebounceTimer = null;
let studentToDelete = null;

// Ang mga field na dapat talagang mabura (hindi lang i-blangko) kapag
// "deleted" ang isang student, at kapag na-invite ulit siya - para talagang
// clean slate ulit siya, parang bagong account, imbes na bumalik yung
// dati niyang pangalan/company/schedule/atbp.
function getProfileResetFields() {
    return {
        fullName: deleteField(),
        name: deleteField(),
        firstName: deleteField(),
        lastName: deleteField(),
        studentNumber: deleteField(),
        studentId: deleteField(),
        gender: deleteField(),
        sex: deleteField(),
        companyName: deleteField(),
        company: deleteField(),
        supervisorName: deleteField(),
        course: deleteField(),
        section: deleteField(),
        schedule: deleteField(),
        photo: deleteField(),
        profilePic: deleteField(),
        photoURL: deleteField(),
        image: deleteField(),
        avatar: deleteField(),
        status: deleteField(),
        profileCompleted: false,
        isProfileComplete: false,
        profileCompletedAt: deleteField(),
        reEnabledAt: deleteField(),
        requirements: deleteField(),
        requirementsSubmittedAt: deleteField(),
        documentsStatus: deleteField(),
        documentsReviewNote: deleteField(),
        documentsReviewedAt: deleteField()
    };
}

// Ibinabalik ang aktwal na bilang ng rows na gagamitin sa pagination -
// yung fixed value kung manual, o yung na-compute na auto-fit value.
function getEffectiveRowsPerPage() {
    return rowsPerPage === "auto" ? autoRowsPerPage : rowsPerPage;
}

// Sinusukat ang height (sa px) ng isang tunay/rendered na row sa table.
// Kapag wala pang nai-render na row, gagamit na lang ng estimate
// (44px avatar + 11px padding sa taas/baba + 1px border).
function measureRowHeight() {
    const sampleRow = document.querySelector(".students-table tbody tr:not(.empty-slot-row)");
    if (sampleRow) {
        const height = sampleRow.getBoundingClientRect().height;
        if (height > 0) return height;
    }
    return 67;
}

// Kinukwenta kung ilang rows ang kasya sa natitirang visible height ng
// .table-container (hindi kasama yung thead), base sa aktwal na height
// ng isang row. Dito nagmumula ang "auto-fit" na pagination - punuin
// muna ang available space bago dagdagan ang page count.
function computeAutoRowsPerPage() {
    const container = document.querySelector(".table-container");
    const thead = document.querySelector(".students-table thead");
    if (!container || !thead) return autoRowsPerPage;

    const theadHeight = thead.getBoundingClientRect().height;
    const availableHeight = container.clientHeight - theadHeight;
    const rowHeight = measureRowHeight();

    if (availableHeight <= 0 || rowHeight <= 0) return autoRowsPerPage;

    const fitCount = Math.floor(availableHeight / rowHeight);
    return Math.max(1, fitCount);
}

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

// Pang-escape ng text na galing sa user/CSV bago ilagay sa innerHTML
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Pinagsasama ang Course + Section (hal. "BSIT" + "403" -> "BSIT 403").
// Kapag nauuna na sa section ang course (hal. "BSIT 403"), hindi na dodoblehin.
function combineCourseSection(course, section) {
    const c = String(course || "").trim();
    const s = String(section || "").trim();
    if (!s) return c;
    if (!c) return s;
    return s.toLowerCase().startsWith(c.toLowerCase()) ? s : `${c} ${s}`;
}

// "Review Documents" -> "review-documents" (para magamit bilang CSS class)
function statusToClass(status) {
    return String(status || "").toLowerCase().trim().replace(/\s+/g, "-");
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
    safeInit(initToolbarMenus, "initToolbarMenus");
    safeInit(initPaginationControls, "initPaginationControls");
    safeInit(initInviteModal, "initInviteModal");
    safeInit(initEditModal, "initEditModal");
    safeInit(initDeleteModalListeners, "initDeleteModalListeners");
    safeInit(initExportCsv, "initExportCsv");
    safeInit(initDocsReview, "initDocsReview");
});

function safeInit(fn, label) {
    try {
        fn();
    } catch (error) {
        console.error(`Error running ${label}:`, error);
    }
}

/* ==========================================
   AUTO-ARCHIVE kapag tapos na ang Academic Year
   (kapareho ng logic sa completed-batch-archive.js)
   - Natapos ang OJT -> archiveStatus: "Completed"
   - Hindi natapos   -> archiveStatus: "Incomplete"
   Hindi isasama ang student na pinayagan ng coordinator na
   magpatuloy ng hours, hangga't hindi pa siya Completed.
========================================== */
const AY_END_MONTH = 6;   // June
const AY_END_DAY = 30;
let autoArchiveRan = false;

function hasAcademicYearEnded(academicYear) {
    const m = String(academicYear || "").match(/^(\d{4})-(\d{4})$/);
    if (!m) return false;
    const end = new Date(Number(m[2]), AY_END_MONTH - 1, AY_END_DAY, 23, 59, 59);
    return new Date() > end;
}

async function autoArchiveEndedAcademicYears(usersSnapshot) {
    if (autoArchiveRan) return;
    autoArchiveRan = true;

    const updates = [];
    usersSnapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.archived === true || d.accountDisabled === true) return;

        const studentNumber = d.studentNumber || d.studentId || d.idNumber;
        if (!hasAcademicYearEnded(getStudentAcademicYear(studentNumber))) return;

        const isDone = d.status === "Completed" || d.internshipStatus === "Completed";
        if (d.allowContinueHours === true && !isDone) return;

        updates.push(updateDoc(doc(db, "users", docSnap.id), {
            archived: true,
            archivedAt: serverTimestamp(),
            archiveStatus: isDone ? "Completed" : "Incomplete",
            autoArchived: true
        }));
    });

    if (!updates.length) return;
    const results = await Promise.allSettled(updates);
    results.forEach((r) => {
        if (r.status === "rejected") console.error("Auto-archive failed:", r.reason);
    });
}

/* ==========================================
   STUDENT DOC CHECK
   Case-insensitive ang role (hal. "Student"/"student"/"intern"), at kung
   walang role pero may student number, student pa rin. Dati, exact na
   where("role","==","student") ang query kaya nawawala ang mga student
   na iba ang pagkakasulat ng role.
========================================== */
function isStudentDoc(u) {
    const role = String(u.role || "").trim().toLowerCase();
    if (role) return role === "student" || role === "intern";
    return !!(u.studentNumber || u.studentId);
}

/* ==========================================
   REAL-TIME LISTENER & DATA MERGING
========================================== */
function listenToStudentData() {
    const usersQuery = collection(db, "users");

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
        const allUsersSnapshot = await getDocs(usersRef);
        const studentDocs = allUsersSnapshot.docs.filter(d => isStudentDoc(d.data()));
        const usersSnapshot = { forEach: (cb) => studentDocs.forEach(cb) };

        // Isang beses lang bawat page load: i-archive ang mga student ng
        // academic year na tapos na. Kapag may na-update, mag-te-trigger
        // ulit ang snapshot listener at mawawala na sila sa table.
        autoArchiveEndedAcademicYears(usersSnapshot);

        const invitesRef = collection(db, "invitations");
        const invitesQuery = query(invitesRef, orderBy("createdAt", "desc"));
        const invitesSnapshot = await getDocs(invitesQuery);

        const studentMap = new Map();

        invitesSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const emailKey = (data.email || "").toLowerCase().trim();
            if (!emailKey) return;

            // May profile information galing sa CSV import ng coordinator
            // (full name, student ID, gender, course, section).
            const hasImportedProfile = !!String(data.fullName || "").trim();

            // Pinakabago ang nauuna (desc). Ang pinakabagong invitation ang
            // gagamitin, maliban kung wala itong imported profile pero mayroon
            // ang mas luma - para hindi mawala ang na-import na datos.
            const prev = studentMap.get(emailKey);
            if (prev && (prev.imported || !hasImportedProfile)) return;

            studentMap.set(emailKey, {
                photo: null,
                studentId: hasImportedProfile && data.studentId ? String(data.studentId) : "-",
                name: hasImportedProfile ? String(data.fullName).trim() : "",
                email: data.email,
                section: hasImportedProfile ? combineCourseSection(data.course, data.section) : "",
                company: data.company || "Pending Assignment",
                status: data.status || "Pending",
                // Lalabas sa table ang na-import na student (Pending pa rin ang status)
                profileDone: hasImportedProfile,
                imported: hasImportedProfile,
                gender: hasImportedProfile ? normalizeGender(data.gender) : "",
                schedule: null
            });
        });

        // Kung may higit sa isang user doc na iisa ang email (hal. luma na na-reset/
        // na-disable + bagong account), ang pinakakumpleto ang gagamitin. Dati,
        // ang huling na-iterate ang nananalo kaya pwedeng mapalitan o mabura ng
        // luma/walang laman na doc ang tamang account.
        const scoreUserDoc = (u) =>
            ((u.accountDisabled === true || u.archived === true) ? -100 : 0) +
            ((u.isProfileComplete === true || u.profileCompleted === true) ? 10 : 0) +
            ((u.studentNumber || u.studentId) ? 3 : 0) +
            ((u.fullName || u.name || u.firstName) ? 2 : 0) +
            ((u.course || u.section) ? 1 : 0);

        const bestByEmail = new Map();
        usersSnapshot.forEach((docSnap) => {
            const u = docSnap.data();
            const key = (u.email || u.userEmail || "").toLowerCase().trim();
            if (!key) return;
            const current = bestByEmail.get(key);
            if (!current || scoreUserDoc(u) > scoreUserDoc(current.data())) {
                bestByEmail.set(key, docSnap);
            }
        });

        // Debug: invitation na walang katugmang user doc (tingnan sa console)
        studentMap.forEach((_, key) => {
            if (!bestByEmail.has(key)) {
                console.warn("[students] Walang user doc (role=student) na may email na:", key,
                    "- baka iba ang email field o role ng account.");
            }
        });

        Array.from(bestByEmail.values()).forEach((docSnap) => {
            const userData = docSnap.data();
            const emailKey = (userData.email || userData.userEmail || "").toLowerCase().trim();
            if (!emailKey) return;

            // Na-"delete" na ng coordinator ang account na ito (soft delete) -
            // huwag na siyang ipakita sa table, kahit hindi pa physically
            // tinanggal ang Firestore doc.
            if (userData.accountDisabled === true) {
                studentMap.delete(emailKey);
                return;
            }

            // Na-archive na ang student (nasa Batch Archive na siya) -
            // huwag na siyang ipakita sa Students table.
            if (userData.archived === true) {
                studentMap.delete(emailKey);
                return;
            }

            const existingData = studentMap.get(emailKey) || {};

            if (!(userData.isProfileComplete === true || userData.profileCompleted === true)) {
                console.log("[students] user doc", docSnap.id, emailKey, {
                    role: userData.role,
                    name: userData.fullName || userData.name || userData.firstName || null,
                    studentNumber: userData.studentNumber || userData.studentId || null,
                    course: userData.course || null,
                    section: userData.section || null,
                    company: userData.companyName || userData.company || null,
                    isProfileComplete: userData.isProfileComplete,
                    profileCompleted: userData.profileCompleted
                });
            }

            // Tapos na ang profile setup LANG kapag na-submit na ng student ang
            // buong profile (naka-set ang profileCompleted flag, o may na-submit
            // nang requirements). Hindi na sapat ang may pangalan / student number
            // lang - dati kasi, dahil dun nagiging Active agad ang student kahit
            // hindi pa niya natatapos ang pag-input sa profile.
            const hasSubmittedDocs = !!userData.requirementsSubmittedAt;

            const isProfileDone =
                userData.isProfileComplete === true ||
                userData.profileCompleted === true ||
                hasSubmittedDocs;

            const rawStudentNumber = userData.studentNumber || userData.studentId || existingData.studentId;

            // Kung nag-register na ang student pero hindi pa tapos ang sarili niyang
            // profile setup, ang imported info ng coordinator (CSV) ang ipapakita.
            const useImported = !isProfileDone && existingData.imported === true;

            const userCourse = userData.course || "";
            const userSection = userData.section || "";
            let combinedSection = "";

            if (isProfileDone && userSection) {
                combinedSection = userSection.toLowerCase().startsWith(userCourse.toLowerCase())
                    ? userSection
                    : `${userCourse} ${userSection}`.trim();
            } else if (useImported) {
                combinedSection = existingData.section || "";
            }

            const rawCompany = userData.companyName || userData.company || existingData.company;
            const hasCompany = !!rawCompany;
            const company = rawCompany || "Pending Assignment";

            // STATUS FLOW:
            //   Pending          -> hindi pa tapos ang profile setup ng student
            //   Review Documents -> tapos na sa profile, hinihintay ang review ng coordinator
            //   Needs Revision   -> ibinalik ng coordinator ang documents (may note)
            //   Active           -> na-approve ng coordinator ang documents
            //   Completed        -> manual, final status na sine-set ng coordinator
            const isMarkedCompleted = (userData.status || "").toLowerCase() === "completed";
            // Kung walang documentsStatus: ang mga dating student (walang na-submit na
            // requirements) ay itinuturing na approved/Active na. "review" lang ang default
            // kapag may na-submit na documents na hinihintay pang i-review.
            const documentsStatus = String(
                userData.documentsStatus || (hasSubmittedDocs ? "review" : "approved")
            ).toLowerCase();
            const isFullyActive = isProfileDone && !!rawStudentNumber && hasCompany;

            let status;
            if (isMarkedCompleted) {
                status = "Completed";
            } else if (!isProfileDone) {
                status = "Pending";
            } else if (documentsStatus === "revision") {
                status = "Needs Revision";
            } else if (documentsStatus !== "approved") {
                status = "Review Documents";
            } else {
                status = isFullyActive ? "Active" : "Pending";
            }

            // Hanggat hindi pa tapos ang profile setup ng student, itago muna ang
            // photo, student ID, name, course, at section sa table (blangko lang).
            const fullName = isProfileDone
                ? (userData.fullName || userData.name ||
                    (userData.firstName ? `${userData.firstName} ${userData.lastName}` : existingData.name || "Student Intern"))
                : (useImported ? (existingData.name || "") : "");

            const studentNumber = (isProfileDone && rawStudentNumber)
                ? rawStudentNumber
                : (useImported ? (existingData.studentId || "-") : "-");
            const profilePic = isProfileDone
                ? (userData.photo || userData.profilePic || userData.photoURL || userData.image || userData.avatar || existingData.photo)
                : null;

            studentMap.set(emailKey, {
                docId: docSnap.id,
                photo: profilePic,
                studentId: studentNumber,
                name: fullName,
                email: userData.email || userData.userEmail || existingData.email || "",
                section: combinedSection,
                company: company,
                status: status,
                profileDone: isProfileDone || useImported,
                imported: existingData.imported === true,
                gender: normalizeGender(userData.gender || userData.sex || existingData.gender),
                schedule: userData.schedule || null,
                requirements: userData.requirements || null,
                documentsStatus: documentsStatus,
                documentsReviewNote: userData.documentsReviewNote || "",
                submissionCode: hasSubmittedDocs ? getSubmissionCode(docSnap.id) : ""
            });
        });

        // Ipakita lang ang mga student na tapos na sa profile setup.
        // Ang mga imbitado pa lang / hindi pa nakakapag-complete ng profile
        // (blangko ang name, ID, atbp.) ay hindi na lalabas sa table.
        allStudents = Array.from(studentMap.values()).filter(s => s.profileDone === true);
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

/* ==========================================
   ACADEMIC YEAR FILTER (base sa Student Number)
   Kinukuha ang taon sa unahan ng student number at kino-compute
   ang academic year ng graduation (hal. 2023 -> "2026-2027").
   Sinusuportahan ang mga format tulad ng:
   "2023001", "2023-0001", "23-0001"
========================================== */
const ALL_ACADEMIC_YEARS = "All Academic Years";
// Ilang taon mula sa pagpasok (taon sa student number) bago sila gagraduate
const YEARS_BEFORE_GRADUATION = 3;

function getStudentAcademicYear(studentNumber) {
    const s = String(studentNumber || "").trim();
    if (!s || s === "-") return "";

    let startYear = null;

    // 4-digit na taon sa unahan (hal. 2023001 / 2023-0001)
    const full = s.match(/^((?:19|20)\d{2})/);
    if (full) {
        startYear = parseInt(full[1], 10);
    } else {
        // 2-digit na taon sa unahan na may separator (hal. 23-0001)
        const short = s.match(/^(\d{2})\D/);
        if (short) startYear = 2000 + parseInt(short[1], 10);
    }

    if (!startYear) return "";

    // Academic year ng graduation: taon sa ID + YEARS_BEFORE_GRADUATION
    // (hal. 2023 -> 2026-2027)
    const gradYear = startYear + YEARS_BEFORE_GRADUATION;
    return `${gradYear}-${gradYear + 1}`;
}

// Binubuo ang listahan ng academic years mula sa mga student (pinakabago muna)
// at pinapanatili ang kasalukuyang napili kung nandoon pa rin.
function populateYearFilter() {
    const yearSelect = document.getElementById("yearFilter");
    if (!yearSelect) return;

    const previous = yearSelect.value || ALL_ACADEMIC_YEARS;

    const academicYears = Array.from(
        new Set(
            allStudents
                .map(student => getStudentAcademicYear(student.studentId))
                .filter(Boolean)
        )
    ).sort((a, b) => b.localeCompare(a));

    yearSelect.innerHTML = `<option value="${ALL_ACADEMIC_YEARS}">${ALL_ACADEMIC_YEARS}</option>` +
        academicYears.map(ay => `<option value="${ay}">AY ${ay}</option>`).join("");

    yearSelect.value = academicYears.includes(previous) ? previous : ALL_ACADEMIC_YEARS;
}

/* ==========================================
   PAGINATION & TABLE RENDER LOGIC
========================================== */
function applyFiltersAndPagination() {
    const searchVal = (document.getElementById("searchStudent")?.value || "").toLowerCase();
    const statusVal = (document.getElementById("statusFilter")?.value || "All Status").toLowerCase();
    const sortVal = document.getElementById("sortSelect")?.value || "Sort By";
    const yearVal = document.getElementById("yearFilter")?.value || ALL_ACADEMIC_YEARS;

    filteredStudents = allStudents.filter(student => {
        const matchesSearch = String(student.name || "").toLowerCase().includes(searchVal) ||
                              String(student.email || "").toLowerCase().includes(searchVal) ||
                              String(student.studentId || "").toLowerCase().includes(searchVal) ||
                              String(student.section || "").toLowerCase().includes(searchVal) ||
                              matchesSubmissionCode(student, searchVal);
        
        const matchesStatus = (statusVal === "all status") || (student.status.toLowerCase() === statusVal);
        
        // Academic year filter: base sa taon na nasa student number
        const matchesYear = (yearVal === ALL_ACADEMIC_YEARS) || (getStudentAcademicYear(student.studentId) === yearVal);

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
                <td colspan="9" style="text-align: center; padding: 25px; color: #888;">
                    No student intern records found.
                </td>
            </tr>
        `;
        updatePaginationUI(0, 0, 0);
        return;
    }

    const effectiveRows = getEffectiveRowsPerPage();
    const totalRecords = filteredStudents.length;
    const totalPages = Math.ceil(totalRecords / effectiveRows);

    if (currentPage > totalPages) currentPage = totalPages || 1;

    const startIndex = (currentPage - 1) * effectiveRows;
    const endIndex = Math.min(startIndex + effectiveRows, totalRecords);
    const paginatedItems = filteredStudents.slice(startIndex, endIndex);

    // Bumalik sa taas ng table kapag lumipat ng page o nagpalit ng rows per page
    // (hindi ire-reset kapag ibang dahilan lang ang re-render, hal. after archive)
    const tableScroller = document.querySelector(".table-container");
    if (tableScroller && (lastRenderedPage !== currentPage || lastRenderedRowsKey !== rowsPerPage)) {
        tableScroller.scrollTop = 0;
    }
    lastRenderedPage = currentPage;
    lastRenderedRowsKey = rowsPerPage;

    paginatedItems.forEach((student, index) => {
        const row = document.createElement("tr");
        // Tuloy-tuloy ang numbering kahit lumipat ng page (page 2 = 9, 10, 11...)
        const rowNumber = startIndex + index + 1;
        const statusClass = statusToClass(student.status);
        const profileDone = !!student.profileDone;
        const initials = getInitials(student.name);
        // Pending = wala pang information ang student, kaya naka-disable ang View
        const isPending = (student.status || "").toLowerCase() === "pending";
        // Active na = na-approve na ang documents, kaya naka-disable na ang Documents button
        const isActive = (student.status || "").toLowerCase() === "active";

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
            <td class="col-no">${rowNumber}</td>
            <td>${photoMarkup}</td>
            <td>${escapeHtml(student.studentId)}</td>
            <td>
                <strong>${escapeHtml(displayName)}</strong><br>
                <small style="color:#777;">${escapeHtml(student.email)}</small>
            </td>
            <td>${escapeHtml(courseCode)}</td>
            <td>${escapeHtml(sectionNum)}</td>
            <td>${escapeHtml(student.company)}</td>
            <td><span class="status ${statusClass}">${student.status}</span></td>
            <td class="actions">
                <button class="action-btn view-btn"${isPending ? ' disabled title="No information yet - student has not completed their profile"' : ''}><i class="fa-solid fa-eye"></i></button>
                <button class="action-btn docs-btn"${isPending ? ' disabled title="No documents yet - student has not completed their profile"' : (isActive ? ' disabled title="Documents already approved"' : ' title="Review submitted documents"')}><i class="fa-solid fa-file-lines"></i></button>
                <button class="action-btn archive-btn"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;

        tableBody.appendChild(row);
    });

    // Empty slot rows ay pang-"auto-fit" lang (para punuin ang visible space).
    // Sa fixed rows per page (5/6/8/15) hindi na nagdadagdag ng blangkong rows
    // para hindi humaba / mag-scroll nang walang laman sa huling page.
    const emptySlots = rowsPerPage === "auto" ? effectiveRows - paginatedItems.length : 0;
    for (let i = 0; i < emptySlots; i++) {
        const emptyRow = document.createElement("tr");
        emptyRow.className = "empty-slot-row";
        emptyRow.innerHTML = `<td colspan="9">&nbsp;</td>`;
        tableBody.appendChild(emptyRow);
    }

    attachActionEvents();
    updatePaginationUI(startIndex + 1, endIndex, totalRecords);

    // AUTO-FIT REFLOW: pagkatapos mag-render, sukatin ulit gamit ang
    // tunay/aktwal na row height. Kung magkaiba ang bagong kwenta sa
    // ginamit natin (hal. unang load pa lang, o nag-resize ang window),
    // i-re-render ulit nang isang beses gamit ang tamang bilang - dito
    // natin sinisiguro na mapupuno muna ang visible space ng totoong
    // datos bago tayo lumipat/gumawa ng bagong page.
    if (rowsPerPage === "auto" && !isReflowingAutoRows) {
        const recalculated = computeAutoRowsPerPage();
        if (recalculated !== autoRowsPerPage) {
            autoRowsPerPage = recalculated;
            isReflowingAutoRows = true;
            renderTablePage();
            isReflowingAutoRows = false;
        }
    }
}

function updatePaginationUI(start, end, total) {
    const info = document.getElementById("paginationInfo");
    if (info) {
        info.textContent = total > 0 ? `Showing ${start} to ${end} of ${total} records` : "Showing 0 records";
    }

    const totalPages = Math.ceil(total / getEffectiveRowsPerPage());
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
            const totalPages = Math.ceil(filteredStudents.length / getEffectiveRowsPerPage());
            if (currentPage < totalPages) {
                currentPage++;
                renderTablePage();
            }
        });
    }

    if (rowsSelect) {
        rowsSelect.addEventListener("change", (e) => {
            if (e.target.value === "auto") {
                rowsPerPage = "auto";
                autoRowsPerPage = computeAutoRowsPerPage();
            } else {
                rowsPerPage = parseInt(e.target.value, 10);
            }
            currentPage = 1;
            renderTablePage();
        });
    }

    // Kapag na-resize ang window (o na-collapse/expand ang sidebar) habang
    // nasa "Auto" mode, kwentahin ulit kung ilang rows ang bagong kasya
    // at i-render ulit ang table para tama pa rin ang pagpuno ng space.
    window.addEventListener("resize", () => {
        if (rowsPerPage !== "auto") return;
        clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = setTimeout(() => {
            const recalculated = computeAutoRowsPerPage();
            if (recalculated !== autoRowsPerPage) {
                autoRowsPerPage = recalculated;
                currentPage = 1;
                renderTablePage();
            }
        }, 200);
    });
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
        if (!btn || btn.disabled) return;

        const row = btn.closest("tr");
        if (!row) return;

        // 1. VIEW BUTTON CLICK
        if (btn.classList.contains("view-btn")) {
            e.stopPropagation();

            const photoImg = row.children[1].querySelector("img");
            const studentId = row.children[2].textContent.trim();
            const nameContainer = row.children[3];
            const studentName = nameContainer.querySelector("strong") ? nameContainer.querySelector("strong").innerText : "";
            const studentEmail = nameContainer.querySelector("small") ? nameContainer.querySelector("small").innerText : "";
            
            const courseCode = row.children[4].textContent.trim();
            const sectionNum = row.children[5].textContent.trim();
            const section = [courseCode, sectionNum].filter(v => v && v !== "-").join(" ");
            const company = row.children[6].textContent.trim();
            const status = row.children[7].textContent.trim();

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

            const startDateEl = document.getElementById("viewStudentStartDate");
            if (startDateEl) {
                const sd = currentStudent?.schedule?.startDate;
                if (sd) {
                    const [y, m, d] = sd.split("-").map(Number);
                    startDateEl.textContent = new Date(y, m - 1, d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
                } else {
                    startDateEl.textContent = "Not set";
                }
            }

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
                elStatus.className = `status-pill ${statusToClass(status)}`;
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

        // 2. DOCUMENTS BUTTON CLICK
        if (btn.classList.contains("docs-btn")) {
            e.stopPropagation();

            const nameContainer = row.children[3];
            const docsEmail = (nameContainer.querySelector("small") ? nameContainer.querySelector("small").innerText : "").toLowerCase().trim();
            const docsStudent = allStudents.find(s => s.email && s.email.toLowerCase().trim() === docsEmail);
            if (!docsStudent) return;

            const nameLabel = document.getElementById("docsModalStudentName");
            if (nameLabel) nameLabel.textContent = docsStudent.name || docsStudent.email;

            renderDocsReview(docsStudent);

            const docsModal = document.getElementById("docsModal");
            if (docsModal) docsModal.classList.add("active");
            return;
        }

        // 3. ARCHIVE / DELETE BUTTON CLICK
        if (btn.classList.contains("archive-btn")) {
            e.stopPropagation();
            const email = row.children[3].querySelector("small") ? row.children[3].querySelector("small").innerText.trim() : "";
            studentToDelete = { email, row };

            const deleteModal = document.getElementById("deleteConfirmModal");
            if (deleteModal) deleteModal.classList.add("active");
            return;
        }
    };

    initViewModalCloseListeners();
}

/* ==========================================
   SUBMISSION CODE
   Parehong code ang makikita ng student (sa student portal) at ng
   coordinator (dito). Hinango sa UID ng student, kaya walang kailangang
   i-save sa Firestore at gumagana rin sa mga na-submit na dati.
   !! DAPAT PAREHONG-PAREHO ang function na ito sa student side !!
========================================== */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // walang I, O, 0, 1 (iwas malito)

function getSubmissionCode(uid) {
    if (!uid) return "";
    // cyrb53 hash (53-bit)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < uid.length; i++) {
        const ch = uid.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    let n = 4294967296 * (2097151 & h2) + (h1 >>> 0);

    let code = "";
    for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[n % 32];
        n = Math.floor(n / 32);
    }
    return `OJT-${code}`;
}

// Tinatanggal ang dash/space para pwedeng i-type ang "ojt7k3f9q" o "7K3F9Q" lang
function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^OJT/, "");
}

/* ==========================================
   DOCUMENT REVIEW (Review Documents status)
   Makikita ng coordinator ang 3 requirements na pinasa ng student
   (Endorsement Letter, OJT Acceptance, MOA) at pwede niyang
   i-approve o ibalik para ma-revise.
   Naka-save ang files bilang chunks:
   users/{uid}/requirements/{prefix}_{index} -> { data }
========================================== */
const DOC_LABELS = {
    endorsementLetter: "Endorsement Letter",
    ojtAcceptance: "OJT Acceptance",
    moa: "MOA (Memorandum of Agreement)"
};

let reviewStudent = null; // student na kasalukuyang bukas sa View modal

// Mga nakahandang reason sa pag-reject (pipili na lang ang coordinator, hindi na magta-type)
const REJECT_REASONS = [
    "Blurry or unreadable",
    "Missing signature",
    "Missing date or company stamp",
    "Incomplete or cut-off pages",
    "Wrong document submitted",
    "Incorrect name or details",
    "Not submitted / missing file",
    "File can't be opened"
];

// Gumagawa ng dropdown ng reason para sa bawat document
function buildRejectReasons() {
    const box = document.getElementById("docsRejectReasons");
    if (!box) return;

    box.innerHTML = '<div class="docs-reject-title">Select the reason for each document that needs to be fixed</div>';

    Object.keys(DOC_LABELS).forEach((key) => {
        const row = document.createElement("div");
        row.className = "docs-reject-row";

        const label = document.createElement("span");
        label.className = "docs-reject-label";
        label.textContent = DOC_LABELS[key];

        const select = document.createElement("select");
        select.className = "docs-reject-select";
        select.dataset.doc = key;

        const none = document.createElement("option");
        none.value = "";
        none.textContent = "No issue";
        select.appendChild(none);

        REJECT_REASONS.forEach((reason) => {
            const opt = document.createElement("option");
            opt.value = reason;
            opt.textContent = reason;
            select.appendChild(opt);
        });

        row.appendChild(label);
        row.appendChild(select);
        box.appendChild(row);
    });
}

// Ibinabalik ang listahan ng napiling reasons, hal. "Endorsement Letter: Missing signature"
function collectRejectReasons() {
    const box = document.getElementById("docsRejectReasons");
    if (!box) return [];
    return Array.from(box.querySelectorAll("select.docs-reject-select"))
        .filter((sel) => sel.value)
        .map((sel) => `${DOC_LABELS[sel.dataset.doc]}: ${sel.value}`);
}

// Gawing listahan ng files ang requirement metadata (sinusuportahan ang lumang format na isang file lang)
function getRequirementFiles(meta, key) {
    if (!meta) return [];
    if (Array.isArray(meta.files) && meta.files.length) return meta.files;
    if (!meta.fileName && !meta.chunks) return [];
    return [{
        fileName: meta.fileName,
        fileType: meta.fileType,
        chunks: meta.chunks,
        prefix: key
    }];
}

// Search: tumatama kapag naka-type ang buong code o bahagi nito (min. 3 characters)
function matchesSubmissionCode(student, searchVal) {
    if (!student.submissionCode) return false;
    const q = normalizeCode(searchVal);
    return q.length >= 3 && normalizeCode(student.submissionCode).includes(q);
}

// Ipinapakita ang code sa taas ng docs modal + copy button
function renderSubmissionCode(student) {
    const box = document.getElementById("docsCodeBox");
    const valueEl = document.getElementById("docsCodeValue");
    if (!box || !valueEl) return;

    const code = student && student.submissionCode;
    box.hidden = !code;
    valueEl.textContent = code || "";
}

function initSubmissionCodeCopy() {
    const btn = document.getElementById("docsCodeCopyBtn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
        const code = document.getElementById("docsCodeValue")?.textContent || "";
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            showToast("Code copied.", "success");
        } catch (err) {
            showToast("Could not copy the code.", "error");
        }
    });
}

function renderDocsReview(student) {
    reviewStudent = student || null;

    const section = document.getElementById("docsReviewSection");
    const list = document.getElementById("docsReviewList");
    const help = document.getElementById("docsReviewHelp");
    const actions = document.getElementById("docsReviewActions");
    if (!section || !list) return;

    // Walang ipapakita kung wala pang na-submit na profile/documents
    const showSection = !!student && student.docId && student.status !== "Pending";
    section.hidden = !showSection;
    if (!showSection) return;

    renderSubmissionCode(student);

    list.innerHTML = "";
    Object.keys(DOC_LABELS).forEach((key) => {
        const files = getRequirementFiles(student.requirements && student.requirements[key], key);
        const li = document.createElement("li");
        li.className = "docs-review-item" + (files.length ? "" : " missing");

        const info = document.createElement("div");
        info.className = "docs-review-item-info";
        info.innerHTML = `
            <span class="docs-review-item-label">${escapeHtml(DOC_LABELS[key])}</span>
            <span class="docs-review-item-file">${files.length
                ? escapeHtml(files.map(f => f.fileName || "file").join(", "))
                : "Not submitted"}</span>
        `;
        li.appendChild(info);

        if (files.length) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "docs-review-view";
            btn.innerHTML = '<i class="fa-solid fa-eye"></i> View';
            btn.addEventListener("click", () => openRequirementFiles(btn, student, files, DOC_LABELS[key]));
            li.appendChild(btn);
        }

        list.appendChild(li);
    });

    const status = student.status;
    if (status === "Review Documents") {
        help.textContent = "Check the documents submitted by the student, then approve them or reject them by selecting what needs to be fixed.";
    } else if (status === "Needs Revision") {
        help.textContent = student.documentsReviewNote
            ? `Rejected and returned to the student. Reason: ${student.documentsReviewNote}`
            : "Returned to the student for revision.";
    } else {
        help.textContent = "";
    }

    // Approve / Return buttons: kapag "Review Documents" lang
    if (actions) actions.hidden = status !== "Review Documents";
    buildRejectReasons();
}

// Binubuo ulit ang file mula sa chunks at ipinapakita sa loob mismo ng page
// (viewer modal) - hindi na bumubukas ng bagong tab.
async function fetchRequirementBlob(student, meta) {
    const parts = [];
    for (let i = 0; i < (meta.chunks || 0); i++) {
        const snap = await getDoc(doc(db, "users", student.docId, "requirements", `${meta.prefix}_${i}`));
        if (!snap.exists()) throw new Error("Missing file chunk");
        parts.push(snap.data().data);
    }
    if (!parts.length) throw new Error("Empty file");

    const raw = await (await fetch(parts.join(""))).blob();
    const blob = raw.type ? raw : new Blob([raw], { type: meta.fileType || "" });
    return { url: URL.createObjectURL(blob), type: blob.type || meta.fileType || "" };
}

let docViewerUrls = [];

function closeDocViewer() {
    const modal = document.getElementById("docViewerModal");
    if (modal) modal.classList.remove("active");
    const body = document.getElementById("docViewerBody");
    if (body) body.innerHTML = "";
    docViewerUrls.forEach((u) => URL.revokeObjectURL(u));
    docViewerUrls = [];
}

function ensureDocViewer() {
    let modal = document.getElementById("docViewerModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "modal doc-viewer-modal";
    modal.id = "docViewerModal";
    modal.innerHTML = `
        <div class="doc-viewer-content">
            <div class="doc-viewer-header">
                <div class="doc-viewer-title">
                    <i class="fa-solid fa-file-lines"></i>
                    <span id="docViewerTitle">Document</span>
                </div>
                <button type="button" class="close-modal-btn" id="docViewerCloseBtn" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="doc-viewer-tabs" id="docViewerTabs" hidden></div>
            <div class="doc-viewer-body" id="docViewerBody"></div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeDocViewer();
    });
    modal.querySelector("#docViewerCloseBtn").addEventListener("click", closeDocViewer);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("active")) closeDocViewer();
    });
    return modal;
}

async function openRequirementFiles(btn, student, files, label) {
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading';

    try {
        const modal = ensureDocViewer();
        const titleEl = modal.querySelector("#docViewerTitle");
        const tabsEl = modal.querySelector("#docViewerTabs");
        const bodyEl = modal.querySelector("#docViewerBody");
        const loaded = new Array(files.length).fill(null);
        let currentIndex = -1;

        const render = (index, result) => {
            const meta = files[index];
            const name = meta.fileName || "file";
            const type = String(result.type || "").toLowerCase();
            bodyEl.innerHTML = "";

            if (type.includes("pdf") || /\.pdf$/i.test(name)) {
                const frame = document.createElement("iframe");
                frame.className = "doc-viewer-frame";
                frame.title = name;
                frame.src = result.url;
                bodyEl.appendChild(frame);
            } else if (type.startsWith("image/")) {
                const img = document.createElement("img");
                img.className = "doc-viewer-image";
                img.alt = name;
                img.src = result.url;
                bodyEl.appendChild(img);
            } else {
                const box = document.createElement("div");
                box.className = "doc-viewer-fallback";
                box.innerHTML = `
                    <i class="fa-solid fa-file-circle-exclamation"></i>
                    <p>This file type can't be previewed here.</p>
                `;
                const link = document.createElement("a");
                link.href = result.url;
                link.download = name;
                link.className = "doc-viewer-download";
                link.innerHTML = '<i class="fa-solid fa-download"></i> Download ';
                link.appendChild(document.createTextNode(name));
                box.appendChild(link);
                bodyEl.appendChild(box);
            }
        };

        const showFile = async (index) => {
            if (index === currentIndex) return;
            currentIndex = index;

            tabsEl.querySelectorAll("button").forEach((b, i) => b.classList.toggle("active", i === index));
            titleEl.textContent = [label, files[index].fileName].filter(Boolean).join(" - ") || "Document";

            if (!loaded[index]) {
                bodyEl.innerHTML = '<div class="doc-viewer-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading document...</div>';
                try {
                    loaded[index] = await fetchRequirementBlob(student, files[index]);
                    docViewerUrls.push(loaded[index].url);
                } catch (err) {
                    console.error("Error opening requirement file:", err);
                    if (currentIndex === index) {
                        bodyEl.innerHTML = '<div class="doc-viewer-loading error"><i class="fa-solid fa-circle-exclamation"></i> Could not open the document.</div>';
                    }
                    return;
                }
            }
            if (currentIndex === index) render(index, loaded[index]);
        };

        // Tabs lang kapag higit sa isang file ang requirement
        tabsEl.innerHTML = "";
        tabsEl.hidden = files.length < 2;
        if (files.length > 1) {
            files.forEach((meta, i) => {
                const tab = document.createElement("button");
                tab.type = "button";
                tab.textContent = meta.fileName || `File ${i + 1}`;
                tab.addEventListener("click", () => showFile(i));
                tabsEl.appendChild(tab);
            });
        }

        docViewerUrls.forEach((u) => URL.revokeObjectURL(u));
        docViewerUrls = [];
        modal.classList.add("active");
        await showFile(0);
    } catch (error) {
        console.error("Error opening requirement file:", error);
        showToast("Could not open the document.", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function initDocsReview() {
    initSubmissionCodeCopy();
    const approveBtn = document.getElementById("approveDocsBtn");
    const returnBtn = document.getElementById("returnDocsBtn");

    const setBusy = (busy) => {
        if (approveBtn) approveBtn.disabled = busy;
        if (returnBtn) returnBtn.disabled = busy;
    };

    const closeDocsModal = () => {
        const docsModal = document.getElementById("docsModal");
        if (docsModal) docsModal.classList.remove("active");
    };
    const closeViewModal = closeDocsModal;

    // Close buttons / click sa labas ng docs modal
    const docsModal = document.getElementById("docsModal");
    const closeDocsBtn = document.getElementById("closeDocsModalBtn");
    if (closeDocsBtn) closeDocsBtn.addEventListener("click", closeDocsModal);
    if (docsModal) {
        docsModal.addEventListener("click", (e) => {
            if (e.target === docsModal) closeDocsModal();
        });
    }

    if (approveBtn) {
        approveBtn.addEventListener("click", async () => {
            if (!reviewStudent || !reviewStudent.docId) return;
            setBusy(true);
            try {
                await updateDoc(doc(db, "users", reviewStudent.docId), {
                    documentsStatus: "approved",
                    documentsReviewNote: "",
                    documentsReviewedAt: serverTimestamp()
                });
                showToast("Documents approved. The student is now Active.", "success");
                closeViewModal();
            } catch (error) {
                console.error("Error approving documents:", error);
                showToast("Failed to approve the documents.", "error");
            } finally {
                setBusy(false);
            }
        });
    }

    if (returnBtn) {
        returnBtn.addEventListener("click", async () => {
            if (!reviewStudent || !reviewStudent.docId) return;

            const note = collectRejectReasons().join("; ");
            if (!note) {
                showToast("Please select at least one reason for rejecting the documents.", "error");
                return;
            }

            setBusy(true);
            try {
                await updateDoc(doc(db, "users", reviewStudent.docId), {
                    documentsStatus: "revision",
                    documentsReviewNote: note,
                    documentsReviewedAt: serverTimestamp()
                });
                showToast("Documents rejected. The student was asked to revise them.", "info");
                closeViewModal();
            } catch (error) {
                console.error("Error returning documents:", error);
                showToast("Failed to return the documents.", "error");
            } finally {
                setBusy(false);
            }
        });
    }
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

            confirmDeleteBtn.disabled = true;

            try {
                // Soft delete: hindi natin tinatanggal ang "users" doc mismo,
                // dahil hindi natin kayang i-delete ang Firebase Auth account
                // mula client-side (kailangan ng Admin SDK/Cloud Function +
                // Blaze plan para dun). Sa halip: (1) minamarkahan natin
                // siyang disabled para ma-block ng login page, AT (2) buong
                // binubura/rine-reset natin ang profile data niya (pangalan,
                // student number, company, supervisor, schedule, photo,
                // atbp.) - para talagang wala nang laman ang datos niya
                // habang naka-delete, tulad ng hiningi.
                const userSnapshot = await getDocs(query(collection(db, "users"), where("email", "==", email)));
                await Promise.all(userSnapshot.docs.map((documentSnap) =>
                    updateDoc(doc(db, "users", documentSnap.id), {
                        accountDisabled: true,
                        disabledAt: new Date().toISOString(),
                        ...getProfileResetFields()
                    })
                ));

                // Kung may pending invitation pa lang (hindi pa nag-complete
                // ng signup), pwede na talagang i-delete nang buo dahil wala
                // pang Auth account na kaakibat dito.
                const inviteSnapshot = await getDocs(query(collection(db, "invitations"), where("email", "==", email)));
                inviteSnapshot.forEach(async (documentSnap) => {
                    await deleteDoc(doc(db, "invitations", documentSnap.id));
                });

                if (row) row.remove();
                showToast("The student account has been deleted, along with all of its data.", "success");
                closeDeleteModal();
            } catch (error) {
                console.error("Error sa pag-delete ng student:", error);
                showToast("The student account was not deleted.", "error");
            } finally {
                confirmDeleteBtn.disabled = false;
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

            // Kunin ang mga in-input na oras mula sa modal inputs
            const morningIn = document.getElementById("editMorningIn")?.value || "";
            const morningOut = document.getElementById("editMorningOut")?.value || "";
            const morningEnabled = document.getElementById("editMorningEnabled")?.checked ?? true;
            const afternoonIn = document.getElementById("editAfternoonIn")?.value || "";
            const afternoonOut = document.getElementById("editAfternoonOut")?.value || "";
            const afternoonEnabled = document.getElementById("editAfternoonEnabled")?.checked ?? true;

            const ojtStartDate = document.getElementById("editOjtStartDate")?.value || "";

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
                            "schedule.startDate": ojtStartDate,
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
// Isang email = isang invitation. Ginagamit ng single at bulk (CSV) invite.
// Nagre-return ng { restored } - true kung na-restore ang dating na-"delete" na account.
// Optional na "profile" ({ fullName, studentId, gender, course, section }) galing sa CSV import.
async function sendInviteToEmail(emailInput, profile = null) {
    const loginUrl = `${window.location.origin}/student-page/student_login/student_login.html?email=${encodeURIComponent(emailInput)}`;

    // Tignan muna kung may existing "users" doc na para sa email
    // na ito. Kung na-"delete" (disabled) na siya dati, ibig
    // sabihin may natitirang Firebase Auth account pa rin siya
    // (hindi natin kayang tanggalin 'yun client-side), kaya sa
    // halip na gumawa ng bagong invitation na sisira dahil
    // existing na ang Auth email na 'yun, ire-reset at
    // ire-enable na lang natin ulit ang parehong "users" doc -
    // blangko/clean slate, parang bagong account mula umpisa.
    const existingUserSnapshot = await getDocs(
        query(collection(db, "users"), where("email", "==", emailInput))
    );
    const disabledUserDoc = existingUserSnapshot.docs.find(
        (docSnap) => docSnap.data().accountDisabled === true
    );

    if (disabledUserDoc) {
        // I-reset ulit dito (hindi lang basta i-re-enable) sakaling
        // na-disable ang account na ito bago pa i-deploy itong
        // pag-reset-sa-delete - para siguradong blangko/clean
        // slate talaga siya, parang bagong account.
        await updateDoc(doc(db, "users", disabledUserDoc.id), {
            accountDisabled: false,
            disabledAt: null,
            role: "student",
            ...getProfileResetFields()
        });
    }

    // Bagong "Pending" invitation record - para talagang parang
    // panibagong imbitasyon ito mula umpisa, kasama ng ibang parte
    // ng system na umaasa sa "invitations" collection (hal.
    // notification bell ng coordinator).
    const inviteData = {
        email: emailInput,
        status: "Pending",
        role: "student",
        createdAt: new Date().toISOString()
    };

    // Ilagay ang information ng student galing sa CSV (kung meron).
    // Hindi isinasama ang blangko - hindi tumatanggap ang Firestore ng undefined.
    if (profile) {
        ["fullName", "studentId", "gender", "course", "section"].forEach((key) => {
            if (profile[key]) inviteData[key] = profile[key];
        });
        if (inviteData.fullName) inviteData.importedFromCsv = true;
    }

    await addDoc(collection(db, "invitations"), inviteData);

    if (window.emailjs) {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email: emailInput,
            invite_link: loginUrl
        });
    }

    return { restored: !!disabledUserDoc };
}

function initInviteModal() {
    const addBtn = document.getElementById("addStudentBtn");
    const inviteModal = document.getElementById("inviteModal");
    const closeModal = document.getElementById("closeModal");
    const cancelModal = document.getElementById("cancelModal");
    const inviteForm = document.getElementById("inviteForm");
    const successMessage = document.getElementById("successMessage");
    const sentEmailText = document.getElementById("sentEmailText");

    // CSV import elements
    const studentEmailInput = document.getElementById("studentEmail");
    const importCsvBtn = document.getElementById("importCsvBtn");
    const csvFileInput = document.getElementById("csvFileInput");
    const csvPreview = document.getElementById("csvPreview");
    const csvSummary = document.getElementById("csvSummary");
    const clearCsvBtn = document.getElementById("clearCsvBtn");
    const submitBtn = inviteForm ? inviteForm.querySelector(".btn-submit") : null;
    const submitBtnDefaultHtml = submitBtn ? submitBtn.innerHTML : "";

    const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
    let csvEmails = [];      // mga email galing sa CSV
    const csvProfiles = new Map(); // email (lowercase) -> { fullName, studentId, gender, course, section }
    let csvNotes = "";       // hal. "2 duplicates skipped"
    const csvPreviewList = document.getElementById("csvPreviewList");
    const toggleCsvListBtn = document.getElementById("toggleCsvListBtn");
    const toggleCsvListText = document.getElementById("toggleCsvListText");
    let isSending = false;

    // Pinagsamang listahan (manual + CSV), walang duplicate.
    const getAllEmails = () => {
        const manual = studentEmailInput ? studentEmailInput.value.trim() : "";
        const seen = new Set();
        const result = [];
        [manual, ...csvEmails].forEach((email) => {
            if (!email) return;
            const key = email.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            result.push(email);
        });
        return result;
    };

    const updateSubmitLabel = () => {
        if (!submitBtn || isSending) return;
        const count = getAllEmails().length;
        submitBtn.innerHTML = count > 1
            ? `<i class="fa-solid fa-paper-plane"></i> Send ${count} Invites`
            : submitBtnDefaultHtml;
    };

    const renderCsvPreview = () => {
        if (!csvPreview) return;
        if (csvEmails.length === 0) {
            csvPreview.classList.remove("active");
            updateSubmitLabel();
            return;
        }

        csvSummary.textContent =
            `${csvEmails.length} student${csvEmails.length > 1 ? "s" : ""} ready` +
            (csvNotes ? ` · ${csvNotes}` : "");

        // Maliit na preview ng unang ilang rows para makita ng coordinator
        // kung tama ang pagkakabasa ng CSV.
        if (csvPreviewList) {
            csvPreviewList.innerHTML = "";
            const PREVIEW_LIMIT = 200;
            csvEmails.slice(0, PREVIEW_LIMIT).forEach((email) => {
                const p = csvProfiles.get(email.toLowerCase());
                const li = document.createElement("li");
                if (p && p.fullName) {
                    const extra = [p.studentId, combineCourseSection(p.course, p.section), p.gender]
                        .filter(Boolean).join(" · ");
                    li.textContent = p.fullName;
                    if (extra) {
                        const span = document.createElement("span");
                        span.textContent = ` — ${extra}`;
                        li.appendChild(span);
                    }
                } else {
                    li.textContent = email;
                }
                csvPreviewList.appendChild(li);
            });
            if (csvEmails.length > PREVIEW_LIMIT) {
                const more = document.createElement("li");
                more.className = "csv-more";
                more.textContent = `+ ${csvEmails.length - PREVIEW_LIMIT} more`;
                csvPreviewList.appendChild(more);
            }
        }

        csvPreview.classList.add("active");
        updateSubmitLabel();
    };

    // Dropdown ng listahan ng na-import na students (nakatago by default)
    const setCsvListOpen = (open) => {
        if (!csvPreview) return;
        csvPreview.classList.toggle("open", open);
        if (toggleCsvListBtn) toggleCsvListBtn.setAttribute("aria-expanded", String(open));
        if (toggleCsvListText) toggleCsvListText.textContent = open ? "Hide details" : "View details";
    };

    if (toggleCsvListBtn) {
        toggleCsvListBtn.addEventListener("click", () => {
            setCsvListOpen(!csvPreview.classList.contains("open"));
        });
    }

    const resetCsv = () => {
        setCsvListOpen(false);
        csvEmails = [];
        csvProfiles.clear();
        csvNotes = "";
        if (csvFileInput) csvFileInput.value = "";
        renderCsvPreview();
    };

    /* ---------- CSV PARSING ---------- */
    // Expected columns: Full Name, Student ID, Gender, Course, Section, Email
    // (kahit anong pagkakasunod-sunod, basta nakalagay sa header row).
    const HEADER_ALIASES = {
        fullName: ["fullname", "name", "studentname", "completename"],
        studentId: ["studentid", "studentnumber", "studentno", "idnumber", "idno", "id"],
        gender: ["gender", "sex"],
        course: ["course", "program", "degree"],
        section: ["section", "yearandsection", "yearsection"],
        email: ["email", "emailaddress", "gmail", "gmailaddress"]
    };

    const normHeader = (h) => String(h || "").toLowerCase().replace(/[^a-z]/g, "");

    const cleanCell = (v) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

    const detectDelimiter = (text) => {
        const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
        const counts = { ",": 0, ";": 0, "\t": 0 };
        let inQuotes = false;
        for (const ch of firstLine) {
            if (ch === '"') inQuotes = !inQuotes;
            else if (!inQuotes && ch in counts) counts[ch]++;
        }
        return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ",");
    };

    // Tamang CSV parser: sinusuportahan ang quoted fields na may comma
    // (hal. "DELA CRUZ, JUAN A."), escaped quotes (""), at CRLF/LF.
    const parseCsvRows = (text, delimiter) => {
        const rows = [];
        let row = [];
        let field = "";
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else inQuotes = false;
                } else {
                    field += ch;
                }
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === delimiter) {
                row.push(field);
                field = "";
            } else if (ch === "\n" || ch === "\r") {
                if (ch === "\r" && text[i + 1] === "\n") i++;
                row.push(field);
                field = "";
                rows.push(row);
                row = [];
            } else {
                field += ch;
            }
        }
        if (field !== "" || row.length) {
            row.push(field);
            rows.push(row);
        }
        return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    };

    const parseCsvStudents = (rawText) => {
        const text = rawText.replace(/^\uFEFF/, "");
        const rows = parseCsvRows(text, detectDelimiter(text));
        const result = { records: [], invalid: 0, duplicates: 0, duplicateIds: 0, missingEmailColumn: false };
        if (rows.length === 0) return result;

        // Hanapin kung aling column ang alin base sa header row
        const headers = rows[0].map(normHeader);
        const colIndex = {};
        Object.keys(HEADER_ALIASES).forEach((field) => {
            const idx = headers.findIndex((h) => HEADER_ALIASES[field].includes(h));
            if (idx !== -1) colIndex[field] = idx;
        });
        const hasHeader = Object.keys(colIndex).length > 0;

        const seen = new Set(csvEmails.map((e) => e.toLowerCase()));
        const seenIds = new Set(
            Array.from(csvProfiles.values()).map((p) => (p.studentId || "").toLowerCase()).filter(Boolean)
        );

        const pushRecord = (email, profile) => {
            if (!EMAIL_REGEX.test(email)) { result.invalid++; return; }
            const key = email.toLowerCase();
            if (seen.has(key)) { result.duplicates++; return; }
            seen.add(key);

            const idKey = (profile.studentId || "").toLowerCase();
            if (idKey) {
                if (seenIds.has(idKey)) result.duplicateIds++;
                seenIds.add(idKey);
            }
            result.records.push({ email, profile });
        };

        // Walang header na nakilala -> lumang format: email lang ang kukunin
        if (!hasHeader) {
            rows.forEach((r) => {
                r.map(cleanCell).filter((c) => c.includes("@")).forEach((c) => pushRecord(c, {}));
            });
            return result;
        }

        if (colIndex.email === undefined) {
            result.missingEmailColumn = true;
            return result;
        }

        rows.slice(1).forEach((r) => {
            const get = (field) => (colIndex[field] === undefined ? "" : cleanCell(r[colIndex[field]]));
            const email = get("email");
            if (!email) { result.invalid++; return; }

            pushRecord(email, {
                fullName: get("fullName"),
                studentId: get("studentId"),
                gender: normalizeGender(get("gender")),
                course: get("course"),
                section: get("section")
            });
        });

        return result;
    };

    if (importCsvBtn && csvFileInput) {
        importCsvBtn.addEventListener("click", () => {
            if (!isSending) csvFileInput.click();
        });

        csvFileInput.addEventListener("change", () => {
            const file = csvFileInput.files && csvFileInput.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                const { records, invalid, duplicates, duplicateIds, missingEmailColumn } =
                    parseCsvStudents(String(reader.result || ""));

                if (missingEmailColumn) {
                    showToast("The CSV needs an Email column so the invitation can be sent.", "error", 4500);
                    csvFileInput.value = "";
                    return;
                }

                if (records.length === 0 && csvEmails.length === 0) {
                    showToast("No valid students found in the CSV.", "error");
                    csvFileInput.value = "";
                    return;
                }

                records.forEach(({ email, profile }) => {
                    csvEmails.push(email);
                    csvProfiles.set(email.toLowerCase(), profile);
                });

                const notes = [];
                if (duplicates) notes.push(`${duplicates} duplicate${duplicates > 1 ? "s" : ""} skipped`);
                if (invalid) notes.push(`${invalid} invalid skipped`);
                if (duplicateIds) notes.push(`${duplicateIds} repeated student ID`);
                csvNotes = notes.join(" · ");
                renderCsvPreview();
                csvFileInput.value = "";
            };
            reader.onerror = () => showToast("Hindi mabasa ang CSV file.", "error");
            reader.readAsText(file);
        });
    }

    if (clearCsvBtn) clearCsvBtn.addEventListener("click", () => { if (!isSending) resetCsv(); });
    if (studentEmailInput) studentEmailInput.addEventListener("input", updateSubmitLabel);

    if (addBtn && inviteModal) {
        addBtn.addEventListener("click", () => {
            inviteModal.classList.add("active");
            if (successMessage) successMessage.classList.remove("active");
        });
    }

    const hideModal = () => {
        if (isSending) return;
        if (inviteModal) {
            inviteModal.classList.remove("active");
            if (inviteForm) inviteForm.reset();
            resetCsv();
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
            if (isSending) return;

            const emails = getAllEmails();
            if (emails.length === 0) {
                showToast("Maglagay ng email o mag-import ng CSV.", "error");
                return;
            }

            const manualEmail = studentEmailInput ? studentEmailInput.value.trim().toLowerCase() : "";

            isSending = true;
            if (submitBtn) submitBtn.disabled = true;

            let sentCount = 0;
            let restoredCount = 0;
            let lastSent = "";
            const failed = [];

            for (let i = 0; i < emails.length; i++) {
                if (submitBtn && emails.length > 1) {
                    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending ${i + 1}/${emails.length}...`;
                }

                try {
                    const result = await sendInviteToEmail(emails[i], csvProfiles.get(emails[i].toLowerCase()) || null);
                    sentCount++;
                    lastSent = emails[i];
                    if (result.restored) restoredCount++;
                } catch (error) {
                    console.error("Error inviting student:", emails[i], error);
                    failed.push(emails[i]);
                }

                // Maliit na pagitan para hindi ma-rate limit ang email service.
                if (i < emails.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }

            isSending = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = submitBtnDefaultHtml;
            }

            if (restoredCount > 0) {
                showToast(
                    restoredCount === 1
                        ? "Na-restore ang access - kailangan niya ulit kumpletuhin ang profile setup."
                        : `${restoredCount} na account ang na-restore - kailangan nilang ulit kumpletuhin ang profile setup.`,
                    "success"
                );
            }

            if (failed.length === 0) {
                if (sentEmailText) {
                    sentEmailText.textContent = sentCount === 1 ? lastSent : `${sentCount} students`;
                }
                if (successMessage) successMessage.classList.add("active");

                setTimeout(() => {
                    hideModal();
                }, 2000);
                return;
            }

            // May pumalyang email - iiwan sa listahan para ma-retry.
            showToast(
                sentCount > 0
                    ? `${sentCount} na-send, ${failed.length} ang hindi na-send. Pwede mo ulit i-try ang natira.`
                    : "Hindi na-send ang imbitasyon.",
                "error",
                5000
            );

            const manualFailed = failed.some((f) => f.toLowerCase() === manualEmail);
            if (!manualFailed && studentEmailInput) studentEmailInput.value = "";
            csvEmails = failed.filter((f) => f.toLowerCase() !== manualEmail);
            csvNotes = "";
            renderCsvPreview();
            updateSubmitLabel();
        });
    }
}

window.openEditModalFromProfile = function() {
    const viewModal = document.getElementById("viewStudentModal");
    if (viewModal) viewModal.classList.remove("active");

    const studentEmail = document.getElementById("viewStudentEmail")?.textContent.trim() || "";
    if (document.getElementById("editStudentEmail")) document.getElementById("editStudentEmail").value = studentEmail;
    // Populate schedule details & times mula sa current loaded student state
    const currentStudent = allStudents.find(s => s.email && s.email.toLowerCase().trim() === studentEmail.toLowerCase().trim());
    if (currentStudent && currentStudent.schedule) {
        const sched = currentStudent.schedule;
        if (document.getElementById("editOjtStartDate")) document.getElementById("editOjtStartDate").value = sched.startDate || "";

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
        if (document.getElementById("editOjtStartDate")) document.getElementById("editOjtStartDate").value = "";
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

/* ==========================================
   FILTER & SORT BUTTONS (popover menus)
   Gumagamit pa rin ng existing #yearFilter, #statusFilter at
   #sortSelect - ang mga button/popover ay UI lang sa ibabaw nila.
========================================== */
function initToolbarMenus() {
    const filterBtn = document.getElementById("filterBtn");
    const filterPopover = document.getElementById("filterPopover");
    const sortBtn = document.getElementById("sortBtn");
    const sortPopover = document.getElementById("sortPopover");
    const filterBadge = document.getElementById("filterBadge");
    const yearFilter = document.getElementById("yearFilter");
    const statusFilter = document.getElementById("statusFilter");
    const sortSelect = document.getElementById("sortSelect");
    const resetBtn = document.getElementById("resetFilterBtn");

    const menus = [
        { btn: filterBtn, pop: filterPopover },
        { btn: sortBtn, pop: sortPopover }
    ].filter(m => m.btn && m.pop);

    const closeAll = () => {
        menus.forEach(({ btn, pop }) => {
            pop.classList.remove("open");
            btn.setAttribute("aria-expanded", "false");
        });
    };

    menus.forEach(({ btn, pop }) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const willOpen = !pop.classList.contains("open");
            closeAll();
            if (willOpen) {
                pop.classList.add("open");
                btn.setAttribute("aria-expanded", "true");
            }
        });
        pop.addEventListener("click", (e) => e.stopPropagation());
    });

    document.addEventListener("click", closeAll);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeAll();
    });

    // Badge: ilan ang active na filter
    const updateFilterBadge = () => {
        if (!filterBadge) return;
        let count = 0;
        if (yearFilter && yearFilter.value !== ALL_ACADEMIC_YEARS) count++;
        if (statusFilter && statusFilter.value !== "All Status") count++;
        filterBadge.textContent = count;
        filterBadge.hidden = count === 0;
    };

    if (yearFilter) yearFilter.addEventListener("change", updateFilterBadge);
    if (statusFilter) statusFilter.addEventListener("change", updateFilterBadge);

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            if (yearFilter) {
                yearFilter.value = ALL_ACADEMIC_YEARS;
                yearFilter.dispatchEvent(new Event("change"));
            }
            if (statusFilter) {
                statusFilter.value = "All Status";
                statusFilter.dispatchEvent(new Event("change"));
            }
        });
    }

    // Sort options
    const sortOptions = sortPopover ? sortPopover.querySelectorAll(".sort-option") : [];
    sortOptions.forEach((opt) => {
        opt.addEventListener("click", () => {
            sortOptions.forEach(o => o.classList.toggle("active", o === opt));
            if (sortSelect) {
                sortSelect.value = opt.dataset.sort;
                sortSelect.dispatchEvent(new Event("change"));
            }
            closeAll();
        });
    });

    updateFilterBadge();
}