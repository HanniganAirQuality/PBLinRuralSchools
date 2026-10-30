# HAQ Lab PBL Site
We are attempting to support programs in different regions through inclusion of multiple languages in our user interface. Please select from the supported README languages below:
<br>
[![en](https://img.shields.io/badge/lang-en-red.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.md)
[![pt-br](https://img.shields.io/badge/lang-pt--br-green.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.pt-BR.md)

Static site for the HAQ Lab Project-Based Learning programs, hosted on GitHub Pages.
[https://hanniganairquality.github.io/PBLinRuralSchools/](https://hanniganairquality.github.io/PBLinRuralSchools/)

## Structure

```text
    PBLinRuralSchools/
    |-- index.html                  Program selector
    |-- favicon.ico
    |-- README.md
    |-- README.pt-BR.md             Portuguese (Brazil) README
    |-- aqiq/
    |   |-- index.html              AQIQ hub
    |   `-- tools/
    |       |-- co2-battle/
    |       |   `-- index.html      CO2 Battle
    |       |-- data-plotter/
    |       |   `-- index.html      Data Plotter
    |       `-- live-viewer/
    |           `-- index.html      Live Viewer
    |-- fire-iq/
    |   |-- index.html              Fire-IQ hub
    |   `-- tools/
    |       |-- data-plotter/
    |       |   `-- index.html      Data Plotter
    |       `-- live-viewer/
    |           `-- index.html      Dual-POD Live Viewer
    |-- sqiq/
    |   |-- index.html              SQIQ hub
    |   `-- tools/
    |       |-- data-plotter/
    |       |   `-- index.html      Data Plotter
    |       |-- live-viewer/
    |       |   `-- index.html      SPOD Live Viewer
    |       `-- soil-respiration/
    |           `-- index.html      Soil Respiration
    |-- water-iq/
    |   `-- index.html              Disabled placeholder
    |-- assets/
    |   |-- css/
    |   |-- curriculum/             Lesson PDFs and handouts (aqiq, fireiq, sqiq)
    |   |-- generated/
    |   |-- js/
    |   |   |-- README.md           Developer guide: wrappers, engines, configs
    |   |   |-- core/               Shared helpers (i18n, YAML loader, serial reader)
    |   |   `-- viewers/            Plotters, live viewers, standalone tools (see section below)
    |   `-- vendor/
    |-- translations/               Page CSVs, locale JSON (en, pt-BR), workbook scripts
    |-- .github/
    |   `-- workflows/
    `-- .nojekyll
```

## Programs

| Program | Instrument | Status | Tools |
| --- | --- | --- | --- |
| AQIQ | YPOD | Active hub | Live Viewer, Data Plotter |
| Fire-IQ | YPOD mod | Active hub | Live Viewer, Data Plotter |
| SQIQ | SPOD | Active hub | Live Viewer, Data Plotter |
| Water-IQ | TBD | Under Construction |  |

## Live Viewer

The AQIQ live viewer is a static Web Serial application. By default, it uses 9600 baud, loads the latest `YPOD_*` entry from `YPOD_HeaderLog.yaml` in the `HanniganAirQuality/All-POD-YAMLs` repository, and parses incoming CSV rows using that version's preferred live-data section. Rows with a `Firmware_Version` value switch to that listed YAML version automatically; older rows without firmware metadata keep the user-selected version. Newer YAML versions prefer `Calibrated`; older versions fall back to `Serial_Calibrate` or `Serial`. Advanced settings allow selecting a specific YAML version, YAML data section, timeline size, and visible plots.

The Fire-IQ live viewer is a static Web Serial application for two modified YPOD streams at 9600 baud. It uses `YPOD_HeaderLog.yaml` and the same firmware-aware row mapping as AQIQ, then overlays the two pods in shared CO, CO2, and PM2.5 plots.

The SQIQ live viewer uses the same Web Serial and schema-driven plotting engine with `SPOD_HeaderLog.yaml`. It supports both SPOD V1.0 (separate date/time fields and no firmware field) and V2.0 (RETIGO layout with firmware metadata), and plots both temperature channels, carbon dioxide, soil moisture, visible light, infrared light, and UV index. Every additional numeric SPOD YAML column is available as an optional plot.

## JavaScript Developer Maps & Guide 

### How a tool page loads

Each tool page sets a config object on `window`, then loads a script.
That script is either a wrapper that imports an engine, or the engine itself.

    index.html  ->  window.HAQ_..._CONFIG  ->  wrapper  ->  engine  ->  core/ypod-yaml.js  ->  YAML (All-POD-YAMLs repo)

### viewers/

| File | Role | Notes |
|---|---|---|
| `data-plotter.js` | Wrapper | Imports `fireiq-data-plotter.js` |
| `fireiq-data-plotter.js` | Engine | CSV plotter for AQIQ, Fire-IQ and SQIQ. The `preset` in `HAQ_DATA_PLOTTER_CONFIG` picks the aliases and charts. Despite the name, it is not Fire-IQ only. |
| `aqiq-live-viewer.js` | Engine | Single-POD live viewer (YPOD and SPOD), configured by `HAQ_LIVE_VIEWER_CONFIG` |
| `sqiq-live-viewer.js` | Config + wrapper | SPOD field aliases and charts, then imports `aqiq-live-viewer.js` |
| `fireiq-live-viewer.js` | Engine | Standalone Fire-IQ dual-POD live viewer, no config object |
| `live-viewer.js` | Placeholder | Shows a "Live Viewer" coming-soon stub. Not the live engine. |
| `aqiq-co2-battle.js` | Standalone | CO2 Battle tool |
| `soil-respiration.js` | Standalone | SPOD soil respiration calculator, has its own alias list |

### Big YAML Changes --> Updating the Site (SQIQ Example)

| To change | Edit |
|---|---|
| Which column feeds a chart | `SQIQ_FIELD_ALIASES` in `fireiq-data-plotter.js` |
| Chart titles, colors, fallback units | `SQIQ_CHARTS` in `fireiq-data-plotter.js` |
| Heading units and default axis ranges | The YAML (`All-POD-YAMLs` repo). Units are read from the resolved YAML column. |
| Toggle labels and card headings | The page's `index.html` |
| Live viewer aliases | `sqiq-live-viewer.js` |
| Offline fallback schema | `SPOD_FALLBACK_SCHEMA` in `core/ypod-yaml.js` |

### Notes on Updating YAML & Site Code

- **Aliases:** the first YAML column that matches any alias supplies the heading unit, in YAML column order. Keep raw columns (`CO2_raw`, `SoilMoisture_Raw`) out of alias lists. They stay plottable through the column toggles in advanced settings.
- **YAML version keys** must look like `SPOD_V3.0` (major.minor). `SPOD_V3` is silently ignored.
- **YAML section names** must be one of `Calibrated`, `Serial_Calibrate`, `Uncalibrated`, `Serial`.
- **Schema detection** per row uses the `Firmware_Version` value and the column count.
- **Fallback schema** is used when the YAML fetch fails. Keep it in sync with the current YAML.
- **Caching:** the YAML comes from `raw.githubusercontent.com` (about 5 min cache). Site changes go through GitHub Pages (about 10 min). Nested imports have no version string, so hard refresh after deploys.

## Hosting

Served via GitHub Pages. Requires HTTPS for Web Serial API, which is provided automatically on `*.github.io`.

## HAQ Lab, University of Colorado
