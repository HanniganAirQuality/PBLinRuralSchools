import { showSafariLiveViewerWarning } from "../core/browser-warning.js";
import { SerialLineReader } from "../core/serial-lines.js";
import {
  YPOD_HEADER_LOG_PAGE,
  getYpodSectionSchema,
  loadYpodHeaderLogResource,
} from "../core/ypod-yaml.js";

const DEFAULT_BAUD_RATE = 9600;
const DEFAULT_TIMELINE_MINUTES = 5;
const MIN_TIMELINE_MINUTES = 0.25;
const MAX_TIMELINE_MINUTES = 1440;
const MAX_RECORDS = 2400;
const MIN_CHART_WIDTH = 220;
const MIN_CHART_HEIGHT = 88;
const CHART_DRAG_MIME = "application/x-haq-chart-card";
const COLUMN_CHART_COLORS = [
  "#0f766e",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#16a34a",
  "#db2777",
  "#4f46e5",
];
const EXPORT_CHART_THEME = {
  background: "#ffffff",
  grid: "#d9dee6",
  text: "#5c6672",
  emptyText: "#798391",
  invertSeries: false,
};

const FIELD_ALIASES = {
  timestamp: ["DateTime", "Timestamp", "Time"],
  temperature: ["Temperature", "SHT25_Temperature", "BME180_Temperature", "T"],
  humidity: ["Relative_Humidity", "SHT25_Humidity", "RH"],
  co2: ["CO2", "ELT_CO2", "CO_2"],
  pm25: ["PM25_ENV", "PM2_5", "PM25", "PM2.5"],
  vocLight: ["Fig2600_LightVOC", "LightVOC", "lightVOC"],
  vocHeavy: ["Fig2602_HeavyVOC", "HeavyVOC", "heavyVOC"],
  co: ["Calibrated_CO"],
};

const CHARTS = {
  temperature: {
    canvas: "chart-temperature",
    stats: "temperature",
    marker: true,
    series: [{ key: "temperature", color: "#111827" }],
  },
  humidity: {
    canvas: "chart-humidity",
    stats: "humidity",
    marker: true,
    series: [{ key: "humidity", color: "#54b6ff" }],
  },
  voc: {
    canvas: "chart-voc",
    stats: "voc",
    series: [
      { key: "vocLight", color: "#3ac831" },
      { key: "vocHeavy", color: "#02580e" },
    ],
  },
  co2: {
    canvas: "chart-co2",
    stats: "co2",
    series: [{ key: "co2", color: "#fe7243" }],
  },
  co: {
    canvas: "chart-co",
    stats: "co",
    series: [{ key: "co", color: "#7da9ff" }],
  },
  pm25: {
    canvas: "chart-pm25",
    stats: "pm25",
    minZero: true,
    series: [{ key: "pm25", color: "#74ebda" }],
  },
};

const app = document.querySelector("[data-live-viewer]");
const state = {
  yamlResource: null,
  schema: null,
  records: [],
  serial: null,
  skipNextSerialLine: false,
  renderQueued: false,
  displayWindowMs: DEFAULT_TIMELINE_MINUTES * 60 * 1000,
  draggingChartKey: null,
  hasSuccessfulRead: false,
  statusMessage: "",
  statusRepeatCount: 0,
};

if (app) {
  showSafariLiveViewerWarning();
  init();
}

async function init() {
  bindControls();

  if (!SerialLineReader.isSupported()) {
    query("[data-connect]").disabled = true;
    setStatus("Web Serial unavailable");
  } else {
    setStatus("Idle");
  }

  await loadYamlSettings();
  handlePlotToggle();
  renderAll();
}

function bindControls() {
  query("[data-connect]").addEventListener("click", connectSerial);
  query("[data-disconnect]").addEventListener("click", disconnectSerial);
  query("[data-reset]").addEventListener("click", resetData);
  query("[data-export-png]").addEventListener("click", exportGraphPng);
  query("[data-yaml-version]").addEventListener("change", handleVersionChange);
  query("[data-yaml-section]").addEventListener("change", applySelectedSchema);
  query("[data-timeline-minutes]").addEventListener("input", handleTimelineSizeChange);
  app.querySelectorAll("[data-plot-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", handlePlotToggle);
  });
  query("[data-column-toggles]").addEventListener("change", handleColumnPlotToggle);
  bindChartDragReordering();
  window.addEventListener("resize", queueRender);
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener?.("change", queueRender);
}

function bindChartDragReordering() {
  const grid = query(".chart-grid");
  grid.addEventListener("dragstart", handleChartDragStart);
  grid.addEventListener("dragover", handleChartDragOver);
  grid.addEventListener("dragleave", handleChartDragLeave);
  grid.addEventListener("drop", handleChartDrop);
  grid.addEventListener("dragend", handleChartDragEnd);
  refreshDraggableChartCards();
}

function refreshDraggableChartCards() {
  query(".chart-grid")
    .querySelectorAll(".chart-card")
    .forEach(prepareChartCardDrag);
}

function prepareChartCardDrag(card) {
  card.draggable = true;
  card.setAttribute("aria-grabbed", "false");
}

async function loadYamlSettings() {
  query("[data-schema-status]").textContent = "Loading Serial_Calibrate schema...";
  state.yamlResource = await loadYpodHeaderLogResource();
  populateVersionSelect();
  populateSectionSelect();
  applySelectedSchema();
}

function populateVersionSelect() {
  const select = query("[data-yaml-version]");
  const versions = state.yamlResource?.index || [];
  select.innerHTML = "";

  versions.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.version;
    option.textContent = item.version;
    select.append(option);
  });
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

  if (sections.includes(previous)) {
    select.value = previous;
  } else if (sections.includes("Serial_Calibrate")) {
    select.value = "Serial_Calibrate";
  }
}

function handleVersionChange() {
  populateSectionSelect();
  applySelectedSchema();
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

function applySelectedSchema() {
  const schemaLink = query("[data-schema-link]");
  const schemaStatus = query("[data-schema-status]");
  const version = query("[data-yaml-version]").value;
  const section = query("[data-yaml-section]").value;

  try {
    const schema = getYpodSectionSchema(state.yamlResource, version, section);
    state.schema = schema;
    schemaLink.href = schema.htmlUrl || YPOD_HEADER_LOG_PAGE;

    const suffix = schema.isFallback ? "fallback" : `${schema.columns.length} columns`;
    schemaStatus.textContent = `${schema.version} ${schema.section}, ${suffix}`;
    renderColumnToggles();
    updateLegends();
    resetData();
  } catch (error) {
    schemaStatus.textContent = error.message || "Unable to load schema";
  }
}

function renderColumnToggles() {
  const target = query("[data-column-toggles]");
  const checkedColumns = new Set(
    [...target.querySelectorAll("[data-column-plot-toggle]:checked")]
      .map((toggle) => toggle.dataset.columnName),
  );
  const fragment = document.createDocumentFragment();

  state.schema?.columns
    ?.map((column, index) => ({ column, index }))
    .filter((item) => !isTimestampColumn(item.column))
    .forEach(({ column, index }) => {
      const label = document.createElement("label");
      const input = document.createElement("input");

      input.type = "checkbox";
      input.value = String(index);
      input.dataset.columnPlotToggle = "";
      input.dataset.columnName = column.name;
      input.checked = checkedColumns.has(column.name);

      label.append(input, document.createTextNode(formatFieldLabel(column.name)));
      fragment.append(label);
    });

  target.replaceChildren(fragment);
  syncColumnChartCards();
}

function updateLegends() {
  Object.entries(CHARTS).forEach(([key, chart]) => {
    const target = app.querySelector(`[data-chart-legend="${key}"]`);

    if (!target) {
      return;
    }

    target.replaceChildren(
      ...chart.series
        .map((series) => ({
          series,
          column: resolveColumnForSeries(series.key),
        }))
        .filter((item) => item.column)
        .map((item) => makeLegendItem(item.series.color, item.column.name)),
    );
  });
}

function resolveColumnForSeries(seriesKey) {
  const directSeries = Object.values(getAllCharts())
    .flatMap((chart) => chart.series)
    .find((series) => series.key === seriesKey);

  if (Number.isInteger(directSeries?.columnIndex)) {
    return state.schema?.columns?.[directSeries.columnIndex] || null;
  }

  const aliases = FIELD_ALIASES[seriesKey] || [];
  const columns = state.schema?.columns || [];
  const preferredField = directSeries?.preferredField;

  if (preferredField) {
    const preferredColumn = columns.find((column) => column.name === preferredField);

    if (preferredColumn) {
      return preferredColumn;
    }
  }

  return aliases
    .map((alias) => columns.find((column) => column.name === alias))
    .find(Boolean);
}

function makeLegendItem(color, fieldName) {
  const item = document.createElement("span");
  const swatch = document.createElement("i");
  swatch.style.setProperty("--swatch", color);
  swatch.style.setProperty("--swatch-dark", invertHexColor(color));
  item.append(swatch, document.createTextNode(formatFieldLabel(fieldName)));
  return item;
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

async function connectSerial() {
  try {
    if (!state.schema) {
      await loadYamlSettings();
    }

    state.serial = new SerialLineReader({
      baudRate: DEFAULT_BAUD_RATE,
      onLine: handleSerialLine,
      onStatus: setStatus,
      onError: handleSerialError,
      onDisconnect: handleSerialDisconnect,
    });

    setButtons({ connecting: true });
    state.skipNextSerialLine = true;
    state.hasSuccessfulRead = false;
    setStatus("Opening serial port...");
    await state.serial.connect();
    setButtons({ connected: true });
    setStatus("Waiting for serial data...");
  } catch (error) {
    setButtons({ connected: false });
    state.serial = null;
    state.hasSuccessfulRead = false;
    setStatus(error.message || "Connection failed");
  }
}

async function disconnectSerial() {
  await state.serial?.disconnect();
  state.serial = null;
  state.skipNextSerialLine = false;
  state.hasSuccessfulRead = false;
  setButtons({ connected: false });
}

function handleSerialError(error) {
  setStatus(error.message || "Serial read error");
}

function handleSerialDisconnect() {
  state.serial = null;
  state.skipNextSerialLine = false;
  state.hasSuccessfulRead = false;
  setButtons({ connected: false });
}

function handlePlotToggle() {
  app.querySelectorAll("[data-plot-toggle]").forEach((toggle) => {
    const card = app.querySelector(`[data-chart-card="${toggle.value}"]`);

    if (card) {
      card.toggleAttribute("hidden", !toggle.checked);
      card.setAttribute("aria-hidden", String(!toggle.checked));
    }
  });

  queueRender();
}

function handleColumnPlotToggle(event) {
  if (!event.target.matches("[data-column-plot-toggle]")) {
    return;
  }

  syncColumnChartCards();
  queueRender();
}

function syncColumnChartCards() {
  const grid = query(".chart-grid");
  const selectedCharts = getSelectedColumnCharts();
  const selectedKeys = new Set(selectedCharts.map((chart) => chart.key));

  app.querySelectorAll("[data-dynamic-chart-card]").forEach((card) => {
    if (!selectedKeys.has(card.dataset.chartCard)) {
      card.remove();
    }
  });

  selectedCharts.forEach((chart) => {
    if (app.querySelector(`[data-chart-card="${chart.key}"]`)) {
      return;
    }

    const card = makeColumnChartCard(chart);
    prepareChartCardDrag(card);
    grid.append(card);
  });
}

function makeColumnChartCard(chart) {
  const card = document.createElement("article");
  const heading = document.createElement("div");
  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  const unit = document.createElement("span");
  const stats = document.createElement("span");
  const canvas = document.createElement("canvas");

  card.className = "chart-card";
  card.dataset.chartCard = chart.key;
  card.dataset.dynamicChartCard = "";
  heading.className = "chart-heading";

  title.append(document.createTextNode(chart.title));
  if (chart.unit) {
    unit.textContent = ` [${chart.unit}]`;
    title.append(unit);
  }

  stats.dataset.chartStats = chart.stats;
  stats.textContent = "--";
  canvas.id = chart.canvas;
  canvas.dataset.chart = chart.key;

  titleWrap.append(title);
  heading.append(titleWrap, stats);
  card.append(heading, canvas);
  return card;
}

function handleChartDragStart(event) {
  const grid = query(".chart-grid");
  const card = closestVisibleChartCard(event.target);

  if (!card || !grid.contains(card)) {
    return;
  }

  state.draggingChartKey = card.dataset.chartCard;
  card.classList.add("is-chart-dragging");
  card.setAttribute("aria-grabbed", "true");
  grid.classList.add("is-chart-drag-active");

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(CHART_DRAG_MIME, state.draggingChartKey);
  event.dataTransfer.setData(
    "text/plain",
    card.querySelector("h2")?.textContent?.trim() || state.draggingChartKey,
  );
}

function handleChartDragOver(event) {
  const grid = query(".chart-grid");
  const draggedCard = getDraggedChartCard(event);

  if (!draggedCard) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const target = closestVisibleChartCard(event.target);
  clearChartDropIndicators(target);

  if (!target || target === draggedCard || !grid.contains(target)) {
    return;
  }

  const placement = getChartDropPlacement(event, target, grid);
  target.classList.toggle("is-chart-drop-before", placement === "before");
  target.classList.toggle("is-chart-drop-after", placement === "after");
}

function handleChartDragLeave(event) {
  const grid = query(".chart-grid");
  const relatedTarget = event.relatedTarget;

  if (!(relatedTarget instanceof Node) || !grid.contains(relatedTarget)) {
    clearChartDropIndicators();
  }
}

function handleChartDrop(event) {
  const grid = query(".chart-grid");
  const draggedCard = getDraggedChartCard(event);

  if (!draggedCard) {
    return;
  }

  event.preventDefault();

  const target = closestVisibleChartCard(event.target);
  const didMove = moveDraggedChartCard(event, grid, draggedCard, target);

  clearChartDragState();

  if (didMove) {
    queueRender();
  }
}

function handleChartDragEnd() {
  clearChartDragState();
}

function moveDraggedChartCard(event, grid, draggedCard, target) {
  if (!target || !grid.contains(target)) {
    grid.append(draggedCard);
    return true;
  }

  if (target === draggedCard) {
    return false;
  }

  const placement = getChartDropPlacement(event, target, grid);

  if (placement === "before") {
    target.before(draggedCard);
  } else {
    target.after(draggedCard);
  }

  return true;
}

function getChartDropPlacement(event, target, grid) {
  const rect = target.getBoundingClientRect();
  const columnCount = getGridColumnCount(grid);

  if (columnCount > 1) {
    const midpoint = rect.left + rect.width / 2;
    return event.clientX < midpoint ? "before" : "after";
  }

  const midpoint = rect.top + rect.height / 2;
  return event.clientY < midpoint ? "before" : "after";
}

function getGridColumnCount(grid) {
  const columns = window.getComputedStyle(grid).gridTemplateColumns;

  if (!columns || columns === "none") {
    return 1;
  }

  return Math.max(1, columns.split(/\s+/).filter(Boolean).length);
}

function getDraggedChartCard(event) {
  const key = state.draggingChartKey || event.dataTransfer?.getData(CHART_DRAG_MIME);

  if (!key) {
    return null;
  }

  return [...query(".chart-grid").querySelectorAll(".chart-card")]
    .find((card) => card.dataset.chartCard === key) || null;
}

function closestVisibleChartCard(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest(".chart-card:not([hidden])");
}

function clearChartDropIndicators(exceptCard = null) {
  query(".chart-grid")
    .querySelectorAll(".is-chart-drop-before, .is-chart-drop-after")
    .forEach((card) => {
      if (card === exceptCard) {
        return;
      }

      card.classList.remove("is-chart-drop-before", "is-chart-drop-after");
    });
}

function clearChartDragState() {
  const grid = query(".chart-grid");
  const draggedCard = getDraggedChartCard({ dataTransfer: null });

  clearChartDropIndicators();
  grid.classList.remove("is-chart-drag-active");

  if (draggedCard) {
    draggedCard.classList.remove("is-chart-dragging");
    draggedCard.setAttribute("aria-grabbed", "false");
  }

  state.draggingChartKey = null;
}

function handleSerialLine(line) {
  const values = parseCsvLine(line);
  updateRawDebugReadout(line, values);

  if (isHeaderRow(values)) {
    setStatus("Header received");
    return;
  }

  if (state.skipNextSerialLine) {
    state.skipNextSerialLine = false;

    if (!hasTimestampFirst(values)) {
      setStatus(line);
      return;
    }

    return;
  }

  if (!hasTimestampFirst(values)) {
    setStatus(line);
    return;
  }

  const record = mapSerialValues(values, line);

  if (!record) {
    setStatus(line);
    return;
  }

  markReadSuccessful();
  state.records.push(record);

  if (state.records.length > MAX_RECORDS) {
    state.records.splice(0, state.records.length - MAX_RECORDS);
  }

  updateReadout(record);
  queueRender();
}

function markReadSuccessful() {
  if (state.hasSuccessfulRead) {
    return;
  }

  state.hasSuccessfulRead = true;
  setStatus("Connected");
}

function mapSerialValues(values, rawLine) {
  const schema = state.schema;

  if (!schema?.columns?.length || values.length === 0) {
    return null;
  }

  const normalizedValues = normalizeValuesForSchema(values, schema.columns);

  if (!normalizedValues) {
    return null;
  }

  const fields = {};
  schema.columns.forEach((column, index) => {
    fields[column.name] = normalizedValues[index];
  });

  const timestampRaw = getField(fields, FIELD_ALIASES.timestamp) || normalizedValues[0];
  const timestamp = parseTimestamp(timestampRaw);

  if (!timestamp) {
    return null;
  }

  const numericValues = {};
  schema.columns.forEach((column, index) => {
    const value = Number(normalizedValues[index]);

    if (Number.isFinite(value)) {
      numericValues[columnValueKey(index)] = value;
    }
  });

  return {
    timestamp,
    rawLine,
    fields,
    values: {
      temperature: numberField(fields, FIELD_ALIASES.temperature),
      humidity: numberField(fields, FIELD_ALIASES.humidity),
      co2: numberField(fields, FIELD_ALIASES.co2),
      pm25: numberField(fields, FIELD_ALIASES.pm25),
      vocLight: numberField(fields, FIELD_ALIASES.vocLight),
      vocHeavy: numberField(fields, FIELD_ALIASES.vocHeavy),
      co: numberField(fields, FIELD_ALIASES.co),
      ...numericValues,
    },
  };
}

function normalizeValuesForSchema(values, columns) {
  if (values.length === columns.length) {
    return values;
  }

  if (values.length === columns.length + 1 && values[values.length - 1] === "") {
    return values.slice(0, -1);
  }

  return null;
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

function hasTimestampFirst(values) {
  return Boolean(parseTimestamp(values[0]));
}

function getField(fields, aliases) {
  for (const alias of aliases) {
    if (fields[alias] !== undefined && fields[alias] !== "") {
      return fields[alias];
    }
  }

  return "";
}

function numberField(fields, aliases) {
  const value = Number(getField(fields, aliases));
  return Number.isFinite(value) ? value : null;
}

function parseTimestamp(value) {
  const rawValue = String(value || "").trim();

  if (!/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?/.test(rawValue)) {
    return null;
  }

  const normalized = rawValue.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resetData() {
  state.records = [];
  query("[data-row-count]").textContent = "0";
  query("[data-last-time]").textContent = "--";
  query("[data-latest-line]").textContent = "--";
  renderDebugValues();
  Object.values(getAllCharts()).forEach((chart) => {
    query(`[data-chart-stats="${chart.stats}"]`).textContent = "--";
  });
  app.querySelectorAll("[data-metric]").forEach((metric) => {
    metric.textContent = "--";
  });
  renderAll();
}

function updateReadout(record) {
  query("[data-row-count]").textContent = String(state.records.length);
  query("[data-last-time]").textContent = formatTime(record.timestamp);
  renderDebugValues(record);

  setMetric("temperature", record.values.temperature, "deg C");
  setMetric("humidity", record.values.humidity, "%");
  setMetric("co2", record.values.co2, "ppm");
  setMetric("pm25", record.values.pm25, "ug/m^3");
  setMetric("voc", firstFinite(record.values.vocLight, record.values.vocHeavy), "");
  setMetric("co", record.values.co, "ppm");
}

function updateRawDebugReadout(line, values) {
  query("[data-latest-line]").textContent = line;
  renderDebugValues(null, values);
}

function renderDebugValues(record = null, values = null) {
  const target = query("[data-debug-values]");
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
  Object.entries(getAllCharts()).forEach(([key, chart]) => {
    const card = app.querySelector(`[data-chart-card="${key}"]`);

    if (!card?.hidden) {
      renderChart(chart);
    }
  });
}

function renderChart(chart) {
  const canvas = document.getElementById(chart.canvas);
  const rect = canvas.getBoundingClientRect();

  renderChartCanvas(canvas, chart, {
    width: Math.max(MIN_CHART_WIDTH, rect.width),
    height: Math.max(MIN_CHART_HEIGHT, rect.height),
    scale: window.devicePixelRatio || 1,
    theme: getLiveChartTheme(),
    updateStats: true,
  });
}

function renderChartCanvas(canvas, chart, { width, height, scale = 1, theme, updateStats = false }) {
  const context = canvas.getContext("2d");

  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);

  const records = visibleRecords();
  const seriesValues = chart.series.flatMap((series) =>
    records
      .map((record) => record.values[series.key])
      .filter((value) => Number.isFinite(value)),
  );

  if (records.length === 0 || seriesValues.length === 0) {
    drawEmptyChart(context, width, theme);
    if (updateStats) {
      query(`[data-chart-stats="${chart.stats}"]`).textContent = "--";
    }
    return;
  }

  const plot = {
    left: 54,
    right: width - 14,
    top: 12,
    bottom: height - 28,
  };
  const times = records.map((record) => record.timestamp.getTime());
  const xMin = Math.min(...times);
  const xMax = Math.max(...times);
  const yRange = getYRange(seriesValues, chart.minZero, getDefaultYRange(chart));

  drawGrid(context, plot, width, height, xMin, xMax, yRange, theme);

  chart.series.forEach((series) => {
    drawSeries(context, records, series, plot, xMin, xMax, yRange, chart.marker, theme);
  });

  if (updateStats) {
    updateChartStats(chart, records);
  }
}

function exportGraphPng() {
  renderAll();

  const grid = app.querySelector(".chart-grid");
  const cards = [...grid.querySelectorAll(".chart-card:not([hidden])")];

  if (cards.length === 0) {
    setStatus("No visible plots to export");
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
  link.download = `aqiq-live-view-${makeFileTimestamp()}.png`;
  link.click();
  setStatus("Graph PNG exported");
}

function drawExportHeader(context, width, padding) {
  const schemaStatus = query("[data-schema-status]").textContent;
  context.fillStyle = "#17202a";
  context.font = "700 22px Arial, Helvetica, sans-serif";
  context.fillText("AQIQ YPOD Live Visualization", padding, 34);

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
  const chart = getAllCharts()[card.dataset.chartCard];
  const title = card.querySelector("h2")?.textContent?.trim() || "";
  const stats = card.querySelector("[data-chart-stats]")?.textContent?.trim() || "";
  const legendItems = [...card.querySelectorAll(".chart-legend span")].map((item) => ({
    color: item.querySelector("i")?.style.getPropertyValue("--swatch") || "#17202a",
    label: item.textContent.trim(),
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

function makeFileTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

function visibleRecords() {
  if (state.records.length === 0) {
    return state.records;
  }

  const latest = state.records[state.records.length - 1].timestamp.getTime();
  return state.records.filter((record) => latest - record.timestamp.getTime() <= state.displayWindowMs);
}

function getDefaultYRange(chart) {
  const ranges = chart.series
    .map((series) => resolveColumnForSeries(series.key)?.defaultAxisRange)
    .filter(isValidAxisRange);

  if (ranges.length === 0) {
    return null;
  }

  return {
    min: Math.min(...ranges.map((range) => range[0])),
    max: Math.max(...ranges.map((range) => range[1])),
  };
}

function getAllCharts() {
  return {
    ...CHARTS,
    ...Object.fromEntries(getSelectedColumnCharts().map((chart) => [chart.key, chart])),
  };
}

function getSelectedColumnCharts() {
  const columns = state.schema?.columns || [];

  return [...app.querySelectorAll("[data-column-plot-toggle]:checked")]
    .map((toggle) => {
      const columnIndex = Number(toggle.value);
      const column = columns[columnIndex];

      if (!column) {
        return null;
      }

      return makeColumnChart(column, columnIndex);
    })
    .filter(Boolean);
}

function makeColumnChart(column, index) {
  const key = `column-${index}`;

  return {
    key,
    canvas: `chart-${key}`,
    stats: key,
    title: formatFieldLabel(column.name),
    unit: column.unit,
    series: [
      {
        key: columnValueKey(index),
        color: COLUMN_CHART_COLORS[index % COLUMN_CHART_COLORS.length],
        columnIndex: index,
      },
    ],
  };
}

function columnValueKey(index) {
  return `column:${index}`;
}

function getYRange(values, minZero = false, defaultRange = null) {
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (defaultRange) {
    return {
      min: Math.min(defaultRange.min, min),
      max: Math.max(defaultRange.max, max),
    };
  }

  if (minZero) {
    min = Math.min(0, min);
  }

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const padding = (max - min) * 0.08;
  return {
    min: minZero ? Math.min(0, min) : min - padding,
    max: max + padding,
  };
}

function drawGrid(context, plot, width, height, xMin, xMax, yRange, theme) {
  context.strokeStyle = theme.grid;
  context.lineWidth = 1;
  context.font = "11px Arial, Helvetica, sans-serif";
  context.fillStyle = theme.text;

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
    context.fillText(formatTime(time), Math.min(x, width - 58), height - 9);
  }
}

function drawSeries(context, records, series, plot, xMin, xMax, yRange, marker, theme) {
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

  if (marker) {
    context.fillStyle = color;
    usableRecords.slice(-80).forEach((record) => {
      const x = scaleValue(record.timestamp.getTime(), xMin, xMax, plot.left, plot.right);
      const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);
      context.beginPath();
      context.arc(x, y, 2, 0, Math.PI * 2);
      context.fill();
    });
  }
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

function updateChartStats(chart, records) {
  const values = chart.series.flatMap((series) =>
    records
      .map((record) => record.values[series.key])
      .filter((value) => Number.isFinite(value)),
  );

  if (values.length === 0) {
    query(`[data-chart-stats="${chart.stats}"]`).textContent = "--";
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  query(`[data-chart-stats="${chart.stats}"]`).textContent =
    `min ${formatNumber(min)} | max ${formatNumber(max)}`;
}

function scaleValue(value, fromMin, fromMax, toMin, toMax) {
  if (fromMin === fromMax) {
    return (toMin + toMax) / 2;
  }

  return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
}

function isValidAxisRange(range) {
  return Array.isArray(range) &&
    range.length === 2 &&
    range.every((value) => Number.isFinite(value)) &&
    range[0] < range[1];
}

function isTimestampColumn(column) {
  const aliases = FIELD_ALIASES.timestamp.map((alias) => alias.toLowerCase());
  return column.unit === "timestamp" || aliases.includes(column.name.toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
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

function setButtons({ connecting = false, connected = false }) {
  query("[data-connect]").disabled =
    connecting || connected || !SerialLineReader.isSupported();
  query("[data-disconnect]").disabled = !connected;
}

function setStatus(message) {
  if (message === state.statusMessage) {
    state.statusRepeatCount += 1;
  } else {
    state.statusMessage = message;
    state.statusRepeatCount = 1;
  }

  const suffix = state.statusRepeatCount > 1 ? ` (x${state.statusRepeatCount})` : "";
  query("[data-connection-status]").textContent = `${message}${suffix}`;
}

function query(selector) {
  return app.querySelector(selector);
}
