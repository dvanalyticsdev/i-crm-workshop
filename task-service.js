import { apiUrl } from "./api-client.js";
import { acceptServerState, getTasks as getStoredTasks } from "./state-sync.js";

export const TASK_CATEGORY = {
  workshop: "workshop",
  admission: "admission",
  registered: "registered",
  mainAdmission: "main-admission"
};

const CATEGORY_LABELS = {
  [TASK_CATEGORY.workshop]: "Workshop Calling",
  [TASK_CATEGORY.admission]: "Admission Calling",
  [TASK_CATEGORY.registered]: "Registered Candidates",
  [TASK_CATEGORY.mainAdmission]: "Main Admission Leads"
};

function parseTaskDueDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsedDateOnly = new Date(`${raw}T09:00`);
    return Number.isNaN(parsedDateOnly.getTime()) ? null : parsedDateOnly;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toTaskDateTimeValue(value) {
  const parsed = parseTaskDueDate(value);
  if (!parsed) {
    return "";
  }

  const pad = (part) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function toTaskDueDateIso(value) {
  const parsed = parseTaskDueDate(value);
  return parsed ? parsed.toISOString() : "";
}

export function formatTaskDueDate(value) {
  const parsed = parseTaskDueDate(value);
  if (!parsed) {
    return value || "-";
  }

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createTaskId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `task-${crypto.randomUUID()}`;
  }

  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTask(task = {}) {
  const category = task.category === TASK_CATEGORY.admission
    ? TASK_CATEGORY.admission
    : task.category === TASK_CATEGORY.registered
      ? TASK_CATEGORY.registered
      : task.category === TASK_CATEGORY.mainAdmission
        ? TASK_CATEGORY.mainAdmission
        : TASK_CATEGORY.workshop;
  const createdAt = task.createdAt || new Date().toISOString();

  return {
    id: String(task.id || createTaskId()),
    leadId: String(task.leadId || ""),
    leadName: String(task.leadName || "").trim(),
    leadPhone: String(task.leadPhone || "").trim(),
    leadCounselor: String(task.leadCounselor || "").trim(),
    counselor: String(task.counselor || "").trim(),
    category,
    title: String(task.title || "Follow up").trim(),
    notes: String(task.notes || "").trim(),
    dueDate: toTaskDueDateIso(task.dueDate) || String(task.dueDate || "").trim(),
    createdAt,
    updatedAt: task.updatedAt || createdAt,
    reminderSentAt: task.reminderSentAt || null
  };
}

export function getTasks() {
  const tasks = getStoredTasks();
  return tasks.map((task) => normalizeTask(task));
}

export function getTasksByCategory(category) {
  return getTasks().filter((task) => task.category === category);
}

export function getTaskCategoryLabel(category) {
  return CATEGORY_LABELS[category] || "Task";
}

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
    return { ok: false, message: payload?.message || "Task request failed." };
  }

  return { ok: true, ...payload };
}

export async function createTask(taskInput) {
  const nextTask = normalizeTask(taskInput);
  const result = await requestJson("/api/tasks", {
    method: "POST",
    body: JSON.stringify(nextTask)
  });
  if (!result || result.ok === false) {
    return { ok: false, message: result?.message || "Failed to save task." };
  }
  return { ok: true, task: result.task || nextTask };
}

export async function updateTask(taskId, updates) {
  const tasks = getTasks();
  const index = tasks.findIndex((task) => String(task.id) === String(taskId));
  if (index === -1) {
    return { ok: false, message: "Task not found." };
  }

  const updatedTask = normalizeTask({
    ...tasks[index],
    ...updates,
    updatedAt: new Date().toISOString()
  });

  const result = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(updatedTask)
  });
  if (!result || result.ok === false) {
    return { ok: false, message: result?.message || "Failed to update task." };
  }
  return { ok: true, task: result.task || updatedTask };
}

export async function deleteTask(taskId, completed = false) {
  const query = completed ? "?completed=true" : "";
  const result = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}${query}`, {
    method: "DELETE"
  });
  if (!result || result.ok === false) {
    return { ok: false, message: result?.message || "Failed to delete task." };
  }
  return { ok: true };
}
