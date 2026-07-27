const BUTTON_BUSY_TEXT = "Please wait...";

export function setButtonBusy(button, isBusy, busyText = BUTTON_BUSY_TEXT) {
  if (!button) {
    return () => {};
  }

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent || "";
  }

  button.disabled = Boolean(isBusy);
  button.setAttribute("aria-busy", String(Boolean(isBusy)));
  button.classList.toggle("is-loading", Boolean(isBusy));
  button.textContent = isBusy ? busyText : button.dataset.originalText;

  return () => {
    button.disabled = false;
    button.setAttribute("aria-busy", "false");
    button.classList.remove("is-loading");
    button.textContent = button.dataset.originalText || "";
  };
}

export async function withButtonBusy(button, busyText, action) {
  if (button?.disabled) {
    return undefined;
  }

  const restore = setButtonBusy(button, true, busyText);
  try {
    return await action();
  } finally {
    restore();
  }
}

export function createRenderScheduler(render, delayMs = 80) {
  let timer = null;
  let pendingPromise = null;

  return function scheduleRender() {
    if (timer) {
      clearTimeout(timer);
    }

    pendingPromise = new Promise((resolve) => {
      timer = setTimeout(async () => {
        timer = null;
        try {
          resolve(await render());
        } catch (error) {
          console.error("[ui-feedback] scheduled render failed:", error);
          resolve(undefined);
        }
      }, delayMs);
    });

    return pendingPromise;
  };
}
