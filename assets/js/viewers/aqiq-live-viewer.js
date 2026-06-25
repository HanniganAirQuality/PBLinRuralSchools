import { SerialLineReader } from "../core/serial-lines.js";
import {
  YPOD_HEADER_LOG_PAGE,
  getYpodSectionSchema,
  loadYpodHeaderLogResource,
} from "../core/ypod-yaml.js";

const DEFAULT_BAUD_RATE = 9600;
const DISPLAY_WINDOW_MS = 5 * 60 * 1000;
const MAX_RECORDS = 2400;

const FIELD_ALIASES = {
  timestamp: ["DateTime", "Timestamp", "Time"],
  temperature: ["Temperature", "SHT25_Temperature", "BME180_Temperature", "T"],
  humidity: ["Relative_Humidity", "SHT25_Humidity", "RH"],
  co2: ["CO2", "ELT_CO2", "CO_2"],
  pm25: ["PM25_ENV", "PM2_5", "PM25", "PM2.5"],
  vocLight: ["Fig2600_LightVOC", "LightVOC", "lightVOC"],
  vocHeavy: ["Fig2602_HeavyVOC", "HeavyVOC", "heavyVOC"],
  tvoc: ["Calibrated_TVOC", "TVOC"],
  co: ["CO_ch1", "CO_ISB", "CO", "CarbonMonoxide"],
  coAux: ["CO_ch2"],
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
      { key: "tvoc", color: "#ffd60a" },
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
    series: [
      { key: "co", color: "#7da9ff" },
      { key: "coAux", color: "#4f46e5" },
    ],
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
  renderQueued: false,
};

if (app) {
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
  query("[data-yaml-version]").addEventListener("change", handleVersionChange);
  query("[data-yaml-section]").addEventListener("change", applySelectedSchema);
  app.querySelectorAll("[data-plot-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", handlePlotToggle);
  });
  window.addEventListener("resize", queueRender);
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
    resetData();
  } catch (error) {
    schemaStatus.textContent = error.message || "Unable to load schema";
  }
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
      onError: (error) => setStatus(error.message || "Serial read error"),
    });

    setButtons({ connecting: true });
    setStatus("Opening serial port...");
    await state.serial.connect();
    setButtons({ connected: true });
  } catch (error) {
    setButtons({ connected: false });
    setStatus(error.message || "Connection failed");
  }
}

async function disconnectSerial() {
  await state.serial?.disconnect();
  state.serial = null;
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

function handleSerialLine(line) {
  const values = parseCsvLine(line);

  if (isHeaderRow(values)) {
    setStatus("Header received");
    return;
  }

  const record = mapSerialValues(values, line);

  if (!record) {
    setStatus("Skipped unreadable row");
    return;
  }

  state.records.push(record);

  if (state.records.length > MAX_RECORDS) {
    state.records.splice(0, state.records.length - MAX_RECORDS);
  }

  updateReadout(record, line);
  queueRender();
}

function mapSerialValues(values, rawLine) {
  const schema = state.schema;

  if (!schema?.columns?.length || values.length === 0) {
    return null;
  }

  const fields = {};
  schema.columns.forEach((column, index) => {
    fields[column.name] = values[index];
  });

  const timestampRaw = getField(fields, FIELD_ALIASES.timestamp) || values[0];
  const timestamp = parseTimestamp(timestampRaw);

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
      tvoc: numberField(fields, FIELD_ALIASES.tvoc),
      co: numberField(fields, FIELD_ALIASES.co),
      coAux: numberField(fields, FIELD_ALIASES.coAux),
    },
  };
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
  const normalized = String(value || "").trim().replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function resetData() {
  state.records = [];
  query("[data-row-count]").textContent = "0";
  query("[data-last-time]").textContent = "--";
  query("[data-latest-line]").textContent = "--";
  Object.values(CHARTS).forEach((chart) => {
    query(`[data-chart-stats="${chart.stats}"]`).textContent = "--";
  });
  app.querySelectorAll("[data-metric]").forEach((metric) => {
    metric.textContent = "--";
  });
  renderAll();
}

function updateReadout(record, line) {
  query("[data-row-count]").textContent = String(state.records.length);
  query("[data-last-time]").textContent = formatTime(record.timestamp);
  query("[data-latest-line]").textContent = line;

  setMetric("temperature", record.values.temperature, "deg C");
  setMetric("humidity", record.values.humidity, "%");
  setMetric("co2", record.values.co2, "ppm");
  setMetric("pm25", record.values.pm25, "ug/m^3");
  setMetric("voc", firstFinite(record.values.vocLight, record.values.vocHeavy, record.values.tvoc), "");
  setMetric("co", firstFinite(record.values.co, record.values.coAux), "ADU");
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
  Object.entries(CHARTS).forEach(([key, chart]) => {
    const card = app.querySelector(`[data-chart-card="${key}"]`);

    if (!card?.hidden) {
      renderChart(chart);
    }
  });
}

function renderChart(chart) {
  const canvas = document.getElementById(chart.canvas);
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(260, rect.width);
  const height = Math.max(130, rect.height);

  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const records = visibleRecords();
  const seriesValues = chart.series.flatMap((series) =>
    records
      .map((record) => record.values[series.key])
      .filter((value) => Number.isFinite(value)),
  );

  if (records.length === 0 || seriesValues.length === 0) {
    drawEmptyChart(context, width);
    query(`[data-chart-stats="${chart.stats}"]`).textContent = "--";
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
  const yRange = getYRange(seriesValues, chart.minZero);

  drawGrid(context, plot, width, height, xMin, xMax, yRange);

  chart.series.forEach((series) => {
    drawSeries(context, records, series, plot, xMin, xMax, yRange, chart.marker);
  });

  updateChartStats(chart, records);
}

function visibleRecords() {
  if (state.records.length === 0) {
    return state.records;
  }

  const latest = state.records[state.records.length - 1].timestamp.getTime();
  return state.records.filter((record) => latest - record.timestamp.getTime() <= DISPLAY_WINDOW_MS);
}

function getYRange(values, minZero = false) {
  let min = Math.min(...values);
  let max = Math.max(...values);

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

function drawGrid(context, plot, width, height, xMin, xMax, yRange) {
  context.strokeStyle = "#d9dee6";
  context.lineWidth = 1;
  context.font = "11px Arial, Helvetica, sans-serif";
  context.fillStyle = "#5c6672";

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

function drawSeries(context, records, series, plot, xMin, xMax, yRange, marker) {
  const usableRecords = records.filter((record) => Number.isFinite(record.values[series.key]));

  if (usableRecords.length === 0) {
    return;
  }

  context.strokeStyle = series.color;
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
    context.fillStyle = series.color;
    usableRecords.slice(-80).forEach((record) => {
      const x = scaleValue(record.timestamp.getTime(), xMin, xMax, plot.left, plot.right);
      const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);
      context.beginPath();
      context.arc(x, y, 2, 0, Math.PI * 2);
      context.fill();
    });
  }
}

function drawEmptyChart(context, width) {
  context.strokeStyle = "#d9dee6";
  context.lineWidth = 1;

  for (let step = 1; step < 5; step += 1) {
    const y = 24 * step;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.fillStyle = "#798391";
  context.font = "12px Arial, Helvetica, sans-serif";
  context.fillText("Awaiting data", 14, 24);
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
  query("[data-connection-status]").textContent = message;
}

function query(selector) {
  return app.querySelector(selector);
}
