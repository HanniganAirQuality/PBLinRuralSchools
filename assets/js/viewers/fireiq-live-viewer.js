import { showSafariLiveViewerWarning } from "../core/browser-warning.js";
import { SerialLineReader } from "../core/serial-lines.js";

const DEFAULT_BAUD_RATE = 9600;
const DEFAULT_TIMELINE_MINUTES = 5;
const MIN_TIMELINE_MINUTES = 0.25;
const MAX_TIMELINE_MINUTES = 1440;
const MAX_RECORDS_PER_POD = 2400;
const MIN_CHART_WIDTH = 220;
const MIN_CHART_HEIGHT = 104;
const EXPORT_CHART_THEME = {
  background: "#ffffff",
  grid: "#d9dee6",
  text: "#5c6672",
  emptyText: "#798391",
  invertSeries: false,
};

const POD_KEYS = ["pod1", "pod2"];
const FIRE_COLUMNS = [
  { name: "DateTime", label: "DateTime", unit: "timestamp" },
  { name: "Temperature", label: "Temperature", unit: "deg C" },
  { name: "Relative_Humidity", label: "Relative Humidity", unit: "% RH" },
  { name: "TVOC", label: "TVOC", unit: "ppm" },
  { name: "F2600", label: "F2600", unit: "ADU" },
  { name: "F2602", label: "F2602", unit: "ADU" },
  { name: "NA", label: "NA", unit: "" },
  { name: "CO", label: "CO", unit: "ppm" },
  { name: "CO2", label: "CO2", unit: "ppm" },
  { name: "PM1", label: "PM1", unit: "ug/m^3" },
  { name: "PM25", label: "PM2.5", unit: "ug/m^3" },
  { name: "PM10", label: "PM10", unit: "ug/m^3" },
];
const FIRE_VALUE_INDEXES = {
  temperature: 0,
  humidity: 1,
  tvoc: 2,
  vocLight: 3,
  vocHeavy: 4,
  co: 6,
  co2: 7,
  pm1: 8,
  pm25: 9,
  pm10: 10,
};

const CHARTS = {
  co: {
    canvas: "chart-co",
    stats: "co",
    title: "Carbon Monoxide",
    unit: "ppm",
    minZero: true,
    series: [
      { podKey: "pod1", key: "co", color: "#228833" },
      { podKey: "pod2", key: "co", color: "#4eb265" },
    ],
  },
  co2: {
    canvas: "chart-co2",
    stats: "co2",
    title: "Carbon Dioxide",
    unit: "ppm",
    minZero: true,
    series: [
      { podKey: "pod1", key: "co2", color: "#ddaa33" },
      { podKey: "pod2", key: "co2", color: "#f6c141" },
    ],
  },
  pm25: {
    canvas: "chart-pm25",
    stats: "pm25",
    title: "Particulate Matter 2.5",
    unit: "ug/m^3",
    minZero: true,
    series: [
      { podKey: "pod1", key: "pm25", color: "#004488" },
      { podKey: "pod2", key: "pm25", color: "#1965b0" },
    ],
  },
};

const app = document.querySelector("[data-fire-iq-live-viewer]");
const state = {
  displayWindowMs: DEFAULT_TIMELINE_MINUTES * 60 * 1000,
  renderQueued: false,
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

function init() {
  bindControls();
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
  query("[data-timeline-minutes]").addEventListener("input", handleTimelineSizeChange);
  app.querySelectorAll("[data-plot-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", handlePlotToggle);
  });
  window.addEventListener("resize", queueRender);
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener?.("change", queueRender);
}

async function connectPod(podKey) {
  const pod = state.pods[podKey];

  if (!pod || pod.serial) {
    return;
  }

  try {
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

function handleSerialLine(podKey, line) {
  const pod = state.pods[podKey];
  const values = parseCsvLine(line);
  updateRawDebugReadout(podKey, line, values);

  if (isHeaderRow(values)) {
    setPodStatus(podKey, "Header received");
    return;
  }

  if (pod.skipNextSerialLine && !hasTimestampFirst(values)) {
    pod.skipNextSerialLine = false;
    setPodStatus(podKey, line);
    return;
  }

  pod.skipNextSerialLine = false;

  if (!hasTimestampFirst(values)) {
    setPodStatus(podKey, line);
    return;
  }

  const record = mapFireIqValues(values, line);

  if (!record) {
    setPodStatus(podKey, "Unexpected Fire-IQ row");
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

function mapFireIqValues(values, rawLine) {
  const normalizedValues = normalizeFireValues(values);

  if (!normalizedValues) {
    return null;
  }

  const podTimestamp = parseTimestamp(normalizedValues[0]);

  if (!podTimestamp) {
    return null;
  }

  const nums = normalizedValues.slice(1).map((value) => Number(value));
  const fields = {};
  FIRE_COLUMNS.forEach((column, index) => {
    fields[column.name] = normalizedValues[index] ?? "";
  });

  return {
    timestamp: new Date(),
    podTimestamp,
    rawLine,
    fields,
    values: {
      temperature: numberAt(nums, FIRE_VALUE_INDEXES.temperature),
      humidity: numberAt(nums, FIRE_VALUE_INDEXES.humidity),
      tvoc: numberAt(nums, FIRE_VALUE_INDEXES.tvoc),
      vocLight: numberAt(nums, FIRE_VALUE_INDEXES.vocLight),
      vocHeavy: numberAt(nums, FIRE_VALUE_INDEXES.vocHeavy),
      co: numberAt(nums, FIRE_VALUE_INDEXES.co),
      co2: numberAt(nums, FIRE_VALUE_INDEXES.co2),
      pm1: numberAt(nums, FIRE_VALUE_INDEXES.pm1),
      pm25: numberAt(nums, FIRE_VALUE_INDEXES.pm25),
      pm10: numberAt(nums, FIRE_VALUE_INDEXES.pm10),
    },
  };
}

function normalizeFireValues(values) {
  const normalized = values[values.length - 1] === "" ? values.slice(0, -1) : values;

  if (normalized.length < FIRE_COLUMNS.length) {
    return null;
  }

  return normalized.slice(0, FIRE_COLUMNS.length);
}

function numberAt(values, index) {
  const value = Number(values[index]);
  return Number.isFinite(value) ? value : null;
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

function parseTimestamp(value) {
  const rawValue = String(value || "").trim();

  if (!/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?/.test(rawValue)) {
    return null;
  }

  const normalized = rawValue.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

  setMetric(`${podKey}-co`, record.values.co, "ppm");
  setMetric(`${podKey}-co2`, record.values.co2, "ppm");
  setMetric(`${podKey}-pm25`, record.values.pm25, "ug/m^3");
}

function updateRawDebugReadout(podKey, line, values) {
  query(`[data-latest-line="${podKey}"]`).textContent = line;
  renderDebugValues(podKey, null, values);
}

function renderDebugValues(podKey, record = null, values = null) {
  const target = query(`[data-debug-values="${podKey}"]`);
  const fragment = document.createDocumentFragment();

  FIRE_COLUMNS.forEach((column, index) => {
    const item = document.createElement("div");
    const name = document.createElement("span");
    const value = document.createElement("code");
    const rawValue = record?.fields?.[column.name] ?? values?.[index];

    item.className = "debug-value";
    name.textContent = column.label;
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

function renderChartCanvas(canvas, chart, { width, height, scale = 1, theme, updateStats = false }) {
  const context = canvas.getContext("2d");

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
    top: chart.unit ? 24 : 12,
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
    leftLabel: chart.unit,
  });

  chart.series.forEach((series) => {
    drawSeries(context, recordsByPod[series.podKey], series, plot, xMin, xMax, yRange, theme);
  });

  if (updateStats) {
    updateChartStats(chart);
  }
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
  usableRecords.slice(-80).forEach((record) => {
    const x = scaleValue(record.timestamp.getTime(), xMin, xMax, plot.left, plot.right);
    const y = scaleValue(record.values[series.key], yRange.min, yRange.max, plot.bottom, plot.top);
    context.beginPath();
    context.arc(x, y, 2, 0, Math.PI * 2);
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
  const layoutStatus = query("[data-layout-status]").textContent;
  context.fillStyle = "#17202a";
  context.font = "700 22px Arial, Helvetica, sans-serif";
  context.fillText("Fire-IQ Dual-POD Live Visualization", padding, 34);

  context.fillStyle = "#5c6672";
  context.font = "13px Arial, Helvetica, sans-serif";
  context.fillText(`Exported ${new Date().toLocaleString()}`, padding, 58);
  context.fillText(layoutStatus, padding, 76);

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
