# Release process

Snap2Cal uses a release-candidate-first process. Commands in this document are examples for the maintainer; they are not executed by repository scripts unless explicitly stated.

## Before any release

1. Confirm [`../RELEASE_BLOCKERS.md`](../RELEASE_BLOCKERS.md) has no unchecked release blocker.
2. Verify the MIT `LICENSE`, `package.json` SPDX identifier, and copyright attribution remain consistent.
3. Confirm the GitHub owner, repository, default branch, visibility, and Pages settings.
4. Update `package.json`, `CHANGELOG.md`, and both READMEs without claiming an unverified release date.
5. Generate and inspect the dependency license report.
6. Run the full release gate and manual test.

The release workflow rejects an unresolved blocker or a tag that differs from the package version.

## 1. Release candidate

The first candidate should normally be `v1.0.0-rc.1`.

```bash
git checkout -b release/v1.0.0
npm ci
npm run prepare:ocr
npm run generate:license-report
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run test:e2e
npm run verify:ocr
npm run verify:multi-event
npm run verify:schedule-table
npm run verify:shift-roster
npm run test:cross-browser
npm run test:a11y
npm run build
npm run validate:repo -- --require-publishable
npm run validate:dist
npm run validate:runtime-network
npm run validate:production-mocks
npm run verify:pages-base
npm run package:release -- --require-publishable
npm run validate:release -- --require-publishable --tag v1.0.0-rc.1
git add .
git commit -m "chore: prepare v1.0.0 release"
git push -u origin release/v1.0.0
```

After review and merge, the maintainer creates and pushes the RC tag manually:

```bash
git tag -a v1.0.0-rc.1 -m "Snap2Cal v1.0.0-rc.1"
git push origin v1.0.0-rc.1
```

The Release workflow validates the tag, runs the full gate, creates a versioned static-site ZIP and SHA-256 manifest, and creates a **Draft Release** with generated notes. It does not publish to npm and does not publish the draft.

Download the artifacts, verify the checksum independently, extract the site, and serve it through HTTP. Do not double-click `file://index.html`; module, Worker, and WASM loading requires HTTP.

```bash
npx serve .
```

Complete [`manual-release-test.md`](manual-release-test.md), check Pages, collect defects, and prepare `rc.2` if necessary.

## 2. Final v1.0.0

Proceed only after the candidate has no release blocker.

1. Finalize the changelog and version.
2. Repeat all automated and manual verification.
3. Create and push an annotated `v1.0.0` tag.
4. Inspect the resulting Draft Release, generated notes, ZIP, and checksum.
5. Manually publish the draft.
6. Recheck Pages, downloads, browser console, runtime requests, and all four modes.
7. Record any post-release regression and use a new corrective release; do not rewrite a published tag.

Example tag commands, to be run by the maintainer only:

```bash
git tag -a v1.0.0 -m "Snap2Cal v1.0.0"
git push origin v1.0.0
```

## Rollback

Keep the prior known-good artifact and tag. If a draft is defective, do not publish it; fix the source and create a new candidate tag. If Pages is defective, redeploy the last known-good commit through the Actions workflow. Never move or overwrite a published release tag.
