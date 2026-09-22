const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin SDK
initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

// ==========================================
// CONFIGURATION: Target Student Details
// ==========================================
const TARGET_STUDENT = {
    userId: "NwMPhrA2BAMX34JkcktisJNHXh13", // Ilagay ang Student UID dito
    company: "Motortrade",
    location: "Motortrade"
};

const SAMPLE_TASKS = [
    { title: "Software Development", desc: "Developed dynamic components and updated Firestore logic." },
    { title: "Database Maintenance", desc: "Optimized database structures and checked user permission rules." },
    { title: "UI/UX Design", desc: "Designed responsive layouts using CSS and updated HTML structures." },
    { title: "System Testing", desc: "Performed module integration testing and debugged attendance logs." }
];

const DAY_MAP = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday"
};

function getRandomTaskPair() {
    const t1 = SAMPLE_TASKS[Math.floor(Math.random() * SAMPLE_TASKS.length)];
    let t2 = SAMPLE_TASKS[Math.floor(Math.random() * SAMPLE_TASKS.length)];
    while (t1 === t2) {
        t2 = SAMPLE_TASKS[Math.floor(Math.random() * SAMPLE_TASKS.length)];
    }
    return [t1, t2];
}

function formatAMPM(dateObj) {
    return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatLocalDateDisplay(dateObj) {
    return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getLocalYYYYMMDD(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function seedNeedsMonitoringStudent() {
    if (!TARGET_STUDENT.userId || TARGET_STUDENT.userId.trim() === "") {
        console.error("❌ ERROR: Walang nilagay na Student UID!");
        process.exit(1);
    }

    console.log(`Kina-karga ang schedule data ng user (${TARGET_STUDENT.userId}) mula sa Firestore...`);

    // 1. KUNIN ANG USER DOCUMENT MULA SA FIRESTORE
    const userDocRef = db.collection('users').doc(TARGET_STUDENT.userId);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
        console.error(`❌ ERROR: Walang nahanap na user sa Firestore na may UID: ${TARGET_STUDENT.userId}`);
        process.exit(1);
    }

    const userData = userDoc.data();
    const userEmail = userData.email || userData.userEmail || "student@gmail.com";
    
    // 2. BASAHIN ANG `schedule` OBJECT MULA SA FIREBASE
    const scheduleObj = userData.schedule || {};
    const allowedDays = scheduleObj.days || []; // Kunin ang days array (e.g., ["Monday", "Tuesday", "Thursday"])

    if (!Array.isArray(allowedDays) || allowedDays.length === 0) {
        console.error("❌ ERROR: Walang nahanap na 'days' array sa 'schedule' field ng user!");
        process.exit(1);
    }

    let startHour = 8;
    let endHour = 17;

    if (scheduleObj.afternoonEnabled && scheduleObj.afternoon) {
        if (scheduleObj.afternoon.timeIn) startHour = parseInt(scheduleObj.afternoon.timeIn.split(':')[0], 10);
        if (scheduleObj.afternoon.timeOut) endHour = parseInt(scheduleObj.afternoon.timeOut.split(':')[0], 10);
    } else if (scheduleObj.morningEnabled && scheduleObj.morning) {
        if (scheduleObj.morning.timeIn) startHour = parseInt(scheduleObj.morning.timeIn.split(':')[0], 10);
        if (scheduleObj.morning.timeOut) endHour = parseInt(scheduleObj.morning.timeOut.split(':')[0], 10);
    }

    const dailyHoursRendered = Math.max(1, endHour - startHour);
    const normalizedDays = allowedDays.map(day => String(day).trim().toLowerCase());

    console.log(`✅ Scheduled Days:`, allowedDays);
    console.log(`⏱️ Shift Hours: ${startHour}:00 - ${endHour}:00 (${dailyHoursRendered} hrs/day)`);

    // Gagawa tayo ng 10 scheduled days na kasaysayan, kung saan 3 doon ay "Absent"
    const TOTAL_DAYS_TO_GENERATE = 10;
    const TARGET_ABSENTS = 3;

    let generatedScheduledDays = 0;
    let totalAbsentsGenerated = 0;
    let totalRenderedHours = 0;

    const attendanceRecords = [];
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - 1); // Magsimula kahapon pabalik

    // Tukuyin kung kailan lalabas ang 3 absents (e.g. sa ika-3rd, 6th, at 9th scheduled day)
    const absentIndexes = [3, 6, 9]; 

    while (generatedScheduledDays < TOTAL_DAYS_TO_GENERATE) {
        const dayIndex = currentDate.getDay(); // 0-6
        const fullDayName = DAY_MAP[dayIndex].toLowerCase();
        const shortDayName = fullDayName.substring(0, 3);

        const isScheduledDay = normalizedDays.some(scheduledDay => 
            scheduledDay === fullDayName || scheduledDay === shortDayName
        );

        if (isScheduledDay) {
            generatedScheduledDays++;
            const dateStr = getLocalYYYYMMDD(currentDate);
            const formattedDateStr = formatLocalDateDisplay(currentDate);

            // Titingnan kung dapat maglagay ng Absent sa araw na ito
            const isAbsentDay = absentIndexes.includes(generatedScheduledDays);

            if (isAbsentDay) {
                totalAbsentsGenerated++;
                // Record para sa Absent Day
                const absentRecord = {
                    userId: TARGET_STUDENT.userId,
                    userEmail: userEmail,
                    date: dateStr,
                    formattedDate: formattedDateStr,
                    company: TARGET_STUDENT.company,
                    location: TARGET_STUDENT.location,
                    timeIn: "--:--",
                    timeInRaw: null,
                    timeOut: "--:--",
                    timeOutRaw: null,
                    photoProof: null,
                    tasks: "No tasks submitted (Absent)",
                    taskList: [],
                    hoursRendered: 0,
                    todayHours: "0h 0m",
                    status: "Absent",
                    isLate: false,
                    lateMinutes: 0,
                    remarks: "Unexcused Absence",
                    createdAt: Timestamp.fromDate(currentDate),
                    updatedAt: Timestamp.fromDate(currentDate)
                };
                attendanceRecords.push(absentRecord);
            } else {
                // Record para sa Present Day
                totalRenderedHours += dailyHoursRendered;
                const timeInDate = new Date(currentDate);
                timeInDate.setHours(startHour, 0, 0, 0);

                const timeOutDate = new Date(currentDate);
                timeOutDate.setHours(endHour, 0, 0, 0);

                const tasksList = getRandomTaskPair();
                const tasksString = tasksList.map(t => `${t.title}: ${t.desc}`).join(" | ");

                const presentRecord = {
                    userId: TARGET_STUDENT.userId,
                    userEmail: userEmail,
                    date: dateStr,
                    formattedDate: formattedDateStr,
                    company: TARGET_STUDENT.company,
                    location: TARGET_STUDENT.location,
                    timeIn: formatAMPM(timeInDate),
                    timeInRaw: timeInDate.toISOString(),
                    timeOut: formatAMPM(timeOutDate),
                    timeOutRaw: timeOutDate.toISOString(),
                    photoProof: "https://via.placeholder.com/400x300?text=Proof",
                    tasks: tasksString,
                    taskList: tasksList,
                    hoursRendered: dailyHoursRendered,
                    todayHours: `${dailyHoursRendered}h 0m`,
                    status: "Present",
                    isLate: false,
                    lateMinutes: 0,
                    remarks: "On-Time / Present",
                    createdAt: Timestamp.fromDate(timeInDate),
                    updatedAt: Timestamp.fromDate(timeOutDate)
                };
                attendanceRecords.push(presentRecord);
            }
        }

        currentDate.setDate(currentDate.getDate() - 1);
    }

    console.log(`Nagpapadala ng ${attendanceRecords.length} records sa Firestore (May ${totalAbsentsGenerated} Absents)...`);

    // Batch commit sa attendance collection
    const batch = db.batch();
    attendanceRecords.forEach(record => {
        const docRef = db.collection('attendance').doc();
        batch.set(docRef, record);
    });
    await batch.commit();

    // 3. I-UPDATE ANG USER PROFILE SA FIRESTORE PARA MAGING "Needs Monitoring"
    await userDocRef.set({
        totalAbsents: totalAbsentsGenerated,
        totalHoursRendered: totalRenderedHours,
        status: "Needs Monitoring",
        needsMonitoring: true,
        monitoringReason: "Accumulated 3 or more unexcused absents based on scheduled days."
    }, { merge: true });

    console.log(`\n✅ SUCCESS!`);
    console.log(`- Nakapag-generate ng 3 Absents batay sa schedule ng estudyante.`);
    console.log(`- Ang status sa user document (UID: ${TARGET_STUDENT.userId}) ay na-update na sa: "Needs Monitoring" / needsMonitoring: true.`);
    
    process.exit();
}

seedNeedsMonitoringStudent().catch(err => {
    console.error("❌ Nagkaroon ng error:", err);
    process.exit(1);
});