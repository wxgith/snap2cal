# GitHub repository settings

These settings must be completed manually in the eventual GitHub repository. The intended repository name is `snap2cal`, and the intended visibility is `public`. The owner and default branch are not yet confirmed. This local task does not create a repository, change visibility, enable Pages, configure protection, or enable security features.

Placeholders such as `<owner>` and `<default-branch>` are instructions, not live links.

## Repository

1. Confirm the owner and default branch; verify the repository name is `snap2cal`.
2. Set an accurate description such as: `Turn event text, screenshots, timetables, and shift rosters into reviewable ICS files locally in the browser.`
3. Consider topics such as `calendar`, `ics`, `ocr`, `timetable`, `shift-roster`, `react`, and `typescript`.
4. Enable Issues only after the Issue Forms and privacy guidance have been reviewed.
5. Apply the confirmed `public` visibility only after current files and any imported history have been scanned for credentials and private data.

## Branch protection

For `<default-branch>`, consider a ruleset that:

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

1. In **Settings > Pages**, select **GitHub Actions** as the source.
2. Manually run the `Pages` workflow from the confirmed default branch.
3. Verify the repository subpath, refresh behavior, dynamic timetable and roster modules, OCR Worker/WASM, both language files, all four modes, downloads, and zero third-party runtime requests.
4. Do not configure a custom domain during the initial release check.

The workflow derives the base path from `github.repository`; no repository name is hard-coded. This document does not claim that Pages is enabled.

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
