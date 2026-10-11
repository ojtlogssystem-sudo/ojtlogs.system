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

    const flyout = initSidebarFlyout(sidebar);

    // 1. DROPDOWN TOGGLE (Direct Selector)
    const dropdownToggles = sidebar.querySelectorAll(".dropdown-toggle");

    dropdownToggles.forEach(toggle => {
        toggle.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();

            const parentLi = this.closest(".has-dropdown");

            // Pag naka-collapse, huwag nang i-expand ang sidebar -
            // magbubukas ng flyout menu sa tabi ng icon para pwedeng
            // pumili agad ng page.
            if (sidebar.classList.contains("close")) {
                flyout.toggle(parentLi);
                return;
            }

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

    // 3. TOOLTIP NG MGA ICON KAPAG NAKA-COLLAPSE ANG SIDEBAR
    initSidebarTooltips(sidebar);
}

// ==========================
// SIDEBAR FLYOUT (collapsed mode)
// Lumalabas ang sub-menu (hal. Settings) sa tabi ng icon kahit
// naka-collapse ang sidebar, para makapili agad ng ibang page.
// ==========================
function initSidebarFlyout(sidebar) {
    let flyout = document.getElementById("sidebar-flyout");
    if (!flyout) {
        flyout = document.createElement("div");
        flyout.id = "sidebar-flyout";
        flyout.className = "sidebar-flyout";
        document.body.appendChild(flyout);
    }

    let currentLi = null;
    let closeTimer = null;

    const close = () => {
        clearTimeout(closeTimer);
        flyout.classList.remove("show");
        if (currentLi) currentLi.classList.remove("flyout-open");
        currentLi = null;
    };

    const scheduleClose = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(close, 180);
    };

    const open = (li) => {
        if (!li || !sidebar.classList.contains("close")) return;
        clearTimeout(closeTimer);

        if (currentLi && currentLi !== li) currentLi.classList.remove("flyout-open");
        currentLi = li;
        li.classList.add("flyout-open");

        // Itago ang tooltip habang bukas ang flyout
        const tip = document.getElementById("sidebar-tooltip");
        if (tip) tip.classList.remove("show");

        // Buuin ang laman mula sa sub-menu para laging sync (kasama ang active)
        const title = li.querySelector(":scope > a span");
        flyout.innerHTML = "";

        const heading = document.createElement("div");
        heading.className = "sidebar-flyout-title";
        heading.textContent = title ? title.textContent.trim() : "";
        flyout.appendChild(heading);

        li.querySelectorAll(".sub-menu li").forEach((subLi) => {
            const src = subLi.querySelector("a");
            if (!src) return;

            const item = document.createElement("a");
            item.className = "sidebar-flyout-item" + (subLi.classList.contains("active") ? " active" : "");
            item.href = src.getAttribute("href");

            const icon = src.querySelector("i");
            if (icon) {
                const iconClone = icon.cloneNode(true);
                item.appendChild(iconClone);
            }

            const label = document.createElement("span");
            const srcLabel = src.querySelector("span");
            label.textContent = srcLabel ? srcLabel.textContent.trim() : src.textContent.trim();
            item.appendChild(label);

            flyout.appendChild(item);
        });

        // Posisyon: nasa kanan ng icon, naka-align sa taas, hindi lalampas sa screen
        const rect = li.querySelector(":scope > a").getBoundingClientRect();
        flyout.style.left = `${rect.right + 12}px`;
        flyout.style.top = `${rect.top}px`;
        flyout.classList.add("show");

        const flyRect = flyout.getBoundingClientRect();
        const overflow = flyRect.bottom - (window.innerHeight - 12);
        if (overflow > 0) {
            flyout.style.top = `${Math.max(12, rect.top - overflow)}px`;
        }
    };

    const toggle = (li) => {
        if (currentLi === li && flyout.classList.contains("show")) close();
        else open(li);
    };

    // Hover sa icon (desktop)
    sidebar.querySelectorAll(".has-dropdown").forEach((li) => {
        const link = li.querySelector(":scope > a");
        if (!link) return;
        link.addEventListener("mouseenter", () => open(li));
        link.addEventListener("mouseleave", scheduleClose);
    });

    flyout.addEventListener("mouseenter", () => clearTimeout(closeTimer));
    flyout.addEventListener("mouseleave", scheduleClose);

    // Isara kapag nag-click sa labas, Escape, scroll, o resize
    document.addEventListener("click", (e) => {
        if (!flyout.contains(e.target) && !e.target.closest(".has-dropdown")) close();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
    });
    const menu = sidebar.querySelector(".menu");
    if (menu) menu.addEventListener("scroll", close);
    window.addEventListener("resize", close);

    return { open, close, toggle };
}

// ==========================
// SIDEBAR TOOLTIPS (collapsed mode)
// Naka-"fixed" sa body para hindi maputol ng overflow ng sidebar.
// ==========================
function initSidebarTooltips(sidebar) {
    let tooltip = document.getElementById("sidebar-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "sidebar-tooltip";
        tooltip.className = "sidebar-tooltip";
        document.body.appendChild(tooltip);
    }

    const hideTooltip = () => tooltip.classList.remove("show");

    const showTooltip = (link) => {
        if (!sidebar.classList.contains("close")) return hideTooltip();

        const label = link.querySelector("span");
        const text = label ? label.textContent.trim() : "";
        if (!text) return hideTooltip();

        tooltip.textContent = text;

        const rect = link.getBoundingClientRect();
        tooltip.style.left = `${rect.right + 14}px`;
        tooltip.style.top = `${rect.top + rect.height / 2}px`;
        tooltip.classList.add("show");
    };

    // Mga icon lang sa main menu (hindi ang sub-menu items)
    const getLink = (target) => {
        const link = target.closest(".menu a");
        if (!link || link.closest(".sub-menu") || link.classList.contains("dropdown-toggle")) return null;
        return link;
    };

    sidebar.addEventListener("mouseover", (e) => {
        const link = getLink(e.target);
        if (link) showTooltip(link);
    });

    sidebar.addEventListener("mouseout", (e) => {
        const link = getLink(e.target);
        if (link && !link.contains(e.relatedTarget)) hideTooltip();
    });

    sidebar.addEventListener("click", hideTooltip);
    sidebar.addEventListener("mouseleave", hideTooltip);
    const menu = sidebar.querySelector(".menu");
    if (menu) menu.addEventListener("scroll", hideTooltip);
    window.addEventListener("resize", hideTooltip);
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
                parentDropdown.classList.add("has-active-child");
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