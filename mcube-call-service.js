import { apiUrl } from "./api-client.js";

export async function triggerMcubeClickToCall(lead, button, notify = () => {}) {
  const leadId = String(lead?.id || "").trim();
  const phone = String(lead?.phone || "").trim();
  const leadName = String(lead?.name || "").trim();

  if (!phone) {
    notify("This lead does not have a phone number.", true);
    return null;
  }

  const previousText = button?.textContent || "Call";
  if (button) {
    button.disabled = true;
    button.textContent = "Calling...";
  }

  try {
    const response = await fetch(apiUrl("/api/mcube/click-to-call"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, phone, leadName })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || payload?.details || `HTTP ${response.status}`);
    }
    notify(`Calling ${leadName || phone} through MCUBE.`, false);
    return payload;
  } catch (error) {
    notify(`Call failed: ${error.message}`, true);
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}
