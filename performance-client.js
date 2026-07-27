import { apiUrl } from "./api-client.js";
import { getSession } from "./state-sync.js";

const pageStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
const marks = new Map([["page:start", pageStartedAt]]);

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function markPerformance(label) {
  marks.set(String(label || "mark"), nowMs());
}

export function getPerformanceDuration(fromLabel = "page:start") {
  const startedAt = marks.get(fromLabel) || pageStartedAt;
  return Math.max(0, Math.round(nowMs() - startedAt));
}

export function waitForPaint(frameCount = 2) {
  return new Promise((resolve) => {
    const step = (remaining) => {
      window.requestAnimationFrame(() => {
        if (remaining <= 1) {
          resolve();
          return;
        }
        step(remaining - 1);
      });
    };
    step(Math.max(1, Number(frameCount) || 1));
  });
}

export async function recordClientPerformance({
  kind = "page",
  operation,
  page = window.location.pathname.split("/").pop() || "unknown",
  section = "",
  subsection = "",
  phase = "",
  durationMs = null,
  from = "page:start",
  success = true,
  message = "",
  count = 0
} = {}) {
  const session = getSession() || {};
  try {
    await fetch(apiUrl("/api/performance-logs/client"), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        kind,
        operation: operation || [page, section, subsection, phase].filter(Boolean).join(":") || page,
        page,
        section,
        subsection,
        phase,
        role: session.role || "",
        durationMs: durationMs ?? getPerformanceDuration(from),
        success,
        message,
        count
      })
    });
  } catch {
    // Performance logging should never block CRM usage.
  }
}
