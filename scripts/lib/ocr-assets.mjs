const REMOTE_FALLBACKS = [
  {
    from: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/",
    to: "./__snap2cal_language_path_required__/",
  },
  {
    from: "https://cdn.jsdelivr.net/npm/tesseract.js-core@v",
    to: "./__snap2cal_core_path_required__/v",
  },
];

export function createOcrAssetManifest(files) {
  return {
    engine: "tesseract.js",
    engineVersion: "7.0.0",
    languageData: "tessdata.projectnaptha.com/4.0.0_fast",
    files,
  };
}

export function removeRemoteOcrFallbacks(workerSource) {
  let rewritten = workerSource;
  for (const replacement of REMOTE_FALLBACKS) {
    if (!rewritten.includes(replacement.from))
      throw new Error(`Expected Tesseract Worker fallback is missing: ${replacement.from}`);
    rewritten = rewritten.replaceAll(replacement.from, replacement.to);
  }
  if (
    /https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@tesseract\.js-data|tesseract\.js-core)/.test(rewritten)
  )
    throw new Error("Tesseract Worker still contains a remote OCR fallback.");
  return rewritten;
}
