# Release checklist

Use this list for a release candidate and repeat it for the final release. An unchecked blocker means the release must remain unpublished.

## Legal and metadata

- [x] Open-source license confirmed and complete `LICENSE` added
- [x] Copyright holder name or organization confirmed
- [ ] `package.json` license and version match the release
- [ ] `RELEASE_BLOCKERS.md` has no unchecked items
- [ ] `THIRD_PARTY_NOTICES.md` reviewed
- [ ] Dependency license report has no unknown or conflicting license
- [ ] Repository owner, name, default branch, and visibility confirmed

## Privacy and security

- [ ] Secret and personal-path scan passes
- [ ] Demo fixtures and screenshots contain synthetic data only
- [ ] No real schedule, roster, chat, contact detail, logo, portrait, or QR code is included
- [ ] Production runtime makes zero third-party requests
- [ ] Production build contains no Mock or test-only path
- [ ] `SECURITY.md` and `docs/privacy.md` are current
- [ ] Dependency alerts and private vulnerability reporting settings reviewed where available

## Documentation and community

- [ ] English and Chinese READMEs agree on features, privacy, and limits
- [ ] README image links and alt text pass validation
- [ ] Contributing, conduct, support, roadmap, changelog, and release docs reviewed
- [ ] Issue Forms, pull request template, labels, and release-note categories reviewed
- [ ] Manual release test completed and recorded

## Quality and build

- [ ] `npm ci` succeeds on the pinned Node major
- [ ] OCR resources prepare and verify
- [ ] lint, typecheck, formatting, unit tests, and full E2E pass
- [ ] Multi-event, timetable, and roster focused verification passes
- [ ] Chromium, Firefox, WebKit, accessibility, Windows, and viewport checks pass
- [ ] Production build and bundle budgets pass
- [ ] Pages non-root base, dynamic modules, OCR assets, and zero-network checks pass

## Release artifact

- [ ] Tag is valid and exactly matches `package.json` version
- [ ] Changelog entry is final and dated only when actually released
- [ ] Static-site ZIP has the expected versioned name
- [ ] ZIP has one site root and contains notices, runtime instructions, and `LICENSE`
- [ ] ZIP excludes source caches, tests, Mock code, traces, secrets, user data, and local paths
- [ ] SHA-256 manifest is generated and independently verified
- [ ] ZIP is served over local HTTP and all four modes are walked through

## GitHub delivery

- [ ] Release candidate commit reviewed and merged
- [ ] RC tag created and pushed by the maintainer
- [ ] Release workflow creates a Draft Release only
- [ ] Draft notes, ZIP, checksum, and Pages deployment reviewed
- [ ] Final `v1.0.0` tag created only after the RC has no blocker
- [ ] Draft manually published by the maintainer
- [ ] Post-release Pages, downloads, console, and network checks pass
- [ ] Rollback plan and regression record are available
