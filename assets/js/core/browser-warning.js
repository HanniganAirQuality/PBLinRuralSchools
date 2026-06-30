export function showSafariLiveViewerWarning() {
  if (!isSafariBrowser() || document.querySelector("[data-browser-warning]")) {
    return;
  }

  const overlay = document.createElement("div");
  const dialog = document.createElement("section");
  const title = document.createElement("h2");
  const message = document.createElement("p");
  const dismiss = document.createElement("button");

  overlay.className = "browser-warning";
  overlay.dataset.browserWarning = "";
  overlay.setAttribute("role", "presentation");

  dialog.className = "browser-warning-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "browser-warning-title");

  title.id = "browser-warning-title";
  title.textContent = "Use Firefox or Chrome";
  message.textContent =
    "The live viewer needs browser serial-port support. Safari does not support this connection, so open this live viewer in Firefox or Chrome.";
  dismiss.type = "button";
  dismiss.textContent = "OK";

  dismiss.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  dialog.append(title, message, dismiss);
  overlay.append(dialog);
  document.body.append(overlay);
  dismiss.focus();
}

function isSafariBrowser() {
  const ua = navigator.userAgent;
  const vendor = navigator.vendor || "";
  return vendor.includes("Apple") &&
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/i.test(ua);
}
