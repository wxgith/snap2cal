# Security policy

## Supported versions

Snap2Cal has not yet published a stable v1.0 release.

| Version                        | Status                                             |
| ------------------------------ | -------------------------------------------------- |
| Current `1.0.0-rc.x` line      | Best-effort security fixes during candidate review |
| Untagged development snapshots | Not supported                                      |

This table will be updated when a stable release exists. No response or remediation deadline is promised.

## Reporting a vulnerability

Do not open a public Issue for a vulnerability or include exploit details, credentials, private images, schedules, rosters, or other personal data in public repository content.

GitHub Private Vulnerability Reporting is not enabled for this repository, and no security email address has been confirmed. Ask the repository owner for a private reporting channel without disclosing vulnerability details publicly. This policy does not promise a response or remediation deadline.

A useful private report includes the affected version or commit, a minimal synthetic reproduction, impact, browser and operating system, and any suggested mitigation. Never attach real user data.

## Security boundaries

Security-relevant areas include unintended upload or persistence, unexpected third-party runtime requests, script injection, unsafe file handling, secrets in repository history, Mock code in a production build, OCR Worker/WASM integrity, and malicious calendar output that escapes expected serialization.

Snap2Cal handles one image in browser memory and runs OCR through local same-origin resources. It has no backend, account, cloud OCR, or application database. This reduces server-side exposure but does not make all browser, dependency, hosting, or calendar-import risks disappear.

An OCR mistake, unsupported layout, parsing ambiguity, or incorrect inferred grid is normally an accuracy bug rather than a security vulnerability unless it crosses a trust boundary or enables another security impact. Use `SUPPORT.md` for ordinary accuracy reports, with synthetic data only.
