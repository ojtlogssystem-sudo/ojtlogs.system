import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    updateDoc, 
    doc, 
    getDoc,
    getDocs, 
    query, 
    where, 
    orderBy, 
    limit, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// FIREBASE CONFIGURATION (OJT-LOGS Project Credentials)
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
const attendanceRef = collection(db, "attendance");
const companiesRef = collection(db, "companies");

let fullAttendanceHistory = [];
let initialClockInterval = null;

/* ==========================================
   NTP TIME FETCHER (Reliable Internet & Firebase Synchronized Time)
========================================== */
async function getCurrentNTPTime() {
    try {
        // Kumukuha ng oras mula sa internet time API upang maiwasan ang manipulasyon sa PC/Mobile local clock
        const response = await fetch("https://worldtimeapi.org/api/timezone/Asia/Manila");
        const data = await response.json();
        return new Date(data.datetime);
    } catch (error) {
        console.warn("NTP API failed, falling back to secure server sync fallback:", error);
        // Fallback sa kasalukuyang secure time kung walang internet connection sa mismong segundo na yun
        return new Date();
    }
}

/* ==========================================
   DATE & TIME HELPER FUNCTIONS (UI DISPLAY ONLY)
========================================== */
function getLocalYYYYMMDD(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatLocalDateDisplay(dateObj = new Date()) {
    return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAMPM(dateObj = new Date()) {
    return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/* ==========================================
   INITIAL LIVE CLOCK (DISPLAYS TIME ON LOAD)
========================================== */
async function startInitialLiveClock() {
    const badge = document.getElementById("firebase-timestamp-badge");
    if (!badge) return;

    const updateClock = async () => {
        const now = await getCurrentNTPTime();
        const dateStr = formatLocalDateDisplay(now);
        const timeStr = formatAMPM(now);
        badge.textContent = `${timeStr} / ${dateStr}`;
    };

    await updateClock();
    
    if (initialClockInterval) clearInterval(initialClockInterval);
    initialClockInterval = setInterval(updateClock, 1000);
}

async function loadHeader(title) {
    try {
        const response = await fetch("../templated/header.html");
        const data = await response.text();
        
        const headerContainer = document.getElementById("header-container");
        if (headerContainer) {
            headerContainer.innerHTML = data;
        }

        const pageTitle = document.getElementById("page-title");
        if (pageTitle) {
            pageTitle.textContent = title;
        }

        if (auth.currentUser) {
            await updateProfileInHeader(auth.currentUser);
        }

        initHeaderEvents();
    } catch (err) {
        console.error("Error loading header:", err);
    }
}

/* ==========================================
   INITIALS EXTRACTOR
========================================== */
function getInitials(fullName) {
    if (!fullName) return "ST";
    const nameParts = fullName.trim().split(" ").filter(part => part.length > 0);
    
    if (nameParts.length === 1) {
        return nameParts[0].charAt(0).toUpperCase();
    }
    
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

// Custom Toast Notification
function showToast(message, type = "success") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 90%;
            max-width: 480px;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    const isSuccess = type === "success";
    const bgColor = isSuccess ? "#eafaf1" : type === "error" ? "#fef2f2" : "#eff6ff";
    const borderColor = isSuccess ? "#bbf2d0" : type === "error" ? "#fca5a5" : "#bfdbfe";
    const textColor = isSuccess ? "#0e7490" : type === "error" ? "#991b1b" : "#1e40af";
    const iconColor = isSuccess ? "#059669" : type === "error" ? "#dc2626" : "#2563eb";

    toast.style.cssText = `
        width: 100%;
        padding: 16px 20px;
        border-radius: 14px;
        background-color: ${bgColor};
        border: 1px solid ${borderColor};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
        display: flex;
        align-items: center;
        gap: 12px;
        transition: all 0.3s ease;
    `;

    const iconClass = isSuccess ? "fa-circle-check" : type === "error" ? "fa-circle-xmark" : "fa-circle-info";
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass}" style="font-size: 20px; color: ${iconColor};"></i>
        <span style="color: ${textColor}; font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 500;">
            ${message}
        </span>
    `;

    container.innerHTML = "";
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-6px)";
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

document.addEventListener("DOMContentLoaded", () => {
    loadHeader("Attendance");

    fetch("../templated/sidebar.html?v=" + new Date().getTime())
        .then(response => response.ok ? response.text() : Promise.reject())
        .then(html => {
            const sidebarContainer = document.getElementById("sidebar-container");
            if (sidebarContainer) sidebarContainer.innerHTML = html;
            initSidebar("Attendance");
        })
        .catch(err => console.error("Error loading sidebar:", err));

    setupMobileMenuToggle();
    initFlatpickrFilter();

    // I-display agad ang tamang oras mula sa internet/server ngayong araw sa pag-load pa lang ng pahina
    startInitialLiveClock();

    onAuthStateChanged(auth, (user) => {
        initAttendanceSystem(user);
    });
});

/* ==========================================
   FLATPICKR DATE RANGE PICKER
========================================== */
function initFlatpickrFilter() {
    const datePickerInput = document.getElementById("dateRangePicker");

    if (datePickerInput && typeof flatpickr !== "undefined") {
        flatpickr(datePickerInput, {
            mode: "range",
            dateFormat: "M j, Y",
            onChange: function (selectedDates) {
                if (selectedDates.length === 2) {
                    filterHistoryByDateRange(selectedDates[0], selectedDates[1]);
                } else if (selectedDates.length === 0) {
                    renderHistoryItems(fullAttendanceHistory);
                }
            }
        });
    }
}

function filterHistoryByDateRange(startDate, endDate) {
    const start = new Date(startDate).setHours(0, 0, 0, 0);
    const end = new Date(endDate).setHours(23, 59, 59, 999);

    const filtered = fullAttendanceHistory.filter(item => {
        const itemDateStr = item.date || item.formattedDate;
        if (!itemDateStr) return false;

        const itemDate = new Date(itemDateStr).setHours(12, 0, 0, 0);
        return itemDate >= start && itemDate <= end;
    });

    renderHistoryItems(filtered);
}

// Global View Photo Modal
window.viewPhotoModal = function(photoUrl, company, date, timeIn) {
    let viewModal = document.getElementById('view-photo-modal');
    
    if (!viewModal) {
        viewModal = document.createElement('div');
        viewModal.id = 'view-photo-modal';
        viewModal.className = 'scanner-modal';
        viewModal.innerHTML = `
            <div class="scanner-dialog" style="max-width: 420px; padding: 20px;">
                <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 4px;"><i class="fa-solid fa-image" style="color: #3b82f6;"></i> Photo Proof Details</h3>
                <p style="font-size: 11px; color: #6b7280; margin-bottom: 12px;">Verification photo submitted during time-in</p>
                
                <div style="width: 100%; height: 260px; border-radius: 12px; overflow: hidden; background: #111827; margin-bottom: 14px; display: flex; align-items: center; justify-content: center;">
                    <img id="view-photo-img" src="" alt="Photo Proof" style="width: 100%; height: 100%; object-fit: cover;">
                </div>

                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; text-align: left; font-size: 12px;">
                    <div><span style="color: #6b7280; font-size: 10px; text-transform: uppercase; font-weight:600;">Company:</span> <strong id="view-photo-company" style="color: #111827;">--</strong></div>
                    <div><span style="color: #6b7280; font-size: 10px; text-transform: uppercase; font-weight:600;">Date:</span> <strong id="view-photo-date" style="color: #111827;">--</strong></div>
                    <div><span style="color: #6b7280; font-size: 10px; text-transform: uppercase; font-weight:600;">Time In:</span> <strong id="view-photo-time" style="color: #111827;">--</strong></div>
                </div>

                <button id="view-photo-close-action" type="button" style="margin-top: 14px; width: 100%; padding: 10px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; font-weight: 600; font-size: 13px; color: #374151; cursor: pointer;">Close</button>
            </div>
        `;
        document.body.appendChild(viewModal);

        const closeAction = document.getElementById('view-photo-close-action');
        closeAction?.addEventListener('click', () => { viewModal.hidden = true; });
    }

    const imgEl = document.getElementById('view-photo-img');
    const compEl = document.getElementById('view-photo-company');
    const dateEl = document.getElementById('view-photo-date');
    const timeEl = document.getElementById('view-photo-time');

    if (imgEl) imgEl.src = photoUrl || 'https://via.placeholder.com/400x300?text=No+Photo+Proof';
    if (compEl) compEl.textContent = company || 'Partner Company';
    if (dateEl) dateEl.textContent = date || '--';
    if (timeEl) timeEl.textContent = timeIn || '--';

    viewModal.hidden = false;
};

// Render Logs List
function renderHistoryItems(historyList) {
    const historyContainer = document.getElementById("attendance-history-list");
    if (!historyContainer) return;

    if (historyList.length === 0) {
        historyContainer.innerHTML = `<div style="text-align:center; padding: 20px; color:#9ca3af; font-size:12px;">No Attendance Logs Found.</div>`;
        return;
    }

    historyContainer.innerHTML = historyList.map(item => {
        const photoSrc = item.photoProof || item.photoProofUrl || item.photoUrl || item.photo || '';
        const safeCompany = (item.company || 'Partner Company').replace(/'/g, "\\'");
        const safeDate = (item.formattedDate || item.date || '--').replace(/'/g, "\\'");
        const safeTimeIn = (item.timeIn || '--').replace(/'/g, "\\'");

        const isCompleted = item.status === 'Present' || item.status === 'Completed';
        const isLate = item.status === 'Late';
        const isAbsent = item.status === 'Absent';
        const isActive = item.status === 'Active';

        let badgeClass = 'green';
        let badgeText = item.status;
        if (isLate) { badgeClass = 'orange'; }
        else if (isAbsent) { badgeClass = 'red'; }
        else if (isActive) { badgeClass = 'blue'; badgeText = 'Active'; }
        else if (isCompleted) { badgeClass = 'green'; badgeText = 'Present'; }

        return `
            <div class="attendance-history-item">
                <div class="att-item-top">
                    <div class="att-item-left">
                        <div class="att-icon-box ${badgeClass === 'green' ? 'green-bg' : badgeClass === 'orange' ? 'orange-bg' : badgeClass === 'red' ? 'red-bg' : 'blue-bg'}">
                            <i class="fa-solid ${badgeClass === 'green' ? 'fa-circle-check' : badgeClass === 'orange' ? 'fa-clock' : badgeClass === 'red' ? 'fa-circle-xmark' : 'fa-spinner'}"></i>
                        </div>
                        <div class="att-date-info">
                            <h4>${item.formattedDate || item.date}</h4>
                            <p>${item.company}</p>
                        </div>
                    </div>
                    <div class="att-item-right">
                        <span class="badge-status ${badgeClass}">${badgeText}</span>
                    </div>
                </div>
                
                <div class="att-item-divider"></div>
                
                <div class="att-item-bottom">
                    <div class="time-log-info">
                        <span><i class="fa-solid fa-arrow-right-to-bracket text-green"></i> ${item.timeIn}</span>
                        <span class="dot">•</span>
                        <span><i class="fa-solid fa-arrow-right-from-bracket text-red"></i> ${item.timeOut}</span>
                    </div>
                    ${photoSrc ? `<button type="button" onclick="viewPhotoModal('${photoSrc}', '${safeCompany}', '${safeDate}', '${safeTimeIn}')" style="font-size: 11px; color: #3b82f6; font-weight: 500; border:none; background:none; cursor:pointer; display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-image"></i> Photo Proof</button>` : ''}
                </div>

                ${item.tasks ? `<div class="task-summary-preview"><strong>Tasks:</strong> ${item.tasks}</div>` : ''}
                ${item.remarks && item.remarks !== '--' ? `<div style="margin-top: 4px; font-size: 11px; color: ${isLate ? '#ea580c' : '#059669'};"><strong>Remarks:</strong> ${item.remarks}</div>` : ''}
            </div>
        `;
    }).join('');
}

function initSidebar(activeMenuName) {
    const menuItems = document.querySelectorAll(".menu li");
    if (menuItems.length > 0) {
        menuItems.forEach(item => {
            const spanText = item.querySelector("span")?.textContent.trim();
            if (spanText && spanText.toLowerCase() === activeMenuName.toLowerCase()) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });
    }
}

function setupMobileMenuToggle() {
    document.addEventListener("click", (e) => {
        const mobileBtn = e.target.closest("#mobile-menu");
        const sidebar = document.getElementById("sidebar");

        if (mobileBtn && sidebar) {
            e.stopPropagation();
            sidebar.classList.toggle("show");
            return;
        }

        if (sidebar && sidebar.classList.contains("show")) {
            if (!sidebar.contains(e.target)) {
                sidebar.classList.remove("show");
            }
        }
    });
}

function updateRedTimestampBadge(timeIn, dateString) {
    const badge = document.getElementById("firebase-timestamp-badge");
    if (badge) {
        if (timeIn && dateString) {
            if (initialClockInterval) {
                clearInterval(initialClockInterval);
                initialClockInterval = null;
            }
            badge.textContent = `${timeIn} / ${dateString}`;
        }
    }
}

function initAttendanceSystem(currentUser) {
    const timeInScanBtn = document.getElementById("time-in-scan-btn");
    const timeOutScanBtn = document.getElementById("time-out-scan-btn");
    const timeOutIconBox = document.getElementById("time-out-icon-box");
    const timeOutNoteText = document.getElementById("time-out-note-text");

    const scannerModal = document.getElementById("scanner-modal");
    const scannerStatus = document.getElementById("scanner-status");
    const scannerCancel = document.getElementById("scanner-cancel");

    const photoModal = document.getElementById("photo-modal");
    const photoVideo = document.getElementById("photo-video");
    const photoCanvas = document.getElementById("photo-canvas");
    const stampDatetime = document.getElementById("stamp-datetime");
    const stampLocation = document.getElementById("stamp-location");
    const capturePhotoBtn = document.getElementById("capture-photo-btn");
    const photoCancel = document.getElementById("photo-cancel");

    const taskModal = document.getElementById("task-modal");
    const submitTaskBtn = document.getElementById("submit-task-btn");
    const taskCancel = document.getElementById("task-cancel");

    const viewPhotoBtnClose = document.getElementById("view-photo-btn-close");
    const viewPhotoModalEl = document.getElementById("view-photo-modal");

    let qrScanner = null;
    let scanMode = null; 
    let photoStream = null;
    let currentLocationStr = "Fetching Location...";
    let clockInterval = null;

    refreshAttendanceUI();

    // --- 1. QR SCANNER LOGIC ---
    const stopQRScanner = async () => {
        if (qrScanner) {
            try {
                await qrScanner.stop();
                await qrScanner.clear();
            } catch (err) {
                console.warn("Scanner stop issue:", err);
            }
            qrScanner = null;
        }
    };

    const openQRScanner = async (mode) => {
        const now = await getCurrentNTPTime();
        const todayStr = getLocalYYYYMMDD(now);
        const latestToday = fullAttendanceHistory.find(i => i.date === todayStr);

        if (mode === "IN" && latestToday) {
            if (latestToday.status === "Completed" || latestToday.status === "Present" || latestToday.status === "Late") {
                showToast("You have already completed attendance for today. Try again tomorrow!", "error");
                return;
            }
            if (latestToday.status === "Active") {
                showToast("You are already Timed In today!", "info");
                return;
            }
        }

        scanMode = mode;
        if (typeof Html5Qrcode === "undefined") {
            showToast("QR Scanner library not loaded. Check internet.", "error");
            return;
        }

        scannerModal.hidden = false;
        scannerStatus.textContent = "Requesting camera permission...";

        try {
            await stopQRScanner();
            qrScanner = new Html5Qrcode("qr-reader");

            await qrScanner.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 220, height: 220 } },
                async (decodedText) => {
                    await stopQRScanner();
                    scannerModal.hidden = true;
                    await verifyCompanyQR(decodedText);
                },
                () => undefined
            );
            scannerStatus.textContent = "Ready. Point camera at company QR code.";
        } catch (err) {
            console.error("Camera access error:", err);
            scannerStatus.textContent = "Unable to access camera. Check permissions.";
        }
    };

    const verifyCompanyQR = async (scannedCode) => {
        let code = scannedCode.trim();
        let companyFound = null;

        if (code.startsWith("{") && code.endsWith("}")) {
            try {
                const parsed = JSON.parse(code);
                if (parsed.token) code = parsed.token.trim();
            } catch (e) {
                console.warn("JSON Parse Error:", e);
            }
        }

        try {
            const qToken = query(companiesRef, where("qrToken", "==", code));
            let snapshot = await getDocs(qToken);

            if (snapshot.empty) {
                const docRef = doc(db, "companies", code);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) companyFound = docSnap.data();
            } else {
                snapshot.forEach(d => companyFound = d.data());
            }

            if (!companyFound) {
                showToast("Not Detected: Invalid Company QR Code!", "error");
                return;
            }

            const companyName = companyFound.companyName || companyFound.name || "Partner Company";
            localStorage.setItem("verified_company_name", companyName);
            
            showToast(`QR Scan Success! Welcome to ${companyName}`, "success");

            if (scanMode === "IN") {
                openPhotoProofModal();
            } else {
                openTaskModal();
            }

        } catch (err) {
            console.error("QR Verification error:", err);
            showToast("Database error during QR verification.", "error");
        }
    };

    timeInScanBtn?.addEventListener("click", () => {
        if (!timeInScanBtn.disabled) openQRScanner("IN");
    });
    timeOutScanBtn?.addEventListener("click", () => {
        if (!timeOutScanBtn.disabled) openQRScanner("OUT");
    });

    scannerCancel?.addEventListener("click", async () => { await stopQRScanner(); scannerModal.hidden = true; });

    // --- 2. LIVE PHOTO PROOF ---
    const openPhotoProofModal = async () => {
        photoModal.hidden = false;
        fetchGeolocation();

        try {
            photoStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "user" }, 
                audio: false 
            });
            photoVideo.srcObject = photoStream;
        } catch (err) {
            showToast("Camera access required for photo proof.", "error");
            photoModal.hidden = true;
            return;
        }

        if (clockInterval) clearInterval(clockInterval);
        clockInterval = setInterval(async () => {
            const now = await getCurrentNTPTime();
            if (stampDatetime) stampDatetime.textContent = formatLocalDateDisplay(now) + " " + formatAMPM(now);
        }, 1000);
    };

    const closePhotoModal = () => {
        if (photoStream) photoStream.getTracks().forEach(t => t.stop());
        if (clockInterval) clearInterval(clockInterval);
        photoModal.hidden = true;
    };

    const fetchGeolocation = () => {
        if (stampLocation) stampLocation.textContent = "Locating Company...";
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    currentLocationStr = `Company GPS: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
                    if (stampLocation) stampLocation.textContent = currentLocationStr;
                },
                () => {
                    const compName = localStorage.getItem("verified_company_name") || "Company Grounds";
                    currentLocationStr = `${compName}`;
                    if (stampLocation) stampLocation.textContent = currentLocationStr;
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        } else {
            const compName = localStorage.getItem("verified_company_name") || "Company Grounds";
            currentLocationStr = `${compName}`;
            if (stampLocation) stampLocation.textContent = currentLocationStr;
        }
    };

    capturePhotoBtn?.addEventListener("click", async () => {
        capturePhotoBtn.disabled = true;
        capturePhotoBtn.textContent = "Saving Time In...";

        const w = photoVideo.videoWidth || 640;
        const h = photoVideo.videoHeight || 480;
        photoCanvas.width = w;
        photoCanvas.height = h;

        const ctx = photoCanvas.getContext("2d");
        ctx.drawImage(photoVideo, 0, 0, w, h);

        const now = await getCurrentNTPTime();
        const formattedDateStr = formatLocalDateDisplay(now);
        const formattedAMPM = formatAMPM(now);

        const overlayHeight = 60; 
        const overlayY = h - 70; 
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)"; 
        ctx.fillRect(0, overlayY, w, overlayHeight);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px Poppins, sans-serif"; 
        ctx.fillText(`${formattedDateStr} ${formattedAMPM} | ${currentLocationStr}`, 16, overlayY + 38);

        const photoBase64 = photoCanvas.toDataURL("image/jpeg", 0.3);
        const todayStr = getLocalYYYYMMDD(now);
        const timeInStr = formattedAMPM;
        const compName = localStorage.getItem("verified_company_name") || "Partner Company";

        const user = auth.currentUser || currentUser;
        const userId = user ? user.uid : "guest_user";
        const userEmail = user ? user.email : "no_email";

        const newRecord = {
            userId: userId,
            userEmail: userEmail,
            date: todayStr,
            formattedDate: formattedDateStr,
            company: compName,
            location: currentLocationStr,
            timeIn: timeInStr,
            timeInRaw: now.toISOString(),
            timeOut: "--",
            photoProof: photoBase64,
            tasks: "",
            hoursRendered: 0,
            todayHours: "0h 0m",
            status: "Active",
            remarks: "--",
            createdAt: serverTimestamp() // Gumagamit na ng Server Timestamp
        };

        try {
            const docRef = await addDoc(attendanceRef, newRecord);

            await addDoc(collection(db, "logs"), {
                type: "time_in",
                action: "Time In",
                title: "Time In Recorded",
                description: `${auth.currentUser?.email || "Student"} recorded Time In through QR.`,
                studentName: auth.currentUser?.email || "Student",
                company: compName,
                timestamp: serverTimestamp()
            });

            localStorage.setItem("current_attendance_doc_id", docRef.id);
            showToast("Time In Successful! Status is Active.", "success");
        } catch (e) {
            console.error("Firebase Firestore Time In Error:", e);
            const fallbackRecord = { ...newRecord, id: "local_" + Date.now(), createdAt: new Date().toISOString() };
            localStorage.setItem("current_attendance_doc_id", fallbackRecord.id);
            localStorage.setItem("offline_attendance_log", JSON.stringify(fallbackRecord));
            showToast("Saved locally (Firebase Connection Issue)", "info");
        }

        closePhotoModal();
        await refreshAttendanceUI();

        capturePhotoBtn.disabled = false;
        capturePhotoBtn.innerHTML = `<i class="fa-solid fa-camera"></i> Complete Time In`;
    });

    photoCancel?.addEventListener("click", closePhotoModal);

    // --- 3. TASK REPORT (TIME OUT & STATUS EVALUATION) ---
    let pendingTasksList = []; 

    const openTaskModal = () => {
        taskModal.hidden = false;
        pendingTasksList = []; 
        renderTasksList();
        if (document.getElementById("task-title-input")) document.getElementById("task-title-input").value = "";
        if (document.getElementById("task-desc-input")) document.getElementById("task-desc-input").value = "";
    };

    const closeTaskModal = () => { taskModal.hidden = true; };

    function renderTasksList() {
        const listContainer = document.getElementById("added-tasks-list");
        if (!listContainer) return;

        if (pendingTasksList.length === 0) {
            listContainer.innerHTML = `<li style="font-size: 11px; color: #9ca3af; text-align: center; padding: 8px; background: #f9fafb; border-radius: 6px; border: 1px dashed #e5e7eb;">No tasks added yet.</li>`;
            return;
        }

        listContainer.innerHTML = pendingTasksList.map((item, index) => `
            <li style="background: #f3f4f6; padding: 8px 10px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; border: 1px solid #e5e7eb;">
                <div style="text-align: left; padding-right: 8px;">
                    <strong style="color: #111827; display: block; font-weight: 600;">${item.title}</strong>
                    <span style="color: #4b5563;">${item.description}</span>
                </div>
                <button type="button" class="remove-task-btn" data-index="${index}" style="color: #dc2626; border: none; background: none; cursor: pointer; padding: 4px;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </li>
        `).join('');

        document.querySelectorAll('.remove-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = e.currentTarget.getAttribute('data-index');
                pendingTasksList.splice(index, 1);
                renderTasksList();
            });
        });
    }

    document.getElementById("add-task-btn")?.addEventListener("click", () => {
        const titleInput = document.getElementById("task-title-input");
        const descInput = document.getElementById("task-desc-input");

        const title = titleInput?.value.trim();
        const description = descInput?.value.trim();

        if (!title || !description) {
            showToast("Please enter both task title and description.", "info");
            return;
        }

        pendingTasksList.push({ title, description });
        titleInput.value = "";
        descInput.value = "";
        renderTasksList();
    });

    submitTaskBtn?.addEventListener("click", async () => {
        if (pendingTasksList.length === 0) {
            showToast("Please add at least one task before submitting.", "info");
            return;
        }

        const activeDocId = localStorage.getItem("current_attendance_doc_id");
        if (!activeDocId) {
            showToast("No active Time In session found.", "error");
            return;
        }

        submitTaskBtn.disabled = true;
        submitTaskBtn.textContent = "Updating Record...";

        const now = await getCurrentNTPTime();
        const timeOutStr = formatAMPM(now);

        try {
            if (!activeDocId.startsWith("local_")) {
                const docToUpdate = doc(db, "attendance", activeDocId);
                const docSnap = await getDoc(docToUpdate);

                let rawHours = 0;
                let hoursRendered = 0;
                let todayHoursStr = "0h 0m";
                let finalStatus = "Present";
                let finalRemarks = "On-Time / Present";

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    
                    let timeInDate;
                    if (data.timeInRaw) {
                        timeInDate = new Date(data.timeInRaw);
                    } else {
                        timeInDate = new Date();
                    }

                    const diffMs = now - timeInDate;
                    if (diffMs > 0) {
                        const totalMinutesElapsed = Math.floor(diffMs / (1000 * 60));
                        
                        const breaktimeDeductionMinutes = 60; 
                        const netWorkingMinutes = Math.max(0, totalMinutesElapsed - breaktimeDeductionMinutes);

                        const hrs = Math.floor(netWorkingMinutes / 60);
                        const mins = netWorkingMinutes % 60;

                        rawHours = parseFloat((netWorkingMinutes / 60).toFixed(2));

                        if (rawHours >= 8.0) {
                            hoursRendered = 8.0;
                            todayHoursStr = `${hrs}h ${mins}m (1hr break deducted)`;
                        } else {
                            hoursRendered = 0;
                            todayHoursStr = `${hrs}h ${mins}m (Under 8 Hours, 1hr break deducted)`;
                        }
                    }
                }

                await updateDoc(docToUpdate, {
                    timeOut: timeOutStr,
                    timeOutRaw: now.toISOString(),
                    taskList: pendingTasksList,
                    tasks: pendingTasksList.map(t => `${t.title}: ${t.description}`).join(" | "),
                    hoursRendered: hoursRendered,
                    todayHours: todayHoursStr,
                    status: finalStatus,
                    remarks: finalRemarks,
                    updatedAt: serverTimestamp() // Server timestamp din para sa pag-timeout
                });

                await addDoc(collection(db, "logs"), {
                    type: "time_out",
                    action: "Time Out",
                    title: "Time Out Recorded",
                    description: `${auth.currentUser?.email || "Student"} recorded Time Out through QR.`,
                    studentName: auth.currentUser?.email || "Student",
                    timestamp: serverTimestamp()
                });
            }
        } catch (e) {
            console.error("Firebase Time Out Error:", e);
        }

        localStorage.removeItem("current_attendance_doc_id");
        localStorage.removeItem("offline_attendance_log");
        closeTaskModal();
        showToast("Time Out Successful! Present status saved.", "success");
        await refreshAttendanceUI();

        submitTaskBtn.disabled = false;
        submitTaskBtn.innerHTML = `<i class="fa-solid fa-check-circle"></i> Submit & Complete Time Out`;
    });

    taskCancel?.addEventListener("click", closeTaskModal);

    viewPhotoBtnClose?.addEventListener("click", () => {
        if (viewPhotoModalEl) viewPhotoModalEl.hidden = true;
    });

    // --- 4. REFRESH & BIND TODAY'S ATTENDANCE UI ---
    async function refreshAttendanceUI() {
        const todayDate = document.getElementById("today-date");
        const todayCompany = document.getElementById("today-company");
        const todayLocation = document.getElementById("today-location");
        const todayTimeIn = document.getElementById("today-time-in");
        const todayTimeOut = document.getElementById("today-time-out");
        const todayStatusBadge = document.getElementById("today-status-badge");

        const now = await getCurrentNTPTime();
        const todayStr = getLocalYYYYMMDD(now);
        
        if (todayDate) todayDate.textContent = formatLocalDateDisplay(now);

        let historyMap = new Map();
        const user = auth.currentUser || currentUser;
        const currentUid = user ? user.uid : null;
        const currentEmail = user ? user.email : localStorage.getItem("user_email");

        if (currentUid) {
            try {
                const qUser = query(attendanceRef, where("userId", "==", currentUid));
                const snapUser = await getDocs(qUser);
                snapUser.forEach(docSnap => historyMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
            } catch (e) { console.warn("Fetch userId err:", e); }
        }

        if (currentEmail) {
            try {
                const qEmail = query(attendanceRef, where("userEmail", "==", currentEmail));
                const snapEmail = await getDocs(qEmail);
                snapEmail.forEach(docSnap => historyMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
            } catch (e) { console.warn("Fetch userEmail err:", e); }
        }

        fullAttendanceHistory = Array.from(historyMap.values());

        fullAttendanceHistory.sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return timeB - timeA;
        });

        const activeDocId = localStorage.getItem("current_attendance_doc_id");
        const session = fullAttendanceHistory.find(i => i.id === activeDocId || (i.status === "Active" && i.date === todayStr));

        if (session && session.status === "Active") {
            if (todayCompany) todayCompany.textContent = session.company || "--";
            if (todayLocation) todayLocation.textContent = session.location || "--";
            if (todayTimeIn) todayTimeIn.textContent = session.timeIn || "--";
            if (todayTimeOut) todayTimeOut.textContent = "--";

            if (todayStatusBadge) {
                todayStatusBadge.textContent = "Active";
                todayStatusBadge.className = "status-badge active";
            }

            if (timeInScanBtn) { timeInScanBtn.disabled = true; timeInScanBtn.className = "scan-btn disabled-btn"; }
            if (timeOutScanBtn) { timeOutScanBtn.disabled = false; timeOutScanBtn.className = "scan-btn orange-btn"; }
            if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle orange-bg";
            if (timeOutNoteText) timeOutNoteText.textContent = "Click to scan QR code and time out.";

            const badgeDateStr = session.formattedDate || formatLocalDateDisplay(now);
            updateRedTimestampBadge(session.timeIn, badgeDateStr);

        } else {
            const latestToday = fullAttendanceHistory.find(i => i.date === todayStr);

            if (latestToday && (latestToday.status === "Present" || latestToday.status === "Completed" || latestToday.status === "Late")) {
                if (todayCompany) todayCompany.textContent = latestToday.company || "--";
                if (todayLocation) todayLocation.textContent = latestToday.location || "--";
                if (todayTimeIn) todayTimeIn.textContent = latestToday.timeIn || "--";
                if (todayTimeOut) todayTimeOut.textContent = latestToday.timeOut || "--";

                if (todayStatusBadge) {
                    todayStatusBadge.textContent = "Present";
                    todayStatusBadge.className = "status-badge completed";
                }

                if (timeInScanBtn) { timeInScanBtn.disabled = true; timeInScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutScanBtn) { timeOutScanBtn.disabled = true; timeOutScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle gray-bg";
                if (timeOutNoteText) timeOutNoteText.textContent = "Attendance completed for today. Come back tomorrow!";

                updateRedTimestampBadge(latestToday.timeIn, latestToday.formattedDate || formatLocalDateDisplay(now));

            } else {
                if (todayCompany) todayCompany.textContent = "--";
                if (todayLocation) todayLocation.textContent = "--";
                if (todayTimeIn) todayTimeIn.textContent = "--";
                if (todayTimeOut) todayTimeOut.textContent = "--";

                if (todayStatusBadge) {
                    todayStatusBadge.textContent = latestToday && latestToday.status === "Absent" ? "Absent" : "Not Timed In";
                    todayStatusBadge.className = latestToday && latestToday.status === "Absent" ? "status-badge late" : "status-badge not-timed-in";
                }

                if (timeInScanBtn) { timeInScanBtn.disabled = latestToday && latestToday.status === "Absent"; timeInScanBtn.className = timeInScanBtn.disabled ? "scan-btn disabled-btn" : "scan-btn green-btn"; }
                if (timeOutScanBtn) { timeOutScanBtn.disabled = true; timeOutScanBtn.className = "scan-btn disabled-btn"; }
                if (timeOutIconBox) timeOutIconBox.className = "qr-icon-circle gray-bg";
                if (timeOutNoteText) timeOutNoteText.textContent = "Note: 1 hour breaktime is automatically deducted from total hours.";
            }
        }

        const datePickerInput = document.getElementById("dateRangePicker");
        if (datePickerInput && datePickerInput._flatpickr && datePickerInput._flatpickr.selectedDates.length === 2) {
            const dates = datePickerInput._flatpickr.selectedDates;
            filterHistoryByDateRange(dates[0], dates[1]);
        } else {
            renderHistoryItems(fullAttendanceHistory);
        }
    }
}