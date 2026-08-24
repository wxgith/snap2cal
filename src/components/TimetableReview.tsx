import type { TimetableCalendarResult } from "../timetable";
import type { TimetableCourseCell, TimetableExtractionResult } from "../domain/timetable";
import { TIMETABLE_WEEKDAY_LABELS } from "../domain/timetable";

interface TimetableReviewProps {
  input: string;
  result: TimetableExtractionResult | null;
  calendar: TimetableCalendarResult;
  semesterStartDate: string;
  weekCount: number;
  timeZone: string;
  canUseOcr: boolean;
  onInputChange: (value: string) => void;
  onSemesterStartDateChange: (value: string) => void;
  onWeekCountChange: (value: number) => void;
  onTimeZoneChange: (value: string) => void;
  onParseText: () => void;
  onParseOcr: () => void;
  onClear: () => void;
  onUpdateCell: (
    cellId: string,
    patch: Partial<Pick<TimetableCourseCell, "title" | "location">>,
  ) => void;
  onToggleCell: (cellId: string, selected: boolean) => void;
  onFocusCell: (cellId: string) => void;
  onDownload: () => void;
}

function weekRangeText(cell: TimetableCourseCell, weekCount: number): string {
  if (!cell.weekRanges.length) return `未识别，导出时按 1-${weekCount} 周提示确认`;
  return cell.weekRanges
    .map((range) => {
      const end = range.endWeek ?? weekCount;
      const base = range.startWeek === end ? `${range.startWeek}周` : `${range.startWeek}-${end}周`;
      if (range.parity === "odd") return `${base}单周`;
      if (range.parity === "even") return `${base}双周`;
      return base;
    })
    .join("、");
}

function warningLabel(severity: string): string {
  if (severity === "error") return "错误";
  if (severity === "warning") return "注意";
  return "提示";
}

export function TimetableReview({
  input,
  result,
  calendar,
  semesterStartDate,
  weekCount,
  timeZone,
  canUseOcr,
  onInputChange,
  onSemesterStartDateChange,
  onWeekCountChange,
  onTimeZoneChange,
  onParseText,
  onParseOcr,
  onClear,
  onUpdateCell,
  onToggleCell,
  onFocusCell,
  onDownload,
}: TimetableReviewProps) {
  return (
    <>
      <section className="panel timetable-panel" aria-labelledby="timetable-title">
        <div className="section-heading">
          <span className="step">T</span>
          <div>
            <h2 id="timetable-title">课程表导入</h2>
            <p>按星期列和节次行生成学期日历事件</p>
          </div>
        </div>
        <div className="timetable-settings">
          <label className="field">
            第 1 周周一日期
            <input
              aria-label="第 1 周周一日期"
              type="date"
              value={semesterStartDate}
              onChange={(event) => onSemesterStartDateChange(event.target.value)}
            />
          </label>
          <label className="field">
            学期周数
            <input
              aria-label="学期周数"
              type="number"
              min={1}
              max={60}
              value={weekCount}
              onChange={(event) => onWeekCountChange(Number(event.target.value))}
            />
          </label>
          <label className="field">
            时区
            <input
              aria-label="课程表时区"
              value={timeZone}
              onChange={(event) => onTimeZoneChange(event.target.value)}
            />
          </label>
        </div>
        <textarea
          aria-label="课程表文本"
          className="source-input"
          rows={7}
          placeholder="例如：| 周一 | 周二 | 周三 |&#10;1-2节 08:00-09:40 | 高等数学@A101[1-16周] | 英语@B202[1-8周] |&#10;3-4节 10:00-11:40 | | 程序设计@机房[1-16周] |"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
        />
        <div className="actions">
          <button className="primary" onClick={onParseText}>
            解析课程表文本
          </button>
          <button disabled={!canUseOcr} onClick={onParseOcr}>
            从当前 OCR 图片二维识别
          </button>
          <button className="ghost" onClick={onClear}>
            清空课程表
          </button>
        </div>
      </section>

      {result && (
        <>
          <section className="panel timetable-summary" aria-labelledby="timetable-summary-title">
            <div>
              <span className="eyebrow">TIMETABLE REVIEW</span>
              <h2 id="timetable-summary-title">发现 {result.detectedCount} 个课程单元格</h2>
              <p>
                已选择 {result.selectedCount} 个；当前预览 {calendar.events.length} 个日历事件。
              </p>
            </div>
          </section>

          <div className="timetable-list">
            {result.cells.map((cell, index) => {
              const number = index + 1;
              return (
                <article className="timetable-cell" key={cell.id} data-testid={`course-${number}`}>
                  <header>
                    <button
                      className="candidate-focus"
                      onClick={() => onFocusCell(cell.id)}
                      aria-label={`查看课程 ${number} 原图证据`}
                    >
                      <strong>课程 {number}</strong>
                      <span>
                        {TIMETABLE_WEEKDAY_LABELS[cell.weekday]} · {cell.period.label}
                      </span>
                    </button>
                    <label className="candidate-select">
                      <input
                        aria-label={`导出课程 ${number}`}
                        type="checkbox"
                        checked={cell.selectedForExport}
                        onChange={(event) => onToggleCell(cell.id, event.target.checked)}
                      />
                      导出
                    </label>
                  </header>
                  <div className="candidate-meta">
                    <span className={`chip confidence-${cell.confidence}`}>
                      课程置信度：
                      {cell.confidence === "high"
                        ? "高"
                        : cell.confidence === "medium"
                          ? "中"
                          : "低"}
                    </span>
                    <span className="chip">
                      {cell.period.startTime ?? "缺少开始时间"} -{" "}
                      {cell.period.endTime ?? "缺少结束时间"}
                    </span>
                    <span className="chip default">{weekRangeText(cell, weekCount)}</span>
                  </div>
                  <div className="form-grid timetable-fields">
                    <label className="field">
                      课程名称
                      <input
                        aria-label={`课程 ${number} 名称`}
                        value={cell.title}
                        onChange={(event) => onUpdateCell(cell.id, { title: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      地点
                      <input
                        aria-label={`课程 ${number} 地点`}
                        value={cell.location}
                        onChange={(event) =>
                          onUpdateCell(cell.id, { location: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <blockquote>{cell.source.text}</blockquote>
                  {cell.warnings.length > 0 && (
                    <div className="candidate-warnings" role="status">
                      {cell.warnings.map((warning) => (
                        <p className={warning.severity} key={warning.code}>
                          {warning.message} <code>{warning.code}</code>
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {(result.warnings.length > 0 || calendar.warnings.length > 0) && (
            <section className="panel warnings" aria-labelledby="timetable-warnings-title">
              <div className="section-heading">
                <span className="step">!</span>
                <div>
                  <h2 id="timetable-warnings-title">课程表提示</h2>
                  <p>所有推断、缺失和错误都会在这里显示</p>
                </div>
              </div>
              <ul>
                {[...result.warnings, ...calendar.warnings].map((warning, index) => (
                  <li className={warning.severity} key={`${warning.code}-${index}`}>
                    <span>{warningLabel(warning.severity)}</span>
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
              <span className="eyebrow">SEMESTER EXPORT</span>
              <h2>导出课程表 ICS</h2>
              <p>
                {calendar.valid
                  ? `校验通过，将写入 ${calendar.events.length} 个 VEVENT。`
                  : "请补齐第 1 周日期、节次时间，并确认至少一个有效课程。"}
              </p>
            </div>
            <div className="actions">
              <button className="primary" disabled={!calendar.valid} onClick={onDownload}>
                下载课程表 ICS
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}
