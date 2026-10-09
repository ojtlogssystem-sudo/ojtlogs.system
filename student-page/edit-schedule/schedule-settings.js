// schedule-settings.js
// Loaded as type="module" from schedule-settings.html.
//
// Gaya ng sa settings.js: header-loader.js exports loadHeader bilang ES
// module export, kaya kailangan siyang i-import dito nang direkta.
import { loadHeader } from "../templated/header-loader.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

let currentUser = null;

document.addEventListener("DOMContentLoaded", () => {
    if (typeof loadSidebar === "function") {
        loadSidebar("Settings");
    } else {
        console.error(
            "[schedule-settings.js] loadSidebar() is not defined. Check that " +
            "../templated/sidebar-loader.js loaded successfully (open DevTools " +
            "> Network tab and look for a 404 or path error)."
        );
    }

    loadHeader("Settings", { autoLoadProfile: true }).catch((err) => {
        console.error("[schedule-settings.js] Failed to load header:", err);
    });
});

// ==========================================
// IN-APP ALERT HELPERS (gaya ng sa profile.js)
// ==========================================
function showAlert(message, alertId = "alertMessageSchedule") {
    hideAlert("successMessageSchedule");
    const alertBox = document.getElementById(alertId);
    if (alertBox) {
        alertBox.textContent = message;
        alertBox.style.display = "block";
        alertBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

function showSuccess(message) {
    hideAlert("alertMessageSchedule");
    const successBox = document.getElementById("successMessageSchedule");
    if (successBox) {
        successBox.textContent = message;
        successBox.style.display = "block";
        successBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

function hideAlert(alertId = "alertMessageSchedule") {
    const alertBox = document.getElementById(alertId);
    if (alertBox) {
        alertBox.style.display = "none";
        alertBox.textContent = "";
    }
}

// Ipinapakita yung success popup pagkatapos ma-save ang schedule, tapos
// mag-a-auto redirect pabalik sa Settings pagkalipas ng ilang saglit.
function showSuccessModal(redirectUrl, delayMs = 1500) {
    const overlay = document.getElementById("successModalOverlay");
    if (!overlay) {
        window.location.href = redirectUrl;
        return;
    }

    overlay.classList.add("show");

    setTimeout(() => {
        window.location.href = redirectUrl;
    }, delayMs);
}

// ==========================================
// AUTH STATE CHECK + PREFILL NG EXISTING SCHEDULE
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.schedule) {
                populateScheduleFields(data.schedule);
            }
        }

        // Siguraduhing tama ang enabled/disabled state ng morning/afternoon
        // sessions batay sa (na-prefill man o default) na checkbox values.
        updateMorningState();
        updateAfternoonState();
    } else {
        window.location.href = "../login/student_login.html";
    }
});

function populateScheduleFields(schedule) {
    // WORK MODALITY
    if (schedule.modality) {
        const modalityInput = document.querySelector(
            `input[name="workModality"][value="${schedule.modality}"]`
        );
        if (modalityInput) modalityInput.checked = true;
    }

    // INTERNSHIP DAYS
    if (Array.isArray(schedule.days)) {
        document.querySelectorAll(".day-btn").forEach((button) => {
            button.classList.toggle("active", schedule.days.includes(button.dataset.day));
        });
    }

    // MORNING
    const morningToggleEl = document.getElementById("morningEnabled");
    if (morningToggleEl && typeof schedule.morningEnabled === "boolean") {
        morningToggleEl.checked = schedule.morningEnabled;
    }
    if (schedule.morning) {
        if (schedule.morning.timeIn) document.getElementById("morningTimeIn").value = schedule.morning.timeIn;
        if (schedule.morning.timeOut) document.getElementById("morningTimeOut").value = schedule.morning.timeOut;
    }

    // AFTERNOON
    const afternoonToggleEl = document.getElementById("afternoonEnabled");
    if (afternoonToggleEl && typeof schedule.afternoonEnabled === "boolean") {
        afternoonToggleEl.checked = schedule.afternoonEnabled;
    }
    if (schedule.afternoon) {
        if (schedule.afternoon.timeIn) document.getElementById("afternoonTimeIn").value = schedule.afternoon.timeIn;
        if (schedule.afternoon.timeOut) document.getElementById("afternoonTimeOut").value = schedule.afternoon.timeOut;
    }
}

// ==========================================
// INTERNSHIP DAYS TOGGLE (gaya ng sa profile.js)
// ==========================================
const dayButtons = document.querySelectorAll(".day-btn");
dayButtons.forEach((button) => {
    button.addEventListener("click", () => {
        button.classList.toggle("active");
    });
});

function getSelectedInternshipDays() {
    const selectedDays = [];
    document.querySelectorAll(".day-btn.active").forEach((button) => {
        selectedDays.push(button.dataset.day);
    });
    return selectedDays;
}

// ==========================================
// AFTERNOON SESSION TOGGLE (gaya ng sa profile.js)
// ==========================================
const afternoonToggle = document.getElementById("afternoonEnabled");
const afternoonSchedule = document.getElementById("afternoonSchedule");
const afternoonStatus = document.getElementById("afternoonStatus");
const afternoonTimeIn = document.getElementById("afternoonTimeIn");
const afternoonTimeOut = document.getElementById("afternoonTimeOut");

function updateAfternoonState() {
    if (!afternoonToggle || !afternoonSchedule) return;

    const enabled = afternoonToggle.checked;

    if (enabled) {
        afternoonSchedule.style.display = "block";
        if (afternoonTimeIn) afternoonTimeIn.disabled = false;
        if (afternoonTimeOut) afternoonTimeOut.disabled = false;
        if (afternoonStatus) {
            afternoonStatus.textContent = "Enabled";
            afternoonStatus.classList.remove("disabled");
        }
    } else {
        afternoonSchedule.style.display = "none";
        if (afternoonTimeIn) afternoonTimeIn.disabled = true;
        if (afternoonTimeOut) afternoonTimeOut.disabled = true;
        if (afternoonStatus) {
            afternoonStatus.textContent = "Disabled";
            afternoonStatus.classList.add("disabled");
        }
    }
}

if (afternoonToggle) {
    afternoonToggle.addEventListener("change", () => {
        updateAfternoonState();
    });
}

// ==========================================
// MORNING SESSION TOGGLE (gaya ng sa profile.js)
// ==========================================
const morningToggle = document.getElementById("morningEnabled");
const morningSchedule = document.getElementById("morningSchedule");
const morningStatus = document.getElementById("morningStatus");
const morningTimeIn = document.getElementById("morningTimeIn");
const morningTimeOut = document.getElementById("morningTimeOut");

function updateMorningState() {
    if (!morningToggle || !morningSchedule) return;

    const enabled = morningToggle.checked;

    if (enabled) {
        morningSchedule.style.display = "block";
        if (morningTimeIn) morningTimeIn.disabled = false;
        if (morningTimeOut) morningTimeOut.disabled = false;
        if (morningStatus) {
            morningStatus.textContent = "Enabled";
            morningStatus.classList.remove("disabled");
        }
    } else {
        morningSchedule.style.display = "none";
        if (morningTimeIn) morningTimeIn.disabled = true;
        if (morningTimeOut) morningTimeOut.disabled = true;
        if (morningStatus) {
            morningStatus.textContent = "Disabled";
            morningStatus.classList.add("disabled");
        }
    }
}

if (morningToggle) {
    morningToggle.addEventListener("change", () => {
        updateMorningState();
    });
}

// ==========================================
// SAVE SCHEDULE CHANGES
// ==========================================
const saveScheduleBtn = document.getElementById("saveScheduleBtn");

if (saveScheduleBtn) {
    saveScheduleBtn.addEventListener("click", async () => {
        hideAlert("alertMessageSchedule");
        hideAlert("successMessageSchedule");

        const selectedDays = getSelectedInternshipDays();
        if (selectedDays.length === 0) {
            showAlert("Please select at least one internship day.");
            return;
        }

        const morningEnabled = document.getElementById("morningEnabled").checked;
        const afternoonEnabled = document.getElementById("afternoonEnabled").checked;

        if (!morningEnabled && !afternoonEnabled) {
            showAlert("Please enable at least one session (Morning or Afternoon).");
            return;
        }

        if (morningEnabled) {
            const timeIn = document.getElementById("morningTimeIn").value;
            const timeOut = document.getElementById("morningTimeOut").value;
            if (!timeIn || !timeOut) {
                showAlert("Please set your morning Time In and Time Out.");
                return;
            }
        }

        if (afternoonEnabled) {
            const timeIn = document.getElementById("afternoonTimeIn").value;
            const timeOut = document.getElementById("afternoonTimeOut").value;
            if (!timeIn || !timeOut) {
                showAlert("Please set your afternoon Time In and Time Out.");
                return;
            }
        }

        if (!currentUser) {
            showAlert("No authenticated user found. Please log in again.");
            return;
        }

        const workModality =
            document.querySelector('input[name="workModality"]:checked')?.value || "On-site";

        const scheduleData = {
            modality: workModality,
            days: selectedDays,

            morningEnabled: morningEnabled,
            morning: morningEnabled ? {
                timeIn: document.getElementById("morningTimeIn").value,
                timeOut: document.getElementById("morningTimeOut").value
            } : null,

            afternoonEnabled: afternoonEnabled,
            afternoon: afternoonEnabled ? {
                timeIn: document.getElementById("afternoonTimeIn").value,
                timeOut: document.getElementById("afternoonTimeOut").value
            } : null
        };

        let succeeded = false;

        try {
            saveScheduleBtn.disabled = true;
            saveScheduleBtn.textContent = "Saving...";

            const userDocRef = doc(db, "users", currentUser.uid);
            await updateDoc(userDocRef, {
                schedule: scheduleData
            });

            succeeded = true;
            saveScheduleBtn.textContent = "Updated!";
            showSuccessModal("../settings/settings.html");
        } catch (error) {
            console.error("Error updating schedule:", error);
            showAlert("An error occurred: " + error.message);
        } finally {
            // Iwan yung "Updated!" state habang naghihintay ng redirect —
            // i-reset lang pabalik sa normal kapag nag-fail.
            if (!succeeded) {
                saveScheduleBtn.disabled = false;
                saveScheduleBtn.textContent = "Save Changes";
            }
        }
    });
}