import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

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

const app = initializeApp(firebaseConfig);

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

    loadSidebar();

    loadHeader();

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = "../student_login/student_login.html";
            return;
        }

        await loadStudentPerformance(user);

    });

});


/* ==========================================
   SIDEBAR
========================================== */

function loadSidebar() {

    fetch("../templated/sidebar.html")
        .then(response => {

            if (!response.ok) {
                throw new Error("Sidebar could not be loaded.");
            }

            return response.text();

        })
        .then(html => {

            const container =
                document.getElementById("sidebar-container");

            if (!container) return;

            container.innerHTML = html;

            if (typeof initSidebar === "function") {
                initSidebar("Performance");
            }

        })
        .catch(error => {
            console.error("Sidebar Error:", error);
        });

}


/* ==========================================
   HEADER
========================================== */

async function loadHeader() {

    try {

        const response =
            await fetch("../templated/header.html");

        if (!response.ok) {
            throw new Error("Header could not be loaded.");
        }

        const html = await response.text();

        const container =
            document.getElementById("header-container");

        if (!container) return;

        container.innerHTML = html;

        const pageTitle =
            document.getElementById("page-title");

        if (pageTitle) {
            pageTitle.textContent = "Performance";
        }

    } catch (error) {

        console.error("Header Error:", error);

    }

}


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


        displayEvaluation(evaluation);


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
                evaluations[0]
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

function displayEvaluation(evaluation) {

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
                    evaluation
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
   VIEW EVALUATION
========================================== */

function openEvaluationDetails(evaluation) {

    /*
     * For now, show the complete evaluation
     * in a readable student-facing modal.
     */

    const ratings =
        evaluation.ratings || {};


    const ratingRows =
        Object.entries(ratings)
            .map(
                ([key, value]) => `
                    <div class="evaluation-detail-row">

                        <span>
                            ${formatQuestionKey(key)}
                        </span>

                        <strong>
                            ${value ?? "--"} / 5
                        </strong>

                    </div>
                `
            )
            .join("");


    const modal =
        document.createElement("div");


    modal.className =
        "evaluation-view-modal";


    modal.innerHTML = `

        <div class="evaluation-view-overlay"></div>

        <div class="evaluation-view-card">

            <button
                class="evaluation-close"
                type="button"
            >
                <i class="fa-solid fa-xmark"></i>
            </button>


            <div class="evaluation-view-header">

                <span class="vertical-line red"></span>

                <div>

                    <h3>
                        Supervisor Evaluation
                    </h3>

                    <p>
                        Completed evaluation details
                    </p>

                </div>

            </div>


            <div class="evaluation-view-info">

                <div>
                    <span>Supervisor</span>
                    <strong>
                        ${escapeHtml(
                            evaluation.evaluatorName || "--"
                        )}
                    </strong>
                </div>

                <div>
                    <span>Company</span>
                    <strong>
                        ${escapeHtml(
                            evaluation.evaluatorCompany ||
                            evaluation.companyName ||
                            "--"
                        )}
                    </strong>
                </div>

            </div>


            <div class="evaluation-view-ratings">

                <h4>
                    Evaluation Ratings
                </h4>

                ${ratingRows}

            </div>


            ${
                evaluation.strongPoints
                    ? `
                    <div class="modal-feedback">
                        <strong>Strong Points</strong>
                        <p>
                            ${escapeHtml(
                                evaluation.strongPoints
                            )}
                        </p>
                    </div>
                    `
                    : ""
            }


            ${
                evaluation.limitations
                    ? `
                    <div class="modal-feedback">
                        <strong>Areas for Improvement</strong>
                        <p>
                            ${escapeHtml(
                                evaluation.limitations
                            )}
                        </p>
                    </div>
                    `
                    : ""
            }


            ${
                evaluation.professionalImprovement
                    ? `
                    <div class="modal-feedback">
                        <strong>Professional Development</strong>
                        <p>
                            ${escapeHtml(
                                evaluation.professionalImprovement
                            )}
                        </p>
                    </div>
                    `
                    : ""
            }

        </div>
    `;


    document.body.appendChild(modal);


    const close =
        modal.querySelector(
            ".evaluation-close"
        );


    const overlay =
        modal.querySelector(
            ".evaluation-view-overlay"
        );


    const removeModal = () => {
        modal.remove();
    };


    close.addEventListener(
        "click",
        removeModal
    );


    overlay.addEventListener(
        "click",
        removeModal
    );

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