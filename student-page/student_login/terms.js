// terms.js
// Terms & Conditions / Privacy Policy gate para sa login page.
// - Lalabas pagkabukas ng page.
// - Naka-disable ang checkbox hangga't hindi na-scroll hanggang baba.
// - Naka-disable ang "I Agree" button hangga't hindi naka-check.
// - Naka-save ang pagsang-ayon sa browser (localStorage) para hindi
//   lumabas ulit sa susunod. Para laging lumabas, gawing `true`
//   ang SHOW_EVERY_TIME sa ibaba.
(function () {
    const SHOW_EVERY_TIME = false;
    const STORAGE_KEY = "ojtLogsTermsAccepted";

    const modal = document.getElementById("termsModal");
    const body = document.getElementById("termsBody");
    const checkbox = document.getElementById("termsCheckbox");
    const checkLabel = document.getElementById("termsCheckLabel");
    const agreeBtn = document.getElementById("termsAgreeBtn");
    if (!modal || !body || !checkbox || !agreeBtn) return;

    function alreadyAccepted() {
        if (SHOW_EVERY_TIME) return false;
        try { return localStorage.getItem(STORAGE_KEY) === "true"; }
        catch (e) { return false; }
    }

    function closeModal() {
        modal.classList.remove("active");
        document.body.style.overflow = "";
        // Ilabas na ang login (fade in)
        document.body.classList.remove("terms-pending");
        document.body.classList.remove("pre-load");
    }

    if (alreadyAccepted()) {
        closeModal();
        return;
    }

    document.body.style.overflow = "hidden";

    let reachedBottom = false;

    function checkScroll() {
        if (reachedBottom) return;
        // 8px na tolerance para sa rounding ng browser
        const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 8;
        if (!atBottom) return;

        reachedBottom = true;
        checkbox.disabled = false;
        checkLabel.classList.remove("disabled");
    }

    body.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);
    // Kung sakaling sapat na ang laki ng screen at hindi na kailangang mag-scroll
    checkScroll();

    checkbox.addEventListener("change", () => {
        agreeBtn.disabled = !checkbox.checked;
    });

    agreeBtn.addEventListener("click", () => {
        if (!checkbox.checked) return;
        try { localStorage.setItem(STORAGE_KEY, "true"); } catch (e) {}
        closeModal();
    });
})();