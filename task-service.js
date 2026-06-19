import { apiUrl } from "./api-client.js";
import { acceptServerState, getTasks as getStoredTasks } from "./state-sync.js";

export const TASK_CATEGORY = {
  workshop: "workshop",
  admission: "admission",
  registered: "registered"
};

const CATEGORY_LABELS = {
  [TASK_CATEGORY.workshop]: "Workshop Calling",
  [TASK_CATEGORY.admission]: "Admission Calling",
  [TASK_CATEGORY.registered]: "Registered Candidates"
};

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
    dueDate: String(task.dueDate || "").trim(),
    createdAt,
    updatedAt: task.updatedAt || createdAt
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

export async function deleteTask(taskId) {
  const result = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE"
  });
  if (!result || result.ok === false) {
    return { ok: false, message: result?.message || "Failed to delete task." };
  }
  return { ok: true };
}
