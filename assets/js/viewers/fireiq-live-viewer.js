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

const DEFAULT_BAUD_RATE = 9600;
const DEFAULT_TIMELINE_MINUTES = 5;
const MIN_TIMELINE_MINUTES = 0.25;
const MAX_TIMELINE_MINUTES = 1440;
const MAX_RECORDS_PER_POD = 2400;
const MIN_CHART_WIDTH = 220;
const MIN_CHART_HEIGHT = 104;
const POINT_RADIUS = 2.3;
const HOVER_RADIUS = 10;
const EXPORT_CHART_THEME = {
  background: "#ffffff",
  grid: "#d9dee6",
  text: "#5c6672",
  emptyText: "#798391",
  invertSeries: false,
};

const POD_KEYS = ["pod1", "pod2"];
const POD_COLORS = {
  pod1: "#228833",
  pod2: "#1965b0",
};
const FIELD_ALIASES = {
  timestamp: ["DateTime", "Timestamp", "Time"],
  co: ["CO", "Calibrated_CO"],
  co2: ["CO2", "ELT_CO2", "CO_2"],
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

const app = document.querySelector("[data-fire-iq-live-viewer]");
const state = {
  yamlResource: null,
  schema: null,
  displayWindowMs: DEFAULT_TIMELINE_MINUTES * 60 * 1000,
  renderQueued: false,
  hoverPoint: null,
  pods: {
    pod1: makePodState("POD 1"),
    pod2: makePodState("POD 2"),
  },
};

if (app) {
  showSafariLiveViewerWarning();
  init();
}

function makePodState(label) {
  return {
    label,
    records: [],
    serial: null,
    skipNextSerialLine: false,
    hasSuccessfulRead: false,
    statusMessage: "",
    statusRepeatCount: 0,
    max: { co: null, co2: null, pm25: null },
  };
}

async function init() {
  bindControls();
  await loadYamlSettings();
  renderDebugValues("pod1");
  renderDebugValues("pod2");
  updateLegends();

  if (!SerialLineReader.isSupported()) {
    POD_KEYS.forEach((podKey) => {
      setPodButtons(podKey, { connected: false });
      query(`[data-connect-pod="${podKey}"]`).disabled = true;
      setPodStatus(podKey, "Web Serial unavailable");
    });
  } else {
    POD_KEYS.forEach((podKey) => setPodStatus(podKey, "Idle"));
  }

  renderAll();
}

function bindControls() {
  app.querySelectorAll("[data-connect-pod]").forEach((button) => {
    button.addEventListener("click", () => connectPod(button.dataset.connectPod));
  });
  app.querySelectorAll("[data-disconnect-pod]").forEach((button) => {
    button.addEventListener("click", () => disconnectPod(button.dataset.disconnectPod));
  });
  app.querySelectorAll("[data-pod-id]").forEach((input) => {
    input.addEventListener("input", () => {
      updateLegends();
      queueRender();
    });
  });
  query("[data-reset]").addEventListener("click", resetData);
  query("[data-export-png]").addEventListener("click", exportGraphPng);
  query("[data-yaml-version]").addEventListener("change", handleVersionChange);
  query("[data-yaml-section]").addEventListener("change", applySelectedSchema);
  query("[data-timeline-minutes]").addEventListener("input", handleTimelineSizeChange);
  app.querySelectorAll("[data-plot-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", handlePlotToggle);
  });
  bindChartHover();
  window.addEventListener("resize", queueRender);
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener?.("change", queueRender);
}

function bindChartHover() {
  const grid = query(".chart-grid");
  grid.addEventListener("pointermove", handleChartPointerMove);
  grid.addEventListener("pointerleave", clearChartHover);
}

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
    setActiveSchema(schema, { reset: true });
  } catch (error) {
    query("[data-schema-status]").textContent = error.message || "Unable to load schema";
  }
}

function setActiveSchema(schema, { reset = false } = {}) {
  const schemaLink = query("[data-schema-link]");
  const schemaStatus = query("[data-schema-status]");
  state.schema = schema;
  schemaLink.href = schema.htmlUrl || YPOD_HEADER_LOG_PAGE;

  const suffix = schema.isFallback ? "fallback" : `${schema.columns.length} columns`;
  schemaStatus.textContent = `${schema.version} ${schema.section}, ${suffix}`;
  updateChartHeadings();
  renderDebugValues("pod1");
  renderDebugValues("pod2");

  if (reset) {
    resetData();
  }
}

async function connectPod(podKey) {
  const pod = state.pods[podKey];

  if (!pod || pod.serial) {
    return;
  }

  try {
    if (!state.schema) {
      await loadYamlSettings();
    }

    pod.serial = new SerialLineReader({
      baudRate: DEFAULT_BAUD_RATE,
      onLine: (line) => handleSerialLine(podKey, line),
      onStatus: (message) => setPodStatus(podKey, message),
      onError: (error) => handleSerialError(podKey, error),
      onDisconnect: () => handleSerialDisconnect(podKey),
    });

    setPodButtons(podKey, { connecting: true });
    pod.skipNextSerialLine = true;
    pod.hasSuccessfulRead = false;
    setPodStatus(podKey, "Opening serial port...");
    await pod.serial.connect();
    setPodButtons(podKey, { connected: true });
    setPodStatus(podKey, "Waiting for serial data...");
  } catch (error) {
    pod.serial = null;
    pod.hasSuccessfulRead = false;
    setPodButtons(podKey, { connected: false });
    setPodStatus(podKey, error.message || "Connection failed");
  }
}

async function disconnectPod(podKey) {
  const pod = state.pods[podKey];

  if (!pod) {
    return;
  }

  await pod.serial?.disconnect();
  pod.serial = null;
  pod.skipNextSerialLine = false;
  pod.hasSuccessfulRead = false;
  setPodButtons(podKey, { connected: false });
}

function handleSerialError(podKey, error) {
  setPodStatus(podKey, error.message || "Serial read error");
}

function handleSerialDisconnect(podKey) {
  const pod = state.pods[podKey];
  pod.serial = null;
  pod.skipNextSerialLine = false;
  pod.hasSuccessfulRead = false;
  setPodButtons(podKey, { connected: false });
}

function handleTimelineSizeChange(event) {
  const minutes = clampNumber(
    Number(event.target.value),
    MIN_TIMELINE_MINUTES,
    MAX_TIMELINE_MINUTES,
    DEFAULT_TIMELINE_MINUTES,
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
  const pointer = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const hoverPoint = findNearestChartPoint(canvas, chart, pointer);
  const previousCanvasId = state.hoverPoint?.canvasId || "";

  state.hoverPoint = hoverPoint ? { ...hoverPoint, canvasId: canvas.id } : null;
  canvas.style.cursor = hoverPoint ? "crosshair" : "";
  renderChart(card, chart);

  if (previousCanvasId && previousCanvasId !== canvas.id) {
    renderCanvasById(previousCanvasId);
  }
}

function clearChartHover() {
  const previousCanvasId = state.hoverPoint?.canvasId || "";
  state.hoverPoint = null;

  query(".chart-grid")
    .querySelectorAll("canvas")
    .forEach((canvas) => {
      canvas.style.cursor = "";
    });

  if (previousCanvasId) {
    renderCanvasById(previousCanvasId);
  }
}

function renderCanvasById(canvasId) {
  const canvas = query(".chart-grid").querySelector(`#${canvasId}`);
  const card = canvas?.closest("[data-chart-card]");
  const chart = CHARTS[card?.dataset.chartCard];

  if (card && chart && !card.hidden) {
    renderChart(card, chart);
  }
}

function handleSerialLine(podKey, line) {
  const pod = state.pods[podKey];
  const receivedAt = new Date();
  const values = parseCsvLine(line);
  updateRawDebugReadout(podKey, line, values);

  if (isHeaderRow(values)) {
    setPodStatus(podKey, "Header received");
    return;
  }

  if (pod.skipNextSerialLine && !isCsvLikeLine(line, values)) {
    pod.skipNextSerialLine = false;
    setPodStatus(podKey, line);
    return;
  }

  pod.skipNextSerialLine = false;

  const record = mapSerialValues(values, line, receivedAt);

  if (!record) {
    reportPodSerialNotice(podKey, line, values);
    return;
  }

  markReadSuccessful(podKey);
  pod.records.push(record);

  if (pod.records.length > MAX_RECORDS_PER_POD) {
    pod.records.splice(0, pod.records.length - MAX_RECORDS_PER_POD);
  }

  updateMaxima(podKey, record);
  updateReadout(podKey, record);
  queueRender();
}

function markReadSuccessful(podKey) {
  const pod = state.pods[podKey];

  if (pod.hasSuccessfulRead) {
    return;
  }

  pod.hasSuccessfulRead = true;
  setPodStatus(podKey, "Connected");
}

function mapSerialValues(values, rawLine, receivedAt = new Date()) {
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
    setActiveSchema(schema, { reset: false });
  }

  const fields = {};
  schema.columns.forEach((column, index) => {
    fields[column.name] = normalizedValues[index] ?? "";
  });

  return {
    timestamp: receivedAt,
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

function selectSchemaControls(schema) {
  const versionSelect = query("[data-yaml-version]");
  const sectionSelect = query("[data-yaml-section]");

  versionSelect.value = schema.version;
  populateSectionSelect();
  sectionSelect.value = schema.section;
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

function formatFieldLabel(fieldName) {
  return fieldName
    .replace(/^Fig2600_/, "")
    .replace(/^Fig2602_/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bPM25\b/g, "PM2.5")
    .replace(/\bCO2\b/g, "CO2")
    .replace(/\bVOC\b/g, "VOC");
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
  return first === "datetime" || first === "timestamp";
}

function isCsvLikeLine(line, values = parseCsvLine(line)) {
  return line.includes(",") || values.length > 1;
}

function reportPodSerialNotice(podKey, line, values) {
  if (isCsvLikeLine(line, values)) {
    return;
  }

  setPodStatus(podKey, line);
}

function updateMaxima(podKey, record) {
  const pod = state.pods[podKey];

  ["co", "co2", "pm25"].forEach((key) => {
    const value = record.values[key];

    if (!Number.isFinite(value)) {
      return;
    }

    pod.max[key] = Number.isFinite(pod.max[key]) ? Math.max(pod.max[key], value) : value;
  });
}

function resetData() {
  state.hoverPoint = null;
  POD_KEYS.forEach((podKey) => {
    const pod = state.pods[podKey];
    pod.records = [];
    pod.max = { co: null, co2: null, pm25: null };
    query(`[data-row-count="${podKey}"]`).textContent = "0";
    query(`[data-last-time="${podKey}"]`).textContent = "--";
    query(`[data-latest-line="${podKey}"]`).textContent = "--";
    renderDebugValues(podKey);
  });
  app.querySelectorAll("[data-chart-stats]").forEach((stats) => {
    stats.textContent = "--";
  });
  app.querySelectorAll("[data-metric]").forEach((metric) => {
    metric.textContent = "--";
  });
  renderAll();
}

function updateReadout(podKey, record) {
  const pod = state.pods[podKey];
  query(`[data-row-count="${podKey}"]`).textContent = String(pod.records.length);
  query(`[data-last-time="${podKey}"]`).textContent = formatTime(record.timestamp);
  renderDebugValues(podKey, record);

  setMetric(`${podKey}-co`, record.values.co, getFieldUnit("co", "ppm"));
  setMetric(`${podKey}-co2`, record.values.co2, getFieldUnit("co2", "ppm"));
  setMetric(`${podKey}-pm25`, record.values.pm25, getFieldUnit("pm25", "ug/m^3"));
}

function updateRawDebugReadout(podKey, line, values) {
  query(`[data-latest-line="${podKey}"]`).textContent = line;
  renderDebugValues(podKey, null, values);
}

function renderDebugValues(podKey, record = null, values = null) {
  const target = query(`[data-debug-values="${podKey}"]`);
  const columns = state.schema?.columns || [];
  const fragment = document.createDocumentFragment();

  columns.forEach((column, index) => {
    const item = document.createElement("div");
    const name = document.createElement("span");
    const value = document.createElement("code");
    const rawValue = record?.fields?.[column.name] ?? values?.[index];

    item.className = "debug-value";
    name.textContent = formatFieldLabel(column.name);
    value.textContent = rawValue === undefined || rawValue === "" ? "--" : rawValue;

    item.append(name, value);
    fragment.append(item);
  });

  target.replaceChildren(fragment);
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
    hoverPoint: state.hoverPoint?.canvasId === canvas.id ? state.hoverPoint : null,
  });
}

function renderChartCanvas(canvas, chart, {
  width,
  height,
  scale = 1,
  theme,
  updateStats = false,
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

  if (hoverPoint) {
    drawHoverTooltip(context, hoverPoint, width, height, theme);
  }

  if (updateStats) {
    updateChartStats(chart);
  }
}

function findNearestChartPoint(canvas, chart, pointer) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(MIN_CHART_WIDTH, rect.width);
  const height = Math.max(MIN_CHART_HEIGHT, rect.height);
  const chartUnit = getChartUnit(chart);
  const recordsByPod = visibleRecordsByPod();
  const seriesValues = chart.series.flatMap((series) =>
    recordsByPod[series.podKey]
      .map((record) => record.values[series.key])
      .filter((value) => Number.isFinite(value)),
  );
  const visibleRecords = POD_KEYS.flatMap((podKey) => recordsByPod[podKey]);

  if (visibleRecords.length === 0 || seriesValues.length === 0) {
    return null;
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
  const points = chart.series.flatMap((series) =>
    recordsByPod[series.podKey]
      .map((record) => {
        const value = record.values[series.key];
        const column = resolveColumnForField(series.key);

        if (!Number.isFinite(value)) {
          return null;
        }

        return {
          x: scaleValue(record.timestamp.getTime(), xMin, xMax, plot.left, plot.right),
          y: scaleValue(value, yRange.min, yRange.max, plot.bottom, plot.top),
          value,
          displayValue: column && record.fields?.[column.name] !== ""
            ? record.fields?.[column.name]
            : formatExactNumber(value),
          timestamp: record.timestamp,
          label: `${getPodDisplayName(series.podKey)} ${chart.title}`,
          unit: chartUnit,
          color: getSeriesColor(series, getLiveChartTheme()),
        };
      })
      .filter(Boolean),
  );

  return nearestPoint(points, pointer);
}

function visibleRecordsByPod() {
  const latest = Math.max(
    ...POD_KEYS.map((podKey) => {
      const records = state.pods[podKey].records;
      return records[records.length - 1]?.timestamp.getTime() ?? Number.NEGATIVE_INFINITY;
    }),
  );

  if (!Number.isFinite(latest)) {
    return Object.fromEntries(POD_KEYS.map((podKey) => [podKey, []]));
  }

  return Object.fromEntries(
    POD_KEYS.map((podKey) => [
      podKey,
      state.pods[podKey].records.filter(
        (record) => latest - record.timestamp.getTime() <= state.displayWindowMs,
      ),
    ]),
  );
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
  context.fillStyle = color;
  usableRecords.forEach((record) => {
    const x = scaleValue(record.timestamp.getTime(), xMin, xMax, plot.left, plot.right);
    const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);
    context.beginPath();
    context.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
    context.fill();
  });
}

function nearestPoint(points, pointer) {
  let nearest = null;
  let nearestDistance = HOVER_RADIUS;

  points.forEach((point) => {
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);

    if (distance <= nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });

  return nearest;
}

function drawHoverTooltip(context, point, width, height, theme) {
  const lines = [
    point.label,
    `${point.displayValue || formatExactNumber(point.value)}${point.unit ? ` ${point.unit}` : ""}`,
    formatTime(point.timestamp),
  ];
  const padding = 8;
  const lineHeight = 15;
  context.save();
  context.font = "12px Arial, Helvetica, sans-serif";
  const tooltipWidth = Math.ceil(Math.max(...lines.map((line) => context.measureText(line).width)) + padding * 2);
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

  context.fillStyle = "rgba(17, 24, 39, 0.92)";
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

function formatExactNumber(value) {
  return Number.isFinite(value) ? String(value) : "--";
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
  context.fillText("Awaiting data", 14, 24);
}

function updateChartStats(chart) {
  const parts = chart.series
    .map((series) => {
      const value = state.pods[series.podKey].max[series.key];
      return Number.isFinite(value) ? `${getPodDisplayName(series.podKey)} max ${formatNumber(value)}` : "";
    })
    .filter(Boolean);

  query(`[data-chart-stats="${chart.stats}"]`).textContent = parts.length ? parts.join(" | ") : "--";
}

function updateLegends() {
  Object.values(CHARTS).forEach((chart) => {
    const legend = query(`[data-chart-legend="${chart.stats}"]`);

    if (!legend) {
      return;
    }

    legend.replaceChildren(
      ...chart.series.map((series) => makeLegendItem(series.color, getPodDisplayName(series.podKey))),
    );
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

function exportGraphPng() {
  renderAll();

  const grid = app.querySelector(".chart-grid");
  const cards = [...grid.querySelectorAll(".chart-card:not([hidden])")];

  if (cards.length === 0) {
    setAllPodStatus("No visible plots to export");
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
  link.download = `fire-iq-live-view-${makeFileTimestamp()}.png`;
  link.click();
  setAllPodStatus("Graph PNG exported");
}

function drawExportHeader(context, width, padding) {
  const schemaStatus = query("[data-schema-status]").textContent;
  context.fillStyle = "#17202a";
  context.font = "700 22px Arial, Helvetica, sans-serif";
  context.fillText("Fire-IQ Dual-POD Live Visualization", padding, 34);

  context.fillStyle = "#5c6672";
  context.font = "13px Arial, Helvetica, sans-serif";
  context.fillText(`Exported ${new Date().toLocaleString()}`, padding, 58);
  context.fillText(schemaStatus, padding, 76);

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

function setPodButtons(podKey, { connecting = false, connected = false }) {
  query(`[data-connect-pod="${podKey}"]`).disabled =
    connecting || connected || !SerialLineReader.isSupported();
  query(`[data-disconnect-pod="${podKey}"]`).disabled = !connected;
}

function setPodStatus(podKey, message) {
  const pod = state.pods[podKey];

  if (message === pod.statusMessage) {
    pod.statusRepeatCount += 1;
  } else {
    pod.statusMessage = message;
    pod.statusRepeatCount = 1;
  }

  const suffix = pod.statusRepeatCount > 1 ? ` (x${pod.statusRepeatCount})` : "";
  query(`[data-pod-status="${podKey}"]`).textContent = `${message}${suffix}`;
}

function setAllPodStatus(message) {
  POD_KEYS.forEach((podKey) => setPodStatus(podKey, message));
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
