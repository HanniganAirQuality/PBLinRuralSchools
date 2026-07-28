const DEFAULT_LANGUAGE = "en";
const STORAGE_KEY = "haq-language";
const TRANSLATABLE_ATTRIBUTES = ["alt", "aria-label", "data-help", "placeholder", "title"];
const LANGUAGE_DETAILS = {
  en: {
    label: "English",
    controlLabel: "Language",
  },
  "pt-BR": {
    label: "Português (Brasil)",
    controlLabel: "Idioma",
  },
};
const BUILT_IN_ENGLISH = {
  "chart.axis.leftShort": "L",
  "chart.axis.rightShort": "R",
  "chart.axis.default": "axis",
  "chart.plots.one": "${count} plot | ${axisSummary}",
  "chart.plots.other": "${count} plots | ${axisSummary}",
  "chart.stats.range": "min ${min} | max ${max}",
  "chart.stats.seriesRange": "${label}: min ${min} / avg ${avg} / max ${max}",
  "chart.empty.awaitingData": "Awaiting data",
  "chart.empty.noDataLoaded": "No data loaded",
  "export.footer": "HAQ Lab, University of Colorado",
  "export.exportedAt": "Exported ${date}",
  "export.summary": "Exported ${date} — ${schemaStatus} — ${timeSummary}, ${zoom}× zoom",
  "export.noFilesLoaded": "No files loaded",
  "export.alignment.elapsed": "elapsed-time alignment",
  "export.alignment.recorded": "recorded date/time",
};

const catalogCache = new Map();
const textState = new WeakMap();
const attributeState = new WeakMap();

let currentLanguage = readStoredLanguage();
let currentCatalog = {};
let englishCatalog = {};
let exactTranslations = new Map();
let templateTranslations = [];
let observer = null;
let initialization = null;

export function initializeI18n() {
  if (!initialization) {
    initialization = initialize();
  }

  return initialization;
}

export function getLanguage() {
  return currentLanguage;
}

export async function setLanguage(language, { persist = true } = {}) {
  const nextLanguage = LANGUAGE_DETAILS[language] ? language : DEFAULT_LANGUAGE;
  const context = getCatalogContext();

  currentLanguage = nextLanguage;
  document.documentElement.lang = nextLanguage;
  updateLanguageControl();

  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch {
      // Language selection still works when storage is unavailable.
    }
  }

  if (context) {
    [englishCatalog, currentCatalog] = await Promise.all([
      loadCatalog(DEFAULT_LANGUAGE, context.file),
      loadCatalog(nextLanguage, context.file),
    ]);
    buildTranslationIndex(context);
  } else {
    englishCatalog = {};
    currentCatalog = {};
    exactTranslations = new Map();
    templateTranslations = [];
  }

  translateTree(document.documentElement);
  document.dispatchEvent(new CustomEvent("haq:languagechange", {
    detail: { language: nextLanguage },
  }));
}

export function t(key, variables = {}) {
  const source = englishCatalog[key] ?? BUILT_IN_ENGLISH[key] ?? key;
  const translated = currentCatalog[key] ?? source;
  return interpolate(translated, variables);
}

export function translateText(value) {
  const source = cleanText(value);

  if (!source || currentLanguage === DEFAULT_LANGUAGE) {
    return source;
  }

  const exact = exactTranslations.get(source);
  if (exact !== undefined) {
    return exact;
  }

  for (const template of templateTranslations) {
    const match = source.match(template.pattern);

    if (match) {
      return renderTemplateTranslation(template, match.slice(1));
    }
  }

  return source;
}

async function initialize() {
  ensureLanguageControl();
  startObserver();
  await setLanguage(currentLanguage, { persist: false });
  document.documentElement.dataset.i18n = "ready";
}

function readStoredLanguage() {
  const requested = new URLSearchParams(window.location.search).get("lang");
  if (LANGUAGE_DETAILS[requested]) {
    return requested;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return LANGUAGE_DETAILS[stored] ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function getCatalogContext() {
  const path = decodeURIComponent(window.location.pathname).replace(/\\/g, "/");
  const toolMatch = path.match(/\/aqiq\/tools\/(live-viewer|data-plotter|co2-battle)(?:\/|\/index\.html)?$/i);

  if (document.body?.classList.contains("landing")) {
    return {
      file: "home.json",
      namespaces: ["common.", "home."],
    };
  }

  if (toolMatch) {
    const toolNamespaces = {
      "co2-battle": "co2Battle.",
      "data-plotter": "dataPlotter.",
      "live-viewer": "liveViewer.",
    };
    return {
      file: "aqiq-tools.json",
      namespaces: [
        "common.",
        toolNamespaces[toolMatch[1].toLowerCase()],
        "chart.",
        "export.",
      ],
    };
  }

  if (/\/aqiq\/(?:index\.html)?$/i.test(path)) {
    return {
      file: "aqiq.json",
      namespaces: ["common.", "aqiq."],
    };
  }

  return null;
}

async function loadCatalog(language, file) {
  const cacheKey = `${language}/${file}`;

  if (!catalogCache.has(cacheKey)) {
    const url = new URL(`../../../translations/locales/${language}/${file}`, import.meta.url);
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load ${url.pathname} (${response.status})`);
        }
        return response.json();
      })
      .catch((error) => {
        console.error(error);
        return {};
      });
    catalogCache.set(cacheKey, request);
  }

  return catalogCache.get(cacheKey);
}

function buildTranslationIndex(context) {
  exactTranslations = new Map();
  templateTranslations = [];

  Object.entries(englishCatalog).forEach(([key, english]) => {
    if (!context.namespaces.some((namespace) => key.startsWith(namespace))) {
      return;
    }

    const translated = currentCatalog[key] ?? english;
    const source = cleanText(english);

    if (!source.includes("${")) {
      exactTranslations.set(source, cleanText(translated));
      return;
    }

    const sourceParts = parseTemplate(source);
    const targetParts = parseTemplate(cleanText(translated));
    const placeholders = sourceParts.filter((part) => part.type === "placeholder");

    if (placeholders.length === 0 || !sourceParts.some((part) => part.type === "text" && /[A-Za-zÀ-ɏ]/.test(part.value))) {
      return;
    }

    const pattern = makeTemplatePattern(sourceParts);
    templateTranslations.push({
      pattern,
      sourceParts,
      targetParts,
      literalLength: sourceParts
        .filter((part) => part.type === "text")
        .reduce((total, part) => total + part.value.length, 0),
    });
  });

  templateTranslations.sort((left, right) => right.literalLength - left.literalLength);
}

function parseTemplate(value) {
  const parts = [];
  let cursor = 0;

  while (cursor < value.length) {
    const opening = value.indexOf("${", cursor);

    if (opening < 0) {
      parts.push({ type: "text", value: value.slice(cursor) });
      break;
    }

    if (opening > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, opening) });
    }

    const closing = findPlaceholderEnd(value, opening + 2);

    if (closing < 0) {
      parts.push({ type: "text", value: value.slice(opening) });
      break;
    }

    parts.push({
      type: "placeholder",
      value: value.slice(opening + 2, closing),
    });
    cursor = closing + 1;
  }

  return parts;
}

function findPlaceholderEnd(value, start) {
  let depth = 1;
  let quote = "";
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function makeTemplatePattern(parts) {
  const pattern = parts.map((part) => {
    if (part.type === "placeholder") {
      return "([\\s\\S]*?)";
    }

    return escapeRegExp(part.value).replace(/\s+/g, "\\s+");
  }).join("");

  return new RegExp(`^${pattern}$`);
}

function renderTemplateTranslation(template, captures) {
  const capturedByPlaceholder = new Map();
  let captureIndex = 0;

  template.sourceParts.forEach((part) => {
    if (part.type !== "placeholder") {
      return;
    }

    if (!capturedByPlaceholder.has(part.value)) {
      capturedByPlaceholder.set(part.value, []);
    }
    capturedByPlaceholder.get(part.value).push(captures[captureIndex] ?? "");
    captureIndex += 1;
  });

  const used = new Map();
  return template.targetParts.map((part) => {
    if (part.type === "text") {
      return part.value;
    }

    const index = used.get(part.value) ?? 0;
    const values = capturedByPlaceholder.get(part.value) || [];
    used.set(part.value, index + 1);
    return values[index] ?? values[0] ?? "";
  }).join("");
}

function interpolate(value, variables) {
  return String(value).replace(/\$\{([A-Za-z][A-Za-z0-9_.-]*)\}/g, (match, name) => {
    return Object.hasOwn(variables, name) ? String(variables[name]) : match;
  });
}

function translateTree(root) {
  if (!root) {
    return;
  }

  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }

  if (!(root instanceof Element)) {
    return;
  }

  translateElementAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    translateTextNode(node);
    node = walker.nextNode();
  }

  root.querySelectorAll("*").forEach(translateElementAttributes);
}

function translateTextNode(node) {
  const parent = node.parentElement;

  if (!parent || shouldIgnore(parent)) {
    return;
  }

  const raw = node.nodeValue || "";
  const sourceValue = cleanText(raw);

  if (!sourceValue) {
    return;
  }

  let state = textState.get(node);
  if (!state || cleanText(raw) !== cleanText(state.rendered)) {
    state = {
      source: sourceValue,
      rendered: raw,
    };
    textState.set(node, state);
  }

  const translated = translateText(state.source);
  const leading = raw.match(/^\s*/)?.[0] || "";
  const trailing = raw.match(/\s*$/)?.[0] || "";
  const rendered = `${leading}${translated}${trailing}`;

  state.rendered = rendered;
  if (raw !== rendered) {
    node.nodeValue = rendered;
  }
}

function translateElementAttributes(element) {
  if (shouldIgnore(element)) {
    return;
  }

  let states = attributeState.get(element);
  if (!states) {
    states = new Map();
    attributeState.set(element, states);
  }

  TRANSLATABLE_ATTRIBUTES.forEach((name) => {
    if (!element.hasAttribute(name)) {
      return;
    }

    const raw = element.getAttribute(name) || "";
    let state = states.get(name);

    if (!state || raw !== state.rendered) {
      state = { source: cleanText(raw), rendered: raw };
      states.set(name, state);
    }

    const rendered = translateText(state.source);
    state.rendered = rendered;
    if (raw !== rendered) {
      element.setAttribute(name, rendered);
    }
  });
}

function shouldIgnore(element) {
  return Boolean(element.closest("[data-i18n-ignore], script, style, template, pre, code"));
}

function startObserver() {
  if (observer) {
    return;
  }

  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "characterData") {
        translateTextNode(mutation.target);
      } else if (mutation.type === "attributes") {
        translateElementAttributes(mutation.target);
      } else {
        mutation.addedNodes.forEach(translateTree);
      }
    });
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });
}

function ensureLanguageControl() {
  const header = document.querySelector(".site-header");

  if (!header || header.querySelector("[data-language-select]")) {
    return;
  }

  let actions = header.querySelector(".site-header-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "site-header-actions";
    [...header.children]
      .filter((child) => !child.classList.contains("brand"))
      .forEach((child) => actions.append(child));
    header.append(actions);
  }

  const label = document.createElement("label");
  label.className = "language-selector";
  label.dataset.i18nIgnore = "";

  const labelText = document.createElement("span");
  labelText.dataset.languageLabel = "";

  const select = document.createElement("select");
  select.dataset.languageSelect = "";
  Object.entries(LANGUAGE_DETAILS).forEach(([value, details]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = details.label;
    select.append(option);
  });
  select.addEventListener("change", async () => {
    select.disabled = true;
    await setLanguage(select.value);
    select.disabled = false;
    select.focus();
  });

  label.append(labelText, select);
  actions.append(label);
  updateLanguageControl();
}

function updateLanguageControl() {
  const details = LANGUAGE_DETAILS[currentLanguage] || LANGUAGE_DETAILS[DEFAULT_LANGUAGE];
  const label = document.querySelector("[data-language-label]");
  const select = document.querySelector("[data-language-select]");

  if (label) {
    label.textContent = details.controlLabel;
  }
  if (select) {
    select.value = currentLanguage;
    select.setAttribute("aria-label", details.controlLabel);
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
