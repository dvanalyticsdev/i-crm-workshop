import { apiUrl } from "./api-client.js";

let currentLeadId = "";
let currentLeadName = "";
let currentLeadEmail = "";
let currentPage = 1;
let totalPages = 1;
let debounceTimeout = null;

const ACTIVITY_ICONS = {
  "Lead Created": "✨",
  "Lead Assigned": "👤",
  "Lead Reassigned": "🔄",
  "Counselor Changed": "🔄",
  "Status Changed": "⚙️",
  "Call Made": "📞",
  "WhatsApp Sent": "💬",
  "Notes Added": "📝",
  "Notes Deleted": "🗑️",
  "Follow-Up Added": "📅",
  "Follow-Up Completed": "✅",
  "Follow-Up Removed": "❌",
  "Course Discussed": "🎓",
  "Lead Converted": "🎉",
  "Lead Closed": "🔒"
};

function getRelativeTime(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function formatDateHeader(dateStr) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }
  
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).split('/').reverse().join('-');
  
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).split('/').reverse().join('-');

  if (dateStr === todayStr) {
    return "Today, " + date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } else if (dateStr === yesterdayStr) {
    return "Yesterday, " + date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isAnsweredCallStatus(value) {
  return /(answer|answered|connected|success|completed)/i.test(String(value || ""));
}

function parseDurationSeconds(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);

  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3] || 0);
  return match[3] ? (first * 3600) + (second * 60) + third : (first * 60) + second;
}

function formatDuration(value) {
  const seconds = parseDurationSeconds(value);
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }
  if (minutes) {
    return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }
  return `${remainingSeconds}s`;
}

function getUsableRecordingUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
  return "";
}

function bindRecordingDurationUpdates(root = document) {
  root.querySelectorAll(".timeline-recording-player").forEach((player) => {
    player.addEventListener("loadedmetadata", () => {
      const duration = Math.round(player.duration || 0);
      if (!Number.isFinite(duration) || duration <= 0) return;
      const durationTarget = root.querySelector(`[data-recording-duration-for="${player.dataset.recordingId}"]`);
      if (durationTarget && !parseDurationSeconds(durationTarget.dataset.durationSeconds)) {
        durationTarget.dataset.durationSeconds = String(duration);
        durationTarget.textContent = `Talk time: ${formatDuration(duration)}`;
        durationTarget.classList.remove("hidden");
      }
    }, { once: true });
  });
}

function renderCallMetadata(log) {
  const metadata = log.callMetadata && typeof log.callMetadata === "object" ? log.callMetadata : {};
  const recordingUrl = getUsableRecordingUrl(log.recordingUrl || metadata.recordingUrl || "");
  const callStatus = String(metadata.callStatus || metadata.normalizedCallStatus || "").trim();
  const duration = parseDurationSeconds(metadata.duration || metadata.talkTimeDuration || "");
  const shouldShowTalkTime = duration || isAnsweredCallStatus(callStatus);
  const recordingId = `recording-${String(log.id || log._id || metadata.callId || Math.random()).replace(/[^a-z0-9_-]/gi, "-")}`;
  const details = [
    metadata.callStatus ? `Status: ${metadata.callStatus}` : "",
    metadata.callDirection ? `Direction: ${metadata.callDirection}` : "",
    metadata.callId ? `Call ID: ${metadata.callId}` : "",
    metadata.agentName ? `Agent: ${metadata.agentName}` : "",
    metadata.agentPhone ? `Agent phone: ${metadata.agentPhone}` : "",
    shouldShowTalkTime && duration ? `Talk time: ${formatDuration(duration)}` : ""
  ].filter(Boolean);

  if (!recordingUrl && !details.length) return "";

  return `
    <div class="timeline-call-details">
      ${details.length ? `<div>${escapeHtml(details.join(" | "))}</div>` : ""}
      ${shouldShowTalkTime && !duration ? `<div class="timeline-talk-time hidden" data-recording-duration-for="${escapeHtml(recordingId)}" data-duration-seconds="">Talk time: loading...</div>` : ""}
      ${recordingUrl ? `
        <div class="timeline-recording-player-wrap">
          <span class="timeline-recording-label">Call Recording</span>
          <audio class="timeline-recording-player" controls preload="metadata" src="${escapeHtml(recordingUrl)}" data-recording-id="${escapeHtml(recordingId)}">
            <a class="timeline-recording-link" href="${escapeHtml(recordingUrl)}" target="_blank" rel="noopener noreferrer">Open recording</a>
          </audio>
        </div>
      ` : ""}
    </div>
  `;
}

function ensureModalInDom() {
  if (document.getElementById("activityHistoryModal")) {
    return;
  }

  const modalHtml = `
    <div id="activityHistoryModal" class="modal hidden">
      <div class="modal-content card timeline-modal">
        <div class="modal-header">
          <h3>Activity History &mdash; <span id="historyLeadName"></span></h3>
          <button type="button" id="closeHistoryModalBtn" class="close-btn" aria-label="Close modal">&times;</button>
        </div>
        
        <div class="timeline-filters">
          <div class="filter-item">
            <label for="historyFilterType">Activity Type</label>
            <select id="historyFilterType">
              <option value="">All Types</option>
              <option value="Lead Created">Lead Created</option>
              <option value="Lead Assigned">Lead Assigned</option>
              <option value="Lead Reassigned">Lead Reassigned</option>
              <option value="Counselor Changed">Counselor Changed</option>
              <option value="Status Changed">Status Changed</option>
              <option value="Call Made">Call Made</option>
              <option value="WhatsApp Sent">WhatsApp Sent</option>
              <option value="Notes Added">Notes Added</option>
              <option value="Notes Deleted">Notes Deleted</option>
              <option value="Follow-Up Added">Follow-Up Added</option>
              <option value="Follow-Up Completed">Follow-Up Completed</option>
              <option value="Follow-Up Removed">Follow-Up Removed</option>
              <option value="Course Discussed">Course Discussed</option>
              <option value="Lead Converted">Lead Converted</option>
              <option value="Lead Closed">Lead Closed</option>
            </select>
          </div>
          <div class="filter-item">
            <label for="historyFilterStartDate">Start Date</label>
            <input type="date" id="historyFilterStartDate" />
          </div>
          <div class="filter-item">
            <label for="historyFilterEndDate">End Date</label>
            <input type="date" id="historyFilterEndDate" />
          </div>
          <div class="filter-item">
            <label for="historyFilterUser">User</label>
            <input type="text" id="historyFilterUser" placeholder="User name..." />
          </div>
          <div class="filter-item search-item">
            <label for="historySearchInput">Search</label>
            <input type="text" id="historySearchInput" placeholder="Search description..." />
          </div>
        </div>
        
        <div class="timeline-container">
          <div id="timelineLoadingState" class="timeline-status-message hidden">
            <span class="spinner"></span> Loading activity history...
          </div>
          <div id="timelineEmptyState" class="timeline-status-message hidden">
             No activities match your filters.
          </div>
          <div id="timelineContent" class="timeline-track"></div>
        </div>
        
        <div class="modal-footer timeline-footer">
          <div class="pagination-controls">
            <button type="button" id="prevHistoryPageBtn" class="btn-ghost">Prev</button>
            <span id="historyPageNum">Page 1 of 1</span>
            <button type="button" id="nextHistoryPageBtn" class="btn-ghost">Next</button>
          </div>
          <button type="button" id="closeHistoryModalBtn2" class="btn-primary">Close</button>
        </div>
      </div>
    </div>
  `;

  const div = document.createElement("div");
  div.innerHTML = modalHtml;
  document.body.appendChild(div.firstElementChild);

  // Bind close events
  document.getElementById("closeHistoryModalBtn").onclick = closeHistoryModal;
  document.getElementById("closeHistoryModalBtn2").onclick = closeHistoryModal;

  // Bind filter events
  document.getElementById("historyFilterType").onchange = triggerRefresh;
  document.getElementById("historyFilterStartDate").onchange = triggerRefresh;
  document.getElementById("historyFilterEndDate").onchange = triggerRefresh;
  
  document.getElementById("historyFilterUser").onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    triggerRefresh();
  };
  
  document.getElementById("historySearchInput").onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    triggerRefresh();
  };

  // Bind pagination
  document.getElementById("prevHistoryPageBtn").onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      fetchActivityLogs();
    }
  };

  document.getElementById("nextHistoryPageBtn").onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      fetchActivityLogs();
    }
  };
}

function triggerRefresh() {
  currentPage = 1;
  fetchActivityLogs();
}

function closeHistoryModal() {
  document.getElementById("activityHistoryModal").classList.add("hidden");
}

async function fetchActivityLogs() {
  const loading = document.getElementById("timelineLoadingState");
  const empty = document.getElementById("timelineEmptyState");
  const content = document.getElementById("timelineContent");
  
  loading.classList.remove("hidden");
  empty.classList.add("hidden");
  content.innerHTML = "";

  const type = document.getElementById("historyFilterType").value;
  const start = document.getElementById("historyFilterStartDate").value;
  const end = document.getElementById("historyFilterEndDate").value;
  const user = document.getElementById("historyFilterUser").value;
  const search = document.getElementById("historySearchInput").value;

  let query = `?leadId=${encodeURIComponent(currentLeadId)}&page=${currentPage}&limit=10`;
  if (type) query += `&activityType=${encodeURIComponent(type)}`;
  if (start) query += `&startDate=${encodeURIComponent(start)}`;
  if (end) query += `&endDate=${encodeURIComponent(end)}`;
  if (user) query += `&performedBy=${encodeURIComponent(user)}`;
  if (search) query += `&search=${encodeURIComponent(search)}`;

  try {
    const response = await fetch(apiUrl("/api/activity-logs" + query), {
      credentials: "same-origin"
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Failed to load logs");
    }

    const data = await response.json();
    loading.classList.add("hidden");
    
    totalPages = data.totalPages || 1;
    document.getElementById("historyPageNum").textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById("prevHistoryPageBtn").disabled = currentPage === 1;
    document.getElementById("nextHistoryPageBtn").disabled = currentPage === totalPages;

    const logs = data.logs || [];
    if (!logs.length) {
      empty.classList.remove("hidden");
      return;
    }

    // Group logs by date string
    const groups = {};
    logs.forEach(log => {
      const dateKey = log.date;
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(log);
    });

    let html = "";
    Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(dateKey => {
      html += `
        <div class="timeline-date-group">
          <div class="timeline-date-header">${escapeHtml(formatDateHeader(dateKey))}</div>
      `;

      groups[dateKey].forEach(log => {
        const icon = ACTIVITY_ICONS[log.activityType] || "📌";
        const relativeTime = getRelativeTime(log.timestamp);
        
        let remarksHtml = "";
        if (log.remarks) {
          remarksHtml = `<div class="timeline-remarks">${escapeHtml(log.remarks)}</div>`;
        }
        const callMetadataHtml = renderCallMetadata(log);

        // Color coding for different activity types
        let typeClass = "timeline-type-default";
        if (log.activityType === "Lead Converted") typeClass = "timeline-type-success";
        else if (log.activityType === "Lead Closed" || log.activityType === "Follow-Up Removed" || log.activityType === "Notes Deleted") typeClass = "timeline-type-danger";
        else if (log.activityType === "Call Made" || log.activityType === "WhatsApp Sent") typeClass = "timeline-type-comm";
        else if (log.activityType === "Follow-Up Added" || log.activityType === "Follow-Up Completed") typeClass = "timeline-type-task";
        else if (log.activityType === "Notes Added") typeClass = "timeline-type-note";
        else if (log.activityType === "Lead Created") typeClass = "timeline-type-create";
        else if (log.activityType === "Lead Assigned" || log.activityType === "Lead Reassigned" || log.activityType === "Counselor Changed") typeClass = "timeline-type-assign";

        html += `
          <div class="timeline-item">
            <div class="timeline-badge ${typeClass}" title="${escapeHtml(log.activityType)}">
              ${icon}
            </div>
            <div class="timeline-card">
              <div class="timeline-card-header">
                <span class="timeline-card-title">${escapeHtml(log.actionDescription)}</span>
                ${log.activityType === "Follow-Up Completed" ? `<span class="badge badge-success">Completed</span>` : ""}
              </div>
              
              <div class="timeline-metadata">
                <span>By: <strong>${escapeHtml(log.performedBy)}</strong> (${escapeHtml(log.userRole)})</span>
                <span>&bull;</span>
                <span title="${escapeHtml(new Date(log.timestamp).toLocaleString())}">${escapeHtml(log.time)} | ${escapeHtml(relativeTime)}</span>
              </div>
              
              ${log.previousValue || log.newValue ? `
                <div class="timeline-diff-block">
                  ${log.previousValue ? `<div><span class="diff-label">Previous:</span> <span class="diff-val">${escapeHtml(log.previousValue)}</span></div>` : ""}
                  ${log.newValue ? `<div><span class="diff-label">New:</span> <span class="diff-val">${escapeHtml(log.newValue)}</span></div>` : ""}
                </div>
              ` : ""}
              
              ${remarksHtml}
              ${callMetadataHtml}
            </div>
          </div>
        `;
      });

      html += `</div>`;
    });

    content.innerHTML = html;
    bindRecordingDurationUpdates(content);
  } catch (error) {
    loading.classList.add("hidden");
    content.innerHTML = `<div class="timeline-status-message text-danger">⚠️ Error loading activity history: ${escapeHtml(error.message)}</div>`;
  }
}

export function openActivityHistory(leadId, leadName, leadEmail = "") {
  ensureModalInDom();

  currentLeadId = leadId;
  currentLeadName = leadName;
  currentLeadEmail = leadEmail;
  currentPage = 1;

  document.getElementById("historyLeadName").textContent = leadName;
  
  // Reset filters
  document.getElementById("historyFilterType").value = "";
  document.getElementById("historyFilterStartDate").value = "";
  document.getElementById("historyFilterEndDate").value = "";
  document.getElementById("historyFilterUser").value = "";
  document.getElementById("historySearchInput").value = "";

  // Show Modal
  document.getElementById("activityHistoryModal").classList.remove("hidden");

  // Fetch
  fetchActivityLogs();
}
