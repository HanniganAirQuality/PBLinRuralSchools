import { SerialLineReader } from "../core/serial-lines.js";
import {
  getPreferredYpodSection,
  getPreferredYpodVersion,
  getYpodSectionSchema,
  loadYpodHeaderLogResource,
  resolveYpodSchemaForValues,
} from "../core/ypod-yaml.js";

const BAUD_RATE = 9600;
const DEFAULT_MEASUREMENT = "CO2";

const app = document.querySelector("[data-co2-battle]");
const state = {
  yamlResource: null,
  defaultSchema: null,
  selectedColumn: null,
  scaleMaximum: 1000,
  pods: [makePodState(1), makePodState(2)],
};

if (app) {
  init();
}

async function init() {
  bindControls();
  renderBattle();

  if (!SerialLineReader.isSupported()) {
    state.pods.forEach((pod) => {
      setPodStatus(pod, "Web Serial unavailable—use Chrome or Edge");
      setConnectionButtons(pod, { unavailable: true });
    });
  }

  await loadSchema();
}

function makePodState(id) {
  return {
    id,
    serial: null,
    schema: null,
    current: null,
    peak: null,
    sampleCount: 0,
    connecting: false,
  };
}

function bindControls() {
  app.querySelectorAll("[data-connect-pod]").forEach((button) => {
    button.addEventListener("click", () => connectPod(Number(button.dataset.connectPod)));
  });

  app.querySelectorAll("[data-disconnect-pod]").forEach((button) => {
    button.addEventListener("click", () => disconnectPod(Number(button.dataset.disconnectPod)));
  });

  app.querySelectorAll("[data-pod-name]").forEach((input) => {
    input.addEventListener("input", renderBattle);
  });

  app.querySelector("[data-yaml-version]").addEventListener("change", handleVersionChange);
  app.querySelector("[data-yaml-section]").addEventListener("change", applySelectedSchema);
  app.querySelector("[data-measurement-select]").addEventListener("change", handleMeasurementChange);
  app.querySelector("[data-reset-round]").addEventListener("click", resetRound);
}

async function loadSchema() {
  const status = app.querySelector("[data-schema-status]");

  try {
    state.yamlResource = await loadYpodHeaderLogResource();
    populateVersionSelect();
    populateSectionSelect();
    applySelectedSchema({ reset: false });
  } catch (error) {
    status.textContent = error.message || "The YPOD setup could not be loaded.";
  }
}

function populateVersionSelect() {
  const select = app.querySelector("[data-yaml-version]");
  const versions = state.yamlResource?.index || [];
  const previous = select.value;
  select.replaceChildren();

  versions.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.version;
    option.textContent = item.version;
    select.append(option);
  });

  select.value = getPreferredYpodVersion(versions.map((item) => item.version), previous);
}

function populateSectionSelect() {
  const version = app.querySelector("[data-yaml-version]").value;
  const select = app.querySelector("[data-yaml-section]");
  const previous = select.value;
  const sections = state.yamlResource?.index.find((item) => item.version === version)?.sections || [];
  select.replaceChildren();

  sections.forEach((section) => {
    const option = document.createElement("option");
    option.value = section;
    option.textContent = section;
    select.append(option);
  });

  select.value = getPreferredYpodSection(sections, previous);
}

function handleVersionChange() {
  populateSectionSelect();
  applySelectedSchema();
}

function applySelectedSchema(options = {}) {
  const status = app.querySelector("[data-schema-status]");
  const version = app.querySelector("[data-yaml-version]").value;
  const section = app.querySelector("[data-yaml-section]").value;

  try {
    state.defaultSchema = getYpodSectionSchema(state.yamlResource, version, section);
    state.pods.forEach((pod) => {
      pod.schema = state.defaultSchema;
    });
    populateMeasurementSelect();

    const sourceLabel = state.defaultSchema.isFallback
      ? "built-in fallback"
      : `${state.defaultSchema.columns.length} columns`;
    app.querySelector("[data-schema-link]").href = state.defaultSchema.htmlUrl;
    status.textContent = `${version} ${section}, ${sourceLabel}`;

    if (options.reset !== false) {
      resetRound();
    } else {
      renderBattle();
    }
  } catch (error) {
    status.textContent = error.message || "Unable to load the selected YPOD schema.";
  }
}

function populateMeasurementSelect() {
  const select = app.querySelector("[data-measurement-select]");
  const previous = select.value || state.selectedColumn?.name || DEFAULT_MEASUREMENT;
  const columns = state.defaultSchema?.columns.filter(isPlottableColumn) || [];
  select.replaceChildren();

  columns.forEach((column) => {
    const option = document.createElement("option");
    option.value = column.name;
    option.textContent = `${formatFieldLabel(column.name)}${column.unit ? ` [${column.unit}]` : ""}`;
    select.append(option);
  });

  const selected = columns.find((column) => column.name === previous)
    || columns.find((column) => normalizeFieldName(column.name) === normalizeFieldName(DEFAULT_MEASUREMENT))
    || columns[0]
    || null;

  state.selectedColumn = selected;
  if (selected) {
    select.value = selected.name;
  }
}

function handleMeasurementChange() {
  const selectedName = app.querySelector("[data-measurement-select]").value;
  state.selectedColumn = state.defaultSchema?.columns.find((column) => column.name === selectedName) || null;
  resetRound();
}

async function connectPod(id) {
  const pod = getPod(id);

  if (!pod || pod.connecting || pod.serial) {
    return;
  }

  try {
    if (!state.defaultSchema) {
      await loadSchema();
    }

    if (!state.defaultSchema) {
      throw new Error("YPOD setup is not ready");
    }

    pod.connecting = true;
    setConnectionButtons(pod, { connecting: true });
    setPodStatus(pod, "Choose this pod's serial port…");

    const serial = new SerialLineReader({
      baudRate: BAUD_RATE,
      onLine: (line) => handleSerialLine(pod, line),
      onError: (error) => setPodStatus(pod, error.message || "Serial read error"),
      onDisconnect: () => handleUnexpectedDisconnect(pod),
    });

    pod.serial = serial;
    pod.schema = state.defaultSchema;
    await serial.connect();
    pod.connecting = false;
    setConnectionButtons(pod, { connected: true });
    setPodStatus(pod, `Connected—waiting for ${getMeasurementLabel()} data`);
  } catch (error) {
    pod.connecting = false;
    await pod.serial?.closePort();
    pod.serial = null;
    setConnectionButtons(pod);
    setPodStatus(pod, `Connection failed: ${error.message || "unable to open port"}`);
  }
}

async function disconnectPod(id) {
  const pod = getPod(id);

  if (!pod?.serial) {
    return;
  }

  const serial = pod.serial;
  pod.serial = null;
  await serial.disconnect();
  setConnectionButtons(pod);
  setPodStatus(pod, "Not connected");
}

function handleUnexpectedDisconnect(pod) {
  pod.serial = null;
  pod.connecting = false;
  setConnectionButtons(pod);
  setPodStatus(pod, "Serial connection lost—reconnect to continue");
}

function handleSerialLine(pod, line) {
  const values = parseCsvLine(line);

  if (isHeaderRow(values) || !state.yamlResource || !pod.schema) {
    return;
  }

  const resolved = resolveYpodSchemaForValues(state.yamlResource, pod.schema, values);

  if (!resolved) {
    return;
  }

  pod.schema = resolved.schema;
  const measurementIndex = findSelectedColumnIndex(resolved.schema);
  const rawValue = resolved.values[measurementIndex];

  if (measurementIndex === -1 || String(rawValue ?? "").trim() === "") {
    return;
  }

  const measurement = Number(rawValue);

  if (!Number.isFinite(measurement)) {
    return;
  }

  pod.current = measurement;
  pod.peak = pod.peak === null ? measurement : Math.max(pod.peak, measurement);
  pod.sampleCount += 1;
  setPodStatus(pod, `Live · ${pod.sampleCount.toLocaleString()} sample${pod.sampleCount === 1 ? "" : "s"}`);
  renderBattle();
}

function resetRound() {
  state.pods.forEach((pod) => {
    pod.current = null;
    pod.peak = null;
    pod.sampleCount = 0;

    if (pod.serial) {
      setPodStatus(pod, `Connected—waiting for ${getMeasurementLabel()} data`);
    }
  });

  state.scaleMaximum = getMinimumScale();
  renderBattle();
}

function renderBattle() {
  updateScaleMaximum();
  const measurementLabel = getMeasurementLabel();
  const measurementUnit = getMeasurementUnit();

  app.querySelectorAll("[data-measurement-label]").forEach((target) => {
    target.textContent = measurementLabel;
  });
  app.querySelectorAll("[data-measurement-unit]").forEach((target) => {
    target.textContent = measurementUnit;
  });

  state.pods.forEach((pod) => {
    const name = getPodName(pod);
    const currentPercent = percentOfScale(pod.current);
    const peakPercent = percentOfScale(pod.peak);
    const meter = app.querySelector(`[data-battle-meter="${pod.id}"]`);

    app.querySelector(`[data-pod-title="${pod.id}"]`).textContent = name;
    app.querySelector(`[data-current-value="${pod.id}"]`).textContent = formatReading(pod.current);
    app.querySelector(`[data-peak-value="${pod.id}"]`).textContent = formatReading(pod.peak);
    meter.style.setProperty("--level", `${currentPercent}%`);
    meter.style.setProperty("--peak", `${peakPercent}%`);
    meter.style.setProperty("--has-peak", pod.peak === null ? "0" : "1");
    meter.querySelector("[data-meter-maximum]").textContent = formatScale(state.scaleMaximum);
    meter.querySelector("[data-meter-midpoint]").textContent = formatScale(state.scaleMaximum / 2);
  });

  app.querySelector("[data-scale-maximum]").textContent = formatScale(state.scaleMaximum);
  renderLeader();
}

function renderLeader() {
  const leader = app.querySelector("[data-battle-leader]");
  const [first, second] = state.pods;
  leader.classList.remove("has-leader", "is-tied");

  if (first.current === null || second.current === null) {
    const waitingFor = state.pods.filter((pod) => pod.current === null).map(getPodName);
    leader.textContent = `Waiting for ${waitingFor.join(" and ")}`;
    return;
  }

  if (first.current === second.current) {
    leader.textContent = `Tied at ${formatReading(first.current)}${formatUnitSuffix()}`;
    leader.classList.add("is-tied");
    return;
  }

  const winningPod = first.current > second.current ? first : second;
  const difference = Math.abs(first.current - second.current);
  leader.textContent = `${getPodName(winningPod)} leads by ${formatReading(difference)}${formatUnitSuffix()}`;
  leader.classList.add("has-leader");
}

function updateScaleMaximum() {
  const minimumScale = getMinimumScale();
  const highest = Math.max(
    minimumScale,
    ...state.pods.flatMap((pod) => [pod.current || 0, pod.peak || 0]),
  );
  state.scaleMaximum = Math.max(minimumScale, niceCeiling(highest * 1.15));
}

function percentOfScale(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, (value / state.scaleMaximum) * 100));
}

function setConnectionButtons(pod, options = {}) {
  const connect = app.querySelector(`[data-connect-pod="${pod.id}"]`);
  const disconnect = app.querySelector(`[data-disconnect-pod="${pod.id}"]`);
  connect.disabled = Boolean(options.connected || options.connecting || options.unavailable);
  disconnect.disabled = !options.connected;
  connect.textContent = options.connecting ? "Connecting…" : "Connect";
}

function setPodStatus(pod, message) {
  app.querySelector(`[data-pod-status="${pod.id}"]`).textContent = message;
}

function getPod(id) {
  return state.pods.find((pod) => pod.id === id) || null;
}

function getPodName(pod) {
  const input = app.querySelector(`[data-pod-name="${pod.id}"]`);
  return input.value.trim() || `Pod ${pod.id}`;
}

function findSelectedColumnIndex(schema) {
  if (!state.selectedColumn) {
    return -1;
  }

  const selectedName = normalizeFieldName(state.selectedColumn.name);
  return schema.columns.findIndex((column) => normalizeFieldName(column.name) === selectedName);
}

function getMeasurementLabel() {
  if (!state.selectedColumn) {
    return "measurement";
  }

  return normalizeFieldName(state.selectedColumn.name) === "co2"
    ? "CO₂"
    : formatFieldLabel(state.selectedColumn.name);
}

function getMeasurementUnit() {
  return state.selectedColumn?.unit || "";
}

function formatUnitSuffix() {
  const unit = getMeasurementUnit();
  return unit ? ` ${unit}` : "";
}

function getMinimumScale() {
  const unit = getMeasurementUnit().toLowerCase();

  if (unit === "celsius" || unit === "deg c" || unit === "°c") {
    return 50;
  }

  if (unit === "%rh" || unit === "%") {
    return 100;
  }

  if (unit === "ug/m^3" || unit === "µg/m^3") {
    return 100;
  }

  return 1000;
}

function niceCeiling(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return getMinimumScale();
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function isPlottableColumn(column) {
  const unit = String(column.unit || "").toLowerCase();
  const dtype = String(column.dtype || "").toLowerCase();
  const name = normalizeFieldName(column.name);
  const nonNumericUnits = new Set(["", "na", "id", "timestamp", "date", "time"]);
  const nonNumericNames = new Set(["datetime", "timestamp", "ypodid", "firmwareversion"]);
  return !nonNumericUnits.has(unit)
    && !nonNumericNames.has(name)
    && !dtype.includes("string")
    && !dtype.includes("char")
    && !dtype.includes("timestamp");
}

function formatFieldLabel(name) {
  return String(name || "").replaceAll("_", " ");
}

function normalizeFieldName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isHeaderRow(values) {
  const first = values[0]?.toLowerCase() || "";
  return first === "datetime" || first === "timestamp" || first === "ypodid";
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
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current.trim());
  return values;
}

function formatReading(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function formatScale(value) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
