/* ==========================================
   OJT DEADLINE SETTINGS
   OJT-LOGS  |  Firebase Connected
   ==========================================
   Loaded as: <script type="module" src="ojt-deadline.js"></script>

   Ang "deadline" dito ay iisang GLOBAL na value na
   ina-apply sa "deadlineDate" field ng LAHAT ng
   estudyante (users/{uid}.deadlineDate) - ito rin
   mismong field na binabasa ng Flask AI
   (app.py, /api/predict-risk) bilang basehan ng
   projection kung aabot ba sa target hours ang
   estudyante bago sumapit ang deadline.

   Hiwalay na dokumento ang nagsisilbing "source of
   truth" ng kasalukuyang global deadline:
       settings/ojtDeadline
           { deadlineDate, note, updatedAt, updatedByName, updatedByUid }
   Ito ang binabasa ng page na ito para malaman kung
   ano ang huling na-set - hindi ito binabasa ng
   app.py (per-student pa rin ang binabasa noon), kaya
   pagka-apply, ina-update din ang bawat estudyante.
========================================== */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ==========================================
   FIREBASE CONFIGURATION (same project)
========================================== */

const firebaseConfig = {
    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",
    authDomain: "ojt-logs-e1892.firebaseapp.com",
    databaseURL: "https://ojt-logs-e1892-default-rtdb.firebaseio.com",
    projectId: "ojt-logs-e1892",
    storageBucket: "ojt-logs-e1892.firebasestorage.app",
    messagingSenderId: "1012575426857",
    appId: "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"
};

// Reuse ang app kung na-initialize na ng shared header (header.js)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const LOGIN_PAGE = "../coordinator_login/coordinator_login.html";

// Default kapag wala pa talagang na-set kahit saan (parehong default
// gamit ng app.py kapag walang deadlineDate ang isang estudyante).
const FALLBACK_DEADLINE = "2026-12-31";

const SETTINGS_DOC = doc(db, "settings", "ojtDeadline");

// Kapareho ng rule ng app.py (/api/predict-risk): kasama ang lahat ng
// user na role == "student" AT pati yung walang "role" field. Hindi
// kayang i-query ng Firestore ang "field na wala", kaya kinukuha lahat
// ng users at sinasala dito.
async function getStudentDocs() {

    const snap = await getDocs(collection(db, "users"));

    return snap.docs.filter((d) => {
        const role = String(d.data().role || "").toLowerCase();
        return role === "student" || !d.data().role;
    });

}


/* ==========================================
   STATE
========================================== */

let currentUser = null;
let coordinatorName = "OJT Coordinator";
let savedDeadline = FALLBACK_DEADLINE;   // huling deadline na naka-save


/* ==========================================
   SMALL HELPERS
========================================== */

const $ = (id) => document.getElementById(id);

let toastTimer = null;

function showToast(message, type = "success") {

    const toast = $("toast");
    const toastMessage = $("toastMessage");
    const toastIcon = $("toastIcon");

    if (!toast) return;

    toastMessage.textContent = message;

    toast.classList.remove("toast-error", "toast-success");
    toast.classList.add(type === "error" ? "toast-error" : "toast-success");

    if (toastIcon) {
        toastIcon.className =
            type === "error"
                ? "fa-solid fa-circle-exclamation"
                : "fa-solid fa-circle-check";
    }

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);

}


// ==========================================
// CUSTOM CONFIRM MODAL
// Pinapalitan nito yung native window.confirm()
// (yung browser-native "127.0.0.1:5501 says..." popup)
// ng sarili nating themed modal. Ginagamit pa rin
// bilang Promise<boolean> para hindi na kailangan
// baguhin yung logic ng caller (if (confirmed) {...}).
// ==========================================

function showConfirmModal(message) {

    return new Promise((resolve) => {

        const overlay = $("confirmOverlay");
        const messageEl = $("confirmMessage");
        const okBtn = $("confirmOkBtn");
        const cancelBtn = $("confirmCancelBtn");

        if (!overlay || !okBtn || !cancelBtn) {
            // Fallback, sakaling wala yung modal markup sa page.
            resolve(window.confirm(message));
            return;
        }

        messageEl.textContent = message;
        overlay.classList.add("show");

        function cleanup(result) {
            overlay.classList.remove("show");
            okBtn.removeEventListener("click", onOk);
            cancelBtn.removeEventListener("click", onCancel);
            overlay.removeEventListener("click", onOverlayClick);
            document.removeEventListener("keydown", onKeydown);
            resolve(result);
        }

        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }

        function onOverlayClick(e) {
            if (e.target === overlay) cleanup(false);
        }

        function onKeydown(e) {
            if (e.key === "Escape") cleanup(false);
            if (e.key === "Enter") cleanup(true);
        }

        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
        overlay.addEventListener("click", onOverlayClick);
        document.addEventListener("keydown", onKeydown);

    });

}


function setBusy(button, busy, busyLabel = "Saving...") {

    if (!button) return;

    if (busy) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML =
            `<i class="fa-solid fa-spinner fa-spin"></i> ${busyLabel}`;
    } else {
        button.disabled = false;
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
        }
    }

}


// "YYYY-MM-DD" (o Firestore Timestamp) -> readable, hal. "December 31, 2026"
function formatDeadline(value) {

    const raw =
        (value && typeof value.toDate === "function")
            ? value.toDate()
            : new Date(`${String(value).slice(0, 10)}T00:00:00`);

    if (Number.isNaN(raw.getTime())) return "—";

    return raw.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });

}


function formatTimestamp(value) {

    if (!value) return "—";

    const dateObj =
        typeof value.toDate === "function" ? value.toDate() : new Date(value);

    if (Number.isNaN(dateObj.getTime())) return "—";

    return dateObj.toLocaleString("en-PH", {
        dateStyle: "medium",
        timeStyle: "short"
    });

}


function daysUntil(dateStr) {

    const target = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);

    if (Number.isNaN(target.getTime())) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Math.round((target - today) / (1000 * 60 * 60 * 24));

}


function paintCountdown(dateStr) {

    const pill = $("deadlineCountdown");

    if (!pill) return;

    const diff = daysUntil(dateStr);

    if (diff === null) {
        pill.style.display = "none";
        return;
    }

    pill.style.display = "inline-flex";

    if (diff > 0) {
        pill.className = "status-pill pill-success";
        pill.innerHTML = `<i class="fa-regular fa-clock"></i> ${diff} day${diff === 1 ? "" : "s"} left`;
    } else if (diff === 0) {
        pill.className = "status-pill pill-warning";
        pill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Due today`;
    } else {
        pill.className = "status-pill pill-warning";
        pill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} overdue`;
    }

}


/* ==========================================
   AUTH GATE
========================================== */

onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    currentUser = user;

    try {

        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.exists() ? userSnap.data() : {};

        coordinatorName =
            userData.name || userData.fullName || user.displayName || "OJT Coordinator";

        await loadCurrentDeadline();

    } catch (error) {

        console.error("Error loading OJT deadline settings:", error);
        showToast("Could not load the current deadline.", "error");

    }

});


/* ==========================================
   LOAD CURRENT DEADLINE
========================================== */

async function loadCurrentDeadline() {

    let deadlineDate = FALLBACK_DEADLINE;
    let note = "";
    let updatedAt = null;
    let updatedByName = "";

    try {

        const snap = await getDoc(SETTINGS_DOC);

        if (snap.exists()) {

            const data = snap.data();

            deadlineDate = data.deadlineDate || FALLBACK_DEADLINE;
            note = data.note || "";
            updatedAt = data.updatedAt || null;
            updatedByName = data.updatedByName || "";

        }

    } catch (error) {

        console.error("Error reading settings/ojtDeadline:", error);

    }

    savedDeadline = String(deadlineDate).slice(0, 10);

    $("currentDeadlineText").textContent =
        formatDeadline(deadlineDate) + (note ? ` — ${note}` : "");

    paintCountdown(deadlineDate);

    $("lastUpdatedText").textContent =
        updatedAt
            ? `${formatTimestamp(updatedAt)}${updatedByName ? " by " + updatedByName : ""}`
            : "Not set yet — showing the system default.";

    // Prefill the form with the current value para madaling i-adjust
    // lang (hal. iextend ng ilang araw) sa halip na simulan sa blangko.
    const input = $("newDeadline");
    if (input && !input.value) {
        input.value = String(deadlineDate).slice(0, 10);
    }

    await loadAffectedCount();

}


async function loadAffectedCount() {

    const label = $("affectedCountText");

    if (!label) return;

    try {

        const studentDocs = await getStudentDocs();

        label.textContent =
            `${studentDocs.length} student account${studentDocs.length === 1 ? "" : "s"}`;

    } catch (error) {

        console.error("Error counting students:", error);
        label.textContent = "—";

    }

}


/* ==========================================
   APPLY NEW DEADLINE
========================================== */

$("applyDeadlineBtn").addEventListener("click", async () => {

    const input = $("newDeadline");
    const noteInput = $("deadlineNote");

    const newDeadline = input.value;

    if (!newDeadline) {
        showToast("Pumili muna ng petsa.", "error");
        input.focus();
        return;
    }

    const formattedForConfirm = formatDeadline(newDeadline);

    // Ilang araw ang inilipat kumpara sa kasalukuyang deadline
    const shiftDays = Math.round(
        (new Date(`${newDeadline}T00:00:00`) - new Date(`${savedDeadline}T00:00:00`))
        / (1000 * 60 * 60 * 24)
    );

    if (shiftDays === 0) {
        showToast("Pareho lang ito sa kasalukuyang deadline.", "error");
        return;
    }

    const shiftText =
        shiftDays > 0
            ? `This extends the deadline by ${shiftDays} day${shiftDays === 1 ? "" : "s"}, giving students more time to catch up. `
            : `This moves the deadline ${Math.abs(shiftDays)} day${Math.abs(shiftDays) === 1 ? "" : "s"} earlier, so more students may be flagged At Risk. `;

    const pastText =
        daysUntil(newDeadline) < 0
            ? "Warning: this date is already in the past. "
            : "";

    const confirmed = await showConfirmModal(
        `Set ${formattedForConfirm} as the OJT deadline for every student account? ` +
        shiftText + pastText +
        `Students with their own custom deadline on the Students page will also be overwritten.`
    );

    if (!confirmed) return;

    const button = $("applyDeadlineBtn");
    setBusy(button, true, "Applying...");

    try {

        // Firestore caps a single batch sa 500 na operations - hinahati
        // dito sa mga pangkat na 450 para may buffer.
        const docs = await getStudentDocs();
        const CHUNK_SIZE = 450;

        for (let i = 0; i < docs.length; i += CHUNK_SIZE) {

            const batch = writeBatch(db);
            const chunk = docs.slice(i, i + CHUNK_SIZE);

            chunk.forEach((studentDoc) => {
                batch.set(
                    studentDoc.ref,
                    { deadlineDate: newDeadline },
                    { merge: true }
                );
            });

            await batch.commit();

        }

        await setDoc(SETTINGS_DOC, {
            deadlineDate: newDeadline,
            note: noteInput.value.trim(),
            updatedAt: serverTimestamp(),
            updatedByName: coordinatorName,
            updatedByUid: currentUser?.uid || null
        });

        showToast(
            `Deadline updated for ${docs.length} student${docs.length === 1 ? "" : "s"}. ` +
            `Open Analytics to see the refreshed risk status.`
        );

        noteInput.value = "";

        await loadCurrentDeadline();

    } catch (error) {

        console.error("Error applying OJT deadline:", error);
        showToast("Something went wrong while saving. Please try again.", "error");

    } finally {

        setBusy(button, false);

    }

});


$("resetDeadlineForm").addEventListener("click", () => {

    $("deadlineNote").value = "";
    loadCurrentDeadline();

});


/* ==========================================
   ENTER KEY SUPPORT
========================================== */

document.addEventListener("keydown", (e) => {

    if (e.key !== "Enter") return;

    const active = document.activeElement;

    if (!active) return;

    if (["newDeadline", "deadlineNote"].includes(active.id)) {
        $("applyDeadlineBtn").click();
    }

});