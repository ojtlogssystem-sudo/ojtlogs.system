import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query,
    where,
    onSnapshot,
    getDocs,
    doc,
    getDoc,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);

// Global state variables
let currentUserId = null;
let canSubmit = false;          // false para sa coordinator / kapag tinitingnan ang report ng ibang estudyante
let allLogs = [];               // LAHAT ng attendance ng estudyante (galing sa Firestore)
let currentLogs = [];           // attendance ng NAPILING LINGGO lang (ito ang lumalabas sa form at sine-submit)
let calculatedTotalHours = 0;   // total ng napiling linggo, sa decimal hours
let selectedWeekStart = null;   // Monday ng napiling linggo (Date, local midnight)
let renderToken = 0;            // pang-iwas sa "race" kapag mabilis magpalit ng linggo

document.addEventListener("DOMContentLoaded", () => {
    // 1. Kuhanin ang studentId (at optional na week) mula sa URL parameters
    //    ?studentId=...   -> report ng isang estudyante (coordinator view)
    //    ?week=YYYY-MM-DD -> anumang petsa sa linggong gustong buksan
    const urlParams = new URLSearchParams(window.location.search);
    const targetStudentId = urlParams.get("studentId");
    const weekParam = urlParams.get("week");

    const initialDate = parseDateStr(weekParam) || new Date();
    selectedWeekStart = getWeekStart(initialDate);

    const submitBtn = document.getElementById("btn-submit-report");
    const backBtn = document.getElementById("btn-back-report"); // Dynamic Back Button

    setupWeekNavigation();
    updateWeekHeader();

    onAuthStateChanged(auth, async (user) => {
        const tableBody = document.getElementById("report-table-body");
        if (!user) {
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">
                            Please log in to view your report.
                        </td>
                    </tr>
                `;
            }
            return;
        }

        // 2. Suriin ang role ng naka-login na user sa Firestore
        let isCoordinator = false;
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
                const role = userDocSnap.data().role || "";
                if (role.toLowerCase() === "coordinator") {
                    isCoordinator = true;
                }
            }
        } catch (err) {
            console.error("Error fetching user role:", err);
        }

        // 3. TUKUYIN ANG DAPAT I-LOAD NA USER ID:
        const activeStudentUid = targetStudentId || user.uid;
        currentUserId = activeStudentUid;
        await loadStudentReportInformation(activeStudentUid);

        // 4. ITAGO ANG SUBMIT REPORT BUTTON SA COORDINATOR
        canSubmit = !(isCoordinator || targetStudentId);
        if (submitBtn) {
            submitBtn.style.display = canSubmit ? "flex" : "none";
        }

        // 5. SETUP DYNAMIC BACK BUTTON NAVIGATION
        if (backBtn) {
            backBtn.addEventListener("click", (e) => {
                e.preventDefault();

                // Kapag nakabukas bilang popup (iframe) sa coordinator
                // dashboard, isara lang ang popup imbes na mag-redirect.
                if (window.parent !== window) {
                    window.parent.postMessage(
                        { type: "closeWeeklyReportModal" },
                        window.location.origin
                    );
                    return;
                }

                if (isCoordinator || targetStudentId) {
                    window.location.href = "/coordinator-page/dashboard/dashboard.html";
                } else {
                    window.location.href = "/student-page/tasks/tasks.html";
                }
            });
        }

        // Load Report Data mula sa Firestore
        loadAccomplishmentReport(activeStudentUid);
    });

    // Event Listener sa Submit Button
    if (submitBtn) {
        submitBtn.addEventListener("click", submitWeeklyReport);
    }
});

// ========================================
// WEEK HELPERS  (Monday - Sunday)
// ========================================
function pad2(n) {
    return String(n).padStart(2, "0");
}

// Date -> "YYYY-MM-DD" (local time, hindi UTC, para hindi magkamali ng araw)
function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "YYYY-MM-DD" -> Date (local midnight). null kung hindi valid.
function parseDateStr(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || "").trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
}

function addDays(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
}

// Monday ng linggo kung saan nabibilang ang petsa
function getWeekStart(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay(); // 0 = Sunday
    x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
    return x;
}

function formatWeekRange(start, end) {
    const short = { month: "short", day: "numeric" };
    const full = { month: "short", day: "numeric", year: "numeric" };
    const s = start.toLocaleDateString("en-US", start.getFullYear() !== end.getFullYear() ? full : short);
    const e = end.toLocaleDateString("en-US", full);
    return `${s} \u2013 ${e}`;
}

// Petsa ng isang attendance record bilang "YYYY-MM-DD"
function getLogDateStr(log) {
    if (parseDateStr(log.date)) return String(log.date).trim();
    if (log.createdAt?.toDate) return toDateStr(log.createdAt.toDate());
    return null;
}

function getSelectedWeekBounds() {
    const start = selectedWeekStart;
    const end = addDays(start, 6);
    return { start, end, startStr: toDateStr(start), endStr: toDateStr(end) };
}

function updateWeekHeader() {
    const { start, end } = getSelectedWeekBounds();
    const rangeText = formatWeekRange(start, end);

    const labelEl = document.getElementById("week-label");
    if (labelEl) labelEl.textContent = rangeText;

    // Ang "Date:" sa form ay ang linggong ito
    const dateEl = document.getElementById("report-date-range");
    if (dateEl) dateEl.textContent = rangeText;

    // Bawal pumunta sa susunod na linggo (wala pang attendance doon)
    const nextBtn = document.getElementById("btn-next-week");
    if (nextBtn) {
        const isCurrentWeek = toDateStr(selectedWeekStart) >= toDateStr(getWeekStart(new Date()));
        nextBtn.disabled = isCurrentWeek;
        nextBtn.style.opacity = isCurrentWeek ? "0.5" : "1";
        nextBtn.style.cursor = isCurrentWeek ? "not-allowed" : "pointer";
    }
}

function setupWeekNavigation() {
    const prevBtn = document.getElementById("btn-prev-week");
    const nextBtn = document.getElementById("btn-next-week");
    const thisBtn = document.getElementById("btn-this-week");

    const goTo = (weekStart) => {
        selectedWeekStart = weekStart;
        updateWeekHeader();
        renderSelectedWeek();
    };

    if (prevBtn) prevBtn.addEventListener("click", () => goTo(addDays(selectedWeekStart, -7)));
    if (nextBtn) nextBtn.addEventListener("click", () => {
        if (nextBtn.disabled) return;
        goTo(addDays(selectedWeekStart, 7));
    });
    if (thisBtn) thisBtn.addEventListener("click", () => goTo(getWeekStart(new Date())));
}

// ========================================
// LOAD STUDENT DETAILS FOR WEEKLY REPORT
// ========================================
async function loadStudentReportInformation(userId) {
    try {
        const studentRef = doc(db, "users", userId);
        const studentSnap = await getDoc(studentRef);

        if (!studentSnap.exists()) {
            console.error("Student details not found.");
            return;
        }

        const studentData = studentSnap.data();

        // Get the actual student details from Firebase
        const studentName = studentData.fullName || studentData.name;
        const studentSection = studentData.section;
        const companyName = studentData.companyName || studentData.company;

        // Display Name
        const nameElement = document.getElementById("report-student-name");
        if (nameElement) {
            nameElement.textContent = studentName || "";
        }

        // Display Section
        const sectionElement = document.getElementById("report-section");
        if (sectionElement) {
            sectionElement.textContent = studentSection || "";
        }

        // Display Company Name
        const companyElement = document.getElementById("report-company");
        if (companyElement) {
            companyElement.textContent = companyName || "";
        }

    } catch (error) {
        console.error("Error loading student report information:", error);
    }
}

// ========================================
// LOAD ATTENDANCE (live) + RENDER NAPILING LINGGO
// ========================================
function loadAccomplishmentReport(userId) {
    const tableBody = document.getElementById("report-table-body");
    if (!tableBody) return;

    const attendanceRef = collection(db, "attendance");
    const q = query(attendanceRef, where("userId", "==", userId));

    onSnapshot(q, (snapshot) => {
        allLogs = [];
        snapshot.forEach((docSnap) => {
            allLogs.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Live: kapag na-reject/na-edit ng coordinator, mag-a-update agad ang form
        renderSelectedWeek();

    }, (error) => {
        console.error("Firestore Error:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 20px; color: #ef4444;">
                    Error loading report: ${escapeHtml(error.message)}
                </td>
            </tr>
        `;
    });
}

// Ipinapakita LAMANG ang attendance na pasok sa napiling linggo (Mon - Sun)
function renderSelectedWeek() {
    const tableBody = document.getElementById("report-table-body");
    if (!tableBody) return;

    const { startStr, endStr } = getSelectedWeekBounds();

    const weekLogs = allLogs
        .map((log) => ({ log, dateStr: getLogDateStr(log) }))
        .filter((x) => x.dateStr && x.dateStr >= startStr && x.dateStr <= endStr)
        .sort((a, b) => {
            if (a.dateStr !== b.dateStr) return a.dateStr < b.dateStr ? -1 : 1;
            return toMillis(a.log.createdAt) - toMillis(b.log.createdAt);
        })
        .map((x) => x.log);

    currentLogs = weekLogs; // i-save sa global array para sa submission

    if (weekLogs.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 20px; color: #6b7280;">
                    No attendance logs for this week.
                </td>
            </tr>
        `;
        updateTotalMinutes(0);
        refreshSubmitState();
        return;
    }

    let html = "";
    let totalMinutes = 0;

    weekLogs.forEach((log) => {
        const dateStr = log.formattedDate || log.date || "N/A";
        const timeIn = log.timeIn || "--:--";
        const timeOut = log.timeOut || "--:--";

        const accomplishmentHTML = getAccomplishmentHTML(log);

        // Net minutes: may bawas na 1 hr break, at 0 kapag Rejected
        const minutes = getLogMinutes(log);
        totalMinutes += minutes;

        html += `
            <tr>
                <td style="text-align: center;">${escapeHtml(dateStr)}</td>
                <td style="text-align: center;">${escapeHtml(timeIn)}</td>
                <td style="text-align: center;">${escapeHtml(timeOut)}</td>
                <td style="text-align: left;">${accomplishmentHTML}</td>
                <td style="text-align: center;">${formatMinutes(minutes)}</td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
    updateTotalMinutes(totalMinutes);
    refreshSubmitState();
}

// ========================================
// SUBMIT STATE (isang report lang kada linggo)
// ========================================
function resetSubmitButton() {
    const submitBtn = document.getElementById("btn-submit-report");
    const statusEl = document.getElementById("submit-status");
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = "Submit Report";
        submitBtn.style.background = "#16a34a";
        submitBtn.style.opacity = "1";
        submitBtn.style.cursor = "pointer";
    }
    if (statusEl) statusEl.innerText = "";
}

async function findExistingSubmission(weekStartStr) {
    if (!currentUserId) return false;
    try {
        const snap = await getDocs(query(
            collection(db, "weekly_reports"),
            where("userId", "==", currentUserId),
            where("weekStart", "==", weekStartStr)
        ));
        return !snap.empty;
    } catch (err) {
        // Kung hindi mabasa (rules), huwag harangin ang pag-submit
        console.warn("Could not check existing weekly report:", err);
        return false;
    }
}

async function refreshSubmitState() {
    const submitBtn = document.getElementById("btn-submit-report");
    if (!submitBtn || !canSubmit) return;

    const token = ++renderToken;
    resetSubmitButton();

    const { startStr } = getSelectedWeekBounds();
    const already = await findExistingSubmission(startStr);

    // Nagpalit na ng linggo habang naghihintay - huwag i-apply
    if (token !== renderToken) return;

    if (already) {
        const statusEl = document.getElementById("submit-status");
        submitBtn.disabled = true;
        submitBtn.innerText = "Already Submitted";
        submitBtn.style.background = "#15803d";
        submitBtn.style.opacity = "0.7";
        submitBtn.style.cursor = "not-allowed";
        if (statusEl) {
            statusEl.style.color = "#16a34a";
            statusEl.innerText = "This week's report was already submitted.";
        }
    }
}

// Function para mai-submit ang Accomplishment Report sa Coordinator Dashboard
async function submitWeeklyReport() {
    const submitBtn = document.getElementById("btn-submit-report");
    const statusEl = document.getElementById("submit-status");

    if (!currentUserId) {
        alert("Unable to detect logged-in user. Please re-login.");
        return;
    }

    if (!currentLogs || currentLogs.length === 0) {
        alert("No attendance logs for this week to submit.");
        return;
    }

    // I-lock ang linggo at datos sa mismong sandali ng pag-click
    const { startStr, endStr } = getSelectedWeekBounds();
    const logsToSubmit = currentLogs.slice();
    const totalHoursToSubmit = calculatedTotalHours;

    try {
        submitBtn.disabled = true;
        submitBtn.innerText = "Submitting...";
        statusEl.style.color = "#6b7280";
        statusEl.innerText = "Processing submission...";

        // Huwag mag-submit ulit para sa parehong linggo
        if (await findExistingSubmission(startStr)) {
            alert("You already submitted a report for this week.");
            await refreshSubmitState();
            return;
        }

        // 1. Kuhanin ang profile details ng kasalukuyang user
        let userData = {
            fullName: "Student",
            section: "BSIT 401",
            company: "-",
            supervisor: "-"
        };

        const userDocRef = doc(db, "users", currentUserId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const u = userDocSnap.data();
            userData = {
                fullName: u.fullName || u.name || "Student",
                section: u.section || "BSIT 401",
                company: u.companyName || u.company || "-",
                supervisor: u.supervisorName || u.supervisor || "-"
            };
        }

        // 2. Week Range: unang at huling araw na may attendance sa linggong ito
        const firstLog = logsToSubmit[0];
        const lastLog = logsToSubmit[logsToSubmit.length - 1];
        const firstDate = firstLog.formattedDate || firstLog.date || "N/A";
        const lastDate = lastLog.formattedDate || lastLog.date || "N/A";
        const weekRangeText = `${firstDate} - ${lastDate}`;

        // 3. I-save sa `weekly_reports` collection
        const reportsRef = collection(db, "weekly_reports");
        await addDoc(reportsRef, {
            userId: currentUserId,
            studentName: userData.fullName,
            section: userData.section,
            company: userData.company,
            supervisor: userData.supervisor,
            totalHours: totalHoursToSubmit,
            weekRange: weekRangeText,
            weekStart: startStr,
            weekEnd: endStr,
            logsCount: logsToSubmit.length,
            status: "Submitted",
            submittedAt: serverTimestamp()
        });

        await addDoc(collection(db, "logs"), {
            type: "weekly_report",
            action: "Weekly Report Added",
            title: "Weekly Report Added",
            description: `${userData.fullName} added a weekly report.`,
            studentName: userData.fullName,
            company: userData.company,
            weekRange: weekRangeText,
            timestamp: serverTimestamp()
        });

        submitBtn.style.background = "#15803d";
        submitBtn.innerText = "Submitted!";
        submitBtn.disabled = true; // isang beses lang kada linggo
        statusEl.style.color = "#16a34a";
        statusEl.innerText = "Report submitted successfully to coordinator!";

        alert("Weekly report successfully submitted to coordinator!");

    } catch (err) {
        console.error("Submission Error:", err);
        submitBtn.disabled = false;
        submitBtn.innerText = "Submit Report";
        statusEl.style.color = "#ef4444";
        statusEl.innerText = "Failed to submit report.";
        alert("Failed to submit report: " + err.message);
    }
}

function getAccomplishmentHTML(logData) {
    const status = String(logData.status || "").toLowerCase();

    // Hindi valid / walang oras ang mga araw na ito, kaya status ang ipinapakita
    if (status === "rejected") {
        return "<em>Attendance rejected by coordinator.</em>";
    }
    if (status === "absent") {
        return "<em>Absent.</em>";
    }
    if (status === "excused") {
        const reason = logData.remarks && logData.remarks !== "--" ? `: ${escapeHtml(logData.remarks)}` : "";
        return `<em>Excused${reason}</em>`;
    }

    if (Array.isArray(logData.taskList) && logData.taskList.length > 0) {
        let listItems = logData.taskList.map(item => {
            const title = item.title ? `<strong>${escapeHtml(item.title)}:</strong> ` : "";
            const desc = item.description ? escapeHtml(item.description) : "";
            return `<li>${title}${desc}</li>`;
        }).join("");

        return `<ul style="margin: 0; padding-left: 18px;">${listItems}</ul>`;
    }

    if (logData.tasks && typeof logData.tasks === "string") {
        if (logData.tasks.includes("|")) {
            const items = logData.tasks.split("|").map(t => t.trim()).filter(Boolean);
            return `<ul style="margin: 0; padding-left: 18px;">` + 
                items.map(item => `<li>${escapeHtml(item)}</li>`).join("") + 
                `</ul>`;
        }
        return `<ul style="margin: 0; padding-left: 18px;"><li>${escapeHtml(logData.tasks)}</li></ul>`;
    }

    return "<em>No accomplishment logged.</em>";
}

// ========================================
// HOURS  (parehong logic ng student dashboard at attendance details)
// ========================================

// Minuto sa pagitan ng dalawang oras ("8:00 AM" / "17:00"), walang bawas na break
function rawMinutesBetween(timeIn, timeOut) {
    if (!timeIn || !timeOut || timeIn === "--:--" || timeOut === "--:--" || timeIn === "--" || timeOut === "--") return 0;

    const parseTime = (timeStr) => {
        const match = String(timeStr).trim().match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (!match) return null;

        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const modifier = match[3];

        if (modifier) {
            if (modifier.toUpperCase() === "PM" && hours < 12) hours += 12;
            if (modifier.toUpperCase() === "AM" && hours === 12) hours = 0;
        }
        return hours * 60 + minutes;
    };

    const start = parseTime(timeIn);
    const end = parseTime(timeOut);
    if (start === null || end === null) return 0;

    const diff = end - start;
    return diff > 0 ? diff : 0;
}

// Net minutes ng isang araw:
//  - Rejected            -> 0
//  - may todayHours      -> gamitin iyon (may bawas na 1 hr break na)
//  - wala, pero may oras -> (Time Out - Time In) MINUS 1 hr break
//  - wala rin           -> hoursRendered
function getLogMinutes(log) {
    if (String(log.status || "").toLowerCase() === "rejected") return 0;

    if (log.todayHours) {
        const h = String(log.todayHours).match(/(\d+)\s*h/i);
        const m = String(log.todayHours).match(/(\d+)\s*m/i);
        let minutes = 0;
        if (h) minutes += parseInt(h[1]) * 60;
        if (m) minutes += parseInt(m[1]);
        return minutes;
    }

    if (log.timeIn && log.timeOut && log.timeOut !== "--" && log.timeOut !== "--:--") {
        return Math.max(0, rawMinutesBetween(log.timeIn, log.timeOut) - 60);
    }

    if (log.hoursRendered) {
        return Math.round((parseFloat(log.hoursRendered) || 0) * 60);
    }

    return 0;
}

// 460 -> "7h 40m"
function formatMinutes(totalMinutes) {
    const m = Math.max(0, Math.round(totalMinutes || 0));
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function updateTotalMinutes(totalMinutes) {
    // Itabi sa global variable bilang decimal hours (parehong format ng dating totalHours sa database)
    calculatedTotalHours = Math.round((totalMinutes / 60) * 100) / 100;
    const totalEl = document.getElementById("total-hours-cell");
    if (totalEl) {
        totalEl.textContent = formatMinutes(totalMinutes);
    }
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    const ms = new Date(value).getTime();
    return isNaN(ms) ? 0 : ms;
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");
}