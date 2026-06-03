function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  const configured = normalizeBaseUrl(
    window.__DV_API_BASE_URL ||
    document.querySelector('meta[name="dv-api-base-url"]')?.content ||
    window.localStorage?.getItem("dvApiBaseUrl") ||
    ""
  );

  return configured;
}

export function apiUrl(path) {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path)
    : `/${String(path || "")}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}
