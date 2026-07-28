import { initializeI18n } from "./i18n.js";

const yearTarget = document.querySelector("[data-current-year]");

if (yearTarget) {
  yearTarget.textContent = String(new Date().getFullYear());
}

document.documentElement.dataset.js = "ready";

initializeI18n();
