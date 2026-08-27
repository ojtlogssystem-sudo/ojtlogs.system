// ==========================
// LOAD SIDEBAR DYNAMICALLY
// ==========================
async function loadSidebar() {
    const container = document.getElementById("sidebar-container");
    if (!container) return;

    try {
        const response = await fetch("../sidebar/sidebar-web.html");
        const html = await response.text();
        container.innerHTML = html;

        // Apply state and bindings AFTER DOM injection
        applySidebarState();
        initSidebarEvents();
        setActiveMenu();

    } catch (error) {
        console.error("Error loading sidebar:", error);
    }
}

// ==========================
// APPLY SIDEBAR STATE
// ==========================
function applySidebarState() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    const isClosed = localStorage.getItem("sidebarClosed");

    if (isClosed === "true" || window.innerWidth <= 768) {
        sidebar.classList.add("close");
    } else {
        sidebar.classList.remove("close");
    }
}

// ==========================
// SIDEBAR EVENTS
// ==========================
function initSidebarEvents() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    // 1. DROPDOWN TOGGLE (Direct Selector)
    const dropdownToggles = sidebar.querySelectorAll(".dropdown-toggle");

    dropdownToggles.forEach(toggle => {
        toggle.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Pag naka-collapse, buksan muna ang sidebar
            if (sidebar.classList.contains("close")) {
                sidebar.classList.remove("close");
                localStorage.setItem("sidebarClosed", "false");
            }

            const parentLi = this.closest(".has-dropdown");
            if (parentLi) {
                parentLi.classList.toggle("open");
            }
        });
    });

    // 2. BURGER BUTTONS
    const menuBtn = document.getElementById("menu-btn");
    const menuBtn2 = document.getElementById("menu-btn2");

    if (menuBtn) {
        menuBtn.addEventListener("click", () => {
            sidebar.classList.add("close");
            localStorage.setItem("sidebarClosed", "true");
        });
    }

    if (menuBtn2) {
        menuBtn2.addEventListener("click", () => {
            sidebar.classList.remove("close");
            localStorage.setItem("sidebarClosed", "false");
        });
    }
}

// ==========================
// ACTIVE MENU AUTO DETECT
// ==========================
function setActiveMenu() {
    const currentPage = window.location.pathname.split("/").pop();
    const menuLinks = document.querySelectorAll(".menu li a");

    menuLinks.forEach(link => {
        const href = link.getAttribute("href");
        if (!href || href.startsWith("javascript")) return;

        const linkPage = href.split("/").pop();

        if (linkPage === currentPage) {
            link.parentElement.classList.add("active");

            // Kusa ring bubuksan kung nasa settings page ka na
            const parentDropdown = link.closest(".has-dropdown");
            if (parentDropdown) {
                parentDropdown.classList.add("open");
            }
        }
    });
}

// Run Script
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSidebar);
} else {
    loadSidebar();
}

window.addEventListener("resize", applySidebarState);