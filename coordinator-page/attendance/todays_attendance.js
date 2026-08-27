import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// FIREBASE CONFIGURATION
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

const attendanceRef = collection(db, "attendance");
const usersRef = collection(db, "users");

document.addEventListener("DOMContentLoaded", () => {
    const attendanceTable = document.getElementById("attendanceTable");
    if (!attendanceTable) return;

    const searchInput = document.getElementById("attendanceSearch");
    const sectionFilter = document.getElementById("sectionFilter");
    const statusFilter = document.getElementById("statusFilter");
    const paginationInfo = document.getElementById("paginationInfo");

    let allAttendanceRecords = [];

    // 1. SYNC ANG NAKA-LOGIN NA PROFILE SA SYSTEM (HEADER)
    function syncUserProfile() {
        const profileNameEl = document.getElementById("profileName");
        const profileAvatarEl = document.getElementById("profileAvatar");
        const profileRoleEl = document.getElementById("profileRole");

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const querySnapshot = await getDocs(usersRef);
                    let foundUser = null;
                    
                    querySnapshot.forEach(docSnap => {
                        const data = docSnap.data();
                        if (data.email === user.email || docSnap.id === user.uid) {
                            foundUser = data;
                        }
                    });

                    const displayName = foundUser?.name || foundUser?.fullName || user.displayName || user.email || "Coordinator";
                    const displayRole = foundUser?.role || foundUser?.userType || "OJT Coordinator";

                    if (profileNameEl) profileNameEl.textContent = displayName;
                    if (profileRoleEl) profileRoleEl.textContent = displayRole;

                    if (profileAvatarEl) {
                        const initials = displayName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
                        profileAvatarEl.textContent = initials || "MS";
                    }
                } catch (err) {
                    console.error("Error fetching user profile from Firestore:", err);
                }
            } else {
                const localUser = JSON.parse(localStorage.getItem("loggedInUser")) || JSON.parse(sessionStorage.getItem("loggedInUser"));
                if (localUser) {
                    const name = localUser.name || localUser.email || "Coordinator";
                    if (profileNameEl) profileNameEl.textContent = name;
                    if (profileAvatarEl) {
                        profileAvatarEl.textContent = name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
                    }
                }
            }
        });
    }

    // 2. BILANGIN ANG MGA ESTUDYANTE MULA SA USERS COLLECTION
    async function fetchTotalStudents() {
        try {
            const querySnapshot = await getDocs(usersRef);
            let totalStudentsCount = 0;

            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const role = (data.role || data.userType || "").toLowerCase();
                if (role === "student" || role === "" || !data.role) {
                    totalStudentsCount++;
                }
            });

            const cards = document.querySelectorAll(".attendance-summary .stat-content h3");
            if (cards.length > 0) {
                cards[0].textContent = totalStudentsCount;
            }
        } catch (error) {
            console.error("Error counting total students:", error);
        }
    }

    // 3. KUNIN ANG ATTENDANCE RECORDS AT I-SYNC ANG NAME, SECTION, AT EMAIL MULA SA USERS
    async function fetchAllAttendance() {
        try {
            const usersSnapshot = await getDocs(usersRef);
            const userDetailsMap = {};
            
            usersSnapshot.forEach(userDoc => {
                const userData = userDoc.data();
                const userInfo = {
                    name: userData.name || userData.fullName || "Student User",
                    section: userData.section || "N/A",
                    email: userData.email || ""
                };

                if (userData.email) {
                    userDetailsMap[userData.email.toLowerCase()] = userInfo;
                }
                userDetailsMap[userDoc.id] = userInfo;
            });

            const q = query(attendanceRef, orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);
            
            allAttendanceRecords = [];
            querySnapshot.forEach((docSnap) => {
                const attData = docSnap.data();
                
                let matchedUser = null;
                if (attData.userId && userDetailsMap[attData.userId]) {
                    matchedUser = userDetailsMap[attData.userId];
                } else if (attData.userEmail && userDetailsMap[attData.userEmail.toLowerCase()]) {
                    matchedUser = userDetailsMap[attData.userEmail.toLowerCase()];
                }

                allAttendanceRecords.push({ 
                    id: docSnap.id, 
                    ...attData,
                    userName: matchedUser ? matchedUser.name : (attData.userName || "Student User"),
                    section: matchedUser ? matchedUser.section : (attData.section || "N/A"),
                    userEmail: matchedUser?.email ? matchedUser.email : (attData.userEmail || "No Email Provided")
                });
            });

            filterAndRenderTable();
        } catch (error) {
            console.error("Error fetching attendance and syncing user details:", error);
        }
    }

    function filterAndRenderTable() {
        const keyword = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const sectionVal = sectionFilter ? sectionFilter.value.toLowerCase() : "all sections";
        const statusVal = statusFilter ? statusFilter.value.toLowerCase() : "all status";

        const filtered = allAttendanceRecords.filter(item => {
            const name = (item.userName || "").toLowerCase();
            const email = (item.userEmail || "").toLowerCase();
            const section = (item.section || "").toLowerCase();
            const status = (item.status || "").toLowerCase();

            const matchSearch = name.includes(keyword) || email.includes(keyword);
            const matchSection = sectionVal === "all sections" || section.includes(sectionVal);
            const matchStatus = statusVal === "all status" || status.includes(statusVal);

            return matchSearch && matchSection && matchStatus;
        });

        renderTableRows(filtered);
        updateSummaryCards(allAttendanceRecords);
    }

    function renderTableRows(records) {
        if (records.length === 0) {
            attendanceTable.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #777; padding: 30px;">
                        No attendance records for today yet.
                    </td>
                </tr>
            `;
            if (paginationInfo) paginationInfo.textContent = "Showing 0 to 0 of 0 records";
            return;
        }

        attendanceTable.innerHTML = records.map(item => {
            let statusClass = "present";
            let statusText = item.status || "Present";
            if (statusText.toLowerCase() === "late") statusClass = "late";
            if (statusText.toLowerCase() === "absent") statusClass = "absent";
            if (statusText.toLowerCase() === "active") statusClass = "present";

            return `
                <tr>
                    <td>
                        <strong>${item.userName || "Student User"}</strong><br>
                        <small style="color:#777;">${item.userEmail || "No Email Provided"}</small>
                    </td>
                    <td>BSIT</td>
                    <td>${item.section || "N/A"}</td>
                    <td>${item.timeIn || "--"}</td>
                    <td>${item.timeOut || "--"}</td>
                    <td>${item.todayHours || "0h 0m"}</td>
                    <td><span class="status ${statusClass}">${statusText}</span></td>
                    <td class="actions">
                        <button class="action-btn view-btn" data-id="${item.id}" title="View Details">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        if (paginationInfo) {
            paginationInfo.textContent = `Showing 1 to ${records.length} of ${records.length} records`;
        }
    }

    // Kapag pinindot ang eye icon, ililipat ka sa attendance_details.html dala ang document ID
    document.addEventListener("click", function (event) {
        const viewBtn = event.target.closest(".view-btn");
        if (viewBtn) {
            const studentId = viewBtn.getAttribute("data-id");
            if (studentId) {
                window.location.href = `attendance_details.html?id=${studentId}`;
            }
        }
    });

    function updateSummaryCards(records) {
        let presentCount = 0;
        let lateCount = 0;

        records.forEach(r => {
            const st = (r.status || "").toLowerCase();
            if (st === "present" || st === "completed" || st === "active") presentCount++;
            else if (st === "late") lateCount++;
        });

        const cards = document.querySelectorAll(".attendance-summary .stat-content h3");
        if (cards.length >= 3) {
            cards[1].textContent = presentCount;
            cards[2].textContent = lateCount;
        }
    }

    if (searchInput) searchInput.addEventListener("keyup", filterAndRenderTable);
    if (sectionFilter) sectionFilter.addEventListener("change", filterAndRenderTable);
    if (statusFilter) statusFilter.addEventListener("change", filterAndRenderTable);

    // I-run ang mga function pag-load ng page
    syncUserProfile();
    fetchTotalStudents();
    fetchAllAttendance();
});