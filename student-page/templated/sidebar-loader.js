function loadSidebar(activeMenuName) {
    fetch("../templated/sidebar.html") // <-- DAPAT SIDEBAR.HTML DITO
        .then(response => {
            if (!response.ok) throw new Error("Could not load sidebar.");
            return response.text();
        })
        .then(data => {
            const container = document.getElementById("sidebar-container");
            if (container) {
                container.innerHTML = data;

                // Auto-highlight batay sa activeMenuName
                const menuLinks = container.querySelectorAll(".menu li a");
                menuLinks.forEach(link => {
                    const spanText = link.querySelector("span")?.textContent.trim();
                    if (spanText && spanText.toLowerCase() === activeMenuName.toLowerCase()) {
                        link.parentElement.classList.add("active");
                    } else {
                        link.parentElement.classList.remove("active");
                    }
                });

                // Re-initialize ang Sidebar Toggle Events (Burger Menu)
                initSidebarEvents();
            }
        })
        .catch(err => console.error(err));
}

function initSidebarEvents() {
    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.getElementById("menu-btn");
    const menuBtn2 = document.getElementById("menu-btn2");
    const mobileMenu = document.getElementById("mobile-menu");

    if (menuBtn) {
        menuBtn.addEventListener("click", () => sidebar.classList.add("close"));
    }

    if (menuBtn2) {
        menuBtn2.addEventListener("click", () => sidebar.classList.remove("close"));
    }

    if (mobileMenu) {
    mobileMenu.onclick = (e) => {
        e.stopPropagation();

        sidebar.classList.remove("close");
        sidebar.classList.toggle("show");

        mobileMenu.style.display =
            sidebar.classList.contains("show") ? "none" : "flex";
    };
}

document.onclick = (e) => {

    if (!sidebar) return;

    if (
        window.innerWidth <= 768 &&
        sidebar.classList.contains("show") &&
        !sidebar.contains(e.target)
    ) {
        sidebar.classList.remove("show");

        if (mobileMenu) {
            mobileMenu.style.display = "flex";
        }
    }
};
}