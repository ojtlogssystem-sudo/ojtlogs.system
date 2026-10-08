const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ==========================================
// CONFIG
// ==========================================
const TARGET_STUDENT = {
    userId: "O3I90DZCkxWNGsNo2xCk6lNOobE3",
    company: "Motortrade",
    location: "Motortrade"
};

// Kung walang schedule.startDate sa user doc, ito ang gagamitin (YYYY-MM-DD)
const FALLBACK_START_DATE = "2026-08-25";

// TRUE = ipapakita lang kung ano ang gagawin, walang isusulat sa Firestore.
// Gawing false kapag okay na ang output.
const DRY_RUN = true;

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const SAMPLE_TASKS = [
    { title: "Software Development", desc: "Developed dynamic components and updated Firestore logic." },
    { title: "Database Maintenance", desc: "Optimized database structures and checked user permission rules." },
    { title: "UI/UX Design", desc: "Designed responsive layouts using CSS and updated HTML structures." },
    { title: "System Testing", desc: "Performed module integration testing and debugged attendance logs." },
    { title: "Documentation", desc: "Prepared end-user documentation and updated daily OJT report." }
];

function getRandomTaskPair() {
    const a = Math.floor(Math.random() * SAMPLE_TASKS.length);
    let b = Math.floor(Math.random() * SAMPLE_TASKS.length);
    while (b === a) b = Math.floor(Math.random() * SAMPLE_TASKS.length);
    return [SAMPLE_TASKS[a], SAMPLE_TASKS[b]];
}

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const formatAMPM = d => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
const formatDisplay = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// "08:00" -> minutes mula hatinggabi
function toMinutes(t) {
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
}

// Binabasa ang schedule gamit ang structure na sine-save ng Edit OJT Schedule modal
function getSessions(schedule) {
    const sessions = [];
    const m = schedule.morning;
    const a = schedule.afternoon;
    if (m && m.morningEnabled !== false && m.enabled !== false) {
        const i = toMinutes(m.timeIn), o = toMinutes(m.timeOut);
        if (i !== null && o !== null && o > i) sessions.push({ inMin: i, outMin: o });
    }
    if (a && a.afternoonEnabled !== false && a.enabled !== false) {
        const i = toMinutes(a.timeIn), o = toMinutes(a.timeOut);
        if (i !== null && o !== null && o > i) sessions.push({ inMin: i, outMin: o });
    }
    return sessions.sort((x, y) => x.inMin - y.inMin);
}

function atMinutes(baseDate, minutes) {
    const d = new Date(baseDate);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d;
}

async function run() {
    const uid = TARGET_STUDENT.userId;
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) { console.error("❌ Walang user na may UID na yan."); process.exit(1); }

    const userData = userDoc.data();
    const schedule = userData.schedule || {};
    const days = Array.isArray(schedule.days) ? schedule.days : Object.values(schedule.days || {});
    const normalizedDays = days.map(d => String(d).trim().toLowerCase());
    const sessions = getSessions(schedule);

    if (normalizedDays.length === 0 || sessions.length === 0) {
        console.error("❌ Kulang ang schedule (days o oras) ng user.");
        process.exit(1);
    }

    const startStr = schedule.startDate || FALLBACK_START_DATE;
    const [sy, sm, sd] = startStr.split("-").map(Number);
    const startDate = new Date(sy, sm - 1, sd);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const dailyMinutes = sessions.reduce((s, x) => s + (x.outMin - x.inMin), 0);
    const dailyHours = dailyMinutes / 60;
    const firstIn = sessions[0].inMin;
    const lastOut = sessions[sessions.length - 1].outMin;

    console.log(`Start date: ${startStr} | Days: ${days.join(", ")} | ${dailyHours} hrs/day`);

    // Kunin ang existing records ng student (isang where lang, walang index na kailangan)
    const existingSnap = await db.collection("attendance").where("userId", "==", uid).get();
    const existingByDate = new Map();
    existingSnap.forEach(doc => existingByDate.set(doc.data().date, { id: doc.id, ...doc.data() }));

    const toCreate = [];
    const toUpdate = [];

    for (let d = new Date(startDate); d <= yesterday; d.setDate(d.getDate() + 1)) {
        const name = DAY_NAMES[d.getDay()];
        if (!normalizedDays.includes(name) && !normalizedDays.includes(name.slice(0, 3))) continue;

        const dateStr = ymd(d);
        const existing = existingByDate.get(dateStr);

        // May totoong Present/Late/Excused na record na - huwag galawin
        if (existing && String(existing.status).toLowerCase() !== "absent") continue;

        const timeInDate = atMinutes(d, firstIn - Math.floor(Math.random() * 10)); // 0-9 mins maaga
        const timeOutDate = atMinutes(d, lastOut);
        const tasksList = getRandomTaskPair();

        const record = {
            userId: uid,
            userEmail: userData.email || userData.userEmail || "",
            date: dateStr,
            formattedDate: formatDisplay(d),
            company: TARGET_STUDENT.company,
            location: TARGET_STUDENT.location,
            timeIn: formatAMPM(timeInDate),
            timeInRaw: timeInDate.toISOString(),
            timeOut: formatAMPM(timeOutDate),
            timeOutRaw: timeOutDate.toISOString(),
            photoProof: "https://via.placeholder.com/400x300?text=Auto+Generated+Proof",
            tasks: tasksList.map(t => `${t.title}: ${t.desc}`).join(" | "),
            taskList: tasksList,
            hoursRendered: dailyHours,
            todayHours: `${Math.floor(dailyHours)}h ${Math.round((dailyHours % 1) * 60)}m`,
            status: "Present",
            isLate: false,
            lateMinutes: 0,
            remarks: "On-Time / Present",
            isSeeded: true, // para madaling mahanap/mabura ang generated records
            createdAt: Timestamp.fromDate(timeInDate),
            updatedAt: Timestamp.fromDate(timeOutDate)
        };

        if (existing) toUpdate.push({ id: existing.id, record });
        else toCreate.push(record);
    }

    console.log(`Gagawa ng ${toCreate.length} bagong record, mag-u-update ng ${toUpdate.length} Absent record.`);
    [...toCreate, ...toUpdate.map(u => u.record)].forEach(r => console.log(`  - ${r.date} (${r.timeIn} - ${r.timeOut})`));

    if (DRY_RUN) {
        console.log("\nDRY RUN lang ito. Walang isinulat. Gawing DRY_RUN = false para i-apply.");
        process.exit();
    }

    const ops = [
        ...toCreate.map(r => ({ ref: db.collection("attendance").doc(), data: r, merge: false })),
        ...toUpdate.map(u => ({ ref: db.collection("attendance").doc(u.id), data: u.record, merge: true }))
    ];
    for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch();
        ops.slice(i, i + 400).forEach(op => batch.set(op.ref, op.data, { merge: op.merge }));
        await batch.commit();
    }

    console.log("✅ Tapos na.");
    process.exit();
}

run().catch(err => { console.error("❌ Error:", err); process.exit(1); });