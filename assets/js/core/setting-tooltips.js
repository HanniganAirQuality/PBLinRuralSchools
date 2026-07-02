const TOOLTIP_MARGIN = 12;
const TOOLTIP_GAP = 8;
let activeTrigger = null;
let activeTooltip = null;

document.addEventListener("pointerover", (event) => {
  const trigger = getTooltipTrigger(event.target);

  if (trigger) {
    showTooltip(trigger);
  }
});

document.addEventListener("pointerout", (event) => {
  if (!activeTrigger || !activeTrigger.contains(event.target)) {
    return;
  }

  if (!(event.relatedTarget instanceof Node) || !activeTrigger.contains(event.relatedTarget)) {
    hideTooltip();
  }
});

document.addEventListener("focusin", (event) => {
  const trigger = getTooltipTrigger(event.target);

  if (trigger) {
    showTooltip(trigger);
  }
});

document.addEventListener("focusout", (event) => {
  if (activeTrigger && activeTrigger.contains(event.target)) {
    hideTooltip();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideTooltip();
  }
});

window.addEventListener("resize", positionActiveTooltip);
window.addEventListener("scroll", positionActiveTooltip, true);

function getTooltipTrigger(target) {
  return target instanceof Element
    ? target.closest(".setting-help[data-help]")
    : null;
}

function showTooltip(trigger) {
  if (activeTrigger === trigger) {
    positionActiveTooltip();
    return;
  }

  hideTooltip();

  const text = trigger.dataset.help?.trim();

  if (!text) {
    return;
  }

  const tooltip = document.createElement("div");
  const tooltipId = `setting-help-${Date.now().toString(36)}`;

  tooltip.id = tooltipId;
  tooltip.className = "setting-help-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.textContent = text;
  document.body.append(tooltip);
  trigger.setAttribute("aria-describedby", tooltipId);

  activeTrigger = trigger;
  activeTooltip = tooltip;
  positionActiveTooltip();
  window.requestAnimationFrame(() => tooltip.classList.add("is-visible"));
}

function hideTooltip() {
  activeTrigger?.removeAttribute("aria-describedby");
  activeTooltip?.remove();
  activeTrigger = null;
  activeTooltip = null;
}

function positionActiveTooltip() {
  if (!activeTrigger || !activeTooltip) {
    return;
  }

  const maxWidth = Math.max(0, window.innerWidth - TOOLTIP_MARGIN * 2);
  activeTooltip.style.maxWidth = `${Math.min(272, maxWidth)}px`;
  activeTooltip.style.left = "0";
  activeTooltip.style.top = "0";

  const triggerRect = activeTrigger.getBoundingClientRect();
  const tooltipRect = activeTooltip.getBoundingClientRect();
  const width = tooltipRect.width;
  const height = tooltipRect.height;
  const centeredLeft = triggerRect.left + triggerRect.width / 2 - width / 2;
  const left = clamp(centeredLeft, TOOLTIP_MARGIN, window.innerWidth - width - TOOLTIP_MARGIN);
  let top = triggerRect.top - height - TOOLTIP_GAP;

  if (top < TOOLTIP_MARGIN) {
    top = triggerRect.bottom + TOOLTIP_GAP;
  }

  top = clamp(top, TOOLTIP_MARGIN, window.innerHeight - height - TOOLTIP_MARGIN);

  activeTooltip.style.left = `${left}px`;
  activeTooltip.style.top = `${top}px`;
}

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
