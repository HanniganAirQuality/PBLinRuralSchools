// Fire-IQ Data Plotter — loads YPOD CSV logs and plots CO / CO2 / PM2.5
// for up to two pods. Column-to-pollutant mapping is driven by the YPOD
// header-log YAML (firmware version + section), shared with the Live Viewer
// via core/ypod-yaml.js.
import { showSafariLiveViewerWarning } from "../core/browser-warning.js";
import { SerialLineReader } from "../core/serial-lines.js";
import {
  YPOD_HEADER_LOG_PAGE,
  getPreferredYpodSection,
  getPreferredYpodVersion,
  getYpodSectionSchema,
  loadYpodHeaderLogResource,
  resolveYpodSchemaForValues,
} from "../core/ypod-yaml.js";

const DEFAULT_WINDOW_MINUTES = 0; // 0 = show entire file
const MAX_WINDOW_MINUTES = 1440;
const MIN_CHART_WIDTH = 220;
const MIN_CHART_HEIGHT = 104;
const POINT_RADIUS = 2.3;
const MAX_POINT_MARKERS = 240; // skip per-sample dots on dense files
const EXPORT_CHART_THEME = {
  background: "#ffffff",
  grid: "#d9dee6",
  text: "#5c6672",
  emptyText: "#798391",
  invertSeries: false,
};

const POD_KEYS = ["pod1", "pod2"];
const POD_COLORS = {
  pod1: "#f46703",
  pod2: "#efad3c",
};
const FIELD_ALIASES = {
  timestamp: ["DateTime", "Timestamp", "Time", "UnixTime", "Millis"],
  date: ["Date"],
  co: ["CO", "Calibrated_CO", "CO_ISB"],
  co2: ["CO2", "ELT_CO2", "CO_2", "K30_CO2"],
  pm25: ["PM25_ENV", "PM2_5", "PM25", "PM2.5"],
};

const CHARTS = {
  co: {
    canvas: "chart-co",
    stats: "co",
    title: "Carbon Monoxide",
    unit: "ppm",
    minZero: true,
    series: [
      { podKey: "pod1", key: "co", color: POD_COLORS.pod1 },
      { podKey: "pod2", key: "co", color: POD_COLORS.pod2 },
    ],
  },
  co2: {
    canvas: "chart-co2",
    stats: "co2",
    title: "Carbon Dioxide",
    unit: "ppm",
    minZero: true,
    series: [
      { podKey: "pod1", key: "co2", color: POD_COLORS.pod1 },
      { podKey: "pod2", key: "co2", color: POD_COLORS.pod2 },
    ],
  },
  pm25: {
    canvas: "chart-pm25",
    stats: "pm25",
    title: "Particulate Matter 2.5",
    unit: "ug/m^3",
    minZero: true,
    series: [
      { podKey: "pod1", key: "pm25", color: POD_COLORS.pod1 },
      { podKey: "pod2", key: "pm25", color: POD_COLORS.pod2 },
    ],
  },
};

const app = document.querySelector("[data-fire-iq-data-plotter]");
const state = {
  yamlResource: null,
  schema: null,
  displayWindowMs: DEFAULT_WINDOW_MINUTES * 60 * 1000,
  podCount: 2,
  renderQueued: false,
  pods: {
    pod1: makePodState("POD 1"),
    pod2: makePodState("POD 2"),
  },
};

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
    input.addEventListener("input", queueRender);
  });
  app.querySelectorAll("[data-pod-count] input[name='pod-count']").forEach((radio) => {
    radio.addEventListener("change", () => setPodCount(Number(radio.value)));
  });
  query("[data-reset]").addEventListener("click", resetData);
  query("[data-export-png]").addEventListener("click", exportGraphPng);
  query("[data-yaml-version]").addEventListener("change", handleVersionChange);
  query("[data-yaml-section]").addEventListener("change", applySelectedSchema);
  query("[data-window-minutes]").addEventListener("input", handleWindowChange);
  app.querySelectorAll("[data-plot-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", handlePlotToggle);
  });
  window.addEventListener("resize", queueRender);
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener?.("change", queueRender);
}

// ---------------------------------------------------------------------------
// YAML schema (firmware version -> column layout)
// ---------------------------------------------------------------------------
async function loadYamlSettings() {
  query("[data-schema-status]").textContent = "Loading YPOD schema...";
  state.yamlResource = await loadYpodHeaderLogResource();
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
  schemaLink.href = schema.htmlUrl || YPOD_HEADER_LOG_PAGE;

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

  const lines = pod.rawText.split(/\r?\n/).filter((line) => line.trim() !== "");

  for (const line of lines) {
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

    const record = mapFileValues(values, line);

    if (record) {
      pod.records.push(record);
    } else {
      pod.skippedRows += 1;
    }
  }

  pod.records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  updateFileReadout(podKey);
}

function mapFileValues(values, rawLine) {
  if (!state.schema?.columns?.length || values.length === 0) {
    return null;
  }

  const resolved = resolveYpodSchemaForValues(state.yamlResource, state.schema, values);

  if (!resolved || !hasRequiredChartFields(resolved.schema)) {
    return null;
  }

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
    rawLine,
    fields,
    values: {
      co: numberField(fields, FIELD_ALIASES.co),
      co2: numberField(fields, FIELD_ALIASES.co2),
      pm25: numberField(fields, FIELD_ALIASES.pm25),
    },
  };
}

function hasRequiredChartFields(schema) {
  return ["co", "co2", "pm25"].every((key) =>
    Boolean(resolveColumnForField(key, schema.columns)),
  );
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
  const value = Number(getField(fields, aliases));
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
  return ["datetime", "timestamp", "date", "time", "unixtime", "millis"].includes(first);
}

function isCsvLikeLine(line, values = parseCsvLine(line)) {
  return line.includes(",") || values.length > 1;
}

// ---------------------------------------------------------------------------
// Pod controls & readouts
// ---------------------------------------------------------------------------
function setPodCount(count) {
  state.podCount = count === 1 ? 1 : 2;
  const singleMode = state.podCount === 1;

  app.querySelectorAll('[data-pod-section="pod2"]').forEach((element) => {
    element.toggleAttribute("hidden", singleMode);
  });

  if (singleMode && state.pods.pod2.records.length) {
    clearPod("pod2");
  }

  queueRender();
}

function activePodKeys() {
  return state.podCount === 1 ? ["pod1"] : POD_KEYS;
}

function clearPod(podKey) {
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
    first && last ? `${formatTime(first.timestamp)} → ${formatTime(last.timestamp)}` : "--";
}

function handleWindowChange(event) {
  const minutes = clampNumber(
    Number(event.target.value),
    0,
    MAX_WINDOW_MINUTES,
    DEFAULT_WINDOW_MINUTES,
  );
  state.displayWindowMs = minutes * 60 * 1000;
  queueRender();
}

function handlePlotToggle() {
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

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------
function visibleRecordsByPod() {
  const active = activePodKeys();

  return Object.fromEntries(
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
  updateLegends();
  updateMetrics();

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
        renderChart(card, chart);
      }
    });
}

function renderChart(card, chart) {
  const canvas = card.querySelector("canvas");
  const rect = canvas.getBoundingClientRect();

  renderChartCanvas(canvas, chart, {
    width: Math.max(MIN_CHART_WIDTH, rect.width),
    height: Math.max(MIN_CHART_HEIGHT, rect.height),
    scale: window.devicePixelRatio || 1,
    theme: getLiveChartTheme(),
    updateStats: true,
  });
}

function renderChartCanvas(canvas, chart, {
  width,
  height,
  scale = 1,
  theme,
  updateStats = false,
}) {
  const context = canvas.getContext("2d");
  const chartUnit = getChartUnit(chart);

  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);

  const recordsByPod = visibleRecordsByPod();
  const seriesValues = chart.series.flatMap((series) =>
    recordsByPod[series.podKey]
      .map((record) => record.values[series.key])
      .filter((value) => Number.isFinite(value)),
  );
  const visibleRecords = POD_KEYS.flatMap((podKey) => recordsByPod[podKey]);

  if (visibleRecords.length === 0 || seriesValues.length === 0) {
    drawEmptyChart(context, width, theme);
    if (updateStats) {
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
  const times = visibleRecords.map((record) => record.timestamp.getTime());
  let xMin = Math.min(...times);
  let xMax = Math.max(...times);

  if (xMin === xMax) {
    xMin -= 30000;
    xMax += 30000;
  }

  const yRange = getYRange(seriesValues, chart.minZero);

  drawGrid(context, plot, width, height, xMin, xMax, yRange, theme, {
    leftLabel: chartUnit,
  });

  chart.series.forEach((series) => {
    drawSeries(context, recordsByPod[series.podKey], series, plot, xMin, xMax, yRange, theme);
  });

  if (updateStats) {
    updateChartStats(chart, recordsByPod);
  }
}

function getYRange(values, minZero = false) {
  let min = Math.min(...values);
  let max = Math.max(...values);

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

    const time = new Date(xMin + (xMax - xMin) * ratio);
    drawCenteredXAxisLabel(context, formatTime(time), x, width, height - 9);
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
  const usableRecords = records.filter((record) => Number.isFinite(record.values[series.key]));

  if (usableRecords.length === 0) {
    return;
  }

  const color = getSeriesColor(series, theme);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  usableRecords.forEach((record, index) => {
    const x = scaleValue(record.timestamp.getTime(), xMin, xMax, plot.left, plot.right);
    const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();

  if (usableRecords.length > MAX_POINT_MARKERS) {
    return;
  }

  context.fillStyle = color;
  usableRecords.forEach((record) => {
    const x = scaleValue(record.timestamp.getTime(), xMin, xMax, plot.left, plot.right);
    const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);
    context.beginPath();
    context.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
    context.fill();
  });
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

function updateChartStats(chart, recordsByPod = visibleRecordsByPod()) {
  const parts = chart.series
    .map((series) => {
      const values = recordsByPod[series.podKey]
        .map((record) => record.values[series.key])
        .filter((value) => Number.isFinite(value));

      if (values.length === 0) {
        return "";
      }

      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      return `${getPodDisplayName(series.podKey)}: min ${formatNumber(min)} / avg ${formatNumber(avg)} / max ${formatNumber(max)}`;
    })
    .filter(Boolean);

  query(`[data-chart-stats="${chart.stats}"]`).textContent = parts.length ? parts.join(" | ") : "--";
}

function updateMetrics() {
  const recordsByPod = visibleRecordsByPod();

  POD_KEYS.forEach((podKey) => {
    const records = recordsByPod[podKey];
    const last = records[records.length - 1];

    setMetric(`${podKey}-co`, last?.values.co, getFieldUnit("co", "ppm"));
    setMetric(`${podKey}-co2`, last?.values.co2, getFieldUnit("co2", "ppm"));
    setMetric(`${podKey}-pm25`, last?.values.pm25, getFieldUnit("pm25", "ug/m^3"));
  });
}

function setMetric(name, value, unit) {
  const target = query(`[data-metric="${name}"]`);
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
      .map((series) => makeLegendItem(series.color, getPodDisplayName(series.podKey)));

    legend.replaceChildren(...items);
  });
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
  link.download = `fire-iq-plots-${makeFileTimestamp()}.png`;
  link.click();
}

function drawExportHeader(context, width, padding) {
  const schemaStatus = query("[data-schema-status]").textContent;
  const fileSummary = activePodKeys()
    .filter((podKey) => state.pods[podKey].fileName)
    .map((podKey) => `${getPodDisplayName(podKey)}: ${state.pods[podKey].fileName}`)
    .join("   ");

  context.fillStyle = "#17202a";
  context.font = "700 22px Arial, Helvetica, sans-serif";
  context.fillText("Fire-IQ Dual-POD Data Plotter", padding, 34);

  context.fillStyle = "#5c6672";
  context.font = "13px Arial, Helvetica, sans-serif";
  context.fillText(`Exported ${new Date().toLocaleString()} — ${schemaStatus}`, padding, 58);
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

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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