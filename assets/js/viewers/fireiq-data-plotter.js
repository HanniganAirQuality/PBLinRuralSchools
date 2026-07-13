// Shared POD CSV plotting engine. Program configuration selects YPOD or SPOD
// schemas, the device count, and the measurement charts shown.
import {
  SPOD_HEADER_LOG_PAGE,
  YPOD_HEADER_LOG_PAGE,
  getPreferredYpodSection,
  getPreferredYpodVersion,
  getYpodSectionSchema,
  loadSpodHeaderLogResource,
  loadYpodHeaderLogResource,
  resolveYpodSchemaForValues,
} from "../core/ypod-yaml.js";

const PLOTTER_CONFIG = window.HAQ_DATA_PLOTTER_CONFIG || {};
const PROGRAM_NAME = PLOTTER_CONFIG.programName || "Fire-IQ";
const IS_SPOD = PLOTTER_CONFIG.podType === "SPOD";
const POD_NAME = IS_SPOD ? "SPOD" : "YPOD";
const POD_HEADER_LOG_PAGE = IS_SPOD ? SPOD_HEADER_LOG_PAGE : YPOD_HEADER_LOG_PAGE;
const MAX_PODS = PLOTTER_CONFIG.maxPods === 1 ? 1 : 2;
const DEFAULT_WINDOW_MINUTES = 0; // 0 = show entire file
const MAX_WINDOW_MINUTES = 1440;
const MIN_CHART_WIDTH = 220;
const MIN_CHART_HEIGHT = 104;
const POINT_RADIUS = 2.3;
const MAX_POINT_MARKERS = 240; // skip per-sample dots on dense files
const HOVER_RADIUS = 12;
const MAX_RENDERED_POINTS_PER_PIXEL = 2;
const MIN_RENDERED_POINTS = 240;
const MAX_ZOOM = 16;
const EXPORT_CHART_THEME = {
  background: "#ffffff",
  grid: "#d9dee6",
  text: "#5c6672",
  emptyText: "#798391",
  invertSeries: false,
};

const POD_KEYS = MAX_PODS === 1 ? ["pod1"] : ["pod1", "pod2"];
const POD_COLORS = {
  pod1: "#f46703",
  pod2: "#efad3c",
};
const FIREIQ_FIELD_ALIASES = {
  timestamp: ["DateTime", "Timestamp", "Time", "UnixTime", "Millis"],
  date: ["Date"],
  co: ["CO", "Calibrated_CO", "CO_ISB"],
  co2: ["CO2", "ELT_CO2", "CO_2", "K30_CO2"],
  pm25: ["PM25_ENV", "PM2_5", "PM25", "PM2.5"],
};

const AQIQ_FIELD_ALIASES = {
  ...FIREIQ_FIELD_ALIASES,
  temperature: ["SHT25_Temperature", "BME180_Temperature", "Temperature", "T"],
  humidity: ["SHT25_Humidity", "Relative_Humidity", "Humidity", "RH"],
  vocLight: ["Fig2600_LightVOC", "LightVOC", "lightVOC"],
  vocHeavy: ["Fig2602_HeavyVOC", "HeavyVOC", "heavyVOC"],
};

const SQIQ_FIELD_ALIASES = {
  timestamp: ["DateTime", "Timestamp", "Time"],
  date: ["Date"],
  temperature1: ["Temperature1"],
  temperature2: ["Temperature2"],
  co2: ["CO2"],
  soil: ["Soil"],
  visible: ["Visible"],
  infrared: ["Infrared"],
  uv: ["UV_Index"],
};

const FIELD_ALIASES = PLOTTER_CONFIG.fieldAliases || (
  PLOTTER_CONFIG.preset === "sqiq"
    ? SQIQ_FIELD_ALIASES
    : (PLOTTER_CONFIG.preset === "aqiq" ? AQIQ_FIELD_ALIASES : FIREIQ_FIELD_ALIASES)
);

const FIREIQ_CHARTS = {
  co: makePodChart("co", "Carbon Monoxide", "ppm", true),
  co2: makePodChart("co2", "Carbon Dioxide", "ppm", true),
  pm25: makePodChart("pm25", "Particulate Matter 2.5", "ug/m^3", true),
};

const AQIQ_CHARTS = {
  temperature: makePodChart("temperature", "Temperature", "Celsius"),
  humidity: makePodChart("humidity", "Relative Humidity", "%RH", true),
  co2: makePodChart("co2", "Carbon Dioxide", "ppm", true),
  co: makePodChart("co", "Carbon Monoxide", "ppm", true),
  pm25: makePodChart("pm25", "Particulate Matter 2.5", "ug/m^3", true),
  voc: {
    stats: "voc",
    title: "Volatile Organic Compounds",
    unit: "ADU",
    minZero: true,
    series: [
      { podKey: "pod1", key: "vocLight", label: "Figaro 2600 Light VOC", color: "#3ac831" },
      { podKey: "pod1", key: "vocHeavy", label: "Figaro 2602 Heavy VOC", color: "#02580e" },
    ],
  },
};

const SQIQ_CHARTS = {
  temperature: {
    stats: "temperature",
    title: "Temperature",
    unit: "Celsius",
    series: [
      { podKey: "pod1", key: "temperature1", label: "Temperature 1", color: "#dc2626" },
      { podKey: "pod1", key: "temperature2", label: "Temperature 2", color: "#f59e0b" },
    ],
  },
  co2: makePodChart("co2", "Carbon Dioxide", "ppm", true),
  soil: makePodChart("soil", "Soil", "ADU", true),
  light: {
    stats: "light",
    title: "Visible and Infrared Light",
    unit: "ADU",
    minZero: true,
    series: [
      { podKey: "pod1", key: "visible", label: "Visible", color: "#ca8a04" },
      { podKey: "pod1", key: "infrared", label: "Infrared", color: "#7c3aed" },
    ],
  },
  uv: makePodChart("uv", "UV Index", "UV index", true),
};

const CHARTS = PLOTTER_CONFIG.charts || (
  PLOTTER_CONFIG.preset === "sqiq"
    ? SQIQ_CHARTS
    : (PLOTTER_CONFIG.preset === "aqiq" ? AQIQ_CHARTS : FIREIQ_CHARTS)
);

const app = document.querySelector(
  "[data-pod-data-plotter], [data-ypod-data-plotter], [data-fire-iq-data-plotter]",
);
const state = {
  yamlResource: null,
  schema: null,
  displayWindowMs: DEFAULT_WINDOW_MINUTES * 60 * 1000,
  timeMode: "elapsed",
  zoomFactor: 1,
  renderQueued: false,
  hoverPoint: null,
  pods: Object.fromEntries(
    POD_KEYS.map((podKey, index) => [
      podKey,
      makePodState(MAX_PODS === 1 ? POD_NAME : `${POD_NAME} ${index + 1}`),
    ]),
  ),
};

function makePodChart(key, title, unit, minZero = false) {
  return {
    canvas: `chart-${key}`,
    stats: key,
    title,
    unit,
    minZero,
    series: POD_KEYS.map((podKey) => ({ podKey, key, color: POD_COLORS[podKey] })),
  };
}

if (app) {
  init();
}

function makePodState(label) {
  return {
    label,
    fileName: "",
    rawText: "",
    records: [],
    skippedRows: 0,
    firstDataLine: "",
  };
}

async function init() {
  bindControls();
  await loadYamlSettings();
  POD_KEYS.forEach((podKey) => setPodStatus(podKey, "No file loaded"));
  renderAll();
}

function bindControls() {
  app.querySelectorAll("[data-csv-input]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        await loadFile(input.dataset.csvInput, file);
      }
      event.target.value = ""; // allow re-loading the same file
    });
  });
  app.querySelectorAll("[data-load-pod]").forEach((button) => {
    button.addEventListener("click", () => {
      query(`[data-csv-input="${button.dataset.loadPod}"]`).click();
    });
  });
  app.querySelectorAll("[data-clear-pod]").forEach((button) => {
    button.addEventListener("click", () => clearPod(button.dataset.clearPod));
  });
  app.querySelectorAll("[data-pod-id]").forEach((input) => {
    input.addEventListener("input", () => {
      clearChartHover();
      queueRender();
    });
  });
  query("[data-reset]").addEventListener("click", resetData);
  query("[data-export-png]").addEventListener("click", exportGraphPng);
  query("[data-yaml-version]").addEventListener("change", handleVersionChange);
  query("[data-yaml-section]").addEventListener("change", applySelectedSchema);
  query("[data-window-minutes]").addEventListener("input", handleWindowChange);
  query("[data-time-mode]").addEventListener("change", handleTimeModeChange);
  query("[data-chart-zoom]").addEventListener("input", handleZoomChange);
  query("[data-reset-zoom]").addEventListener("click", resetZoom);
  app.querySelectorAll("[data-plot-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", handlePlotToggle);
  });
  bindChartHover();
  window.addEventListener("resize", () => {
    clearChartHover();
    queueRender();
  });
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener?.("change", () => {
    clearChartHover();
    queueRender();
  });
}

// ---------------------------------------------------------------------------
// YAML schema (firmware version -> column layout)
// ---------------------------------------------------------------------------
async function loadYamlSettings() {
  query("[data-schema-status]").textContent = `Loading ${POD_NAME} schema...`;
  state.yamlResource = IS_SPOD
    ? await loadSpodHeaderLogResource()
    : await loadYpodHeaderLogResource();
  populateVersionSelect();
  populateSectionSelect();
  applySelectedSchema();
}

function populateVersionSelect() {
  const select = query("[data-yaml-version]");
  const versions = state.yamlResource?.index || [];
  const previous = select.value;
  select.innerHTML = "";

  versions.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.version;
    option.textContent = item.version;
    select.append(option);
  });

  const preferredVersion = getPreferredYpodVersion(
    versions.map((item) => item.version),
    previous,
  );

  if (preferredVersion) {
    select.value = preferredVersion;
  }
}

function populateSectionSelect() {
  const version = query("[data-yaml-version]").value;
  const sections = state.yamlResource?.index.find((item) => item.version === version)?.sections || [];
  const select = query("[data-yaml-section]");
  const previous = select.value;
  select.innerHTML = "";

  sections.forEach((section) => {
    const option = document.createElement("option");
    option.value = section;
    option.textContent = section;
    select.append(option);
  });

  const preferredSection = getPreferredYpodSection(sections, previous);

  if (preferredSection) {
    select.value = preferredSection;
  }
}

function handleVersionChange() {
  populateSectionSelect();
  applySelectedSchema();
}

function applySelectedSchema() {
  const version = query("[data-yaml-version]").value;
  const section = query("[data-yaml-section]").value;

  try {
    const schema = getYpodSectionSchema(state.yamlResource, version, section);
    setActiveSchema(schema, { reparse: true });
  } catch (error) {
    query("[data-schema-status]").textContent = error.message || "Unable to load schema";
  }
}

function setActiveSchema(schema, { reparse = false } = {}) {
  const schemaLink = query("[data-schema-link]");
  const schemaStatus = query("[data-schema-status]");
  state.schema = schema;
  schemaLink.href = schema.htmlUrl || POD_HEADER_LOG_PAGE;

  const suffix = schema.isFallback ? "fallback" : `${schema.columns.length} columns`;
  schemaStatus.textContent = `${schema.version} ${schema.section}, ${suffix}`;
  updateChartHeadings();

  if (reparse) {
    reparseLoadedPods();
  }
}

function selectSchemaControls(schema) {
  const versionSelect = query("[data-yaml-version]");
  const sectionSelect = query("[data-yaml-section]");

  versionSelect.value = schema.version;
  populateSectionSelect();
  sectionSelect.value = schema.section;
}

function reparseLoadedPods() {
  clearChartHover();
  POD_KEYS.forEach((podKey) => {
    if (state.pods[podKey].rawText) {
      parsePodData(podKey);
    }
  });
  queueRender();
}

// ---------------------------------------------------------------------------
// File loading & parsing
// ---------------------------------------------------------------------------
async function loadFile(podKey, file) {
  const pod = state.pods[podKey];
  setPodStatus(podKey, `Reading ${file.name}...`);

  try {
    if (!state.schema) {
      await loadYamlSettings();
    }
    pod.rawText = await file.text();
  } catch (error) {
    setPodStatus(podKey, error.message || "Could not read file");
    return;
  }

  pod.fileName = file.name;
  parsePodData(podKey);

  if (pod.records.length === 0) {
    setPodStatus(podKey, "No plottable rows found — check YAML version");
  } else {
    setPodStatus(podKey, `${file.name} loaded`);
  }

  query(`[data-clear-pod="${podKey}"]`).disabled = pod.records.length === 0;
  renderAll();
}

function parsePodData(podKey) {
  const pod = state.pods[podKey];
  pod.records = [];
  pod.skippedRows = 0;
  pod.firstDataLine = "";
  const resolutionCache = new Map();
  const linePattern = /[^\r\n]+/g;
  let lineMatch;

  while ((lineMatch = linePattern.exec(pod.rawText)) !== null) {
    const line = lineMatch[0];

    if (!line.trim()) {
      continue;
    }

    const values = parseCsvLine(line);

    if (isHeaderRow(values)) {
      continue;
    }

    if (!isCsvLikeLine(line, values)) {
      pod.skippedRows += 1;
      continue;
    }

    if (!pod.firstDataLine) {
      pod.firstDataLine = line;
    }

    const record = mapFileValues(values, resolutionCache);

    if (record) {
      pod.records.push(record);
    } else {
      pod.skippedRows += 1;
    }
  }

  pod.records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  updateFileReadout(podKey);
}

function mapFileValues(values, resolutionCache = null) {
  if (!state.schema?.columns?.length || values.length === 0) {
    return null;
  }

  const cacheKey = getRowSchemaCacheKey(values);
  const cachedSchema = resolutionCache?.get(cacheKey);
  const cachedValues = cachedSchema ? normalizeValuesForColumns(values, cachedSchema.columns) : null;
  const resolved = cachedValues
    ? { schema: cachedSchema, values: cachedValues }
    : resolveYpodSchemaForValues(state.yamlResource, state.schema, values);

  if (!resolved || !hasRequiredChartFields(resolved.schema)) {
    return null;
  }

  resolutionCache?.set(cacheKey, resolved.schema);

  const { schema, values: normalizedValues } = resolved;

  if (
    schema.version !== state.schema?.version ||
    schema.section !== state.schema?.section
  ) {
    selectSchemaControls(schema);
    setActiveSchema(schema); // no reparse here — we are mid-parse already
  }

  const fields = {};
  schema.columns.forEach((column, index) => {
    fields[column.name] = normalizedValues[index] ?? "";
  });

  const timestamp = parseRecordTimestamp(fields);

  if (!timestamp) {
    return null;
  }

  return {
    timestamp,
    values: Object.fromEntries(
      getConfiguredFieldKeys().map((key) => [key, numberField(fields, FIELD_ALIASES[key] || [])]),
    ),
  };
}

function getRowSchemaCacheKey(values) {
  const firmware = values.find((value) =>
    /[A-Za-z]+POD[\s_-]*V?\s*\d+[._-]\d+/i.test(String(value)),
  );
  return `${values.length}:${String(firmware || "").trim().toLowerCase()}`;
}

function normalizeValuesForColumns(values, columns) {
  if (values.length === columns.length) {
    return values;
  }

  if (values.length === columns.length + 1 && values[values.length - 1] === "") {
    return values.slice(0, -1);
  }

  return null;
}

function hasRequiredChartFields(schema) {
  return getConfiguredFieldKeys().some((key) =>
    Boolean(resolveColumnForField(key, schema.columns)),
  );
}

function getConfiguredFieldKeys() {
  return [...new Set(
    Object.values(CHARTS)
      .flatMap((chart) => chart.series.map((series) => series.key)),
  )];
}

function parseRecordTimestamp(fields) {
  const timeRaw = getField(fields, FIELD_ALIASES.timestamp);

  if (!timeRaw) {
    return null;
  }

  // Older firmware logs separate Date and Time columns.
  const dateRaw = getField(fields, FIELD_ALIASES.date);

  if (dateRaw) {
    const combined = Date.parse(`${dateRaw} ${timeRaw}`);

    if (!Number.isNaN(combined)) {
      return new Date(combined);
    }
  }

  const numeric = Number(timeRaw);

  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) {
      return new Date(numeric); // unix milliseconds
    }

    if (numeric > 1e9) {
      return new Date(numeric * 1000); // unix seconds
    }

    return new Date(numeric); // relative millis counter — spacing still correct
  }

  const parsed = Date.parse(timeRaw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function resolveColumnForField(fieldKey, columns = state.schema?.columns || []) {
  const aliases = FIELD_ALIASES[fieldKey] || [];
  const normalizedAliases = aliases.map(normalizeFieldName);

  return columns.find((column) =>
    normalizedAliases.includes(normalizeFieldName(column.name)),
  ) || null;
}

function getField(fields, aliases) {
  for (const alias of aliases) {
    if (fields[alias] !== undefined && fields[alias] !== "") {
      return fields[alias];
    }
  }

  const normalizedAliases = aliases.map(normalizeFieldName);
  const match = Object.entries(fields).find(([name, value]) =>
    value !== "" && normalizedAliases.includes(normalizeFieldName(name)),
  );
  return match?.[1] || "";
}

function numberField(fields, aliases) {
  const rawValue = getField(fields, aliases);

  if (rawValue === "" || rawValue === null || rawValue === undefined) {
    return null;
  }

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function normalizeFieldName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function isHeaderRow(values) {
  const first = values[0]?.toLowerCase() || "";
  return ["datetime", "timestamp", "date", "time", "unixtime", "millis", "spodid", "ypodid"].includes(first);
}

function isCsvLikeLine(line, values = parseCsvLine(line)) {
  return line.includes(",") || values.length > 1;
}

// ---------------------------------------------------------------------------
// Pod controls & readouts
// ---------------------------------------------------------------------------
function activePodKeys() {
  return POD_KEYS;
}

function clearPod(podKey) {
  clearChartHover();
  state.pods[podKey] = makePodState(state.pods[podKey].label);
  setPodStatus(podKey, "No file loaded");
  updateFileReadout(podKey);
  query(`[data-clear-pod="${podKey}"]`).disabled = true;
  renderAll();
}

function resetData() {
  POD_KEYS.forEach(clearPod);
}

function updateFileReadout(podKey) {
  const pod = state.pods[podKey];
  const first = pod.records[0];
  const last = pod.records[pod.records.length - 1];

  query(`[data-row-count="${podKey}"]`).textContent = String(pod.records.length);
  query(`[data-skipped-rows="${podKey}"]`).textContent = String(pod.skippedRows);
  query(`[data-first-line="${podKey}"]`).textContent = pod.firstDataLine || "--";
  query(`[data-time-span="${podKey}"]`).textContent =
    first && last ? formatTimeSpan(first.timestamp, last.timestamp) : "--";
}

function handleWindowChange(event) {
  const minutes = clampNumber(
    Number(event.target.value),
    0,
    MAX_WINDOW_MINUTES,
    DEFAULT_WINDOW_MINUTES,
  );
  state.displayWindowMs = minutes * 60 * 1000;
  clearChartHover();
  queueRender();
}

function handleTimeModeChange(event) {
  state.timeMode = event.target.value === "absolute" ? "absolute" : "elapsed";
  clearChartHover();
  queueRender();
}

function handleZoomChange(event) {
  state.zoomFactor = clampNumber(Number(event.target.value), 1, MAX_ZOOM, 1);
  updateZoomControls();
  clearChartHover();
  queueRender();
}

function resetZoom() {
  state.zoomFactor = 1;
  query("[data-chart-zoom]").value = "1";
  updateZoomControls();
  clearChartHover();
  queueRender();
}

function updateZoomControls() {
  query("[data-chart-zoom-label]").textContent = `${state.zoomFactor}×`;
  query("[data-reset-zoom]").disabled = state.zoomFactor === 1;
}

function handlePlotToggle() {
  clearChartHover();
  app.querySelectorAll("[data-chart-card]").forEach((card) => {
    const hidden = !isChartEnabled(card.dataset.chartCard);
    card.toggleAttribute("hidden", hidden);
    card.setAttribute("aria-hidden", String(hidden));
  });
  queueRender();
}

function setPodStatus(podKey, message) {
  query(`[data-pod-status="${podKey}"]`).textContent = message;
}

function getPodDisplayName(podKey) {
  const inputValue = query(`[data-pod-id="${podKey}"]`)?.value?.trim();
  return inputValue || state.pods[podKey].label;
}

function isChartEnabled(chartKey) {
  const toggle = [...app.querySelectorAll("[data-plot-toggle]")]
    .find((item) => item.value === chartKey);

  return !toggle || toggle.checked;
}

function handleChartPointerMove(event) {
  const canvas = event.target instanceof Element
    ? event.target.closest("canvas[data-chart]")
    : null;

  if (!canvas) {
    clearChartHover();
    return;
  }

  const card = canvas.closest("[data-chart-card]");
  const chart = CHARTS[card?.dataset.chartCard];

  if (!card || !chart) {
    clearChartHover();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const hoverPoint = findNearestChartPoint(canvas, pointer);
  const previousCanvasId = state.hoverPoint?.canvasId || "";

  state.hoverPoint = hoverPoint ? { ...hoverPoint, canvasId: canvas.id } : null;
  canvas.style.cursor = hoverPoint ? "crosshair" : "";
  renderHoverOnCanvas(canvas, hoverPoint);

  if (previousCanvasId && previousCanvasId !== canvas.id) {
    restoreCanvasBase(query(".chart-grid")?.querySelector(`#${previousCanvasId}`));
  }
}

function clearChartHover() {
  const previousCanvasId = state.hoverPoint?.canvasId || "";
  state.hoverPoint = null;

  query(".chart-grid")?.querySelectorAll("canvas").forEach((canvas) => {
    canvas.style.cursor = "";
  });

  if (previousCanvasId) {
    restoreCanvasBase(query(".chart-grid")?.querySelector(`#${previousCanvasId}`));
  }
}

function findNearestChartPoint(canvas, pointer) {
  let nearest = null;
  let nearestDistance = HOVER_RADIUS;

  (canvas._fireIqHoverPoints || []).forEach((point) => {
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);

    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  });

  return nearest;
}

function renderHoverOnCanvas(canvas, hoverPoint) {
  if (!canvas) {
    return;
  }

  restoreCanvasBase(canvas);

  if (!hoverPoint) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawHoverTooltip(
    context,
    hoverPoint,
    Math.max(MIN_CHART_WIDTH, rect.width),
    Math.max(MIN_CHART_HEIGHT, rect.height),
    getLiveChartTheme(),
  );
}

function restoreCanvasBase(canvas) {
  if (!canvas?._fireIqBaseImage) {
    return;
  }

  const context = canvas.getContext("2d");
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.putImageData(canvas._fireIqBaseImage, 0, 0);
  context.restore();
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------
function visibleRecordsByPod() {
  const active = activePodKeys();

  const recordsByPod = Object.fromEntries(
    POD_KEYS.map((podKey) => {
      if (!active.includes(podKey)) {
        return [podKey, []];
      }

      const records = state.pods[podKey].records;

      if (records.length === 0 || !state.displayWindowMs) {
        return [podKey, records];
      }

      // Window relative to each pod's own last sample, so files recorded on
      // different days can still be compared side by side.
      const end = records[records.length - 1].timestamp.getTime();
      return [
        podKey,
        records.filter((record) => end - record.timestamp.getTime() <= state.displayWindowMs),
      ];
    }),
  );

  if (state.zoomFactor === 1) {
    return recordsByPod;
  }

  const visibleRange = state.timeMode === "absolute"
    ? getAbsoluteTimeRange(recordsByPod)
    : getChartTimeRange(recordsByPod);

  if (!visibleRange || visibleRange.min === visibleRange.max) {
    return recordsByPod;
  }

  const cutoff = visibleRange.max - (visibleRange.max - visibleRange.min) / state.zoomFactor;
  POD_KEYS.forEach((podKey) => {
    recordsByPod[podKey] = recordsByPod[podKey]
      .filter((record) => getRecordX(record, podKey) >= cutoff);
  });
  return recordsByPod;
}

function getAbsoluteTimeRange(recordsByPod) {
  let min = Infinity;
  let max = -Infinity;

  POD_KEYS.forEach((podKey) => {
    recordsByPod[podKey].forEach((record) => {
      const value = record.timestamp.getTime();
      min = Math.min(min, value);
      max = Math.max(max, value);
    });
  });

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function getRecordX(record, podKey) {
  if (state.timeMode === "absolute") {
    return record.timestamp.getTime();
  }

  const first = state.pods[podKey].records[0];
  const start = first ? first.timestamp.getTime() : record.timestamp.getTime();
  return record.timestamp.getTime() - start;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function queueRender() {
  if (state.renderQueued) {
    return;
  }

  state.renderQueued = true;
  window.requestAnimationFrame(() => {
    state.renderQueued = false;
    renderAll();
  });
}

function renderAll() {
  const recordsByPod = visibleRecordsByPod();
  updateLegends();
  updateMetrics(recordsByPod);

  query(".chart-grid")
    .querySelectorAll(".chart-card")
    .forEach((card) => {
      const chart = CHARTS[card.dataset.chartCard];

      if (!chart) {
        return;
      }

      const hidden = !isChartEnabled(card.dataset.chartCard);
      card.toggleAttribute("hidden", hidden);
      card.setAttribute("aria-hidden", String(hidden));

      if (!hidden) {
        renderChart(card, chart, recordsByPod);
      }
    });
}

function renderChart(card, chart, recordsByPod = visibleRecordsByPod()) {
  const canvas = card.querySelector("canvas");
  const rect = canvas.getBoundingClientRect();

  renderChartCanvas(canvas, chart, {
    width: Math.max(MIN_CHART_WIDTH, rect.width),
    height: Math.max(MIN_CHART_HEIGHT, rect.height),
    scale: window.devicePixelRatio || 1,
    theme: getLiveChartTheme(),
    updateStats: true,
    recordsByPod,
    hoverPoint: state.hoverPoint?.canvasId === canvas.id ? state.hoverPoint : null,
  });
}

function renderChartCanvas(canvas, chart, {
  width,
  height,
  scale = 1,
  theme,
  updateStats = false,
  recordsByPod = visibleRecordsByPod(),
  hoverPoint = null,
}) {
  const context = canvas.getContext("2d");
  const chartUnit = getChartUnit(chart);

  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);
  canvas._fireIqHoverPoints = [];

  const valueRange = getChartValueRange(chart, recordsByPod);
  const timeRange = getChartTimeRange(recordsByPod);

  if (!timeRange || !valueRange) {
    drawEmptyChart(context, width, theme);
    if (updateStats) {
      canvas._fireIqBaseImage = context.getImageData(0, 0, canvas.width, canvas.height);
      query(`[data-chart-stats="${chart.stats}"]`).textContent = "--";
    }
    return;
  }

  const plot = {
    left: 54,
    right: width - 14,
    top: chartUnit ? 24 : 12,
    bottom: height - 28,
  };
  let { min: xMin, max: xMax } = timeRange;

  if (xMin === xMax) {
    xMin -= 30000;
    xMax += 30000;
  }

  const yRange = getYRangeFromBounds(valueRange.min, valueRange.max, chart.minZero);

  drawGrid(context, plot, width, height, xMin, xMax, yRange, theme, {
    leftLabel: chartUnit,
  });

  const hoverPoints = [];
  chart.series.forEach((series) => {
    const renderedRecords = drawSeries(
      context,
      recordsByPod[series.podKey],
      series,
      plot,
      xMin,
      xMax,
      yRange,
      theme,
    );

    renderedRecords.forEach((record) => {
      const value = record.values[series.key];
      hoverPoints.push({
        x: scaleValue(getRecordX(record, series.podKey), xMin, xMax, plot.left, plot.right),
        y: scaleValue(value, yRange.min, yRange.max, plot.bottom, plot.top),
        value,
        timestamp: record.timestamp,
        elapsedMs: getRecordX(record, series.podKey),
        label: `${getPodDisplayName(series.podKey)} — ${series.label || chart.title}`,
        unit: getChartUnit(chart),
        color: getSeriesColor(series, theme),
      });
    });
  });

  if (updateStats) {
    canvas._fireIqHoverPoints = hoverPoints;
    canvas._fireIqBaseImage = context.getImageData(0, 0, canvas.width, canvas.height);
  }

  if (hoverPoint) {
    drawHoverTooltip(context, hoverPoint, width, height, theme);
  }

  if (updateStats) {
    updateChartStats(chart, recordsByPod);
  }
}

function getChartTimeRange(recordsByPod) {
  let min = Infinity;
  let max = -Infinity;

  POD_KEYS.forEach((podKey) => {
    recordsByPod[podKey].forEach((record) => {
      const value = getRecordX(record, podKey);
      min = Math.min(min, value);
      max = Math.max(max, value);
    });
  });

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function getChartValueRange(chart, recordsByPod) {
  let min = Infinity;
  let max = -Infinity;

  chart.series.forEach((series) => {
    recordsByPod[series.podKey].forEach((record) => {
      const value = record.values[series.key];

      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    });
  });

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function getYRangeFromBounds(lower, upper, minZero = false) {
  let min = lower;
  let max = upper;

  if (minZero) {
    min = Math.min(0, min);
  }

  if (min === max) {
    min -= minZero ? 0 : 1;
    max += Math.max(1, Math.abs(max) * 0.08);
  }

  const padding = (max - min) * 0.08;
  return {
    min: minZero ? Math.min(0, min) : min - padding,
    max: max + padding,
  };
}

function drawGrid(context, plot, width, height, xMin, xMax, yRange, theme, { leftLabel = "" } = {}) {
  context.strokeStyle = theme.grid;
  context.lineWidth = 1;
  context.font = "11px Arial, Helvetica, sans-serif";
  context.fillStyle = theme.text;
  context.textAlign = "left";

  if (leftLabel) {
    context.save();
    context.font = "700 10px Arial, Helvetica, sans-serif";
    context.fillText(leftLabel, 8, Math.max(10, plot.top - 9));
    context.restore();
  }

  for (let step = 0; step <= 4; step += 1) {
    const ratio = step / 4;
    const y = plot.top + (plot.bottom - plot.top) * ratio;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();

    const value = yRange.max - (yRange.max - yRange.min) * ratio;
    context.fillText(formatNumber(value), 8, y + 4);
  }

  for (let step = 0; step <= 4; step += 1) {
    const ratio = step / 4;
    const x = plot.left + (plot.right - plot.left) * ratio;
    context.beginPath();
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.bottom);
    context.stroke();

    const timeValue = xMin + (xMax - xMin) * ratio;
    drawCenteredXAxisLabel(context, formatXAxisValue(timeValue, xMin, xMax), x, width, height - 9);
  }

  context.textAlign = "left";
}

function drawCenteredXAxisLabel(context, label, x, width, y) {
  const labelWidth = context.measureText(label).width;
  const padding = 8;
  const halfWidth = labelWidth / 2;
  const centerX = clampNumber(x, padding + halfWidth, width - padding - halfWidth, x);

  context.textAlign = "center";
  context.fillText(label, centerX, y);
  context.textAlign = "left";
}

function drawSeries(context, records, series, plot, xMin, xMax, yRange, theme) {
  const segments = finiteRecordSegments(records, series.key);
  const usableCount = segments.reduce((sum, segment) => sum + segment.length, 0);

  if (usableCount === 0) {
    return [];
  }

  const color = getSeriesColor(series, theme);
  const maxPoints = Math.max(
    MIN_RENDERED_POINTS,
    Math.floor((plot.right - plot.left) * MAX_RENDERED_POINTS_PER_PIXEL),
  );
  const renderedSegments = segments.map((segment) =>
    decimateRecords(segment, series.key, Math.max(2, Math.floor(maxPoints * segment.length / usableCount))),
  );
  const renderedCount = renderedSegments.reduce((sum, segment) => sum + segment.length, 0);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  renderedSegments.forEach((segment) => {
    segment.forEach((record, index) => {
      const x = scaleValue(getRecordX(record, series.podKey), xMin, xMax, plot.left, plot.right);
      const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
  });

  context.stroke();

  if (renderedCount > MAX_POINT_MARKERS) {
    return renderedSegments.flat();
  }

  context.fillStyle = color;
  renderedSegments.forEach((segment) => {
    segment.forEach((record) => {
      const x = scaleValue(getRecordX(record, series.podKey), xMin, xMax, plot.left, plot.right);
      const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);
      context.beginPath();
      context.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
      context.fill();
    });
  });
  return renderedSegments.flat();
}

function finiteRecordSegments(records, seriesKey) {
  const segments = [];
  let current = [];

  records.forEach((record) => {
    if (Number.isFinite(record.values[seriesKey])) {
      current.push(record);
      return;
    }

    if (current.length) {
      segments.push(current);
      current = [];
    }
  });

  if (current.length) {
    segments.push(current);
  }

  return segments;
}

function decimateRecords(records, seriesKey, maxPoints) {
  if (records.length <= maxPoints) {
    return records;
  }

  const bucketSize = Math.max(1, Math.ceil(records.length / Math.max(1, Math.floor(maxPoints / 2))));
  const result = [];

  for (let start = 0; start < records.length; start += bucketSize) {
    const end = Math.min(records.length, start + bucketSize);
    let minRecord = records[start];
    let maxRecord = records[start];

    for (let index = start + 1; index < end; index += 1) {
      const record = records[index];
      if (record.values[seriesKey] < minRecord.values[seriesKey]) {
        minRecord = record;
      }
      if (record.values[seriesKey] > maxRecord.values[seriesKey]) {
        maxRecord = record;
      }
    }

    if (minRecord.timestamp <= maxRecord.timestamp) {
      result.push(minRecord);
      if (maxRecord !== minRecord) result.push(maxRecord);
    } else {
      result.push(maxRecord);
      if (maxRecord !== minRecord) result.push(minRecord);
    }
  }

  return result;
}

function drawEmptyChart(context, width, theme) {
  context.strokeStyle = theme.grid;
  context.lineWidth = 1;

  for (let step = 1; step < 5; step += 1) {
    const y = 24 * step;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.fillStyle = theme.emptyText;
  context.font = "12px Arial, Helvetica, sans-serif";
  context.fillText("No data loaded", 14, 24);
}

function drawHoverTooltip(context, point, width, height, theme) {
  const lines = [
    point.label,
    `${formatExactNumber(point.value)}${point.unit ? ` ${point.unit}` : ""}`,
    `Elapsed ${formatElapsed(point.elapsedMs)}`,
    formatDateTime(point.timestamp),
  ];
  const padding = 8;
  const lineHeight = 15;
  context.save();
  context.font = "12px Arial, Helvetica, sans-serif";
  let longestLine = 0;
  lines.forEach((line) => {
    longestLine = Math.max(longestLine, context.measureText(line).width);
  });
  const tooltipWidth = Math.ceil(longestLine + padding * 2);
  const tooltipHeight = padding * 2 + lineHeight * lines.length;
  const x = clampNumber(point.x + 12, 4, width - tooltipWidth - 4, 4);
  const y = clampNumber(point.y - tooltipHeight - 12, 4, height - tooltipHeight - 4, 4);

  context.strokeStyle = point.color;
  context.lineWidth = 2;
  context.fillStyle = theme.background;
  context.beginPath();
  context.arc(point.x, point.y, POINT_RADIUS + 3, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = "rgba(17, 24, 39, 0.94)";
  context.strokeStyle = "rgba(255, 255, 255, 0.22)";
  context.lineWidth = 1;
  roundRect(context, x, y, tooltipWidth, tooltipHeight, 6);
  context.fill();
  context.stroke();

  lines.forEach((line, index) => {
    context.fillStyle = index === 0 ? "#ffffff" : "#d1d5db";
    context.font = `${index === 0 ? "700 " : ""}12px Arial, Helvetica, sans-serif`;
    context.fillText(line, x + padding, y + padding + 11 + index * lineHeight);
  });
  context.restore();
}

function updateChartStats(chart, recordsByPod = visibleRecordsByPod()) {
  const parts = chart.series
    .map((series) => {
      let count = 0;
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;

      recordsByPod[series.podKey].forEach((record) => {
        const value = record.values[series.key];

        if (!Number.isFinite(value)) {
          return;
        }

        count += 1;
        sum += value;
        min = Math.min(min, value);
        max = Math.max(max, value);
      });

      if (count === 0) {
        return "";
      }

      const avg = sum / count;
      return `${getSeriesLegendLabel(series)}: min ${formatNumber(min)} / avg ${formatNumber(avg)} / max ${formatNumber(max)}`;
    })
    .filter(Boolean);

  query(`[data-chart-stats="${chart.stats}"]`).textContent = parts.length ? parts.join(" | ") : "--";
}

function updateMetrics(recordsByPod = visibleRecordsByPod()) {
  Object.values(CHARTS).forEach((chart) => {
    POD_KEYS.forEach((podKey) => {
      const series = chart.series.find((item) => item.podKey === podKey);

      if (!series) {
        return;
      }

      const records = recordsByPod[podKey];
      const last = records[records.length - 1];
      setMetric(
        `${podKey}-${chart.stats}`,
        last?.values[series.key],
        getFieldUnit(series.key, chart.unit || ""),
      );
    });
  });
}

function setMetric(name, value, unit) {
  const target = query(`[data-metric="${name}"]`);

  if (!target) {
    return;
  }

  target.textContent = Number.isFinite(value) ? `${formatNumber(value)} ${unit}`.trim() : "--";
}

function updateChartHeadings() {
  Object.entries(CHARTS).forEach(([chartKey, chart]) => {
    const title = query(`[data-chart-card="${chartKey}"] h2`);

    if (!title) {
      return;
    }

    const unit = getChartUnit(chart);
    title.replaceChildren(document.createTextNode(chart.title));

    if (unit) {
      const unitNode = document.createElement("span");
      unitNode.textContent = ` [${unit}]`;
      title.append(unitNode);
    }
  });
}

function getChartUnit(chart) {
  return getFieldUnit(chart.stats, chart.unit || "");
}

function getFieldUnit(fieldKey, fallback = "") {
  return resolveColumnForField(fieldKey)?.unit || fallback;
}

function updateLegends() {
  Object.values(CHARTS).forEach((chart) => {
    const legend = query(`[data-chart-legend="${chart.stats}"]`);

    if (!legend) {
      return;
    }

    const items = chart.series
      .filter((series) =>
        activePodKeys().includes(series.podKey) &&
        state.pods[series.podKey].records.length > 0,
      )
      .map((series) => makeLegendItem(series.color, getSeriesLegendLabel(series)));

    legend.replaceChildren(...items);
  });
}

function getSeriesLegendLabel(series) {
  const podName = getPodDisplayName(series.podKey);
  return series.label ? `${podName} — ${series.label}` : podName;
}

function makeLegendItem(color, label) {
  const item = document.createElement("span");
  const swatch = document.createElement("i");
  swatch.style.setProperty("--swatch", color);
  swatch.style.setProperty("--swatch-dark", invertHexColor(color));
  item.dataset.exportLabel = label;
  item.append(swatch, document.createTextNode(label));
  return item;
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------
function exportGraphPng() {
  renderAll();

  const grid = app.querySelector(".chart-grid");
  const cards = [...grid.querySelectorAll(".chart-card:not([hidden])")];

  if (cards.length === 0) {
    POD_KEYS.forEach((podKey) => setPodStatus(podKey, "No visible plots to export"));
    return;
  }

  const gridRect = grid.getBoundingClientRect();
  const scale = 2;
  const padding = 32;
  const headerHeight = 86;
  const footerHeight = 30;
  const exportCanvas = document.createElement("canvas");
  const width = Math.ceil(gridRect.width + padding * 2);
  const height = Math.ceil(gridRect.height + padding * 2 + headerHeight + footerHeight);
  exportCanvas.width = width * scale;
  exportCanvas.height = height * scale;

  const context = exportCanvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  drawExportHeader(context, width, padding);

  cards.forEach((card) => {
    drawExportCard(context, card, gridRect, padding, headerHeight);
  });

  context.fillStyle = "#5c6672";
  context.font = "12px Arial, Helvetica, sans-serif";
  context.fillText("HAQ Lab, University of Colorado", padding, height - 18);

  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = `${PLOTTER_CONFIG.filePrefix || "fire-iq-plots"}-${makeFileTimestamp()}.png`;
  link.click();
}

function drawExportHeader(context, width, padding) {
  const schemaStatus = query("[data-schema-status]").textContent;
  const timeSummary = state.timeMode === "elapsed" ? "elapsed-time alignment" : "recorded date/time";
  const fileSummary = activePodKeys()
    .filter((podKey) => state.pods[podKey].fileName)
    .map((podKey) => `${getPodDisplayName(podKey)}: ${state.pods[podKey].fileName}`)
    .join("   ");

  context.fillStyle = "#17202a";
  context.font = "700 22px Arial, Helvetica, sans-serif";
  context.fillText(
    PLOTTER_CONFIG.exportTitle || `${PROGRAM_NAME} ${MAX_PODS === 2 ? `Dual-${POD_NAME}` : POD_NAME} Data Visualization`,
    padding,
    34,
  );

  context.fillStyle = "#5c6672";
  context.font = "13px Arial, Helvetica, sans-serif";
  context.fillText(
    `Exported ${new Date().toLocaleString()} — ${schemaStatus} — ${timeSummary}, ${state.zoomFactor}× zoom`,
    padding,
    58,
  );
  context.fillText(fileSummary || "No files loaded", padding, 76);

  context.strokeStyle = "#d9dee6";
  context.beginPath();
  context.moveTo(padding, 86);
  context.lineTo(width - padding, 86);
  context.stroke();
}

function drawExportCard(context, card, gridRect, padding, headerHeight) {
  const rect = card.getBoundingClientRect();
  const x = padding + rect.left - gridRect.left;
  const y = padding + headerHeight + rect.top - gridRect.top;
  const width = rect.width;
  const height = rect.height;
  const canvas = card.querySelector("canvas");
  const chart = CHARTS[card.dataset.chartCard];
  const title = card.querySelector("h2")?.textContent?.trim() || "";
  const stats = card.querySelector("[data-chart-stats]")?.textContent?.trim() || "";
  const legendItems = [...card.querySelectorAll(".chart-legend span")].map((item) => ({
    color: item.querySelector("i")?.style.getPropertyValue("--swatch") || "#17202a",
    label: item.dataset.exportLabel || item.textContent.trim(),
  }));
  const canvasTop = y + (canvas.getBoundingClientRect().top - rect.top);
  const canvasHeight = height - (canvasTop - y) - 8;

  context.fillStyle = "#ffffff";
  context.strokeStyle = "#d9dee6";
  context.lineWidth = 1;
  roundRect(context, x, y, width, height, 8);
  context.fill();
  context.stroke();

  context.fillStyle = "#17202a";
  context.font = "700 13px Arial, Helvetica, sans-serif";
  context.fillText(title, x + 12, y + 22);

  context.fillStyle = "#5c6672";
  context.font = "11px Arial, Helvetica, sans-serif";
  context.textAlign = "right";
  context.fillText(stats, x + width - 12, y + 22);
  context.textAlign = "left";

  let legendX = x + 12;
  legendItems.forEach((item) => {
    context.fillStyle = item.color;
    context.beginPath();
    context.arc(legendX + 4, y + 42, 4, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#5c6672";
    context.font = "11px Arial, Helvetica, sans-serif";
    context.fillText(item.label, legendX + 12, y + 46);
    legendX += context.measureText(item.label).width + 32;
  });

  const exportChartCanvas = makeExportChartCanvas(canvas, chart);
  context.drawImage(exportChartCanvas, x + 8, canvasTop, width - 16, canvasHeight);
}

function makeExportChartCanvas(sourceCanvas, chart) {
  if (!chart) {
    return sourceCanvas;
  }

  const rect = sourceCanvas.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  renderChartCanvas(canvas, chart, {
    width: Math.max(MIN_CHART_WIDTH, rect.width),
    height: Math.max(MIN_CHART_HEIGHT, rect.height),
    theme: EXPORT_CHART_THEME,
  });
  return canvas;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

// ---------------------------------------------------------------------------
// Theme & formatting helpers
// ---------------------------------------------------------------------------
function getLiveChartTheme() {
  return {
    background: cssVar("--chart-background", "#ffffff"),
    grid: cssVar("--line", "#d9dee6"),
    text: cssVar("--muted", "#5c6672"),
    emptyText: cssVar("--disabled", "#798391"),
    invertSeries: window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false,
  };
}

function getSeriesColor(series, theme) {
  return theme.invertSeries ? invertHexColor(series.color) : series.color;
}

function invertHexColor(color) {
  const match = String(color).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (!match) {
    return color;
  }

  const hex = match[1].length === 3
    ? match[1].split("").map((char) => char + char).join("")
    : match[1];
  const inverted = hex
    .match(/.{2}/g)
    .map((part) => (255 - Number.parseInt(part, 16)).toString(16).padStart(2, "0"))
    .join("");

  return `#${inverted}`;
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function scaleValue(value, fromMin, fromMax, toMin, toMax) {
  if (fromMin === fromMax) {
    return (toMin + toMax) / 2;
  }

  return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }

  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function formatExactNumber(value) {
  return Number.isFinite(value) ? String(value) : "--";
}

function formatXAxisValue(value, xMin, xMax) {
  if (state.timeMode === "elapsed") {
    return formatElapsed(value);
  }

  const date = new Date(value);
  const spansDates = new Date(xMin).toDateString() !== new Date(xMax).toDateString();

  if (spansDates || xMax - xMin >= 18 * 60 * 60 * 1000) {
    return `${date.toLocaleDateString([], { month: "numeric", day: "numeric" })} ${formatTime(date, false)}`;
  }

  return formatTime(date);
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return days ? `${days}d ${clock}` : clock;
}

function formatDateTime(date) {
  return `${date.toLocaleDateString()} ${formatTime(date)}`;
}

function formatTimeSpan(first, last) {
  if (first.toDateString() === last.toDateString()) {
    return `${first.toLocaleDateString()} ${formatTime(first)} → ${formatTime(last)}`;
  }

  return `${formatDateTime(first)} → ${formatDateTime(last)}`;
}

function formatTime(date, includeSeconds = true) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  });
}

function makeFileTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

function query(selector) {
  return app.querySelector(selector);
}

function bindChartHover() {
  const grid = query(".chart-grid");
  grid.addEventListener("pointermove", handleChartPointerMove);
  grid.addEventListener("pointerleave", clearChartHover);
}
