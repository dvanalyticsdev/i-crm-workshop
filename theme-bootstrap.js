(function () {
  const STORAGE_KEY = "dvWorkshopTheme";
  const isCoursesPage = window.location.pathname.includes("courses");

  function getPreferredTheme() {
    if (isCoursesPage) {
      return "light";
    }
    try {
      const storedTheme = window.localStorage.getItem(STORAGE_KEY);
      if (storedTheme === "light" || storedTheme === "dark") {
        return storedTheme;
      }
    } catch (_error) {
      // Ignore storage access failures and fall back to the system preference.
    }

    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  const theme = getPreferredTheme();
  const root = document.documentElement;

  root.classList.add("app-shell-pending");
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;

  const loadingOverlay = document.createElement("div");
  loadingOverlay.className = "app-shell-loading";
  loadingOverlay.setAttribute("aria-live", "polite");
  loadingOverlay.innerHTML = `
    <div class="app-shell-loading__content">
      <div class="app-shell-loading__dot" aria-hidden="true"></div>
      <div class="app-shell-loading__text">Loading</div>
      <div class="app-shell-loading__timer">0.0s</div>
    </div>
  `;
  document.addEventListener("DOMContentLoaded", () => {
    document.body.appendChild(loadingOverlay);
    const timerElement = loadingOverlay.querySelector(".app-shell-loading__timer");
    const startedAt = Date.now();
    timerElement.textContent = "0.0s";
    window.__dvLoadingOverlayTimer = window.setInterval(() => {
      const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (timerElement) {
        timerElement.textContent = `${elapsedSeconds}s`;
      }
    }, 100);
  }, { once: true });
})();
