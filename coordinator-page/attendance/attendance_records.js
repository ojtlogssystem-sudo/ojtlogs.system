import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    doc, 
    getDoc 
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

document.addEventListener("DOMContentLoaded", () => {
    const attendanceTable = document.getElementById("attendanceTable");
    const searchInput = document.getElementById("attendanceSearch");
    const sectionFilter = document.getElementById("sectionFilter");
    const statusFilter = document.getElementById("statusFilter");
    const paginationInfo = document.getElementById("paginationInfo");

    let allRecords = [];
    let usersMap = {};

    function getInitials(name) {
        if (!name || typeof name !== 'string') return 'MS';
        const words = name.trim().split(/\s+/);
        if (words.length === 1) return words[0].charAt(0).toUpperCase();
        return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    }

    async function loadAttendanceRecords() {
        if (!attendanceTable) return;

        try {
            // 1. Kukunin ang lahat ng Users para sa Student Info
            const usersSnapshot = await getDocs(collection(db, "users"));
            usersSnapshot.forEach(uDoc => {
                usersMap[uDoc.id] = { id: uDoc.id, ...uDoc.data() };
            });

            // 2. Kukunin ang lahat ng Attendance Logs
            const attendanceSnapshot = await getDocs(collection(db, "attendance"));
            allRecords = [];

            const sectionsSet = new Set();

            attendanceSnapshot.forEach(docSnap => {
                const data = docSnap.data();
                const userId = data.userId;
                
                let userDetail = usersMap[userId];
                if (!userDetail && data.userEmail) {
                    userDetail = Object.values(usersMap).find(
                        u => u.email && u.email.toLowerCase() === data.userEmail.toLowerCase()
                    );
                }

                const studentName = userDetail?.name || userDetail?.fullName || data.userName || "Unknown Student";
                const studentEmail = userDetail?.email || data.userEmail || "No Email";
                
                // --- KINUHA ANG COURSE AT SECTION MULA SA FIREBASE ---
                const courseVal = userDetail?.course || data.course || "";
                const sectionVal = userDetail?.section || data.section || "";
                
                let courseSection = "N/A";
                if (courseVal && sectionVal) {
                    courseSection = `${courseVal} ${sectionVal}`;
                } else if (courseVal) {
                    courseSection = courseVal;
                } else if (sectionVal) {
                    courseSection = sectionVal;
                }

                const company = userDetail?.companyName || userDetail?.company || data.company || "N/A";

                if (courseSection !== "N/A") {
                    sectionsSet.add(courseSection);
                }

                allRecords.push({
                    id: docSnap.id,
                    userId: userId || userDetail?.id,
                    date: data.formattedDate || data.date || "N/A",
                    studentName: studentName,
                    studentEmail: studentEmail,
                    courseSection: courseSection,
                    company: company,
                    timeIn: data.timeIn || "--:--",
                    timeOut: data.timeOut || "--:--",
                    totalHours: data.todayHours || (data.hoursRendered ? `${data.hoursRendered} hrs` : "0h 0m"),
                    status: data.status || "Present",
                    rawTimestamp: data.timestamp || 0
                });
            });

            // Populate Filter Dropdown Dynamically
            if (sectionFilter) {
                sectionFilter.innerHTML = `<option value="All Sections">All Course & Sections</option>`;
                sectionsSet.forEach(sec => {
                    sectionFilter.innerHTML += `<option value="${sec}">${sec}</option>`;
                });
            }

            renderRecords(allRecords);

        } catch (error) {
            console.error("Error loading attendance records:", error);
            attendanceTable.innerHTML = `<tr><td colspan="9" style="text-align: center; color: red;">Error loading data from database.</td></tr>`;
        }
    }

    function renderRecords(records) {
        if (!attendanceTable) return;

        if (records.length === 0) {
            attendanceTable.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px;">No attendance records found.</td></tr>`;
            if (paginationInfo) paginationInfo.textContent = "Showing 0 of 0 records";
            return;
        }

        attendanceTable.innerHTML = "";

        records.forEach(item => {
            let statusClass = "present";
            const lowerStatus = (item.status || "").toLowerCase();

            if (lowerStatus.includes("late")) {
                statusClass = "late";
            } else if (lowerStatus.includes("absent")) {
                statusClass = "absent";
            } else if (lowerStatus.includes("reject")) {
                statusClass = "rejected";
            }

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${item.date}</td>
                <td>
                    <strong>${item.studentName}</strong><br>
                    <small style="color:#777;">${item.studentEmail}</small>
                </td>
                <td>${item.courseSection}</td>
                <td>${item.company}</td>
                <td>${item.timeIn}</td>
                <td>${item.timeOut}</td>
                <td>${item.totalHours}</td>
                <td><span class="status ${statusClass}">${item.status}</span></td>
                <td class="actions">
                    <button class="action-btn view-btn" data-id="${item.userId || item.id}" title="View Details">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </td>
            `;
            attendanceTable.appendChild(tr);
        });

        if (paginationInfo) {
            paginationInfo.textContent = `Showing 1 to ${records.length} of ${records.length} records`;
        }

        document.querySelectorAll(".view-btn").forEach(btn => {
            btn.addEventListener("click", function () {
                const targetId = this.getAttribute("data-id");
                window.location.href = `attendance_details.html?id=${targetId}`;
            });
        });
    }

    function filterAttendance() {
        const keyword = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const section = sectionFilter ? sectionFilter.value.toLowerCase() : "all sections";
        const status = statusFilter ? statusFilter.value.toLowerCase() : "all status";

        const filtered = allRecords.filter(item => {
            const matchKeyword = item.studentName.toLowerCase().includes(keyword) || 
                                 item.studentEmail.toLowerCase().includes(keyword) ||
                                 item.company.toLowerCase().includes(keyword);

            const matchSection = section === "all sections" || item.courseSection.toLowerCase() === section;
            const matchStatus = status === "all status" || item.status.toLowerCase().includes(status);

            return matchKeyword && matchSection && matchStatus;
        });

        renderRecords(filtered);
    }

    if (searchInput) searchInput.addEventListener("keyup", filterAttendance);
    if (sectionFilter) sectionFilter.addEventListener("change", filterAttendance);
    if (statusFilter) statusFilter.addEventListener("change", filterAttendance);

    onAuthStateChanged(auth, async (user) => {
        const profileNameEl = document.getElementById("profileName");
        const headerAvatarEl = document.getElementById("headerAvatar");

        if (user) {
            let name = user.displayName || user.email || "Coordinator";
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    name = userDoc.data().name || userDoc.data().fullName || name;
                }
            } catch (e) {
                console.warn(e);
            }
            if (profileNameEl) profileNameEl.textContent = name;
            if (headerAvatarEl) headerAvatarEl.textContent = getInitials(name);
        }
    });

    loadAttendanceRecords();
});