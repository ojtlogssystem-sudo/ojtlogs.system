const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin SDK
initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

// ==========================================
// CONFIGURATION: Student UID Details
// ==========================================
const TARGET_STUDENT = {
    userId: "7pWEiX5rC6ZYcujlJjflvhDqPTL2", // Pwede mo nang palitan ng kahit anong UID nang walang error
    company: "Globe",
    location: "Globe"
};

const TOTAL_REQUIRED_HOURS = 600;

const SAMPLE_TASKS = [
    { title: "Software Development", desc: "Developed dynamic components and updated Firestore logic." },
    { title: "Database Maintenance", desc: "Optimized database structures and checked user permission rules." },
    { title: "UI/UX Design", desc: "Designed responsive layouts using CSS and updated HTML structures." },
    { title: "System Testing", desc: "Performed module integration testing and debugged attendance logs." },
    { title: "Documentation", desc: "Prepared end-user documentation and updated daily OJT report." }
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

async function seedStudent600HoursBasedOnSchedule() {
    // NA-FIX: Tanging walang laman na string lang ang haharangin
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
    
    // 2. BASAHIN ANG `schedule` OBJECT BATAY SA STRUCTURAL LAYOUT NG FIREBASE
    const scheduleObj = userData.schedule || {};
    const allowedDays = scheduleObj.days || []; // Kunin ang days array (hal. ["Monday", "Tuesday", "Thursday"])

    if (!Array.isArray(allowedDays) || allowedDays.length === 0) {
        console.error("❌ ERROR: Walang nahanap na 'days' array sa 'schedule' field ng user!");
        process.exit(1);
    }

    // Kunin ang Time In at Time Out hours (Default sa 8:00 hanggang 17:00 kung wala)
    let startHour = 8;
    let endHour = 17;

    if (scheduleObj.afternoonEnabled && scheduleObj.afternoon) {
        if (scheduleObj.afternoon.timeIn) {
            startHour = parseInt(scheduleObj.afternoon.timeIn.split(':')[0], 10);
        }
        if (scheduleObj.afternoon.timeOut) {
            endHour = parseInt(scheduleObj.afternoon.timeOut.split(':')[0], 10);
        }
    } else if (scheduleObj.morningEnabled && scheduleObj.morning) {
        if (scheduleObj.morning.timeIn) {
            startHour = parseInt(scheduleObj.morning.timeIn.split(':')[0], 10);
        }
        if (scheduleObj.morning.timeOut) {
            endHour = parseInt(scheduleObj.morning.timeOut.split(':')[0], 10);
        }
    }

    // Kuhanin ang rendered hours kada araw
    const dailyHoursRendered = Math.max(1, endHour - startHour);

    // Gawing lowercase ang days para sa accurate matching
    const normalizedDays = allowedDays.map(day => String(day).trim().toLowerCase());

    console.log(`✅ Nakitang Scheduled Days:`, allowedDays);
    console.log(`⏱️ Shift Hours: ${startHour}:00 hanggang ${endHour}:00 (${dailyHoursRendered} hrs/day)`);
    console.log(`Simula ng pagbuo ng ${TOTAL_REQUIRED_HOURS} Hours Attendance History...`);

    const totalDaysNeeded = Math.ceil(TOTAL_REQUIRED_HOURS / dailyHoursRendered);
    const attendanceRecords = [];

    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - 1); // Magsimula kahapon pabalik

    let generatedDays = 0;

    while (generatedDays < totalDaysNeeded) {
        const dayIndex = currentDate.getDay(); // 0-6
        const fullDayName = DAY_MAP[dayIndex].toLowerCase(); // e.g., "monday"
        const shortDayName = fullDayName.substring(0, 3);    // e.g., "mon"

        // I-check kung ang araw ay nasa 'schedule.days'
        const isScheduledDay = normalizedDays.some(scheduledDay => 
            scheduledDay === fullDayName || scheduledDay === shortDayName
        );

        if (isScheduledDay) {
            const dateStr = getLocalYYYYMMDD(currentDate);
            const formattedDateStr = formatLocalDateDisplay(currentDate);

            // Time In base sa shift
            const timeInDate = new Date(currentDate);
            const inMinutes = Math.floor(Math.random() * 20) - 15; // ±15 minutes variance
            timeInDate.setHours(startHour, 0 + inMinutes, 0, 0);

            // Time Out base sa shift
            const timeOutDate = new Date(currentDate);
            timeOutDate.setHours(endHour, 0, 0, 0);

            const isLate = inMinutes > 15;
            const status = isLate ? "Late" : "Present";
            const remarks = isLate ? `Late Arrival (${inMinutes} minute/s late)` : "On-Time / Present";

            const tasksList = getRandomTaskPair();
            const tasksString = tasksList.map(t => `${t.title}: ${t.desc}`).join(" | ");

            const record = {
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
                photoProof: "https://via.placeholder.com/400x300?text=Auto+Generated+Proof",
                tasks: tasksString,
                taskList: tasksList,
                hoursRendered: dailyHoursRendered,
                todayHours: `${dailyHoursRendered}h 0m`,
                status: status,
                isLate: isLate,
                lateMinutes: isLate ? inMinutes : 0,
                remarks: remarks,
                createdAt: Timestamp.fromDate(timeInDate),
                updatedAt: Timestamp.fromDate(timeOutDate)
            };

            attendanceRecords.push(record);
            generatedDays++;
        }

        // I-move pabalik sa nakaraang araw
        currentDate.setDate(currentDate.getDate() - 1);
    }

    console.log(`Nagpapadala ng ${attendanceRecords.length} records sa Firestore...`);

    const batchSize = 400;
    for (let i = 0; i < attendanceRecords.length; i += batchSize) {
        const batch = db.batch();
        const chunk = attendanceRecords.slice(i, i + batchSize);

        chunk.forEach(record => {
            const docRef = db.collection('attendance').doc();
            batch.set(docRef, record);
        });

        await batch.commit();
        console.log(`Nai-commit na ang batch ${Math.floor(i / batchSize) + 1}`);
    }

    // I-update din ang user status sa Firestore
    await userDocRef.set({
        totalHoursRendered: TOTAL_REQUIRED_HOURS,
        hoursRemaining: 0,
        status: "Completed"
    }, { merge: true });

    console.log(`✅ TAGUMPAY! Naka-generate ng 600 hours (${generatedDays} days) base sa schedule na [${allowedDays.join(', ')}] para kay UID: ${TARGET_STUDENT.userId}`);
    process.exit();
}

seedStudent600HoursBasedOnSchedule().catch(err => {
    console.error("❌ Nagkaroon ng error:", err);
    process.exit(1);
});