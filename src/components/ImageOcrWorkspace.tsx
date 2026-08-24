import { useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeImage, type NormalizedImage } from "../image/image";
import { buildOcrDocument, editOcrBlock, setOcrBlockIgnored } from "../ocr/document";
import type { OcrAdapter, OcrDocument, OcrEvidence, OcrProgress } from "../ocr/types";
import { OcrError } from "../ocr/types";

export type OcrAdapterFactory = () => Promise<OcrAdapter>;
export type ImageNormalizer = (file: Blob) => Promise<NormalizedImage>;

interface Props {
  adapterFactory?: OcrAdapterFactory;
  imageNormalizer?: ImageNormalizer;
  activeEvidence?: OcrEvidence | null;
  document: OcrDocument | null;
  onDocumentChange: (document: OcrDocument | null) => void;
  onParse: (preserveEdits: boolean) => void;
  hasEvent: boolean;
  onRecognitionStart?: () => void;
  onRedetect?: () => void;
  onNormalizedImageChange?: (image: NormalizedImage | null) => void;
  overlay?: ReactNode;
  showOcrBoxes?: boolean;
  enableEventParsing?: boolean;
  headingId?: string;
  title?: string;
  description?: string;
}

interface SelectedImage extends NormalizedImage {
  url: string;
  name: string;
}

async function defaultAdapterFactory(): Promise<OcrAdapter> {
  if (import.meta.env.VITE_SNAP2CAL_MOCK_OCR === "true") {
    const { MockOcrAdapter, MOCK_MULTI_EVENT_RESULT, MOCK_ROSTER_RESULT, MOCK_SCHEDULE_RESULT } =
      await import("../ocr/MockOcrAdapter");
    const fixture = new URLSearchParams(window.location.search).get("mockOcr");
    return new MockOcrAdapter(
      fixture === "multi"
        ? { result: MOCK_MULTI_EVENT_RESULT }
        : fixture === "roster"
          ? { result: MOCK_ROSTER_RESULT }
          : fixture === "schedule"
            ? { result: MOCK_SCHEDULE_RESULT }
            : {},
    );
  }
  const { createTesseractOcrAdapter } = await import("../ocr/TesseractOcrAdapter");
  return createTesseractOcrAdapter();
}

function userMessage(error: unknown): string {
  if (error instanceof OcrError) return `${error.message}（${error.code}）`;
  return "图片处理失败，请重新选择图片后重试。";
}

const INITIAL_PROGRESS: OcrProgress = { stage: "idle", progress: 0, message: "等待开始识别" };

export function ImageOcrWorkspace({
  adapterFactory = defaultAdapterFactory,
  imageNormalizer = normalizeImage,
  activeEvidence,
  document,
  onDocumentChange,
  onParse,
  hasEvent,
  onRecognitionStart,
  onRedetect,
  onNormalizedImageChange,
  overlay,
  showOcrBoxes = true,
  enableEventParsing = true,
  headingId = "image-title",
  title = "本地图片识别",
  description = "图片只在当前浏览器内存中处理",
}: Props) {
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [progress, setProgress] = useState<OcrProgress>(INITIAL_PROGRESS);
  const [error, setError] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showAllBoxes, setShowAllBoxes] = useState(true);
  const adapterRef = useRef<OcrAdapter | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const taskIdRef = useRef(0);
  const imageRef = useRef<SelectedImage | null>(null);
  const recognizing = !["idle", "completed"].includes(progress.stage);

  const releaseTask = async () => {
    taskIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const adapter = adapterRef.current;
    adapterRef.current = null;
    if (adapter) await adapter.dispose();
  };

  const revokeImage = () => {
    const current = imageRef.current;
    if (current) URL.revokeObjectURL(current.url);
    imageRef.current = null;
  };

  useEffect(() => {
    return () => {
      taskIdRef.current += 1;
      abortRef.current?.abort();
      const adapter = adapterRef.current;
      adapterRef.current = null;
      if (adapter) void adapter.dispose();
      const current = imageRef.current;
      if (current) URL.revokeObjectURL(current.url);
      imageRef.current = null;
    };
  }, []);

  const loadImage = async (file: Blob, name = "粘贴的截图") => {
    setError("");
    await releaseTask();
    revokeImage();
    onDocumentChange(null);
    onNormalizedImageChange?.(null);
    setSelectedBlockId(null);
    setProgress(INITIAL_PROGRESS);
    try {
      const normalized = await imageNormalizer(file);
      let url: string;
      try {
        url = URL.createObjectURL(normalized.blob);
      } catch {
        throw new OcrError("IMAGE_DECODE_FAILED", "浏览器无法创建图片预览，请重新选择。");
      }
      const selected = { ...normalized, url, name };
      imageRef.current = selected;
      setImage(selected);
      onNormalizedImageChange?.(normalized);
    } catch (cause) {
      setImage(null);
      onNormalizedImageChange?.(null);
      setError(userMessage(cause));
    }
  };

  const startRecognition = async () => {
    if (!image) {
      setError("请先选择或粘贴一张图片。（IMAGE_REQUIRED）");
      return;
    }
    await releaseTask();
    onRecognitionStart?.();
    const taskId = taskIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setProgress({ stage: "loading-engine", progress: 0.01, message: "正在加载识别引擎" });
    try {
      const adapter = await adapterFactory();
      if (taskId !== taskIdRef.current) {
        await adapter.dispose();
        return;
      }
      adapterRef.current = adapter;
      const raw = await adapter.recognize(image.blob, {
        languages: ["chi_sim", "eng"],
        signal: controller.signal,
        onProgress: (next) => {
          if (taskId === taskIdRef.current) setProgress(next);
        },
      });
      if (taskId !== taskIdRef.current || controller.signal.aborted) return;
      if (!raw.blocks.length)
        throw new OcrError("OCR_EMPTY_RESULT", "没有识别到文字，请换用更清晰的截图。");
      const nextDocument = buildOcrDocument(raw, image.width, image.height);
      onDocumentChange(nextDocument);
      setSelectedBlockId(nextDocument.blocks[0]?.id ?? null);
      setProgress({ stage: "completed", progress: 1, message: "识别完成" });
      if (nextDocument.averageConfidence !== null && nextDocument.averageConfidence < 0.5)
        setError("OCR 平均置信度较低，请逐项校对文字后再解析。（OCR_LOW_CONFIDENCE）");
    } catch (cause) {
      if (taskId !== taskIdRef.current) return;
      if (cause instanceof OcrError && cause.code === "OCR_CANCELLED") {
        setProgress(INITIAL_PROGRESS);
        return;
      }
      setProgress(INITIAL_PROGRESS);
      setError(userMessage(cause));
    }
  };

  const cancelRecognition = async () => {
    await releaseTask();
    setProgress(INITIAL_PROGRESS);
    setError("");
  };

  const removeImage = async () => {
    await releaseTask();
    revokeImage();
    setImage(null);
    onDocumentChange(null);
    onNormalizedImageChange?.(null);
    setSelectedBlockId(null);
    setProgress(INITIAL_PROGRESS);
    setError("");
  };

  const parseDocument = (preserveEdits: boolean) => {
    if (!document?.combinedText) {
      setError("所有 OCR 文本块都已忽略或为空，请恢复至少一块后再解析。（OCR_ALL_BLOCKS_IGNORED）");
      return;
    }
    setError("");
    onParse(preserveEdits);
  };

  const evidenceIds = new Set(activeEvidence?.blockIds ?? []);
  const visibleBlocks = document?.blocks.filter(
    (block) => showAllBoxes || evidenceIds.has(block.id) || block.id === selectedBlockId,
  );

  return (
    <section
      className="panel image-workspace"
      aria-labelledby={headingId}
      onPaste={(event) => {
        if ((event.target as HTMLElement).matches("input, textarea")) return;
        const item = [...event.clipboardData.items].find((candidate) =>
          candidate.type.startsWith("image/"),
        );
        const file = item?.getAsFile();
        if (file) {
          event.preventDefault();
          void loadImage(file);
        } else setError("剪贴板中没有图片，请复制截图后再粘贴。（CLIPBOARD_IMAGE_NOT_FOUND）");
      }}
    >
      <div className="section-heading">
        <span className="step">01</span>
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {!image ? (
        <label
          className="drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void loadImage(file, file.name);
          }}
        >
          <strong>拖入、选择或粘贴一张截图</strong>
          <span>PNG、JPEG、WebP · 最大 8 MB / 2500 万像素</span>
          <input
            aria-label="选择图片"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadImage(file, file.name);
            }}
          />
        </label>
      ) : (
        <>
          <div className="ocr-layout">
            <div className="image-preview" data-testid="image-preview">
              <img src={image.url} alt={`待识别图片：${image.name}`} />
              <svg viewBox={`0 0 ${image.width} ${image.height}`} aria-label="OCR 识别区域">
                {showOcrBoxes &&
                  visibleBlocks?.map((block) => {
                    const evidence = evidenceIds.has(block.id);
                    const selected = block.id === selectedBlockId;
                    return (
                      <rect
                        key={block.id}
                        x={block.bbox.x}
                        y={block.bbox.y}
                        width={block.bbox.width}
                        height={block.bbox.height}
                        className={`${selected ? "selected" : ""} ${evidence ? "field-evidence" : ""}`}
                        data-testid="ocr-box"
                        data-evidence={evidence}
                        data-selected={selected || evidence}
                        role="button"
                        tabIndex={0}
                        aria-label={`选择 OCR 区域：${block.text}`}
                        aria-pressed={selected || evidence}
                        onClick={() => setSelectedBlockId(block.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            setSelectedBlockId(block.id);
                        }}
                      >
                        <title>{block.text}</title>
                      </rect>
                    );
                  })}
                {overlay}
              </svg>
            </div>
            <div className="ocr-side">
              {document ? (
                <div className="ocr-blocks" aria-label="OCR 文本块列表">
                  {document.blocks.map((block, index) => (
                    <article
                      key={block.id}
                      className={`ocr-block ${block.ignored ? "ignored" : ""} ${selectedBlockId === block.id ? "selected" : ""}`}
                      aria-current={selectedBlockId === block.id ? "true" : undefined}
                      onClick={() => setSelectedBlockId(block.id)}
                    >
                      <label>
                        识别块 {index + 1}
                        <input
                          aria-label={`OCR 文本块 ${index + 1}`}
                          value={block.text}
                          disabled={block.ignored}
                          onChange={(event) =>
                            onDocumentChange(editOcrBlock(document, block.id, event.target.value))
                          }
                        />
                      </label>
                      <p>初始：{block.originalText || "（空）"}</p>
                      <div className="chips">
                        <span className="chip">OCR {Math.round(block.confidence * 100)}%</span>
                        {block.manuallyEdited && <span className="chip edited">已人工校对</span>}
                        {block.ignored && <span className="chip default">已忽略</span>}
                      </div>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onDocumentChange(setOcrBlockIgnored(document, block.id, !block.ignored));
                        }}
                      >
                        {block.ignored ? "恢复" : "忽略"}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="ocr-placeholder">点击“开始识别”后，可在这里逐块校对文字。</div>
              )}
            </div>
          </div>
          {showOcrBoxes && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={showAllBoxes}
                onChange={(event) => setShowAllBoxes(event.target.checked)}
              />
              显示全部识别框
            </label>
          )}
        </>
      )}
      {progress.stage !== "idle" && (
        <div
          className="ocr-progress"
          role="progressbar"
          aria-label="OCR 识别进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.progress * 100)}
        >
          <span>{progress.message}</span>
          <strong>{Math.round(progress.progress * 100)}%</strong>
          <div>
            <i style={{ width: `${Math.round(progress.progress * 100)}%` }} />
          </div>
        </div>
      )}
      {error && (
        <div className="image-error" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        {recognizing ? (
          <button onClick={() => void cancelRecognition()}>取消识别</button>
        ) : (
          <button className="primary" disabled={!image} onClick={() => void startRecognition()}>
            {document ? "重新识别" : "开始识别"}
          </button>
        )}
        {document && enableEventParsing && (
          <>
            <button className="primary" onClick={() => parseDocument(hasEvent)}>
              {" "}
              {hasEvent ? "重新解析并保留手工修改" : "解析事件"}
            </button>
            {hasEvent && <button onClick={() => parseDocument(false)}>全部重新解析</button>}
            {hasEvent && onRedetect && <button onClick={onRedetect}>重新检测事件边界</button>}
          </>
        )}
        {image && (
          <label className="file-button">
            更换图片
            <input
              aria-label="更换图片"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadImage(file, file.name);
              }}
            />
          </label>
        )}
        {image && (
          <button className="ghost" onClick={() => void removeImage()}>
            删除图片
          </button>
        )}
      </div>
    </section>
  );
}
