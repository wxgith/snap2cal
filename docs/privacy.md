# Privacy, local processing, and review notice

## Application runtime

Snap2Cal is a static browser application. Text parsing, image normalization, OCR, grid detection, candidate review, timetable expansion, roster expansion, and ICS generation run in the browser.

The application itself:

- does not upload images, OCR text, names, courses, locations, or roster data;
- does not persist user content to a backend, URL, `localStorage`, `IndexedDB`, or an application database;
- loses current input when the page is refreshed or closed;
- loads production JavaScript, CSS, OCR Worker, WASM, language data, favicon, and demo assets from the current site;
- does not use cloud OCR, analytics, advertising, telemetry, or remote error reporting;
- releases temporary object URLs and OCR workers when input is replaced, removed, or the component is disposed;
- writes an ICS file only through the browser's normal download mechanism.

The browser and operating system decide where downloads are stored. A calendar application may copy imported data into its own local or cloud storage. Those behaviors are outside Snap2Cal.

## Installation and CI

Local development and CI are different from application runtime. `npm install` or `npm ci` downloads packages from the configured npm registry. `npm run prepare:ocr` obtains pinned language files during the build stage and records their SHA-256 digests. These operations require network access but do not contain or transmit user input.

GitHub Pages supplies the public static deployment at <https://wxgith.github.io/snap2cal/> and may process ordinary web-server metadata according to GitHub's own terms. Snap2Cal does not add analytics or reporting scripts.

## Public contributions

GitHub Issues, discussions, pull requests, review comments, and uploaded attachments are public repository content unless GitHub explicitly marks the channel private. Do not submit real schedules, employee rosters, chat screenshots, names, phone numbers, email addresses, exact addresses, school or employer internal information, access tokens, or other unredacted personal data.

Create a small synthetic reproduction whenever possible. If a screenshot is essential, crop it to the minimum area and remove every identifying detail before submission. Security reports follow [`../SECURITY.md`](../SECURITY.md) and must not be filed as public issues.

## Accuracy and human review

OCR can misread text. Date and time parsing, candidate boundaries, grid geometry, weekday mapping, teaching-week expansion, shift-code mapping, and cross-midnight handling can also be wrong. Snap2Cal deliberately exposes warnings and requires user confirmation for uncertain or missing values.

Users must review events before importing them. A timetable is not an authoritative academic record, and a roster is not an authoritative employer attendance record. Snap2Cal does not provide payroll, labor-law, working-time, attendance, or other compliance decisions. The project does not guarantee that every event or reminder is complete or correct.

## Data lifecycle

Replacing or removing an image cancels the active task and prevents stale results from replacing newer state. Image pixels, OCR blocks, parsed drafts, manual edits, and generated calendars remain in memory only for the current page session. No recovery is available after refresh.
