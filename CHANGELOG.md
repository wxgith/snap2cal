# Changelog

Notable changes are documented here.

## Unreleased

No changes have been recorded since the first v1.0 release candidate.

## 1.0.0-rc.1 - 2026-08-24

This is the first public release candidate for Snap2Cal 1.0. It is intended for review and is not the final stable release.

### Added

- Chinese text-event parsing with editable review and ICS export.
- Browser-local image OCR with source-image evidence.
- Multi-event candidate detection and multi-`VEVENT` export.
- Timetable grid review with teaching-week occurrence generation.
- Person-by-date shift-roster review, including cross-midnight shifts.
- Personal and team roster ICS export.
- Bilingual documentation and synthetic demonstration inputs.

### Privacy

- No backend or cloud OCR.
- No analytics SDK or persistence of user input.
- Production runtime assets are same-origin and make no third-party requests.

### Release engineering

- Linux and Windows CI.
- Chromium, Firefox, and WebKit checks plus an accessibility smoke test.
- GitHub Pages subpath verification.
- Deterministic static-site ZIP and SHA-256 checksum.
- Dependency license report and Draft Release workflow.

### Known limitations

- OCR and grid recognition require user review.
- Only one image can be processed at a time.
- PDF, Excel, CSV, and batch image input are not supported.
- Recurrence rules, accounts, and cloud synchronization are not supported.
- Snap2Cal does not make payroll, attendance, labor-law, or other compliance decisions.

## 1.0.0 - Pending

The stable version has not been released or tagged. It remains pending RC review and the final release checklist.

Planned v1.0 scope is limited to the four existing modes: text event, image event, timetable, and shift roster.

## 0.1.0 - Local development version

This was the untagged local development version used before RC preparation. No `v0.1.0` release is asserted.
