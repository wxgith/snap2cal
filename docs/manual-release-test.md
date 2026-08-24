# Manual release test

Record browser, operating system, viewport, artifact version, commit, tester, and result for each run. Use synthetic data only.

## Text event

- [ ] Parse an absolute Chinese date and time
- [ ] Parse a relative date using a known reference date
- [ ] Edit title, time, and location without silent overwrite
- [ ] Review visible warnings for inferred or missing fields
- [ ] Download ICS and inspect one `VEVENT`

## Image event

- [ ] Upload a synthetic PNG/JPEG/WebP image
- [ ] Paste an image where browser permission allows
- [ ] Run local OCR and observe progress/cancel state
- [ ] Correct OCR text while preserving original text
- [ ] Select a field and inspect source-image evidence highlighting
- [ ] Replace and remove the image; confirm old results do not return
- [ ] Download and inspect ICS

## Multiple events

- [ ] Detect three synthetic candidates
- [ ] Confirm, ignore, restore, select, and edit candidates
- [ ] Verify duplicate/low-confidence candidates are not silently removed
- [ ] Download one calendar containing the expected `VEVENT` count

## Timetable

- [ ] Run OCR on a synthetic bordered timetable
- [ ] Detect, adjust, and confirm the grid
- [ ] Confirm weekday columns and real row times
- [ ] Set first teaching-week Monday and semester length
- [ ] Review course title, location, teacher, and week pattern
- [ ] Generate occurrences, exclude one, inspect conflict warnings
- [ ] Download ICS and confirm one `VEVENT` per included occurrence

## Shift roster

- [ ] Run OCR on a synthetic person-by-date roster
- [ ] Detect, adjust, and confirm the grid
- [ ] Confirm people, year, month, and exact dates
- [ ] Map `A`, `N`, and `OFF` explicitly
- [ ] Confirm the night shift crosses midnight
- [ ] Generate occurrences and exclude one without deleting its assignment
- [ ] Download a personal ICS and a team ICS
- [ ] Confirm skip assignments create no `VEVENT`

## Pages subpath

- [ ] Load the repository subpath directly and refresh it
- [ ] Load main JS/CSS and demo images without root fallback
- [ ] Load timetable and roster dynamic chunks
- [ ] Load OCR Worker, WASM, `chi_sim`, and `eng` from the same origin
- [ ] Complete a synthetic OCR smoke flow
- [ ] Confirm no 404 response and no third-party application request
- [ ] Confirm downloads still work

## Browsers and viewports

- [ ] Chromium at 1280px
- [ ] Firefox core smoke
- [ ] WebKit/Safari-equivalent core smoke
- [ ] 390px mobile layout without page-level horizontal overflow
- [ ] Controlled timetable/roster table regions scroll internally
- [ ] Keyboard focus remains visible and mode switches are operable
- [ ] Clipboard denial and Worker failure produce visible messages

## Release ZIP

- [ ] Download ZIP and SHA-256 manifest from the Draft Release
- [ ] Verify checksum independently
- [ ] Extract to an empty directory
- [ ] Confirm one static-site root and no source cache, test, Mock, trace, secret, or user data
- [ ] Serve through local HTTP, not `file://`
- [ ] Walk all four modes and trigger a download
- [ ] Confirm browser console has no unexpected error
- [ ] Confirm runtime requests are same-origin
