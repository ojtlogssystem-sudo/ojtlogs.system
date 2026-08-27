import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, getDocs, getDoc, query, where, addDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey:"AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8", authDomain:"ojt-logs-e1892.firebaseapp.com", projectId:"ojt-logs-e1892", storageBucket:"ojt-logs-e1892.firebasestorage.app", messagingSenderId:"1012575426857", appId:"1:1012575426857:web:c2d6dbcdc0dc0ad965ff38" });
const db = getFirestore(app);
const token = new URLSearchParams(location.search).get("token");
const isPreview = new URLSearchParams(location.search).get("preview") === "1";
let accessDoc, accessData, chosenIntern;
const $ = (id) => document.getElementById(id);

function showError(message) { $("loadingState").classList.add("hidden"); $("errorText").textContent = message; $("errorState").classList.remove("hidden"); }
function toDate(value) { return value?.toDate ? value.toDate() : new Date(value || 0); }
function escapeHtml(value = "") { const el = document.createElement("div"); el.textContent = value; return el.innerHTML; }

async function loadAccess() {
    if (isPreview) {
        accessData = {
            companyId: "preview-company",
            companyName: "Sample Partner Company",
            interns: [
                { id: "preview-1", fullName: "Juan Dela Cruz", studentNumber: "2023-00001", course: "BSIT" },
                { id: "preview-2", fullName: "Maria Santos", studentNumber: "2023-00002", course: "BSIT" }
            ]
        };
        $("companyName").textContent = `${accessData.companyName} (Preview)`;
        accessData.interns.forEach((intern) => { const option=document.createElement("option"); option.value=intern.id; option.textContent=`${intern.fullName} (${intern.studentNumber})`; $("internSelect").append(option); });
        $("loadingState").classList.add("hidden"); $("evaluationContent").classList.remove("hidden");
        return;
    }
    if (!token) return showError("The email link is incomplete. Please use the complete link sent by the coordinator.");
    try {
        const found = await getDocs(query(collection(db, "guestEvaluationAccess"), where("token", "==", token)));
        if (found.empty) return showError("This guest link is invalid or has expired.");
        accessDoc = found.docs[0]; accessData = accessDoc.data();
        if (accessData.submittedAt) return showError("This evaluation has already been submitted.");
        $("companyName").textContent = accessData.companyName;
        accessData.interns.forEach((intern) => { const option=document.createElement("option"); option.value=intern.id; option.textContent=`${intern.fullName}${intern.studentNumber ? ` (${intern.studentNumber})` : ""}`; $("internSelect").append(option); });
        $("loadingState").classList.add("hidden"); $("evaluationContent").classList.remove("hidden");
    } catch (error) { console.error(error); showError("We could not open this guest link. Please ask the coordinator to check its access settings."); }
}

$("internSelect").addEventListener("change", async (event) => {
    chosenIntern = accessData.interns.find((intern) => intern.id === event.target.value);
    if (!chosenIntern) return;
    $("historyPanel").classList.remove("hidden"); $("evaluationForm").classList.remove("hidden"); $("taskHistory").innerHTML = ""; $("historySummary").textContent = "Loading submitted task records...";
    if (isPreview) {
        $("historySummary").textContent = "3 sample attendance records";
        $("taskHistory").innerHTML = `
            <article class="task"><time>August 12, 2026</time>Documentation: Updated the equipment inventory.</article>
            <article class="task"><time>August 11, 2026</time>Technical Support: Assisted with workstation troubleshooting.</article>
            <article class="task"><time>August 8, 2026</time>Administrative: Organized department files.</article>`;
        return;
    }
    try {
        const logs = await getDocs(query(collection(db, "attendance"), where("userId", "==", chosenIntern.id)));
        const entries = logs.docs.map((snap) => snap.data()).sort((a,b) => toDate(b.createdAt || b.date) - toDate(a.createdAt || a.date));
        $("historySummary").textContent = `${entries.length} attendance record${entries.length === 1 ? "" : "s"} found`;
        $("taskHistory").innerHTML = entries.length ? entries.map((entry) => `<article class="task"><time>${escapeHtml(entry.formattedDate || toDate(entry.createdAt || entry.date).toLocaleDateString())}</time>${escapeHtml(entry.tasks || "No task details submitted for this day.")}</article>`).join("") : '<p class="intro">No task records were submitted for this intern.</p>';
    } catch (error) { console.error(error); $("historySummary").textContent = "Task history could not be loaded."; $("taskHistory").innerHTML = '<p class="intro">Please continue with the evaluation or contact the coordinator.</p>'; }
});

$("evaluationForm").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!chosenIntern) return;
    const button = event.submitter; button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
    const form = new FormData(event.currentTarget);
    if (isPreview) {
        $("evaluationContent").classList.add("hidden"); $("successState").classList.remove("hidden");
        return;
    }
    try {
        await addDoc(collection(db, "evaluations"), { companyId:accessData.companyId, companyName:accessData.companyName, guestAccessId:accessDoc.id, internId:chosenIntern.id, internName:chosenIntern.fullName, quality:Number(form.get("quality")), attendance:Number(form.get("attendance")), teamwork:Number(form.get("teamwork")), comments:form.get("comments").trim(), submittedAt:serverTimestamp(), submittedBy:"company_supervisor" });

        await addDoc(collection(db, "logs"), {
            type: "evaluation",
            action: "Supervisor Evaluation Completed",
            title: "Supervisor Evaluation Completed",
            description: `${accessData.companyName} supervisor completed an evaluation for ${chosenIntern.fullName}.`,
            studentName: chosenIntern.fullName,
            company: accessData.companyName,
            timestamp: serverTimestamp()
        });
        await updateDoc(doc(db, "guestEvaluationAccess", accessDoc.id), { submittedAt:serverTimestamp(), evaluatedInternId:chosenIntern.id });
        $("evaluationContent").classList.add("hidden"); $("successState").classList.remove("hidden");
    } catch (error) { console.error(error); alert("Your evaluation could not be submitted. Please try again or contact the coordinator."); button.disabled=false; button.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit evaluation'; }

});
loadAccess();
