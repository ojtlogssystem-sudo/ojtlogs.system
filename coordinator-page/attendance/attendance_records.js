import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import {
    getFirestore,
    collection,
    getDocs,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";


// =====================================================
// FIREBASE CONFIG
// =====================================================

const firebaseConfig = {

    apiKey: "AIzaSyDvMQyEHIIJTW4etj4VQHjjIzd8oB2geJ8",

    authDomain:
        "ojt-logs-e1892.firebaseapp.com",

    databaseURL:
        "https://ojt-logs-e1892-default-rtdb.firebaseio.com",

    projectId:
        "ojt-logs-e1892",

    storageBucket:
        "ojt-logs-e1892.firebasestorage.app",

    messagingSenderId:
        "1012575426857",

    appId:
        "1:1012575426857:web:c2d6dbcdc0dc0ad965ff38",

    measurementId:
        "G-DJ3JW7QH27"

};


const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

const auth = getAuth(app);


const attendanceRef =
    collection(db, "attendance");

const usersRef =
    collection(db, "users");


// =====================================================
// PAGE
// =====================================================

document.addEventListener("DOMContentLoaded", () => {


    const attendanceTable =
        document.getElementById("attendanceTable");

    const searchInput =
        document.getElementById("attendanceSearch");

    const sectionFilter =
        document.getElementById("sectionFilter");

    const statusFilter =
        document.getElementById("statusFilter");

    const paginationInfo =
        document.getElementById("paginationInfo");

    const prevPageBtn =
        document.getElementById("prevPageBtn");

    const nextPageBtn =
        document.getElementById("nextPageBtn");

    const pageNumbers =
        document.getElementById("pageNumbers");

    const rowsPerPageSelect =
        document.getElementById("rowsPerPageSelect");


    let allRecords = [];

    let filteredRecords = [];

    let usersMap = {};

    let currentPage = 1;

    let rowsPerPage = 6;



    // =================================================
    // INITIALS
    // =================================================

    function getInitials(name) {

        if (!name || typeof name !== "string") {
            return "CO";
        }

        const words =
            name.trim().split(/\s+/);

        if (words.length === 1) {
            return words[0]
                .charAt(0)
                .toUpperCase();
        }

        return (
            words[0].charAt(0) +
            words[words.length - 1].charAt(0)
        ).toUpperCase();

    }



    // =================================================
    // PROFILE
    // =================================================

    function syncUserProfile() {

        const profileNameEl =
            document.getElementById("profileName");

        const profileAvatarEl =
            document.getElementById("profileAvatar");

        const profileRoleEl =
            document.getElementById("profileRole");


        onAuthStateChanged(auth, async (user) => {

            if (user) {

                try {

                    const snapshot =
                        await getDocs(usersRef);

                    let foundUser = null;


                    snapshot.forEach((docSnap) => {

                        const data =
                            docSnap.data();

                        if (
                            data.email === user.email ||
                            docSnap.id === user.uid
                        ) {

                            foundUser = data;

                        }

                    });


                    const displayName =
                        foundUser?.name ||
                        foundUser?.fullName ||
                        user.displayName ||
                        user.email ||
                        "Coordinator";


                    const displayRole =
                        foundUser?.role ||
                        foundUser?.userType ||
                        "OJT Coordinator";


                    if (profileNameEl) {
                        profileNameEl.textContent =
                            displayName;
                    }


                    if (profileRoleEl) {
                        profileRoleEl.textContent =
                            displayRole;
                    }


                    if (profileAvatarEl) {

                        profileAvatarEl.textContent =
                            getInitials(displayName);

                    }


                } catch (error) {

                    console.error(
                        "Error loading profile:",
                        error
                    );

                }

            }

        });

    }



    // =================================================
    // TOTAL STUDENTS
    // =================================================

    async function fetchTotalStudents() {

        try {

            const snapshot =
                await getDocs(usersRef);

            let total =
                0;


            snapshot.forEach((docSnap) => {

                const data =
                    docSnap.data();

                const role =
                    (
                        data.role ||
                        data.userType ||
                        ""
                    ).toLowerCase();


                if (
                    role === "student" ||
                    role === "" ||
                    !data.role
                ) {

                    total++;

                }

            });


            const cards =
                document.querySelectorAll(
                    ".attendance-summary .stat-content h3"
                );


            if (cards.length >= 1) {

                cards[0].textContent =
                    total;

            }

        } catch (error) {

            console.error(
                "Error counting students:",
                error
            );

        }

    }



    // =================================================
    // LOAD USERS
    // =================================================

    async function loadUsers() {

        const usersSnapshot =
            await getDocs(usersRef);


        usersMap = {};


        usersSnapshot.forEach((userDoc) => {

            const userData =
                userDoc.data();


            const userInfo = {

                id: userDoc.id,

                name:
                    userData.name ||
                    userData.fullName ||
                    "Student User",

                email:
                    userData.email ||
                    "",

                course:
                    userData.course ||
                    "BSIT",

                section:
                    userData.section ||
                    "N/A",

                company:
                    userData.companyName ||
                    userData.company ||
                    userData.company_name ||
                    "N/A"

            };


            usersMap[userDoc.id] =
                userInfo;


            if (userData.email) {

                usersMap[
                    userData.email.toLowerCase()
                ] = userInfo;

            }

        });

    }



    // =================================================
    // LOAD ATTENDANCE
    // =================================================

    async function loadAttendanceRecords() {

        if (!attendanceTable) {
            return;
        }


        try {

            await loadUsers();


            const attendanceSnapshot =
                await getDocs(attendanceRef);


            allRecords = [];


            const sectionsSet =
                new Set();


            attendanceSnapshot.forEach((docSnap) => {

                const data =
                    docSnap.data();


                let userDetail =
                    null;


                // Match by userId

                if (
                    data.userId &&
                    usersMap[data.userId]
                ) {

                    userDetail =
                        usersMap[data.userId];

                }


                // Match by email

                else if (
                    data.userEmail &&
                    usersMap[
                        data.userEmail.toLowerCase()
                    ]
                ) {

                    userDetail =
                        usersMap[
                            data.userEmail.toLowerCase()
                        ];

                }


                const studentName =
                    userDetail?.name ||
                    data.userName ||
                    "Unknown Student";


                const studentEmail =
                    userDetail?.email ||
                    data.userEmail ||
                    "No Email";


                const course =
                    userDetail?.course ||
                    data.course ||
                    "BSIT";


                const section =
                    userDetail?.section ||
                    data.section ||
                    "N/A";


                const company =
                    userDetail?.company ||
                    data.companyName ||
                    data.company ||
                    data.company_name ||
                    "N/A";


                if (section !== "N/A") {
                    sectionsSet.add(section);
                }


                const photoProof =
                    data.photoProof ||
                    data.photoURL ||
                    data.photoUrl ||
                    data.photo ||
                    data.imageUrl ||
                    data.imageURL ||
                    "";


                allRecords.push({

                    id:
                        docSnap.id,

                    userId:
                        data.userId ||
                        userDetail?.id ||
                        "",

                    studentName,

                    studentEmail,

                    course,

                    section,

                    company,

                    timeIn:
                        data.timeIn ||
                        "--",

                    timeOut:
                        data.timeOut ||
                        "--",

                    totalHours:
                        data.todayHours ||
                        (
                            data.hoursRendered
                                ? `${data.hoursRendered} hrs`
                                : "0h 0m"
                        ),

                    status:
                        data.status ||
                        "Present",

                    photoProof,

                    date:
                        data.formattedDate ||
                        data.date ||
                        "N/A",

                    rawTimestamp:
                        data.timestamp ||
                        data.createdAt ||
                        0

                });

            });



            // =================================================
            // SECTION FILTER
            // =================================================

            if (sectionFilter) {

                sectionFilter.innerHTML =
                    `<option value="All Sections">
                        All Sections
                    </option>`;


                [...sectionsSet]
                    .sort()
                    .forEach((section) => {

                        sectionFilter.innerHTML +=
                            `<option value="${section}">
                                ${section}
                            </option>`;

                    });

            }


            // INITIAL DISPLAY

            filterAttendance();


        } catch (error) {

            console.error(
                "Error loading attendance records:",
                error
            );


            attendanceTable.innerHTML = `

                <tr>

                    <td
                        colspan="10"
                        style="
                            text-align:center;
                            color:#e74c3c;
                            padding:30px;
                        ">

                        Unable to load attendance records.

                    </td>

                </tr>

            `;

        }

    }



    // =================================================
    // FILTER
    // =================================================

    function filterAttendance() {

        const keyword =
            searchInput
                ? searchInput.value
                    .toLowerCase()
                    .trim()
                : "";


        const section =
            sectionFilter
                ? sectionFilter.value.toLowerCase()
                : "all sections";


        const status =
            statusFilter
                ? statusFilter.value.toLowerCase()
                : "all status";


        filteredRecords =
            allRecords.filter((item) => {


                const name =
                    (item.studentName || "")
                        .toLowerCase();


                const email =
                    (item.studentEmail || "")
                        .toLowerCase();


                const company =
                    (item.company || "")
                        .toLowerCase();


                const itemSection =
                    (item.section || "")
                        .toLowerCase();


                const itemStatus =
                    (item.status || "")
                        .toLowerCase();


                const matchSearch =
                    name.includes(keyword) ||
                    email.includes(keyword) ||
                    company.includes(keyword);


                const matchSection =
                    section === "all sections" ||
                    itemSection === section;


                const matchStatus =
                    status === "all status" ||
                    itemStatus.includes(status);


                return (
                    matchSearch &&
                    matchSection &&
                    matchStatus
                );

            });


        currentPage = 1;

        renderTable();

        updateSummaryCards();

    }



    // =================================================
    // RENDER TABLE
    // =================================================

    function renderTable() {

        if (!attendanceTable) {
            return;
        }


        if (filteredRecords.length === 0) {

            attendanceTable.innerHTML = `

                <tr>

                    <td
                        colspan="10"
                        style="
                            text-align:center;
                            color:#777;
                            padding:30px;
                        ">

                        No attendance records found.

                    </td>

                </tr>

            `;


            if (paginationInfo) {

                paginationInfo.textContent =
                    "Showing 0 to 0 of 0 records";

            }


            updatePagination();

            return;

        }



        const start =
            (currentPage - 1) *
            rowsPerPage;


        const end =
            Math.min(
                start + rowsPerPage,
                filteredRecords.length
            );


        const pageRecords =
            filteredRecords.slice(
                start,
                end
            );



        attendanceTable.innerHTML =
            pageRecords.map((item) => {


                let statusClass =
                    "present";


                const statusText =
                    item.status ||
                    "Present";


                const lowerStatus =
                    statusText.toLowerCase();


                if (lowerStatus.includes("late")) {

                    statusClass =
                        "late";

                }

                else if (
                    lowerStatus.includes("absent")
                ) {

                    statusClass =
                        "absent";

                }

                else if (
                    lowerStatus.includes("reject")
                ) {

                    statusClass =
                        "rejected";

                }



                const photo =
                    item.photoProof;


                return `

                    <tr>


                        <!-- STUDENT -->

                        <td>

                            <strong>
                                ${item.studentName}
                            </strong>

                            <br>

                            <small
                                style="color:#777;">

                                ${item.studentEmail}

                            </small>

                        </td>



                        <!-- COURSE -->

                        <td>
                            ${item.course}
                        </td>



                        <!-- SECTION -->

                        <td>
                            ${item.section}
                        </td>



                        <!-- COMPANY -->

                        <td>
                            ${item.company}
                        </td>



                        <!-- TIME IN -->

                        <td>
                            ${item.timeIn}
                        </td>



                        <!-- TIME OUT -->

                        <td>
                            ${item.timeOut}
                        </td>



                        <!-- HOURS -->

                        <td>
                            ${item.totalHours}
                        </td>



                        <!-- PHOTO -->

                        <td class="photo-proof-cell">

                            ${
                                photo
                                ? `

                                    <button
                                        type="button"
                                        class="photo-proof-btn"
                                        data-photo="${photo}">

                                        <i
                                            class="fa-solid fa-image">
                                        </i>

                                        View

                                    </button>

                                `
                                : `

                                    <span class="no-photo-proof">

                                        No Photo

                                    </span>

                                `
                            }

                        </td>



                        <!-- STATUS -->

                        <td>

                            <span
                                class="status ${statusClass}">

                                ${statusText}

                            </span>

                        </td>



                        <!-- ACTION -->

                        <td class="actions">

                            <button
                                class="action-btn view-btn"
                                data-id="${item.userId || item.id}"
                                title="View Details">

                                <i
                                    class="fa-solid fa-eye">
                                </i>

                            </button>

                        </td>


                    </tr>

                `;

            }).join("");



        if (paginationInfo) {

            paginationInfo.textContent =
                `Showing ${start + 1} to ${end} of ${filteredRecords.length} records`;

        }


        updatePagination();

    }



    // =================================================
    // PAGINATION
    // =================================================

    function updatePagination() {

        const totalPages =
            Math.max(
                1,
                Math.ceil(
                    filteredRecords.length /
                    rowsPerPage
                )
            );


        if (prevPageBtn) {

            prevPageBtn.disabled =
                currentPage <= 1;

        }


        if (nextPageBtn) {

            nextPageBtn.disabled =
                currentPage >= totalPages;

        }


        if (!pageNumbers) {
            return;
        }


        pageNumbers.innerHTML = "";


        for (
            let page = 1;
            page <= totalPages;
            page++
        ) {

            const button =
                document.createElement("button");


            button.className =
                "page-num";


            if (page === currentPage) {

                button.classList.add(
                    "active"
                );

            }


            button.textContent =
                page;


            button.addEventListener(
                "click",
                () => {

                    currentPage =
                        page;

                    renderTable();

                }
            );


            pageNumbers.appendChild(
                button
            );

        }

    }



    // =================================================
    // SUMMARY CARDS
    // =================================================

    function updateSummaryCards() {

        const cards =
            document.querySelectorAll(
                ".attendance-summary .stat-content h3"
            );


        if (cards.length < 4) {
            return;
        }


        // TODAY ONLY

        const today =
            new Date();


        const todayString =
            today.toLocaleDateString(
                "en-US"
            );


        let presentCount = 0;

        let lateCount = 0;

        let absentCount = 0;



        allRecords.forEach((record) => {

            let isToday = false;


            if (record.date) {

                const recordDate =
                    new Date(record.date);


                if (
                    !isNaN(
                        recordDate.getTime()
                    )
                ) {

                    isToday =
                        recordDate.toLocaleDateString(
                            "en-US"
                        ) === todayString;

                }

            }


            // If date cannot be parsed,
            // use records that have attendance time.

            if (
                !isToday &&
                record.timeIn === "--"
            ) {

                return;

            }


            const status =
                (
                    record.status ||
                    ""
                ).toLowerCase();


            if (
                status === "present" ||
                status === "active" ||
                status === "completed"
            ) {

                presentCount++;

            }

            else if (
                status === "late"
            ) {

                lateCount++;

            }

            else if (
                status === "absent"
            ) {

                absentCount++;

            }

        });



        cards[1].textContent =
            presentCount;


        cards[2].textContent =
            lateCount;


        cards[3].textContent =
            absentCount;

    }



    // =================================================
    // EVENTS
    // =================================================

    if (searchInput) {

        searchInput.addEventListener(
            "input",
            filterAttendance
        );

    }


    if (sectionFilter) {

        sectionFilter.addEventListener(
            "change",
            filterAttendance
        );

    }


    if (statusFilter) {

        statusFilter.addEventListener(
            "change",
            filterAttendance
        );

    }


    if (rowsPerPageSelect) {

        rowsPerPageSelect.addEventListener(
            "change",
            () => {

                rowsPerPage =
                    parseInt(
                        rowsPerPageSelect.value
                    );

                currentPage = 1;

                renderTable();

            }
        );

    }


    if (prevPageBtn) {

        prevPageBtn.addEventListener(
            "click",
            () => {

                if (currentPage > 1) {

                    currentPage--;

                    renderTable();

                }

            }
        );

    }


    if (nextPageBtn) {

        nextPageBtn.addEventListener(
            "click",
            () => {

                const totalPages =
                    Math.ceil(
                        filteredRecords.length /
                        rowsPerPage
                    );


                if (
                    currentPage <
                    totalPages
                ) {

                    currentPage++;

                    renderTable();

                }

            }
        );

    }



    // =================================================
    // VIEW DETAILS
    // =================================================

    document.addEventListener(
        "click",
        (event) => {

            const button =
                event.target.closest(
                    ".view-btn"
                );


            if (!button) {
                return;
            }


            const id =
                button.getAttribute(
                    "data-id"
                );


            if (id) {

                window.location.href =
                    `attendance_details.html?id=${id}`;

            }

        }
    );



    // =================================================
    // PHOTO PROOF
    // =================================================

    document.addEventListener(
        "click",
        (event) => {

            const button =
                event.target.closest(
                    ".photo-proof-btn"
                );


            if (!button) {
                return;
            }


            const photo =
                button.getAttribute(
                    "data-photo"
                );


            if (!photo) {
                return;
            }


            const modal =
                document.getElementById(
                    "photoProofModal"
                );


            const image =
                document.getElementById(
                    "photoProofImage"
                );


            if (!modal || !image) {
                return;
            }


            image.src =
                photo;


            modal.classList.add(
                "show"
            );

        }
    );



    // CLOSE PHOTO MODAL

    document.addEventListener(
        "click",
        (event) => {

            const closeButton =
                event.target.closest(
                    "#photoProofClose"
                );


            const modal =
                document.getElementById(
                    "photoProofModal"
                );


            const image =
                document.getElementById(
                    "photoProofImage"
                );


            if (
                closeButton ||
                event.target === modal
            ) {

                if (modal) {

                    modal.classList.remove(
                        "show"
                    );

                }


                if (image) {

                    image.src =
                        "";

                }

            }

        }
    );



    // =================================================
    // RUN
    // =================================================

    syncUserProfile();

    fetchTotalStudents();

    loadAttendanceRecords();

});