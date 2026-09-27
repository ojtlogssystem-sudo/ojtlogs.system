// Import Firebase SDK Functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    verifyPasswordResetCode,
    confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Firebase Config (same project as student_login.js)
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

let currentOobCode = null;

// Entrance transition, same pattern as student_login.js
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

// Read mode + oobCode from the link Firebase sent, then verify it
async function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const oobCode = params.get('oobCode');

    if (mode !== 'resetPassword' || !oobCode) {
        invalidReason.textContent = "This reset link is malformed or incomplete. Please request a new one.";
        showState(invalidState);
        return;
    }

    currentOobCode = oobCode;

    try {
        const email = await verifyPasswordResetCode(auth, oobCode);
        resetForEmail.textContent = email;
        showState(formState);
    } catch (error) {
        console.error("Verify reset code error:", error);
        switch (error.code) {
            case 'auth/expired-action-code':
                invalidReason.textContent = "This reset link has expired. Please request a new one.";
                break;
            case 'auth/invalid-action-code':
                invalidReason.textContent = "This reset link has already been used or is invalid. Please request a new one.";
                break;
            case 'auth/user-disabled':
                invalidReason.textContent = "This account has been disabled. Please contact the coordinator.";
                break;
            case 'auth/user-not-found':
                invalidReason.textContent = "We couldn't find an account for this reset link.";
                break;
            default:
                invalidReason.textContent = "This password reset link is no longer valid. Please request a new one.";
        }
        showState(invalidState);
    }
}

// Password eye toggles (works for both password fields on this page)
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

// Live checklist for password rules
function updateRules() {
    const pw = newPasswordInput.value;
    const confirm = confirmPasswordInput.value;

    const lengthOk = pw.length >= 6;
    const matchOk = pw.length > 0 && pw === confirm;

    ruleLength.classList.toggle('rp-rule-ok', lengthOk);
    ruleMatch.classList.toggle('rp-rule-ok', matchOk);

    return { lengthOk, matchOk };
}

if (newPasswordInput) newPasswordInput.addEventListener('input', updateRules);
if (confirmPasswordInput) confirmPasswordInput.addEventListener('input', updateRules);

// Submit new password
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
        if (!currentOobCode) {
            showFormError("Something went wrong. Please reload this page.");
            return;
        }

        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";

        try {
            await confirmPasswordReset(auth, currentOobCode, newPasswordInput.value);
            showState(successState);
        } catch (error) {
            console.error("Confirm reset error:", error);
            switch (error.code) {
                case 'auth/expired-action-code':
                    invalidReason.textContent = "This reset link expired while you were filling in the form. Please request a new one.";
                    showState(invalidState);
                    break;
                case 'auth/invalid-action-code':
                    invalidReason.textContent = "This reset link has already been used. Please request a new one.";
                    showState(invalidState);
                    break;
                case 'auth/weak-password':
                    showFormError("Please choose a stronger password.");
                    break;
                default:
                    showFormError("Could not update your password. Please try again.");
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}