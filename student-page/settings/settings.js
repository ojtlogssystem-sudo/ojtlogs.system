// settings.js
// Loaded as type="module" from settings.html.
//
// IMPORTANT: header-loader.js exports loadHeader as an ES module export.
// Module exports do NOT become global functions automatically, so we must
// import it directly here instead of relying on `typeof loadHeader === "function"`
// in a plain <script> (that check will always be false and silently skip
// loading the header).
import { loadHeader } from "../templated/header-loader.js";

/* ==========================================
   INITIAL LOADING OVERLAY
   Itinatago ito pagkatapos ma-load ang header
   (kasama ang profile), dahil ito ang huling
   asynchronous na piraso ng page bago makita
   ng user ang tunay na content.
========================================== */
function hideSettingsLoadingOverlay() {
    const overlay = document.getElementById("settings-loading-overlay");
    if (!overlay || overlay.dataset.hidden === "true") return;
    overlay.dataset.hidden = "true";
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 300);
}

document.addEventListener("DOMContentLoaded", () => {
    // Safety net: kung sakaling matagal ang koneksyon o may error na
    // hindi na-catch, huwag hayaang ma-stuck ang user sa loading screen
    // magpakailanman — itago pa rin pagkalipas ng ilang segundo.
    setTimeout(() => {
        const overlay = document.getElementById("settings-loading-overlay");
        if (overlay && overlay.dataset.hidden !== "true") {
            console.warn("Settings loading overlay auto-hidden after timeout — check network.");
            hideSettingsLoadingOverlay();
        }
    }, 15000);

    // sidebar-loader.js is a classic (non-module) script, so loadSidebar
    // IS attached to the global scope and safe to call directly here.
    if (typeof loadSidebar === "function") {
        loadSidebar("Settings");
    } else {
        console.error(
            "[settings.js] loadSidebar() is not defined. Check that " +
            "../templated/sidebar-loader.js loaded successfully (open DevTools " +
            "> Network tab and look for a 404 or path error)."
        );
    }

    loadHeader("Settings", { autoLoadProfile: true })
        .catch((err) => {
            console.error("[settings.js] Failed to load header:", err);
        })
        .finally(() => {
            hideSettingsLoadingOverlay();
        });
});