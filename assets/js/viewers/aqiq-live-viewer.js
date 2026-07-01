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
const MAX_RECORDS = 2400;
const MIN_CHART_WIDTH = 220;
const MIN_CHART_HEIGHT = 88;
const POINT_RADIUS = 2.3;
const HOVER_RADIUS = 10;
const CHART_DRAG_MIME = "application/x-haq-chart-card";
const CHART_COMBINE_INSET = 0.22;
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
  co: ["CO", "Calibrated_CO"],
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
  chartGroups: {},
  hasSuccessfulRead: false,
  statusMessage: "",
  statusRepeatCount: 0,
  hoverPoint: null,
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

function bindChartDragReordering() {
  const grid = query(".chart-grid");
  grid.addEventListener("click", handleChartGridClick);
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
  captureChartCardBaseTitle(card);
  card.draggable = true;
  card.setAttribute("aria-grabbed", "false");
}

function captureChartCardBaseTitle(card) {
  const title = card.querySelector("h2");

  if (!title || card.dataset.chartBaseTitle) {
    return;
  }

  const unit = title.querySelector("span")?.textContent?.trim() || "";
  const titleText = [...title.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent.trim())
    .join(" ")
    .trim();

  card.dataset.chartBaseTitle = titleText || title.textContent.replace(unit, "").trim();
  card.dataset.chartBaseUnit = unit.replace(/^\[/, "").replace(/\]$/, "");
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
  renderColumnToggles();
  updateLegends();

  if (reset) {
    resetData();
  }
}

function selectSchemaControls(schema) {
  const versionSelect = query("[data-yaml-version]");
  const sectionSelect = query("[data-yaml-section]");

  versionSelect.value = schema.version;
  populateSectionSelect();
  sectionSelect.value = schema.section;
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
  query(".chart-grid")
    .querySelectorAll(".chart-card")
    .forEach((card) => refreshChartCardDisplay(card, getRenderableChartForCard(card)));
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

function makeLegendItem(color, label) {
  const item = document.createElement("span");
  const swatch = document.createElement("i");
  swatch.style.setProperty("--swatch", color);
  swatch.style.setProperty("--swatch-dark", invertHexColor(color));
  item.dataset.exportLabel = label;
  item.append(swatch, document.createTextNode(label));
  return item;
}

function refreshChartCardDisplay(card, chart = null) {
  const baseChart = getAllCharts()[card.dataset.chartCard];
  const displayChart = chart || (baseChart ? makeRenderableSourceChart(card.dataset.chartCard, baseChart) : null);

  setChartCardTitle(card, displayChart);
  updateChartSplitControl(card, displayChart);
  updateChartCardLegend(card, displayChart);
  card.classList.toggle("is-chart-combined", Boolean(displayChart?.isCombined));
}

function setChartCardTitle(card, chart) {
  const title = card.querySelector("h2");

  if (!title) {
    return;
  }

  const titleText = chart?.isCombined
    ? chart.title
    : card.dataset.chartBaseTitle || chart?.title || "";
  const unit = chart?.isCombined
    ? chart.unit
    : card.dataset.chartBaseUnit || chart?.unit || "";
  const nodes = [document.createTextNode(titleText)];

  if (unit) {
    const unitNode = document.createElement("span");
    unitNode.textContent = ` [${unit}]`;
    nodes.push(unitNode);
  }

  title.replaceChildren(...nodes);
}

function updateChartSplitControl(card, chart) {
  const titleWrap = card.querySelector(".chart-heading > div");
  let button = titleWrap?.querySelector("[data-split-combined-chart]");

  if (!titleWrap) {
    return;
  }

  if (!chart?.isCombined) {
    button?.remove();
    return;
  }

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "chart-split-button";
    button.dataset.splitCombinedChart = "";
    titleWrap.append(button);
  }

  button.dataset.splitCombinedChart = chart.key;
  button.textContent = "SPLIT";
  button.setAttribute("aria-label", `Split ${chart.title}`);
}

function updateChartCardLegend(card, chart) {
  let legend = card.querySelector(".chart-legend");
  const hasNativeLegend = legend?.hasAttribute("data-chart-legend") || false;
  const shouldShowLegend = Boolean(chart && (chart.isCombined || chart.series.length > 1 || hasNativeLegend));

  if (!shouldShowLegend) {
    if (legend?.dataset.generatedChartLegend !== undefined) {
      legend.remove();
    } else {
      legend?.replaceChildren();
    }

    return;
  }

  if (!legend) {
    legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.dataset.generatedChartLegend = "";
    card.querySelector(".chart-heading")?.after(legend);
  }

  legend.replaceChildren(...makeLegendItemsForChart(chart));
}

function makeLegendItemsForChart(chart) {
  return chart.series.map((series) => {
    const column = resolveColumnForSeries(series.key);
    const fieldLabel = column ? formatFieldLabel(column.name) : series.sourceTitle || series.key;
    const sourceLabel = series.sourceTitle || fieldLabel;
    const labelParts = [];

    if (chart.isCombined && series.sourceSeriesCount > 1) {
      labelParts.push(`${sourceLabel}: ${fieldLabel}`);
    } else {
      labelParts.push(chart.isCombined ? sourceLabel : fieldLabel);
    }

    if (chart.isCombined && chart.axisGroups.length > 1) {
      labelParts.push(series.axis === "right" ? "(R)" : "(L)");
    }

    return makeLegendItem(series.color, labelParts.join(" "));
  });
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
  syncChartGroupsWithAvailableCharts();
  app.querySelectorAll("[data-chart-card]").forEach(applyChartCardVisibility);
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
      removeChartFromGroups(card.dataset.chartCard, { reveal: false, announce: false });
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

  syncChartGroupsWithAvailableCharts();
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

function handleChartGridClick(event) {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const button = target?.closest("[data-split-combined-chart]");

  if (!button) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  splitChartGroup(button.dataset.splitCombinedChart);
  queueRender();
}

function handleChartDragStart(event) {
  const grid = query(".chart-grid");
  const target = event.target instanceof Element ? event.target : event.target.parentElement;

  if (target?.closest("button")) {
    event.preventDefault();
    return;
  }

  const card = closestVisibleChartCard(target);

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

  const action = getChartDropAction(event, target, grid);
  target.classList.toggle("is-chart-drop-before", action === "before");
  target.classList.toggle("is-chart-drop-after", action === "after");
  target.classList.toggle("is-chart-drop-combine", action === "combine");
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
  const didChange = moveOrCombineDraggedChartCard(event, grid, draggedCard, target);

  clearChartDragState();

  if (didChange) {
    queueRender();
  }
}

function handleChartDragEnd() {
  clearChartDragState();
}

function moveOrCombineDraggedChartCard(event, grid, draggedCard, target) {
  if (!target || !grid.contains(target)) {
    grid.append(draggedCard);
    return true;
  }

  if (target === draggedCard) {
    return false;
  }

  const action = getChartDropAction(event, target, grid);

  if (action === "combine") {
    return combineChartCards(target, draggedCard);
  }

  if (action === "before") {
    target.before(draggedCard);
  } else {
    target.after(draggedCard);
  }

  return true;
}

function getChartDropAction(event, target, grid) {
  const rect = target.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = (event.clientY - rect.top) / rect.height;

  if (
    xRatio >= CHART_COMBINE_INSET &&
    xRatio <= 1 - CHART_COMBINE_INSET &&
    yRatio >= CHART_COMBINE_INSET &&
    yRatio <= 1 - CHART_COMBINE_INSET
  ) {
    return "combine";
  }

  const columnCount = getGridColumnCount(grid);

  if (columnCount > 1) {
    return xRatio < 0.5 ? "before" : "after";
  }

  return yRatio < 0.5 ? "before" : "after";
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
    .querySelectorAll(".is-chart-drop-before, .is-chart-drop-after, .is-chart-drop-combine")
    .forEach((card) => {
      if (card === exceptCard) {
        return;
      }

      card.classList.remove("is-chart-drop-before", "is-chart-drop-after", "is-chart-drop-combine");
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

function combineChartCards(targetCard, draggedCard) {
  const targetKey = getRootChartKey(targetCard.dataset.chartCard);
  const draggedKey = getRootChartKey(draggedCard.dataset.chartCard);

  if (!targetKey || !draggedKey || targetKey === draggedKey) {
    return false;
  }

  const targetRootCard = getChartCard(targetKey) || targetCard;
  const baseCharts = getAllCharts();
  const combinedKeys = uniqueStrings([
    ...getChartGroupKeys(targetKey),
    ...getChartGroupKeys(draggedKey),
  ]).filter((key) => baseCharts[key] && isChartEnabled(key));

  if (combinedKeys.length < 2) {
    return false;
  }

  delete state.chartGroups[draggedKey];
  state.chartGroups[targetKey] = combinedKeys;
  applyChartGroupVisibility(targetKey);
  refreshChartCardDisplay(targetRootCard);
  setStatus("Plots combined");
  return true;
}

function removeChartFromGroups(chartKey, { reveal = true, announce = true } = {}) {
  const rootKey = getRootChartKey(chartKey);
  const groupKeys = state.chartGroups[rootKey];

  if (!groupKeys) {
    return false;
  }

  const remainingKeys = groupKeys.filter((key) => key !== chartKey);
  delete state.chartGroups[rootKey];

  if (remainingKeys.length > 1) {
    const nextRootKey = remainingKeys.includes(rootKey) ? rootKey : remainingKeys[0];
    state.chartGroups[nextRootKey] = uniqueStrings([
      nextRootKey,
      ...remainingKeys.filter((key) => key !== nextRootKey),
    ]);
    applyChartGroupVisibility(nextRootKey);
  } else {
    revealUngroupedChartCard(remainingKeys[0], getChartCard(rootKey));
  }

  if (reveal) {
    revealUngroupedChartCard(chartKey, getChartCard(rootKey));
  }

  const currentRootCard = getChartCard(getRootChartKey(rootKey));
  if (currentRootCard) {
    refreshChartCardDisplay(currentRootCard);
  }

  if (announce) {
    setStatus("Plot split out");
  }

  return true;
}

function splitChartGroup(chartKey) {
  const rootKey = getRootChartKey(chartKey);
  const groupKeys = state.chartGroups[rootKey];
  const rootCard = getChartCard(rootKey);

  if (!groupKeys || groupKeys.length < 2) {
    return false;
  }

  delete state.chartGroups[rootKey];

  let anchorCard = rootCard;
  groupKeys.forEach((key) => {
    const card = getChartCard(key);

    if (!card) {
      return;
    }

    delete card.dataset.combinedInto;

    if (anchorCard && card !== anchorCard) {
      anchorCard.after(card);
    }

    anchorCard = card;
    applyChartCardVisibility(card);
    refreshChartCardDisplay(card);
  });

  setStatus("Plots split");
  return true;
}

function syncChartGroupsWithAvailableCharts() {
  const baseCharts = getAllCharts();

  Object.entries({ ...state.chartGroups }).forEach(([rootKey, groupKeys]) => {
    const keptKeys = groupKeys.filter((key) => baseCharts[key] && isChartEnabled(key));
    const removedKeys = groupKeys.filter((key) => !keptKeys.includes(key));

    removedKeys.forEach((key) => revealUngroupedChartCard(key));

    if (!keptKeys.includes(rootKey)) {
      delete state.chartGroups[rootKey];
      keptKeys.forEach((key) => revealUngroupedChartCard(key));
      return;
    }

    if (keptKeys.length > 1) {
      state.chartGroups[rootKey] = keptKeys;
      applyChartGroupVisibility(rootKey);
    } else {
      delete state.chartGroups[rootKey];
      revealUngroupedChartCard(keptKeys[0]);
    }
  });
}

function applyChartGroupVisibility(rootKey) {
  const groupKeys = getChartGroupKeys(rootKey);
  const rootCard = getChartCard(rootKey);
  let anchorCard = rootCard;

  if (!rootCard) {
    return;
  }

  delete rootCard.dataset.combinedInto;
  applyChartCardVisibility(rootCard);

  groupKeys
    .filter((key) => key !== rootKey)
    .forEach((key) => {
      const card = getChartCard(key);

      if (!card) {
        return;
      }

      if (anchorCard) {
        anchorCard.after(card);
      }

      anchorCard = card;
      card.dataset.combinedInto = rootKey;
      card.hidden = true;
      card.setAttribute("aria-hidden", "true");
    });
}

function revealUngroupedChartCard(chartKey, insertAfterCard = null) {
  if (!chartKey) {
    return;
  }

  const card = getChartCard(chartKey);

  if (!card) {
    return;
  }

  delete card.dataset.combinedInto;

  if (insertAfterCard && insertAfterCard !== card) {
    insertAfterCard.after(card);
  }

  applyChartCardVisibility(card);
  refreshChartCardDisplay(card);
}

function applyChartCardVisibility(card) {
  const hidden = Boolean(card.dataset.combinedInto) || !isChartEnabled(card.dataset.chartCard);
  card.toggleAttribute("hidden", hidden);
  card.setAttribute("aria-hidden", String(hidden));
}

function isChartEnabled(chartKey) {
  const toggle = [...app.querySelectorAll("[data-plot-toggle]")]
    .find((item) => item.value === chartKey);

  return !toggle || toggle.checked;
}

function getChartGroupKeys(chartKey) {
  return state.chartGroups[chartKey] || [chartKey];
}

function getRootChartKey(chartKey) {
  if (!chartKey) {
    return "";
  }

  const groupEntry = Object.entries(state.chartGroups)
    .find(([, groupKeys]) => groupKeys.includes(chartKey));

  return groupEntry?.[0] || chartKey;
}

function getChartCard(chartKey) {
  return [...query(".chart-grid").querySelectorAll("[data-chart-card]")]
    .find((card) => card.dataset.chartCard === chartKey) || null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
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
  const chart = getRenderableChartForCard(card);

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
  const chart = getRenderableChartForCard(card);

  if (card && chart && !card.hidden) {
    renderChart(card, chart);
  }
}

function handleSerialLine(line) {
  const receivedAt = new Date();
  const values = parseCsvLine(line);
  updateRawDebugReadout(line, values);

  if (isHeaderRow(values)) {
    setStatus("Header received");
    return;
  }

  if (state.skipNextSerialLine) {
    state.skipNextSerialLine = false;

    if (!isCsvLikeLine(line, values)) {
      setStatus(line);
      return;
    }
  }

  const record = mapSerialValues(values, line, receivedAt);

  if (!record) {
    reportSerialNotice(line, values);
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

function mapSerialValues(values, rawLine, receivedAt = new Date()) {
  if (!state.schema?.columns?.length || values.length === 0) {
    return null;
  }

  const resolved = resolveYpodSchemaForValues(state.yamlResource, state.schema, values);

  if (!resolved) {
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
    fields[column.name] = normalizedValues[index];
  });

  const numericValues = {};
  schema.columns.forEach((column, index) => {
    const value = Number(normalizedValues[index]);

    if (Number.isFinite(value)) {
      numericValues[columnValueKey(index)] = value;
    }
  });

  return {
    timestamp: receivedAt,
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

function reportSerialNotice(line, values) {
  if (isCsvLikeLine(line, values)) {
    return;
  }

  setStatus(line);
}

function resetData() {
  state.hoverPoint = null;
  state.records = [];
  query("[data-row-count]").textContent = "0";
  query("[data-last-time]").textContent = "--";
  query("[data-latest-line]").textContent = "--";
  renderDebugValues();
  app.querySelectorAll("[data-chart-stats]").forEach((stats) => {
    stats.textContent = "--";
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
  syncChartGroupsWithAvailableCharts();
  query(".chart-grid")
    .querySelectorAll(".chart-card")
    .forEach((card) => {
      const chart = getRenderableChartForCard(card);
      refreshChartCardDisplay(card, chart);

      if (chart && !card.hidden) {
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

  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);

  const records = visibleRecords();
  const axisGroups = getChartAxisGroups(chart);
  const plottedSeries = axisGroups.flatMap((axisGroup) => axisGroup.series);
  const seriesValues = plottedSeries.flatMap((series) =>
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
    right: width - (axisGroups.length > 1 ? 54 : 14),
    top: 12,
    bottom: height - 28,
  };
  const times = records.map((record) => record.timestamp.getTime());
  const xMin = Math.min(...times);
  const xMax = Math.max(...times);
  const leftAxisGroup = axisGroups.find((axisGroup) => axisGroup.id === "left") || axisGroups[0];
  const rightAxisGroup = axisGroups.find((axisGroup) => axisGroup.id === "right");
  const axisRanges = Object.fromEntries(
    axisGroups
      .map((axisGroup) => {
        const values = getAxisValues(axisGroup, records);

        if (values.length === 0) {
          return [axisGroup.id, null];
        }

        return [
          axisGroup.id,
          getYRange(values, axisGroup.minZero, getDefaultYRangeForSeries(axisGroup.series)),
        ];
      })
      .filter(([, range]) => range),
  );
  const leftRange = axisRanges.left || Object.values(axisRanges)[0];
  const rightRange = axisRanges.right || null;
  const leftLabel = leftAxisGroup?.unitLabel || "";
  const rightLabel = rightRange ? rightAxisGroup?.unitLabel || "" : "";

  if (leftLabel || rightLabel) {
    plot.top = 24;
  }

  drawGrid(context, plot, width, height, xMin, xMax, leftRange, theme, {
    rightRange,
    leftLabel,
    rightLabel,
  });

  plottedSeries.forEach((series) => {
    const yRange = axisRanges[series.axis] || leftRange;
    drawSeries(context, records, series, plot, xMin, xMax, yRange, theme);
  });

  if (hoverPoint) {
    drawHoverTooltip(context, hoverPoint, width, height, theme);
  }

  if (updateStats) {
    updateChartStats(chart, records);
  }
}

function findNearestChartPoint(canvas, chart, pointer) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(MIN_CHART_WIDTH, rect.width);
  const height = Math.max(MIN_CHART_HEIGHT, rect.height);
  const records = visibleRecords();
  const axisGroups = getChartAxisGroups(chart);
  const plottedSeries = axisGroups.flatMap((axisGroup) => axisGroup.series);
  const seriesValues = plottedSeries.flatMap((series) =>
    records
      .map((record) => record.values[series.key])
      .filter((value) => Number.isFinite(value)),
  );

  if (records.length === 0 || seriesValues.length === 0) {
    return null;
  }

  const plot = {
    left: 54,
    right: width - (axisGroups.length > 1 ? 54 : 14),
    top: 12,
    bottom: height - 28,
  };
  const times = records.map((record) => record.timestamp.getTime());
  const xMin = Math.min(...times);
  const xMax = Math.max(...times);
  const axisRanges = Object.fromEntries(
    axisGroups
      .map((axisGroup) => {
        const values = getAxisValues(axisGroup, records);

        if (values.length === 0) {
          return [axisGroup.id, null];
        }

        return [
          axisGroup.id,
          getYRange(values, axisGroup.minZero, getDefaultYRangeForSeries(axisGroup.series)),
        ];
      })
      .filter(([, range]) => range),
  );
  const leftRange = axisRanges.left || Object.values(axisRanges)[0];
  const leftLabel = axisGroups.find((axisGroup) => axisGroup.id === "left")?.unitLabel || "";
  const rightRange = axisRanges.right || null;
  const rightLabel = rightRange
    ? axisGroups.find((axisGroup) => axisGroup.id === "right")?.unitLabel || ""
    : "";

  if (leftLabel || rightLabel) {
    plot.top = 24;
  }

  const points = plottedSeries.flatMap((series) => {
    const yRange = axisRanges[series.axis] || leftRange;
    const column = resolveColumnForSeries(series.key);
    const fieldLabel = column ? formatFieldLabel(column.name) : series.sourceTitle || series.key;
    const sourceLabel = series.sourceTitle || fieldLabel;
    const label = chart.isCombined && series.sourceSeriesCount > 1
      ? `${sourceLabel}: ${fieldLabel}`
      : (chart.isCombined ? sourceLabel : fieldLabel);

    return records
      .map((record) => {
        const value = record.values[series.key];

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
          label,
          unit: series.unitLabel || column?.unit || "",
          color: getSeriesColor(series, getLiveChartTheme()),
        };
      })
      .filter(Boolean);
  });

  return nearestPoint(points, pointer);
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
  const chart = getRenderableChartForCard(card);
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

function makeFileTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

function getRenderableChartForCard(card) {
  if (!card || card.dataset.combinedInto) {
    return null;
  }

  const baseCharts = getAllCharts();
  const chartKey = card.dataset.chartCard;
  const baseChart = baseCharts[chartKey];

  if (!baseChart) {
    return null;
  }

  const groupKeys = getChartGroupKeys(chartKey)
    .filter((key) => baseCharts[key] && isChartEnabled(key));

  if (groupKeys.length > 1) {
    return makeCombinedChart(chartKey, groupKeys, baseCharts);
  }

  return makeRenderableSourceChart(chartKey, baseChart);
}

function makeCombinedChart(rootKey, groupKeys, baseCharts) {
  const sources = groupKeys
    .map((key) => makeChartSource(key, baseCharts[key]))
    .filter(Boolean);
  const rootSource = sources.find((source) => source.key === rootKey) || sources[0];
  const combinedSeries = sources.flatMap((source) => source.series);
  const leftUnitKey = combinedSeries[0]?.unitKey || "";
  const rightUnitKey = combinedSeries.find((series) => series.unitKey !== leftUnitKey)?.unitKey || "";
  const leftSeries = combinedSeries.filter((series) => !rightUnitKey || series.unitKey === leftUnitKey);
  const rightSeries = rightUnitKey
    ? combinedSeries.filter((series) => series.unitKey !== leftUnitKey)
    : [];
  const axisGroups = [
    makeAxisGroup("left", leftSeries),
    ...(rightSeries.length > 0 ? [makeAxisGroup("right", rightSeries)] : []),
  ];

  return {
    ...rootSource.chart,
    key: rootKey,
    canvas: rootSource.chart.canvas,
    stats: rootSource.chart.stats,
    title: sources.map((source) => source.title).join(" + "),
    unit: axisGroups.map((axisGroup) => axisGroup.unitLabel).filter(Boolean).join(" / "),
    isCombined: true,
    sources,
    series: axisGroups.flatMap((axisGroup) => axisGroup.series),
    axisGroups,
  };
}

function makeRenderableSourceChart(chartKey, chart) {
  const source = makeChartSource(chartKey, chart);

  return {
    ...chart,
    key: chartKey,
    title: source.title,
    unit: source.unit,
    sources: [source],
    series: source.series,
    axisGroups: [makeAxisGroup("left", source.series)],
  };
}

function makeChartSource(chartKey, chart) {
  if (!chart) {
    return null;
  }

  const card = getChartCard(chartKey);
  const title = chart.title || card?.dataset.chartBaseTitle || formatFieldLabel(chartKey);
  const fallbackUnit = chart.unit || card?.dataset.chartBaseUnit || "";
  const series = chart.series.map((seriesItem) => {
    const unit = getSeriesUnit(seriesItem, chart, fallbackUnit);

    return {
      ...seriesItem,
      sourceKey: chartKey,
      sourceTitle: title,
      sourceSeriesCount: chart.series.length,
      marker: seriesItem.marker ?? chart.marker,
      minZero: Boolean(seriesItem.minZero ?? chart.minZero),
      unitLabel: unit.label,
      unitKey: unit.key,
    };
  });

  return {
    key: chartKey,
    chart,
    title,
    unit: getAxisUnitLabel(series) || fallbackUnit,
    series,
  };
}

function makeAxisGroup(id, series) {
  return {
    id,
    unitLabel: getAxisUnitLabel(series),
    minZero: series.some((item) => item.minZero),
    series: series.map((item) => ({ ...item, axis: id })),
  };
}

function getChartAxisGroups(chart) {
  if (chart.axisGroups?.length) {
    return chart.axisGroups;
  }

  return [makeAxisGroup("left", chart.series)];
}

function getAxisValues(axisGroup, records) {
  return axisGroup.series.flatMap((series) =>
    records
      .map((record) => record.values[series.key])
      .filter((value) => Number.isFinite(value)),
  );
}

function getSeriesUnit(series, chart, fallbackUnit = "") {
  const label = resolveColumnForSeries(series.key)?.unit || chart.unit || fallbackUnit || "";

  return {
    label,
    key: normalizeUnit(label),
  };
}

function getAxisUnitLabel(series) {
  const labels = uniqueStrings(series.map((item) => item.unitLabel).filter(Boolean));

  if (labels.length === 0) {
    return "";
  }

  return labels.length === 1 ? labels[0] : "mixed units";
}

function normalizeUnit(unit) {
  return String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function visibleRecords() {
  if (state.records.length === 0) {
    return state.records;
  }

  const latest = state.records[state.records.length - 1].timestamp.getTime();
  return state.records.filter((record) => latest - record.timestamp.getTime() <= state.displayWindowMs);
}

function getDefaultYRange(chart) {
  return getDefaultYRangeForSeries(chart.series);
}

function getDefaultYRangeForSeries(seriesItems) {
  const ranges = seriesItems
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

function drawGrid(
  context,
  plot,
  width,
  height,
  xMin,
  xMax,
  yRange,
  theme,
  { rightRange = null, leftLabel = "", rightLabel = "" } = {},
) {
  context.strokeStyle = theme.grid;
  context.lineWidth = 1;
  context.font = "11px Arial, Helvetica, sans-serif";
  context.fillStyle = theme.text;
  context.textAlign = "left";

  drawAxisUnitLabels(context, plot, width, theme, { leftLabel, rightLabel });

  for (let step = 0; step <= 4; step += 1) {
    const ratio = step / 4;
    const y = plot.top + (plot.bottom - plot.top) * ratio;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();

    const value = yRange.max - (yRange.max - yRange.min) * ratio;
    context.fillText(formatNumber(value), 8, y + 4);

    if (rightRange) {
      const rightValue = rightRange.max - (rightRange.max - rightRange.min) * ratio;
      context.textAlign = "right";
      context.fillText(formatNumber(rightValue), width - 8, y + 4);
      context.textAlign = "left";
    }
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

function drawAxisUnitLabels(context, plot, width, theme, { leftLabel = "", rightLabel = "" } = {}) {
  if (!leftLabel && !rightLabel) {
    return;
  }

  context.save();
  context.fillStyle = theme.text;
  context.font = "700 10px Arial, Helvetica, sans-serif";
  context.textBaseline = "alphabetic";

  if (leftLabel) {
    context.textAlign = "left";
    context.fillText(leftLabel, 8, Math.max(10, plot.top - 9));
  }

  if (rightLabel) {
    context.textAlign = "right";
    context.fillText(rightLabel, width - 8, Math.max(10, plot.top - 9));
  }

  context.restore();
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
  if (chart.isCombined) {
    const axisSummary = getChartAxisGroups(chart)
      .map((axisGroup) => `${axisGroup.id === "left" ? "L" : "R"} ${axisGroup.unitLabel || "axis"}`)
      .join(" | ");
    query(`[data-chart-stats="${chart.stats}"]`).textContent =
      `${chart.sources.length} plots${axisSummary ? ` | ${axisSummary}` : ""}`;
    return;
  }

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
