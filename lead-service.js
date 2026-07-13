import { apiUrl } from "./api-client.js";
import { acceptServerState } from "./state-sync.js";

async function requestJson(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (payload?.state) {
    acceptServerState(payload.state, response.headers.get("etag"));
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: payload?.message || "Request failed."
    };
  }

  return {
    ok: true,
    status: response.status,
    ...payload
  };
}

export function updateLeadActivity(leadId, { stage, updates, leadEmail = "", allowWithoutWorkshopActivity = false }) {
  return requestJson(`/api/leads/${encodeURIComponent(leadId)}/activity`, {
    method: "POST",
    body: JSON.stringify({
      stage,
      updates,
      leadEmail,
      allowWithoutWorkshopActivity
    })
  });
}

export function addLeadNote(leadId, text, leadEmail = "") {
  return requestJson(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
    method: "POST",
    body: JSON.stringify({ text, leadEmail })
  });
}

export function deleteLeadNote(leadId, noteIndex, leadEmail = "") {
  const leadEmailQuery = leadEmail ? `?leadEmail=${encodeURIComponent(leadEmail)}` : "";
  return requestJson(
    `/api/leads/${encodeURIComponent(leadId)}/notes/${encodeURIComponent(noteIndex)}${leadEmailQuery}`,
    { method: "DELETE" }
  );
}

export function deleteLeads(leadRefs) {
  return requestJson("/api/leads", {
    method: "DELETE",
    body: JSON.stringify({ leadRefs })
  });
}

export function assignLeads(leadRefs, counselor) {
  return requestJson("/api/leads/assignment", {
    method: "PATCH",
    body: JSON.stringify({ leadRefs, counselor })
  });
}
