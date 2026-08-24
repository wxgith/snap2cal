import { useEffect, useRef } from "react";
import type { EditableFieldName, EventDraft } from "../domain/event";
import type { EventCandidateStatus, MultiEventExtractionResult } from "../domain/multiEvent";
import { validateEvent } from "../domain/validation";
import type { CandidateOcrEvidence } from "../ocr/types";
import { EventEditor, EvidencePanel } from "./EventEditor";

const BOUNDARY_LABELS = {
  "blank-line": "空行分组",
  bullet: "项目符号",
  "numbered-item": "编号列表",
  "date-prefix": "日期前缀",
  "time-prefix": "时间前缀",
  "explicit-label": "显式事件标签",
  "shared-context": "共享上下文",
  semicolon: "分号弱边界",
  "single-event-fallback": "单事件回退",
  "manual-merge": "手工合并",
} as const;

const STATUS_LABELS: Record<EventCandidateStatus, string> = {
  detected: "已检测",
  confirmed: "已确认",
  ignored: "已忽略",
  "needs-review": "待确认",
};

interface CandidateReviewProps {
  result: MultiEventExtractionResult;
  evidence?: Record<string, CandidateOcrEvidence>;
  activeCandidateId?: string | null;
  activeField?: EditableFieldName | null;
  canUndoMerge: boolean;
  onChangeField: <K extends EditableFieldName>(
    candidateId: string,
    name: K,
    value: EventDraft[K]["value"],
  ) => void;
  onSetStatus: (candidateId: string, status: EventCandidateStatus) => void;
  onSetSelected: (candidateId: string, selected: boolean) => void;
  onSelectGroup: (selection: "all" | "none" | "valid") => void;
  onFocus: (candidateId: string, field: EditableFieldName | null) => void;
  onMerge: (candidateId: string) => void;
  onUndoMerge: () => void;
  onDownloadOne: (candidateId: string) => void;
  onAppendUnassigned: (candidateId: string, fragmentIndex: number) => void;
  onRedetect: () => void;
  onUseSingle: () => void;
}

export function CandidateReview({
  result,
  evidence,
  activeCandidateId,
  activeField,
  canUndoMerge,
  onChangeField,
  onSetStatus,
  onSetSelected,
  onSelectGroup,
  onFocus,
  onMerge,
  onUndoMerge,
  onDownloadOne,
  onAppendUnassigned,
  onRedetect,
  onUseSingle,
}: CandidateReviewProps) {
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const previousIds = useRef(new Set<string>());

  useEffect(() => {
    const currentIds = new Set(result.candidates.map((candidate) => candidate.id));
    if (
      activeCandidateId &&
      previousIds.current.size > 0 &&
      !previousIds.current.has(activeCandidateId)
    )
      cardRefs.current.get(activeCandidateId)?.focus();
    previousIds.current = currentIds;
  }, [result.candidates, activeCandidateId]);

  const focusCardAfterUpdate = (candidateId: string) => {
    window.setTimeout(() => cardRefs.current.get(candidateId)?.focus(), 0);
  };

  return (
    <>
      <section className="panel candidate-summary" aria-labelledby="candidate-summary-title">
        <div>
          <span className="eyebrow">MULTI-EVENT REVIEW</span>
          <h2 id="candidate-summary-title">发现 {result.detectedCount} 个事件候选</h2>
          <p>
            已选择 {result.selectedCount} 个；未分配文字 {result.unassignedText.length} 段。
          </p>
        </div>
        <div className="actions" aria-label="候选批量操作">
          <button onClick={() => onSelectGroup("all")}>全选</button>
          <button onClick={() => onSelectGroup("none")}>全不选</button>
          <button onClick={() => onSelectGroup("valid")}>只选有效</button>
          <button onClick={onRedetect}>重新检测事件边界</button>
          <button onClick={onUseSingle}>按单事件处理</button>
          {canUndoMerge && <button onClick={onUndoMerge}>撤销最近合并</button>}
        </div>
      </section>

      <div className="candidate-list">
        {result.candidates.map((candidate, index) => {
          const number = index + 1;
          const validation = validateEvent(candidate.draft);
          const candidateEvidence = evidence?.[candidate.id];
          const ignored = candidate.status === "ignored";
          return (
            <article
              className={`candidate-card ${activeCandidateId === candidate.id ? "active" : ""} ${ignored ? "ignored" : ""}`}
              data-testid={`candidate-${number}`}
              key={candidate.id}
              ref={(node) => {
                if (node) cardRefs.current.set(candidate.id, node);
                else cardRefs.current.delete(candidate.id);
              }}
              tabIndex={-1}
              aria-current={activeCandidateId === candidate.id ? "true" : undefined}
            >
              <header className="candidate-card-header">
                <button
                  className="candidate-focus"
                  aria-label={`查看候选 ${number} 原图证据`}
                  onClick={() => onFocus(candidate.id, null)}
                >
                  <strong>候选 {number}</strong>
                  <span>{STATUS_LABELS[candidate.status]}</span>
                </button>
                <label className="candidate-select">
                  <input
                    aria-label={`导出候选 ${number}`}
                    type="checkbox"
                    disabled={ignored}
                    checked={candidate.selectedForExport}
                    onChange={(event) => onSetSelected(candidate.id, event.target.checked)}
                  />
                  导出
                </label>
              </header>
              <div className="candidate-meta">
                <span className={`chip confidence-${candidate.confidence}`}>
                  候选置信度：
                  {candidate.confidence === "high"
                    ? "高"
                    : candidate.confidence === "medium"
                      ? "中"
                      : "低"}
                </span>
                <span className="chip">
                  边界：{BOUNDARY_LABELS[candidate.segment.boundaryReason]}
                </span>
                {candidate.duplicateOf && <span className="chip warning-chip">可能重复</span>}
                {candidate.segment.inheritedContext.date && (
                  <span className="chip default">
                    继承日期：{candidate.segment.inheritedContext.date.value}
                  </span>
                )}
                {candidate.segment.inheritedContext.location && (
                  <span className="chip default">
                    继承地点：{candidate.segment.inheritedContext.location.value}
                  </span>
                )}
              </div>
              <blockquote>{candidate.segment.source.text}</blockquote>
              {candidate.reasons.length > 0 && (
                <p className="candidate-reasons">{candidate.reasons.join("；")}</p>
              )}
              <div className="actions candidate-actions">
                {ignored ? (
                  <button
                    onClick={() => {
                      onSetStatus(candidate.id, "needs-review");
                      focusCardAfterUpdate(candidate.id);
                    }}
                  >
                    恢复候选 {number}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        onSetStatus(candidate.id, "confirmed");
                        focusCardAfterUpdate(candidate.id);
                      }}
                    >
                      确认候选 {number}
                    </button>
                    <button
                      onClick={() => {
                        onSetStatus(candidate.id, "ignored");
                        focusCardAfterUpdate(candidate.id);
                      }}
                    >
                      忽略候选 {number}
                    </button>
                  </>
                )}
                {index < result.candidates.length - 1 && (
                  <button onClick={() => onMerge(candidate.id)}>合并候选 {number} 与下一个</button>
                )}
                <button
                  disabled={validation.length > 0 || ignored}
                  onClick={() => onDownloadOne(candidate.id)}
                >
                  下载候选 {number}
                </button>
              </div>
              {!ignored && (
                <>
                  <EventEditor
                    event={candidate.draft}
                    idPrefix={`candidate-${number}-`}
                    ariaLabelPrefix={`候选 ${number} `}
                    onChange={(name, value) => onChangeField(candidate.id, name, value)}
                    onFieldSelect={(field) => onFocus(candidate.id, field)}
                  />
                  {(candidate.warnings.length > 0 || validation.length > 0) && (
                    <div className="candidate-warnings" role="status">
                      {[...candidate.warnings, ...validation]
                        .filter(
                          (warning, warningIndex, all) =>
                            all.findIndex((item) => item.code === warning.code) === warningIndex,
                        )
                        .map((warning) => (
                          <p key={warning.code} className={warning.severity}>
                            {warning.message} <code>{warning.code}</code>
                          </p>
                        ))}
                    </div>
                  )}
                  <details className="candidate-evidence">
                    <summary>查看候选 {number} 的解析依据</summary>
                    <EvidencePanel
                      event={candidate.draft}
                      idPrefix={`candidate-${number}-`}
                      ocrEvidence={candidateEvidence?.fields}
                      activeField={activeCandidateId === candidate.id ? activeField : null}
                      onFieldSelect={(field) => onFocus(candidate.id, field)}
                    />
                  </details>
                </>
              )}
            </article>
          );
        })}
      </div>

      {result.unassignedText.length > 0 && (
        <section className="panel unassigned" aria-labelledby="unassigned-title">
          <h2 id="unassigned-title">未分配文字</h2>
          <p>这些内容没有被静默丢弃，可追加到任一候选备注。</p>
          {result.unassignedText.map((fragment, fragmentIndex) => (
            <article key={`${fragment.source.startIndex}-${fragment.source.endIndex}`}>
              <blockquote>{fragment.text}</blockquote>
              <div className="actions">
                {result.candidates.map((candidate, candidateIndex) => (
                  <button
                    key={candidate.id}
                    onClick={() => onAppendUnassigned(candidate.id, fragmentIndex)}
                  >
                    追加到候选 {candidateIndex + 1} 备注
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
