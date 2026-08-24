# Snap2Cal

Turn event text, screenshots, timetables, and shift rosters into reviewable ICS calendar files, locally in your browser.

**English** | [简体中文](README.zh-CN.md)

[![CI](https://github.com/wxgith/snap2cal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/wxgith/snap2cal/actions/workflows/ci.yml)
[![Full verification](https://github.com/wxgith/snap2cal/actions/workflows/full-verification.yml/badge.svg?branch=main)](https://github.com/wxgith/snap2cal/actions/workflows/full-verification.yml)
[![Pages](https://github.com/wxgith/snap2cal/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/wxgith/snap2cal/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Source](https://github.com/wxgith/snap2cal) | [Issues](https://github.com/wxgith/snap2cal/issues) | [Security](https://github.com/wxgith/snap2cal/security/policy) | [Releases](https://github.com/wxgith/snap2cal/releases) | [Actions](https://github.com/wxgith/snap2cal/actions)

> Privacy first: user text, images, OCR results, courses, and rosters stay in the current browser tab. Snap2Cal has no backend, account, analytics SDK, remote error reporting, or cloud OCR.

![Snap2Cal text event review with synthetic example data](docs/images/text-event-result.png)

All demo names, courses, places, and rosters in this repository are fictional.

## What it does

Snap2Cal has four input modes. Recognition is only a draft: the user reviews and corrects fields before export.

| Mode         | Input                                              | Review                                                                             | Output                                     | Current limits                                                                    |
| ------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| Text event   | Chinese natural-language text or a structured list | Dates, times, title, place, reminders, candidate boundaries                        | One event or a multi-event `.ics` file     | Chinese-focused rules; no recurrence rules or travel-time inference               |
| Image event  | One PNG, JPEG, or WebP image                       | Local OCR text, source-image evidence, and event fields                            | One event or a multi-event `.ics` file     | One image at a time; printed Chinese/English works best                           |
| Timetable    | One upright, bordered timetable image              | Grid, headers, weekdays, row times, courses, teaching weeks, exclusions            | One `VEVENT` per included class occurrence | Rectangular bordered layouts only; no school defaults are invented                |
| Shift roster | One upright person-by-date roster image            | Grid, people, dates, exact shift-code mappings, cross-midnight choices, exclusions | Personal or team `.ics` files              | Person rows and date columns only; no payroll, attendance, or labor-law decisions |

![Local OCR evidence highlight using fictional content](docs/images/ocr-evidence.png)

## Quick start

Prerequisites: Node.js 24, npm 11, and a modern browser with Web Worker, WebAssembly, Canvas, and Blob download support.

```bash
npm install
npm run prepare:ocr
npm run verify:ocr
npm run dev
```

Open the local URL printed by Vite. Clipboard image paste depends on browser permission and secure-context rules; file upload remains available when paste is denied.

### OCR assets and network behavior

`npm install` and `npm run prepare:ocr` are build-time operations and require network access to obtain npm packages plus pinned Simplified Chinese and English Tesseract language data. `prepare:ocr` copies the installed worker/core files and downloads the language files into the ignored `public/ocr/` directory with a checksum manifest.

The production application loads its worker, WASM core, language data, JavaScript, CSS, and demo images from the current site. It does not fall back to a third-party CDN. Runtime network validation is part of the release checks.

## Public demo

GitHub Pages deployment is being configured. The hosted URL will be added only after GitHub's Pages API confirms it. To run the same static application locally:

```bash
npm run prepare:ocr
npm run build
npx vite preview
```

The checked-in public demo inputs under [`fixtures/public-demo/`](fixtures/public-demo/) and [`public/demo/`](public/demo/) are generated synthetic data. They contain no real schedule, roster, chat, address, phone number, email address, logo, portrait, or QR code.

## Mode details

### Text and multi-event input

Paste one event or a list. Relative dates always use an explicit reference time supplied by the application. A candidate with low confidence or invalid required fields is not silently exported, and duplicate candidates remain visible for review. Manual edits are preserved only when a re-detection result has the same stable identity, source range, and original text.

### Image event input

Upload or paste one PNG, JPEG, or WebP image up to 8 MiB, 8,000 pixels per side, and 25 million decoded pixels. OCR runs through the `OcrAdapter` boundary. Edited OCR text never overwrites `originalText`, and field evidence remains mapped to normalized image coordinates.

SVG, GIF, HEIC, TIFF, PDF, batches, handwriting, dense decorative backgrounds, extreme skew, and very small text are unsupported or unreliable.

### Timetable input

![Synthetic timetable grid review](docs/images/timetable-grid.png)

The timetable flow detects a rectangular grid, then requires confirmation of weekday columns, row times, course cells, week patterns, the first teaching-week Monday, and semester length. A period label without a real time range blocks the affected occurrence. Conflicts are warnings, not automatic deletion. Every included occurrence becomes an independent `VEVENT`; no `RRULE` is emitted.

### Shift roster input

![Synthetic person-by-date roster review](docs/images/shift-roster-matrix.png)

Every non-empty shift code requires an exact user-confirmed mapping to a timed, all-day, or skip definition. A shift ending before its start is cross-midnight only after explicit confirmation. Missing year or month is never inferred from the current date. Unknown codes, invalid dates, conflicts, and unconfirmed cross-midnight shifts block export.

![Synthetic mobile roster review at a 390 pixel viewport](docs/images/shift-roster-mobile-390.png)

## ICS output

- Single events use the shared one-`VEVENT` generator.
- Multi-event, timetable, and roster exports reuse that generator inside one `VCALENDAR`.
- Timetable and roster occurrences remain independent events; this release does not emit `RRULE`.
- Dates, times, locations, and reminders are omitted when missing rather than fabricated.
- Review the generated data before importing it into a calendar application.

## Privacy design

During application runtime:

- processing occurs in browser memory;
- images, OCR text, names, courses, and roster data are not uploaded or persisted;
- refreshing or closing the page discards current input;
- temporary object URLs and OCR workers are released;
- downloaded ICS files are saved by the browser to the user's device;
- application runtime makes no analytics or remote error-reporting requests.

GitHub Pages, when enabled, is static hosting supplied by GitHub and is separate from Snap2Cal's application logic. Browser, operating-system, calendar-import, download, and hosting behavior may have their own policies. Issues and pull requests are public content, so contributors must use synthetic or fully redacted examples.

See the full [privacy and review notice](docs/privacy.md).

## Development

```bash
npm ci
npm run prepare:ocr
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run test:e2e
npm run build
```

Focused and release verification commands:

```bash
npm run verify:ocr
npm run verify:multi-event
npm run verify:schedule-table
npm run verify:shift-roster
npm run test:cross-browser
npm run test:a11y
npm run validate:repo
npm run validate:dist
npm run validate:runtime-network
npm run validate:production-mocks
npm run verify:pages-base
npm run generate:license-report
npm run capture:demo
npm run package:release
npm run validate:release
```

Tests use deterministic synthetic Mock adapters. Real OCR verification is separately identified and may not be represented by Mock output. Production builds are checked to ensure Mock adapters and test switches are absent.

## Architecture

- [Date parsing](docs/date-parsing.md)
- [Multi-event detection](docs/multi-event-detection.md)
- [Candidate state](docs/candidate-state.md)
- [ICS export](docs/ics-export.md)
- [OCR architecture](docs/ocr-architecture.md)
- [Image evidence mapping](docs/image-evidence.md)
- [Timetable architecture](docs/schedule-table-architecture.md)
- [Grid detection](docs/grid-detection.md)
- [Course week patterns](docs/course-week-patterns.md)
- [Course occurrences](docs/course-occurrences.md)
- [Shift-roster architecture](docs/shift-roster-architecture.md)
- [Roster date mapping](docs/roster-date-mapping.md)
- [Shift definitions](docs/shift-definitions.md)
- [Cross-midnight shifts](docs/cross-midnight-shifts.md)
- [Roster state](docs/shift-roster-state.md)

The long-term architecture constraints are documented in [`AGENTS.md`](AGENTS.md).

## Browser support

The release matrix runs full E2E coverage in Chromium and core smoke coverage in Chromium, Firefox, and WebKit, with desktop 1280 px and mobile 390 px checks. Real OCR is verified in Chromium; the other browser smoke tests cover application navigation, dynamic modules, downloads, and same-origin static resources. Exact minimum browser versions are not claimed.

## Known limitations

Snap2Cal does not support accounts, cloud sync, a backend, cloud OCR, PDF/Excel/CSV input, batch images, PWA caching, native packaging, browser extensions, lunar calendars, travel duration, recurring schedules, payroll, attendance, or legal compliance decisions. OCR, grid detection, and date/time parsing can be wrong. Timetables are not authoritative school records, and rosters are not authoritative employer records.

## Contributing and support

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Use [`SUPPORT.md`](SUPPORT.md) to choose the right public channel. Do not post a security vulnerability publicly; follow [`SECURITY.md`](SECURITY.md). Future ideas are tracked without delivery commitments in [`ROADMAP.md`](ROADMAP.md).

## License

Snap2Cal is licensed under the [MIT License](LICENSE). Copyright (c) 2026 xin. The remaining release confirmations and delivery prerequisites are tracked in [`RELEASE_BLOCKERS.md`](RELEASE_BLOCKERS.md) and [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

Third-party components retain their own licenses. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the generated [`docs/dependency-licenses.md`](docs/dependency-licenses.md).
