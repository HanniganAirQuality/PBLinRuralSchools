window.HAQ_LIVE_VIEWER_CONFIG = {
  podType: "SPOD",
  exportTitle: "SQIQ SPOD Live Visualization",
  fieldAliases: {
    timestamp: ["DateTime", "Timestamp"],
    temperature1: ["Temperature1"],
    temperature2: ["Temperature2"],
    co2: ["CO2"],
    soil: ["Soil"],
    visible: ["Visible"],
    infrared: ["Infrared"],
    uv: ["UV_Index"],
  },
  charts: {
    temperature: {
      canvas: "chart-temperature",
      stats: "temperature",
      series: [
        { key: "temperature1", color: "#dc2626" },
        { key: "temperature2", color: "#f59e0b" },
      ],
    },
    co2: {
      canvas: "chart-co2",
      stats: "co2",
      minZero: true,
      series: [{ key: "co2", color: "#fe7243" }],
    },
    soil: {
      canvas: "chart-soil",
      stats: "soil",
      minZero: true,
      series: [{ key: "soil", color: "#7c7d2d" }],
    },
    light: {
      canvas: "chart-light",
      stats: "light",
      minZero: true,
      series: [
        { key: "visible", color: "#eab308" },
        { key: "infrared", color: "#7c3aed" },
      ],
    },
    uv: {
      canvas: "chart-uv",
      stats: "uv",
      minZero: true,
      series: [{ key: "uv", color: "#0891b2" }],
    },
  },
  metrics: {
    temperature1: ["temperature1"],
    temperature2: ["temperature2"],
    co2: ["co2"],
    soil: ["soil"],
    visible: ["visible"],
    infrared: ["infrared"],
    uv: ["uv"],
  },
};

await import("./aqiq-live-viewer.js");
