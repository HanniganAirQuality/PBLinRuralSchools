import { getLanguage, initializeI18n, t } from "../core/i18n.js";
import { SerialLineReader } from "../core/serial-lines.js";
import {
  getPreferredYpodSection,
  getPreferredYpodVersion,
  getYpodSectionSchema,
  loadYpodHeaderLogResource,
  normalizeValuesForSchema,
  resolveYpodSchemaForValues,
} from "../core/ypod-yaml.js";

const POLLUTANTS = [
  { id: "co2", aliases: ["CO2", "ELT_CO2", "K30_CO2"], minimumScale: 1000 },
  { id: "co", aliases: ["Calibrated_CO", "CO", "CO_ISB"], minimumScale: 10 },
  { id: "pm25", aliases: ["PM25_ENV", "PM2_5", "PM25", "PM2.5"], minimumScale: 100 },
  { id: "tvoc", aliases: ["Calibrated_TVOC", "TVOC"], minimumScale: 10 },
  { id: "vocLight", aliases: ["Fig2600_LightVOC", "LightVOC"], minimumScale: 10000 },
  { id: "vocHeavy", aliases: ["Fig2602_HeavyVOC", "HeavyVOC"], minimumScale: 10000 },
  { id: "ozone", aliases: ["Ozone"], minimumScale: 1000 },
];

const app = document.querySelector("[data-pollutant-battle]");
const state = {
  ready: false,
  yamlResource: null,
  schema: null,
  manualSchema: false,
  podCount: 2,
  selected: new Set(["co2", "co", "pm25"]),
  views: new Map(),
  renderQueued: false,
  pods: [1, 2, 3, 4].map((id) => ({
    id,
    serial: null,
    connecting: false,
    disconnecting: false,
    schema: null,
    readings: new Map(),
    samples: 0,
    statusKey: "co2Battle.notConnected",
  })),
};

if (app) {
  init();
}

document.addEventListener("haq:languagechange", () => {
  if (state.ready) {
    refreshLanguage();
  }
});

async function init() {
  await initializeI18n();
  bindControls();
  state.ready = true;
  refreshLanguage();
  await loadSchema();
}

function bindControls() {
  query("[data-pod-count]").value = String(state.podCount);
  query("[data-pod-count]").addEventListener("change", handlePodCountChange);
  state.pods.forEach((pod) => {
    query(`[data-connect-pod="${pod.id}"]`).addEventListener("click", () => connectPod(pod));
    query(`[data-disconnect-pod="${pod.id}"]`).addEventListener("click", () => disconnectPod(pod));
    query(`[data-pod-name="${pod.id}"]`).addEventListener("input", queueRender);
    query(`[data-pod-color="${pod.id}"]`).addEventListener("input", queueRender);
  });
  query("[data-yaml-version]").addEventListener("change", () => {
    populateSections();
    applySchema(true);
  });
  query("[data-yaml-section]").addEventListener("change", () => applySchema(true));
  query("[data-reset-round]").addEventListener("click", resetRound);
}

function getActivePods() {
  return state.pods.slice(0, state.podCount);
}

function isPodActive(pod) {
  return pod.id <= state.podCount;
}

async function handlePodCountChange() {
  const select = query("[data-pod-count]");
  const count = Number(select.value);
  if (!Number.isInteger(count) || count < 1 || count > state.pods.length) {
    select.value = String(state.podCount);
    return;
  }
  const removed = getActivePods().filter((pod) => pod.id > count);
  state.podCount = count;
  const disconnects = removed.map((pod) => {
    pod.readings.clear();
    pod.samples = 0;
    return disconnectPod(pod);
  });
  rebuildPlots();
  renderControls();
  renderBattle();
  await Promise.all(disconnects);
}

async function loadSchema() {
  try {
    state.yamlResource = await loadYpodHeaderLogResource();
    const select = query("[data-yaml-version]");
    const versions = state.yamlResource.index.map((item) => item.version);
    select.replaceChildren(...versions.map((version) => {
      const option = makeElement("option", "", version);
      option.value = version;
      return option;
    }));
    select.value = getPreferredYpodVersion(versions);
    populateSections();
    applySchema(false);
  } catch {
    query("[data-schema-status]").textContent = t("pollutantBattle.schema.failed");
    renderControls();
  }
}

function populateSections() {
  const version = query("[data-yaml-version]").value;
  const select = query("[data-yaml-section]");
  const previous = select.value;
  const sections = state.yamlResource.index.find((item) => item.version === version)?.sections || [];
  select.replaceChildren(...sections.map((section) => {
    const option = makeElement("option", "", section);
    option.value = section;
    return option;
  }));
  select.value = getPreferredYpodSection(sections, previous);
}

function applySchema(manual) {
  try {
    const version = query("[data-yaml-version]").value;
    const section = query("[data-yaml-section]").value;
    const schema = getYpodSectionSchema(state.yamlResource, version, section);
    state.schema = schema;
    state.manualSchema = manual;
    state.pods.forEach((pod) => { pod.schema = schema; });
    query("[data-schema-link]").href = schema.htmlUrl;
    renderSchemaStatus();
    populatePollutants();
    rebuildPlots();
    resetRound();
    renderControls();
  } catch {
    query("[data-schema-status]").textContent = t("pollutantBattle.schema.failed");
  }
}

function renderSchemaStatus() {
  if (state.schema) {
    query("[data-schema-status]").textContent = t("pollutantBattle.schema.status", {
      version: state.schema.version,
      section: state.schema.section,
      source: state.schema.isFallback
        ? t("co2Battle.builtInFallback")
        : t("pollutantBattle.schema.columns", { count: state.schema.columns.length }),
    });
  }
}

function refreshLanguage() {
  state.pods.forEach((pod) => {
    query(`[data-pod-name="${pod.id}"]`).placeholder = t("pollutantBattle.podName", { id: pod.id });
    query(`[data-pod-name-label="${pod.id}"]`).textContent = t("pollutantBattle.podNameLabel", { id: pod.id });
    query(`[data-pod-color-label="${pod.id}"]`).textContent = t("pollutantBattle.podColorLabel", { id: pod.id });
  });
  renderSchemaStatus();
  populatePollutants();
  rebuildPlots();
  renderControls();
  renderBattle();
}

function populatePollutants() {
  const options = POLLUTANTS.map((pollutant) => {
    const column = findColumn(state.schema, pollutant);
    const label = makeElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = pollutant.id;
    input.disabled = !column;
    input.checked = Boolean(column && state.selected.has(pollutant.id));
    const name = pollutantLabel(pollutant);
    const text = column ? name : t("pollutantBattle.selection.unavailable", { label: name });
    input.addEventListener("change", () => {
      if (input.checked) {
        state.selected.add(pollutant.id);
      } else {
        state.selected.delete(pollutant.id);
      }
      rebuildPlots();
      renderBattle();
    });
    label.append(input, makeElement("span", "", text));
    return label;
  });
  query("[data-pollutant-toggles]").replaceChildren(...options);
}

function rebuildPlots() {
  state.views.clear();
  const sections = POLLUTANTS.filter((pollutant) =>
    state.selected.has(pollutant.id) && findColumn(state.schema, pollutant),
  ).map((pollutant) => {
    const section = makeElement("section", "pollutant-round");
    const heading = makeElement("header", "pollutant-round-heading");
    const column = findColumn(state.schema, pollutant);
    const title = makeElement("h2", "", measurementLabel(pollutant, column.unit));
    title.id = `pollutant-${pollutant.id}`;
    section.setAttribute("aria-labelledby", title.id);
    const leader = makeElement("div", "battle-leader");
    leader.setAttribute("role", "status");
    const scale = makeElement("div", "battle-scale-label");
    heading.append(title, leader, scale);
    const grid = makeElement("div", "battle-grid");
    grid.style.setProperty("--pod-count", String(state.podCount));
    const cards = getActivePods().map((pod) => makePodCard(pod, pollutant));
    grid.append(...cards.map((card) => card.element));
    section.append(heading, grid);
    state.views.set(pollutant.id, { leader, scale, cards, column });
    return section;
  });
  query("[data-pollutant-plots]").replaceChildren(...sections);
  query("[data-pollutant-plots]").setAttribute("data-pod-count", String(state.podCount));
  query("[data-empty-selection]").hidden = sections.length > 0 || !state.schema;
}

function makePodCard(pod, pollutant) {
  const element = makeElement("article", "battle-card");
  const header = makeElement("header");
  const title = makeElement("h3");
  const subtitle = makeElement("p", "", t("pollutantBattle.live", { label: pollutantLabel(pollutant) }));
  header.append(title, subtitle);
  const reading = makeElement("strong", "battle-reading");
  const value = makeElement("span");
  const unit = makeElement("span");
  reading.append(value, unit);
  const meter = makeElement("div", "battle-meter");
  meter.setAttribute("aria-hidden", "true");
  const scale = makeElement("div", "battle-meter-scale");
  const maximum = makeElement("span");
  const midpoint = makeElement("span");
  scale.append(maximum, midpoint, makeElement("span", "", formatNumber(0)));
  const track = makeElement("div", "battle-meter-track");
  track.append(makeElement("div", "battle-meter-fill"), makeElement("div", "battle-peak-marker"));
  meter.append(scale, track);
  const peak = makeElement("p", "battle-peak");
  element.append(header, reading, meter, peak);
  return { element, title, reading, value, unit, meter, maximum, midpoint, peak, pod };
}

async function connectPod(pod) {
  if (!isPodActive(pod) || pod.serial || pod.connecting || pod.disconnecting || !state.schema || !SerialLineReader.isSupported()) {
    return;
  }
  pod.connecting = true;
  setStatus(pod, "co2Battle.status.chooseSerialPort");
  renderControls();
  const serial = new SerialLineReader({
    baudRate: 9600,
    onLine: (line) => {
      if (pod.serial === serial && isPodActive(pod)) {
        handleSerialLine(pod, line);
      }
    },
    onError: () => {
      if (pod.serial === serial && isPodActive(pod)) {
        setStatus(pod, "common.serialReadError");
      }
    },
    onDisconnect: () => {
      if (pod.serial === serial) {
        pod.serial = null;
        pod.connecting = false;
        clearCurrent(pod);
        setStatus(pod, "co2Battle.serialConnectionLostReconnectToContinue");
        renderControls();
        queueRender();
      }
    },
  });
  pod.serial = serial;
  pod.schema = state.schema;
  try {
    await serial.connect();
    if (pod.serial !== serial || !isPodActive(pod)) {
      await serial.disconnect();
      return;
    }
    pod.connecting = false;
    if (pod.statusKey === "co2Battle.status.chooseSerialPort") {
      setStatus(pod, "pollutantBattle.status.waiting");
    }
  } catch {
    await serial.closePort();
    if (pod.serial !== serial) {
      return;
    }
    pod.serial = null;
    pod.connecting = false;
    clearCurrent(pod);
    setStatus(pod, "pollutantBattle.status.failed");
  }
  renderControls();
  queueRender();
}

async function disconnectPod(pod) {
  const serial = pod.serial;
  pod.disconnecting = true;
  pod.serial = null;
  pod.connecting = false;
  clearCurrent(pod);
  setStatus(pod, "co2Battle.notConnected");
  renderControls();
  queueRender();
  try {
    await serial?.disconnect();
  } catch {
    setStatus(pod, "pollutantBattle.status.disconnectFailed");
  } finally {
    pod.disconnecting = false;
    renderControls();
  }
}

function clearCurrent(pod) {
  pod.readings.forEach((reading) => { reading.current = null; });
}

function handleSerialLine(pod, line) {
  if (!isPodActive(pod) || !state.yamlResource || !pod.schema) {
    return;
  }
  const values = parseCsvLine(line);
  const first = normalizeFieldName(values[0]);
  if (["datetime", "timestamp", "ypodid"].includes(first)) {
    return;
  }
  const manualValues = state.manualSchema ? normalizeValuesForSchema(values, state.schema.columns) : null;
  const resolved = state.manualSchema
    ? (manualValues ? { schema: state.schema, values: manualValues } : null)
    : resolveYpodSchemaForValues(state.yamlResource, pod.schema, values);
  if (!resolved) {
    return;
  }
  pod.schema = resolved.schema;
  let hasReading = false;
  POLLUTANTS.forEach((pollutant) => {
    const expected = findColumn(state.schema, pollutant);
    const column = findColumn(resolved.schema, pollutant);
    const reading = pod.readings.get(pollutant.id) || { current: null, peak: null };
    const raw = column ? resolved.values[resolved.schema.columns.indexOf(column)] : "";
    const value = String(raw ?? "").trim() === "" ? NaN : Number(raw);
    const compatible = expected && column
      && normalizeFieldName(column.name) === normalizeFieldName(expected.name)
      && column.unit === expected.unit;
    reading.current = compatible && Number.isFinite(value) ? value : null;
    if (reading.current !== null) {
      reading.peak = reading.peak === null ? value : Math.max(reading.peak, value);
      hasReading = true;
    }
    pod.readings.set(pollutant.id, reading);
  });
  if (hasReading) {
    pod.samples += 1;
    setStatus(pod, "pollutantBattle.status.live");
  } else {
    setStatus(pod, "pollutantBattle.status.noMeasurements");
  }
  queueRender();
}

function resetRound() {
  state.pods.forEach((pod) => {
    pod.readings.clear();
    pod.samples = 0;
    if (pod.serial && !pod.connecting) {
      setStatus(pod, "pollutantBattle.status.waiting");
    }
  });
  renderBattle();
}

function queueRender() {
  if (!state.renderQueued) {
    state.renderQueued = true;
    window.requestAnimationFrame(() => {
      state.renderQueued = false;
      renderBattle();
    });
  }
}

function renderBattle() {
  state.views.forEach((view, id) => {
    const pollutant = POLLUTANTS.find((item) => item.id === id);
    const readings = getActivePods().map((pod) => pod.readings.get(id));
    const highest = Math.max(0, ...readings.flatMap((reading) => [reading?.current || 0, reading?.peak || 0]));
    const maximum = Math.max(pollutant.minimumScale, niceCeiling(highest * 1.15));
    const unit = view.column.unit;
    view.scale.textContent = t("pollutantBattle.scale", { maximum: formatNumber(maximum), unit });
    view.cards.forEach((card, index) => {
      const reading = readings[index];
      card.element.style.setProperty("--pod-color", query(`[data-pod-color="${card.pod.id}"]`).value);
      card.title.textContent = getPodName(card.pod);
      card.value.textContent = formatNumber(reading?.current);
      card.unit.textContent = unit;
      card.reading.setAttribute("aria-label", valueWithUnit(reading?.current, unit));
      card.peak.textContent = t("pollutantBattle.peak", { value: valueWithUnit(reading?.peak, unit) });
      card.maximum.textContent = formatNumber(maximum);
      card.midpoint.textContent = formatNumber(maximum / 2);
      card.meter.style.setProperty("--level", `${percent(reading?.current, maximum)}%`);
      card.meter.style.setProperty("--peak", `${percent(reading?.peak, maximum)}%`);
      card.meter.style.setProperty("--has-peak", Number.isFinite(reading?.peak) ? "1" : "0");
    });
    renderLeader(view.leader, readings, unit);
  });
}

function renderLeader(target, readings, unit) {
  const pods = getActivePods();
  target.hidden = pods.length === 1;
  target.classList.remove("has-leader", "is-tied");
  if (target.hidden) {
    target.textContent = "";
    return;
  }
  const values = readings.map((reading) => reading?.current);
  if (values.some((value) => !Number.isFinite(value))) {
    const waiting = pods.filter((pod, index) => !Number.isFinite(values[index]));
    const names = new Intl.ListFormat(getLanguage(), { type: "conjunction" }).format(waiting.map(getPodName));
    target.textContent = t("pollutantBattle.leader.waiting", { names });
  } else {
    const highest = Math.max(...values);
    const leaders = pods.filter((pod, index) => values[index] === highest);
    if (leaders.length > 1) {
      const names = new Intl.ListFormat(getLanguage(), { type: "conjunction" }).format(leaders.map(getPodName));
      target.textContent = t("pollutantBattle.leader.tiedPods", { names, value: valueWithUnit(highest, unit) });
      target.classList.add("is-tied");
      return;
    }
    const runnerUp = Math.max(...values.filter((value) => value !== highest));
    target.textContent = t("pollutantBattle.leader.leading", {
      name: getPodName(leaders[0]),
      difference: valueWithUnit(highest - runnerUp, unit),
    });
    target.classList.add("has-leader");
  }
}

function renderControls() {
  const supported = SerialLineReader.isSupported();
  state.pods.forEach((pod) => {
    const active = isPodActive(pod);
    query(`[data-pod-controls="${pod.id}"]`).hidden = !active;
    query(`[data-pod-color-control="${pod.id}"]`).hidden = !active;
    query(`[data-connect-pod="${pod.id}"]`).disabled = !active || !supported || !state.schema || Boolean(pod.serial) || pod.connecting || pod.disconnecting;
    query(`[data-disconnect-pod="${pod.id}"]`).disabled = !pod.serial || pod.connecting;
    const statusKey = pod.statusKey === "pollutantBattle.status.live" && pod.samples === 1
      ? "pollutantBattle.status.liveOne" : pod.statusKey;
    query(`[data-pod-status="${pod.id}"]`).textContent = supported
      ? t(statusKey, { count: formatNumber(pod.samples) })
      : t("pollutantBattle.status.unsupported");
  });
}

function setStatus(pod, key) {
  pod.statusKey = key;
  renderControls();
}

function findColumn(schema, pollutant) {
  for (const alias of pollutant.aliases) {
    const column = schema?.columns.find((item) => normalizeFieldName(item.name) === normalizeFieldName(alias));
    if (column) {
      return column;
    }
  }
  return null;
}

function getPodName(pod) {
  return query(`[data-pod-name="${pod.id}"]`).value.trim() || t("pollutantBattle.podName", { id: pod.id });
}

function pollutantLabel(pollutant) {
  return t(`pollutantBattle.pollutant.${pollutant.id}`);
}

function measurementLabel(pollutant, unit) {
  return t("pollutantBattle.measurement", { label: pollutantLabel(pollutant), unit });
}

function valueWithUnit(value, unit) {
  return t("pollutantBattle.valueWithUnit", { value: formatNumber(value), unit }).trim();
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? value.toLocaleString(getLanguage(), { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 })
    : t("pollutantBattle.value.empty");
}

function percent(value, maximum) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value / maximum * 100)) : 0;
}

function niceCeiling(value) {
  if (value <= 0) {
    return 0;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].find((step) => step >= value / magnitude) * magnitude;
}

function normalizeFieldName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function makeElement(tag, className = "", text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function query(selector) {
  return app.querySelector(selector);
}
