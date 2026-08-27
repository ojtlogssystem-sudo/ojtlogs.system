import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// Auto-fill existing details from Firebase
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.name) document.getElementById('fullName').value = data.name;
            if (data.studentNumber) document.getElementById('studentNumber').value = data.studentNumber;
            if (data.companyName) document.getElementById('companyName').value = data.companyName;
            if (data.supervisorName) document.getElementById('supervisorName').value = data.supervisorName;
            if (data.section) document.getElementById('sectionSelect').value = data.section;
            if (data.course) document.getElementById('courseSelect').value = data.course;
        }
    } else {
        window.location.href = "../login/student_login.html";
    }
});

// Image Preview
document.getElementById('profileImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById('previewImage').src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Cancel Button - Return to Settings
document.getElementById('cancelBtn').addEventListener('click', () => {
    window.location.href = "settings.html";
});

// Form Submit Handler
document.getElementById('editProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('saveBtn');

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
        if (currentUser) {
            const userDocRef = doc(db, "users", currentUser.uid);
            await updateDoc(userDocRef, {
                name: document.getElementById('fullName').value.trim(),
                studentNumber: document.getElementById('studentNumber').value.trim(),
                companyName: document.getElementById('companyName').value.trim(),
                supervisorName: document.getElementById('supervisorName').value.trim(),
                section: document.getElementById('sectionSelect').value,
                course: document.getElementById('courseSelect').value,
                updatedAt: new Date()
            });

            window.location.href = "settings.html";
        }
    } catch (error) {
        console.error("Error updating profile:", error);
        alert("Failed to update profile: " + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes";
    }
});