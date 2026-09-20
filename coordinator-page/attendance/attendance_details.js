import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const usersRef = collection(db, "users");
const attendanceRef = collection(db, "attendance");

// Generates First Initial + Last Initial
// Mirrors student_dashboard.js's calculateHoursFromTime() exactly, so any
// record lacking a saved todayHours string is treated the same on both pages.
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
        console.error("Error parsing time string:", e);
        return 0;
    }
}

function getInitials(name) {
    if (!name || typeof name !== 'string') return 'N/A';
    const cleanName = name.replace(/\b[A-Za-z]\.\b/g, '').trim();
    const words = cleanName.split(/\s+/).filter(w => w.length > 0);
    
    if (words.length === 0) return 'N/A';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

document.addEventListener("DOMContentLoaded", () => {
    const tableBody = document.querySelector(".history-table tbody");

    // Sinasalo ang iba't ibang posibleng pangalan ng URL parameter mula sa kabilang pahina
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get("id") || urlParams.get("userId") || urlParams.get("uid") || urlParams.get("studentId");

    // ==========================================
    // DYNAMIC BACK BUTTON
    // ==========================================

    const backBtn = document.getElementById("backBtn");
    const backBtnText = document.getElementById("backBtnText");

    const fromPage = urlParams.get("from");

    if (fromPage === "students") {
    backBtn.href = "../students/students.html";
    backBtnText.textContent = "Back to Students";
    } else {
        backBtn.href = "../attendance/attendance_records.html";
        backBtnText.textContent = "Back to Attendance Records";
    }

    let currentAttendanceData = null;
    let allStudentAttendance = [];

    async function fetchAttendanceDetails() {
        try {
            let matchedUser = null;
            let targetUserId = null;

            if (paramId) {
                // Hakbang 1: Subukang direktang basahin sa "users" collection gamit ang ID
                const userDocRef = doc(db, "users", paramId);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                    matchedUser = userDocSnap.data();
                    targetUserId = paramId;
                } else {
                    // Hakbang 2: Kung wala sa users, baka Attendance ID ito
                    const attDocRef = doc(db, "attendance", paramId);
                    const attDocSnap = await getDoc(attDocRef);

                    if (attDocSnap.exists()) {
                        currentAttendanceData = { id: attDocSnap.id, ...attDocSnap.data() };
                        targetUserId = currentAttendanceData.userId || currentAttendanceData.uid;

                        if (targetUserId) {
                            const uSnap = await getDoc(doc(db, "users", targetUserId));
                            if (uSnap.exists()) {
                                matchedUser = uSnap.data();
                            }
                        }
                    }
                }
            }

            // Hakbang 3: Kung hindi pa rin mahanap, i-scan ang buong users collection para hanapin ang tugmang email o studentNumber
            if (!matchedUser) {
                const usersSnapshot = await getDocs(usersRef);
                usersSnapshot.forEach(uDoc => {
                    const uData = uDoc.data();
                    if (paramId && (uDoc.id === paramId || uData.studentNumber === paramId)) {
                        matchedUser = uData;
                        targetUserId = uDoc.id;
                    } else if (currentAttendanceData?.userEmail && uData.email && uData.email.toLowerCase() === currentAttendanceData.userEmail.toLowerCase()) {
                        matchedUser = uData;
                        targetUserId = uDoc.id;
                    }
                });
            }

            // Pagkuha ng mga eksaktong field batay sa iyong Firestore schema screenshot
            const studentName = matchedUser?.name || matchedUser?.fullName || currentAttendanceData?.userName || "Unknown Student";
            const studentCompany = matchedUser?.companyName || matchedUser?.company || "Not Specified";
            const studentEmail = matchedUser?.email || currentAttendanceData?.userEmail || "No Email Provided";
            const studentIdVal = matchedUser?.studentNumber || targetUserId || "N/A";

            // Pag-format ng Course at Section na may gitling (-) tulad ng "BSIT - 403"
            const studentCourse = matchedUser?.course || "";
            let studentSection = matchedUser?.section || "";
            
            let fullCourseSection = "N/A";
            if (studentSection && studentCourse) {
                let cleanSec = studentSection.trim();
                const regex = new RegExp(`^${studentCourse}\\s*[-–]?\\s*`, 'i');
                cleanSec = cleanSec.replace(regex, '').trim();
                
                fullCourseSection = `${studentCourse} - ${cleanSec}`;
            } else if (studentCourse) {
                fullCourseSection = studentCourse;
            } else if (studentSection) {
                fullCourseSection = studentSection;
            }

            // Supervisor Name mula sa field na "supervisorName" sa database
            const studentSupervisor = matchedUser?.supervisorName || matchedUser?.supervisor || "Not Assigned";

            // Pag-update ng UI elements sa Profile / Account Details section
            const nameHeading = document.getElementById("profileNameHeading");
            if (nameHeading) nameHeading.textContent = studentName;

            const profileAvatarCircle = document.getElementById("profileAvatarCircle");
            const studentPhoto = matchedUser?.photo || matchedUser?.profilePic || matchedUser?.photoURL || matchedUser?.image || matchedUser?.avatar;
            if (profileAvatarCircle) {
                if (studentPhoto) {
                    profileAvatarCircle.innerHTML = `<img src="${studentPhoto}" alt="${studentName}">`;
                } else {
                    profileAvatarCircle.textContent = getInitials(studentName);
                }
            }

            if (document.getElementById("infoSection")) document.getElementById("infoSection").textContent = fullCourseSection;
            if (document.getElementById("infoCompany")) document.getElementById("infoCompany").textContent = studentCompany;
            if (document.getElementById("infoStudentId")) document.getElementById("infoStudentId").textContent = studentIdVal;
            if (document.getElementById("infoEmail")) document.getElementById("infoEmail").textContent = studentEmail;
            if (document.getElementById("infoSupervisor")) document.getElementById("infoSupervisor").textContent = studentSupervisor;

            // Pagkuha ng attendance records na pagmamay-ari lamang ng user na ito
            try {
                const allAttSnapshot = await getDocs(attendanceRef);
                allStudentAttendance = [];

                allAttSnapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    const isSameUserId = targetUserId && (data.userId === targetUserId || data.uid === targetUserId);
                    // Only fall back to matching by email when the record has NO
                    // userId/uid at all. Previously this was an independent OR,
                    // so any record whose email happened to match — even if its
                    // userId pointed to a different account — got counted too,
                    // inflating this page's total above the student dashboard's
                    // (which strictly queries by userId only). Matching this way
                    // keeps both pages summing the exact same set of records.
                    const hasOwnerId = !!(data.userId || data.uid);
                    const isSameEmail = !hasOwnerId && studentEmail && data.userEmail && (data.userEmail.toLowerCase() === studentEmail.toLowerCase());

                    if (isSameUserId || isSameEmail) {
                        allStudentAttendance.push({ id: docSnap.id, ...data });
                    }
                });
            } catch (e) {
                console.warn("Error fetching attendance list:", e);
            }

            renderTableHistory(allStudentAttendance);
            calculateOverview(allStudentAttendance);

        } catch (error) {
            console.error("Error fetching details:", error);
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">Error loading data from Firebase.</td></tr>`;
            }
        }
    }

    function renderTableHistory(records) {
        if (!tableBody) return;

        if (!records || records.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center;">No attendance history found.</td></tr>`;
            return;
        }

        tableBody.innerHTML = "";
        records.forEach(item => {
            let statusClass = "present";
            let statusText = item.status || "Present";
            const lowerStatus = statusText.toLowerCase();

            if (lowerStatus.includes("late")) {
                statusClass = "late";
            } else if (lowerStatus === "absent") {
                statusClass = "absent";
            } else if (lowerStatus === "rejected") {
                statusClass = "rejected";
            } else if (lowerStatus === "excused") {
                statusClass = "excused";
            }

            const row = document.createElement("tr");
            if (lowerStatus === 'rejected') row.classList.add("supervisor-rejected-row");
            row.setAttribute("data-doc-id", item.id);

            row.innerHTML = `
                <td>${item.formattedDate || item.date || 'N/A'}</td>
                <td>${item.day || '-'}</td>
                <td class="${lowerStatus === 'rejected' ? 'text-rejected' : 'text-green'}">${item.timeIn || '--'}</td>
                <td class="${lowerStatus === 'rejected' ? 'text-rejected' : 'text-green'}">${item.timeOut || '--'}</td>
                <td>${item.todayHours || (item.hoursRendered ? item.hoursRendered + ' hrs' : '0h 0m')}</td>
                <td><span class="status ${statusClass}">${statusText}</span></td>
                <td>${item.remarks || '-'}</td>
                <td>
                    <div class="action-menu">
                        <button type="button" class="action-menu-toggle" title="More actions">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>

                        <div class="action-dropdown">
                            <button type="button" class="action-btn edit-btn" title="Edit attendance">
                                <i class="fa-solid fa-pen-to-square"></i>
                                <span>Edit</span>
                            </button>

                            <button type="button" class="action-btn excuse-btn" title="Excuse student for this day">
                                <i class="fa-solid fa-user-check"></i>
                                <span>Excuse</span>
                            </button>

                            <button type="button" class="action-btn reject-btn" title="Reject attendance">
                                <i class="fa-solid fa-xmark"></i>
                                <span>Reject</span>
                            </button>
                        </div>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        });

        const recordsInfo = document.querySelector(".records-info");
        if (recordsInfo) {
            recordsInfo.textContent = `Showing 1 to ${records.length} of ${records.length} records`;
        }
    }

    function calculateOverview(records) {
        let totalMinutes = 0;
        let presentCount = 0;
        let lateCount = 0;
        let absentCount = 0;
        const totalRecords = records.length;

        records.forEach(r => {
            const status = (r.status || "").toLowerCase();
            if (status.includes("present") || status.includes("on-time") || status === "adjusted") presentCount++;
            else if (status.includes("late")) lateCount++;
            else if (status.includes("absent")) absentCount++;

            if (r.todayHours) {
                const matchHours = r.todayHours.match(/(\d+)\s*h/i);
                const matchMins = r.todayHours.match(/(\d+)\s*m/i);
                if (matchHours) totalMinutes += parseInt(matchHours[1]) * 60;
                if (matchMins) totalMinutes += parseInt(matchMins[1]);
            } else if (r.timeIn && r.timeOut && r.timeOut !== "--") {
                // Same fallback as student_dashboard.js: recreate the net
                // (1hr break deducted) minutes for older records saved
                // before todayHours existed, instead of silently counting
                // them as 0 like this page used to.
                const rawHours = calculateHoursFromTime(r.timeIn, r.timeOut);
                totalMinutes += Math.max(0, Math.round(rawHours * 60) - 60);
            } else if (r.hoursRendered) {
                totalMinutes += parseFloat(r.hoursRendered) * 60;
            }
        });

        const finalHours = Math.floor(totalMinutes / 60);
        const finalMins = totalMinutes % 60;

        const totalHoursEl = document.getElementById("totalRenderedHours");
        if (totalHoursEl) totalHoursEl.textContent = `${finalHours}h ${finalMins}m`;

        const presentPct = totalRecords > 0 ? ((presentCount / totalRecords) * 100).toFixed(1) : 0;
        const latePct = totalRecords > 0 ? ((lateCount / totalRecords) * 100).toFixed(1) : 0;
        const absentPct = totalRecords > 0 ? ((absentCount / totalRecords) * 100).toFixed(1) : 0;

        const statBoxes = document.querySelectorAll(".overview-card .stat-box");
        if (statBoxes.length >= 4) {
            if (statBoxes[1].querySelector("h4")) statBoxes[1].querySelector("h4").innerHTML = `${presentCount} <span>(${presentPct}%)</span>`;
            if (statBoxes[2].querySelector("h4")) statBoxes[2].querySelector("h4").innerHTML = `${lateCount} <span>(${latePct}%)</span>`;
            if (statBoxes[3].querySelector("h4")) statBoxes[3].querySelector("h4").innerHTML = `${absentCount} <span>(${absentPct}%)</span>`;
        }
    }

    // Modal Events at Actions
    const editModal = document.getElementById("editAttendanceModal");
    const rejectModal = document.getElementById("rejectAttendanceModal");
    const excuseModal = document.getElementById("excuseAttendanceModal");
    const editAttendanceDate = document.getElementById("editAttendanceDate");
    const excuseAttendanceDate = document.getElementById("excuseAttendanceDate");
    const excuseReason = document.getElementById("excuseReason");
    const editTimeIn = document.getElementById("editTimeIn");
    const editTimeOut = document.getElementById("editTimeOut");
    const saveAttendanceBtn = document.getElementById("saveAttendanceBtn");
    const confirmRejectBtn = document.getElementById("confirmRejectBtn");
    const confirmExcuseBtn = document.getElementById("confirmExcuseBtn");

    let activeDocIdToModify = null;

    // Three-dot action menu
    document.addEventListener("click", function (e) {
        const toggle = e.target.closest(".action-menu-toggle");

        // Close all other menus
        document.querySelectorAll(".action-menu.open").forEach(menu => {
            if (!toggle || !menu.contains(toggle)) {
                menu.classList.remove("open");
            }
        });

        // Open clicked menu
        if (toggle) {
            const menu = toggle.closest(".action-menu");
            if (menu) {
                menu.classList.toggle("open");
            }
        }
    });

    if (tableBody) {
        tableBody.addEventListener("click", function (e) {
            const editBtn = e.target.closest(".edit-btn");
            const rejectBtn = e.target.closest(".reject-btn");
            const excuseBtn = e.target.closest(".excuse-btn");
            const tr = e.target.closest("tr");
            if (tr) {
                activeDocIdToModify = tr.getAttribute("data-doc-id");
            }

            const selectedItem = allStudentAttendance.find(i => i.id === activeDocIdToModify) || currentAttendanceData;

            if (editBtn && selectedItem) {
                if (editAttendanceDate) editAttendanceDate.textContent = selectedItem.formattedDate || selectedItem.date || "—";
                if (editTimeIn) editTimeIn.value = selectedItem.timeIn || "";
                if (editTimeOut) editTimeOut.value = selectedItem.timeOut || "";
                if (editModal) {
                    editModal.classList.add("show");
                    editModal.style.display = "flex";
                }
            }

            if (rejectBtn && selectedItem) {
                if (editAttendanceDate) editAttendanceDate.textContent = selectedItem.formattedDate || selectedItem.date || "—";
                if (rejectModal) {
                    rejectModal.classList.add("show");
                    rejectModal.style.display = "flex";
                }
            }

            if (excuseBtn && selectedItem) {
                if (excuseAttendanceDate) excuseAttendanceDate.textContent = selectedItem.formattedDate || selectedItem.date || "—";
                if (excuseReason) excuseReason.value = "";
                if (excuseModal) {
                    excuseModal.classList.add("show");
                    excuseModal.style.display = "flex";
                }
            }
        });
    }

    if (saveAttendanceBtn) {
        saveAttendanceBtn.addEventListener("click", async function () {
            if (!activeDocIdToModify) return;
            try {
                const attDocRef = doc(db, "attendance", activeDocIdToModify);
                await updateDoc(attDocRef, {
                    timeIn: editTimeIn ? editTimeIn.value : "",
                    timeOut: editTimeOut ? editTimeOut.value : "",
                    status: "Adjusted",
                    remarks: "Time adjusted by Coordinator."
                });
                alert("Attendance updated successfully!");
                if (editModal) { editModal.classList.remove("show"); editModal.style.display = "none"; }
                fetchAttendanceDetails(); 
            } catch (err) {
                console.error("Error updating attendance:", err);
                alert("Failed to update attendance.");
            }
        });
    }

    if (confirmRejectBtn) {
        confirmRejectBtn.addEventListener("click", async function () {
            if (!activeDocIdToModify) return;
            try {
                const attDocRef = doc(db, "attendance", activeDocIdToModify);
                await updateDoc(attDocRef, {
                    status: "Rejected",
                    remarks: "Attendance rejected by Coordinator."
                });
                alert("Attendance marked as rejected.");
                if (rejectModal) { rejectModal.classList.remove("show"); rejectModal.style.display = "none"; }
                fetchAttendanceDetails(); 
            } catch (err) {
                console.error("Error rejecting attendance:", err);
                alert("Failed to reject attendance.");
            }
        });
    }

    if (confirmExcuseBtn) {
        confirmExcuseBtn.addEventListener("click", async function () {
            if (!activeDocIdToModify) return;
            try {
                const reasonText = excuseReason && excuseReason.value.trim()
                    ? excuseReason.value.trim()
                    : "Excused by Coordinator.";

                const attDocRef = doc(db, "attendance", activeDocIdToModify);
                await updateDoc(attDocRef, {
                    status: "Excused",
                    remarks: reasonText
                });
                alert("Student has been excused for this day.");
                if (excuseModal) { excuseModal.classList.remove("show"); excuseModal.style.display = "none"; }
                fetchAttendanceDetails();
            } catch (err) {
                console.error("Error excusing attendance:", err);
                alert("Failed to excuse student.");
            }
        });
    }

    document.querySelectorAll(".modal-overlay, [data-close-modal]").forEach(el => {
        el.addEventListener("click", function () {
            if (editModal) { editModal.classList.remove("show"); editModal.style.display = "none"; }
            if (rejectModal) { rejectModal.classList.remove("show"); rejectModal.style.display = "none"; }
            if (excuseModal) { excuseModal.classList.remove("show"); excuseModal.style.display = "none"; }
        });
    });

    onAuthStateChanged(auth, async (user) => {
        const profileNameEl = document.getElementById("profileName");
        const headerAvatarEl = document.getElementById("headerAvatar");

        if (user) {
            let displayName = user.displayName || user.email || "Coordinator";
            try {
                const loggedUserDoc = await getDoc(doc(db, "users", user.uid));
                if (loggedUserDoc.exists()) {
                    const uData = loggedUserDoc.data();
                    displayName = uData.name || uData.fullName || displayName;
                }
            } catch (e) {
                console.warn("Could not fetch logged-in user profile:", e);
            }

            if (profileNameEl) profileNameEl.textContent = displayName;
            if (headerAvatarEl) headerAvatarEl.textContent = getInitials(displayName);
        }
    });

    fetchAttendanceDetails();
});