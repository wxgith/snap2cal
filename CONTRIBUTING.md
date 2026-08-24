# Contributing to Snap2Cal

Thank you for helping improve Snap2Cal. Contributions must preserve its browser-local privacy model and explicit human-review workflow.

## Project scope

In scope:

- correctness fixes for the existing text, image-event, timetable, and shift-roster modes;
- accessibility, browser compatibility, performance, documentation, tests, and release engineering;
- narrowly scoped parser rules backed by deterministic examples and visible inference warnings;
- local OCR, geometry, calendar, and state-management improvements that respect `AGENTS.md`.

Out of scope for an ordinary pull request:

- accounts, cloud synchronization, OAuth, a backend, cloud OCR, analytics, or remote error reporting;
- PDF, Excel, CSV, batch image processing, PWA caching, native packaging, or browser extensions;
- payroll, attendance, labor-law, or working-time compliance decisions;
- a fifth recognition mode or broad parser rewrites during the v1.0 feature freeze.

Discuss a large proposal before implementation. Uncommitted ideas belong in `ROADMAP.md`, not in product code.

## Privacy requirements

Do not submit real or insufficiently redacted personal data in an Issue, pull request, fixture, screenshot, trace, test video, or console log. This includes personal schedules, course timetables, staff rosters, private chats, names, phone numbers, email addresses, exact addresses, employee identifiers, school or employer internal information, logos, portraits, and QR codes.

Use synthetic data. Public examples must explicitly state that all names, courses, places, and rosters are fictional. Do not add runtime third-party requests, upload user content, or persist it in browser storage.

## Local setup

Use the Node major in `.node-version` and the npm version declared by `packageManager`.

```bash
npm ci
npm run prepare:ocr
npm run dev
```

`npm ci` and OCR preparation download build dependencies. The running production application must remain same-origin.

## Architecture boundaries

Read [`AGENTS.md`](AGENTS.md) before editing behavior. In particular:

- core parsing must not depend on React;
- relative dates receive an external reference time;
- missing dates, times, and locations are not invented;
- every inference produces a user-visible warning;
- manual edits are never silently overwritten;
- OCR is accessed through `OcrAdapter` and does not alter `originalText`;
- text `SourceSpan` values use UTF-16 half-open ranges and remain independent of image coordinates;
- multi-event, timetable, and roster exports reuse the shared `VEVENT` generator;
- timetable and roster modules remain lazy-loaded;
- production bundles contain no Mock adapter or test-only switch.

## Parser and fixture changes

A new or changed parser rule must include deterministic tests for positive, negative, ambiguous, and source-span behavior. Do not duplicate single-event date, time, title, location, or reminder rules in another module.

Fixtures must be minimal and synthetic. Put public demonstration inputs in `fixtures/public-demo/`; keep unit-test fixtures close to their tests. A real OCR result must be labeled as real and must not be represented by Mock output. Never commit generated `public/ocr/` assets.

## Checks before a pull request

Run the checks affected by your change, then the full local gate:

```bash
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run test:e2e
npm run build
npm run verify:ocr
npm run verify:multi-event
npm run verify:schedule-table
npm run verify:shift-roster
npm run validate:repo
npm run validate:dist
npm run validate:runtime-network
npm run validate:production-mocks
```

Release-oriented changes should also run `verify:pages-base`, `test:cross-browser`, `test:a11y`, `package:release`, and `validate:release`.

## Pull requests

Keep changes focused. Explain the problem, affected mode, architecture and privacy impact, network impact, new dependencies, tests, and documentation. Add screenshots only when they are generated from synthetic data. Every behavior change requires a new or updated test.

Do not combine a release-engineering change with an unrelated product feature. Do not update dependency ranges or bundle budgets merely to make a failing gate pass; explain and verify the underlying change.

## Good first issues

Good first contributions are typically documentation corrections, synthetic fixture improvements, focused accessibility fixes, deterministic tests for an existing rule, or small cross-platform script fixes. They should not require redesigning parser contracts, OCR boundaries, or timetable/roster state.
