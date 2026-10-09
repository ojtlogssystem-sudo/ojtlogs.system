// Import Firebase SDK Functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Firebase Config
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

// DOM Elements — states
const checkingState = document.getElementById('checkingState');
const invalidState = document.getElementById('invalidState');
const invalidReason = document.getElementById('invalidReason');
const formState = document.getElementById('formState');
const successState = document.getElementById('successState');

// DOM Elements — form
const resetForEmail = document.getElementById('resetForEmail');
const newPasswordForm = document.getElementById('newPasswordForm');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const formError = document.getElementById('formError');
const submitBtn = document.getElementById('submitBtn');
const ruleLength = document.getElementById('ruleLength');
const ruleMatch = document.getElementById('ruleMatch');

let userEmail = null;

document.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.body.classList.remove('pre-load');
        });
    });
    initFromUrl();
});

function showState(state) {
    [checkingState, invalidState, formState, successState].forEach(s => {
        if (s) s.style.display = (s === state) ? 'block' : 'none';
    });
}

function showFormError(msg) {
    if (!formError) return;
    formError.textContent = msg;
    formError.style.display = 'block';
}

function hideFormError() {
    if (!formError) return;
    formError.style.display = 'none';
    formError.textContent = '';
}

// Token Verification
function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
        invalidReason.textContent = "This reset link is invalid or incomplete. Please request a new one.";
        showState(invalidState);
        return;
    }

    try {
        const decodedStr = atob(token);
        const data = JSON.parse(decodedStr);

        if (!data.email || !data.ts) {
            throw new Error("Invalid payload structure");
        }

        // Expiration check (1 hour limit)
        const oneHourMs = 60 * 60 * 1000;
        if (Date.now() - data.ts > oneHourMs) {
            invalidReason.textContent = "This reset link has expired. Please request a new one.";
            showState(invalidState);
            return;
        }

        userEmail = data.email;
        if (resetForEmail) resetForEmail.textContent = userEmail;
        showState(formState);
    } catch (error) {
        console.error("Token parsing error:", error);
        invalidReason.textContent = "This password reset link is invalid or corrupted. Please request a new one.";
        showState(invalidState);
    }
}

// Eye Toggle Icons
document.querySelectorAll('.toggle-eye').forEach(icon => {
    icon.addEventListener('click', () => {
        const targetId = icon.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;
        const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
        input.setAttribute('type', type);
        icon.classList.toggle('fa-eye');
        icon.classList.toggle('fa-eye-slash');
    });
});

// Password validation rules
function updateRules() {
    const pw = newPasswordInput ? newPasswordInput.value : '';
    const confirm = confirmPasswordInput ? confirmPasswordInput.value : '';

    const lengthOk = pw.length >= 6;
    const matchOk = pw.length > 0 && pw === confirm;

    if (ruleLength) ruleLength.classList.toggle('rp-rule-ok', lengthOk);
    if (ruleMatch) ruleMatch.classList.toggle('rp-rule-ok', matchOk);

    return { lengthOk, matchOk };
}

if (newPasswordInput) newPasswordInput.addEventListener('input', updateRules);
if (confirmPasswordInput) confirmPasswordInput.addEventListener('input', updateRules);

// Save New Password Submit
if (newPasswordForm) {
    newPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideFormError();

        const { lengthOk, matchOk } = updateRules();

        if (!lengthOk) {
            showFormError("Password must be at least 6 characters.");
            return;
        }
        if (!matchOk) {
            showFormError("Passwords do not match.");
            return;
        }

        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
            // Live request ng fresh oobCode sa Firebase REST API
            const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestType: "PASSWORD_RESET",
                    email: userEmail
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || "Failed to initiate password reset.");
            }

            // I-confirm at palitan ang password sa Firebase Auth
            await confirmPasswordReset(auth, data.oobCode, newPasswordInput.value);
            showState(successState);
        } catch (error) {
            console.error("Confirm Reset Error:", error);
            showFormError(error.message || "Could not update password. Please try requesting a new reset link.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}