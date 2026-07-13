export const YPOD_HEADER_LOG_URL =
  "https://raw.githubusercontent.com/HanniganAirQuality/All-POD-YAMLs/main/YPOD_HeaderLog.yaml";

export const YPOD_HEADER_LOG_PAGE =
  "https://github.com/HanniganAirQuality/All-POD-YAMLs/blob/main/YPOD_HeaderLog.yaml";

export const SPOD_HEADER_LOG_URL =
  "https://raw.githubusercontent.com/HanniganAirQuality/All-POD-YAMLs/main/SPOD_HeaderLog.yaml";

export const SPOD_HEADER_LOG_PAGE =
  "https://github.com/HanniganAirQuality/All-POD-YAMLs/blob/main/SPOD_HeaderLog.yaml";

export const CURRENT_YPOD_VERSION = "YPOD_V4_2_0";

const FALLBACK_SCHEMA = {
  version: "YPOD_V4_2_0",
  section: "Calibrated",
  sourceUrl: YPOD_HEADER_LOG_URL,
  htmlUrl: YPOD_HEADER_LOG_PAGE,
  columns: [
    { name: "DateTime", unit: "timestamp" },
    { name: "EAST_LONGITUDE", unit: "NA" },
    { name: "NORTH_LATITUDE", unit: "NA" },
    { name: "YPODID", unit: "ID" },
    { name: "Firmware_Version", unit: "NA" },
    { name: "BME180_Temperature", unit: "Celsius", defaultAxisRange: [-20, 50] },
    { name: "BME180_Pressure", unit: "millibar", defaultAxisRange: [900, 1100] },
    { name: "SHT25_Temperature", unit: "Celsius", defaultAxisRange: [-20, 50] },
    { name: "SHT25_Humidity", unit: "%RH", defaultAxisRange: [0, 100] },
    { name: "Calibrated_TVOC", unit: "ppm", defaultAxisRange: [0, 10000] },
    { name: "Fig2600_LightVOC", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "Fig2602_HeavyVOC", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "Ozone", unit: "ADU", defaultAxisRange: [0, 1000] },
    { name: "Calibrated_CO", unit: "ppm", defaultAxisRange: [0, 1000] },
    { name: "CO_ch1", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "CO_ch2", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "CO2", unit: "ppm", defaultAxisRange: [0, 5000] },
    { name: "PM10_ENV", unit: "ug/m^3", defaultAxisRange: [0, 100] },
    { name: "PM25_ENV", unit: "ug/m^3", defaultAxisRange: [0, 100] },
    { name: "PM100_ENV", unit: "ug/m^3", defaultAxisRange: [0, 100] },
  ],
};

const SPOD_FALLBACK_SCHEMA = {
  version: "SPOD_V2.0",
  section: "Uncalibrated",
  sourceUrl: SPOD_HEADER_LOG_URL,
  htmlUrl: SPOD_HEADER_LOG_PAGE,
  columns: [
    { name: "DateTime", unit: "timestamp" },
    { name: "EAST_LONGITUDE", unit: "NA" },
    { name: "NORTH_LATITUDE", unit: "NA" },
    { name: "SPODID", unit: "ID" },
    { name: "Firmware_Version", unit: "NA" },
    { name: "Temperature1", unit: "Celsius", defaultAxisRange: [0, 50] },
    { name: "Temperature2", unit: "Celsius", defaultAxisRange: [0, 50] },
    { name: "CO2", unit: "ppm", defaultAxisRange: [0, 5000] },
    { name: "Soil", unit: "ADU", defaultAxisRange: [0, 1023] },
    { name: "Visible", unit: "ADU", defaultAxisRange: [0, 65535] },
    { name: "Infrared", unit: "ADU", defaultAxisRange: [0, 65535] },
    { name: "UV_Index", unit: "UV index", defaultAxisRange: [0, 15] },
  ],
};

export const YPOD_SECTION_PREFERENCE = ["Calibrated", "Serial_Calibrate", "Uncalibrated", "Serial"];

const DATA_SECTIONS = YPOD_SECTION_PREFERENCE;

export async function loadYpodHeaderLogResource() {
  return loadHeaderLogResource(YPOD_HEADER_LOG_URL, YPOD_HEADER_LOG_PAGE, FALLBACK_SCHEMA);
}

export async function loadSpodHeaderLogResource() {
  return loadHeaderLogResource(SPOD_HEADER_LOG_URL, SPOD_HEADER_LOG_PAGE, SPOD_FALLBACK_SCHEMA);
}

async function loadHeaderLogResource(sourceUrl, htmlUrl, fallbackSchema) {
  try {
    const response = await fetch(sourceUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`YAML request failed with ${response.status}`);
    }

    const text = await response.text();
    return {
      text,
      index: parseYpodSchemaIndex(text),
      sourceUrl,
      htmlUrl,
      fallbackSchema,
      isFallback: false,
    };
  } catch (error) {
    return {
      text: "",
      index: [
        {
          version: fallbackSchema.version,
          sections: [fallbackSchema.section],
        },
      ],
      sourceUrl,
      htmlUrl,
      fallbackSchema,
      isFallback: true,
      error,
    };
  }
}

export function parseYpodSchemaIndex(text) {
  const lines = getLines(text);
  const blocks = findVersionBlocks(lines);

  return blocks
    .map((block) => ({
      version: block.version,
      sections: findDataSections(lines, block.startIndex, block.endIndex),
    }))
    .filter((block) => block.sections.length > 0)
    .sort(compareVersionRecords)
    .reverse();
}

export function getPreferredYpodSection(sections, previous = "") {
  if (sections.includes(previous)) {
    return previous;
  }

  return YPOD_SECTION_PREFERENCE.find((section) => sections.includes(section)) || sections[0] || "";
}

export function getPreferredYpodVersion(versions, previous = "") {
  if (versions.includes(previous)) {
    return previous;
  }

  return versions.includes(CURRENT_YPOD_VERSION) ? CURRENT_YPOD_VERSION : versions[0] || "";
}

export function getYpodSectionSchema(resource, version, section) {
  if (!resource.text) {
    return {
      ...(resource.fallbackSchema || FALLBACK_SCHEMA),
      isFallback: true,
    };
  }

  const cacheKey = `${version}:${section}`;
  if (!resource.schemaCache) {
    resource.schemaCache = new Map();
  }

  if (resource.schemaCache.has(cacheKey)) {
    return resource.schemaCache.get(cacheKey);
  }

  const parsed = parseYpodSectionSchema(resource.text, version, section);
  const schema = {
    ...parsed,
    sourceUrl: resource.sourceUrl || YPOD_HEADER_LOG_URL,
    htmlUrl: resource.htmlUrl || YPOD_HEADER_LOG_PAGE,
    isFallback: false,
  };

  resource.schemaCache.set(cacheKey, schema);
  return schema;
}

export function normalizeYpodVersion(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  const match = raw.match(/(?:[A-Z]+POD[\s_-]*)?V?\s*(\d+)[._-](\d+)(?:[._-](\d+))?/i);

  if (!match) {
    return "";
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = match[3] === undefined ? null : Number(match[3]);

  if (![major, minor].every(Number.isFinite) || (patch !== null && !Number.isFinite(patch))) {
    return "";
  }

  const prefix = raw.match(/([A-Z]+POD)/i)?.[1]?.toUpperCase() || "YPOD";
  return `${prefix}_V${major}_${minor}${patch === null ? "" : `_${patch}`}`;
}

export function normalizeValuesForSchema(values, columns) {
  if (values.length === columns.length) {
    return values;
  }

  if (values.length === columns.length + 1 && values[values.length - 1] === "") {
    return values.slice(0, -1);
  }

  return null;
}

export function resolveYpodSchemaForValues(resource, selectedSchema, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const detectedVersion = getYpodFirmwareVersionFromValues(resource, values);
  const selectedVersion = selectedSchema?.version || getPreferredYpodVersion(getListedYpodVersions(resource));
  const version = detectedVersion || selectedVersion;

  if (!version) {
    return null;
  }

  const matches = getSchemaMatchesForValues(resource, version, values);
  const previousSection = selectedSchema?.version === version ? selectedSchema.section : "";
  const match = chooseSchemaMatch(matches, previousSection);

  if (match) {
    return match;
  }

  if (!detectedVersion) {
    const shapeMatch = getListedYpodVersions(resource)
      .filter((candidateVersion) => candidateVersion !== version)
      .flatMap((candidateVersion) => getSchemaMatchesForValues(resource, candidateVersion, values))[0];

    if (shapeMatch) {
      return shapeMatch;
    }
  }

  if (!detectedVersion && selectedSchema?.columns?.length) {
    const normalizedValues = normalizeValuesForSchema(values, selectedSchema.columns);

    if (normalizedValues) {
      return {
        schema: selectedSchema,
        values: normalizedValues,
      };
    }
  }

  return null;
}

export function parseYpodSectionSchema(text, version, section) {
  const lines = getLines(text);
  const blocks = findVersionBlocks(lines);
  const block = blocks.find((item) => item.version === version);

  if (!block) {
    throw new Error(`${version} was not found in the POD YAML.`);
  }

  const sectionIndex = findSectionIndex(lines, block.startIndex, block.endIndex, section);

  if (sectionIndex === -1) {
    throw new Error(`${version} does not define ${section}.`);
  }

  const columns = parseSectionColumns(lines, sectionIndex + 1, block.endIndex);

  if (columns.length === 0) {
    throw new Error(`${version} ${section} has no columns.`);
  }

  return {
    version,
    section,
    columns,
  };
}

function getLines(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function findVersionBlocks(lines) {
  const blocks = [];

  lines.forEach((line, index) => {
    const match = line.match(/^([A-Za-z]+POD_V\d+[._]\d+(?:[._]\d+)?):\s*$/);

    if (match) {
      if (blocks.length > 0) {
        blocks[blocks.length - 1].endIndex = index;
      }

      blocks.push({
        version: match[1],
        startIndex: index,
        endIndex: lines.length,
      });
    }
  });

  return blocks;
}

function findDataSections(lines, startIndex, endIndex) {
  const sections = [];

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const match = lines[index].match(/^ {2}([A-Za-z0-9_]+):\s*(?:#.*)?$/);

    if (match && DATA_SECTIONS.includes(match[1])) {
      sections.push(match[1]);
    }
  }

  return DATA_SECTIONS.filter((section) => sections.includes(section));
}

function getListedYpodVersions(resource) {
  return (resource?.index || []).map((item) => item.version);
}

function getYpodVersionRecord(resource, version) {
  return (resource?.index || []).find((item) => item.version === version) || null;
}

function getSchemaMatchesForValues(resource, version, values) {
  const record = getYpodVersionRecord(resource, version);

  if (!record) {
    return [];
  }

  return (record.sections || [])
    .map((section) => getSafeYpodSectionSchema(resource, version, section))
    .filter(Boolean)
    .map((schema) => ({
      schema,
      values: normalizeValuesForSchema(values, schema.columns),
    }))
    .filter((match) => Boolean(match.values));
}

function chooseSchemaMatch(matches, previousSection = "") {
  if (matches.length === 0) {
    return null;
  }

  const section = getPreferredYpodSection(
    matches.map((match) => match.schema.section),
    previousSection,
  );

  return matches.find((match) => match.schema.section === section) || matches[0];
}

function getYpodFirmwareVersionFromValues(resource, values) {
  const listedVersions = getListedYpodVersions(resource);

  for (const item of resource?.index || []) {
    for (const section of item.sections || []) {
      const schema = getSafeYpodSectionSchema(resource, item.version, section);
      const normalizedValues = schema ? normalizeValuesForSchema(values, schema.columns) : null;

      if (!schema || !normalizedValues) {
        continue;
      }

      const firmwareIndex = schema.columns.findIndex((column) =>
        normalizeYamlFieldName(column.name) === "firmwareversion",
      );

      if (firmwareIndex === -1) {
        continue;
      }

      const normalizedVersion = normalizeYpodVersion(normalizedValues[firmwareIndex]);
      const version = listedVersions.find((listedVersion) =>
        normalizeYpodVersion(listedVersion) === normalizedVersion,
      );

      if (version) {
        return version;
      }
    }
  }

  return "";
}

function getSafeYpodSectionSchema(resource, version, section) {
  try {
    return getYpodSectionSchema(resource, version, section);
  } catch {
    return null;
  }
}

function normalizeYamlFieldName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function compareVersionRecords(a, b) {
  const left = versionParts(a.version);
  const right = versionParts(b.version);
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function versionParts(version) {
  return version.match(/\d+/g).map((part) => Number(part));
}

function findSectionIndex(lines, startIndex, endIndex, sectionName) {
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    if (new RegExp(`^ {2}${sectionName}:\\s*(?:#.*)?$`).test(lines[index])) {
      return index;
    }
  }

  return -1;
}

function parseSectionColumns(lines, startIndex, endIndex) {
  const columns = [];
  let currentColumn = null;

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = lines[index];

    if (/^ {2}\S/.test(line)) {
      break;
    }

    const fieldMatch = line.match(/^ {4}([A-Za-z0-9_]+):\s*(?:#.*)?$/);

    if (fieldMatch) {
      currentColumn = {
        name: fieldMatch[1],
        unit: "",
        dtype: "",
        sensor: "",
        defaultAxisRange: null,
      };
      columns.push(currentColumn);
      continue;
    }

    if (!currentColumn) {
      continue;
    }

    const propertyMatch = line.match(/^ {6}(unit|dtype|sensor):\s*(.+?)\s*$/);

    if (propertyMatch) {
      currentColumn[propertyMatch[1]] = cleanYamlScalar(propertyMatch[2]);
    }

    const defaultAxisMatch = line.match(/^ {6}default_axis_range:\s*(.+?)\s*$/);

    if (defaultAxisMatch) {
      currentColumn.defaultAxisRange = parseDefaultAxisRange(defaultAxisMatch[1]);
    }
  }

  return columns;
}

function parseDefaultAxisRange(value) {
  const parts = cleanYamlScalar(value)
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((part) => Number(part.trim()));

  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return parts[0] < parts[1] ? parts : [parts[1], parts[0]];
}

function cleanYamlScalar(value) {
  return value
    .replace(/\s+#.*$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}
