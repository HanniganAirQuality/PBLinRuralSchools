import { initializeI18n, t } from "./i18n.js";

const TOUR_DISMISSED_VALUE = "dismissed";
let activeTourConfig = null;

await initializeI18n();
initLiveViewerTour();
document.addEventListener("haq-restart-live-tour", restartLiveViewerTour);

export function showLiveViewerTourPrompt({
  storageKey,
  setupSelector = ".live-controls",
  connectSelector,
  chartSelector,
  setupText = t("liveViewer.tour.setupPod", { podName: "pod" }),
  connectText = t("liveViewer.tour.connectPod", { podName: "pod" }),
  chartText = t("liveViewer.tour.graphsSingle"),
} = {}) {
  if (!storageKey || isTourDismissed(storageKey) || document.querySelector("[data-live-tour]")) {
    return;
  }

  waitForBrowserWarningDismissal(() => {
    if (isTourDismissed(storageKey) || document.querySelector("[data-live-tour]")) {
      return;
    }

    showTourPrompt({
      storageKey,
      steps: makeTourSteps({ setupSelector, connectSelector, chartSelector, setupText, connectText, chartText }),
    });
  });
}

function initLiveViewerTour() {
  const aqiqViewer = document.querySelector("[data-live-viewer]");
  const fireViewer = document.querySelector("[data-fire-iq-live-viewer]");

  if (fireViewer) {
    activeTourConfig = {
      storageKey: "haq-fireiq-live-viewer-tour",
      setupSelector: ".live-controls",
      connectSelector: "[data-connect-pod]",
      chartSelector: ".chart-grid",
      setupText: t("liveViewer.tour.setupFireIq"),
      connectText: t("liveViewer.tour.connectFireIqRequired"),
      chartText: t("liveViewer.tour.graphsFireIq"),
    };
  } else if (aqiqViewer) {
    const isSqiq = document.body.classList.contains("theme-sqiq");
    const podName = isSqiq ? "SPOD" : "YPOD";
    activeTourConfig = {
      storageKey: `haq-${isSqiq ? "sqiq" : "aqiq"}-live-viewer-tour`,
      setupSelector: ".live-controls",
      connectSelector: "[data-connect]",
      chartSelector: ".chart-grid",
      setupText: t("liveViewer.tour.setupPod", { podName }),
      connectText: t("liveViewer.tour.connectPod", { podName }),
      chartText: t("liveViewer.tour.graphsSingle"),
    };
  }

  if (activeTourConfig) {
    showLiveViewerTourPrompt(activeTourConfig);
  }
}

function restartLiveViewerTour() {
  if (!activeTourConfig) {
    return;
  }

  document.querySelector("[data-live-tour]")?.remove();
  waitForBrowserWarningDismissal(() => {
    startTour({
      storageKey: activeTourConfig.storageKey,
      steps: makeTourSteps(activeTourConfig),
    });
  });
}

function makeTourSteps({ setupSelector, connectSelector, chartSelector, setupText, connectText, chartText }) {
  return [
    { selector: setupSelector, title: t("liveViewer.tour.plugInPodTitle"), text: setupText },
    { selector: connectSelector, title: t("liveViewer.tour.clickConnectTitle"), text: connectText, advanceOnTargetClick: true },
    { selector: chartSelector, title: t("liveViewer.arrangeTheGraphs"), text: chartText },
  ];
}

function showTourPrompt({ storageKey, steps }) {
  const overlay = makeOverlay();
  const dialog = document.createElement("section");
  const title = document.createElement("h2");
  const message = document.createElement("p");
  const actions = document.createElement("div");
  const start = document.createElement("button");
  const skip = document.createElement("button");
  const rememberLabel = document.createElement("label");
  const remember = document.createElement("input");

  dialog.className = "live-tour-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "live-tour-title");

  title.id = "live-tour-title";
  title.textContent = t("liveViewer.wantAQuickTour");
  message.textContent = t("liveViewer.tour.promptMessage");

  remember.type = "checkbox";
  remember.dataset.liveTourRemember = "";
  rememberLabel.className = "live-tour-remember";
  rememberLabel.append(remember, document.createTextNode(t("liveViewer.doNotShowThisAgain")));

  start.type = "button";
  start.className = "primary-action";
  start.textContent = t("liveViewer.startTour");
  skip.type = "button";
  skip.textContent = t("liveViewer.skip");

  start.addEventListener("click", () => {
    if (remember.checked) {
      dismissTour(storageKey);
    }

    overlay.remove();
    startTour({ storageKey, steps });
  });

  skip.addEventListener("click", () => {
    if (remember.checked) {
      dismissTour(storageKey);
    }

    overlay.remove();
  });

  actions.className = "live-tour-actions";
  actions.append(start, skip);
  dialog.append(title, message, rememberLabel, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  start.focus();
}

function startTour({ storageKey, steps }) {
  const availableSteps = steps
    .map((step) => ({ ...step, target: document.querySelector(step.selector) }))
    .filter((step) => step.target);

  if (availableSteps.length === 0) {
    return;
  }

  const overlay = makeOverlay("live-tour-overlay");
  const highlight = document.createElement("div");
  const card = document.createElement("section");
  const title = document.createElement("h2");
  const text = document.createElement("p");
  const count = document.createElement("span");
  const actions = document.createElement("div");
  const next = document.createElement("button");
  const close = document.createElement("button");
  let index = 0;
  let actionTarget = null;

  highlight.className = "live-tour-highlight";
  card.className = "live-tour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-live", "polite");
  count.className = "live-tour-count";
  next.type = "button";
  next.className = "primary-action";
  close.type = "button";
  close.textContent = t("liveViewer.close");
  actions.className = "live-tour-actions";
  actions.append(next, close);
  card.append(count, title, text, actions);
  overlay.append(highlight, card);
  document.body.append(overlay);

  function endTour() {
    clearTargetAction();
    overlay.remove();
    window.removeEventListener("resize", renderStep);
    window.removeEventListener("scroll", renderStep, true);
  }

  function renderStep() {
    const step = availableSteps[index];
    const rect = step.target.getBoundingClientRect();
    const gap = 12;
    const highlightRect = {
      top: Math.max(gap, rect.top - gap),
      left: Math.max(gap, rect.left - gap),
      width: Math.min(window.innerWidth - gap * 2, rect.width + gap * 2),
      height: Math.min(window.innerHeight - gap * 2, rect.height + gap * 2),
    };

    highlight.style.top = `${highlightRect.top}px`;
    highlight.style.left = `${highlightRect.left}px`;
    highlight.style.width = `${highlightRect.width}px`;
    highlight.style.height = `${highlightRect.height}px`;

    title.textContent = step.title;
    text.textContent = step.text;
    count.textContent = t("liveViewer.tour.stepProgressSimple", { current: index + 1, total: availableSteps.length });
    next.disabled = Boolean(step.advanceOnTargetClick);
    next.textContent = step.advanceOnTargetClick
      ? t("liveViewer.tour.clickConnectAction")
      : index === availableSteps.length - 1 ? t("liveViewer.done") : t("liveViewer.next");

    positionTourCard(card, highlightRect);
  }

  function showStep(nextIndex) {
    clearTargetAction();
    index = nextIndex;
    const step = availableSteps[index];
    step.target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });

    if (step.advanceOnTargetClick) {
      actionTarget = step.target;
      actionTarget.addEventListener("click", handleTargetAction, { once: true });
    }

    window.setTimeout(renderStep, 180);
  }

  function handleTargetAction() {
    actionTarget = null;
    window.setTimeout(() => {
      if (index < availableSteps.length - 1) {
        showStep(index + 1);
      }
    }, 0);
  }

  function clearTargetAction() {
    actionTarget?.removeEventListener("click", handleTargetAction);
    actionTarget = null;
  }

  next.addEventListener("click", () => {
    if (index >= availableSteps.length - 1) {
      dismissTour(storageKey);
      endTour();
      return;
    }

    showStep(index + 1);
  });

  close.addEventListener("click", endTour);
  window.addEventListener("resize", renderStep);
  window.addEventListener("scroll", renderStep, true);
  showStep(0);
  next.focus();
}

function positionTourCard(card, highlightRect) {
  const gap = 14;
  const cardWidth = Math.min(360, window.innerWidth - gap * 2);
  const cardHeight = card.offsetHeight || 170;
  let top = highlightRect.top + highlightRect.height + gap;
  let left = Math.min(
    window.innerWidth - cardWidth - gap,
    Math.max(gap, highlightRect.left + highlightRect.width / 2 - cardWidth / 2),
  );

  if (top + cardHeight > window.innerHeight - gap) {
    top = highlightRect.top - cardHeight - gap;
  }

  if (top < gap) {
    top = gap;
  }

  card.style.width = `${cardWidth}px`;
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

function makeOverlay(extraClass = "") {
  const overlay = document.createElement("div");
  overlay.className = ["live-tour", extraClass].filter(Boolean).join(" ");
  overlay.dataset.liveTour = "";
  overlay.setAttribute("role", "presentation");
  return overlay;
}

function waitForBrowserWarningDismissal(callback) {
  if (!document.querySelector("[data-browser-warning]")) {
    callback();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!document.querySelector("[data-browser-warning]")) {
      observer.disconnect();
      callback();
    }
  });

  observer.observe(document.body, { childList: true });
}

function isTourDismissed(storageKey) {
  try {
    return window.localStorage?.getItem(storageKey) === TOUR_DISMISSED_VALUE;
  } catch {
    return false;
  }
}

function dismissTour(storageKey) {
  try {
    window.localStorage?.setItem(storageKey, TOUR_DISMISSED_VALUE);
  } catch {
    // Storage can be unavailable in private or restricted browsing modes.
  }
}
