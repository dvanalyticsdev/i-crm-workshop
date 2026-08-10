import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { bootstrapLocalState, getLeads as getStoredLeads, getSession, refreshState } from "./state-sync.js";
import { acceptTaskList, deleteTask, formatTaskDueDate, getTaskCategoryLabel, getTasksByCategory, TASK_CATEGORY, toTaskDateTimeValue, toTaskDueDateIso, updateTask } from "./task-service.js";
import { openActivityHistory } from "./activity-history.js";

await bootstrapLocalState({ skipStateRefresh: true });

const taskTrackerSectionNav = document.getElementById("taskTrackerSectionNav");
const taskTrackerSubsectionNav = document.getElementById("taskTrackerSubsectionNav");
const taskTrackerActiveTitle = document.getElementById("taskTrackerActiveTitle");
const taskTrackerActiveDescription = document.getElementById("taskTrackerActiveDescription");
const taskTrackerActiveSection = document.getElementById("taskTrackerActiveSection");

const session = getSession();
let taskTrackerCounselors = [];
const TASK_TRACKER_VIEW_STORAGE_KEY = "dv-task-tracker-view";
const TASK_VIEW_CONFIG = {
  workshop: {
    label: "Workshop",
    description: "Track workshop-stage and post-workshop follow-up tasks without stacking both lists on one page.",
    subsections: {
      workshop: {
        label: "Workshop Calling",
        title: "Workshop Calling Tasks",
        description: "Tasks created from workshop-stage leads.",
        category: TASK_CATEGORY.workshop,
        emptyMessage: "No workshop tasks yet."
      },
      admission: {
        label: "Admission Calling",
        title: "Admission Calling Tasks",
        description: "Tasks created from admission-stage leads.",
        category: TASK_CATEGORY.admission,
        emptyMessage: "No admission tasks yet."
      }
    }
  },
  admission: {
    label: "Admission",
    description: "Track direct admission and registered-candidate follow-ups in focused task views.",
    subsections: {
      "main-admission": {
        label: "Main Admission",
        title: "Main Admission Lead Tasks",
        description: "Tasks created from main admission leads.",
        category: TASK_CATEGORY.mainAdmission,
        emptyMessage: "No main admission lead tasks yet."
      },
      registered: {
        label: "Registered Candidates",
        title: "Registered Candidate Tasks",
        description: "Tasks created from registered candidate leads.",
        category: TASK_CATEGORY.registered,
        emptyMessage: "No registered candidate tasks yet."
      }
    }
  }
};
let activeView = loadActiveView();

function getDefaultView() {
  return {
    group: "workshop",
    subsection: "workshop"
  };
}

function loadActiveView() {
  const fallback = getDefaultView();

  try {
    const parsed = JSON.parse(window.localStorage.getItem(TASK_TRACKER_VIEW_STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    const group = String(parsed.group || "").trim();
    const subsection = String(parsed.subsection || "").trim();
    if (!TASK_VIEW_CONFIG[group]?.subsections?.[subsection]) {
      return fallback;
    }

    return { group, subsection };
  } catch (error) {
    return fallback;
  }
}

function persistActiveView() {
  try {
    window.localStorage.setItem(TASK_TRACKER_VIEW_STORAGE_KEY, JSON.stringify(activeView));
  } catch (error) {
    console.warn("Failed to persist task tracker view.", error);
  }
}

function getActiveGroupConfig() {
  return TASK_VIEW_CONFIG[activeView.group] || TASK_VIEW_CONFIG.workshop;
}

function getActiveSubsectionConfig() {
  return getActiveGroupConfig().subsections[activeView.subsection]
    || TASK_VIEW_CONFIG.workshop.subsections.workshop;
}

function isCounselorSession() {
  return session?.role === "counselor";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionName = String(session?.name || "").trim().toLowerCase();
  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = taskTrackerCounselors;
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return String(match?.name || session?.name || "").trim().toLowerCase() || sessionName;
}

async function loadTaskTrackerData() {
  try {
    const response = await fetch(apiUrl("/api/tasks"), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Failed to load tasks.");
    }
    taskTrackerCounselors = Array.isArray(payload?.counselors) ? payload.counselors : [];
    acceptTaskList(payload?.tasks || []);
    return true;
  } catch (error) {
    console.warn("[task-tracker] Scoped task loading failed, falling back to full state:", error?.message || error);
    await refreshState();
    return false;
  }
}

function startTaskTrackerPolling(onRefresh, intervalMs = 15000) {
  let destroyed = false;
  let activePoll = false;

  async function poll() {
    if (destroyed || activePoll || document.visibilityState === "hidden") {
      return;
    }
    activePoll = true;
    try {
      await loadTaskTrackerData();
      await onRefresh();
    } catch (error) {
      console.warn("[task-tracker] polling failed:", error?.message || error);
    } finally {
      activePoll = false;
    }
  }

  const timer = window.setInterval(() => {
    void poll();
  }, intervalMs);
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void poll();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    destroyed = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

function getScopedTasks(tasks) {
  if (!isCounselorSession()) {
    return tasks;
  }

  const counselorName = getCounselorIdentity();
  if (!counselorName) {
    return [];
  }

  return tasks.filter((task) => {
    const leadCounselor = String(task.leadCounselor || "").trim().toLowerCase();
    const taskCounselor = String(task.counselor || "").trim().toLowerCase();
    return leadCounselor === counselorName || taskCounselor === counselorName;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderSectionNav() {
  if (!taskTrackerSectionNav) {
    return;
  }

  const activeGroup = getActiveGroupConfig();
  const groups = Object.entries(TASK_VIEW_CONFIG);

  taskTrackerSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Task Sections</h3>
      <p>Switch between the main task groups instead of keeping every tracker block open at once.</p>
    </div>
    <div class="filter-actions task-tracker-tab-row">
      ${groups.map(([groupKey, group]) => `
        <button
          type="button"
          class="${activeView.group === groupKey ? "btn-primary" : "btn-ghost"}"
          data-task-group="${groupKey}"
        >
          ${escapeHtml(group.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(activeGroup.description)}</p>
  `;

  taskTrackerSectionNav.querySelectorAll("[data-task-group]").forEach((button) => {
    button.onclick = () => {
      const nextGroup = button.getAttribute("data-task-group");
      if (!nextGroup || nextGroup === activeView.group) {
        return;
      }

      activeView = {
        group: nextGroup,
        subsection: Object.keys(TASK_VIEW_CONFIG[nextGroup].subsections)[0]
      };
      persistActiveView();
      renderAll();
    };
  });
}

function renderSubsectionNav() {
  if (!taskTrackerSubsectionNav) {
    return;
  }

  const activeGroup = getActiveGroupConfig();
  const activeSubsection = getActiveSubsectionConfig();
  const subsections = Object.entries(activeGroup.subsections);

  taskTrackerSubsectionNav.innerHTML = `
    <div class="card-head">
      <h3>${escapeHtml(activeGroup.label)} Task Views</h3>
      <p>Open one focused task list at a time so the tracker feels cleaner and faster to scan.</p>
    </div>
    <div class="filter-actions task-tracker-tab-row">
      ${subsections.map(([subsectionKey, subsection]) => `
        <button
          type="button"
          class="${activeView.subsection === subsectionKey ? "btn-primary" : "btn-ghost"}"
          data-task-subsection="${subsectionKey}"
        >
          ${escapeHtml(subsection.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(activeSubsection.description)}</p>
  `;

  taskTrackerSubsectionNav.querySelectorAll("[data-task-subsection]").forEach((button) => {
    button.onclick = () => {
      const nextSubsection = button.getAttribute("data-task-subsection");
      if (!nextSubsection || nextSubsection === activeView.subsection) {
        return;
      }

      activeView = {
        ...activeView,
        subsection: nextSubsection
      };
      persistActiveView();
      renderAll();
    };
  });
}

function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftDate = left.dueDate ? new Date(left.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const rightDate = right.dueDate ? new Date(right.dueDate).getTime() : Number.POSITIVE_INFINITY;
    return leftDate - rightDate || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function showToast(message, isError = false) {
  let container = document.getElementById("dvToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "dvToastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "toast--error" : "toast--success"}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast--fade");
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

function renderTaskTable(tasks, emptyMessage) {
  if (!tasks.length) {
    return `<p class="block-help">${emptyMessage}</p>`;
  }

  return `
    <div class="table-scroll">
      <table class="compact-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Counselor</th>
            <th>Task</th>
            <th>Notes</th>
            <th>Due Date &amp; Time</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tasks
            .map(
              (task) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(task.leadName || "-")}</strong>${task.leadPhone ? `<br /><span class="muted-text">${escapeHtml(task.leadPhone)}</span>` : ""}<br />
                    <span class="muted-text">${escapeHtml(getTaskCategoryLabel(task.category))}</span>
                  </td>
                  <td>${escapeHtml(task.leadCounselor || task.counselor || "Unassigned")}</td>
                  <td>${escapeHtml(task.title || "Follow up")}</td>
                  <td>${escapeHtml(task.notes || "-")}</td>
                  <td>${escapeHtml(formatTaskDueDate(task.dueDate))}</td>
                  <td>
                    <div class="task-actions">
                      <button type="button" class="btn-primary task-complete-btn" data-task-id="${task.id}">Complete</button>
                      <button type="button" class="btn-ghost task-reschedule-btn" data-task-id="${task.id}">Reschedule</button>
                      <button type="button" class="btn-ghost task-remove-btn" data-task-id="${task.id}">Remove</button>
                      <button type="button" class="btn-ghost btn-activity-history" data-lead-id="${escapeHtml(task.leadId)}" data-lead-name="${escapeHtml(task.leadName)}">Activity History</button>
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function completeTask(taskId) {
  const result = await deleteTask(taskId, true);
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to complete task. Please check your connection and try again.", true);
    return;
  }
  renderAll();
}

async function removeTask(taskId) {
  const confirmed = window.confirm("Remove this task from the tracker?");
  if (!confirmed) {
    return;
  }

  const result = await deleteTask(taskId, false);
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to remove task. Please check your connection and try again.", true);
    return;
  }
  renderAll();
}

async function rescheduleTask(taskId) {
  const task = [
    ...getTasksByCategory(TASK_CATEGORY.workshop),
    ...getTasksByCategory(TASK_CATEGORY.admission),
    ...getTasksByCategory(TASK_CATEGORY.registered),
    ...getTasksByCategory(TASK_CATEGORY.mainAdmission)
  ]
    .find((item) => String(item.id) === String(taskId));

  if (!task) {
    return;
  }

  const nextDueDateInput = window.prompt("Enter a new due date/time (YYYY-MM-DDTHH:MM)", toTaskDateTimeValue(task.dueDate));
  const nextDueDate = toTaskDueDateIso(nextDueDateInput);
  if (!nextDueDateInput || !nextDueDate) {
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(nextDueDateInput)) {
    window.alert("Please enter the date and time in YYYY-MM-DDTHH:MM format.");
    return;
  }

  const result = await updateTask(taskId, { dueDate: nextDueDate });
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to reschedule task. Please check your connection and try again.", true);
    return;
  }
  renderAll();
}

function bindTaskActions() {
  document.querySelectorAll(".task-complete-btn").forEach((button) => {
    button.onclick = () => {
      const taskId = button.getAttribute("data-task-id");
      if (taskId) {
        void completeTask(taskId);
      }
    };
  });

  document.querySelectorAll(".task-remove-btn").forEach((button) => {
    button.onclick = () => {
      const taskId = button.getAttribute("data-task-id");
      if (taskId) {
        void removeTask(taskId);
      }
    };
  });

  document.querySelectorAll(".task-reschedule-btn").forEach((button) => {
    button.onclick = () => {
      const taskId = button.getAttribute("data-task-id");
      if (taskId) {
        void rescheduleTask(taskId);
      }
    };
  });

  document.querySelectorAll(".btn-activity-history").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadName = button.getAttribute("data-lead-name");
      const allLeads = getStoredLeads();
      const lead = allLeads.find((item) => String(item.id) === String(leadId));
      if (lead) {
        openActivityHistory(lead.id, lead.name, lead.email);
      } else {
        openActivityHistory(leadId, leadName, "");
      }
    };
  });
}

function renderAll() {
  const activeSubsection = getActiveSubsectionConfig();
  const activeTasks = sortTasks(getScopedTasks(getTasksByCategory(activeSubsection.category)));

  renderSectionNav();
  renderSubsectionNav();
  if (taskTrackerActiveTitle) {
    taskTrackerActiveTitle.textContent = activeSubsection.title;
  }
  if (taskTrackerActiveDescription) {
    taskTrackerActiveDescription.textContent = activeSubsection.description;
  }
  if (taskTrackerActiveSection) {
    taskTrackerActiveSection.innerHTML = renderTaskTable(activeTasks, activeSubsection.emptyMessage);
  }
  bindTaskActions();
}

await loadTaskTrackerData();
renderAll();
window.__dvMarkRouteViewReady?.();
const stopStatePolling = startTaskTrackerPolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
// mainAdmissionTaskSection
