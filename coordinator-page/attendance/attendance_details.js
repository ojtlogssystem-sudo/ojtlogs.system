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

// Generates First Initial + Last Initial (e.g., "Mark Daniel Beato" -> "MB")
function getInitials(name) {
    if (!name || typeof name !== 'string') return 'MB';
    
    const cleanName = name.replace(/\b[A-Za-z]\.\b/g, '').trim();
    const words = cleanName.split(/\s+/).filter(w => w.length > 0);
    
    if (words.length === 0) return 'MB';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    
    const firstInitial = words[0].charAt(0);
    const lastInitial = words[words.length - 1].charAt(0);
    
    return (firstInitial + lastInitial).toUpperCase();
}

document.addEventListener("DOMContentLoaded", () => {
    const tableBody = document.querySelector(".history-table tbody");

    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get("id");

    let currentAttendanceData = null;
    let allStudentAttendance = [];

    async function fetchAttendanceDetails() {
        try {
            let matchedUser = null;
            let targetUserId = paramId;

            if (paramId) {
                // 1. Subukang i-check kung direct User Document ID ito
                const userDocRef = doc(db, "users", paramId);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                    matchedUser = userDocSnap.data();
                } else {
                    // 2. Kung Attendance Document ID pala ito
                    const attDocRef = doc(db, "attendance", paramId);
                    const attDocSnap = await getDoc(attDocRef);

                    if (attDocSnap.exists()) {
                        currentAttendanceData = { id: attDocSnap.id, ...attDocSnap.data() };
                        targetUserId = currentAttendanceData.userId;

                        if (targetUserId) {
                            const uSnap = await getDoc(doc(db, "users", targetUserId));
                            if (uSnap.exists()) matchedUser = uSnap.data();
                        }
                    }
                }
            }

            // Fallback Search via User Email kung hindi nahanap sa ID
            if (!matchedUser && currentAttendanceData?.userEmail) {
                const usersSnapshot = await getDocs(usersRef);
                usersSnapshot.forEach(uDoc => {
                    const uData = uDoc.data();
                    if (uData.email && uData.email.toLowerCase() === currentAttendanceData.userEmail.toLowerCase()) {
                        matchedUser = uData;
                    }
                });
            }

            // Gamitin ang totoong values mula sa database o fallback sa defaults
            const studentName = matchedUser?.name || matchedUser?.fullName || currentAttendanceData?.userName || "Mark Daniel Beato";
            const studentCompany = matchedUser?.companyName || matchedUser?.company || currentAttendanceData?.company || "Cloudstaff";
            const studentEmail = matchedUser?.email || currentAttendanceData?.userEmail || "beatosenku@gmail.com";
            const studentIdVal = matchedUser?.studentNumber || matchedUser?.uid || targetUserId || "2023-08-01448";

            // --- KINUHA ANG COURSE AT SECTION MULA SA FIREBASE ---
            const studentCourse = matchedUser?.course || currentAttendanceData?.course || "";
            const studentSection = matchedUser?.section || currentAttendanceData?.section || "";
            
            let fullCourseSection = "N/A";
            if (studentCourse && studentSection) {
                fullCourseSection = `${studentCourse} - ${studentSection}`;
            } else if (studentCourse) {
                fullCourseSection = studentCourse;
            } else if (studentSection) {
                fullCourseSection = studentSection;
            }

            // --- FETCH SUPERVISOR NAME MULA SA COMPANIES COLLECTION ---
            let studentSupervisor = matchedUser?.supervisor || matchedUser?.supervisorName || currentAttendanceData?.supervisor;

            if (!studentSupervisor && studentCompany) {
                try {
                    const companiesRef = collection(db, "companies");
                    const compSnapshot = await getDocs(companiesRef);
                    
                    compSnapshot.forEach(compDoc => {
                        const cData = compDoc.data();
                        if (cData.companyName && cData.companyName.toLowerCase() === studentCompany.toLowerCase()) {
                            studentSupervisor = cData.supervisorName || cData.supervisor;
                        }
                    });
                } catch (cErr) {
                    console.warn("Could not fetch supervisor from companies collection:", cErr);
                }
            }

            if (!studentSupervisor) {
                studentSupervisor = "Not Assigned";
            }

            // Update Name at Profile Circle Avatar
            const nameHeading = document.getElementById("profileNameHeading");
            if (nameHeading) nameHeading.textContent = studentName;

            const profileAvatarCircle = document.getElementById("profileAvatarCircle");
            if (profileAvatarCircle) {
                profileAvatarCircle.textContent = getInitials(studentName);
            }

            // Update Student Details List
            if (document.getElementById("infoSection")) document.getElementById("infoSection").textContent = fullCourseSection;
            if (document.getElementById("infoCompany")) document.getElementById("infoCompany").textContent = studentCompany;
            if (document.getElementById("infoStudentId")) document.getElementById("infoStudentId").textContent = studentIdVal;
            if (document.getElementById("infoEmail")) document.getElementById("infoEmail").textContent = studentEmail;
            if (document.getElementById("infoSupervisor")) document.getElementById("infoSupervisor").textContent = studentSupervisor;

            // Fetch History Table
            try {
                const allAttSnapshot = await getDocs(attendanceRef);
                allStudentAttendance = [];

                allAttSnapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    const isSameUserId = targetUserId && data.userId === targetUserId;
                    const isSameEmail = studentEmail && data.userEmail && (data.userEmail.toLowerCase() === studentEmail.toLowerCase());

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
                    <div class="action-buttons">
                        <button type="button" class="action-btn edit-btn" title="Edit attendance"><i class="fa-solid fa-pen-to-square"></i><span>Edit</span></button>
                        <button type="button" class="action-btn reject-btn" title="Reject attendance"><i class="fa-solid fa-xmark"></i><span>Reject</span></button>
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

    // Modal Events
    const editModal = document.getElementById("editAttendanceModal");
    const rejectModal = document.getElementById("rejectAttendanceModal");
    const editAttendanceDate = document.getElementById("editAttendanceDate");
    const editTimeIn = document.getElementById("editTimeIn");
    const editTimeOut = document.getElementById("editTimeOut");
    const saveAttendanceBtn = document.getElementById("saveAttendanceBtn");
    const confirmRejectBtn = document.getElementById("confirmRejectBtn");

    let activeDocIdToModify = null;

    if (tableBody) {
        tableBody.addEventListener("click", function (e) {
            const editBtn = e.target.closest(".edit-btn");
            const rejectBtn = e.target.closest(".reject-btn");
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

    document.querySelectorAll(".modal-overlay, [data-close-modal]").forEach(el => {
        el.addEventListener("click", function () {
            if (editModal) { editModal.classList.remove("show"); editModal.style.display = "none"; }
            if (rejectModal) { rejectModal.classList.remove("show"); rejectModal.style.display = "none"; }
        });
    });

    // Update Logged-In User Header Profile Icon
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