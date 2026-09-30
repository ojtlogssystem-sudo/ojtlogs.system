import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    getFirestore,
    collection,
    getDocs,
    query,
    where,
    doc,
    writeBatch,
    serverTimestamp,
    deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// ========================================
// FIREBASE (same project as the dashboard)
// ========================================

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


// ========================================
// STATE
// ========================================

// internshipStatus values (same ones the dashboard uses)
const STATUS_COMPLETED = "Completed";
const STATUS_ARCHIVED = "Graduated";

let archivedStudents = [];   // status === "Graduated"
let readyStudents = [];      // status === "Completed" (not yet archived)

let activeTab = "archived";
let searchTerm = "";

// batches na naka-collapse (para hindi mag-reset kapag nag-search)
const collapsedBatches = new Set();

const bodyEl = document.getElementById("archiveBody");
const messageEl = document.getElementById("archiveMessage");


// ========================================
// HELPERS
// ========================================

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

function toDate(value) {

    if (!value) return null;

    if (typeof value.toDate === "function") return value.toDate();

    if (typeof value.seconds === "number") {
        return new Date(value.seconds * 1000);
    }

    const parsed = new Date(value);

    return isNaN(parsed.getTime()) ? null : parsed;

}

function formatDate(value) {

    const date = toDate(value);

    if (!date) return "-";

    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });

}

/*
    BATCH LABEL
    1) Kung may naka-save nang batch sa student
       (batch / batchName / schoolYear / academicYear),
       yun ang gagamitin.
    2) Kung wala, school year ang batch: Hulyo-Hunyo.
       Kinukuha sa completedAt > updatedAt > createdAt.

    Kung iba ang batch system ninyo, dito lang
    ang papalitan.
*/
function getBatchLabel(data) {

    const explicit =
        data.batch ||
        data.batchName ||
        data.schoolYear ||
        data.academicYear;

    if (explicit && String(explicit).trim() !== "") {
        return String(explicit).trim();
    }

    const date =
        toDate(data.completedAt) ||
        toDate(data.updatedAt) ||
        toDate(data.createdAt) ||
        new Date();

    const startYear =
        date.getMonth() >= 6
            ? date.getFullYear()
            : date.getFullYear() - 1;

    return `SY ${startYear}\u2013${startYear + 1}`;

}

function mapStudent(docSnap) {

    const data = docSnap.data();

    const hours = Number(
        data.renderedHours ||
        data.completedHours ||
        data.hoursRendered ||
        0
    );

    return {
        id: docSnap.id,
        name: data.fullName || data.name || data.email || "Unknown Student",
        number: data.studentNumber || data.idNumber || data.studentId || "-",
        section: data.section || "-",
        company: data.companyName || data.company || "-",
        hours: hours,
        batch: getBatchLabel(data),
        archivedAt: data.archivedAt || null,
        completedAt: data.completedAt || null
    };

}

function groupByBatch(students) {

    const map = new Map();

    students.forEach((student) => {

        if (!map.has(student.batch)) {
            map.set(student.batch, []);
        }

        map.get(student.batch).push(student);

    });

    // pinakabago (pinakamalaking taon) muna
    return Array.from(map.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([batch, students]) => ({
            batch,
            students: students.sort(
                (x, y) => x.name.localeCompare(y.name)
            )
        }));

}

function matchesSearch(student) {

    if (!searchTerm) return true;

    const haystack = [
        student.name,
        student.number,
        student.section,
        student.company,
        student.batch
    ].join(" ").toLowerCase();

    return haystack.includes(searchTerm);

}

function showMessage(text, type) {

    messageEl.textContent = text;
    messageEl.className = "archive-message " + type;
    messageEl.hidden = false;

    clearTimeout(showMessage._t);

    showMessage._t = setTimeout(() => {
        messageEl.hidden = true;
    }, 5000);

}


// ========================================
// LOAD DATA
// ========================================

async function loadArchive() {

    try {

        const snapshot = await getDocs(
            query(
                collection(db, "users"),
                where("role", "==", "student")
            )
        );

        archivedStudents = [];
        readyStudents = [];

        snapshot.forEach((docSnap) => {

            const status = docSnap.data().internshipStatus || "";

            if (status === STATUS_ARCHIVED) {
                archivedStudents.push(mapStudent(docSnap));
            } else if (status === STATUS_COMPLETED) {
                readyStudents.push(mapStudent(docSnap));
            }

        });

        render();

    } catch (error) {

        console.error("Error loading batch archive:", error);

        bodyEl.innerHTML = emptyState(
            "fa-triangle-exclamation",
            "Unable to load the archive",
            "Please check your connection and try again."
        );

    }

}


// ========================================
// RENDER
// ========================================

function emptyState(icon, title, text) {

    return `
        <div class="archive-empty">
            <i class="fa-solid ${icon}"></i>
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(text)}</p>
        </div>
    `;

}

function updateSummary() {

    const batchCount = new Set(
        archivedStudents.map((s) => s.batch)
    ).size;

    document.getElementById("sumBatches").textContent = batchCount;
    document.getElementById("sumStudents").textContent = archivedStudents.length;
    document.getElementById("sumReady").textContent = readyStudents.length;
    document.getElementById("readyBadge").textContent = readyStudents.length;

}

function renderTable(students, tab) {

    const rows = students.map((s) => `
        <tr>
            <td class="cell-name">${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.number)}</td>
            <td>${escapeHtml(s.section)}</td>
            <td>${escapeHtml(s.company)}</td>
            <td><span class="hours-pill">${escapeHtml(s.hours)} hrs</span></td>
            <td>${tab === "archived"
                ? escapeHtml(formatDate(s.archivedAt))
                : escapeHtml(formatDate(s.completedAt))}</td>
        </tr>
    `).join("");

    return `
        <div class="batch-table-wrap">
            <table class="batch-table">
                <thead>
                    <tr>
                        <th>Student Name</th>
                        <th>Student No.</th>
                        <th>Section</th>
                        <th>Company</th>
                        <th>Hours</th>
                        <th>${tab === "archived" ? "Archived On" : "Completed On"}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

}

function renderGroups(source, tab) {

    const filtered = source.filter(matchesSearch);

    if (filtered.length === 0) {

        if (searchTerm) {
            return emptyState(
                "fa-magnifying-glass",
                "No matches found",
                "Try a different name, ID, section, or company."
            );
        }

        return tab === "archived"
            ? emptyState(
                "fa-box-archive",
                "No Completed Batch Archive Yet",
                "Archive a completed batch from the \"Ready to Archive\" tab and it will be recorded here."
            )
            : emptyState(
                "fa-clipboard-check",
                "Nothing to archive right now",
                "Students who finish their internship will appear here, grouped by batch."
            );

    }

    return groupByBatch(filtered).map((group) => {

        const key = tab + ":" + group.batch;

        const collapsed =
            collapsedBatches.has(key) ? " collapsed" : "";

        const actionLabel =
            tab === "archived"
                ? `<i class="fa-solid fa-rotate-left"></i> Restore Batch`
                : `<i class="fa-solid fa-box-archive"></i> Archive Batch`;

        const actionClass =
            tab === "archived" ? "secondary" : "primary";

        const count = group.students.length;

        return `
            <div class="batch-group${collapsed}" data-key="${escapeHtml(key)}">

                <div class="batch-header" data-toggle>

                    <div class="batch-header-left">
                        <div class="batch-icon">
                            <i class="fa-solid fa-layer-group"></i>
                        </div>
                        <div>
                            <div class="batch-name">${escapeHtml(group.batch)}</div>
                            <div class="batch-meta">
                                ${count} ${count === 1 ? "student" : "students"}
                            </div>
                        </div>
                    </div>

                    <div class="batch-header-right">
                        <button
                            type="button"
                            class="batch-action ${actionClass}"
                            data-action="${tab}"
                            data-batch="${escapeHtml(group.batch)}"
                        >${actionLabel}</button>
                        <i class="fa-solid fa-chevron-down batch-chevron"></i>
                    </div>

                </div>

                ${renderTable(group.students, tab)}

            </div>
        `;

    }).join("");

}

function render() {

    updateSummary();

    bodyEl.innerHTML =
        activeTab === "archived"
            ? renderGroups(archivedStudents, "archived")
            : renderGroups(readyStudents, "ready");

}


// ========================================
// ARCHIVE / RESTORE A WHOLE BATCH
// ========================================

async function changeBatchStatus(batchLabel, mode, button) {

    const source =
        mode === "ready" ? readyStudents : archivedStudents;

    const targets =
        source.filter((s) => s.batch === batchLabel);

    if (targets.length === 0) return;

    const question =
        mode === "ready"
            ? `Archive ${targets.length} completed student(s) in ${batchLabel}?\n\nThey will move to the Completed Batch Archive and will no longer be counted under Completed.`
            : `Restore ${targets.length} student(s) in ${batchLabel} back to Completed?`;

    if (!window.confirm(question)) return;

    button.disabled = true;

    try {

        // Firestore batch limit = 500 writes
        for (let i = 0; i < targets.length; i += 400) {

            const writer = writeBatch(db);

            targets.slice(i, i + 400).forEach((student) => {

                const ref = doc(db, "users", student.id);

                if (mode === "ready") {

                    writer.update(ref, {
                        internshipStatus: STATUS_ARCHIVED,
                        batch: batchLabel,
                        archivedAt: serverTimestamp()
                    });

                } else {

                    writer.update(ref, {
                        internshipStatus: STATUS_COMPLETED,
                        archivedAt: deleteField()
                    });

                }

            });

            await writer.commit();

        }

        showMessage(
            mode === "ready"
                ? `${batchLabel} was archived.`
                : `${batchLabel} was restored to Completed.`,
            "success"
        );

        await loadArchive();

    } catch (error) {

        console.error("Error updating batch:", error);

        showMessage(
            "Could not update this batch. Please check your permissions and try again.",
            "error"
        );

        button.disabled = false;

    }

}


// ========================================
// EVENTS
// ========================================

bodyEl.addEventListener("click", (event) => {

    const actionBtn = event.target.closest("[data-action]");

    if (actionBtn) {

        event.stopPropagation();

        changeBatchStatus(
            actionBtn.dataset.batch,
            actionBtn.dataset.action,
            actionBtn
        );

        return;

    }

    const header = event.target.closest("[data-toggle]");

    if (header) {

        const group = header.closest(".batch-group");
        const key = group.dataset.key;

        group.classList.toggle("collapsed");

        if (group.classList.contains("collapsed")) {
            collapsedBatches.add(key);
        } else {
            collapsedBatches.delete(key);
        }

    }

});

document.querySelectorAll(".tab-btn").forEach((btn) => {

    btn.addEventListener("click", () => {

        activeTab = btn.dataset.tab;

        document.querySelectorAll(".tab-btn").forEach((b) => {
            b.classList.toggle("active", b === btn);
        });

        render();

    });

});

document.getElementById("archiveSearch").addEventListener("input", (event) => {

    searchTerm = event.target.value.trim().toLowerCase();

    render();

});

document.getElementById("backBtn").addEventListener("click", () => {

    // Sinasabi sa dashboard na isara ang popup na ito
    window.parent.postMessage(
        { type: "closeCompletedBatchArchiveModal" },
        "*"
    );

});


// ========================================
// START (after login check)
// ========================================

onAuthStateChanged(auth, (user) => {

    if (user) {

        loadArchive();

    } else {

        bodyEl.innerHTML = emptyState(
            "fa-lock",
            "Please log in",
            "Sign in as a coordinator to view the archive."
        );

    }

});