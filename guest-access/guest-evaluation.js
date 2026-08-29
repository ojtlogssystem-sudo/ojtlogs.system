import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getFirestore,
    collection,
    doc,
    getDocs,
    query,
    where,
    addDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ==========================================
   FIREBASE
========================================== */

const app = initializeApp({

    apiKey: "AIzaSyDvMQyEHIIJTW4etjV4QHjjIzd8oB2geJ8",

    authDomain:
        "ojt-logs-e1892.firebaseapp.com",

    projectId:
        "ojt-logs-e1892",

    storageBucket:
        "ojt-logs-e1892.firebasestorage.app",

    messagingSenderId:
        "1012575426857",

    appId:
        "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38"

});

const db = getFirestore(app);


/* ==========================================
   URL
========================================== */

const params =
    new URLSearchParams(location.search);

const token =
    params.get("token");

const isPreview =
    params.get("preview") === "1";


/* ==========================================
   STATE
========================================== */

let accessDoc = null;

let accessData = null;

let chosenIntern = null;

let submittedEvaluation = null;


/* ==========================================
   HELPERS
========================================== */

const $ = (id) =>
    document.getElementById(id);


function showError(message) {

    $("loadingState")
        .classList.add("hidden");

    $("errorText")
        .textContent = message;

    $("errorState")
        .classList.remove("hidden");
}


function toDate(value) {

    return value?.toDate
        ? value.toDate()
        : new Date(value || 0);

}


function escapeHtml(value = "") {

    const el =
        document.createElement("div");

    el.textContent = value;

    return el.innerHTML;
}


/* ==========================================
   GENERATE RATING OPTIONS
========================================== */

function generateRatingOptions() {

    document
        .querySelectorAll(".question")
        .forEach((question) => {

            const key =
                question.dataset.question;

            const container =
                question.querySelector(
                    ".rating-options"
                );

            if (!container) return;

            container.innerHTML = "";

            for (let i = 1; i <= 5; i++) {

                const label =
                    document.createElement("label");

                label.className =
                    "rating-cell";

                label.innerHTML = `

                    <input
                        type="radio"
                        name="${key}"
                        value="${i}"
                        required
                    >

                `;

                container.appendChild(label);
            }

        });

}


/* ==========================================
   LOAD ACCESS
========================================== */

async function loadAccess() {

    generateRatingOptions();


    /* --------------------------------------
       PREVIEW MODE
    -------------------------------------- */

    if (isPreview) {

        accessData = {

            companyId:
                "preview-company",

            companyName:
                "Sample Partner Company",

            interns: [

                {
                    id: "preview-1",

                    fullName:
                        "Juan Dela Cruz",

                    studentNumber:
                        "2023-00001",

                    course:
                        "BSIT"
                },

                {
                    id: "preview-2",

                    fullName:
                        "Maria Santos",

                    studentNumber:
                        "2023-00002",

                    course:
                        "BSIT"
                }

            ]

        };


        $("companyName")
            .textContent =
            `${accessData.companyName} (Preview)`;


        populateInterns();


        $("loadingState")
            .classList.add("hidden");

        $("evaluationContent")
            .classList.remove("hidden");

        return;
    }


    /* --------------------------------------
       NO TOKEN
    -------------------------------------- */

    if (!token) {

        return showError(
            "The email link is incomplete. Please use the complete link sent by the coordinator."
        );

    }


    try {

        const found =
            await getDocs(

                query(
                    collection(
                        db,
                        "guestEvaluationAccess"
                    ),

                    where(
                        "token",
                        "==",
                        token
                    )
                )

            );


        if (found.empty) {

            return showError(
                "This guest link is invalid or has expired."
            );

        }


        accessDoc =
            found.docs[0];

        accessData =
            accessDoc.data();


        if (accessData.submittedAt) {

            return showError(
                "This evaluation has already been submitted."
            );

        }


        $("companyName")
            .textContent =
            accessData.companyName;


        populateInterns();


        $("loadingState")
            .classList.add("hidden");

        $("evaluationContent")
            .classList.remove("hidden");


    } catch (error) {

        console.error(error);

        showError(
            "We could not open this guest link. Please ask the coordinator to check its access settings."
        );

    }

}


/* ==========================================
   POPULATE INTERNS
========================================== */

function populateInterns() {

    const select =
        $("internSelect");

    select.innerHTML =
        `<option value="">Choose an intern</option>`;


    (accessData.interns || [])
        .forEach((intern) => {

            const option =
                document.createElement("option");

            option.value =
                intern.id;

            option.textContent =
                `${intern.fullName}${
                    intern.studentNumber
                        ? ` (${intern.studentNumber})`
                        : ""
                }`;

            select.appendChild(option);

        });

}


/* ==========================================
   INTERN CHANGE
========================================== */

$("internSelect")
    .addEventListener(
        "change",
        async (event) => {

            chosenIntern =
                accessData.interns.find(
                    intern =>
                        intern.id ===
                        event.target.value
                );


            if (!chosenIntern) {

                $("historyPanel")
                    .classList.add("hidden");

                $("evaluationForm")
                    .classList.add("hidden");

                $("selectedInternName")
                    .textContent =
                    "Not selected";

                return;
            }


            $("selectedInternName")
                .textContent =
                chosenIntern.fullName;


            $("practicumerName")
                .value =
                chosenIntern.fullName;


            $("evaluatorCompany")
                .value =
                accessData.companyName;


            $("dateAccomplished")
                .value =
                new Date()
                    .toISOString()
                    .split("T")[0];


            $("historyPanel")
                .classList.remove("hidden");

            $("evaluationForm")
                .classList.remove("hidden");


            $("taskHistory")
                .innerHTML = "";

            $("historySummary")
                .textContent =
                "Loading submitted task records...";


            await loadTaskHistory();

        }
    );


/* ==========================================
   LOAD TASK HISTORY
========================================== */

async function loadTaskHistory() {

    if (isPreview) {

        $("historySummary")
            .textContent =
            "3 sample attendance records";


        $("taskHistory")
            .innerHTML = `

                <article class="task">

                    <time>
                        August 12, 2026
                    </time>

                    Documentation:
                    Updated the equipment inventory.

                </article>


                <article class="task">

                    <time>
                        August 11, 2026
                    </time>

                    Technical Support:
                    Assisted with workstation troubleshooting.

                </article>


                <article class="task">

                    <time>
                        August 8, 2026
                    </time>

                    Administrative:
                    Organized department files.

                </article>

            `;

        return;
    }


    try {

        const logs =
            await getDocs(

                query(
                    collection(
                        db,
                        "attendance"
                    ),

                    where(
                        "userId",
                        "==",
                        chosenIntern.id
                    )
                )

            );


        const entries =
            logs.docs
                .map(
                    snap =>
                        snap.data()
                )
                .sort(
                    (a, b) =>
                        toDate(
                            b.createdAt ||
                            b.date
                        )
                        -
                        toDate(
                            a.createdAt ||
                            a.date
                        )
                );


        $("historySummary")
            .textContent =
            `${entries.length} attendance record${
                entries.length === 1
                    ? ""
                    : "s"
            } found`;


        $("taskHistory")
            .innerHTML =
            entries.length

                ? entries.map(
                    entry => `

                        <article class="task">

                            <time>
                                ${escapeHtml(
                                    entry.formattedDate ||
                                    toDate(
                                        entry.createdAt ||
                                        entry.date
                                    ).toLocaleDateString()
                                )}
                            </time>

                            ${escapeHtml(
                                entry.tasks ||
                                "No task details submitted for this day."
                            )}

                        </article>

                    `
                ).join("")

                : `
                    <p class="intro">
                        No task records were submitted for this intern.
                    </p>
                `;


    } catch (error) {

        console.error(error);

        $("historySummary")
            .textContent =
            "Task history could not be loaded.";

        $("taskHistory")
            .innerHTML = `

                <p class="intro">
                    Please continue with the evaluation
                    or contact the coordinator.
                </p>

            `;

    }

}


/* ==========================================
   GET FORM DATA
========================================== */

function getEvaluationData() {

    const form =
        new FormData(
            $("evaluationForm")
        );


    const ratings = {};


    document
        .querySelectorAll(
            ".question[data-question]"
        )
        .forEach((question) => {

            const key =
                question.dataset.question;

            const selected =
                question.querySelector(
                    `input[name="${key}"]:checked`
                );

            ratings[key] =
                selected
                    ? Number(selected.value)
                    : null;

        });


    return {

        ratings,

        strongPoints:
            form.get("strongPoints")
                ?.trim() || "",

        limitations:
            form.get("limitations")
                ?.trim() || "",

        professionalImprovement:
            form.get("professionalImprovement")
                ?.trim() || "",

        wouldHire:
            form.get("wouldHire") || "",

        programSuggestion:
            form.get("programSuggestion")
                ?.trim() || "",

        practicumerName:
            form.get("practicumerName")
                ?.trim() || "",

        practicumerPosition:
            form.get("practicumerPosition")
                ?.trim() || "",

        dateAccomplished:
            form.get("dateAccomplished") || "",

        evaluatorName:
            form.get("evaluatorName")
                ?.trim() || "",

        evaluatorCompany:
            form.get("evaluatorCompany")
                ?.trim() || "",

        evaluatorPosition:
            form.get("evaluatorPosition")
                ?.trim() || ""

    };

}


/* ==========================================
   SUBMIT
========================================== */

$("evaluationForm")
    .addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();


            if (!chosenIntern) {

                alert(
                    "Please select an intern first."
                );

                return;

            }


            const button =
                $("submitEvaluationBtn");


            button.disabled = true;

            button.innerHTML = `

                <i class="fa-solid fa-spinner fa-spin"></i>

                Saving...

            `;


            const evaluation =
                getEvaluationData();


            /* ----------------------------------
               PREVIEW MODE
            ---------------------------------- */

            if (isPreview) {

                submittedEvaluation =
                    evaluation;


                $("evaluationContent")
                    .classList.add("hidden");

                $("successState")
                    .classList.remove("hidden");


                button.disabled = false;

                return;

            }


            try {

                const evaluationRef =
                    await addDoc(
                        collection(
                            db,
                            "evaluations"
                        ),
                        {

                            companyId:
                                accessData.companyId,

                            companyName:
                                accessData.companyName,

                            guestAccessId:
                                accessDoc.id,

                            internId:
                                chosenIntern.id,

                            internName:
                                chosenIntern.fullName,

                            studentNumber:
                                chosenIntern.studentNumber ||
                                "",

                            course:
                                chosenIntern.course ||
                                "",

                            ratings:
                                evaluation.ratings,

                            strongPoints:
                                evaluation.strongPoints,

                            limitations:
                                evaluation.limitations,

                            professionalImprovement:
                                evaluation.professionalImprovement,

                            wouldHire:
                                evaluation.wouldHire,

                            programSuggestion:
                                evaluation.programSuggestion,

                            practicumerPosition:
                                evaluation.practicumerPosition,

                            dateAccomplished:
                                evaluation.dateAccomplished,

                            evaluatorName:
                                evaluation.evaluatorName,

                            evaluatorCompany:
                                evaluation.evaluatorCompany,

                            evaluatorPosition:
                                evaluation.evaluatorPosition,

                            signatureStatus:
                                "For Manual Signature",

                            submittedAt:
                                serverTimestamp(),

                            submittedBy:
                                "company_supervisor"

                        }
                    );


                await addDoc(
                    collection(
                        db,
                        "logs"
                    ),
                    {

                        type:
                            "evaluation",

                        action:
                            "Supervisor Evaluation Completed",

                        title:
                            "Supervisor Evaluation Completed",

                        description:
                            `${accessData.companyName} supervisor completed an evaluation for ${chosenIntern.fullName}.`,

                        studentName:
                            chosenIntern.fullName,

                        company:
                            accessData.companyName,

                        evaluationId:
                            evaluationRef.id,

                        timestamp:
                            serverTimestamp()

                    }
                );


                await updateDoc(

                    doc(
                        db,
                        "guestEvaluationAccess",
                        accessDoc.id
                    ),

                    {

                        submittedAt:
                            serverTimestamp(),

                        evaluatedInternId:
                            chosenIntern.id,

                        evaluationId:
                            evaluationRef.id

                    }

                );


                submittedEvaluation =
                    evaluation;


                $("evaluationContent")
                    .classList.add("hidden");

                $("successState")
                    .classList.remove("hidden");


            } catch (error) {

                console.error("EVALUATION SUBMISSION ERROR:", error);

                alert(
                    "Submission Error:\n\n" +
                    error.code +
                    "\n\n" +
                    error.message
                );

                button.disabled = false;

                button.innerHTML = `

                    <i class="fa-solid fa-floppy-disk"></i>

                    Submit Evaluation

                `;
            }

        }
    );


/* ==========================================
   PREVIEW BUTTON
========================================== */

$("previewBtn")
    .addEventListener(
        "click",
        () => {

            const form =
                $("evaluationForm");


            if (!form.reportValidity()) {

                return;

            }


            submittedEvaluation =
                getEvaluationData();


            openPrintPreview();

        }
    );


/* ==========================================
   VIEW AFTER SUBMIT
========================================== */

$("viewSubmittedBtn")
    .addEventListener(
        "click",
        () => {

            openPrintPreview();

        }
    );


$("printAfterSubmitBtn")
    .addEventListener(
        "click",
        () => {

            openPrintPreview();

        }
    );


/* ==========================================
   PRINT PREVIEW
========================================== */

function openPrintPreview() {

    if (!submittedEvaluation) {

        submittedEvaluation =
            getEvaluationData();

    }


    $("printDocument")
        .innerHTML =
        buildPrintDocument();


    $("printModal")
        .classList.remove("hidden");

}


function closePrintPreview() {

    $("printModal")
        .classList.add("hidden");

}


$("closePrintModal")
    .addEventListener(
        "click",
        closePrintPreview
    );


$("closePrintBtn")
    .addEventListener(
        "click",
        closePrintPreview
    );


/* ==========================================
   PRINT
========================================== */

$("printBtn")
    .addEventListener(
        "click",
        () => {

            window.print();

        }
    );


/* ==========================================
   PRINT HELPERS
========================================== */

function getRating(
    category,
    number
) {

    const value =
        submittedEvaluation
            ?.ratings?.[
                `${category}_${number}`
            ];


    return value
        ? Number(value)
        : null;

}


function printRatingCells(
    category,
    number
) {

    const selected =
        getRating(
            category,
            number
        );


    return [1, 2, 3, 4, 5]
        .map(
            rating => `

                <td
                    class="rating ${
                        selected === rating
                            ? "selected"
                            : ""
                    }"
                ></td>

            `
        )
        .join("");

}


function printHeader() {

    return `

        <div class="print-header">

            <div class="tagline">
                Touching Hearts…Renewing Minds…Transforming Lives
            </div>

            <div class="address">
                <strong>
                    Global Reciprocal Colleges
                </strong>
                <br>
                454 GRC Bldg., Rizal Avenue Ext.,
                corner 9th Avenue
                <br>
                Grace Park Caloocan City, Philippines
                <br>
                Telefax: (02)361-63-30; (02) 452-29-45
            </div>

        </div>

    `;

}


function printCategory(
    title,
    category,
    questions
) {

    return `

        <table class="print-table">

            <thead>

                <tr>

                    <th>
                        ${title}
                    </th>

                    <th>1</th>
                    <th>2</th>
                    <th>3</th>
                    <th>4</th>
                    <th>5</th>

                </tr>

            </thead>

            <tbody>

                ${
                    questions.map(
                        (question, index) => `

                            <tr>

                                <td class="question-text">
                                    ${index + 1}.
                                    ${question}
                                </td>

                                ${printRatingCells(
                                    category,
                                    index + 1
                                )}

                            </tr>

                        `
                    ).join("")
                }

            </tbody>

        </table>

    `;

}


/* ==========================================
   COMPLETE PRINT DOCUMENT
========================================== */

function buildPrintDocument() {

    const e =
        submittedEvaluation;


    /* --------------------------------------
       PAGE 1
    -------------------------------------- */

    const page1 = `

        <section class="print-page">

            ${printHeader()}


            <div class="print-title">
                ON THE JOB TRAINING EVALUATION FORM
            </div>


            <div class="print-part-title">
                PART I: GENERAL ASSESSMENT
            </div>


            <p class="print-intro">

                This questionnaire is designed to evaluate the
                student who had undergone the OJT Program of
                Global Reciprocal Colleges.

                Please answer the questions below as accurately
                and as honestly as you can by checking (✓)
                the appropriate box corresponding the ratings
                given, with five (5) as the highest score and
                one (1) as the lowest.

            </p>


            ${printCategory(

                "Integration of Basic Theory in Practice",

                "integration",

                [

                    "The trainee possesses the necessary and expected professional body of information relevant to the assigned tasks.",

                    "The trainee easily gains knowledge and understanding of any instruction, skill or work assigned.",

                    "The trainee demonstrates a fundamental knowledge of job content.",

                    "The trainee effectively uses technology relevant to the assigned tasks.",

                    "The trainee shows his/her ability to perform assigned tasks with precision, thoroughness, and professionalism."

                ]

            )}


            ${printCategory(

                "Understanding of the Profession",

                "profession",

                [

                    "The trainee is capable to initiate and work voluntarily.",

                    "The trainee shows respect to the authorities and follows protocol.",

                    "The trainee displays his/her capability to analyze, interpret, weigh and judge certain ideas professionally.",

                    "The trainee understands the duties and responsibilities of the job as applied to the goals of the department/company."

                ]

            )}

        </section>

    `;


    /* --------------------------------------
       PAGE 2
    -------------------------------------- */

    const page2 = `

        <section class="print-page">

            ${printHeader()}


            ${printCategory(

                "Understanding of the Profession",

                "profession",

                [

                    "The trainee demonstrates a high degree of professionalism and moral values and maintains the confidentiality of all office matters."

                ]

            )}


            ${printCategory(

                "Quality and Quantity of Work",

                "quality",

                [

                    "The trainee displays his/her hard work, diligence and conscientiousness in the performance of the assigned tasks.",

                    "The extent on how regular the trainee reports to work on time.",

                    "The trainee assumes responsibility beyond scope of normal work duties.",

                    "The trainee organizes work to improve output and minimize rework.",

                    "The extent the trainee completes assignments and meets commitments."

                ]

            )}


            ${printCategory(

                "Practicumer’s skill in various program settings and areas",

                "skills",

                [

                    "The trainee is capable of completing work under time pressure with satisfactory results.",

                    "The trainee is able to identify deficiencies in workflow or procedures.",

                    "The trainee follows job procedure and methods.",

                    "The trainee is able to adjust, accommodate and conform to the conditions of his/her workplace.",

                    "The trainee is able to convey his/her thoughts and ideas with ease and proficiency, whether verbally or in written form."

                ]

            )}

        </section>

    `;


    /* --------------------------------------
       PAGE 3
    -------------------------------------- */

    const page3 = `

        <section class="print-page">

            ${printHeader()}


            ${printCategory(

                "Intrapersonal and interpersonal Skills",

                "interpersonal",

                [

                    "The trainee is receptive to feedback and constructive criticism.",

                    "The trainee focuses discussions on desired results.",

                    "The trainee works effectively in groups.",

                    "The trainee is able to relate with other departments.",

                    "The trainee promotes and uses candid and open communications."

                ]

            )}


            <div class="print-part-title">

                PART 2:
                DEVELOPMENTAL PROFILE AND RECOMMENDATIONS

            </div>


            ${printAnswerQuestion(

                "1. What are the trainee’s strong points?",

                e.strongPoints

            )}


            ${printAnswerQuestion(

                "2. What are the trainee’s significant limitations?",

                e.limitations

            )}


            ${printAnswerQuestion(

                "3. What can the trainee do to improve himself professionally?",

                e.professionalImprovement

            )}


            <div class="print-question">

                4. If ever the practicumer would apply for a position
                in your company for possible employment, would you hire him/her?

            </div>


            <p class="print-intro">

                ______ Yes
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                ______ No

            </p>


            <div class="print-part-title">

                PART 3:
                EVALUATION OF THE PRACTICUM PROGRAM
                OF GLOBAL RECIPROCAL COLLEGES

            </div>

        </section>

    `;


    /* --------------------------------------
       PAGE 4
    -------------------------------------- */

    const page4 = `

        <section class="print-page">

            ${printHeader()}


            <p class="print-intro">

                As part of our Evaluation Process, we would like
                to solicit your comments and suggestions to further
                improve our Practicum Program.

            </p>


            ${printCategory(

                "FACTORS",

                "program",

                [

                    "Policies and procedures of the trainee practicum program.",

                    "Coordination between the school and participating company/institution.",

                    "Quality of the content of the evaluation sheet.",

                    "Preparedness of the trainees to undergo on-job-training."

                ]

            )}


            ${printAnswerQuestion(

                "5. What other suggestion can you give to improve the Practicum Program of Global Reciprocal Colleges?",

                e.programSuggestion

            )}


            <div class="print-details">

                <div class="print-detail-row">

                    <span class="print-detail-label">
                        Practicumer’s Name:
                    </span>

                    <strong>
                        ${escapeHtml(
                            e.practicumerName
                        )}
                    </strong>

                </div>


                <div class="print-detail-row">

                    <span class="print-detail-label">
                        Position/Job in the Company:
                    </span>

                    <strong>
                        ${escapeHtml(
                            e.practicumerPosition
                        )}
                    </strong>

                </div>


                <div class="print-detail-row">

                    <span class="print-detail-label">
                        Date Accomplished:
                    </span>

                    <strong>
                        ${escapeHtml(
                            e.dateAccomplished
                        )}
                    </strong>

                </div>

            </div>

        </section>

    `;


    /* --------------------------------------
       PAGE 5
    -------------------------------------- */

    const page5 = `

        <section class="print-page">

            ${printHeader()}


            <div class="print-details">

                <div class="print-detail-row">

                    Name of Evaluator:

                    <strong>
                        ${escapeHtml(
                            e.evaluatorName
                        )}
                    </strong>

                </div>


                <div class="print-detail-row">

                    Company:

                    <strong>
                        ${escapeHtml(
                            e.evaluatorCompany
                        )}
                    </strong>

                </div>


                <div class="print-detail-row">

                    Position:

                    <strong>
                        ${escapeHtml(
                            e.evaluatorPosition
                        )}
                    </strong>

                </div>


                <div class="print-detail-row print-signature">

                    Signature:

                    <br><br>

                    __________________________________________

                </div>

            </div>


            <div
                style="
                    margin-top:45px;
                    text-align:center;
                    font-size:11px;
                "
            >

                <strong>
                    OJT-LOGS
                </strong>

                <br>

                Student Internship Records and
                Performance Monitoring

            </div>

        </section>

    `;


    return (

        page1 +
        page2 +
        page3 +
        page4 +
        page5

    );

}


/* ==========================================
   PRINT ANSWER
========================================== */

function printAnswerQuestion(
    question,
    answer
) {

    return `

        <div class="print-question">
            ${question}
        </div>

        <div class="print-answer">

            ${escapeHtml(
                answer || ""
            )}

        </div>

        <div class="print-answer"></div>

        <div class="print-answer"></div>

    `;

}


/* ==========================================
   START
========================================== */

loadAccess();