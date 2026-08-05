import { apiUrl } from "./api-client.js";
import { acceptLeadUpdates, acceptServerState, broadcastLeadUpdates } from "./state-sync.js";

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
  } else if (payload?.lead || Array.isArray(payload?.leads)) {
    const leadUpdates = payload.lead || payload.leads;
    const etag = response.headers.get("etag");
    const updatedAt = payload?.updatedAt || null;
    acceptLeadUpdates(leadUpdates, etag, updatedAt);
    broadcastLeadUpdates(leadUpdates, etag, updatedAt);
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

export function updateMainAdmissionLeadDetails(leadId, { leadEmail = "", fields = {}, extraFields = {} }) {
  return requestJson(`/api/main-admission-leads/${encodeURIComponent(leadId)}/details`, {
    method: "PATCH",
    body: JSON.stringify({
      leadEmail,
      fields,
      extraFields
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

export function takeSopLead(leadId, leadEmail = "") {
  return requestJson(`/api/leads/${encodeURIComponent(leadId)}/take-sop`, {
    method: "POST",
    body: JSON.stringify({ leadEmail })
  });
}

export function formatLeadAssignmentResult(result, requestedCount, counselor) {
  const assignedCount = Number(
    result?.assignedCount
      ?? result?.matchedCount
      ?? result?.updatedCount
      ?? requestedCount
  ) || 0;
  const skippedProtectedCount = Number(result?.skippedProtectedCount || 0);
  const skippedInterestedCount = Number(result?.skippedInterestedCount || 0);
  const skippedBlockedSameCounselorCount = Number(result?.skippedBlockedSameCounselorCount || 0);
  const assignedLabel = assignedCount === 1 ? "lead" : "leads";
  const interestedLabel = skippedInterestedCount === 1 ? "lead" : "leads";
  const skippedLabel = skippedProtectedCount === 1 ? "lead" : "leads";
  const blockedSameCounselorLabel = skippedBlockedSameCounselorCount === 1 ? "lead" : "leads";
  const interestedText = skippedInterestedCount
    ? ` Skipped ${skippedInterestedCount} workshop ${interestedLabel} with Course Status marked Interested.`
    : "";
  const skippedText = skippedProtectedCount
    ? ` Skipped ${skippedProtectedCount} admission ${skippedLabel} with status In-Conversation, Enrolled, or Won.`
    : "";
  const blockedSameCounselorText = skippedBlockedSameCounselorCount
    ? ` Skipped ${skippedBlockedSameCounselorCount} blocked admission ${blockedSameCounselorLabel} because they cannot be reassigned to the same counselor again.`
    : "";

  return {
    assignedCount,
    skippedProtectedCount,
    skippedInterestedCount,
    skippedBlockedSameCounselorCount,
    message: `Assigned ${assignedCount} ${assignedLabel} to ${counselor}.${interestedText}${skippedText}${blockedSameCounselorText}`
  };
}

export function trackLeadView(leadId, leadEmail = "") {
  return requestJson(`/api/leads/${encodeURIComponent(leadId)}/view`, {
    method: "POST",
    body: JSON.stringify({ leadEmail })
  });
}

export function getLeadIdsByActivityTypes(activityTypes = []) {
  const types = Array.isArray(activityTypes)
    ? activityTypes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const query = types.length
    ? `?activityTypes=${encodeURIComponent(types.join(","))}`
    : "";

  return requestJson(`/api/activity-history/lead-ids${query}`, {
    method: "GET"
  });
}
