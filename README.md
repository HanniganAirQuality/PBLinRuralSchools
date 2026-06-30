# HAQ Lab PBL Site

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
|   `-- index.html              Disabled placeholder
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
| SQIQ | SPOD | Disabled placeholder | Future tools |
| Water-IQ | TBD | Disabled placeholder | Future tools |

## Live Viewer

The AQIQ live viewer is a static Web Serial application. By default, it uses 9600 baud, loads the latest `YPOD_*` entry from `YPOD_HeaderLog.yaml` in the `HanniganAirQuality/All-POD-YAMLs` repository, and parses incoming CSV rows using that version's `Serial_Calibrate` column order. Advanced settings allow selecting a specific YAML version, YAML data section, timeline size, and visible plots.

The Fire-IQ live viewer is a static Web Serial application for two modified YPOD streams at 9600 baud. It expects the Fire-IQ row order `DateTime, T, RH, TVOC, F2600, F2602, NA, CO, CO2, PM1, PM2.5, PM10` and overlays the two pods in shared CO, CO2, and PM2.5 plots.

## Hosting

Served via GitHub Pages. Requires HTTPS for Web Serial API, which is provided automatically on `*.github.io`.

## HAQ Lab, University of Colorado
