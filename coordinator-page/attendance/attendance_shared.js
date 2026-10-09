// =====================================================
// ATTENDANCE SHARED MODULE
//
// Ginagamit ng:
//   - attendance_records.js  (main page + summary cards)
//   - attendance_list.js     (popup pages ng bawat card)
//
// Iisang lugar ang logic ng schedule at status para
// laging magkapareho ang bilang sa card at sa popup.
// =====================================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getFirestore,
    collection,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


// =====================================================
// FIREBASE
// =====================================================

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

// Reuse ang app kung na-initialize na ng ../header/header.js
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const db = getFirestore(app);

// Para dala ng Firestore ang naka-login na user, kahit sa popup
// page (iframe) na walang header.js.
getAuth(app);

const attendanceRef = collection(db, "attendance");
const usersRef = collection(db, "users");


// =====================================================
// SETTINGS
// =====================================================

// Ilang minuto na palugit bago ma-tag na "Late" pagkatapos ng
// scheduled time-in. Palitan lang ito kung iba ang rule ninyo.
export const GRACE_MINUTES = 15;


// =====================================================
// HELPERS
// =====================================================

// "08:00" / "8:05 AM" / "08:05:12 PM"  ->  minutes since midnight
export function toMinutes(value) {

    if (value === undefined || value === null) {
        return null;
    }

    const match = String(value)
        .trim()
        .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);

    if (!match) {
        return null;
    }

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridiem = match[3] ? match[3].toUpperCase() : null;

    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;

    if (hours > 23 || minutes > 59) {
        return null;
    }

    return hours * 60 + minutes;
}


export function formatMinutes(total) {

    const hours = Math.floor(total / 60);
    const minutes = total % 60;

    const suffix = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;

    return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}


function toDateObject(value) {

    if (value === undefined || value === null || value === "") {
        return null;
    }

    let date = null;

    if (typeof value.toDate === "function") {
        date = value.toDate();          // Firestore Timestamp
    } else if (value instanceof Date) {
        date = value;
    } else if (typeof value === "object" && typeof value.seconds === "number") {
        date = new Date(value.seconds * 1000);   // Timestamp na naging plain object
    } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        // "YYYY-MM-DD" -> LOCAL na petsa (iwas UTC shift)
        const [y, m, d] = value.trim().split("-").map(Number);
        date = new Date(y, m - 1, d);
    } else {
        date = new Date(value);         // string / number
    }

    return isNaN(date.getTime()) ? null : date;
}


// Kunin ang unang may laman na field sa listahan ng posibleng pangalan
function pick(data, keys) {

    for (const key of keys) {

        const value = data[key];

        if (value !== undefined && value !== null && value !== "") {
            return value;
        }

    }

    return undefined;
}


// Timestamp / Date / string -> "8:05 AM" (para mabasa ng toMinutes)
function toTimeText(value) {

    if (value === undefined || value === null || value === "") {
        return "";
    }

    const isDateLike =
        value instanceof Date ||
        typeof value.toDate === "function" ||
        (typeof value === "object" && typeof value.seconds === "number");

    if (isDateLike) {

        const date = toDateObject(value);

        return date
            ? formatMinutes(date.getHours() * 60 + date.getMinutes())
            : "";
    }

    return String(value).trim();
}


// Mga posibleng pangalan ng field sa attendance doc
const USER_ID_FIELDS = ["userId", "studentId", "uid", "userID", "user_id", "student_id"];
const USER_EMAIL_FIELDS = ["userEmail", "studentEmail", "email", "user_email"];
const TIME_IN_FIELDS = ["timeIn", "time_in", "timeInAt", "checkIn", "clockIn"];
const TIME_OUT_FIELDS = ["timeOut", "time_out", "timeOutAt", "checkOut", "clockOut"];


// Kunin ang petsa ng attendance record (unang valid na field ang gagamitin)
export function getRecordDate(data) {

    const candidates = [
        data.formattedDate,
        data.date,
        data.dateKey,
        data.timestamp,
        data.createdAt,
        data.timeIn
    ];

    for (const candidate of candidates) {

        const date = toDateObject(candidate);

        if (date) {
            return date;
        }

    }

    return null;
}


function isSameDay(a, b) {
    return a.toDateString() === b.toDateString();
}


export function escapeHtml(value) {

    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));

}


// Kunin ang mga naka-enable na session (morning / afternoon) sa schedule
function getSessions(schedule) {

    if (!schedule) {
        return [];
    }

    const sessions = [];

    if (schedule.morning && schedule.morningEnabled !== false) {
        sessions.push(schedule.morning);
    }

    if (schedule.afternoon && schedule.afternoonEnabled !== false) {
        sessions.push(schedule.afternoon);
    }

    return sessions
        .map((session) => ({
            start: toMinutes(session.timeIn),
            end: toMinutes(session.timeOut)
        }))
        .filter((session) =>
            session.start !== null &&
            session.end !== null &&
            session.start < session.end
        )
        .sort((a, b) => a.start - b.start);
}


// =====================================================
// COMPLETED STUDENTS
//
// Dapat tumugma ito sa target hours na ginagamit sa
// backend (app.py: target_hours = 600) at sa "Completed"
// na aiStatus/internshipStatus na sinusulat doon sa
// "users" collection kapag naabot na ng estudyante ang
// required hours.
// =====================================================

const TARGET_HOURS = 600;

// True kapag "Completed" na ang estudyante (naabot na ang
// required hours), base sa internshipStatus/aiStatus na
// naka-save sa users doc, o sa completedHours mismo bilang
// backup kung sakaling hindi pa na-refresh ang status field.
function isCompletedStudent(data) {

    const status = String(data.internshipStatus || data.aiStatus || "").toLowerCase();

    if (status === "completed") {
        return true;
    }

    const completedHours = Number(data.completedHours);
    const targetHours = Number(data.targetHours) || TARGET_HOURS;

    return !Number.isNaN(completedHours) && completedHours >= targetHours;
}

// True kapag pinili ng estudyante (o ng coordinator) na
// magpatuloy pa rin ang pag-duty niya KAHIT tapos na ang
// required hours. I-toggle ito sa student's Firestore doc
// (users/{id}.continueDutyAfterCompletion = true) kung may
// UI switch na gagawin para dito.
function wantsToContinueDuty(data) {
    return data.continueDutyAfterCompletion === true;
}


// =====================================================
// STATUS BASED ON SCHEDULE
// =====================================================

function deriveStatus(sessions, record, nowMinutes) {

    const data = record ? record.data : {};

    const stored = (data.status || "").toLowerCase();

    if (record && stored.includes("reject")) {
        return "Rejected";
    }

    if (record && stored.includes("absent")) {
        return "Absent";
    }

    // Pinayagan / "excused" ng coordinator
    if (record && stored.includes("excus")) {
        return "Excused";
    }


    const timeInMinutes = toMinutes(toTimeText(pick(data, TIME_IN_FIELDS)));


    // May time-in: ikumpara sa schedule ng session na tinapatan niya
    if (timeInMinutes !== null) {

        // Walang schedule (hal. record ng student na hindi naka-schedule
        // sa araw na iyon): hindi makakalkula ang Late, kaya gamitin ang
        // naka-save na status kung meron, kung hindi ay Present.
        if (sessions.length === 0) {
            return stored.includes("late") ? "Late" : "Present";
        }

        const session =
            sessions.find((item) => timeInMinutes < item.end) ||
            sessions[sessions.length - 1];

        return timeInMinutes > session.start + GRACE_MINUTES
            ? "Late"
            : "Present";
    }


    // May record pero hindi mabasa ang oras ng time-in:
    // gamitin ang naka-save na status para hindi mawala sa listahan
    if (record) {

        if (stored.includes("late")) {
            return "Late";
        }

        if (stored.includes("present") || stored.includes("on time") || stored.includes("ontime")) {
            return "Present";
        }

    }


    // Walang time-in at walang schedule: hindi masasabing absent
    if (sessions.length === 0) {
        return "Pending";
    }

    // Walang time-in: nakadepende sa oras ngayon vs schedule
    const lastEnd = sessions[sessions.length - 1].end;

    return nowMinutes >= lastEnd
        ? "Absent"
        : "Pending";
}


// =====================================================
// LOAD STUDENTS + SCHEDULES
// =====================================================

// Directory ng LAHAT ng student (kahit walang schedule) para mapunan
// ang course / section / company ng mga attendance record na hindi
// tumutugma sa naka-schedule na listahan. Key: id o email (lowercase).
const userDirectory = new Map();

const SECTION_FIELDS = [
    "section", "studentSection", "yearSection", "year_section",
    "classSection", "sectionName", "courseSection", "block"
];

const COURSE_FIELDS = ["course", "studentCourse", "program", "courseName"];

const COMPANY_FIELDS = [
    "companyName", "company", "company_name", "assignedCompany", "hostCompany"
];

const NAME_FIELDS = ["name", "fullName", "studentName", "displayName"];

function lookupUser(keys) {

    for (const key of keys) {

        const found = userDirectory.get(String(key).trim().toLowerCase());

        if (found) {
            return found;
        }

    }

    return null;
}


export async function loadScheduledUsers() {

    const snapshot = await getDocs(usersRef);

    const users = [];

    userDirectory.clear();

    snapshot.forEach((userDoc) => {

        const data = userDoc.data();

        const role = (data.role || data.userType || "").toLowerCase();

        if (role && role !== "student") {
            return;
        }

        // I-save sa directory bago pa mag-filter ng schedule / completed
        const info = {
            name: pick(data, NAME_FIELDS),
            email: data.email || "",
            course: pick(data, COURSE_FIELDS),
            section: pick(data, SECTION_FIELDS),
            company: pick(data, COMPANY_FIELDS)
        };

        userDirectory.set(userDoc.id.toLowerCase(), info);

        if (data.email) {
            userDirectory.set(String(data.email).trim().toLowerCase(), info);
        }

        // Tapos na sa required hours -> hindi na dapat kailanganing
        // mag-time-in/time-out pa, maliban na lang kung pinili niyang
        // (o ng coordinator) ipagpatuloy pa rin ang pag-duty.
        if (isCompletedStudent(data) && !wantsToContinueDuty(data)) {
            return;
        }

        const schedule = data.schedule || {};
        const sessions = getSessions(schedule);

        if (sessions.length === 0) {
            return;     // walang schedule = hindi ibibilang
        }

        const days = Array.isArray(schedule.days)
            ? schedule.days.map((day) => String(day).toLowerCase())
            : [];

        users.push({
            id: userDoc.id,
            name: info.name || "Student User",
            email: data.email || "",
            course: info.course || "BSIT",
            section: info.section || "N/A",
            company: info.company || "N/A",
            days,
            sessions,
            scheduleText: sessions
                .map((s) => `${formatMinutes(s.start)} - ${formatMinutes(s.end)}`)
                .join(" | "),
            // Kung nasa listahan pa rin siya kahit "Completed" na, ibig
            // sabihin kusa niyang pinagpatuloy ang duty - useful flag
            // kung gusto pang lagyan ng badge sa UI sa ibang pagkakataon.
            completedButContinuing: isCompletedStudent(data)
        });

    });

    return users;
}


// =====================================================
// REALTIME ATTENDANCE
// =====================================================

// Returns ang unsubscribe function
export function subscribeAttendance(onData, onError) {

    return onSnapshot(
        attendanceRef,
        (snapshot) => {

            const docs = snapshot.docs.map((docSnap) => ({
                id: docSnap.id,
                data: docSnap.data()
            }));

            // Para madaling i-check ang field names sa Console (F12)
            console.info(
                `[Attendance] ${docs.length} attendance doc(s) loaded. Sample:`,
                docs[0] ? { id: docs[0].id, ...docs[0].data } : null
            );

            onData(docs);

        },
        onError
    );

}


// =====================================================
// BUILD TODAY'S ROWS (schedule-based)
// =====================================================

export function buildTodayRows(scheduledUsers, attendanceDocs, now = new Date()) {
    return buildRowsForDate(scheduledUsers, attendanceDocs, now, now);
}


// =====================================================
// BUILD ROWS FOR ANY DATE (schedule-based)
//
// Parehong logic ng buildTodayRows, pero para sa
// kahit anong petsa. Sa nakaraang araw, ang walang
// time-in ay "Absent" na agad (tapos na ang araw).
// Sa hinaharap na petsa, walang ibabalik.
// =====================================================

function formatDateText(date) {
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function toDateKey(date) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${d}`;
}

// includeUnmatched = true -> isama rin ang attendance records na hindi
// tumutugma sa naka-schedule na student ng araw na iyon (para hindi
// mawala sa History ang data). Hindi ito ginagamit sa summary cards.
export function buildRowsForDate(scheduledUsers, attendanceDocs, targetDate, now = new Date(), includeUnmatched = false) {

    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    if (targetDate >= startOfTomorrow) {
        return [];
    }

    const isToday = isSameDay(targetDate, now);

    // Lumipas na araw = tapos na ang lahat ng schedule
    const nowMinutes = isToday
        ? now.getHours() * 60 + now.getMinutes()
        : 24 * 60;

    const todayName = targetDate
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();

    const dateText = formatDateText(targetDate);
    const dateKey = toDateKey(targetDate);


    // Attendance records ng petsang ito lang
    const recordMap = {};
    const dayDocs = [];

    attendanceDocs.forEach((docItem) => {

        const date = getRecordDate(docItem.data);

        if (!date || !isSameDay(date, targetDate)) {
            return;
        }

        dayDocs.push(docItem);

        // Kung may higit sa isang record sa isang araw, unahin ang
        // may time-in (huwag palitan ng walang laman na record)
        const hasTimeIn = (item) => !!pick(item.data, TIME_IN_FIELDS);

        const store = (key) => {

            if (!key) {
                return;
            }

            const existing = recordMap[key];

            if (!existing || (!hasTimeIn(existing) && hasTimeIn(docItem))) {
                recordMap[key] = docItem;
            }

        };

        USER_ID_FIELDS.forEach((field) => {
            const value = docItem.data[field];
            if (value) store(String(value));
        });

        USER_EMAIL_FIELDS.forEach((field) => {
            const value = docItem.data[field];
            if (value) store(String(value).trim().toLowerCase());
        });

    });


    // Diagnostic: attendance records ngayong araw na walang katapat na student
    if (isToday) {

        const known = new Set();

        scheduledUsers.forEach((user) => {
            known.add(String(user.id).toLowerCase());
            if (user.email) known.add(user.email.trim().toLowerCase());
        });

        const orphans = attendanceDocs.filter((docItem) => {

            const date = getRecordDate(docItem.data);

            if (!date || !isSameDay(date, targetDate)) {
                return false;
            }

            const keys = [
                ...USER_ID_FIELDS.map((f) => docItem.data[f]),
                ...USER_EMAIL_FIELDS.map((f) => docItem.data[f])
            ]
                .filter(Boolean)
                .map((v) => String(v).trim().toLowerCase());

            return !keys.some((k) => known.has(k));
        });

        if (orphans.length) {
            console.warn(
                "[Attendance] May attendance record ngayong araw na walang katapat na naka-schedule na student:",
                orphans.map((o) => ({ id: o.id, ...o.data }))
            );
        }
    }


    const photoOf = (data) =>
        data.photoProof ||
        data.photoURL ||
        data.photoUrl ||
        data.photo ||
        data.imageUrl ||
        data.imageURL ||
        "";

    // Remarks na galing sa coordinator / supervisor (reject, excuse, atbp.)
    const remarksOf = (data) =>
        String(
            pick(data, [
                "excuseReason", "rejectReason", "rejectionReason",
                "supervisorRemarks", "remarks", "note"
            ]) || ""
        );

    const hoursOf = (data) =>
        data.todayHours ||
        (data.hoursRendered ? `${data.hoursRendered} hrs` : "0h 0m");

    // Mga naka-schedule ngayong araw lang
    const scheduledToday = scheduledUsers
        .filter((user) => user.days.includes(todayName));

    const rows = scheduledToday
        .map((user) => {

            const record =
                recordMap[user.id] ||
                (user.email && recordMap[user.email.trim().toLowerCase()]) ||
                null;

            const data = record ? record.data : {};

            return {
                id: record ? record.id : user.id,
                userId: user.id,
                date: targetDate,
                dateKey,
                dateText,
                studentName: user.name,
                studentEmail: user.email || "No Email",
                course: user.course,
                section: user.section,
                company: user.company,
                scheduleText: user.scheduleText,
                timeIn: toTimeText(pick(data, TIME_IN_FIELDS)) || "--",
                timeOut: toTimeText(pick(data, TIME_OUT_FIELDS)) || "--",
                totalHours: hoursOf(data),
                status: deriveStatus(user.sessions, record, nowMinutes),
                photoProof: photoOf(data),
                recordId: record ? record.id : null,
                remarks: remarksOf(data),
                adjusted: data.timeAdjusted === true
            };

        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName));


    // History lang: isama ang attendance records ng mga student na
    // wala sa schedule ng araw na ito (o hindi tumutugma ang ID/email),
    // para hindi mawala ang mga totoong time-in sa listahan.
    if (includeUnmatched) {

        const shownKeys = new Set();

        scheduledToday.forEach((user) => {
            shownKeys.add(String(user.id).toLowerCase());
            if (user.email) shownKeys.add(user.email.trim().toLowerCase());
        });

        const extra = [];

        dayDocs.forEach((docItem) => {

            const data = docItem.data;

            const keys = [
                ...USER_ID_FIELDS.map((f) => data[f]),
                ...USER_EMAIL_FIELDS.map((f) => data[f])
            ]
                .filter(Boolean)
                .map((v) => String(v).trim().toLowerCase());

            // Naipakita na bilang naka-schedule na student
            if (keys.some((k) => shownKeys.has(k))) {
                return;
            }

            const email = pick(data, USER_EMAIL_FIELDS);

            // Hanapin ang student sa users collection para sa section atbp.
            const profile = lookupUser(keys) || {};

            extra.push({
                id: docItem.id,
                userId: pick(data, USER_ID_FIELDS) || docItem.id,
                date: targetDate,
                dateKey,
                dateText,
                studentName:
                    profile.name ||
                    pick(data, [...NAME_FIELDS, "userName"]) ||
                    email ||
                    "Unknown Student",
                studentEmail: email || profile.email || "No Email",
                course: profile.course || pick(data, COURSE_FIELDS) || "BSIT",
                section: profile.section || pick(data, SECTION_FIELDS) || "N/A",
                company: profile.company || pick(data, COMPANY_FIELDS) || "N/A",
                scheduleText: "Not scheduled",
                timeIn: toTimeText(pick(data, TIME_IN_FIELDS)) || "--",
                timeOut: toTimeText(pick(data, TIME_OUT_FIELDS)) || "--",
                totalHours: hoursOf(data),
                status: deriveStatus([], docItem, nowMinutes),
                photoProof: photoOf(data),
                recordId: docItem.id,
                remarks: remarksOf(data),
                adjusted: data.timeAdjusted === true
            });

        });

        extra.sort((a, b) => a.studentName.localeCompare(b.studentName));

        return [...rows, ...extra];
    }

    return rows;
}


// =====================================================
// BUILD ROWS FOR A DATE RANGE (newest day first)
//
// Max na 366 araw para hindi bumigat ang page.
// =====================================================

export const MAX_RANGE_DAYS = 366;

export function buildRowsForRange(scheduledUsers, attendanceDocs, fromDate, toDate, now = new Date()) {

    const rows = [];

    const cursor = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
    const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());

    let guard = 0;

    while (cursor >= start && guard < MAX_RANGE_DAYS) {

        rows.push(...buildRowsForDate(scheduledUsers, attendanceDocs, new Date(cursor), now, true));

        cursor.setDate(cursor.getDate() - 1);
        guard++;
    }

    return rows;
}