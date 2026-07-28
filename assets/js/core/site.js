import { initializeI18n, t } from "./i18n.js";

const THEME_STORAGE_KEY = "haq-color-theme";

initializeTheme();

const yearTarget = document.querySelector("[data-current-year]");

if (yearTarget) {
  yearTarget.textContent = String(new Date().getFullYear());
}

document.documentElement.dataset.js = "ready";

initializeSite();

async function initializeSite() {
  await initializeI18n();
  mountHeaderControls();
}

function initializeTheme() {
  const savedTheme = readStoredTheme();
  const theme = savedTheme || (window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light");
  applyTheme(theme, { persist: false, announce: false });
}

function mountHeaderControls() {
  const header = document.querySelector(".site-header");

  if (!header) {
    return;
  }

  let controls = header.querySelector(".site-nav");

  if (!controls) {
    controls = document.createElement("nav");
    controls.className = "site-nav";
    controls.setAttribute("aria-label", t("common.navigation.siteControls"));
    header.append(controls);
  }

  if (document.querySelector(".chart-grid")) {
    controls.append(makeHeaderButton(t("common.actions.scrollToGraphs"), "scroll-to-graphs", scrollToGraphs));
  }

  if (document.querySelector("[data-live-viewer], [data-fire-iq-live-viewer]")) {
    controls.append(makeHeaderButton(t("common.actions.redoWalkthrough"), "redo-walkthrough", () => {
      document.dispatchEvent(new CustomEvent("haq-restart-live-tour"));
    }));
  }

  const themeButton = makeHeaderButton("", "theme-toggle", toggleTheme);
  controls.append(themeButton);
  updateThemeButton(themeButton);
}

function makeHeaderButton(label, controlName, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "site-control-button";
  button.dataset.siteControl = controlName;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function scrollToGraphs() {
  document.querySelector(".chart-grid")?.scrollIntoView({
    behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
    block: "start",
  });
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme, { persist: true, announce: true });
}

function applyTheme(theme, { persist, announce }) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  if (persist) {
    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable in private or restricted browsing modes.
    }
  }

  document.querySelectorAll('[data-site-control="theme-toggle"]').forEach(updateThemeButton);

  if (announce) {
    window.dispatchEvent(new CustomEvent("haq-theme-change", { detail: { theme } }));
  }
}

function updateThemeButton(button) {
  const isDark = document.documentElement.dataset.theme === "dark";
  button.textContent = t(isDark ? "common.theme.lightMode" : "common.theme.darkMode");
  button.setAttribute("aria-label", t(isDark ? "common.theme.switchToLight" : "common.theme.switchToDark"));
  button.setAttribute("aria-pressed", String(isDark));
}

function readStoredTheme() {
  try {
    const theme = window.localStorage?.getItem(THEME_STORAGE_KEY);
    return theme === "dark" || theme === "light" ? theme : null;
  } catch {
    return null;
  }
}
