import type { EditableFieldName, EventDraft, ExtractedField } from "../domain/event";
import type { OcrEvidence } from "../ocr/types";

interface Props {
  event: EventDraft;
  onChange: <K extends EditableFieldName>(name: K, value: EventDraft[K]["value"]) => void;
  onFieldSelect?: (name: EditableFieldName) => void;
  idPrefix?: string;
  ariaLabelPrefix?: string;
}

const REMINDER_OPTIONS = [
  ["", "不提醒"],
  ["5", "提前 5 分钟"],
  ["10", "提前 10 分钟"],
  ["15", "提前 15 分钟"],
  ["30", "提前 30 分钟"],
  ["60", "提前 1 小时"],
  ["120", "提前 2 小时"],
  ["1440", "提前 1 天"],
  ["custom", "自定义分钟数"],
] as const;

export function EventEditor({
  event,
  onChange,
  onFieldSelect,
  idPrefix = "",
  ariaLabelPrefix = "",
}: Props) {
  const reminder = event.reminderMinutes.value;
  const presetValues = REMINDER_OPTIONS.map(([value]) => value);
  const reminderText = String(reminder);
  const selectValue =
    reminder === null
      ? ""
      : presetValues.some((value) => value === reminderText)
        ? reminderText
        : "custom";

  return (
    <section
      className="panel"
      aria-labelledby={`${idPrefix}editor-title`}
      onFocusCapture={(event) => {
        const field = (event.target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset
          .field as EditableFieldName | undefined;
        if (field) onFieldSelect?.(field);
      }}
    >
      <div className="section-heading">
        <span className="step">02</span>
        <div>
          <h2 id={`${idPrefix}editor-title`}>编辑事件</h2>
          <p>检查并修正识别结果</p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field field-wide" data-field="title">
          事件标题
          <input
            aria-label={`${ariaLabelPrefix}事件标题`}
            value={event.title.value}
            onChange={(e) => onChange("title", e.target.value)}
          />
        </label>
        <label className="field" data-field="startDate">
          开始日期
          <input
            aria-label={`${ariaLabelPrefix}开始日期`}
            type="date"
            value={event.startDate.value ?? ""}
            onChange={(e) => onChange("startDate", e.target.value || null)}
          />
        </label>
        <label className="field" data-field="startTime">
          开始时间
          <input
            aria-label={`${ariaLabelPrefix}开始时间`}
            type="time"
            disabled={event.allDay.value}
            value={event.startTime.value ?? ""}
            onChange={(e) => onChange("startTime", e.target.value || null)}
          />
        </label>
        <label className="field" data-field="endDate">
          结束日期
          <input
            aria-label={`${ariaLabelPrefix}结束日期`}
            type="date"
            value={event.endDate.value ?? ""}
            onChange={(e) => onChange("endDate", e.target.value || null)}
          />
        </label>
        <label className="field" data-field="endTime">
          结束时间
          <input
            aria-label={`${ariaLabelPrefix}结束时间`}
            type="time"
            disabled={event.allDay.value}
            value={event.endTime.value ?? ""}
            onChange={(e) => onChange("endTime", e.target.value || null)}
          />
        </label>
        <label className="toggle field-wide" data-field="allDay">
          <input
            aria-label={`${ariaLabelPrefix}全天事件`}
            type="checkbox"
            checked={event.allDay.value}
            onChange={(e) => onChange("allDay", e.target.checked)}
          />
          <span>全天事件</span>
        </label>
        <label className="field field-wide" data-field="location">
          地点
          <input
            aria-label={`${ariaLabelPrefix}地点`}
            value={event.location.value}
            onChange={(e) => onChange("location", e.target.value)}
          />
        </label>
        <label className="field field-wide" data-field="description">
          备注
          <textarea
            aria-label={`${ariaLabelPrefix}备注`}
            rows={3}
            value={event.description.value}
            onChange={(e) => onChange("description", e.target.value)}
          />
        </label>
        <label className="field" data-field="reminderMinutes">
          提醒时间
          <select
            aria-label={`${ariaLabelPrefix}提醒时间`}
            value={selectValue}
            onChange={(e) => {
              if (e.target.value === "custom") onChange("reminderMinutes", reminder ?? 20);
              else
                onChange("reminderMinutes", e.target.value === "" ? null : Number(e.target.value));
            }}
          >
            {REMINDER_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {selectValue === "custom" && (
          <label className="field" data-field="reminderMinutes">
            自定义分钟数
            <input
              aria-label={`${ariaLabelPrefix}自定义分钟数`}
              type="number"
              min="0"
              value={reminder ?? 0}
              onChange={(e) => onChange("reminderMinutes", Number(e.target.value))}
            />
          </label>
        )}
        <label className="field field-wide" data-field="timeZone">
          时区
          <input
            aria-label={`${ariaLabelPrefix}时区`}
            value={event.timeZone.value}
            onChange={(e) => onChange("timeZone", e.target.value)}
          />
        </label>
      </div>
    </section>
  );
}

const LABELS: Record<EditableFieldName, string> = {
  title: "事件标题",
  startDate: "开始日期",
  startTime: "开始时间",
  endDate: "结束日期",
  endTime: "结束时间",
  location: "地点",
  description: "备注",
  reminderMinutes: "提醒",
  allDay: "全天事件",
  timeZone: "时区",
};
const CONFIDENCE = { high: "高", medium: "中", low: "低" } as const;

function displayValue(field: ExtractedField<unknown>): string {
  if (field.value === null || field.value === "") return "未识别";
  if (typeof field.value === "boolean") return field.value ? "是" : "否";
  return String(field.value);
}

export function EvidencePanel({
  event,
  ocrEvidence,
  activeField,
  onFieldSelect,
  idPrefix = "",
}: {
  event: EventDraft;
  ocrEvidence?: Partial<Record<EditableFieldName, OcrEvidence>>;
  activeField?: EditableFieldName | null;
  onFieldSelect?: (name: EditableFieldName) => void;
  idPrefix?: string;
}) {
  const names = Object.keys(LABELS) as EditableFieldName[];
  return (
    <section className="panel" aria-labelledby={`${idPrefix}evidence-title`}>
      <div className="section-heading">
        <span className="step">03</span>
        <div>
          <h2 id={`${idPrefix}evidence-title`}>解析依据</h2>
          <p>每项结果都可追溯</p>
        </div>
      </div>
      <div className="evidence-list">
        {names.map((name) => {
          const field = event[name] as ExtractedField<unknown>;
          return (
            <article
              className={`evidence ${activeField === name ? "active" : ""}`}
              key={name}
              data-testid={`evidence-${name}`}
              role={onFieldSelect ? "button" : undefined}
              tabIndex={onFieldSelect ? 0 : undefined}
              onClick={() => onFieldSelect?.(name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onFieldSelect?.(name);
              }}
            >
              <div>
                <strong>{LABELS[name]}</strong>
                <span>{displayValue(field)}</span>
              </div>
              <p>
                依据：
                {field.source
                  ? `“${field.source.text}”`
                  : field.derivedFromDefault
                    ? "系统默认"
                    : "无直接原文"}
              </p>
              <div className="chips">
                <span className={`chip confidence-${field.confidence}`}>
                  置信度：{CONFIDENCE[field.confidence]}
                </span>
                {field.manuallyEdited && <span className="chip edited">已手工修改</span>}
                {field.derivedFromDefault && <span className="chip default">含推断/默认值</span>}
                {ocrEvidence && (
                  <span className="chip ocr-confidence">
                    {ocrEvidence[name]?.confidence === null || !ocrEvidence[name]
                      ? "无原图位置依据"
                      : `OCR 置信度：${Math.round((ocrEvidence[name]?.confidence ?? 0) * 100)}%`}
                  </span>
                )}
                {ocrEvidence?.[name]?.containsManualCorrection && (
                  <span className="chip edited">OCR 已人工校对</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
