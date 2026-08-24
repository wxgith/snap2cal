# Snap2Cal static-site archive

This document is copied into release archives as `README.txt`-equivalent guidance.

The archive contains the built Snap2Cal static site, not a desktop executable. Extract it to an empty directory and serve that directory over HTTP. ES modules, Web Workers, WebAssembly, and OCR language assets are not expected to work by double-clicking `file://index.html`.

One temporary local option is:

```bash
npx serve .
```

Then open the URL printed by the static server. No script inside the archive runs automatically.

User input remains in browser memory. Review generated calendar events before importing them. All bundled demo names, courses, places, and rosters are fictional.

Snap2Cal is licensed under the MIT License, copyright (c) 2026 xin. A publishable archive contains the repository `LICENSE`; third-party components retain the licenses described in `THIRD_PARTY_NOTICES.md`.
