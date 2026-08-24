# Third-party notices

This file summarizes material used to build, test, or run Snap2Cal. It does not replace upstream license texts. Exact installed versions and detected SPDX metadata are listed in [`docs/dependency-licenses.md`](docs/dependency-licenses.md).

## Production runtime libraries

### React and React DOM

- Packages: `react`, `react-dom`
- Source: <https://github.com/facebook/react>
- License: MIT
- Use: browser interface and rendering.

### Tesseract.js

- Package: `tesseract.js` 7.0.0
- Source: <https://github.com/naptha/tesseract.js>
- License: Apache-2.0
- Use: browser-local OCR orchestration. Its worker is copied by `npm run prepare:ocr` and is not committed under `public/ocr/`.

Snap2Cal supplies explicit same-origin Worker, core, and language paths. During asset preparation, upstream Worker CDN fallback strings are replaced with same-origin failure sentinels so a missing explicit path cannot silently switch to cloud-hosted OCR resources.

### Tesseract.js Core

- Package: `tesseract.js-core` 7.x
- Source: <https://github.com/naptha/tesseract.js-core>
- License: Apache-2.0
- Use: JavaScript and WebAssembly OCR core variants copied by `npm run prepare:ocr`.

### Tesseract trained language data

- Languages: Simplified Chinese (`chi_sim`) and English (`eng`)
- Dataset: Tesseract `tessdata_fast` 4.0.0 data distributed from <https://tessdata.projectnaptha.com/4.0.0_fast>
- Upstream: <https://github.com/tesseract-ocr/tessdata_fast>
- License: Apache-2.0
- Use: downloaded only by `npm run prepare:ocr`, then recorded by size and SHA-256 in the generated local manifest.

## Build and test tooling

### Vite and the React plugin

- Packages: `vite`, `@vitejs/plugin-react`
- Source: <https://github.com/vitejs/vite>
- License: MIT
- Use: development server and static production build. These packages are not browser runtime dependencies.

### Playwright

- Packages: `@playwright/test`, `playwright`, `playwright-core`
- Source: <https://github.com/microsoft/playwright>
- License: Apache-2.0
- Use: deterministic E2E, browser smoke, Pages-base verification, accessibility checks, and synthetic screenshots. Playwright is not included in the static production site.

Other build and test dependencies, including TypeScript, ESLint, Vitest, jsdom, YAML, fflate, and axe-core, are covered by the generated dependency report.

## Demo images and icon

The public demo inputs, documentation screenshots, and Snap2Cal favicon are generated specifically for this repository from local HTML/CSS and application UI. They use fictional names, courses, places, and rosters; no external image, logo, font file, portrait, or QR-code asset is included.

The production application does not fetch any of the listed upstream sites at runtime.
