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
})();
