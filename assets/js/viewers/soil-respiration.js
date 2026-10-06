import { getLanguage, t } from "../core/i18n.js";
import {
  getPreferredYpodSection,
  getPreferredYpodVersion,
  getYpodSectionSchema,
  loadSpodHeaderLogResource,
  resolveYpodSchemaForValues,
} from "../core/ypod-yaml.js";

const PRESSURE_PA = 76500;
const GAS_CONSTANT = 8.314;
const CO2_MOLAR_MASS_KG = 0.044;
const CHAMBER_HEIGHT_M = 0.1575;
const FIELDS = {
  timestamp: ["DateTime", "Timestamp", "Time"],
  date: ["Date"],
  temperature1: ["Temperature1"],
  temperature2: ["Temperature2"],
  co2: ["Calibrated_CO2", "CO2"],
};
const PADDING = { top: 18, right: 20, bottom: 42, left: 62 };

const app = document.querySelector("[data-soil-respiration]");
const state = {
  resource: null,
  schema: null,
  records: [],
  selections: [],
  chart: null,
  fileStatusKey: "soilRespiration.file.none",
  fileStatusVariables: {},
};

if (app) initialize();

async function initialize() {
  bindControls();
  render();
  state.resource = await loadSpodHeaderLogResource();
  state.schema = defaultSchema(state.resource);
}

function bindControls() {
  query("[data-load-file]").addEventListener("click", () => query("[data-file-input]").click());
  query("[data-file-input]").addEventListener("change", loadSelectedFile);
  query("[data-respiration-chart]").addEventListener("pointerdown", selectChartTime);
  window.addEventListener("resize", render);
  window.addEventListener("haq-theme-change", render);
  document.addEventListener("haq:languagechange", () => {
    updateFileStatus();
    render();
  });
}

async function loadSelectedFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  setFileStatus("soilRespiration.file.reading", { fileName: file.name });
  try {
    if (!state.schema) {
      state.resource = await loadSpodHeaderLogResource();
      state.schema = defaultSchema(state.resource);
    }
    state.records = parseSpodData(await file.text());
    state.selections = [];
    setFileStatus(
      state.records.length >= 2 ? "soilRespiration.file.loaded" : "soilRespiration.file.noData",
      { fileName: file.name, count: state.records.length },
    );
  } catch {
    state.records = [];
    state.selections = [];
    setFileStatus("soilRespiration.file.readError");
  }
  render();
}

function defaultSchema(resource) {
  const versions = resource?.index?.map((item) => item.version) || [];
  const version = getPreferredYpodVersion(versions);
  const sections = resource?.index?.find((item) => item.version === version)?.sections || [];
  return getYpodSectionSchema(resource, version, getPreferredYpodSection(sections));
}

function parseSpodData(text) {
  const records = [];
  const schemaCache = new Map();

  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const values = parseCsvLine(line);
    if (isHeader(values) || values.length < 2) return;

    const cacheKey = schemaCacheKey(values);
    const cached = schemaCache.get(cacheKey);
    const normalized = cached ? normalizeValues(values, cached.columns) : null;
    const resolved = normalized
      ? { schema: cached, values: normalized }
      : resolveYpodSchemaForValues(state.resource, state.schema, values);
    if (!resolved) return;

    schemaCache.set(cacheKey, resolved.schema);
    const fields = {};
    resolved.schema.columns.forEach((column, index) => {
      fields[column.name] = resolved.values[index] ?? "";
    });

    const timestamp = parseTimestamp(fields);
    const co2 = numberField(fields, FIELDS.co2);
    if (!timestamp || !Number.isFinite(co2)) return;

    records.push({
      timestamp: timestamp.getTime(),
      co2,
      temperature1: numberField(fields, FIELDS.temperature1),
      temperature2: numberField(fields, FIELDS.temperature2),
    });
  });

  return records.sort((left, right) => left.timestamp - right.timestamp);
}

function parseTimestamp(fields) {
  const rawTime = getField(fields, FIELDS.timestamp);
  if (!rawTime) return null;

  const rawDate = getField(fields, FIELDS.date);
  if (rawDate) {
    const combined = Date.parse(`${rawDate} ${rawTime}`);
    if (!Number.isNaN(combined)) return new Date(combined);
  }

  const numeric = Number(rawTime);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) return new Date(numeric);
    if (numeric > 1e9) return new Date(numeric * 1000);
    return new Date(numeric);
  }

  const parsed = Date.parse(rawTime);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function selectChartTime(event) {
  if (!state.chart || state.records.length < 2) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const pointerX = event.clientX - bounds.left;
  const pointerY = event.clientY - bounds.top;
  const { plot } = state.chart;
  if (
    pointerX < plot.left || pointerX > plot.left + plot.width
    || pointerY < plot.top || pointerY > plot.top + plot.height
  ) return;

  const ratio = (pointerX - plot.left) / plot.width;
  const time = state.chart.xMin + ratio * (state.chart.xMax - state.chart.xMin);

  if (state.selections.length === 0 || state.selections.length === 2) {
    state.selections = [time];
  } else {
    state.selections.push(time);
    state.selections.sort((left, right) => left - right);
  }
  render();
}

function render() {
  drawChart();
  drawResults();
  updateSelectionStatus();
}

function drawChart() {
  const canvas = query("[data-respiration-chart]");
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(bounds.width || 760));
  const height = Math.max(300, Math.round(bounds.height || 390));
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);

  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const theme = chartTheme();
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);

  const plot = {
    left: PADDING.left,
    top: PADDING.top,
    width: width - PADDING.left - PADDING.right,
    height: height - PADDING.top - PADDING.bottom,
  };

  if (state.records.length < 2) {
    state.chart = null;
    context.fillStyle = theme.text;
    context.font = "700 14px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(t("soilRespiration.chart.empty"), width / 2, height / 2);
    return;
  }

  const xMin = state.records[0].timestamp;
  const xMax = state.records[state.records.length - 1].timestamp;
  const co2Values = state.records.map((record) => record.co2);
  let yMin = Math.min(...co2Values);
  let yMax = Math.max(...co2Values);
  const yPadding = Math.max((yMax - yMin) * 0.1, 1);
  yMin -= yPadding;
  yMax += yPadding;
  state.chart = { plot, xMin, xMax, yMin, yMax };

  drawGrid(context, state.chart, theme);
  if (state.selections.length === 2) {
    const left = scale(state.selections[0], xMin, xMax, plot.left, plot.left + plot.width);
    const right = scale(state.selections[1], xMin, xMax, plot.left, plot.left + plot.width);
    context.fillStyle = theme.selection;
    context.fillRect(left, plot.top, right - left, plot.height);
  }

  context.beginPath();
  state.records.forEach((record, index) => {
    const x = scale(record.timestamp, xMin, xMax, plot.left, plot.left + plot.width);
    const y = scale(record.co2, yMin, yMax, plot.top + plot.height, plot.top);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = theme.line;
  context.lineWidth = 2;
  context.stroke();

  state.selections.forEach((time, index) => drawSelection(context, time, index, theme));
}

function drawGrid(context, chart, theme) {
  const { plot, xMin, xMax, yMin, yMax } = chart;
  context.font = "12px Arial";
  context.fillStyle = theme.text;
  context.strokeStyle = theme.grid;
  context.lineWidth = 1;

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = plot.top + plot.height * ratio;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.left + plot.width, y);
    context.stroke();
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(formatNumber(yMax - (yMax - yMin) * ratio, 0), plot.left - 8, y);
  }

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const x = plot.left + plot.width * ratio;
    context.beginPath();
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.top + plot.height);
    context.stroke();
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(formatNumber(((xMax - xMin) * ratio) / 1000, 0), x, plot.top + plot.height + 8);
  }

  context.save();
  context.translate(16, plot.top + plot.height / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = "center";
  context.fillText(t("soilRespiration.chart.yAxis"), 0, 0);
  context.restore();
  context.textAlign = "center";
  context.fillText(t("soilRespiration.chart.xAxis"), plot.left + plot.width / 2, plot.top + plot.height + 28);
}

function drawSelection(context, time, index, theme) {
  const { plot, xMin, xMax, yMin, yMax } = state.chart;
  const x = scale(time, xMin, xMax, plot.left, plot.left + plot.width);
  const y = scale(interpolateCo2(time), yMin, yMax, plot.top + plot.height, plot.top);
  context.beginPath();
  context.moveTo(x, plot.top);
  context.lineTo(x, plot.top + plot.height);
  context.strokeStyle = theme.marker;
  context.lineWidth = 1.5;
  context.stroke();
  context.beginPath();
  context.arc(x, y, 7, 0, Math.PI * 2);
  context.fillStyle = theme.marker;
  context.fill();
  context.fillStyle = theme.markerText;
  context.font = "700 10px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(index + 1), x, y);
}

function calculate() {
  if (state.selections.length !== 2) return null;
  const [start, end] = state.selections;
  const deltaSeconds = (end - start) / 1000;
  const startCo2 = interpolateCo2(start);
  const endCo2 = interpolateCo2(end);
  const temperatures = state.records
    .flatMap((record) => [record.temperature1, record.temperature2])
    .filter(Number.isFinite);
  if (deltaSeconds <= 0 || temperatures.length === 0) return null;

  const deltaCo2 = endCo2 - startCo2;
  const averageCelsius = temperatures.reduce((total, value) => total + value, 0) / temperatures.length;
  const temperatureKelvin = averageCelsius + 273.15;
  const flux = ((deltaCo2 / deltaSeconds) * 1e-6)
    * CO2_MOLAR_MASS_KG * CHAMBER_HEIGHT_M * PRESSURE_PA
    / (GAS_CONSTANT * temperatureKelvin);
  return { deltaCo2, deltaSeconds, temperatureKelvin, flux };
}

function drawResults() {
  const result = calculate();
  const emptyValue = t("soilRespiration.value.empty");
  setText("[data-result-temperature]", result ? formatNumber(result.temperatureKelvin, 2) : emptyValue);
  setText("[data-result-co2]", result ? formatNumber(result.deltaCo2, 2) : emptyValue);
  setText("[data-result-time]", result ? formatNumber(result.deltaSeconds, 2) : emptyValue);
  setText("[data-result-flux]", result ? result.flux.toExponential(3) : emptyValue);
}

function updateSelectionStatus() {
  let key = "soilRespiration.selection.first";
  if (state.records.length >= 2 && state.selections.length === 1) key = "soilRespiration.selection.second";
  else if (state.selections.length === 2) {
    key = calculate() ? "soilRespiration.selection.complete" : "soilRespiration.selection.noTemperature";
  }
  setText("[data-selection-status]", t(key));
}

function interpolateCo2(timestamp) {
  if (timestamp <= state.records[0].timestamp) return state.records[0].co2;
  const last = state.records[state.records.length - 1];
  if (timestamp >= last.timestamp) return last.co2;

  let low = 0;
  let high = state.records.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (state.records[middle].timestamp <= timestamp) low = middle;
    else high = middle;
  }
  const before = state.records[low];
  const after = state.records[high];
  const span = after.timestamp - before.timestamp;
  const ratio = span > 0 ? (timestamp - before.timestamp) / span : 0;
  return before.co2 + (after.co2 - before.co2) * ratio;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') inQuotes = !inQuotes;
    else if (character === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else current += character;
  }
  values.push(current.trim());
  return values;
}

function isHeader(values) {
  return ["datetime", "timestamp", "date", "time", "spodid"].includes(values[0]?.toLowerCase() || "");
}

function schemaCacheKey(values) {
  const firmware = values.find((value) => /SPOD[\s_-]*V?\s*\d+[._-]\d+/i.test(String(value)));
  return `${values.length}:${String(firmware || "").trim().toLowerCase()}`;
}

function normalizeValues(values, columns) {
  if (values.length === columns.length) return values;
  if (values.length === columns.length + 1 && values.at(-1) === "") return values.slice(0, -1);
  return null;
}

function getField(fields, aliases) {
  for (const alias of aliases) {
    if (fields[alias] !== undefined && fields[alias] !== "") return fields[alias];
  }
  const normalized = aliases.map(normalizeName);
  return Object.entries(fields).find(([name, value]) => value !== "" && normalized.includes(normalizeName(name)))?.[1] || "";
}

function numberField(fields, aliases) {
  const raw = getField(fields, aliases);
  if (raw === "" || raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function setFileStatus(key, variables = {}) {
  state.fileStatusKey = key;
  state.fileStatusVariables = variables;
  updateFileStatus();
}

function updateFileStatus() {
  setText("[data-file-status]", t(state.fileStatusKey, state.fileStatusVariables));
}

function chartTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue("--chart-background").trim() || "#fff",
    grid: styles.getPropertyValue("--line").trim() || "#d9dee6",
    text: styles.getPropertyValue("--muted").trim() || "#5c6672",
    line: "#7c7d2d",
    marker: "#c2410c",
    markerText: "#fff",
    selection: "rgba(124, 125, 45, 0.16)",
  };
}

function formatNumber(value, digits) {
  return new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: digits }).format(value);
}

function scale(value, inputMin, inputMax, outputMin, outputMax) {
  if (inputMax === inputMin) return (outputMin + outputMax) / 2;
  return outputMin + ((value - inputMin) / (inputMax - inputMin)) * (outputMax - outputMin);
}

function setText(selector, value) {
  query(selector).textContent = value;
}

function query(selector) {
  return app.querySelector(selector);
}
