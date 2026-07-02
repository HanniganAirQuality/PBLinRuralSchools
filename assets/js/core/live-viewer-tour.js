const TOUR_DISMISSED_VALUE = "dismissed";

initLiveViewerTour();

export function showLiveViewerTourPrompt({
  storageKey,
  connectSelector,
  chartSelector,
  connectText = "Use Connect to choose the serial device for your YPOD.",
  chartText = "The graph area updates live. Drag plots to reorder them, or drop one plot onto another to combine graphs.",
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
      steps: [
        {
          selector: connectSelector,
          title: "Connect your YPOD",
          text: connectText,
        },
        {
          selector: chartSelector,
          title: "Arrange the graphs",
          text: chartText,
        },
      ],
    });
  });
}

function initLiveViewerTour() {
  const aqiqViewer = document.querySelector("[data-live-viewer]");
  const fireViewer = document.querySelector("[data-fire-iq-live-viewer]");

  if (aqiqViewer) {
    showLiveViewerTourPrompt({
      storageKey: "haq-aqiq-live-viewer-tour",
      connectSelector: "[data-connect]",
      chartSelector: ".chart-grid",
      connectText: "Use Connect to choose the serial device for your YPOD.",
      chartText: "The graph area updates live. Drag plots to reorder them, or drop one plot onto another to combine graphs.",
    });
  }

  if (fireViewer) {
    showLiveViewerTourPrompt({
      storageKey: "haq-fireiq-live-viewer-tour",
      connectSelector: "[data-connect-pod]",
      chartSelector: ".chart-grid",
      connectText: "Use Connect to choose the serial device for a YPOD. Fire-IQ can connect two pods at once.",
      chartText: "The graph area updates live for both pods. Use the plot toggles to choose which shared graphs are visible.",
    });
  }
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
  title.textContent = "Want a quick tour?";
  message.textContent = "Walk through the live viewer controls and graph area before you connect.";

  remember.type = "checkbox";
  remember.dataset.liveTourRemember = "";
  rememberLabel.className = "live-tour-remember";
  rememberLabel.append(remember, document.createTextNode("Do not show this again"));

  start.type = "button";
  start.className = "primary-action";
  start.textContent = "Start tour";
  skip.type = "button";
  skip.textContent = "Skip";

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

  highlight.className = "live-tour-highlight";
  card.className = "live-tour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-live", "polite");
  count.className = "live-tour-count";
  next.type = "button";
  next.className = "primary-action";
  close.type = "button";
  close.textContent = "Close";
  actions.className = "live-tour-actions";
  actions.append(next, close);
  card.append(count, title, text, actions);
  overlay.append(highlight, card);
  document.body.append(overlay);

  function endTour() {
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
    count.textContent = `Step ${index + 1} of ${availableSteps.length}`;
    next.textContent = index === availableSteps.length - 1 ? "Done" : "Next";

    positionTourCard(card, highlightRect);
  }

  function showStep(nextIndex) {
    index = nextIndex;
    availableSteps[index].target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    window.setTimeout(renderStep, 180);
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
