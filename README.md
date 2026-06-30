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
|           `-- index.html      Live Viewer placeholder
|-- fire-iq/
|   |-- index.html              Fire-IQ hub
|   `-- tools/
|       |-- data-plotter/
|       |   `-- index.html      Data Plotter placeholder
|       `-- live-viewer/
|           `-- index.html      Live Viewer placeholder
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
| Fire-IQ | YPOD mod | Active placeholder hub | Live Viewer, Data Plotter |
| SQIQ | SPOD | Disabled placeholder | Future tools |
| Water-IQ | TBD | Disabled placeholder | Future tools |

## Live Viewer

The AQIQ live viewer is a static Web Serial application. By default, it uses 9600 baud, loads the latest `YPOD_*` entry from `YPOD_HeaderLog.yaml` in the `HanniganAirQuality/All-POD-YAMLs` repository, and parses incoming CSV rows using that version's `Serial_Calibrate` column order. Advanced settings allow selecting a specific YAML version, YAML data section, timeline size, and visible plots.

## Hosting

Served via GitHub Pages. Requires HTTPS for Web Serial API, which is provided automatically on `*.github.io`.

## HAQ Lab, University of Colorado
