import Tesseract from "tesseract.js";
import type { OcrAdapter, OcrProgress, OcrRawResult, OcrRecognizeOptions } from "./types";
import { OcrError } from "./types";

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}ocr/${path}`;
}

function progressFromLogger(message: Tesseract.LoggerMessage): OcrProgress {
  const status = message.status.toLowerCase();
  if (status.includes("language") || status.includes("traineddata")) {
    return {
      stage: "loading-language",
      progress: Math.min(0.45, message.progress * 0.45),
      message: "正在加载中文语言数据",
    };
  }
  if (status.includes("recogniz")) {
    return {
      stage: "recognizing",
      progress: 0.45 + message.progress * 0.45,
      message: "正在识别图片",
    };
  }
  return {
    stage: "loading-engine",
    progress: Math.min(0.4, message.progress * 0.4),
    message: "正在加载识别引擎",
  };
}

async function assertAssetsAvailable(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(assetUrl("manifest.json"), { cache: "no-store" });
  } catch {
    throw new OcrError(
      "OCR_ASSETS_MISSING",
      "无法读取本地 OCR 资源。请先运行 npm run prepare:ocr，然后重试。",
    );
  }
  if (!response.ok) {
    throw new OcrError(
      "OCR_ASSETS_MISSING",
      "本地 OCR 资源尚未准备。请先运行 npm run prepare:ocr，然后重试。",
    );
  }
}

export class TesseractOcrAdapter implements OcrAdapter {
  private worker: Tesseract.Worker | null = null;
  private generation = 0;

  async recognize(image: Blob, options: OcrRecognizeOptions): Promise<OcrRawResult> {
    const generation = ++this.generation;
    await this.disposeWorker();
    if (options.signal?.aborted) throw new OcrError("OCR_CANCELLED", "识别已取消。");
    await assertAssetsAvailable();
    options.onProgress?.({ stage: "loading-engine", progress: 0.02, message: "正在加载识别引擎" });

    const abort = () => void this.disposeWorker();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const worker = await Tesseract.createWorker(options.languages, Tesseract.OEM.LSTM_ONLY, {
        workerPath: assetUrl("worker.min.js"),
        corePath: assetUrl("core"),
        langPath: assetUrl("lang"),
        workerBlobURL: false,
        cacheMethod: "none",
        gzip: true,
        logger: (message) => {
          if (generation === this.generation && !options.signal?.aborted)
            options.onProgress?.(progressFromLogger(message));
        },
      });
      if (generation !== this.generation || options.signal?.aborted) {
        await worker.terminate();
        throw new OcrError("OCR_CANCELLED", "识别已取消。");
      }
      this.worker = worker;
      options.onProgress?.({ stage: "recognizing", progress: 0.5, message: "正在识别图片" });
      const result = await worker.recognize(
        image,
        { rotateAuto: true },
        { blocks: true, text: true },
      );
      if (generation !== this.generation || options.signal?.aborted)
        throw new OcrError("OCR_CANCELLED", "识别已取消。");
      options.onProgress?.({
        stage: "building-document",
        progress: 0.95,
        message: "正在整理识别结果",
      });
      let lineIndex = 0;
      const blocks = (result.data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.flatMap((line) => {
            const text = line.text.trim();
            const currentLine = lineIndex++;
            if (!text) return [];
            return [
              {
                text,
                confidence: Math.max(0, Math.min(1, line.confidence / 100)),
                bbox: {
                  x: line.bbox.x0,
                  y: line.bbox.y0,
                  width: line.bbox.x1 - line.bbox.x0,
                  height: line.bbox.y1 - line.bbox.y0,
                },
                lineIndex: currentLine,
                orderIndex: currentLine,
              },
            ];
          }),
        ),
      );
      options.onProgress?.({ stage: "completed", progress: 1, message: "识别完成" });
      return { blocks };
    } catch (error) {
      if (options.signal?.aborted || error instanceof OcrError) {
        if (error instanceof OcrError) throw error;
        throw new OcrError("OCR_CANCELLED", "识别已取消。");
      }
      throw new OcrError("OCR_RECOGNITION_FAILED", "本地 OCR 识别失败。请确认资源完整后重试。");
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }

  private async disposeWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate().catch(() => undefined);
  }

  async dispose(): Promise<void> {
    this.generation += 1;
    await this.disposeWorker();
  }
}

export function createTesseractOcrAdapter(): OcrAdapter {
  return new TesseractOcrAdapter();
}
