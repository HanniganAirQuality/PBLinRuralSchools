export function mountPlaceholder(kind) {
  const root = document.querySelector("[data-tool-placeholder]");

  if (!root) {
    return;
  }

  const status = root.querySelector("[data-placeholder-status]");
  const program = root.dataset.program || "Program";
  const toolName = root.dataset.toolName || kind;

  if (status) {
    status.textContent = `${program} ${toolName} placeholder module loaded.`;
  }

  root.dataset.placeholderReady = "true";
}
