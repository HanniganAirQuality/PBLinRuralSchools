# HAQ Lab PBL Site

Static site for the HAQ Lab Project-Based Learning programs, hosted on GitHub Pages.

## Structure

```
index.html          Landing page — program selector
aqiq/               AQIQ program hub
sqiq/               SQIQ program hub
fire-iq/            Fire-IQ program hub
assets/css/         Shared styles
```

AKA: 
```
pbl.haq-lab.github.io/
├── index.html              ← program selector (big clear buttons, nothing else)
├── aqiq/
│   ├── index.html          ← AQIQ hub (tools + curriculum links)
│   ├── tools/data-plotter/
│   └── tools/live-viewer/
├── sqiq/
│   ├── index.html          ← SQIQ hub (Not available yet)
│   └── tools/data-plotter/
├── fire-iq/
│   ├── index.html          ← Fire-IQ hub
│   ├── tools/data-plotter/
│   └── tools/live-viewer/  ← same tool, YPOD config
├── water-iq/
│   ├── index.html          ← Water-IQ hub (Not available yet)
│   ├── tools/data-plotter/
│   └── tools/live-viewer/  ← same tool, YPOD config
└── assets/
```
## Programs

| Program  | Instrument | Tools                  |
|----------|------------|------------------------|
| AQIQ     | YPOD       | Live Viewer / Data Plotter |
| SQIQ     | SPOD       | Data Plotter           |
| Fire-IQ  | YPOD (mod) | Live Viewer / Data plotter |
| Water-IQ  | TBD | Live Viewer / Data plotter |

## Hosting

Served via GitHub Pages. Requires HTTPS for Web Serial API (provided automatically on `*.github.io`).

Web Serial API is supported in Chrome, Edge, and Firefox 151+.

## HAQ Lab · University of Colorado
