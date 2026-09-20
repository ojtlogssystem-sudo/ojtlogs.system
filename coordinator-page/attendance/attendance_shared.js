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
    } else {
        date = new Date(value);         // string / number
    }

    return isNaN(date.getTime()) ? null : date;
}


// Kunin ang petsa ng attendance record (unang valid na field ang gagamitin)
function getRecordDate(data) {

    const candidates = [
        data.formattedDate,
        data.date,
        data.timestamp,
        data.createdAt
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


    const timeInMinutes = toMinutes(data.timeIn);


    // May time-in: ikumpara sa schedule ng session na tinapatan niya
    if (timeInMinutes !== null) {

        const session =
            sessions.find((item) => timeInMinutes < item.end) ||
            sessions[sessions.length - 1];

        return timeInMinutes > session.start + GRACE_MINUTES
            ? "Late"
            : "Present";
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

export async function loadScheduledUsers() {

    const snapshot = await getDocs(usersRef);

    const users = [];

    snapshot.forEach((userDoc) => {

        const data = userDoc.data();

        const role = (data.role || data.userType || "").toLowerCase();

        if (role && role !== "student") {
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
            name: data.name || data.fullName || "Student User",
            email: data.email || "",
            course: data.course || "BSIT",
            section: data.section || "N/A",
            company:
                data.companyName ||
                data.company ||
                data.company_name ||
                "N/A",
            days,
            sessions,
            scheduleText: sessions
                .map((s) => `${formatMinutes(s.start)} - ${formatMinutes(s.end)}`)
                .join(" | ")
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

            onData(
                snapshot.docs.map((docSnap) => ({
                    id: docSnap.id,
                    data: docSnap.data()
                }))
            );

        },
        onError
    );

}


// =====================================================
// BUILD TODAY'S ROWS (schedule-based)
// =====================================================

export function buildTodayRows(scheduledUsers, attendanceDocs, now = new Date()) {

    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const todayName = now
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();


    // Attendance records ngayong araw lang
    const recordMap = {};

    attendanceDocs.forEach((docItem) => {

        const date = getRecordDate(docItem.data);

        if (!date || !isSameDay(date, now)) {
            return;
        }

        if (docItem.data.userId && !recordMap[docItem.data.userId]) {
            recordMap[docItem.data.userId] = docItem;
        }

        if (docItem.data.userEmail) {

            const key = docItem.data.userEmail.toLowerCase();

            if (!recordMap[key]) {
                recordMap[key] = docItem;
            }

        }

    });


    // Mga naka-schedule ngayong araw lang
    return scheduledUsers
        .filter((user) => user.days.includes(todayName))
        .map((user) => {

            const record =
                recordMap[user.id] ||
                (user.email && recordMap[user.email.toLowerCase()]) ||
                null;

            const data = record ? record.data : {};

            return {
                id: record ? record.id : user.id,
                userId: user.id,
                studentName: user.name,
                studentEmail: user.email || "No Email",
                course: user.course,
                section: user.section,
                company: user.company,
                scheduleText: user.scheduleText,
                timeIn: data.timeIn || "--",
                timeOut: data.timeOut || "--",
                totalHours:
                    data.todayHours ||
                    (data.hoursRendered ? `${data.hoursRendered} hrs` : "0h 0m"),
                status: deriveStatus(user.sessions, record, nowMinutes),
                photoProof:
                    data.photoProof ||
                    data.photoURL ||
                    data.photoUrl ||
                    data.photo ||
                    data.imageUrl ||
                    data.imageURL ||
                    ""
            };

        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName));
}