import { registerPageCleanup } from "./page-runtime.js";
import { bootstrapLocalState, getCounselors, getLeads as getStoredLeads, getSession, startStatePolling } from "./state-sync.js";
import { deleteTask, getTaskCategoryLabel, getTasksByCategory, TASK_CATEGORY, updateTask } from "./task-service.js";
import { openActivityHistory } from "./activity-history.js";

await bootstrapLocalState();

const workshopTaskSection = document.getElementById("workshopTaskSection");
const admissionTaskSection = document.getElementById("admissionTaskSection");
const registeredTaskSection = document.getElementById("registeredTaskSection");

const session = getSession();

function isCounselorSession() {
  return session?.role === "counselor";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionName = String(session?.name || "").trim().toLowerCase();
  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = getCounselors();
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return String(match?.name || session?.name || "").trim().toLowerCase() || sessionName;
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

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
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
            <th>Due Date</th>
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
                  <td>${escapeHtml(formatDate(task.dueDate))}</td>
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
    ...getTasksByCategory(TASK_CATEGORY.registered)
  ]
    .find((item) => String(item.id) === String(taskId));

  if (!task) {
    return;
  }

  const nextDueDate = window.prompt("Enter a new due date (YYYY-MM-DD)", task.dueDate || "");
  if (!nextDueDate) {
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)) {
    window.alert("Please enter the date in YYYY-MM-DD format.");
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
  const workshopTasks = sortTasks(getScopedTasks(getTasksByCategory(TASK_CATEGORY.workshop)));
  const admissionTasks = sortTasks(getScopedTasks(getTasksByCategory(TASK_CATEGORY.admission)));
  const registeredTasks = sortTasks(getScopedTasks(getTasksByCategory(TASK_CATEGORY.registered)));

  workshopTaskSection.innerHTML = renderTaskTable(workshopTasks, "No workshop tasks yet.");
  admissionTaskSection.innerHTML = renderTaskTable(admissionTasks, "No admission tasks yet.");
  registeredTaskSection.innerHTML = renderTaskTable(registeredTasks, "No registered candidate tasks yet.");
  bindTaskActions();
}

renderAll();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
