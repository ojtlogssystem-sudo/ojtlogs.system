import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const LOGO_SRC = "/images/logo-orig.png";

// ========================================
// MGA FORM (reference na kailangan ipasa ni student)
// Para magdagdag ng bagong requirement form: maglagay lang ng bagong
// entry dito na may `label`, `aliases` at `render(student)`.
// ========================================
const FORMS = {
    "request-letter": {
        label: "Request Letter",
        aliases: ["request-letter", "request_letter", "requestletter", "letter", "endorsement-letter", "endorsement"],
        render: renderRequestLetter,
        docx: dxRequestLetter
    },
    "moa": {
        label: "MOA",
        aliases: ["moa", "memorandum-of-agreement", "memorandum", "memorandum_of_agreement"],
        render: renderMoa,
        docx: dxMoa
    },
    "acceptance-form": {
        label: "OJT Acceptance Form",
        aliases: ["acceptance-form", "acceptance_form", "acceptanceform", "acceptance", "ojt-acceptance-form"],
        render: renderAcceptanceForm,
        docx: dxAcceptanceForm
    }
};

let student = {};
let currentFormKey = "request-letter";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function resolveFormKey(raw) {
    const t = String(raw || "").trim().toLowerCase();
    for (const [key, f] of Object.entries(FORMS)) {
        if (key === t || f.aliases.includes(t)) return key;
    }
    return "request-letter";
}

function todayLong() {
    return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ========================================
// SHARED PIECES
// ========================================
function letterhead() {
    return `
        <div class="letterhead">
            <img src="${LOGO_SRC}" alt="Global Reciprocal Colleges">
            <p>454 GRC Bldg., Rizal Ave., cor. 9th ave.,</p>
            <p>Grace Park, Caloocan City</p>
            <p>Telefax 8452-2945</p>
        </div>`;
}

function watermark() {
    return `<img class="sheet-watermark" src="${LOGO_SRC}" alt="" aria-hidden="true">`;
}

// ========================================
// 1) REQUEST LETTER
// ========================================
function renderRequestLetter(s) {
    const name = s.name ? `<b>${escapeHtml(s.name)}</b>` : "<b>(Name of Student)</b>";
    const company = s.company ? escapeHtml(s.company) : "(COMPANY FULL NAME)";

    return `
        ${watermark()}
        ${letterhead()}
        <div class="letter">
            <div class="l-date">${escapeHtml(todayLong())}</div>

            <div class="l-block">
                <p><b>(NAME OF CONTACT PERSON)</b></p>
                <p>(POSITION OF CONTACT PERSON)</p>
                <p>${company}</p>
            </div>

            <p class="l-salutation">Dear Ms/Mr. (SURNAME OF CONTACT PERSON):</p>

            <p class="indent">
                The undersigned would like to extend our warmest greetings on behalf of our institution
                – the Global Reciprocal Colleges. I would like to inform you that Ms/Mr. ${name}, a 4<sup>th</sup>
                Year student from the <b>Bachelor of Science in Information Technology</b> is required to undergo
                Work Learning Integration which entails Six Hundred Hours <b>(600 hours)</b> of industry experience.
                This program aims to give the students the opportunity to work in the department relative to
                their specialization that will eventually enhance their skills in these fields.
            </p>

            <p class="indent">
                In view of the above, may I request your good office to allow our bonafide student to
                undergo the aforementioned number of on-the-job training hours in your institution. I believe
                that your office will greatly help honouring his/her skills and competencies in the following:
            </p>

            <ul class="l-list">
                <li>designing a database, PC troubleshooting, hardware and software installation and upgrading;</li>
                <li>performing preventive PC maintenance, installing network and Internet connections;</li>
                <li>photo editing, analyzing system; and</li>
                <li>application solutions acquired by our students will be best enhanced through the training they will get from your company.</li>
            </ul>

            <p class="l-close">I hope that this request shall merit your favorable consideration.</p>

            <p>Very truly yours,</p>

            <div class="l-sign">
                <p><b>JOSZEN C. TORRECHIVA</b></p>
                <p>OJT Coordinator</p>
                <p>Global Reciprocal Colleges</p>
            </div>
        </div>`;
}

// ========================================
// 2) OJT ACCEPTANCE FORM
// ========================================
function renderAcceptanceForm(s) {
    const name = s.name ? escapeHtml(s.name) : "";
    const company = s.company ? escapeHtml(s.company) : "";
    const address = s.companyAddress ? escapeHtml(s.companyAddress) : "";

    const rows = [
        "Job Title",
        "To report to",
        "Working Hours and days",
        "To complete (required hours)",
        "Effective Date"
    ].map(label => `<tr><td>${label}</td><td></td></tr>`).join("");

    return `
        ${watermark()}
        ${letterhead()}
        <div class="acceptance">
            <h3 class="a-title">OJT ACCEPTANCE FORM</h3>

            <div class="a-date">
                <div class="line"></div>
                <span class="cap">Date</span>
            </div>

            <p class="body">
                This is to signify the approval of on-the-job training request allowing Mr. / Ms.
                <span class="fill" style="min-width:220px;">${name}</span>,
                a 4<sup>th</sup> year student of Global Reciprocal Colleges, to render his / her practicum in
                (Company name) <span class="fill" style="min-width:200px;">${company}</span>,
                located at (Company Address) <span class="fill" style="min-width:260px;">${address}</span>.
            </p>

            <p class="a-lead">Please be informed on the following details of his/her assignments:</p>

            <table class="a-table">
                <tbody>${rows}</tbody>
            </table>

            <div class="a-sign-grid">
                <div class="a-sign-col">
                    <h5>Noted by:</h5>
                    <div class="sig">
                        <div class="line"></div>
                        <div class="cap"><b>Company Representative</b>(Signature over printed name)</div>
                    </div>
                    <div class="sig">
                        <div class="line"></div>
                        <div class="cap"><b>Position</b></div>
                    </div>
                    <div class="sig">
                        <div class="line"></div>
                        <div class="cap"><b>Contact No. / Email Address</b></div>
                    </div>
                </div>

                <div class="a-sign-col">
                    <h5>Conform:</h5>
                    <div class="sig">
                        <div class="line"></div>
                        <div class="cap"><b>Student</b>(Signature over printed name)</div>
                    </div>
                    <div class="sig">
                        <div class="line"></div>
                        <div class="cap"><b>OJT Coordinator</b></div>
                    </div>
                </div>
            </div>

            <div class="a-foot">
                <span>“Touching hearts, Renewing minds, Transforming Lives.”</span>
                <span>Page <b>1</b> of <b>1</b></span>
            </div>
        </div>`;
}

// ========================================
// 3) MEMORANDUM OF AGREEMENT (3 pages)
// ========================================
function renderMoa(s) {
    const company = s.company ? escapeHtml(s.company) : "(COMPANY NAME)";
    const address = s.companyAddress ? escapeHtml(s.companyAddress) : "(COMPANY HEAD OFFICE ADDRESS)";

    return `
        <div class="moa">

            <!-- PAGE 1 -->
            <section class="moa-page">
                <h2 class="moa-title">MEMORANDUM OF AGREEMENT</h2>

                <p class="moa-know">KNOW ALL MEN BY THESE PRESENTS:</p>

                <p class="moa-p">This MEMORANDUM OF AGREEMENT made and entered into, by and between:</p>

                <p class="moa-p moa-j">
                    <b>GLOBAL RECIPROCAL COLLEGES, INC.</b>, an educational institution duly organized and existing in
                    accordance with the law of the Republic of the Philippines, with business address at 454 GRC Bldg.,
                    Rizal Ave. Cor. 9<sup>th</sup> Ave., Caloocan City, and herein represented by its Practicum Coordinator,
                    <u>JOSZEN C. TORRECHIVA</u>, and hereinafter referred to as the “<b>SCHOOL</b>”.
                </p>

                <p class="moa-center">-AND-</p>

                <p class="moa-p moa-j">
                    <b><u>${company}</u></b>, duly organized and existing under and by virtue of the laws of the Republic of the
                    Philippines with Head Office address At <u>${address}</u>, herein duly represented by its
                    <b><u>(POSITION OF COMPANY REPRESENTATIVE), (NAME OF COMPANY REPRESENTATIVE)</u></b>
                    hereinafter referred as the “<b>COMPANY</b>”.
                </p>

                <p class="moa-center">-WITNESSETH:-</p>

                <p class="moa-p moa-j">
                    WHEREAS, the <b>COMPANY</b>, being engaged in the field of business, is supportive of the mission of the
                    educational institutions in line with the trust of the government in the imperative participation of this
                    sector for the nation-building, to accept and train students for actual work experience to complete their
                    classroom or theoretical knowledge;
                </p>

                <p class="moa-p moa-j">
                    WHEREAS, the <b>SCHOOL</b> is offering a course that requires its <b>4<sup>th</sup> Year Bachelor of Science in
                    Information Technology</b> student to enroll in its INTERNSHIP PROGRAM for <b>600</b> hours in a semester;
                </p>

                <p class="moa-p moa-j">
                    NOW, THEREFORE, for and in consideration of the foregoing premises and realizing the mutual advantages and
                    benefits the said program can provide them, the <b>PARTIES</b> herein have entered into this joint venture
                    and enter their covenants under the following terms and conditions:
                </p>

                <h4 class="moa-h"><span>A.</span> The <b>COMPANY</b> shall have the following duties and responsibilities:</h4>
                <ol class="moa-list moa-j">
                    <li>To require qualified 4<sup>th</sup> year <b>Bachelor of Science in Information Technology</b> student interns to submit themselves to examination, interviews, and file pertinent documents to support their application;</li>
                    <li>To ensure that the student-interns are well-informed and aware of the <b>COMPANY’s</b> rules, regulations, and policies.</li>
                    <li>To accept as recommended/requested by the <b>SCHOOL</b>, qualified student-interns to be trained in the <b>COMPANY</b>.</li>
                    <li>To train the student-interns in works or jobs relevant or related to the course taken by them with the <b>SCHOOL</b>, in accordance with the <b>COMPANY</b> policy, rules, and regulations on student internship;</li>
                    <li>To report to the <b>SCHOOL</b> through its faculty coordinator all information, issues, misbehavior, or complaints affecting the student-interns;</li>
                    <li>To help the <b>SCHOOL</b> assess the performance of the said student-interns by filling out an evaluation form done at the end of the <b>400 hours</b> of on-the-job training of the student-interns and;</li>
                    <li>To provide the student-interns a CERTIFICATE OF COMPLETION upon completion of the Student Internship program;</li>
                    <li>The <b>COMPANY</b> shall reserve its right to terminate the intership of the student intern in their <b>COMPANY</b> in the event that the student-intern violated any its policies.</li>
                    <li>The <b>COMPANY</b> shall not be obliged to pay the student interns any salary, allowance or compensation. However, the COMPANY may on its own discretion grant an allowance to the student interns if allowed under the company policy.</li>
                </ol>

                <h4 class="moa-h"><span>B.</span> The <b>SCHOOL</b> shall have the following duties and responsibilities:</h4>
                <ol class="moa-list moa-j">
                    <li>To see to it that the student-intern recommended to the <b>COMPANY</b> is qualified to take the training (e.g., have finished/passed the majority of the subjects, physically and mentally prepared for the training) and have complied with all the paper/document requirements of the course;</li>
                    <li>To represent and coordinate through a faculty coordinator with the <b>COMPANY</b>; and</li>
                    <li>To provide the student-interns with a basic orientation on work values, behavior, and discipline to ensure smooth cooperation with the <b>COMPANY</b>.</li>
                </ol>
            </section>

            <!-- PAGE 2 -->
            <section class="moa-page">
                <h4 class="moa-h"><span>C.</span> The <b>STUDENT-INTERN</b> shall have the following duties and responsibilities:</h4>
                <ol class="moa-list moa-j">
                    <li>The student-intern shall be personally responsible for any and all liabilities arising from negligence in the performance of his/her duties and functions or any damage or injury to third parties which may be occasioned by intentional or negligent act/s of the student interns while the <b>SCHOOL</b> shall ensure that the student-intern shall comply with the provisions of this agreement, rules, and regulations of the <b>COMPANY</b> and the <b>SCHOOL</b>. Any medical and other injuries sustained will be the student intern’s responsibility.</li>
                    <li>The student-intern shall abide by the rules, regulations, and policies of the <b>COMPANY</b> and the <b>SCHOOL</b>.</li>
                    <li>In the event that the <b>STUDENT</b> is found to misbehave and /or act in defiance of existing rules and regulations of the company, the school or the company may withdraw the student trainee, at any time and impose necessary sanctions of the school to the student-intern.</li>
                    <li>The student-intern shall render equivalent to <b>400</b> working hours unless otherwise agreed upon by the <b>COMPANY</b> and the <b>SCHOOL</b>.</li>
                </ol>

                <h4 class="moa-h"><span>D.</span> <b>CONFIDENTIALITY</b></h4>
                <ol class="moa-list moa-j">
                    <li>Pursuant to the Data Privacy Act of 2012, the student-intern shall not, without written consent of the COMPANY, sell, trade, publish, and/or divulge or disclose to any person or entity, any confidential information disclosed there or acquired in the performance of his/her duties and functions, nor shall it permit any person to divulge or disclose to third parties such confidential information.</li>
                </ol>

                <p class="moa-p moa-j">Nothing in this Agreement shall create an employment, agency, joint venture, or partnership relationship between the SCHOOL and the COMPANY. The student intern is not an employee of the COMPANY and is not entitled to any benefits from the COMPANY.</p>

                <p class="moa-p moa-j">Any violation of the foregoing covenants will warrant the cancellation of the Memorandum of Agreement by the COMPANY and or by the SCHOOL immediately after the lapse of the thirty (30) days notice to either PARTY;</p>

                <p class="moa-p moa-j">This <b>AGREEMENT</b> shall be in full force and effect immediately upon signing hereof by the PARTIES unless otherwise extended or revoked by agreement of the PARTIES.</p>

                <p class="moa-p moa-j moa-witness">
                    <b>IN WITNESS WHEREOF,</b> the <b>PARTIES</b> have hereunto affixed their signatures this
                    <span class="moa-fill" style="min-width:40px;"></span> day of
                    <span class="moa-fill" style="min-width:110px;"></span> 2026 at
                    <u>454 GRC Bldg., Rizal Ave. Cor. 9<sup>th</sup> Ave., Caloocan City</u>, Philippines.
                </p>

                <div class="moa-sign-row">
                    <div class="moa-sig"><div class="line"></div><div class="cap">“COMPANY”</div></div>
                    <div class="moa-sig"><div class="line"><b>GLOBAL RECIPROCAL COLLEGES</b></div><div class="cap">“SCHOOL”</div></div>
                </div>

                <div class="moa-sign-row">
                    <div class="moa-sig by"><span>By:</span><div><div class="line"></div><div class="cap">COMPANY REPRESENTATIVE</div></div></div>
                    <div class="moa-sig"><div class="line"></div><div class="cap">SCHOOL REPRESENTATIVE</div></div>
                </div>

                <div class="moa-sign-row center">
                    <div class="moa-sig"><div class="line"></div><div class="cap">STUDENT-INTERN</div></div>
                </div>

                <p class="moa-center moa-presence">SIGNED IN THE PRESENCE OF:</p>

                <div class="moa-sign-row">
                    <div class="moa-sig"><div class="line"></div><div class="cap">COMPANY WITNESS</div></div>
                    <div class="moa-sig"><div class="line"><b>JOSZEN C. TORRECHIVA</b></div><div class="cap">SCHOOL WITNESS</div></div>
                </div>
            </section>

            <!-- PAGE 3 : ACKNOWLEDGEMENT -->
            <section class="moa-page">
                <h3 class="moa-ack">ACKNOWLEDGEMENT</h3>

                <p class="moa-p moa-ss">
                    REPUBLIC OF THE PHILIPPINES)<br>
                    <span class="moa-fill" style="min-width:260px;"></span>) S.S.
                </p>

                <p class="moa-p">
                    BEFORE ME, a NOTARY PUBLIC, for in the CITY of
                    <span class="moa-fill" style="min-width:200px;"></span>, this
                    <span class="moa-fill" style="min-width:50px;"></span> day of
                    <span class="moa-fill" style="min-width:110px;"></span>, 2026,
                    personally appeared and exhibited to me their VALID ID, respectively:
                </p>

                <p class="moa-p" style="margin-top:30px; text-indent:30px;">
                    <b>WITNESS MY HAND AND NOTARIAL SEAL</b> on the date and place first above written.
                </p>

                <p class="moa-notary">NOTARY PUBLIC</p>

                <table class="moa-docs">
                    <tr><td>Doc. No.</td><td><span class="moa-fill" style="min-width:80px;"></span></td></tr>
                    <tr><td>Page No.</td><td><span class="moa-fill" style="min-width:80px;"></span></td></tr>
                    <tr><td>Book No.</td><td><span class="moa-fill" style="min-width:80px;"></span></td></tr>
                    <tr><td>Series of</td><td><span class="moa-fill" style="min-width:80px;"></span></td></tr>
                </table>
            </section>
        </div>`;
}

// ========================================
// RENDER + SWITCHER
// ========================================
function renderCurrentForm() {
    const sheet = document.getElementById("form-sheet");
    if (!sheet) return;
    sheet.innerHTML = FORMS[currentFormKey].render(student);
    document.title = FORMS[currentFormKey].label;

    document.querySelectorAll("#form-switch button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.form === currentFormKey);
    });
}

function setupSwitcher() {
    const wrap = document.getElementById("form-switch");
    if (!wrap) return;

    wrap.innerHTML = Object.entries(FORMS)
        .map(([key, f]) => `<button type="button" data-form="${key}">${escapeHtml(f.label)}</button>`)
        .join("");

    wrap.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-form]");
        if (!btn) return;
        currentFormKey = btn.dataset.form;

        // i-update ang URL para tama pa rin kapag nag-refresh
        const url = new URL(window.location.href);
        url.searchParams.set("form", currentFormKey);
        window.history.replaceState({}, "", url);

        renderCurrentForm();
    });
}

// ========================================
// DOWNLOAD AS WORD (.docx)
// Gumagawa ng totoong Word document (docx library) para puwedeng i-edit
// at buksan sa Word, Google Docs, WPS, atbp. - sa phone man o computer.
// ========================================
const DX_TEXT_WIDTH = 9746;   // lapad ng text area (A4, 0.75" margins) sa twips
const DX_LINE = { style: "single", size: 6, color: "000000", space: 1 };

// Iwasan na ma-interpret bilang formatting ang laman ng pangalan/company
function dxClean(v) {
    return String(v ?? "")
        .replace(/\*\*/g, "*\u200b*")
        .replace(/__/g, "_\u200b_")
        .replace(/\^\^/g, "^\u200b^");
}

// Underlined na blangkong espasyo (pang "fill-in" na linya)
function dxBlank(n) { return "\u00A0".repeat(n); }

// Mini-markup: **bold**  __underline__  ^^superscript^^  \n = bagong linya
function dxRuns(text, base = {}) {
    const D = window.docx;
    const re = /\*\*(.+?)\*\*|__(.+?)__|\^\^(.+?)\^\^/gs;
    const out = [];
    const plain = (t) => {
        if (!t) return;
        t.split("\n").forEach((part, i) => {
            out.push(new D.TextRun({ ...base, text: part, break: i > 0 ? 1 : undefined }));
        });
    };

    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
        plain(text.slice(last, m.index));
        if (m[1] !== undefined) out.push(...dxRuns(m[1], { ...base, bold: true }));
        else if (m[2] !== undefined) out.push(...dxRuns(m[2], { ...base, underline: { type: D.UnderlineType.SINGLE } }));
        else out.push(...dxRuns(m[3], { ...base, superScript: true }));
        last = re.lastIndex;
    }
    plain(text.slice(last));
    return out;
}

// Gumagawa ng paragraph function na may nakatakdang font at size (half-points)
function dxMaker(font, size) {
    const D = window.docx;
    return (text, opts = {}) => {
        const { run, ...pOpts } = opts;
        return new D.Paragraph({
            ...pOpts,
            children: text ? dxRuns(text, { font, size, ...(run || {}) }) : []
        });
    };
}

// Linya para sa pirma (paragraph na may bottom border)
function dxSigLine(P, text = "", opts = {}) {
    return P(text, { alignment: window.docx.AlignmentType.CENTER, border: { bottom: DX_LINE }, spacing: { before: 480, after: 0 }, ...opts });
}

// Table na walang border, 2 column na may pagitan sa gitna
function dxTwoCols(left, right) {
    const D = window.docx;
    const none = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const all = { top: none, bottom: none, left: none, right: none };
    const widths = [4500, 746, 4500];
    const cell = (children, w) => new D.TableCell({
        children: children.length ? children : [new D.Paragraph({})],
        width: { size: w, type: D.WidthType.DXA },
        borders: all
    });
    return new D.Table({
        width: { size: DX_TEXT_WIDTH, type: D.WidthType.DXA },
        columnWidths: widths,
        borders: { ...all, insideHorizontal: none, insideVertical: none },
        rows: [new D.TableRow({ children: [cell(left, widths[0]), cell([], widths[1]), cell(right, widths[2])] })]
    });
}

function dxLetterhead(logo) {
    const D = window.docx;
    const P = dxMaker("Arial", 17);
    const out = [];
    if (logo) {
        out.push(new D.Paragraph({
            alignment: D.AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new D.ImageRun({ data: logo.data, transformation: { width: logo.width, height: logo.height } })]
        }));
    }
    ["454 GRC Bldg., Rizal Ave., cor. 9th ave.,", "Grace Park, Caloocan City", "Telefax 8452-2945"].forEach((t, i, arr) => {
        out.push(P(`**${t}**`, { alignment: D.AlignmentType.CENTER, spacing: { after: i === arr.length - 1 ? 500 : 0 } }));
    });
    return out;
}

// ---------- 1) REQUEST LETTER ----------
function dxRequestLetter(s, logo) {
    const D = window.docx, A = D.AlignmentType;
    const P = dxMaker("Calibri", 23);
    const name = s.name ? `**${dxClean(s.name)}**` : "**(Name of Student)**";
    const company = s.company ? dxClean(s.company) : "(COMPANY FULL NAME)";
    const body = { alignment: A.JUSTIFIED, indent: { firstLine: 720 }, spacing: { after: 220, line: 300 } };

    return [
        ...dxLetterhead(logo),
        P(todayLong(), { alignment: A.RIGHT, spacing: { after: 560 } }),
        P("**(NAME OF CONTACT PERSON)**", { spacing: { after: 40 } }),
        P("(POSITION OF CONTACT PERSON)", { spacing: { after: 40 } }),
        P(company, { spacing: { after: 40 } }),
        P("Dear Ms/Mr. (SURNAME OF CONTACT PERSON):", { spacing: { before: 440, after: 380 } }),

        P(`The undersigned would like to extend our warmest greetings on behalf of our institution – the Global Reciprocal Colleges. I would like to inform you that Ms/Mr. ${name}, a 4^^th^^ Year student from the **Bachelor of Science in Information Technology** is required to undergo Work Learning Integration which entails Six Hundred Hours **(600 hours)** of industry experience. This program aims to give the students the opportunity to work in the department relative to their specialization that will eventually enhance their skills in these fields.`, body),

        P("In view of the above, may I request your good office to allow our bonafide student to undergo the aforementioned number of on-the-job training hours in your institution. I believe that your office will greatly help honouring his/her skills and competencies in the following:", body),

        ...[
            "designing a database, PC troubleshooting, hardware and software installation and upgrading;",
            "performing preventive PC maintenance, installing network and Internet connections;",
            "photo editing, analyzing system; and",
            "application solutions acquired by our students will be best enhanced through the training they will get from your company."
        ].map(t => P(t, { indent: { left: 400 }, spacing: { after: 40, line: 300 } })),

        P("I hope that this request shall merit your favorable consideration.", { spacing: { before: 360, after: 220 } }),
        P("Very truly yours,"),
        P("**JOSZEN C. TORRECHIVA**", { spacing: { before: 880 } }),
        P("OJT Coordinator"),
        P("Global Reciprocal Colleges")
    ];
}

// ---------- 2) OJT ACCEPTANCE FORM ----------
function dxAcceptanceForm(s, logo) {
    const D = window.docx, A = D.AlignmentType;
    const P = dxMaker("Times New Roman", 23);
    const name = s.name ? dxClean(s.name) : dxBlank(34);
    const company = s.company ? dxClean(s.company) : dxBlank(30);
    const address = s.companyAddress ? dxClean(s.companyAddress) : dxBlank(38);
    const dateIndent = DX_TEXT_WIDTH - 2550;

    const bd = { style: D.BorderStyle.SINGLE, size: 6, color: "000000" };
    const borders = { top: bd, bottom: bd, left: bd, right: bd };
    const widths = [3500, DX_TEXT_WIDTH - 3500];
    const rows = [
        "Job Title", "To report to", "Working Hours and days", "To complete (required hours)", "Effective Date"
    ].map(label => new D.TableRow({
        height: { value: 520, rule: D.HeightRule.ATLEAST },
        children: [
            new D.TableCell({ children: [P(`**${label}**`)], width: { size: widths[0], type: D.WidthType.DXA }, borders, margins: { top: 100, bottom: 100, left: 140, right: 140 } }),
            new D.TableCell({ children: [P("")], width: { size: widths[1], type: D.WidthType.DXA }, borders, margins: { top: 100, bottom: 100, left: 140, right: 140 } })
        ]
    }));

    const sig = (label, hint) => [
        dxSigLine(P),
        P(`**${label}**`, { alignment: A.CENTER, spacing: { before: 40 } }),
        ...(hint ? [P(hint, { alignment: A.CENTER })] : [])
    ];

    return [
        ...dxLetterhead(logo),
        P("**OJT ACCEPTANCE FORM**", { alignment: A.CENTER, spacing: { after: 360 }, run: { size: 26 } }),

        P("", { indent: { left: dateIndent }, border: { bottom: DX_LINE }, spacing: { after: 0 } }),
        P("Date", { indent: { left: dateIndent }, alignment: A.CENTER, spacing: { after: 240 } }),

        P(`This is to signify the approval of on-the-job training request allowing Mr. / Ms. __${name}__, a 4^^th^^ year student of Global Reciprocal Colleges, to render his / her practicum in (Company name) __${company}__, located at (Company Address) __${address}__.`,
            { alignment: A.JUSTIFIED, indent: { firstLine: 720 }, spacing: { after: 280, line: 320 } }),

        P("Please be informed on the following details of his/her assignments:", { spacing: { after: 160 } }),

        new D.Table({ width: { size: DX_TEXT_WIDTH, type: D.WidthType.DXA }, columnWidths: widths, rows }),
        P("", { spacing: { after: 360 } }),

        dxTwoCols(
            [P("**Noted by:**", { spacing: { after: 120 } }),
             ...sig("Company Representative", "(Signature over printed name)"),
             ...sig("Position"),
             ...sig("Contact No. / Email Address")],
            [P("**Conform:**", { spacing: { after: 120 } }),
             ...sig("Student", "(Signature over printed name)"),
             ...sig("OJT Coordinator")]
        ),

        P("“Touching hearts, Renewing minds, Transforming Lives.”\tPage **1** of **1**", {
            tabStops: [{ type: D.TabStopType.RIGHT, position: DX_TEXT_WIDTH }],
            spacing: { before: 700 },
            run: { size: 21 }
        })
    ];
}

// ---------- 3) MEMORANDUM OF AGREEMENT ----------
function dxMoa(s, logo) {
    const D = window.docx, A = D.AlignmentType;
    const P = dxMaker("Times New Roman", 21);
    const company = s.company ? dxClean(s.company) : "(COMPANY NAME)";
    const address = s.companyAddress ? dxClean(s.companyAddress) : "(COMPANY HEAD OFFICE ADDRESS)";

    const J = { alignment: A.JUSTIFIED, indent: { firstLine: 720 }, spacing: { after: 140, line: 260 } };
    const heading = (letter, text) => P(`**${letter}**\t${text}`, { indent: { left: 540, hanging: 540 }, spacing: { before: 200, after: 80 } });
    const list = (items) => items.map((t, i) => P(`${i + 1}.\t${t}`, { alignment: A.JUSTIFIED, indent: { left: 1080, hanging: 360 }, spacing: { after: 50, line: 252 } }));
    const center = (t, o = {}) => P(t, { alignment: A.CENTER, spacing: { before: 100, after: 140 }, ...o });
    const gap = () => P("", { spacing: { after: 0 } });

    const sig = (text, caption) => [dxSigLine(P, text), P(caption, { alignment: A.CENTER, spacing: { before: 20 } })];

    const page1 = [
        ...dxLetterhead(logo),
        P("**MEMORANDUM OF AGREEMENT**", { alignment: A.CENTER, spacing: { after: 260 }, run: { size: 28 } }),
        P("KNOW ALL MEN BY THESE PRESENTS:", { spacing: { after: 200 } }),
        P("This MEMORANDUM OF AGREEMENT made and entered into, by and between:", { spacing: { after: 140 } }),

        P("**GLOBAL RECIPROCAL COLLEGES, INC.**, an educational institution duly organized and existing in accordance with the law of the Republic of the Philippines, with business address at 454 GRC Bldg., Rizal Ave. Cor. 9^^th^^ Ave., Caloocan City, and herein represented by its Practicum Coordinator, __JOSZEN C. TORRECHIVA__, and hereinafter referred to as the “**SCHOOL**”.", J),
        center("-AND-"),
        P(`**__${company}__**, duly organized and existing under and by virtue of the laws of the Republic of the Philippines with Head Office address At __${address}__, herein duly represented by its **__(POSITION OF COMPANY REPRESENTATIVE), (NAME OF COMPANY REPRESENTATIVE)__** hereinafter referred as the “**COMPANY**”.`, J),
        center("-WITNESSETH:-"),

        P("WHEREAS, the **COMPANY**, being engaged in the field of business, is supportive of the mission of the educational institutions in line with the trust of the government in the imperative participation of this sector for the nation-building, to accept and train students for actual work experience to complete their classroom or theoretical knowledge;", J),
        P("WHEREAS, the **SCHOOL** is offering a course that requires its **4^^th^^ Year Bachelor of Science in Information Technology** student to enroll in its INTERNSHIP PROGRAM for **600** hours in a semester;", J),
        P("NOW, THEREFORE, for and in consideration of the foregoing premises and realizing the mutual advantages and benefits the said program can provide them, the **PARTIES** herein have entered into this joint venture and enter their covenants under the following terms and conditions:", J),

        heading("A.", "The **COMPANY** shall have the following duties and responsibilities:"),
        ...list([
            "To require qualified 4^^th^^ year **Bachelor of Science in Information Technology** student interns to submit themselves to examination, interviews, and file pertinent documents to support their application;",
            "To ensure that the student-interns are well-informed and aware of the **COMPANY’s** rules, regulations, and policies.",
            "To accept as recommended/requested by the **SCHOOL**, qualified student-interns to be trained in the **COMPANY**.",
            "To train the student-interns in works or jobs relevant or related to the course taken by them with the **SCHOOL**, in accordance with the **COMPANY** policy, rules, and regulations on student internship;",
            "To report to the **SCHOOL** through its faculty coordinator all information, issues, misbehavior, or complaints affecting the student-interns;",
            "To help the **SCHOOL** assess the performance of the said student-interns by filling out an evaluation form done at the end of the **400 hours** of on-the-job training of the student-interns and;",
            "To provide the student-interns a CERTIFICATE OF COMPLETION upon completion of the Student Internship program;",
            "The **COMPANY** shall reserve its right to terminate the intership of the student intern in their **COMPANY** in the event that the student-intern violated any its policies.",
            "The **COMPANY** shall not be obliged to pay the student interns any salary, allowance or compensation. However, the COMPANY may on its own discretion grant an allowance to the student interns if allowed under the company policy."
        ]),

        heading("B.", "The **SCHOOL** shall have the following duties and responsibilities:"),
        ...list([
            "To see to it that the student-intern recommended to the **COMPANY** is qualified to take the training (e.g., have finished/passed the majority of the subjects, physically and mentally prepared for the training) and have complied with all the paper/document requirements of the course;",
            "To represent and coordinate through a faculty coordinator with the **COMPANY**; and",
            "To provide the student-interns with a basic orientation on work values, behavior, and discipline to ensure smooth cooperation with the **COMPANY**."
        ])
    ];

    const page2 = [
        new D.Paragraph({ pageBreakBefore: true, spacing: { after: 0 } }),
        heading("C.", "The **STUDENT-INTERN** shall have the following duties and responsibilities:"),
        ...list([
            "The student-intern shall be personally responsible for any and all liabilities arising from negligence in the performance of his/her duties and functions or any damage or injury to third parties which may be occasioned by intentional or negligent act/s of the student interns while the **SCHOOL** shall ensure that the student-intern shall comply with the provisions of this agreement, rules, and regulations of the **COMPANY** and the **SCHOOL**. Any medical and other injuries sustained will be the student intern’s responsibility.",
            "The student-intern shall abide by the rules, regulations, and policies of the **COMPANY** and the **SCHOOL**.",
            "In the event that the **STUDENT** is found to misbehave and /or act in defiance of existing rules and regulations of the company, the school or the company may withdraw the student trainee, at any time and impose necessary sanctions of the school to the student-intern.",
            "The student-intern shall render equivalent to **400** working hours unless otherwise agreed upon by the **COMPANY** and the **SCHOOL**."
        ]),

        heading("D.", "**CONFIDENTIALITY**"),
        ...list([
            "Pursuant to the Data Privacy Act of 2012, the student-intern shall not, without written consent of the COMPANY, sell, trade, publish, and/or divulge or disclose to any person or entity, any confidential information disclosed there or acquired in the performance of his/her duties and functions, nor shall it permit any person to divulge or disclose to third parties such confidential information."
        ]),

        P("Nothing in this Agreement shall create an employment, agency, joint venture, or partnership relationship between the SCHOOL and the COMPANY. The student intern is not an employee of the COMPANY and is not entitled to any benefits from the COMPANY.", { ...J, spacing: { before: 140, after: 140, line: 260 } }),
        P("Any violation of the foregoing covenants will warrant the cancellation of the Memorandum of Agreement by the COMPANY and or by the SCHOOL immediately after the lapse of the thirty (30) days notice to either PARTY;", J),
        P("This **AGREEMENT** shall be in full force and effect immediately upon signing hereof by the PARTIES unless otherwise extended or revoked by agreement of the PARTIES.", J),

        P(`**IN WITNESS WHEREOF,** the **PARTIES** have hereunto affixed their signatures this __${dxBlank(6)}__ day of __${dxBlank(16)}__ 2026 at __454 GRC Bldg., Rizal Ave. Cor. 9^^th^^ Ave., Caloocan City__, Philippines.`, { ...J, spacing: { before: 300, after: 140, line: 260 } }),

        dxTwoCols(sig("", "“COMPANY”"), sig("**GLOBAL RECIPROCAL COLLEGES**", "“SCHOOL”")),
        gap(),
        dxTwoCols(sig("By:", "COMPANY REPRESENTATIVE"), sig("", "SCHOOL REPRESENTATIVE")),
        gap(),
        dxSigLine(P, "", { indent: { left: 2400, right: 2400 } }),
        P("STUDENT-INTERN", { alignment: A.CENTER, spacing: { before: 20 } }),

        center("SIGNED IN THE PRESENCE OF:", { spacing: { before: 360, after: 0 } }),
        dxTwoCols(sig("", "COMPANY WITNESS"), sig("**JOSZEN C. TORRECHIVA**", "SCHOOL WITNESS"))
    ];

    const docLine = (label) => P(`${label}\t__${dxBlank(18)}__`, { tabStops: [{ type: D.TabStopType.LEFT, position: 1500 }], spacing: { after: 40 } });

    const page3 = [
        new D.Paragraph({ pageBreakBefore: true, spacing: { after: 0 } }),
        P("ACKNOWLEDGEMENT", { alignment: A.CENTER, spacing: { before: 200, after: 500 }, run: { size: 24 } }),
        P(`REPUBLIC OF THE PHILIPPINES)\n__${dxBlank(40)}__) S.S.`, { spacing: { after: 300, line: 360 } }),
        P(`BEFORE ME, a NOTARY PUBLIC, for in the CITY of __${dxBlank(30)}__, this __${dxBlank(8)}__ day of __${dxBlank(16)}__, 2026, personally appeared and exhibited to me their VALID ID, respectively:`, { spacing: { after: 140, line: 300 } }),
        P("**WITNESS MY HAND AND NOTARIAL SEAL** on the date and place first above written.", { indent: { firstLine: 430 }, spacing: { before: 600, after: 140, line: 300 } }),
        P("NOTARY PUBLIC", { indent: { left: 6000 }, spacing: { before: 400, after: 500 } }),
        docLine("Doc. No."),
        docLine("Page No."),
        docLine("Book No."),
        docLine("Series of")
    ];

    return [...page1, ...page2, ...page3];
}

// Kunin ang logo bilang bytes + laki para mailagay sa letterhead
async function dxLoadLogo() {
    try {
        const res = await fetch(LOGO_SRC);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();

        const dims = await new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(new Blob([buf]));
            img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
        if (!dims || !dims.w || !dims.h) return null;

        const width = 130;
        return { data: new Uint8Array(buf), width, height: Math.round(width * dims.h / dims.w) };
    } catch (err) {
        console.warn("Logo not loaded for Word file:", err);
        return null;
    }
}

async function downloadDocx() {
    const btn = document.getElementById("btn-download");
    const label = document.getElementById("download-label");

    if (!window.docx || typeof window.docx.Packer?.toBlob !== "function") {
        alert("Word tool failed to load. Check your internet connection and try again.");
        return;
    }

    const D = window.docx;
    const form = FORMS[currentFormKey];
    const setBusy = (busy) => {
        if (btn) btn.disabled = busy;
        if (label) label.textContent = busy ? "Preparing…" : "Download";
    };

    setBusy(true);
    try {
        const logo = await dxLoadLogo();
        const children = form.docx(student, logo);

        const doc = new D.Document({
            creator: "OJT-LOGS",
            title: form.label,
            styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
            sections: [{
                properties: {
                    page: {
                        size: { width: 11906, height: 16838 },
                        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
                    }
                },
                children
            }]
        });

        const blob = await D.Packer.toBlob(doc);

        const safeName = (student.name || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
        const filename = `${form.label.replace(/\s+/g, "_")}${safeName ? "_" + safeName : ""}.docx`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (err) {
        console.error("Word download failed:", err);
        alert("Could not create the Word file. Please try again.");
    } finally {
        setBusy(false);
    }
}

async function loadStudent(uid) {
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return {};
        const d = snap.data();
        return {
            name: d.fullName || d.name || "",
            section: d.section || "",
            company: d.companyName || d.company || "",
            companyAddress: d.companyAddress || d.address || ""
        };
    } catch (err) {
        console.error("Error loading student:", err);
        return {};
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // ?form=request-letter | acceptance-form   ?studentId=...
    const params = new URLSearchParams(window.location.search);
    const targetStudentId = params.get("studentId");
    currentFormKey = resolveFormKey(params.get("form"));

    setupSwitcher();
    renderCurrentForm();           // lalabas agad ang form (blank na fields)

    const downloadBtn = document.getElementById("btn-download");
    if (downloadBtn) downloadBtn.addEventListener("click", downloadDocx);

    const backBtn = document.getElementById("btn-back-form");
    if (backBtn) {
        backBtn.addEventListener("click", (e) => {
            e.preventDefault();

            // Kapag nakabukas bilang popup (iframe) sa profile, isara lang ang popup.
            if (window.parent !== window) {
                window.parent.postMessage({ type: "closeRequirementFormModal" }, window.location.origin);
                return;
            }
            window.history.length > 1 ? window.history.back() : window.close();
        });
    }

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            const sheet = document.getElementById("form-sheet");
            if (sheet) sheet.innerHTML = `<p class="sheet-status error">Please log in to view this form.</p>`;
            return;
        }
        student = await loadStudent(targetStudentId || user.uid);

        // Galing sa profile page: company na tinype ni student (hindi pa naka-save)
        const companyParam = params.get("company");
        if (companyParam) student.company = companyParam;
        renderCurrentForm();       // i-refresh na may pangalan/company na
    });
});