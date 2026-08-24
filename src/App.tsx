import { lazy, Suspense, useMemo, useState } from "react";
import { CandidateReview } from "./components/CandidateReview";
import { EventEditor, EvidencePanel } from "./components/EventEditor";
import {
  ImageOcrWorkspace,
  type ImageNormalizer,
  type OcrAdapterFactory,
} from "./components/ImageOcrWorkspace";
import type { EditableFieldName, EventDraft, ExtractedField } from "./domain/event";
import type {
  CandidateMergeOperation,
  EventCandidateStatus,
  MultiEventExtractionResult,
} from "./domain/multiEvent";
import { validateEvent } from "./domain/validation";
import {
  createCalendarIcsFilename,
  createIcsFilename,
  generateCalendarIcs,
  generateIcs,
  validateCalendarEvents,
} from "./ics";
import {
  appendUnassignedText,
  mergeAdjacentCandidates,
  parseEventCandidates,
  preserveCandidateState,
  reparseCandidates,
  selectCandidates,
  setCandidateSelected,
  setCandidateStatus,
  undoCandidateMerge,
  updateCandidateField,
} from "./multi-event";
import { mapCandidateToOcrEvidence, mapSourceSpanToOcrEvidence } from "./ocr/evidence";
import type { CandidateOcrEvidence, OcrDocument, OcrEvidence } from "./ocr/types";
import { parseEventText, type ParseEventTextOptions } from "./parser";
import "./styles.css";

const ScheduleTableWorkspace = lazy(() => import("./components/ScheduleTableWorkspace"));
const ShiftRosterWorkspace = lazy(() => import("./components/ShiftRosterWorkspace"));
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

const EXAMPLES = [
  "8月26日下午3点，在万达影城看电影，提前30分钟提醒",
  "明天上午9点到11点，在公司三楼会议室开项目评审会，提前1小时提醒",
  "2026年9月3日全天，新生报到，地点：学校体育馆",
];
const EDITABLE_NAMES: EditableFieldName[] = [
  "title",
  "startDate",
  "startTime",
  "endDate",
  "endTime",
  "location",
  "description",
  "reminderMinutes",
  "allDay",
  "timeZone",
];

type ParseMode = "auto" | "single" | "multiple";

function detectTimeZone(): { value: string; fallback: boolean } {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { value: value || "UTC", fallback: !value };
  } catch {
    return { value: "UTC", fallback: true };
  }
}

function createParseOptions(): { options: ParseEventTextOptions; fallback: boolean } {
  const zone = detectTimeZone();
  return {
    options: { referenceDateTime: new Date(), timeZone: zone.value },
    fallback: zone.fallback,
  };
}

function optionsFromResult(result: MultiEventExtractionResult): ParseEventTextOptions {
  return {
    referenceDateTime: new Date(result.parseContext.referenceDateTime),
    timeZone: result.parseContext.timeZone,
  };
}

function preserveEventFields(previous: EventDraft | null, next: EventDraft): EventDraft {
  if (!previous) return next;
  for (const name of EDITABLE_NAMES) {
    if (previous[name].manuallyEdited) Object.assign(next[name], previous[name]);
  }
  return next;
}

function eventSummary(event: EventDraft): string {
  return `${event.title.value}\n${event.startDate.value ?? ""}${
    event.allDay.value
      ? " 全天"
      : ` ${event.startTime.value ?? ""}${event.endTime.value ? `–${event.endTime.value}` : ""}`
  }\n${event.location.value}`.trim();
}

export interface AppProps {
  ocrAdapterFactory?: OcrAdapterFactory;
  imageNormalizer?: ImageNormalizer;
}

export default function App({ ocrAdapterFactory, imageNormalizer }: AppProps = {}) {
  const [mode, setMode] = useState<"text" | "image" | "timetable" | "roster">("text");
  const [parseMode, setParseMode] = useState<ParseMode>("auto");
  const [input, setInput] = useState("");
  const [event, setEvent] = useState<EventDraft | null>(null);
  const [multiResult, setMultiResult] = useState<MultiEventExtractionResult | null>(null);
  const [timetableVisited, setTimetableVisited] = useState(false);
  const [rosterVisited, setRosterVisited] = useState(false);
  const [mergeOperation, setMergeOperation] = useState<CandidateMergeOperation | null>(null);
  const [ocrDocument, setOcrDocument] = useState<OcrDocument | null>(null);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<EditableFieldName | null>(null);
  const [message, setMessage] = useState("");
  const validation = useMemo(() => (event ? validateEvent(event) : []), [event]);
  const selectedCandidates = useMemo(
    () =>
      multiResult?.candidates.filter(
        (candidate) => candidate.selectedForExport && candidate.status !== "ignored",
      ) ?? [],
    [multiResult],
  );
  const batchValidation = useMemo(
    () => validateCalendarEvents(selectedCandidates.map((candidate) => candidate.draft)),
    [selectedCandidates],
  );
  const singleOcrEvidence = useMemo(() => {
    if (!event || !ocrDocument || mode !== "image") return undefined;
    const result: Partial<Record<EditableFieldName, OcrEvidence>> = {};
    for (const name of EDITABLE_NAMES)
      result[name] = mapSourceSpanToOcrEvidence(event[name].source, ocrDocument);
    return result;
  }, [event, ocrDocument, mode]);

  const candidateOcrEvidence = useMemo(() => {
    if (!multiResult || !ocrDocument || mode !== "image") return undefined;
    const result: Record<string, CandidateOcrEvidence> = {};
    for (const candidate of multiResult.candidates)
      result[candidate.id] = mapCandidateToOcrEvidence(candidate, ocrDocument);
    return result;
  }, [multiResult, ocrDocument, mode]);

  const activeOcrEvidence = useMemo(() => {
    if (mode !== "image") return null;
    if (multiResult && activeCandidateId) {
      const candidateEvidence = candidateOcrEvidence?.[activeCandidateId];
      return activeField ? candidateEvidence?.fields[activeField] : candidateEvidence?.candidate;
    }
    return activeField ? singleOcrEvidence?.[activeField] : null;
  }, [mode, multiResult, activeCandidateId, activeField, candidateOcrEvidence, singleOcrEvidence]);

  const clearParsed = () => {
    setEvent(null);
    setMultiResult(null);
    setMergeOperation(null);
    setActiveCandidateId(null);
    setActiveField(null);
  };

  const addTimezoneWarning = (parsed: MultiEventExtractionResult | EventDraft) => {
    parsed.warnings.push({
      code: "TIMEZONE_FALLBACK",
      message: "浏览器无法检测时区，已暂用 UTC，请确认。",
      severity: "warning",
      ...("title" in parsed ? { relatedField: "timeZone" as const } : {}),
    });
  };

  const detectSource = (source: string, preserveEdits: boolean, forcedMode?: ParseMode) => {
    if (!source.trim()) {
      setMessage("没有可解析的文字，请先输入或校对 OCR 文字。");
      if (!preserveEdits) clearParsed();
      return;
    }
    const { options, fallback } = createParseOptions();
    const selectedMode = forcedMode ?? parseMode;
    if (selectedMode === "single") {
      let parsed = parseEventText(source, options);
      if (fallback) addTimezoneWarning(parsed);
      if (preserveEdits) parsed = preserveEventFields(event, parsed);
      setEvent(parsed);
      setMultiResult(null);
    } else {
      let parsed = parseEventCandidates(source, options);
      if (fallback) addTimezoneWarning(parsed);
      if (preserveEdits && multiResult) parsed = preserveCandidateState(multiResult, parsed);
      const showCandidates = selectedMode === "multiple" || parsed.candidates.length >= 2;
      if (showCandidates) {
        setMultiResult(parsed);
        setEvent(null);
        setActiveCandidateId(parsed.candidates[0]?.id ?? null);
      } else {
        let parsedEvent = parsed.candidates[0]?.draft ?? parseEventText(source, options);
        if (preserveEdits) parsedEvent = preserveEventFields(event, parsedEvent);
        setEvent(parsedEvent);
        setMultiResult(null);
      }
    }
    setMergeOperation(null);
    setActiveField(null);
    setMessage("");
  };

  const reparseCurrent = (preserveEdits: boolean) => {
    const source = mode === "image" ? (ocrDocument?.combinedText ?? "") : input;
    if (multiResult) {
      if (parseMode === "single") {
        detectSource(source, preserveEdits, "single");
        return;
      }
      const parsed = reparseCandidates(multiResult, optionsFromResult(multiResult), preserveEdits);
      setMultiResult(parsed);
      setMergeOperation(null);
      setMessage(preserveEdits ? "已重新解析并保留手工修改。" : "已重置候选字段和状态。");
      return;
    }
    detectSource(source, preserveEdits, parseMode);
  };

  const updateField = <K extends EditableFieldName>(name: K, value: EventDraft[K]["value"]) => {
    setEvent((current) => {
      if (!current) return current;
      const field = current[name] as ExtractedField<EventDraft[K]["value"]>;
      return { ...current, [name]: { ...field, value, manuallyEdited: true } };
    });
  };

  const clearText = () => {
    setInput("");
    clearParsed();
    setMessage("");
  };

  const downloadContent = (content: string, filename: string) => {
    if (!("download" in HTMLAnchorElement.prototype) || typeof URL.createObjectURL !== "function")
      throw new Error("当前浏览器不支持文件下载。");
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSingleEvent = (draft: EventDraft) => {
    try {
      downloadContent(generateIcs(draft), createIcsFilename(draft));
      setMessage("ICS 文件已生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ICS 生成失败，请重试。");
    }
  };

  const download = () => {
    if (!event || validation.length) {
      setMessage(validation.map((item) => item.message).join(" ") || "请先解析事件。");
      return;
    }
    downloadSingleEvent(event);
  };

  const downloadBatch = () => {
    if (!batchValidation.valid) {
      const details = batchValidation.events
        .flatMap((item) => item.errors.map((error) => `候选 ${item.index + 1}：${error.message}`))
        .join(" ");
      setMessage(details || "请至少选择一个有效候选后再导出。");
      return;
    }
    const drafts = selectedCandidates.map((candidate) => candidate.draft);
    try {
      downloadContent(generateCalendarIcs(drafts), createCalendarIcsFilename(drafts));
      setMessage(`已生成包含 ${drafts.length} 个事件的 ICS 文件。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量 ICS 生成失败，请重试。");
    }
  };

  const copySummary = async (events: EventDraft[]) => {
    if (!events.length) return;
    try {
      await navigator.clipboard.writeText(events.map(eventSummary).join("\n\n---\n\n"));
      setMessage(events.length > 1 ? "所选事件摘要已复制。" : "事件摘要已复制。");
    } catch {
      setMessage("无法访问剪贴板，请手工复制事件信息。");
    }
  };

  const hasParsed = Boolean(event || multiResult);
  const currentSource = mode === "image" ? (ocrDocument?.combinedText ?? "") : input;

  return (
    <main>
      <header className="hero">
        <div className="brand-mark">S2C</div>
        <div>
          <h1>Snap2Cal</h1>
          <p className="tagline">把文字或截图变成日历事件</p>
          <p className="privacy">所有内容仅在浏览器本地处理，不会上传。</p>
        </div>
      </header>
      <nav className="mode-switch" aria-label="输入方式">
        <button
          aria-pressed={mode === "text"}
          onClick={() => {
            setMode("text");
            setActiveCandidateId(null);
            setActiveField(null);
          }}
        >
          文字输入
        </button>
        <button
          aria-pressed={mode === "image"}
          onClick={() => {
            setMode("image");
            setActiveCandidateId(null);
            setActiveField(null);
          }}
        >
          图片识别
        </button>
        <button
          aria-pressed={mode === "timetable"}
          onClick={() => {
            setMode("timetable");
            setTimetableVisited(true);
            setActiveCandidateId(null);
            setActiveField(null);
          }}
        >
          课程表
        </button>
        <button
          aria-pressed={mode === "roster"}
          onClick={() => {
            setMode("roster");
            setRosterVisited(true);
            setActiveCandidateId(null);
            setActiveField(null);
          }}
        >
          排班表
        </button>
      </nav>
      {(mode === "text" || mode === "image") && (
        <section className="parse-mode" aria-labelledby="parse-mode-title">
          <div>
            <strong id="parse-mode-title">事件识别模式</strong>
            <span>自动模式会在发现两个以上候选时进入人工确认。</span>
          </div>
          <select
            aria-label="事件识别模式"
            value={parseMode}
            onChange={(e) => setParseMode(e.target.value as ParseMode)}
          >
            <option value="auto">自动判断</option>
            <option value="single">按单事件处理</option>
            <option value="multiple">查找多个事件</option>
          </select>
        </section>
      )}
      {mode === "text" ? (
        <section className="panel input-panel" aria-labelledby="input-title">
          <div className="section-heading">
            <span className="step">01</span>
            <div>
              <h2 id="input-title">粘贴活动信息</h2>
              <p>可输入一句话、列表或共享日期/地点下的多项活动</p>
            </div>
          </div>
          <textarea
            aria-label="活动文本"
            className="source-input"
            rows={8}
            placeholder="例如：8月26日下午3点，在万达影城看电影，提前30分钟提醒"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="example-row">
            <span>试试示例</span>
            {EXAMPLES.map((example, index) => (
              <button className="example-button" key={example} onClick={() => setInput(example)}>
                示例 {index + 1}
              </button>
            ))}
          </div>
          <div className="actions">
            {!hasParsed ? (
              <button className="primary" onClick={() => detectSource(input, false)}>
                解析事件
              </button>
            ) : (
              <button className="primary" onClick={() => reparseCurrent(true)}>
                重新解析并保留手工修改
              </button>
            )}
            {hasParsed && <button onClick={() => reparseCurrent(false)}>全部重新解析</button>}
            <button className="ghost" onClick={clearText}>
              清空
            </button>
          </div>
        </section>
      ) : mode === "image" ? (
        <>
          <ImageOcrWorkspace
            adapterFactory={ocrAdapterFactory}
            imageNormalizer={imageNormalizer}
            document={ocrDocument}
            onDocumentChange={(next) => {
              setOcrDocument(next);
              if (!next) clearParsed();
            }}
            onRecognitionStart={clearParsed}
            onParse={(preserve) =>
              hasParsed ? reparseCurrent(preserve) : detectSource(currentSource, false)
            }
            onRedetect={event ? () => detectSource(currentSource, true) : undefined}
            hasEvent={hasParsed}
            activeEvidence={activeOcrEvidence}
          />
        </>
      ) : null}
      {timetableVisited && (
        <Suspense
          fallback={
            <section className="panel" role="status">
              正在加载课程表模块…
            </section>
          }
        >
          <ScheduleTableWorkspace
            hidden={mode !== "timetable"}
            ocrAdapterFactory={ocrAdapterFactory}
            imageNormalizer={imageNormalizer}
            onMessage={setMessage}
            onDownload={(events, filename) => {
              try {
                downloadContent(generateCalendarIcs(events), filename);
                setMessage(`已生成包含 ${events.length} 节课的 ICS 文件。`);
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "课程表 ICS 生成失败，请重试。",
                );
              }
            }}
          />
        </Suspense>
      )}
      {rosterVisited && (
        <Suspense
          fallback={
            <section className="panel" role="status">
              正在加载排班表模块…
            </section>
          }
        >
          <ShiftRosterWorkspace
            hidden={mode !== "roster"}
            ocrAdapterFactory={ocrAdapterFactory}
            imageNormalizer={imageNormalizer}
            onMessage={setMessage}
            onDownload={(events, filename) => {
              try {
                downloadContent(generateCalendarIcs(events), filename);
                setMessage(`已生成包含 ${events.length} 个班次的 ICS 文件。`);
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "排班表 ICS 生成失败，请重试。",
                );
              }
            }}
          />
        </Suspense>
      )}
      {message && (
        <div className="status-message" role="status">
          {message}
        </div>
      )}

      {multiResult && (
        <>
          <CandidateReview
            result={multiResult}
            evidence={candidateOcrEvidence}
            activeCandidateId={activeCandidateId}
            activeField={activeField}
            canUndoMerge={Boolean(mergeOperation)}
            onChangeField={(candidateId, name, value) =>
              setMultiResult((current) =>
                current ? updateCandidateField(current, candidateId, name, value) : current,
              )
            }
            onSetStatus={(candidateId, status: EventCandidateStatus) =>
              setMultiResult((current) =>
                current ? setCandidateStatus(current, candidateId, status) : current,
              )
            }
            onSetSelected={(candidateId, selected) =>
              setMultiResult((current) =>
                current ? setCandidateSelected(current, candidateId, selected) : current,
              )
            }
            onSelectGroup={(selection) =>
              setMultiResult((current) =>
                current ? selectCandidates(current, selection) : current,
              )
            }
            onFocus={(candidateId, field) => {
              setActiveCandidateId(candidateId);
              setActiveField(field);
            }}
            onMerge={(candidateId) => {
              const operation = mergeAdjacentCandidates(
                multiResult,
                candidateId,
                optionsFromResult(multiResult),
              );
              if (!operation) {
                setMessage("只能合并相邻候选，最后一个候选没有下一项。");
                return;
              }
              setMergeOperation(operation);
              setMultiResult(operation.result);
              setActiveCandidateId(operation.mergedCandidateId);
              setActiveField(null);
              setMessage("已合并相邻候选；可撤销最近一次合并。");
            }}
            onUndoMerge={() => {
              if (!mergeOperation) return;
              const previous = undoCandidateMerge(mergeOperation);
              setMultiResult(previous);
              setMergeOperation(null);
              setActiveCandidateId(previous.candidates[0]?.id ?? null);
              setActiveField(null);
              setMessage("已撤销最近一次合并。");
            }}
            onDownloadOne={(candidateId) => {
              const candidate = multiResult.candidates.find((item) => item.id === candidateId);
              if (candidate) downloadSingleEvent(candidate.draft);
            }}
            onAppendUnassigned={(candidateId, fragmentIndex) =>
              setMultiResult((current) =>
                current ? appendUnassignedText(current, candidateId, fragmentIndex) : current,
              )
            }
            onRedetect={() => detectSource(currentSource, true)}
            onUseSingle={() => {
              setParseMode("single");
              detectSource(currentSource, false, "single");
            }}
          />
          {multiResult.warnings.length > 0 && (
            <section className="panel warnings" aria-labelledby="multi-warnings-title">
              <div className="section-heading">
                <span className="step">!</span>
                <div>
                  <h2 id="multi-warnings-title">多事件检测提示</h2>
                  <p>边界与重复项需要人工确认</p>
                </div>
              </div>
              <ul>
                {multiResult.warnings.map((warning, index) => (
                  <li className={warning.severity} key={`${warning.code}-${index}`}>
                    <span>
                      {warning.severity === "error"
                        ? "错误"
                        : warning.severity === "warning"
                          ? "注意"
                          : "提示"}
                    </span>
                    <div>
                      {warning.message}
                      <code>{warning.code}</code>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel export-panel">
            <div>
              <span className="eyebrow">BATCH EXPORT</span>
              <h2>导出所选事件</h2>
              <p>
                {batchValidation.valid
                  ? `校验通过，将在一个 ICS 中写入 ${selectedCandidates.length} 个 VEVENT。`
                  : "请至少选择一个有效候选；无效候选不会被静默跳过。"}
              </p>
            </div>
            <div className="actions">
              <button
                onClick={() => void copySummary(selectedCandidates.map((item) => item.draft))}
              >
                复制所选事件摘要
              </button>
              <button className="primary" disabled={!batchValidation.valid} onClick={downloadBatch}>
                下载所选事件 ICS
              </button>
            </div>
          </section>
        </>
      )}

      {event && (
        <>
          <EventEditor
            event={event}
            onChange={updateField}
            onFieldSelect={mode === "image" ? setActiveField : undefined}
          />
          {(event.warnings.length > 0 || validation.length > 0) && (
            <section className="panel warnings" aria-labelledby="warnings-title">
              <div className="section-heading">
                <span className="step">!</span>
                <div>
                  <h2 id="warnings-title">需要确认</h2>
                  <p>导出前请检查这些项目</p>
                </div>
              </div>
              <ul>
                {[
                  ...event.warnings,
                  ...validation.filter(
                    (item) => !event.warnings.some((warning) => warning.code === item.code),
                  ),
                ].map((warning, index) => (
                  <li className={warning.severity} key={`${warning.code}-${index}`}>
                    <span>
                      {warning.severity === "error"
                        ? "错误"
                        : warning.severity === "warning"
                          ? "注意"
                          : "提示"}
                    </span>
                    <div>
                      {warning.message}
                      <code>{warning.code}</code>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <EvidencePanel
            event={event}
            ocrEvidence={singleOcrEvidence}
            activeField={activeField}
            onFieldSelect={mode === "image" ? setActiveField : undefined}
          />
          <section className="panel export-panel">
            <div>
              <span className="eyebrow">READY TO EXPORT</span>
              <h2>导出到你的日历</h2>
              <p>
                {validation.length
                  ? `还有 ${validation.length} 项导出校验未通过。`
                  : "校验通过，可下载标准 ICS 文件。"}
              </p>
            </div>
            <div className="actions">
              <button onClick={() => void copySummary([event])}>复制事件摘要</button>
              <button className="primary" disabled={validation.length > 0} onClick={download}>
                下载 ICS
              </button>
            </div>
          </section>
        </>
      )}
      <footer>
        <span>本地优先 · 无账号 · 无上传 · 不持久化</span>
        <span>Snap2Cal v{APP_VERSION}</span>
      </footer>
    </main>
  );
}
