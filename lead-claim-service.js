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

export function fetchLeadClaims() {
  return requestJson("/api/lead-claims");
}

export function raiseLeadClaim({ leadId, leadEmail = "", reason }) {
  return requestJson("/api/lead-claims", {
    method: "POST",
    body: JSON.stringify({ leadId, leadEmail, reason })
  });
}

export function decideLeadClaim(claimId, decision, note = "") {
  return requestJson(`/api/lead-claims/${encodeURIComponent(claimId)}/decision`, {
    method: "PATCH",
    body: JSON.stringify({ decision, note })
  });
}
