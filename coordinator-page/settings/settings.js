/* ==========================================
   SETTINGS PAGE
   OJT-LOGS
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    /* ==========================================
       PROFILE ELEMENTS
    ========================================== */

    const fullName = document.getElementById("fullName");
    const email = document.getElementById("email");
    const phone = document.getElementById("phone");

    const saveProfile = document.getElementById("saveProfile");
    const cancelProfile = document.getElementById("cancelProfile");

    const previewImage = document.getElementById("previewImage");
    const imageUpload = document.getElementById("imageUpload");

    const profileName = document.getElementById("profileName");
    const profileAvatar = document.getElementById("profileAvatar");

    /* ==========================================
       DEFAULT PROFILE
    ========================================== */

    const defaultProfile = {
        fullName: "John Doe",
        email: "coordinator@grc.edu.ph",
        phone: "+63 912 345 6789",
        image: "../images/profile.png"
    };

    /* ==========================================
       LOAD SAVED PROFILE
    ========================================== */

    function loadProfile() {

        const saved = JSON.parse(localStorage.getItem("ojtProfile"));

        if (!saved) {

            updateProfile(defaultProfile);

            return;
        }

        updateProfile(saved);

    }

    /* ==========================================
       UPDATE UI
    ========================================== */

    function updateProfile(data) {

        fullName.value = data.fullName;
        email.value = data.email;
        phone.value = data.phone;

        previewImage.src = data.image;

        profileName.textContent = data.fullName;

        const initials = data.fullName
            .split(" ")
            .map(word => word.charAt(0))
            .join("")
            .substring(0, 2)
            .toUpperCase();

        profileAvatar.textContent = initials;

    }

    /* ==========================================
       SAVE PROFILE
    ========================================== */

    saveProfile.addEventListener("click", () => {

        const profile = {

            fullName: fullName.value.trim(),
            email: email.value.trim(),
            phone: phone.value.trim(),
            image: previewImage.src

        };

        localStorage.setItem(
            "ojtProfile",
            JSON.stringify(profile)
        );

        profileName.textContent = profile.fullName;

        const initials = profile.fullName
            .split(" ")
            .map(word => word.charAt(0))
            .join("")
            .substring(0, 2)
            .toUpperCase();

        profileAvatar.textContent = initials;

        showToast("Profile updated successfully.");

    });

    /* ==========================================
       CANCEL CHANGES
    ========================================== */

    cancelProfile.addEventListener("click", () => {

        loadProfile();

        showToast("Changes cancelled.");

    });

    /* ==========================================
       IMAGE PREVIEW
    ========================================== */

    imageUpload.addEventListener("change", e => {

        const file = e.target.files[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = function(event) {

            previewImage.src = event.target.result;

        };

        reader.readAsDataURL(file);

    });

    /* ==========================================
       TOAST
    ========================================== */

    function showToast(message) {

        const toast = document.getElementById("toast");
        const toastMessage = document.getElementById("toastMessage");

        toastMessage.textContent = message;

        toast.classList.add("show");

        setTimeout(() => {

            toast.classList.remove("show");

        }, 3000);

    }

    /* ==========================================
       INITIALIZE
    ========================================== */

    loadProfile();

});
    /* ==========================================
       PASSWORD ELEMENTS
    ========================================== */

    const currentPassword = document.getElementById("currentPassword");
    const newPassword = document.getElementById("newPassword");
    const confirmPassword = document.getElementById("confirmPassword");

    const updatePassword = document.getElementById("updatePassword");

    const strengthFill = document.getElementById("strengthFill");
    const strengthText = document.getElementById("strengthText");
    const passwordMatch = document.getElementById("passwordMatch");

    const toggleButtons = document.querySelectorAll(".toggle-password");

    /* ==========================================
       SHOW / HIDE PASSWORD
    ========================================== */

    toggleButtons.forEach(button => {

        button.addEventListener("click", () => {

            const target = document.getElementById(
                button.dataset.target
            );

            const icon = button.querySelector("i");

            if (target.type === "password") {

                target.type = "text";

                icon.classList.remove("fa-eye");
                icon.classList.add("fa-eye-slash");

            } else {

                target.type = "password";

                icon.classList.remove("fa-eye-slash");
                icon.classList.add("fa-eye");

            }

        });

    });

    /* ==========================================
       PASSWORD STRENGTH
    ========================================== */

    newPassword.addEventListener("input", () => {

        const password = newPassword.value;

        let score = 0;

        if (password.length >= 8) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        switch (score) {

            case 0:
            case 1:

                strengthFill.style.width = "20%";
                strengthFill.style.background = "#dc2626";
                strengthText.textContent = "Weak";

                break;

            case 2:

                strengthFill.style.width = "40%";
                strengthFill.style.background = "#f59e0b";
                strengthText.textContent = "Fair";

                break;

            case 3:

                strengthFill.style.width = "60%";
                strengthFill.style.background = "#eab308";
                strengthText.textContent = "Good";

                break;

            case 4:

                strengthFill.style.width = "80%";
                strengthFill.style.background = "#22c55e";
                strengthText.textContent = "Strong";

                break;

            case 5:

                strengthFill.style.width = "100%";
                strengthFill.style.background = "#16a34a";
                strengthText.textContent = "Very Strong";

                break;

        }

    });

    /* ==========================================
       PASSWORD MATCH
    ========================================== */

    confirmPassword.addEventListener("input", () => {

        if (confirmPassword.value === "") {

            passwordMatch.textContent = "";

            return;

        }

        if (newPassword.value === confirmPassword.value) {

            passwordMatch.textContent = "✓ Passwords match";
            passwordMatch.style.color = "#16a34a";

        } else {

            passwordMatch.textContent = "✗ Passwords do not match";
            passwordMatch.style.color = "#dc2626";

        }

    });

    /* ==========================================
       UPDATE PASSWORD
    ========================================== */

    updatePassword.addEventListener("click", () => {

        if (
            currentPassword.value.trim() === "" ||
            newPassword.value.trim() === "" ||
            confirmPassword.value.trim() === ""
        ) {

            showToast("Please complete all password fields.");

            return;

        }

        if (newPassword.value !== confirmPassword.value) {

            showToast("Passwords do not match.");

            return;

        }

        if (newPassword.value.length < 8) {

            showToast("Password must be at least 8 characters.");

            return;

        }

        currentPassword.value = "";
        newPassword.value = "";
        confirmPassword.value = "";

        strengthFill.style.width = "0";
        strengthText.textContent = "Password Strength";
        passwordMatch.textContent = "";

        showToast("Password updated successfully.");

    });

    /* ==========================================
       ENTER KEY SUPPORT
    ========================================== */

    document.addEventListener("keydown", (e) => {

        if (e.key !== "Enter") return;

        if (
            document.activeElement === currentPassword ||
            document.activeElement === newPassword ||
            document.activeElement === confirmPassword
        ) {

            updatePassword.click();

        }

    });