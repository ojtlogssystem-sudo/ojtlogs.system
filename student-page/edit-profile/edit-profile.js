import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// header-loader.js exports loadHeader as an ES module export — it does NOT
// attach to the global scope, so it must be imported directly (not called
// via `typeof loadHeader === "function"` in a plain script, which will
// always be false and silently skip loading the header).
import { loadHeader } from "../templated/header-loader.js";

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
// Base64 string of the newly-picked (compressed) profile picture, if any.
// Same "photo" field / base64-in-Firestore approach as profile.js, so both
// pages read/write the exact same data.
let selectedPhotoBase64 = null;

/* ==========================================
   HEADER + SIDEBAR
========================================== */
document.addEventListener("DOMContentLoaded", () => {
    // sidebar-loader.js is a classic script, so loadSidebar is global.
    if (typeof loadSidebar === "function") {
        loadSidebar("Settings");
    } else {
        console.error(
            "[edit-profile.js] loadSidebar() is not defined. Check that " +
            "../templated/sidebar-loader.js loaded successfully."
        );
    }

    loadHeader("Edit Profile", { autoLoadProfile: true }).catch((err) => {
        console.error("[edit-profile.js] Failed to load header:", err);
    });
});

function showAlert(message) {
    const alertBox = document.getElementById("alertMessage");
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.style.display = "block";
}

function hideAlert() {
    const alertBox = document.getElementById("alertMessage");
    if (!alertBox) return;
    alertBox.style.display = "none";
}

// Ipinapakita yung success popup pagkatapos ma-save, tapos mag-a-auto
// redirect pabalik sa Settings pagkalipas ng ilang saglit.
function showSuccessModal(redirectUrl, delayMs = 1500) {
    const overlay = document.getElementById("successModalOverlay");
    if (!overlay) {
        // Fallback kung wala/hindi na-load yung modal markup para sa
        // kahit anong dahilan — huwag mag-stuck, diretso na lang redirect.
        window.location.href = redirectUrl;
        return;
    }

    overlay.classList.add("show");

    setTimeout(() => {
        window.location.href = redirectUrl;
    }, delayMs);
}

// Same field-name priority as ../templated/header-loader.js's
// updateHeaderProfile(), so this page finds the picture no matter which
// field it was actually saved under (profile.js saves it as "photo").
function getExistingPhoto(data) {
    return data.photo || data.profilePic || data.photoURL || data.image || data.avatar || null;
}

/* ==========================================
   AUTO-FILL EXISTING DETAILS FROM FIREBASE
========================================== */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
                const data = userDoc.data();
                if (data.name) document.getElementById("fullName").value = data.name;
                if (data.studentNumber) document.getElementById("studentNumber").value = data.studentNumber;
                if (data.gender) document.getElementById("genderInput").value = data.gender;
                if (data.companyName) document.getElementById("companyName").value = data.companyName;
                if (data.supervisorName) document.getElementById("supervisorName").value = data.supervisorName;
                if (data.section) document.getElementById("sectionSelect").value = data.section;
                // Course is fixed to "BSIT" (see #courseInput, readonly) — not
                // loaded from Firestore, same as the initial profile setup page.

                // Show the saved profile picture, if any, instead of the default icon.
                const existingPhoto = getExistingPhoto(data);
                if (existingPhoto) document.getElementById("previewImage").src = existingPhoto;
            }
        } catch (error) {
            console.error("Error loading profile data:", error);
            showAlert("Could not load your current profile info: " + error.message);
        }
    } else {
        window.location.href = "../student_login/student_login.html";
    }
});

/* ==========================================
   IMAGE SELECT + PREVIEW
   Compressed to a small base64 JPEG (same approach as profile.js) so it
   fits Firestore's 1MB document limit and lives in the same "photo" field.
========================================== */
function compressImageToBase64(file, maxDimension = 400, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error("Could not load the image."));
            img.onload = () => {
                let { width, height } = img;

                if (width > height && width > maxDimension) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

document.getElementById("profileImage").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
        showAlert("Please select a valid image file (JPG, PNG, or GIF).");
        e.target.value = "";
        return;
    }

    // Sanity check the original file first (10MB) before compressing.
    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        showAlert("Image is too large. Please pick a file 10MB or smaller.");
        e.target.value = "";
        return;
    }

    hideAlert();

    try {
        let base64 = await compressImageToBase64(file, 400, 0.7);

        // If still large after compressing, compress harder.
        if (base64.length > 700 * 1024) {
            base64 = await compressImageToBase64(file, 300, 0.5);
        }

        if (base64.length > 900 * 1024) {
            showAlert("Could not compress the image enough. Please try a different photo.");
            e.target.value = "";
            return;
        }

        selectedPhotoBase64 = base64;
        document.getElementById("previewImage").src = base64;
    } catch (error) {
        console.error("Image compression error:", error);
        showAlert("There was a problem processing that image. Please try again.");
        e.target.value = "";
    }
});

/* ==========================================
   CANCEL BUTTON - Return to Settings
========================================== */
document.getElementById("cancelBtn").addEventListener("click", () => {
    window.location.href = "../settings/settings.html";
});

/* ==========================================
   FORM SUBMIT HANDLER
   Saves everything straight to Firestore, including the new photo (if one
   was picked) as base64 under the "photo" field — no Firebase Storage
   involved, matching how profile.js stores it.
========================================== */
document.getElementById("editProfileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBtn");

    if (!currentUser) {
        showAlert("You are not signed in. Please log in again.");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    hideAlert();

    try {
        const updateData = {
            name: document.getElementById("fullName").value.trim(),
            studentNumber: document.getElementById("studentNumber").value.trim(),
            gender: document.getElementById("genderInput").value,
            companyName: document.getElementById("companyName").value.trim(),
            supervisorName: document.getElementById("supervisorName").value.trim(),
            section: document.getElementById("sectionSelect").value,
            course: document.getElementById("courseInput").value,
            updatedAt: new Date()
        };

        // Only include the photo if the user actually picked a new one this visit.
        if (selectedPhotoBase64) {
            updateData.photo = selectedPhotoBase64;
        }

        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, updateData);

        // Keep the header's cached name/initials in sync so it shows
        // correctly right away if the user navigates back without a full
        // reload (the avatar image itself is re-fetched from Firestore by
        // the header on every page load).
        localStorage.setItem("user_fullname", updateData.name);

        showSuccessModal("../settings/settings.html");
    } catch (error) {
        console.error("Error updating profile:", error);
        showAlert("Failed to update profile: " + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes";
    }
});