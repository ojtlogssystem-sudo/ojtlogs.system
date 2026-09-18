import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { loadHeader } from "../templated/header-loader.js";


/* ==========================================
   FIREBASE
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

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

const auth = getAuth(app);
const db = getFirestore(app);


/* ==========================================
   DOM HELPER
========================================== */

function $(id) {
    return document.getElementById(id);
}


/* ==========================================
   PAGE LOAD
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    loadSidebar("Performance");

    loadHeader("Performance", { autoLoadProfile: true });

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = "../student_login/student_login.html";
            return;
        }

        await loadStudentPerformance(user);

    });

});


/* ==========================================
   LOAD STUDENT
========================================== */

async function loadStudentPerformance(user) {

    try {

        /*
         * We use the logged-in Firebase UID
         * as the student's internId.
         */

        const studentRef =
            doc(db, "users", user.uid);

        const studentSnap =
            await getDoc(studentRef);


        if (!studentSnap.exists()) {

            console.warn(
                "Student profile not found."
            );

            showNoEvaluation();

            return;

        }


        const studentData =
            studentSnap.data();


        /*
         * Search evaluation using the same
         * internId saved by guest-evaluation.js.
         */

        await loadEvaluation(
            user.uid,
            studentData
        );


    } catch (error) {

        console.error(
            "Performance loading error:",
            error
        );

        showNoEvaluation();

    }

}


/* ==========================================
   LOAD EVALUATION
========================================== */

async function loadEvaluation(
    studentId,
    studentData
) {

    try {

        const evaluationsRef =
            collection(db, "evaluations");


        const evaluationQuery =
            query(
                evaluationsRef,
                where("internId", "==", studentId),
                orderBy("submittedAt", "desc"),
                limit(1)
            );


        const snapshot =
            await getDocs(evaluationQuery);


        if (snapshot.empty) {

            showNoEvaluation();

            return;

        }


        const evaluationDoc =
            snapshot.docs[0];

        const evaluation =
            evaluationDoc.data();


        console.log(
            "Student Evaluation:",
            evaluation
        );


        displayEvaluation(evaluation, studentData);


    } catch (error) {

        /*
         * If Firestore requires an index for the
         * orderBy query, retry without orderBy.
         */

        console.warn(
            "Evaluation query retry:",
            error
        );


        try {

            const fallbackQuery =
                query(
                    collection(db, "evaluations"),
                    where(
                        "internId",
                        "==",
                        studentId
                    )
                );


            const snapshot =
                await getDocs(fallbackQuery);


            if (snapshot.empty) {

                showNoEvaluation();

                return;

            }


            /*
             * Sort locally instead.
             */

            const evaluations =
                snapshot.docs
                    .map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }))
                    .sort(
                        (a, b) =>
                            getTimestamp(
                                b.submittedAt
                            ) -
                            getTimestamp(
                                a.submittedAt
                            )
                    );


            displayEvaluation(
                evaluations[0],
                studentData
            );


        } catch (fallbackError) {

            console.error(
                "Evaluation fallback error:",
                fallbackError
            );

            showNoEvaluation();

        }

    }

}


/* ==========================================
   DISPLAY EVALUATION
========================================== */

function displayEvaluation(evaluation, studentData) {

    const ratings =
        evaluation.ratings || {};


    /*
     * ==========================================
     * GET CATEGORY SCORES
     * ==========================================
     *
     * The evaluation form stores each question
     * using its data-question key.
     *
     * We identify categories based on the
     * question key prefix.
     */

    const theoryScore =
        calculateCategory(
            ratings,
            [
                "integration"
            ]
        );


    const professionScore =
        calculateCategory(
            ratings,
            [
                "profession"
            ]
        );


    const qualityScore =
        calculateCategory(
            ratings,
            [
                "quality"
            ]
        );


    const skillsScore =
        calculateCategory(
            ratings,
            [
                "skills"
            ]
        );


    const interpersonalScore =
        calculateCategory(
            ratings,
            [
                "interpersonal"
            ]
        );


    /*
     * ==========================================
     * ALL RATINGS
     * ==========================================
     */

    const allScores =
        Object.values(ratings)
            .filter(value =>
                typeof value === "number"
            );


    const overall =
        allScores.length
            ? average(allScores)
            : 0;


    /*
     * ==========================================
     * OVERALL
     * ==========================================
     */

    if ($("overall-score")) {

        $("overall-score").textContent =
            overall
                ? overall.toFixed(1)
                : "--";

    }


    updateScoreCircle(overall);


    if ($("performance-status")) {

        $("performance-status")
            .textContent =
            getPerformanceStatus(overall);

    }


    if ($("performance-description")) {

        $("performance-description")
            .textContent =
            "Your supervisor has completed your internship performance evaluation.";

    }


    /*
     * ==========================================
     * STATUS
     * ==========================================
     */

    if ($("evaluation-status")) {

        $("evaluation-status")
            .textContent =
            "Completed";

    }


    if ($("evaluation-date")) {

        $("evaluation-date")
            .textContent =
            formatDate(
                evaluation.submittedAt
            );

    }


    /*
     * ==========================================
     * BREAKDOWN
     * ==========================================
     */

    setCategory(
        "theory-score",
        "theory-progress",
        theoryScore
    );


    setCategory(
        "profession-score",
        "profession-progress",
        professionScore
    );


    setCategory(
        "quality-score",
        "quality-progress",
        qualityScore
    );


    setCategory(
        "skills-score",
        "skills-progress",
        skillsScore
    );


    /*
     * ==========================================
     * DETAILS
     * ==========================================
     */

    if ($("supervisor-name")) {

        $("supervisor-name")
            .textContent =
            evaluation.evaluatorName ||
            "--";

    }


    if ($("evaluation-company")) {

        $("evaluation-company")
            .textContent =
            evaluation.evaluatorCompany ||
            evaluation.companyName ||
            "--";

    }


    if ($("evaluation-date-detail")) {

        $("evaluation-date-detail")
            .textContent =
            formatDate(
                evaluation.submittedAt ||
                evaluation.dateAccomplished
            );

    }


    if ($("evaluation-rating")) {

        $("evaluation-rating")
            .textContent =
            overall
                ? `${overall.toFixed(1)} / 5`
                : "-- / 5";

    }


    /*
     * ==========================================
     * FEEDBACK
     * ==========================================
     */

    displayFeedback(evaluation);


    /*
     * ==========================================
     * VIEW BUTTON
     * ==========================================
     */

    const viewButton =
        $("view-evaluation-btn");


    if (viewButton) {

        viewButton.disabled = false;

        viewButton.addEventListener(
            "click",
            () => {

                openEvaluationDetails(
                    evaluation,
                    studentData
                );

            },
            {
                once: true
            }
        );

    }

}


/* ==========================================
   CATEGORY CALCULATOR
========================================== */

function calculateCategory(
    ratings,
    prefixes
) {

    const values = [];

    Object.entries(ratings)
        .forEach(([key, value]) => {

            if (
                typeof value !== "number"
            ) {
                return;
            }

            const lowerKey =
                key.toLowerCase();


            const matched =
                prefixes.some(prefix =>
                    lowerKey.includes(
                        prefix
                    )
                );


            if (matched) {
                values.push(value);
            }

        });


    return values.length
        ? average(values)
        : 0;

}


/* ==========================================
   AVERAGE
========================================== */

function average(values) {

    if (!values.length) {
        return 0;
    }

    return (
        values.reduce(
            (sum, value) =>
                sum + value,
            0
        ) / values.length
    );

}


/* ==========================================
   SET CATEGORY UI
========================================== */

function setCategory(
    scoreId,
    progressId,
    score
) {

    const scoreElement =
        $(scoreId);

    const progressElement =
        $(progressId);


    if (scoreElement) {

        scoreElement.textContent =
            score
                ? `${score.toFixed(1)}/5`
                : "--/5";

    }


    if (progressElement) {

        const percentage =
            score
                ? (score / 5) * 100
                : 0;

        progressElement.style.width =
            `${percentage}%`;

    }

}


/* ==========================================
   SCORE CIRCLE
========================================== */

function updateScoreCircle(score) {

    const circle =
        document.querySelector(
            ".score-circle"
        );


    if (!circle) return;


    const percentage =
        score
            ? (score / 5) * 100
            : 0;


    circle.style.background =
        `conic-gradient(
            var(--primary)
            ${percentage}%,
            #eeeeee
            ${percentage}%
        )`;

}


/* ==========================================
   PERFORMANCE STATUS
========================================== */

function getPerformanceStatus(score) {

    if (!score) {
        return "Evaluation Pending";
    }

    if (score >= 4.5) {
        return "Excellent Performance";
    }

    if (score >= 3.5) {
        return "Good Performance";
    }

    if (score >= 2.5) {
        return "Satisfactory Performance";
    }

    return "Needs Improvement";

}


/* ==========================================
   FEEDBACK
========================================== */

function displayFeedback(evaluation) {

    const container =
        $("supervisor-feedback");


    if (!container) return;


    const strongPoints =
        evaluation.strongPoints || "";

    const limitations =
        evaluation.limitations || "";

    const professionalImprovement =
        evaluation.professionalImprovement || "";

    const programSuggestion =
        evaluation.programSuggestion || "";


    const hasFeedback =
        strongPoints ||
        limitations ||
        professionalImprovement ||
        programSuggestion;


    if (!hasFeedback) {

        container.innerHTML = `
            <div class="feedback-empty">

                <div class="feedback-icon">
                    <i class="fa-regular fa-comment-dots"></i>
                </div>

                <h4>
                    No feedback provided
                </h4>

                <p>
                    Your supervisor did not provide additional comments.
                </p>

            </div>
        `;

        return;

    }


    container.innerHTML = `

        <div class="feedback-list">

            ${
                strongPoints
                    ? `
                    <div class="feedback-item">
                        <strong>Strong Points</strong>
                        <p>${escapeHtml(strongPoints)}</p>
                    </div>
                    `
                    : ""
            }


            ${
                limitations
                    ? `
                    <div class="feedback-item">
                        <strong>Areas for Improvement</strong>
                        <p>${escapeHtml(limitations)}</p>
                    </div>
                    `
                    : ""
            }


            ${
                professionalImprovement
                    ? `
                    <div class="feedback-item">
                        <strong>Professional Development</strong>
                        <p>${escapeHtml(professionalImprovement)}</p>
                    </div>
                    `
                    : ""
            }


            ${
                programSuggestion
                    ? `
                    <div class="feedback-item">
                        <strong>Program Suggestions</strong>
                        <p>${escapeHtml(programSuggestion)}</p>
                    </div>
                    `
                    : ""
            }

        </div>
    `;

}


/* ==========================================
   EVALUATION FORM CONTENT
   (mirrors guest-evaluation.html so the
   printed layout matches the official form)
========================================== */

const EVALUATION_CATEGORIES = [

    {
        prefix: "integration",
        title: "Integration of Basic Theory in Practice",
        questions: [
            "The trainee possesses the necessary and expected professional body of information relevant to the assigned tasks.",
            "The trainee easily gains knowledge and understanding of any instruction, skill or work assigned.",
            "The trainee demonstrates a fundamental knowledge of job content.",
            "The trainee effectively uses technology relevant to the assigned tasks.",
            "The trainee shows his/her ability to perform assigned tasks with precision, thoroughness, and professionalism."
        ]
    },

    {
        prefix: "profession",
        title: "Understanding of the Profession",
        questions: [
            "The trainee is capable to initiate and work voluntarily.",
            "The trainee shows respect to the authorities and follows protocol.",
            "The trainee displays his/her capability to analyze, interpret, weigh and judge certain ideas professionally.",
            "The trainee understands the duties and responsibilities of the job as applied to the goals of the department/company.",
            "The trainee demonstrates a high degree of professionalism and moral values and maintains the confidentiality of all office matters."
        ]
    },

    {
        prefix: "quality",
        title: "Quality and Quantity of Work",
        questions: [
            "The trainee displays his/her hard work, diligence and conscientiousness in the performance of the assigned tasks.",
            "The extent on how regular the trainee reports to work on time.",
            "The trainee assumes responsibility beyond scope of normal work duties.",
            "The trainee organizes work to improve output and minimize rework.",
            "The extent the trainee completes assignments and meets commitments."
        ]
    },

    {
        prefix: "skills",
        title: "Practicumer\u2019s skill in various program settings and areas",
        questions: [
            "The trainee is capable of completing work under time pressure with satisfactory results.",
            "The trainee is able to identify deficiencies in workflow or procedures.",
            "The trainee follows job procedure and methods.",
            "The trainee is able to adjust, accommodate and conform to the conditions of his/her workplace.",
            "The trainee is able to convey his/her thoughts and ideas with ease and proficiency, whether verbally or in written form."
        ]
    },

    {
        prefix: "interpersonal",
        title: "Intrapersonal and interpersonal Skills",
        questions: [
            "The trainee is receptive to feedback and constructive criticism.",
            "The trainee focuses discussions on desired results.",
            "The trainee works effectively in groups.",
            "The trainee is able to relate with other departments.",
            "The trainee promotes and uses candid and open communications."
        ]
    }

];


const PROGRAM_FACTORS = {

    prefix: "program",
    title: "FACTORS",
    questions: [
        "Policies and procedures of the trainee practicum program.",
        "Coordination between the school and participating company/institution.",
        "Quality of the content of the evaluation sheet.",
        "Preparedness of the trainees to undergo on-job-training."
    ]

};


/* ==========================================
   VIEW EVALUATION
========================================== */

function openEvaluationDetails(evaluation, studentData) {

    const printDocument =
        $("printDocument");

    const printModal =
        $("printModal");


    if (!printDocument || !printModal) {
        return;
    }


    printDocument.innerHTML =
        buildEvaluationPrintPage(
            evaluation,
            studentData
        );


    printModal.classList.remove("hidden");


    const close = () => {
        printModal.classList.add("hidden");
    };


    const closeIcon =
        $("closePrintModal");

    const closeBtn =
        $("closePrintBtn");

    const printBtn =
        $("printBtn");


    if (closeIcon) {
        closeIcon.onclick = close;
    }


    if (closeBtn) {
        closeBtn.onclick = close;
    }


    if (printBtn) {

        printBtn.onclick = () => {
            window.print();
        };

    }

}


/* ==========================================
   BUILD PRINT PAGE
========================================== */

function buildEvaluationPrintPage(evaluation, studentData = {}) {

    const ratings =
        evaluation.ratings || {};


    const studentFullName =
        studentData.fullName ||
        studentData.fullname ||
        studentData.name ||
        [
            studentData.firstName,
            studentData.lastName
        ].filter(Boolean).join(" ") ||
        evaluation.practicumerName ||
        "--";


    const rawCourse =
        (studentData.course || "").trim();

    const rawSection =
        (studentData.section || "").trim();


    const cleanedSection =
        rawCourse && rawSection
            .toLowerCase()
            .startsWith(rawCourse.toLowerCase())
            ? rawSection
                .slice(rawCourse.length)
                .trim()
                .replace(/^[-\s]+/, "")
            : rawSection;


    const courseSection =
        studentData.courseSection ||
        [
            rawCourse,
            cleanedSection
        ].filter(Boolean).join(" - ") ||
        "--";


    const dutyCompany =
        evaluation.companyName ||
        evaluation.evaluatorCompany ||
        studentData.company ||
        studentData.companyName ||
        "--";


    const categoriesHtml =
        EVALUATION_CATEGORIES
            .map(category =>
                buildRatingTable(
                    category,
                    ratings
                )
            )
            .join("");


    const programTableHtml =
        buildRatingTable(
            PROGRAM_FACTORS,
            ratings
        );


    const wouldHire =
        evaluation.wouldHire || "--";


    return `

        <div class="print-page">

            <div class="print-header">

                <div class="tagline">
                    Touching Hearts&hellip;Renewing Minds&hellip;Transforming Lives
                </div>

                <div class="school">
                    Global Reciprocal Colleges
                </div>

                <div class="address">
                    454 GRC Bldg., Rizal Avenue Ext., corner 9th Avenue<br>
                    Grace Park Caloocan City, Philippines<br>
                    Telefax: (02)361-63-30; (02) 452-29-45
                </div>

            </div>


            <div class="print-student-info">

                <div>
                    <span class="print-detail-label">Name:</span>
                    <span>${escapeHtml(studentFullName)}</span>
                </div>

                <div>
                    <span class="print-detail-label">Course &amp; Section:</span>
                    <span>${escapeHtml(courseSection)}</span>
                </div>

                <div>
                    <span class="print-detail-label">Date Submitted:</span>
                    <span>${formatDate(evaluation.submittedAt)}</span>
                </div>

                <div>
                    <span class="print-detail-label">Company:</span>
                    <span>${escapeHtml(dutyCompany)}</span>
                </div>

            </div>


            <div class="print-title">
                ON THE JOB TRAINING EVALUATION FORM
            </div>


            <div class="print-part-title">
                PART I: GENERAL ASSESSMENT
            </div>

            <p class="print-intro">
                This questionnaire is designed to evaluate the student who
                had undergone the OJT Program of Global Reciprocal Colleges.
                Please answer the questions below as accurately and as
                honestly as you can by checking (&#10003;) the appropriate
                box corresponding the ratings given, with five (5) as the
                highest score and one (1) as the lowest.
            </p>

            ${categoriesHtml}


            <div class="print-part-title">
                PART II: DEVELOPMENTAL PROFILE AND RECOMMENDATIONS
            </div>

            <div class="print-question">
                1. What are the trainee&rsquo;s strong points?
            </div>
            <div class="print-answer">
                ${escapeHtml(evaluation.strongPoints || "")}
            </div>

            <div class="print-question">
                2. What are the trainee&rsquo;s significant limitations?
            </div>
            <div class="print-answer">
                ${escapeHtml(evaluation.limitations || "")}
            </div>

            <div class="print-question">
                3. What can the trainee do to improve himself professionally?
            </div>
            <div class="print-answer">
                ${escapeHtml(evaluation.professionalImprovement || "")}
            </div>

            <div class="print-question">
                4. If ever the practicumer would apply for a position in
                your company for possible employment, would you hire him/her?
            </div>
            <div class="print-answer">
                ${escapeHtml(wouldHire)}
            </div>


            <div class="print-part-title">
                PART III: EVALUATION OF THE PRACTICUM PROGRAM OF
                GLOBAL RECIPROCAL COLLEGES
            </div>

            <p class="print-intro">
                As part of our Evaluation Process, we would like to solicit
                your comments and suggestions to further improve our
                Practicum Program.
            </p>

            ${programTableHtml}

            <div class="print-question">
                5. What other suggestion can you give to improve the
                Practicum Program of Global Reciprocal Colleges?
            </div>
            <div class="print-answer">
                ${escapeHtml(evaluation.programSuggestion || "")}
            </div>


            <div class="print-details">

                <div class="print-detail-row">
                    <span class="print-detail-label">Practicumer&rsquo;s Name:</span>
                    <span>${escapeHtml(evaluation.practicumerName || "--")}</span>
                </div>

                <div class="print-detail-row">
                    <span class="print-detail-label">Position/Job in the Company:</span>
                    <span>${escapeHtml(evaluation.practicumerPosition || "--")}</span>
                </div>

                <div class="print-detail-row">
                    <span class="print-detail-label">Date Accomplished:</span>
                    <span>${formatDate(evaluation.dateAccomplished || evaluation.submittedAt)}</span>
                </div>

                <div class="print-detail-row">
                    <span class="print-detail-label">Name of Evaluator:</span>
                    <span>${escapeHtml(evaluation.evaluatorName || "--")}</span>
                </div>

                <div class="print-detail-row">
                    <span class="print-detail-label">Company:</span>
                    <span>${escapeHtml(evaluation.evaluatorCompany || evaluation.companyName || "--")}</span>
                </div>

                <div class="print-detail-row">
                    <span class="print-detail-label">Position:</span>
                    <span>${escapeHtml(evaluation.evaluatorPosition || "--")}</span>
                </div>

                <div class="print-detail-row print-signature">
                    <div class="signature-block">
                        <span class="print-detail-label">Signature:</span>
                        <div class="signature-line"></div>
                    </div>
                </div>

            </div>


            <div class="print-footer">
                <strong>OJT-LOGS</strong>
                <span>Student Internship Records and Performance Monitoring</span>
            </div>

        </div>
    `;

}


/* ==========================================
   BUILD RATING TABLE
========================================== */

function buildRatingTable(category, ratings) {

    const rows =
        category.questions
            .map((text, index) => {

                const key =
                    `${category.prefix}_${index + 1}`;

                const value =
                    ratings[key];


                const cells =
                    [1, 2, 3, 4, 5]
                        .map(score => `
                            <td class="rating${
                                value === score
                                    ? " selected"
                                    : ""
                            }"></td>
                        `)
                        .join("");


                return `
                    <tr>
                        <td class="question-text">
                            ${index + 1}. ${escapeHtml(text)}
                        </td>
                        ${cells}
                    </tr>
                `;

            })
            .join("");


    return `
        <table class="print-table">

            <thead>
                <tr class="category-row">
                    <th>${escapeHtml(category.title)}</th>
                    <th>1</th>
                    <th>2</th>
                    <th>3</th>
                    <th>4</th>
                    <th>5</th>
                </tr>
            </thead>

            <tbody>
                ${rows}
            </tbody>

        </table>
    `;

}


/* ==========================================
   NO EVALUATION
========================================== */

function showNoEvaluation() {

    if ($("overall-score")) {
        $("overall-score").textContent = "--";
    }


    if ($("performance-status")) {

        $("performance-status")
            .textContent =
            "Evaluation Pending";

    }


    if ($("performance-description")) {

        $("performance-description")
            .textContent =
            "Your supervisor evaluation will appear here once it has been submitted.";

    }


    if ($("evaluation-status")) {

        $("evaluation-status")
            .textContent =
            "Not Yet Available";

    }


    if ($("evaluation-date")) {

        $("evaluation-date")
            .textContent =
            "Waiting for evaluation";

    }


    [
        "theory-score",
        "profession-score",
        "quality-score",
        "skills-score"
    ].forEach(id => {

        if ($(id)) {
            $(id).textContent = "--/5";
        }

    });


    [
        "theory-progress",
        "profession-progress",
        "quality-progress",
        "skills-progress"
    ].forEach(id => {

        if ($(id)) {
            $(id).style.width = "0%";
        }

    });

}


/* ==========================================
   DATE
========================================== */

function getTimestamp(value) {

    if (!value) return 0;


    if (
        typeof value.toMillis ===
        "function"
    ) {
        return value.toMillis();
    }


    if (
        value.seconds !== undefined
    ) {
        return value.seconds * 1000;
    }


    return new Date(value).getTime() || 0;

}


function formatDate(value) {

    if (!value) {
        return "--";
    }


    const timestamp =
        getTimestamp(value);


    if (!timestamp) {
        return "--";
    }


    return new Date(
        timestamp
    ).toLocaleDateString(
        "en-US",
        {
            month: "short",
            day: "numeric",
            year: "numeric"
        }
    );

}


/* ==========================================
   QUESTION LABEL
========================================== */

function formatQuestionKey(key) {

    return key
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, char =>
            char.toUpperCase()
        );

}


/* ==========================================
   ESCAPE HTML
========================================== */

function escapeHtml(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}