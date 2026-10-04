import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore, collection, getDocs, query, where, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========================================
   FIREBASE
======================================== */
const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ========================================
   STATE
======================================== */
const DEMO = new URLSearchParams(location.search).has("demo");
const ALL = "__all__";

let students = [];          // normalized, every student in a batch (Completed + Incomplete)
let activeTab = "ready";    // "ready" | "archived"
const collapsed = new Set();// collapsed batch keys, per tab: "ready|SY 2026–2027"
let pendingBatch = null;
const pageNum = new Map();    // current page per batch card
const pageSize = new Map();   // rows per page per batch card: "auto" | "5" | "10" ...
let lastSig = "";
const batchSearch = new Map();// search text per batch card, key: "ready|AY 2024-2025"

const filters = { search: "", batch: ALL, section: ALL, company: ALL };
const sorts = { batches: "batch-desc", students: "name-asc" };

const $ = (id) => document.getElementById(id);

/* ========================================
   DATA ADAPTER
   >>> Kung iba ang field names sa Firestore mo,
       dito lang ang babaguhin. <<<
======================================== */
function normalize(id, d) {
    const completed = d.completedAt || d.completedDate || d.dateCompleted || null;
    const archived = d.archivedAt || null;

    /*
       STATUS ng student sa archive:
       - "Completed"  -> natapos ang OJT
       - "Incomplete" -> hindi nakatapos
       Kapag na-archive na, ang naka-save na archiveStatus
       ang sinusunod para hindi na magbago.
    */
    const isDone = d.status === "Completed" || d.internshipStatus === "Completed";
    const status = d.archived === true && d.archiveStatus
        ? d.archiveStatus
        : (isDone ? "Completed" : "Incomplete");

    return {
        id,
        name: d.fullName || d.name || d.studentName || "Unknown Student",
        number: String(d.studentNumber || d.idNumber || "-"),
        section: d.section || "-",
        company: d.companyName || d.company || "-",
        status,
        // Completed lang ang may default na required hours;
        // ang Incomplete ay ipapakita ang totoong na-render na hours.
        hours: status === "Completed" ? getArchiveHours(d) : getRenderedHours(d),
        batch: batchFromNumber(d.studentNumber || d.idNumber) || d.batch || "Unassigned Batch",
        completedOn: toDate(completed),
        archived: d.archived === true,
        archivedOn: toDate(archived),
        autoArchived: d.autoArchived === true,
        allowContinueHours: d.allowContinueHours === true
    };
}

/*
   BATCH = Academic Year ng pagtatapos (OJT / graduation).
   Ang year sa unahan ng Student No. ay ang taon ng pagpasok;
   4-year course, kaya ang OJT ay sa ika-4 na taon:

   "2021-01-09980" -> "AY 2024-2025"
   "2022-01-11872" -> "AY 2025-2026"
   "2023-01-30233" -> "AY 2026-2027"
*/
const COURSE_YEARS = 4;

function batchFromNumber(num) {
    const m = String(num || "").trim().match(/^(\d{4})/);
    if (!m) return null;
    const start = Number(m[1]) + COURSE_YEARS - 1;
    return `AY ${start}-${start + 1}`;
}

/* ========================================
   RENDERED HOURS (single source of truth)
   Kinukuha ang unang field na may valid
   na numero, hindi lang ang unang truthy,
   at hindi kailanman negative/NaN.
======================================== */

function parseHours(value) {

    if (value === undefined || value === null || value === "") {
        return null;
    }

    // Tinatanggap din ang "600", "600 hrs", "1,200"
    const n = typeof value === "number"
        ? value
        : parseFloat(String(value).replace(/,/g, ""));

    return Number.isFinite(n) && n >= 0 ? n : null;

}

function getRenderedHours(data) {

    /*
        Kunin ang PINAKAMALAKI sa lahat ng hours fields.
        Dati, ang unang valid ang ginagamit, kaya kapag
        may lumang "renderedHours: 0" pero nasa
        "completedHours" ang totoong 600, 0 ang lumalabas.
    */

    const values = [
        data.renderedHours,
        data.hoursRendered,
        data.completedHours,
        data.totalHours
    ]
        .map(parseHours)
        .filter((n) => n !== null);

    return values.length ? Math.max(...values) : 0;

}

/*
    Para sa Batch Archive:
    Completed na ang student, kaya hindi dapat 0 ang
    lumabas. Kapag walang naka-save na hours, ang
    required hours ang ipapakita (default 600).
*/

function getArchiveHours(data) {

    const rendered = getRenderedHours(data);

    if (rendered > 0) {
        return rendered;
    }

    return (
        parseHours(data.requiredHours) ||
        parseHours(data.requiredHoursTotal) ||
        parseHours(data.targetHours) ||
        600
    );

}


function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    const dt = new Date(v);
    return isNaN(dt) ? null : dt;
}

async function loadStudents() {
    if (DEMO) return demoData();

    await new Promise((resolve) => {
        const off = onAuthStateChanged(auth, () => { off(); resolve(); });
    });

    // Kunin lahat ng students (hindi lang Completed),
    // para makasama sa archive ang mga hindi nakatapos.
    const q = query(
        collection(db, "users"),
        where("role", "==", "student")
    );
    const snap = await getDocs(q);
    const all = snap.docs
        .filter((s) => s.data().accountDisabled !== true || s.data().archived === true)
        .map((s) => normalize(s.id, s.data()));
    await autoArchiveEndedBatches(all);
    return keepArchiveStudents(all);
}

/*
   Archived students: laging kasama.
   Hindi pa archived: kasama lang kung ang batch nila ay may
   nakatapos na (ibig sabihin tapos na ang OJT ng batch),
   para hindi mapasama ang batch na ongoing pa.
*/
function keepArchiveStudents(list) {
    const endedBatches = new Set(
        list.filter((s) => !s.archived && s.status === "Completed").map((s) => s.batch)
    );
    return list.filter((s) => s.archived || endedBatches.has(s.batch) || s.allowContinueHours);
}

/* ========================================
   AUTO-ARCHIVE kapag tapos na ang Academic Year
   Hal. pagkatapos ng June 30, 2025, ang "AY 2024-2025"
   ay otomatikong mapupunta sa Archived Batches.
   - Natapos ang OJT   -> archiveStatus: "Completed"
   - Hindi natapos     -> archiveStatus: "Incomplete"
   Hindi isasama ang student na pinayagan ng coordinator
   na magpatuloy ng hours (allowContinueHours) hangga't
   hindi pa siya Completed.
   >>> Palitan dito kung iba ang petsa ng pagtatapos ng AY. <<<
======================================== */
const AY_END_MONTH = 6;   // June
const AY_END_DAY = 30;

// "AY 2024-2025" -> June 30, 2025 (11:59 PM). Walang petsa kung hindi valid ang batch.
function batchEndDate(batchName) {
    const m = String(batchName || "").match(/(\d{4})\s*[-\u2013\u2014]\s*(\d{4})/);
    if (!m) return null;
    return new Date(Number(m[2]), AY_END_MONTH - 1, AY_END_DAY, 23, 59, 59);
}

function hasBatchEnded(batchName, now = new Date()) {
    const end = batchEndDate(batchName);
    return !!end && now > end;
}

async function autoArchiveEndedBatches(list) {
    const now = new Date();
    const targets = list.filter((s) =>
        !s.archived &&
        hasBatchEnded(s.batch, now) &&
        !(s.allowContinueHours && s.status !== "Completed")
    );
    if (!targets.length) return;

    const markDone = (s) => { s.archived = true; s.autoArchived = true; s.archivedOn = now; };

    if (DEMO) { targets.forEach(markDone); return; }

    const results = await Promise.allSettled(targets.map((s) =>
        updateDoc(doc(db, "users", s.id), {
            archived: true,
            archivedAt: serverTimestamp(),
            archiveStatus: s.status,   // "Completed" o "Incomplete"
            autoArchived: true
        })
    ));
    results.forEach((r, i) => {
        if (r.status === "fulfilled") markDone(targets[i]);
        else console.error("Auto-archive failed for", targets[i].id, r.reason);
    });
}

/* ========================================
   PERMISSION: pwedeng ituloy ng student ang hours
   kahit tapos na ang OJT / academic year.
   - Allow : allowContinueHours = true at ibabalik sa active
             (un-archive) para makita ulit sa Students page at
             hindi na ma-auto-archive hangga't hindi Completed.
   - Revoke: allowContinueHours = false; kung tapos na ang AY,
             ibabalik agad sa archive bilang Incomplete.
======================================== */
const savingPermission = new Set();

// Sa mga Incomplete lang na student ng batch na tapos na ang AY
const canGivePermission = (s) => s.status !== "Completed" && hasBatchEnded(s.batch);

async function setContinuePermission(id, allow) {
    const s = students.find((x) => x.id === id);
    if (!s || savingPermission.has(id)) return;
    savingPermission.add(id);
    render();

    try {
        const now = new Date();
        let payload;
        if (allow) {
            payload = {
                allowContinueHours: true,
                continueHoursGrantedAt: now.toISOString(),
                continueHoursGrantedBy: (auth.currentUser && auth.currentUser.email) || null,
                archived: false,
                autoArchived: false,
                archivedAt: null,
                archiveStatus: null
            };
        } else {
            payload = {
                allowContinueHours: false,
                continueHoursGrantedAt: null,
                continueHoursGrantedBy: null
            };
            if (hasBatchEnded(s.batch)) {
                Object.assign(payload, {
                    archived: true,
                    archivedAt: serverTimestamp(),
                    archiveStatus: s.status,
                    autoArchived: true
                });
            }
        }

        if (!DEMO) await updateDoc(doc(db, "users", id), payload);

        s.allowContinueHours = allow;
        if (allow) {
            s.archived = false; s.autoArchived = false; s.archivedOn = null;
        } else if (hasBatchEnded(s.batch)) {
            s.archived = true; s.autoArchived = true; s.archivedOn = now;
        }

        toast(allow
            ? `${s.name} can now continue their hours (moved back to Ready to Archive).`
            : `Permission revoked for ${s.name}. Moved back to the archive as Incomplete.`);
    } catch (err) {
        console.error("Permission update failed:", err);
        toast("Failed to update permission. Please try again.");
    } finally {
        savingPermission.delete(id);
        fullRender();
    }
}

function permissionCell(s) {
    if (!canGivePermission(s)) return `<span class="perm-na">&mdash;</span>`;
    const busy = savingPermission.has(s.id) ? "disabled" : "";
    if (s.allowContinueHours) {
        return `<div class="perm-wrap">
            <span class="perm-allowed"><i class="fa-solid fa-unlock"></i> Allowed</span>
            <button type="button" class="perm-btn revoke" data-permission="revoke" data-id="${esc(s.id)}" ${busy}>
                <i class="fa-solid fa-lock"></i> Revoke
            </button>
        </div>`;
    }
    return `<button type="button" class="perm-btn allow" data-permission="allow" data-id="${esc(s.id)}" ${busy}>
        <i class="fa-solid fa-unlock"></i> Allow to Continue
    </button>`;
}

async function archiveBatchInDb(batchName) {
    const targets = students.filter((s) => !s.archived && s.batch === batchName);
    if (DEMO) { targets.forEach((s) => { s.archived = true; s.archivedOn = new Date(); }); return; }

    await Promise.all(targets.map((s) =>
        updateDoc(doc(db, "users", s.id), {
            archived: true,
            archivedAt: serverTimestamp(),
            archiveStatus: s.status   // "Completed" o "Incomplete"
        })
    ));
    targets.forEach((s) => { s.archived = true; s.archivedOn = new Date(); });
}

function demoData() {
    const mk = (i, n, no, sec, co, b, h, d, arch, status = "Completed") => ({
        id: "d" + i, name: n, number: no, section: sec, company: co, hours: h, batch: batchFromNumber(no), status,
        completedOn: d ? new Date(d) : null, archived: !!arch, archivedOn: arch ? new Date(arch) : null
    });
    return [
        mk(1, "Dave Lopez", "2026-01-01334", "BSIT 403", "Globe", "SY 2026–2027", 600, null),
        mk(2, "Samantha Reyes", "2023-01-30233", "BSIT 406", "Globe", "SY 2026–2027", 600, null),
        mk(7, "Joshua Tan", "2026-01-01410", "BSIT 404", "Smart", "SY 2026–2027", 240, null, null, "Incomplete"),
        mk(3, "Marco Dela Cruz", "2022-01-11872", "BSIT 401", "Accenture", "SY 2025–2026", 600, "2026-05-20", "2026-06-02"),
        mk(4, "Angela Santos", "2022-01-12005", "BSIT 402", "Globe", "SY 2025–2026", 620, "2026-05-22", "2026-06-02"),
        mk(5, "Paolo Rivera", "2022-01-13411", "BSCS 401", "Smart", "SY 2025–2026", 600, "2026-05-18", "2026-06-02"),
        mk(6, "Kristine Bautista", "2021-01-09980", "BSIT 405", "Accenture", "SY 2024–2025", 600, "2025-05-30", "2025-06-10"),
        mk(8, "Leo Mendoza", "2021-01-10122", "BSIT 407", "Globe", "SY 2024–2025", 310, null, "2025-06-10", "Incomplete")
    ];
}

/* ========================================
   HELPERS
======================================== */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function hl(text, query = filters.search) {
    const t = esc(text);
    const q = String(query || "").trim();
    if (!q) return t;
    const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    return t.replace(re, "<mark>$1</mark>");
}

const formatHours = (v) =>
    (Math.round((Number(v) || 0) * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

const fmtDate = (d) => d ? d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "-";
const inTab = (s) => (activeTab === "archived") === s.archived;

// "SY 2026–2027" -> 2026 for sorting; fallback to text compare
const batchKey = (b) => { const m = String(b).match(/\d{4}/); return m ? Number(m[0]) : -1; };

function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
}

/* ========================================
   FILTER + SORT
======================================== */
function matches(s) {
    if (filters.batch !== ALL && s.batch !== filters.batch) return false;
    if (filters.section !== ALL && s.section !== filters.section) return false;
    if (filters.company !== ALL && s.company !== filters.company) return false;
    const q = filters.search.trim().toLowerCase();
    if (q) {
        const hay = [s.name, s.number, s.section, s.company, s.batch, s.status].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
    }
    return true;
}

function studentComparator(mode) {
    const [key, dir] = mode.split("-");
    const m = dir === "desc" ? -1 : 1;
    const str = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    const date = (x) => (x ? x.getTime() : 0);
    return (a, b) => {
        switch (key) {
            case "name": return m * str(a.name, b.name);
            case "number": return m * str(a.number, b.number);
            case "section": return m * str(a.section, b.section) || str(a.name, b.name);
            case "company": return m * str(a.company, b.company) || str(a.name, b.name);
            case "hours": return m * (a.hours - b.hours) || str(a.name, b.name);
            case "completed": return m * (date(a.completedOn) - date(b.completedOn)) || str(a.name, b.name);
        }
        return 0;
    };
}

function buildGroups() {
    const map = new Map();
    students.filter(inTab).filter(matches).forEach((s) => {
        if (!map.has(s.batch)) map.set(s.batch, []);
        map.get(s.batch).push(s);
    });

    const cmp = studentComparator(sorts.students);
    let groups = [...map.entries()].map(([batch, list]) => ({ batch, list: list.sort(cmp) }));

    const [key, dir] = sorts.batches.split("-");
    const m = dir === "desc" ? -1 : 1;
    groups.sort((a, b) => key === "count"
        ? m * (a.list.length - b.list.length)
        : m * (batchKey(a.batch) - batchKey(b.batch) || a.batch.localeCompare(b.batch)));
    return groups;
}

/* ========================================
   RENDER
======================================== */
function fillSelect(el, label, values, current) {
    const opts = [`<option value="${ALL}">All ${label}</option>`]
        .concat(values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`));
    el.innerHTML = opts.join("");
    el.value = values.includes(current) ? current : ALL;
    return el.value;
}

function refreshFilterOptions() {
    const pool = students.filter(inTab);
    const uniq = (k) => [...new Set(pool.map((s) => s[k]).filter((v) => v && v !== "-"))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    filters.batch = fillSelect($("filterBatch"), "academic years", uniq("batch").sort((a, b) => batchKey(b) - batchKey(a)), filters.batch);
    filters.section = fillSelect($("filterSection"), "sections", uniq("section"), filters.section);
    filters.company = fillSelect($("filterCompany"), "companies", uniq("company"), filters.company);
}

function renderStats() {
    const arch = students.filter((s) => s.archived);
    const ready = students.filter((s) => !s.archived);
    const batchCount = new Set(arch.map((s) => s.batch)).size;
    $("statBatches").textContent = batchCount;
    $("statStudents").textContent = arch.length;
    $("statReady").textContent = ready.length;
    $("tabCountArchived").textContent = batchCount;
    $("tabCountReady").textContent = ready.length;
}

const COLS = [
    ["name", "Student Name"], ["number", "Student No."], ["section", "Section"],
    ["company", "Company"], ["hours", "Hours"], ["status", "Status"], ["permission", "Permission"]
];

function headerCell([, label]) {
    return `<th>${label}</th>`;
}

/* ========================================
   PAGINATION
======================================== */
// "Auto" = ilang rows ang kasya sa taas ng screen
const autoSize = () => Math.max(5, Math.min(15, Math.floor((window.innerHeight - 430) / 54)));
const PAGE_SIZES = ["auto", "5", "10", "20", "50"];

function pageList(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const keep = [...new Set([1, total, cur - 1, cur, cur + 1])]
        .filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    keep.forEach((n, i) => {
        if (i && n - keep[i - 1] > 1) out.push("…");
        out.push(n);
    });
    return out;
}

function footerHtml(key, total, page, pages, size, sizeMode) {
    if (!total) return "";
    const from = (page - 1) * size + 1;
    const to = Math.min(total, page * size);
    const k = esc(key);
    const nums = pageList(page, pages).map((n) => n === "…"
        ? `<span class="pg-gap">…</span>`
        : `<button type="button" class="pg-btn ${n === page ? "active" : ""}" data-page="${n}" data-key="${k}">${n}</button>`
    ).join("");
    return `
        <div class="table-foot">
            <div class="foot-info">Showing ${from} to ${to} of ${total} record${total > 1 ? "s" : ""}</div>
            <div class="pager">
                <button type="button" class="pg-btn" data-page="${page - 1}" data-key="${k}" ${page <= 1 ? "disabled" : ""}>
                    <i class="fa-solid fa-chevron-left"></i> Prev
                </button>
                ${nums}
                <button type="button" class="pg-btn" data-page="${page + 1}" data-key="${k}" ${page >= pages ? "disabled" : ""}>
                    Next <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
            <label class="rows-per-page">
                <span>Rows per page:</span>
                <select data-page-size data-key="${k}">
                    ${PAGE_SIZES.map((v) => `<option value="${v}" ${v === sizeMode ? "selected" : ""}>${v === "auto" ? "Auto" : v}</option>`).join("")}
                </select>
            </label>
        </div>`;
}

function render() {
    // Kapag nagbago ang filter / sort / search, bumalik sa page 1
    const sig = JSON.stringify([filters, sorts, [...batchSearch]]);
    if (sig !== lastSig) { pageNum.clear(); lastSig = sig; }

    renderStats();
    const groups = buildGroups();
    const total = groups.reduce((n, g) => n + g.list.length, 0);
    const list = $("batchList");

    $("resultLine").textContent = total
        ? `Showing ${total} student${total > 1 ? "s" : ""} in ${groups.length} batch${groups.length > 1 ? "es" : ""}`
        : "";

    if (!groups.length) {
        const anyInTab = students.some(inTab);
        list.innerHTML = `
            <div class="state-box">
                <i class="fa-solid ${anyInTab ? "fa-filter-circle-xmark" : "fa-box-open"}"></i>
                <h3>${anyInTab ? "No results match your filters" : activeTab === "ready" ? "Nothing ready to archive" : "No archived batches yet"}</h3>
                <p>${anyInTab ? "Try changing or resetting the filters." : "Batches will appear here once their OJT has ended."}</p>
            </div>`;
        return;
    }

    list.innerHTML = groups.map(({ batch, list: rows }) => {
        const key = activeTab + "|" + batch;
        const bq = (batchSearch.get(key) || "").trim();
        const bqLower = bq.toLowerCase();
        const isCollapsed = collapsed.has(key);
        const shown = bq
            ? rows.filter((r) => [r.name, r.number, r.section, r.company, r.status]
                .join(" ").toLowerCase().includes(bqLower))
            : rows;
        const archivedOn = rows.map((r) => r.archivedOn).filter(Boolean).sort((a, b) => b - a)[0];

        const action = activeTab === "ready"
            ? `<button class="btn btn-primary btn-sm" data-archive="${esc(batch)}" type="button">
                   <i class="fa-solid fa-box-archive"></i> Archive Batch
               </button>`
            : `<span class="archived-badge"><i class="fa-solid fa-circle-check"></i> ${rows.some((r) => r.autoArchived) ? "Auto-archived" : "Archived"} ${fmtDate(archivedOn)}</span>`;

        const sizeMode = pageSize.get(key) || "auto";
        const size = sizeMode === "auto" ? autoSize() : Number(sizeMode);
        const pages = Math.max(1, Math.ceil(shown.length / size));
        const page = Math.min(pageNum.get(key) || 1, pages);
        const start = (page - 1) * size;
        const pageRows = shown.slice(start, start + size);

        const doneCount = rows.filter((r) => r.status === "Completed").length;
        const incCount = rows.length - doneCount;
        const breakdown = incCount
            ? ` · ${doneCount} Completed · ${incCount} Incomplete`
            : ` · ${doneCount} Completed`;

        const body = pageRows.map((s, i) => {
            const done = s.status === "Completed";
            return `
            <tr>
                <td class="num-col">${start + i + 1}</td>
                <td class="name">${hl(s.name, bq || filters.search)}</td>
                <td>${hl(s.number, bq || filters.search)}</td>
                <td>${hl(s.section, bq || filters.search)}</td>
                <td>${hl(s.company, bq || filters.search)}</td>
                <td><span class="hours-pill ${done ? "" : "incomplete"}">${formatHours(s.hours)} hrs</span></td>
                <td><span class="status-pill ${done ? "" : "incomplete"}"><i class="fa-solid ${done ? "fa-circle-check" : "fa-circle-xmark"}"></i> ${s.status}</span></td>
                <td>${permissionCell(s)}</td>
            </tr>`;
        }).join("");

        return `
        <section class="batch-card ${isCollapsed ? "collapsed" : ""}" data-key="${esc(key)}">
            <div class="batch-head" data-toggle>
                <div class="batch-info">
                    <div class="batch-icon"><i class="fa-solid fa-layer-group"></i></div>
                    <div>
                        <h2>${esc(batch)}</h2>
                        <p>${bq ? `Showing ${shown.length} of ${rows.length} students` : `${rows.length} student${rows.length > 1 ? "s" : ""}${breakdown}`}</p>
                    </div>
                </div>
                <div class="batch-actions">
                    <label class="batch-search">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <input type="search" data-batch-search data-key="${esc(key)}"
                               value="${esc(bq)}" placeholder="Search student..." autocomplete="off">
                    </label>
                    ${action}
                    <i class="fa-solid fa-chevron-down chevron"></i>
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <colgroup>
                        <col style="width:56px"><col style="width:18%"><col style="width:14%">
                        <col style="width:11%"><col style="width:13%"><col style="width:9%"><col style="width:12%"><col>
                    </colgroup>
                    <thead><tr><th class="num-col">#</th>${COLS.map(headerCell).join("")}</tr></thead>
                    <tbody>${body || `<tr><td colspan="8" class="no-match">No student found for "${esc(bq)}"</td></tr>`}</tbody>
                </table>
            </div>
            ${footerHtml(key, shown.length, page, pages, size, sizeMode)}
        </section>`;
    }).join("");
}

function fullRender() { refreshFilterOptions(); render(); }

/* ========================================
   EVENTS
======================================== */
$("searchInput").addEventListener("input", (e) => { filters.search = e.target.value; render(); });
$("filterBatch").addEventListener("change", (e) => { filters.batch = e.target.value; render(); });
$("filterSection").addEventListener("change", (e) => { filters.section = e.target.value; render(); });
$("filterCompany").addEventListener("change", (e) => { filters.company = e.target.value; render(); });
$("sortBatches").addEventListener("change", (e) => { sorts.batches = e.target.value; render(); });
$("sortStudents").addEventListener("change", (e) => { sorts.students = e.target.value; render(); });

$("resetFilters").addEventListener("click", () => {
    filters.search = ""; filters.batch = filters.section = filters.company = ALL;
    batchSearch.clear();
    sorts.batches = "batch-desc"; sorts.students = "name-asc";
    $("searchInput").value = "";
    $("sortBatches").value = sorts.batches; $("sortStudents").value = sorts.students;
    fullRender();
});

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    fullRender();
}));

// Search student sa loob ng batch card
$("batchList").addEventListener("input", (e) => {
    const input = e.target.closest("[data-batch-search]");
    if (!input) return;
    const key = input.dataset.key;
    const caret = input.selectionStart;
    batchSearch.set(key, input.value);
    render();
    // Ibalik ang focus at cursor dahil nire-render ang list
    const again = [...document.querySelectorAll("[data-batch-search]")].find((el) => el.dataset.key === key);
    if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
});

$("batchList").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-page-size]");
    if (!sel) return;
    pageSize.set(sel.dataset.key, sel.value);
    pageNum.delete(sel.dataset.key);
    render();
});

let resizeT;
window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (students.length) render(); }, 150);
});

$("batchList").addEventListener("click", (e) => {
    // Huwag mag-collapse kapag search box ang pinindot
    if (e.target.closest(".batch-search")) return;

    // Allow / Revoke permission to continue hours
    const permBtn = e.target.closest("[data-permission]");
    if (permBtn) {
        e.stopPropagation();
        if (!permBtn.disabled) setContinuePermission(permBtn.dataset.id, permBtn.dataset.permission === "allow");
        return;
    }

    // Pagination
    const pg = e.target.closest("[data-page]");
    if (pg) {
        if (!pg.disabled) { pageNum.set(pg.dataset.key, Number(pg.dataset.page)); render(); }
        return;
    }
    // Archive button
    const archBtn = e.target.closest("[data-archive]");
    if (archBtn) {
        e.stopPropagation();
        pendingBatch = archBtn.dataset.archive;
        const inBatch = students.filter((s) => !s.archived && s.batch === pendingBatch);
        const n = inBatch.length;
        const inc = inBatch.filter((s) => s.status !== "Completed").length;
        $("confirmTitle").textContent = `Archive ${pendingBatch}?`;
        $("confirmText").textContent = `All ${n} student${n > 1 ? "s" : ""} in this batch will be moved to Batch Archive`
            + (inc ? ` (${n - inc} Completed, ${inc} Incomplete).` : ".");
        $("confirmOverlay").hidden = false;
        return;
    }
    // Collapse / expand
    const head = e.target.closest("[data-toggle]");
    if (head) {
        const key = head.closest(".batch-card").dataset.key;
        collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
        head.closest(".batch-card").classList.toggle("collapsed");
    }
});

$("confirmCancel").addEventListener("click", () => { $("confirmOverlay").hidden = true; pendingBatch = null; });
$("confirmOverlay").addEventListener("click", (e) => { if (e.target.id === "confirmOverlay") $("confirmCancel").click(); });

$("confirmOk").addEventListener("click", async () => {
    if (!pendingBatch) return;
    const name = pendingBatch;
    $("confirmOk").disabled = true;
    try {
        await archiveBatchInDb(name);
        toast(`${name} archived`);
        fullRender();
    } catch (err) {
        console.error("Archive failed:", err);
        toast("Failed to archive batch. Please try again.");
    } finally {
        $("confirmOk").disabled = false;
        $("confirmOverlay").hidden = true;
        pendingBatch = null;
    }
});

$("backBtn").addEventListener("click", () => {
    window.parent.postMessage({ type: "closeCompletedBatchArchiveModal" }, "*");
});

/* ========================================
   INIT
======================================== */
(async function init() {
    $("batchList").innerHTML = `<div class="state-box"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading archive...</p></div>`;
    try {
        students = await loadStudents();
        fullRender();
    } catch (err) {
        console.error("Error loading archive:", err);
        $("batchList").innerHTML = `<div class="state-box"><i class="fa-solid fa-triangle-exclamation"></i><h3>Couldn't load the archive</h3><p>Please refresh and try again.</p></div>`;
    }
})();