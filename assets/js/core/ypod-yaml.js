export const YPOD_HEADER_LOG_URL =
  "https://raw.githubusercontent.com/HanniganAirQuality/All-POD-YAMLs/main/YPOD_HeaderLog.yaml";

export const YPOD_HEADER_LOG_PAGE =
  "https://github.com/HanniganAirQuality/All-POD-YAMLs/blob/main/YPOD_HeaderLog.yaml";

const FALLBACK_SCHEMA = {
  version: "YPOD_V4_1_0",
  section: "Serial_Calibrate",
  sourceUrl: YPOD_HEADER_LOG_URL,
  htmlUrl: YPOD_HEADER_LOG_PAGE,
  columns: [
    { name: "DateTime", unit: "timestamp" },
    { name: "BME180_Temperature", unit: "Celsius", defaultAxisRange: [-20, 50] },
    { name: "BME180_Pressure", unit: "millibar", defaultAxisRange: [900, 1100] },
    { name: "SHT25_Temperature", unit: "Celsius", defaultAxisRange: [-20, 50] },
    { name: "SHT25_Humidity", unit: "%RH", defaultAxisRange: [0, 100] },
    { name: "Calibrated_TVOC", unit: "ppm", defaultAxisRange: [0, 10000] },
    { name: "Fig2600_LightVOC", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "Fig2602_HeavyVOC", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "Ozone", unit: "ADU", defaultAxisRange: [0, 1000] },
    { name: "Calibrated_CO", unit: "ppm", defaultAxisRange: [0, 10000] },
    { name: "CO_ch1", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "CO_ch2", unit: "ADU", defaultAxisRange: [0, 10000] },
    { name: "CO2", unit: "ppm", defaultAxisRange: [0, 5000] },
    { name: "PM10_ENV", unit: "ug/m^3", defaultAxisRange: [0, 100] },
    { name: "PM25_ENV", unit: "ug/m^3", defaultAxisRange: [0, 100] },
    { name: "PM100_ENV", unit: "ug/m^3", defaultAxisRange: [0, 100] },
  ],
};

const DATA_SECTIONS = ["Serial_Calibrate", "Serial"];

export async function loadYpodHeaderLogResource() {
  try {
    const response = await fetch(YPOD_HEADER_LOG_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`YAML request failed with ${response.status}`);
    }

    const text = await response.text();
    return {
      text,
      index: parseYpodSchemaIndex(text),
      sourceUrl: YPOD_HEADER_LOG_URL,
      htmlUrl: YPOD_HEADER_LOG_PAGE,
      isFallback: false,
    };
  } catch (error) {
    return {
      text: "",
      index: [
        {
          version: FALLBACK_SCHEMA.version,
          sections: [FALLBACK_SCHEMA.section],
        },
      ],
      sourceUrl: YPOD_HEADER_LOG_URL,
      htmlUrl: YPOD_HEADER_LOG_PAGE,
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

export function getYpodSectionSchema(resource, version, section) {
  if (!resource.text) {
    return {
      ...FALLBACK_SCHEMA,
      isFallback: true,
    };
  }

  const parsed = parseYpodSectionSchema(resource.text, version, section);

  return {
    ...parsed,
    sourceUrl: resource.sourceUrl || YPOD_HEADER_LOG_URL,
    htmlUrl: resource.htmlUrl || YPOD_HEADER_LOG_PAGE,
    isFallback: false,
  };
}

export function parseYpodSectionSchema(text, version, section) {
  const lines = getLines(text);
  const blocks = findVersionBlocks(lines);
  const block = blocks.find((item) => item.version === version);

  if (!block) {
    throw new Error(`${version} was not found in the YPOD YAML.`);
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
    const match = line.match(/^(YPOD_V\d+_\d+_\d+):\s*$/);

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
        sensor: "",
        defaultAxisRange: null,
      };
      columns.push(currentColumn);
      continue;
    }

    if (!currentColumn) {
      continue;
    }

    const propertyMatch = line.match(/^ {6}(unit|sensor):\s*(.+?)\s*$/);

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
