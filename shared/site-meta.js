// ==========================================
// site-meta.js
// Shared favicon injector - i-import ito sa <head> ng LAHAT ng
// HTML pages (students.html, companies.html, student_login.html, atbp.)
// para isang beses ka lang mag-eedit dito kapag gustong palitan
// ang icon, sa lahat ng pages agad mag-a-apply.
//
// PAANO GAMITIN:
//   <script src="/shared/site-meta.js"></script>
//   (o kung anong relative path ang tama sa deployment mo)
// ==========================================

(function () {
    // ------------------------------------------
    // 1. FAVICON (icon sa browser tab)
    // ------------------------------------------
    const FAVICON_PATH = "/images/grc-logo.jpg";

    // Alisin muna ang existing favicon links (kung meron man) para
    // hindi mag-conflict/mag-duplicate.
    document
        .querySelectorAll("link[rel='icon'], link[rel='shortcut icon']")
        .forEach((el) => el.remove());

    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/png";
    favicon.href = FAVICON_PATH;
    document.head.appendChild(favicon);

    // Apple touch icon (para sa "Add to Home Screen" sa iOS)
    const appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    appleIcon.href = FAVICON_PATH;
    document.head.appendChild(appleIcon);
})();