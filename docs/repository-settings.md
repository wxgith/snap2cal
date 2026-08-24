# GitHub repository settings

The public repository is [`wxgith/snap2cal`](https://github.com/wxgith/snap2cal). Its repository name is `snap2cal`, its owner is `wxgith`, its default branch is `main`, and its confirmed visibility is `public`. The `origin` URL is `https://github.com/wxgith/snap2cal.git`.

## Repository

1. Description: `Turn event text, screenshots, timetables, and shift rosters into reviewable ICS files locally in your browser.`
2. Topics: `calendar`, `ics`, `local-first`, `ocr`, `privacy`, `react`, `shift-roster`, `tesseract`, `timetable`, and `typescript`.
3. Issues are enabled after review of the Issue Forms and privacy guidance.
4. The repository is public after a secret, personal-path, generated-file, and large-file scan.

## Branch protection

Branch protection is intentionally not configured during the initial publication. A future ruleset for `main` may:

- requires pull requests;
- requires the branch to be up to date before merging;
- requires conversations to be resolved;
- blocks force pushes;
- blocks deletion of the default branch;
- requires the checks that match the actual workflow run names.

Prepared check names:

- `Quality`
- `Unit tests`
- `Production build`
- `Chromium E2E`
- `Cross-browser smoke`
- `Windows smoke`

The manually triggered full-verification workflow also exposes `Focused verification`. Confirm these names in the Actions UI before making them required; GitHub only offers checks that have run in the repository.

## Pages

- URL: <https://wxgith.github.io/snap2cal/>
- Build type: `workflow`
- Workflow: [`pages.yml`](../.github/workflows/pages.yml)
- Initial deployment: [run 32697590243](https://github.com/wxgith/snap2cal/actions/runs/32697590243)
- HTTPS: enforced
- Custom domain: not configured

The workflow derives the base path from `github.repository`; no repository name is hard-coded. The deployed repository subpath, refresh behavior, dynamic timetable and roster modules, real OCR Worker/WASM and language data, synthetic demo images, ICS generation, zero observed third-party assets, and 390px/1280px layouts were verified against the live URL.

## Security

Review the following settings where the repository visibility, owner type, and GitHub plan make them available:

- dependency graph;
- Dependabot alerts;
- Dependabot security updates;
- private vulnerability reporting;
- secret scanning and push protection.

Availability varies by account and repository. Enabling a setting does not replace review of [`../SECURITY.md`](../SECURITY.md), dependency update pull requests, or repository history.

## Releases

1. Prepare `v1.0.0-rc.1` only after every release blocker is resolved.
2. Let the tag workflow create a Draft Release.
3. Download the static-site ZIP and SHA-256 file.
4. Verify the checksum and serve the extracted site through HTTP.
5. Complete the manual release test before publishing the draft.
6. Use a final `v1.0.0` only after the release candidate has no unresolved problem.
