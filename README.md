# HAQ Lab PBL Site
We are attempting to support programs in different regions through inclusion of multiple languages in our user interface. Please select from supported README languages below:
<br>
[![en](https://img.shields.io/badge/lang-en-red.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.md)
[![pt-br](https://img.shields.io/badge/lang-pt--br-green.svg)](https://github.com/HanniganAirQuality/PBLinRuralSchools/tree/main/README.pt-BR.md)

Static site for the HAQ Lab Project-Based Learning programs, hosted on GitHub Pages.
[https://hanniganairquality.github.io/PBLinRuralSchools/](https://hanniganairquality.github.io/PBLinRuralSchools/)

## Structure

```text
pbl.haq-lab.github.io/
|-- index.html                  Program selector
|-- aqiq/
|   |-- index.html              AQIQ hub
|   `-- tools/
|       |-- data-plotter/
|       |   `-- index.html      Data Plotter placeholder
|       `-- live-viewer/
|           `-- index.html      Live Viewer
|-- fire-iq/
|   |-- index.html              Fire-IQ hub
|   `-- tools/
|       |-- data-plotter/
|       |   `-- index.html      Data Plotter placeholder
|       `-- live-viewer/
|           `-- index.html      Dual-POD Live Viewer
|-- sqiq/
|   |-- index.html              SQIQ hub
|   `-- tools/
|       `-- live-viewer/
|           `-- index.html      SPOD Live Viewer
|-- water-iq/
|   `-- index.html              Disabled placeholder
|-- assets/
|   |-- css/
|   |-- generated/
|   |-- js/
|   |   |-- core/
|   |   `-- viewers/
|   `-- vendor/
|-- .github/
|   `-- workflows/
`-- .nojekyll
```

## Programs

| Program | Instrument | Status | Tools |
| --- | --- | --- | --- |
| AQIQ | YPOD | Active hub | Live Viewer, Data Plotter |
| Fire-IQ | YPOD mod | Active hub | Live Viewer, Data Plotter |
| SQIQ | SPOD | Active hub | Live Viewer |
| Water-IQ | TBD | Disabled placeholder | Future tools |

## Live Viewer

The AQIQ live viewer is a static Web Serial application. By default, it uses 9600 baud, loads the latest `YPOD_*` entry from `YPOD_HeaderLog.yaml` in the `HanniganAirQuality/All-POD-YAMLs` repository, and parses incoming CSV rows using that version's preferred live-data section. Rows with a `Firmware_Version` value switch to that listed YAML version automatically; older rows without firmware metadata keep the user-selected version. Newer YAML versions prefer `Calibrated`; older versions fall back to `Serial_Calibrate` or `Serial`. Advanced settings allow selecting a specific YAML version, YAML data section, timeline size, and visible plots.

The Fire-IQ live viewer is a static Web Serial application for two modified YPOD streams at 9600 baud. It uses `YPOD_HeaderLog.yaml` and the same firmware-aware row mapping as AQIQ, then overlays the two pods in shared CO, CO2, and PM2.5 plots.

The SQIQ live viewer uses the same Web Serial and schema-driven plotting engine with `SPOD_HeaderLog.yaml`. It supports both SPOD V1.0 (separate date/time fields and no firmware field) and V2.0 (RETIGO layout with firmware metadata), and plots both temperature channels, carbon dioxide, soil signal, visible light, infrared light, and UV index. Every additional numeric SPOD YAML column is available as an optional plot.

## Hosting

Served via GitHub Pages. Requires HTTPS for Web Serial API, which is provided automatically on `*.github.io`.

## HAQ Lab, University of Colorado
