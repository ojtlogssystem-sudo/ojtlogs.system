import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    updateDoc,
    setDoc,
    serverTimestamp
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

        if (isNaN(inMinutes) || isNaN(outMinutes)) return 0;
        if (outMinutes <= inMinutes) return 0;
        return (outMinutes - inMinutes) / 60;
    } catch (e) {
        console.error("Error parsing time string:", e);
        return 0;
    }
}

// "07:12 PM" / "19:12" -> "19:12" (para sa <input type="time">). "--:--" -> "".
function toTimeInputValue(str) {
    const m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
    if (!m) return "";
    let h = +m[1];
    const min = m[2];
    const mod = (m[3] || "").toUpperCase();
    if (mod === "PM" && h < 12) h += 12;
    if (mod === "AM" && h === 12) h = 0;
    if (h > 23) return "";
    return String(h).padStart(2, "0") + ":" + min;
}

// "19:12" -> "07:12 PM" (kapareho ng format ng ibang attendance records)
function toDisplayTime(value) {
    const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return value || "";
    let h = +m[1];
    const mod = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return String(h).padStart(2, "0") + ":" + m[2] + " " + mod;
}

// Rejected na record = 0 minuto. Ginagamit ng overview total at ng reject action.
function isRejectedRecord(r) {
    return String((r && r.status) || "").toLowerCase() === "rejected";
}

// Net minutes ng isang attendance record (parehong logic ng student_dashboard.js).
function getRecordMinutes(r) {
    if (!r || isRejectedRecord(r)) return 0;
    let minutes = 0;
    if (r.todayHours) {
        const matchHours = String(r.todayHours).match(/(\d+)\s*h/i);
        const matchMins = String(r.todayHours).match(/(\d+)\s*m/i);
        if (matchHours) minutes += parseInt(matchHours[1]) * 60;
        if (matchMins) minutes += parseInt(matchMins[1]);
    } else if (r.timeIn && r.timeOut && r.timeOut !== "--") {
        const rawHours = calculateHoursFromTime(r.timeIn, r.timeOut);
        minutes = Math.max(0, Math.round(rawHours * 60) - 60);
    } else if (r.hoursRendered) {
        minutes = Math.round((parseFloat(r.hoursRendered) || 0) * 60);
    }
    return minutes;
}

// Kinukuha ang timestamp (ms) ng isang attendance record para magamit sa sorting.
// Sinusuportahan ang ISO "YYYY-MM-DD", "Sep 12, 2026", at Firestore Timestamp.
function getRecordDateValue(r) {
    if (!r) return 0;
    const candidates = [r.date, r.formattedDate, r.createdAt, r.timestamp];
    for (const val of candidates) {
        if (!val) continue;
        if (typeof val.toDate === "function") return val.toDate().getTime();
        if (typeof val === "number") return val;
        const str = String(val).trim();
        const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime();
        const parsed = Date.parse(str);
        if (!isNaN(parsed)) return parsed;
    }
    return 0;
}

// Newest date muna. Palitan ang (b - a) ng (a - b) para oldest muna.
function sortRecordsByDate(records) {
    return [...records].sort((a, b) => getRecordDateValue(b) - getRecordDateValue(a));
}

// ABSENT-HELPERS-START
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(d) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

function parseDateKey(str) {
    const m = String(str || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function getRecordDateKey(r) {
    const v = getRecordDateValue(r);
    return v ? toDateKey(new Date(v)) : null;
}

function getDayLabel(r) {
    const v = getRecordDateValue(r);
    return v ? DAY_NAMES[new Date(v).getDay()] : "-";
}

function timeToMinutes(t) {
    const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
    return m ? (+m[1] * 60 + +m[2]) : null;
}

// Gumagawa ng "Absent" na rows para sa bawat schedule day mula sa OJT start date
// hanggang ngayon na walang attendance record. Hindi isinasama ang future dates.
// Ang ngayong araw ay absent lang kapag lampas na sa oras ng uwi ng schedule.
function buildAbsentRecords(schedule, records, now = new Date()) {
    if (!schedule || !schedule.startDate || !Array.isArray(schedule.days)) return [];
    const start = parseDateKey(schedule.startDate);
    if (!start) return [];

    const scheduledDays = new Set(
        schedule.days
            .map(d => DAY_INDEX[String(d).slice(0, 3).toLowerCase()])
            .filter(i => i !== undefined)
    );
    if (scheduledDays.size === 0) return [];

    // Oras ng uwi: pinakahuling timeOut ng mga naka-enable na session
    const ends = [];
    const morning = schedule.morning || {};
    const afternoon = schedule.afternoon || {};
    if (schedule.morningEnabled !== false && morning.morningEnabled !== false) ends.push(timeToMinutes(morning.timeOut));
    if (schedule.afternoonEnabled !== false && afternoon.afternoonEnabled !== false) ends.push(timeToMinutes(afternoon.timeOut));
    const validEnds = ends.filter(e => e !== null);
    const dayEndMinutes = validEnds.length ? Math.max(...validEnds) : 17 * 60;

    const existing = new Set(records.map(getRecordDateKey).filter(Boolean));
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const result = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
        if (!scheduledDays.has(d.getDay())) continue;
        const isToday = d.getTime() === today.getTime();
        if (isToday && nowMinutes <= dayEndMinutes) continue;
        const key = toDateKey(d);
        if (existing.has(key)) continue;

        result.push({
            id: `virtual-${key}`,
            isVirtual: true,
            date: key,
            formattedDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            day: DAY_NAMES[d.getDay()],
            timeIn: "--:--",
            timeOut: "--:--",
            status: "Absent",
            remarks: "Unexcused Absence"
        });
    }
    return result;
}
// ABSENT-HELPERS-END

// Kapag complete na ang student, hindi na binibilang ang Absent pagkatapos
// ng huling araw na nag-Time In siya.
function dropAbsentsAfterCompletion(records, userData) {
    const hasTimeIn = r => !!r && !!r.timeIn && r.timeIn !== "--";

    let lastTimeIn = "";
    let totalHours = 0;

    records.forEach(r => {
        if (!hasTimeIn(r)) return;
        const key = getRecordDateKey(r);
        if (key && key > lastTimeIn) lastTimeIn = key;

        const status = String(r.status || "").toLowerCase();
        if (status !== "rejected" && status !== "absent") {
            totalHours += Number(r.hoursRendered) || 0;
        }
    });

    if (!lastTimeIn) return records;

    const u = userData || {};
    const statusText = String(u.internshipStatus || u.status || "").trim().toLowerCase();
    const required = Number(u.requiredHours || u.totalRequiredHours || 600) || 600;
    const rendered = Number(u.renderedHours || u.completedHours || u.hoursRendered || 0) || 0;

    const isComplete =
        statusText === "completed" ||
        statusText.includes("graduated") ||
        rendered >= required ||
        totalHours >= required;

    if (!isComplete) return records;

    return records.filter(r => {
        const isAbsent = String(r.status || "").toLowerCase() === "absent";
        if (!isAbsent || hasTimeIn(r)) return true;
        const key = getRecordDateKey(r);
        return !key || key <= lastTimeIn;
    });
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
    let currentStudent = { uid: null, email: "", name: "" };

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

            currentStudent = { uid: targetUserId, email: studentEmail, name: studentName };

            // Idagdag ang mga araw na dapat pumasok pero walang record (Absent)
            const absentRecords = buildAbsentRecords(matchedUser?.schedule, allStudentAttendance);
            allStudentAttendance = [...allStudentAttendance, ...absentRecords];

            // Complete na ang student (status Completed o abot na sa required hours):
            // tanggalin ang mga Absent na lampas sa huling araw ng Time In niya.
            allStudentAttendance = dropAbsentsAfterCompletion(allStudentAttendance, matchedUser);

            updateTableView();
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
            const emptyMsg = hasActiveFilters() ? "No records match the selected filters." : "No attendance history found.";
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center;">${emptyMsg}</td></tr>`;
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
                <td>${item.day || getDayLabel(item)}</td>
                <td class="${lowerStatus === 'rejected' ? 'text-rejected' : 'text-green'}">${item.timeIn || '--'}</td>
                <td class="${lowerStatus === 'rejected' ? 'text-rejected' : 'text-green'}">${item.timeOut || '--'}</td>
                <td>${lowerStatus === 'rejected' ? '0h 0m' : (item.todayHours || (item.hoursRendered ? item.hoursRendered + ' hrs' : '0h 0m'))}</td>
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
            // Walang dapat i-reject sa araw na hindi pumasok
            if (item.isVirtual) row.querySelector(".reject-btn")?.remove();
            tableBody.appendChild(row);
        });
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

            totalMinutes += getRecordMinutes(r);
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

    // ==========================================
    // FILTERS + PAGINATION
    // ==========================================
    const statusFilterEl = document.getElementById("statusFilter");
    const rowsPerPageEl = document.getElementById("rowsPerPage");
    const paginationEl = document.getElementById("pagination");
    const dateRangeInput = document.getElementById("dateRangePicker");

    let statusFilter = "all";
    let dateRange = null; // { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
    let currentPage = 1;
    let rowsPerPage = parseInt(rowsPerPageEl && rowsPerPageEl.value, 10) || 10;

    function hasActiveFilters() {
        return statusFilter !== "all" || !!dateRange;
    }

    function matchesStatus(item) {
        if (statusFilter === "all") return true;
        const s = String(item.status || "Present").toLowerCase();
        if (statusFilter === "present") return s.includes("present") || s.includes("on-time");
        if (statusFilter === "late") return s.includes("late");
        if (statusFilter === "adjusted") return s === "adjusted" || !!item.adjustedAt;
        return s === statusFilter;
    }

    function matchesDateRange(item) {
        if (!dateRange) return true;
        const key = getRecordDateKey(item);
        return !!key && key >= dateRange.from && key <= dateRange.to;
    }

    function renderPagination(totalPages) {
        if (!paginationEl) return;
        paginationEl.innerHTML = "";

        const addBtn = (html, page, opts = {}) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "page-btn" + (opts.active ? " active" : "");
            b.innerHTML = html;
            b.disabled = !!opts.disabled;
            if (!opts.disabled) {
                b.addEventListener("click", () => {
                    currentPage = page;
                    updateTableView();
                });
            }
            paginationEl.appendChild(b);
        };

        let end = Math.min(totalPages, Math.max(1, currentPage - 2) + 4);
        let start = Math.max(1, end - 4);

        addBtn('<i class="fa-solid fa-chevron-left"></i>', currentPage - 1, { disabled: currentPage <= 1 });
        for (let p = start; p <= end; p++) {
            addBtn(String(p), p, { active: p === currentPage });
        }
        addBtn('<i class="fa-solid fa-chevron-right"></i>', currentPage + 1, { disabled: currentPage >= totalPages });
    }

    // Sort -> filter -> hatiin sa pages -> i-render
    function updateTableView() {
        const filtered = sortRecordsByDate(allStudentAttendance)
            .filter(item => matchesStatus(item) && matchesDateRange(item));

        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
        currentPage = Math.min(Math.max(1, currentPage), totalPages);

        const startIdx = (currentPage - 1) * rowsPerPage;
        const pageItems = filtered.slice(startIdx, startIdx + rowsPerPage);

        renderTableHistory(pageItems);

        const recordsInfo = document.querySelector(".records-info");
        if (recordsInfo) {
            recordsInfo.textContent = total === 0
                ? "Showing 0 of 0 records"
                : `Showing ${startIdx + 1} to ${startIdx + pageItems.length} of ${total} records`;
        }

        renderPagination(totalPages);
    }

    if (statusFilterEl) {
        statusFilterEl.addEventListener("change", () => {
            statusFilter = statusFilterEl.value;
            currentPage = 1;
            updateTableView();
        });
    }

    if (rowsPerPageEl) {
        rowsPerPageEl.addEventListener("change", () => {
            rowsPerPage = parseInt(rowsPerPageEl.value, 10) || 10;
            currentPage = 1;
            updateTableView();
        });
    }

    // ==========================================
    // FILTER BUTTON (popover)
    // Ang #statusFilter ay nasa loob na ng Filter popover - ang
    // existing filter logic sa itaas ang gumagana pa rin.
    // ==========================================
    (function initFilterMenu() {
        const filterBtn = document.getElementById("filterBtn");
        const filterPopover = document.getElementById("filterPopover");
        const filterBadge = document.getElementById("filterBadge");
        const resetBtn = document.getElementById("resetFilterBtn");

        if (!filterBtn || !filterPopover) return;

        const close = () => {
            filterPopover.classList.remove("open");
            filterBtn.setAttribute("aria-expanded", "false");
        };

        filterBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const willOpen = !filterPopover.classList.contains("open");
            close();
            if (willOpen) {
                filterPopover.classList.add("open");
                filterBtn.setAttribute("aria-expanded", "true");
            }
        });

        filterPopover.addEventListener("click", (e) => e.stopPropagation());
        document.addEventListener("click", close);
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") close();
        });

        // Badge: ilan ang active na filter
        const updateBadge = () => {
            if (!filterBadge) return;
            const count = statusFilter !== "all" ? 1 : 0;
            filterBadge.textContent = count;
            filterBadge.hidden = count === 0;
        };

        if (statusFilterEl) statusFilterEl.addEventListener("change", updateBadge);

        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                statusFilter = "all";
                if (statusFilterEl) statusFilterEl.value = "all";
                currentPage = 1;
                updateBadge();
                updateTableView();
            });
        }

        updateBadge();
    })();

    if (dateRangeInput && typeof window.flatpickr === "function") {
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "date-clear";
        clearBtn.title = "Clear dates";
        clearBtn.innerHTML = "&times;";
        dateRangeInput.insertAdjacentElement("afterend", clearBtn);

        const picker = window.flatpickr(dateRangeInput, {
            mode: "range",
            dateFormat: "M j, Y",
            onChange: (dates) => {
                if (dates.length === 0) {
                    dateRange = null;
                    clearBtn.style.display = "none";
                } else {
                    // Isang petsa lang ang napili = isang araw lang muna ang ipapakita
                    dateRange = {
                        from: toDateKey(dates[0]),
                        to: toDateKey(dates[dates.length - 1])
                    };
                    clearBtn.style.display = "block";
                }
                currentPage = 1;
                updateTableView();
            }
        });

        clearBtn.addEventListener("click", () => picker.clear());

        const calIcon = dateRangeInput.parentElement.querySelector(".fa-calendar");
        if (calIcon) calIcon.addEventListener("click", () => picker.open());
    }

    // Kapag Edit/Excuse sa "virtual" absent row, gagawa muna ng totoong
    // attendance document sa Firestore para may ma-update.
    async function ensureAttendanceDoc(item) {
        if (!item) throw new Error("Attendance record not found.");
        if (!item.isVirtual) return item.id;
        if (!currentStudent.uid) throw new Error("Student ID not found.");
        const newId = `${currentStudent.uid}_${item.date}`;
        await setDoc(doc(db, "attendance", newId), {
            userId: currentStudent.uid,
            userEmail: currentStudent.email,
            userName: currentStudent.name,
            date: item.date,
            formattedDate: item.formattedDate,
            day: item.day,
            timeIn: "--:--",
            timeOut: "--:--",
            status: "Absent",
            remarks: "Unexcused Absence",
            createdAt: serverTimestamp()
        }, { merge: true });
        return newId;
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
    const editReason = document.getElementById("editReason");
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
                if (editTimeIn) editTimeIn.value = toTimeInputValue(selectedItem.timeIn);
                if (editTimeOut) editTimeOut.value = toTimeInputValue(selectedItem.timeOut);
                if (editReason) editReason.value = "";
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

            const newIn = editTimeIn ? editTimeIn.value : "";
            const newOut = editTimeOut ? editTimeOut.value : "";
            const reason = editReason ? editReason.value.trim() : "";

            if (!newIn || !newOut) {
                alert("Please enter both Time In and Time Out.");
                return;
            }
            if (newOut <= newIn) {
                alert("Time Out must be later than Time In.");
                return;
            }

            try {
                const editedItem = allStudentAttendance.find(i => i.id === activeDocIdToModify);
                const attDocRef = doc(db, "attendance", await ensureAttendanceDoc(editedItem));

                const timeInText = toDisplayTime(newIn);
                const timeOutText = toDisplayTime(newOut);

                // Net hours: ibabawas ang 1hr break kapag lampas 5 hours ang shift
                const rawMinutes = Math.round(calculateHoursFromTime(timeInText, timeOutText) * 60);
                const netMinutes = Math.max(0, rawMinutes > 300 ? rawMinutes - 60 : rawMinutes);
                const todayHoursText = `${Math.floor(netMinutes / 60)}h ${netMinutes % 60}m`;

                const hadPrevious = editedItem && editedItem.adjustedAt;

                const editUpdates = {
                    timeIn: timeInText,
                    timeOut: timeOutText,
                    todayHours: todayHoursText,
                    hoursRendered: Number((netMinutes / 60).toFixed(2)),
                    // Kapag na-adjust ang oras, lalabas na Present / On-Time (kapareho ng normal na time in).
                    // Nakatabi pa rin ang adjustedAt/adjustmentReason para may audit trail.
                    status: "Present",
                    remarks: "On-Time / Present",
                    adjustedAt: serverTimestamp(),
                    adjustedBy: (auth.currentUser && auth.currentUser.uid) || null,
                    adjustmentReason: reason
                };

                // Itabi ang orihinal na record (isang beses lang) para may audit trail
                if (!hadPrevious && editedItem) {
                    editUpdates.previousStatus = editedItem.status || "";
                    editUpdates.previousTimeIn = editedItem.timeIn || "";
                    editUpdates.previousTimeOut = editedItem.timeOut || "";
                    editUpdates.previousTodayHours = editedItem.todayHours || "";
                }

                await updateDoc(attDocRef, editUpdates);
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
                const rejectedItem = allStudentAttendance.find(i => i.id === activeDocIdToModify);

                // Nare-reject na dati - huwag nang ulitin (mao-overwrite ang orihinal na oras).
                if (isRejectedRecord(rejectedItem)) {
                    alert("This attendance is already rejected.");
                    if (rejectModal) { rejectModal.classList.remove("show"); rejectModal.style.display = "none"; }
                    return;
                }

                // Ilang minuto ang ibabawas sa total ng estudyante
                const deductedMinutes = getRecordMinutes(rejectedItem);

                const attDocRef = doc(db, "attendance", activeDocIdToModify);
                await updateDoc(attDocRef, {
                    status: "Rejected",
                    remarks: "Attendance rejected by Coordinator.",
                    // Naka-zero ang oras ng araw na ito; nakatabi ang orihinal
                    // para maibalik kung ie-edit ulit ng coordinator.
                    originalTodayHours: (rejectedItem && rejectedItem.todayHours) ?? null,
                    originalHoursRendered: (rejectedItem && rejectedItem.hoursRendered) ?? null,
                    todayHours: "0h 0m (Rejected)",
                    hoursRendered: 0,
                    // Ginagamit ng notification bell ng estudyante
                    rejectedMinutes: deductedMinutes,
                    rejectedAt: serverTimestamp(),
                    rejectedBy: (auth.currentUser && auth.currentUser.uid) || null
                });
                alert("Attendance rejected. The student has been notified and the hours were deducted.");
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

                const excusedItem = allStudentAttendance.find(i => i.id === activeDocIdToModify);
                const attDocRef = doc(db, "attendance", await ensureAttendanceDoc(excusedItem));
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