/* ==========================================================
   APPROVAL GATE (student side)
   1) Idikit ang HTML sa ibaba sa student_dashboard.html
      (bago mag-</body>).
   2) Idikit ang JS sa student dashboard JS mo, tapos tawagin
      ang initApprovalGate(user.uid) pagkatapos ng login
      (sa loob ng onAuthStateChanged kung saan may user na).
   ----------------------------------------------------------
   HTML:

   <div class="approval-gate" id="approvalGate" hidden>
     <div class="approval-gate-card">
       <div class="approval-gate-icon"><i class="fa-solid fa-hourglass-half"></i></div>
       <h3 id="approvalGateTitle">Waiting for Approval</h3>
       <p class="approval-gate-text" id="approvalGateText">
         Show this code to your OJT Coordinator so they can find and review your documents.
       </p>
       <div class="approval-gate-code" id="approvalGateCode">------</div>
       <span class="approval-gate-code-label">Your Submission Code</span>
       <p class="approval-gate-note" id="approvalGateNote" hidden></p>
       <div class="approval-gate-actions">
         <button type="button" class="approval-gate-btn secondary" id="approvalGateCopy">Copy code</button>
         <button type="button" class="approval-gate-btn primary" id="approvalGateFix" hidden>Fix documents</button>
       </div>
     </div>
   </div>
========================================================== */

// !! Parehong-pareho sa getSubmissionCode ng students.js (coordinator) !!
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function getSubmissionCode(uid) {
    if (!uid) return "";
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < uid.length; i++) {
        const ch = uid.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    let n = 4294967296 * (2097151 & h2) + (h1 >>> 0);

    let code = "";
    for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[n % 32];
        n = Math.floor(n / 32);
    }
    return `OJT-${code}`;
}

// Kailangan: db, doc, onSnapshot (galing sa firebase-firestore.js import mo)
function initApprovalGate(uid) {
    const gate = document.getElementById("approvalGate");
    if (!gate || !uid) return;

    const els = {
        title: document.getElementById("approvalGateTitle"),
        text: document.getElementById("approvalGateText"),
        code: document.getElementById("approvalGateCode"),
        note: document.getElementById("approvalGateNote"),
        copy: document.getElementById("approvalGateCopy"),
        fix: document.getElementById("approvalGateFix")
    };
    const code = getSubmissionCode(uid);
    els.code.textContent = code;

    els.copy.onclick = async () => {
        try { await navigator.clipboard.writeText(code); els.copy.textContent = "Copied!"; }
        catch (e) { els.copy.textContent = "Copy failed"; }
        setTimeout(() => (els.copy.textContent = "Copy code"), 1500);
    };

    // Real-time: kapag ina-approve ng coordinator, kusang mawawala ang gate
    onSnapshot(doc(db, "users", uid), (snap) => {
        const d = snap.data() || {};
        const hasSubmitted = !!d.requirementsSubmittedAt;
        // Parehong rule sa coordinator: walang documentsStatus at walang submission = approved na (lumang student)
        const status = String(d.documentsStatus || (hasSubmitted ? "review" : "approved")).toLowerCase();

        // Hindi pa nakakapag-submit ng documents -> hayaan ang normal na profile/requirements flow
        if (!hasSubmitted || status === "approved") {
            gate.hidden = true;
            return;
        }

        gate.hidden = false;
        if (status === "revision") {
            els.title.textContent = "Documents Need Revision";
            els.text.textContent = "Your coordinator returned your documents. Please fix them and submit again.";
            els.note.textContent = d.documentsReviewNote || "";
            els.note.hidden = !d.documentsReviewNote;
            els.fix.hidden = false;
        } else {
            els.title.textContent = "Waiting for Approval";
            els.text.textContent = "Show this code to your OJT Coordinator so they can find and review your documents.";
            els.note.hidden = true;
            els.fix.hidden = true;
        }
    });
}