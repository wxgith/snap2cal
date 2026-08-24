import { useEffect, useMemo, useRef, useState } from "react";
import type { NormalizedImage } from "../image/image";
import type { EventDraft } from "../domain/event";
import type { OcrDocument } from "../ocr/types";
import {
  SCHEDULE_WEEKDAYS,
  SCHEDULE_WEEKDAY_LABELS,
  addGridLine,
  applyHeaderMappingRoles,
  assignOcrBlocksToGridCellsDetailed,
  buildCourseTemplates,
  buildGridCells,
  createAllWeeksPattern,
  createScheduleTimeSlots,
  detectScheduleHeaders,
  generateCourseOccurrences,
  mergeVerticalCourseCells,
  moveGridLine,
  parseWeekPattern,
  removeGridLine,
  selectScheduleEventsForExport,
  sortGridLines,
  toggleGridLineLock,
  validateGrid,
  validateScheduleTimeSlots,
  validateWeekdayMappings,
  type CourseTemplate,
  type GridCell,
  type GridDetectionProgress,
  type GridDetector,
  type GridLine,
  type ScheduleConfig,
  type ScheduleHeaderMapping,
  type ScheduleTimeSlot,
  type ScheduleWarning,
  type ScheduleWeekday,
  type TableGrid,
} from "../schedule-table";
import { normalizedBlobToImageData } from "../schedule-table/imageData";
import {
  ImageOcrWorkspace,
  type ImageNormalizer,
  type OcrAdapterFactory,
} from "./ImageOcrWorkspace";
import { ScheduleGridOverlay } from "./ScheduleGridOverlay";

export interface ScheduleTableWorkspaceProps {
  hidden?: boolean;
  ocrAdapterFactory?: OcrAdapterFactory;
  imageNormalizer?: ImageNormalizer;
  gridDetectorFactory?: () => Promise<GridDetector>;
  imageDataLoader?: typeof normalizedBlobToImageData;
  onDownload: (events: EventDraft[], filename: string) => void;
  onMessage: (message: string) => void;
}

async function defaultGridDetectorFactory(): Promise<GridDetector> {
  if (
    import.meta.env.VITE_SNAP2CAL_MOCK_OCR === "true" &&
    new URLSearchParams(window.location.search).get("mockOcr") === "schedule" &&
    !new URLSearchParams(window.location.search).has("realGrid")
  ) {
    const { MockGridDetector } = await import("../schedule-table/MockGridDetector");
    const offset = new URLSearchParams(window.location.search).has("scheduleOffset");
    return new MockGridDetector(offset ? { horizontalPositions: [0, 55, 130, 185] } : {});
  }
  const { ProjectionGridDetector } = await import("../schedule-table/ProjectionGridDetector");
  return new ProjectionGridDetector();
}

function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function defaultConfig(): ScheduleConfig {
  return {
    weekOneMonday: null,
    totalWeeks: 16,
    timeZone: detectTimeZone(),
    defaultReminderMinutes: null,
    defaultWeekPattern: createAllWeeksPattern(16),
  };
}

function editableGrid(grid: TableGrid): TableGrid {
  const staleCodes = new Set([
    "GRID_NOT_DETECTED",
    "GRID_TOO_FEW_ROWS",
    "GRID_TOO_FEW_COLUMNS",
    "GRID_DUPLICATE_LINE",
    "GRID_CELL_TOO_SMALL",
  ]);
  const next = {
    ...grid,
    horizontalLines: sortGridLines(grid.horizontalLines),
    verticalLines: sortGridLines(grid.verticalLines),
    warnings: grid.warnings.filter((item) => !staleCodes.has(item.code)),
  };
  return { ...next, warnings: [...next.warnings, ...validateGrid(next)] };
}

function largestGapPosition(lines: GridLine[], limit: number): number {
  const positions = [0, ...sortGridLines(lines).map((line) => line.position), limit];
  let bestStart = 0;
  let bestGap = -1;
  for (let index = 1; index < positions.length; index += 1) {
    const gap = positions[index] - positions[index - 1];
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = positions[index - 1];
    }
  }
  return bestStart + bestGap / 2;
}

function dedupeWarnings(warnings: ScheduleWarning[]): ScheduleWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.scope}:${warning.targetId ?? ""}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function warningText(warning: ScheduleWarning): string {
  return `${warning.message} (${warning.code})`;
}

export default function ScheduleTableWorkspace({
  hidden = false,
  ocrAdapterFactory,
  imageNormalizer,
  gridDetectorFactory = defaultGridDetectorFactory,
  imageDataLoader = normalizedBlobToImageData,
  onDownload,
  onMessage,
}: ScheduleTableWorkspaceProps) {
  const [image, setImage] = useState<NormalizedImage | null>(null);
  const [document, setDocument] = useState<OcrDocument | null>(null);
  const [grid, setGrid] = useState<TableGrid | null>(null);
  const [detectedGrid, setDetectedGrid] = useState<TableGrid | null>(null);
  const [gridConfirmed, setGridConfirmed] = useState(false);
  const [headerConfirmed, setHeaderConfirmed] = useState(false);
  const [cells, setCells] = useState<GridCell[]>([]);
  const [headerMapping, setHeaderMapping] = useState<ScheduleHeaderMapping>({
    weekdayHeaderRowIndex: null,
    timeHeaderColumnIndex: null,
    weekdayMappings: [],
    manuallyConfirmed: false,
  });
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [config, setConfig] = useState<ScheduleConfig>(defaultConfig);
  const [excludedOccurrenceIds, setExcludedOccurrenceIds] = useState<Set<string>>(new Set());
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [selectedCellIds, setSelectedCellIds] = useState<Set<string>>(new Set());
  const [mergeSnapshot, setMergeSnapshot] = useState<GridCell[] | null>(null);
  const [progress, setProgress] = useState<GridDetectionProgress | null>(null);
  const [localWarnings, setLocalWarnings] = useState<ScheduleWarning[]>([]);
  const detectionAbortRef = useRef<AbortController | null>(null);
  const detectionTaskRef = useRef(0);

  const occurrenceResult = useMemo(
    () => generateCourseOccurrences(templates, config, excludedOccurrenceIds),
    [templates, config, excludedOccurrenceIds],
  );
  const exportSelection = useMemo(
    () => selectScheduleEventsForExport(occurrenceResult.occurrences),
    [occurrenceResult.occurrences],
  );
  const displayedCells = useMemo(
    () => (grid ? (cells.length ? cells : buildGridCells(grid)) : []),
    [grid, cells],
  );
  const allWarnings = useMemo(
    () =>
      dedupeWarnings([
        ...(grid?.warnings ?? []),
        ...localWarnings,
        ...validateWeekdayMappings(
          headerMapping.weekdayMappings,
          Math.max(0, ...displayedCells.map((cell) => cell.columnIndex + 1)),
        ),
        ...(headerMapping.timeHeaderColumnIndex === null
          ? [
              {
                code: "TIME_HEADER_NOT_FOUND" as const,
                message: "请指定时间或节次标题列。",
                severity: "error" as const,
                scope: "grid" as const,
              },
            ]
          : []),
        ...validateScheduleTimeSlots(timeSlots),
        ...templates.flatMap((template) => template.warnings),
        ...occurrenceResult.warnings,
        ...exportSelection.warnings,
      ]),
    [
      grid,
      localWarnings,
      headerMapping,
      displayedCells,
      timeSlots,
      templates,
      occurrenceResult,
      exportSelection,
    ],
  );

  useEffect(
    () => () => {
      detectionTaskRef.current += 1;
      detectionAbortRef.current?.abort();
    },
    [],
  );

  const clearSemanticState = () => {
    setGridConfirmed(false);
    setHeaderConfirmed(false);
    setCells([]);
    setHeaderMapping({
      weekdayHeaderRowIndex: null,
      timeHeaderColumnIndex: null,
      weekdayMappings: [],
      manuallyConfirmed: false,
    });
    setTimeSlots([]);
    setTemplates([]);
    setExcludedOccurrenceIds(new Set());
    setSelectedCellIds(new Set());
    setMergeSnapshot(null);
    setLocalWarnings([]);
  };

  const clearDetection = () => {
    detectionTaskRef.current += 1;
    detectionAbortRef.current?.abort();
    detectionAbortRef.current = null;
    setGrid(null);
    setDetectedGrid(null);
    setSelectedLineId(null);
    setProgress(null);
    clearSemanticState();
  };

  const assignCells = (nextGrid: TableGrid, nextDocument = document) => {
    if (!nextDocument) {
      setCells(buildGridCells(nextGrid));
      return;
    }
    const assignment = assignOcrBlocksToGridCellsDetailed(nextDocument, nextGrid);
    const headers = detectScheduleHeaders(assignment.cells);
    setCells(headers.cells);
    setHeaderMapping(headers.mapping);
    setTimeSlots(
      createScheduleTimeSlots(
        headers.cells,
        headers.mapping.timeHeaderColumnIndex,
        headers.mapping.weekdayHeaderRowIndex,
      ),
    );
    setLocalWarnings([...assignment.warnings, ...headers.warnings]);
  };

  const invalidateGeneratedState = () => {
    setHeaderConfirmed(false);
    setTemplates([]);
    setExcludedOccurrenceIds(new Set());
  };

  const updateGrid = (next: TableGrid) => {
    const validated = editableGrid(next);
    setGrid(validated);
    setGridConfirmed(false);
    assignCells(validated);
    invalidateGeneratedState();
    setSelectedCellIds(new Set());
    setMergeSnapshot(null);
  };

  const detectGrid = async () => {
    if (!image || !document) {
      onMessage("请先上传课程表并完成本地 OCR。");
      return;
    }
    detectionTaskRef.current += 1;
    const taskId = detectionTaskRef.current;
    detectionAbortRef.current?.abort();
    const controller = new AbortController();
    detectionAbortRef.current = controller;
    clearSemanticState();
    try {
      const [detector, imageData] = await Promise.all([
        gridDetectorFactory(),
        imageDataLoader(image.blob, image.width, image.height),
      ]);
      if (taskId !== detectionTaskRef.current) return;
      const detected = editableGrid(
        await detector.detect(imageData, {
          signal: controller.signal,
          onProgress: (next) => {
            if (taskId === detectionTaskRef.current) setProgress(next);
          },
        }),
      );
      if (taskId !== detectionTaskRef.current) return;
      setGrid(detected);
      setDetectedGrid(detected);
      assignCells(detected, document);
      setSelectedLineId(detected.horizontalLines[0]?.id ?? detected.verticalLines[0]?.id ?? null);
      onMessage("网格检测完成，请检查并确认网格线。");
    } catch (error) {
      if (controller.signal.aborted || taskId !== detectionTaskRef.current) return;
      onMessage(error instanceof Error ? error.message : "课程表网格检测失败。");
    }
  };

  const setManualHeaderMapping = (next: ScheduleHeaderMapping) => {
    const mapped = { ...next, manuallyConfirmed: false };
    const roleCells = applyHeaderMappingRoles(cells, mapped);
    setHeaderMapping(mapped);
    setCells(roleCells);
    setTimeSlots(
      createScheduleTimeSlots(
        roleCells,
        mapped.timeHeaderColumnIndex,
        mapped.weekdayHeaderRowIndex,
      ),
    );
    invalidateGeneratedState();
  };

  const confirmHeadersAndTimes = (): boolean => {
    if (!gridConfirmed) {
      onMessage("请先确认网格。");
      return false;
    }
    const mappingWarnings = validateWeekdayMappings(
      headerMapping.weekdayMappings,
      Math.max(0, ...cells.map((cell) => cell.columnIndex + 1)),
    );
    const slotWarnings = validateScheduleTimeSlots(timeSlots);
    if (
      headerMapping.timeHeaderColumnIndex === null ||
      [...mappingWarnings, ...slotWarnings].some((item) => item.severity === "error")
    ) {
      setLocalWarnings((current) =>
        dedupeWarnings([...current, ...mappingWarnings, ...slotWarnings]),
      );
      onMessage("请先完成星期列和每行实际时间的校正。");
      return false;
    }
    const confirmedMapping = {
      ...headerMapping,
      manuallyConfirmed: true,
      weekdayMappings: headerMapping.weekdayMappings.map((mapping) => ({
        ...mapping,
        manuallyConfirmed: true,
      })),
    };
    setHeaderMapping(confirmedMapping);
    setHeaderConfirmed(true);
    onMessage("表头和时间已确认。现在可以生成课程模板。");
    return true;
  };

  const generateTemplates = () => {
    if (!headerConfirmed) {
      onMessage("请先点击“确认表头和时间”。");
      return;
    }
    const result = buildCourseTemplates({
      cells,
      weekdayMappings: headerMapping.weekdayMappings,
      timeSlots,
      totalWeeks: config.totalWeeks,
      defaultWeekPattern: config.defaultWeekPattern,
    });
    setTemplates(result.templates);
    setExcludedOccurrenceIds(new Set());
    setLocalWarnings((current) => dedupeWarnings([...current, ...result.warnings]));
    onMessage(`已生成 ${result.templates.length} 个课程模板。`);
  };

  const updateTemplate = (templateId: string, patch: Partial<CourseTemplate>) => {
    setTemplates((current) =>
      current.map((template) =>
        template.id === templateId ? { ...template, ...patch } : template,
      ),
    );
  };

  const selectedLine = grid
    ? [...grid.horizontalLines, ...grid.verticalLines].find((line) => line.id === selectedLineId)
    : undefined;
  const rowCount = grid ? Math.max(0, grid.horizontalLines.length - 1) : 0;
  const columnCount = grid ? Math.max(0, grid.verticalLines.length - 1) : 0;

  return (
    <div hidden={hidden} aria-hidden={hidden || undefined} className="schedule-workspace">
      <ImageOcrWorkspace
        adapterFactory={ocrAdapterFactory}
        imageNormalizer={imageNormalizer}
        document={document}
        onDocumentChange={(next) => {
          setDocument(next);
          if (!next) {
            clearDetection();
            return;
          }
          if (grid) {
            assignCells(grid, next);
            invalidateGeneratedState();
          }
        }}
        onNormalizedImageChange={(next) => {
          setImage(next);
          clearDetection();
        }}
        onRecognitionStart={clearDetection}
        onParse={() => undefined}
        hasEvent={false}
        enableEventParsing={false}
        showOcrBoxes
        headingId="schedule-image-title"
        title="导入课程表截图"
        description="单张 PNG、JPEG 或 WebP；图片和课程信息只在当前浏览器内存中处理"
        overlay={
          <ScheduleGridOverlay
            grid={grid}
            cells={displayedCells}
            selectedLineId={selectedLineId}
            selectedCellIds={selectedCellIds}
            onSelectLine={setSelectedLineId}
            onMoveLine={(lineId, position) =>
              grid && updateGrid(moveGridLine(grid, lineId, position))
            }
            onToggleCell={(cellId) =>
              setSelectedCellIds((current) => {
                const next = new Set(current);
                if (next.has(cellId)) next.delete(cellId);
                else next.add(cellId);
                return next;
              })
            }
          />
        }
      />

      <section className="panel schedule-grid-panel" aria-labelledby="schedule-grid-title">
        <div className="section-heading">
          <span className="step">02</span>
          <div>
            <h2 id="schedule-grid-title">检测并校正网格</h2>
            <p>网格线保存规范化图片自然坐标；拖动不会重新执行 OCR</p>
          </div>
        </div>
        <div className="schedule-toolbar" role="toolbar" aria-label="网格线工具">
          <button
            className="primary"
            disabled={!document || !image}
            onClick={() => void detectGrid()}
          >
            检测课程表
          </button>
          <button
            disabled={!grid}
            onClick={() =>
              grid &&
              updateGrid(
                addGridLine(
                  grid,
                  "horizontal",
                  largestGapPosition(grid.horizontalLines, grid.imageHeight),
                ),
              )
            }
          >
            添加水平线
          </button>
          <button
            disabled={!grid}
            onClick={() =>
              grid &&
              updateGrid(
                addGridLine(
                  grid,
                  "vertical",
                  largestGapPosition(grid.verticalLines, grid.imageWidth),
                ),
              )
            }
          >
            添加垂直线
          </button>
          <button
            disabled={!grid || !selectedLine || selectedLine.locked}
            onClick={() =>
              grid && selectedLineId && updateGrid(removeGridLine(grid, selectedLineId))
            }
          >
            删除选中线
          </button>
          <button
            disabled={!grid || !selectedLineId}
            onClick={() =>
              grid && selectedLineId && updateGrid(toggleGridLineLock(grid, selectedLineId))
            }
          >
            {selectedLine?.locked ? "解锁选中线" : "锁定选中线"}
          </button>
          <button
            disabled={!detectedGrid}
            onClick={() => {
              if (!detectedGrid) return;
              clearSemanticState();
              setGrid(editableGrid(detectedGrid));
              assignCells(detectedGrid);
              onMessage("已恢复自动检测网格。");
            }}
          >
            恢复自动检测
          </button>
        </div>
        {selectedLine && (
          <div className="schedule-line-adjust" aria-label="网格线微调">
            <strong>
              当前{selectedLine.orientation === "horizontal" ? "水平" : "垂直"}线：
              {Math.round(selectedLine.position)} px
            </strong>
            {[-10, -1, 1, 10].map((amount) => (
              <button
                key={amount}
                disabled={selectedLine.locked}
                aria-label={`网格线${amount > 0 ? "增加" : "减少"} ${Math.abs(amount)} 像素`}
                onClick={() =>
                  updateGrid(moveGridLine(grid!, selectedLine.id, selectedLine.position + amount))
                }
              >
                {amount > 0 ? `+${amount}` : amount}
              </button>
            ))}
          </div>
        )}
        {progress && (
          <div
            className="ocr-progress"
            role="progressbar"
            aria-label="课程表网格检测进度"
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
        {grid && (
          <div className="schedule-grid-summary">
            <span>水平线 {grid.horizontalLines.length}</span>
            <span>垂直线 {grid.verticalLines.length}</span>
            <span>网格置信度 {Math.round(grid.confidence * 100)}%</span>
            <span>单元格 {displayedCells.length}</span>
            <button
              className="primary"
              disabled={validateGrid(grid).some((item) => item.severity === "error")}
              onClick={() => {
                setGridConfirmed(true);
                onMessage("网格已人工确认。请继续校正星期列和实际时间。");
              }}
            >
              {gridConfirmed ? "网格已确认" : "确认网格"}
            </button>
          </div>
        )}
      </section>

      {gridConfirmed && (
        <section className="panel schedule-mapping-panel" aria-labelledby="schedule-mapping-title">
          <div className="section-heading">
            <span className="step">03</span>
            <div>
              <h2 id="schedule-mapping-title">星期、时间与课程单元格</h2>
              <p>节次标签不等于实际时间；每行时间必须由图片识别或人工填写</p>
            </div>
          </div>
          <div className="schedule-mapping-controls">
            <label className="field">
              星期标题行
              <select
                aria-label="星期标题行"
                value={headerMapping.weekdayHeaderRowIndex ?? ""}
                onChange={(event) =>
                  setManualHeaderMapping({
                    ...headerMapping,
                    weekdayHeaderRowIndex:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">请选择</option>
                {Array.from({ length: rowCount }, (_, index) => (
                  <option key={index} value={index}>
                    第 {index + 1} 行
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              时间或节次标题列
              <select
                aria-label="时间或节次标题列"
                value={headerMapping.timeHeaderColumnIndex ?? ""}
                onChange={(event) =>
                  setManualHeaderMapping({
                    ...headerMapping,
                    timeHeaderColumnIndex:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">请选择</option>
                {Array.from({ length: columnCount }, (_, index) => (
                  <option key={index} value={index}>
                    第 {index + 1} 列
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="schedule-weekday-map" aria-label="星期列映射">
            {Array.from({ length: columnCount }, (_, columnIndex) => {
              if (columnIndex === headerMapping.timeHeaderColumnIndex) return null;
              const current = headerMapping.weekdayMappings.find(
                (item) => item.columnIndex === columnIndex,
              );
              return (
                <label className="field" key={columnIndex}>
                  第 {columnIndex + 1} 列
                  <select
                    aria-label={`第 ${columnIndex + 1} 列星期`}
                    value={current?.weekday ?? ""}
                    onChange={(event) => {
                      const without = headerMapping.weekdayMappings.filter(
                        (item) => item.columnIndex !== columnIndex,
                      );
                      const weekday = event.target.value as ScheduleWeekday | "";
                      const sourceCellId =
                        cells.find(
                          (cell) =>
                            cell.columnIndex === columnIndex &&
                            cell.rowIndex === headerMapping.weekdayHeaderRowIndex,
                        )?.id ?? `manual-header-${columnIndex}`;
                      setManualHeaderMapping({
                        ...headerMapping,
                        weekdayMappings: weekday
                          ? [
                              ...without,
                              { columnIndex, weekday, sourceCellId, manuallyConfirmed: true },
                            ]
                          : without,
                      });
                    }}
                  >
                    <option value="">非星期列</option>
                    {SCHEDULE_WEEKDAYS.map((weekday) => (
                      <option key={weekday} value={weekday}>
                        {SCHEDULE_WEEKDAY_LABELS[weekday]}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="schedule-time-slots">
            <h3>每行实际时间</h3>
            {timeSlots.map((slot) => (
              <div className="schedule-time-row" key={slot.rowIndex}>
                <label className="field">
                  行标签
                  <input
                    aria-label={`第 ${slot.rowIndex + 1} 行标签`}
                    value={slot.label}
                    onChange={(event) => {
                      setTimeSlots((current) =>
                        current.map((item) =>
                          item.rowIndex === slot.rowIndex
                            ? { ...item, label: event.target.value, manuallyEdited: true }
                            : item,
                        ),
                      );
                      invalidateGeneratedState();
                    }}
                  />
                </label>
                <label className="field">
                  开始时间
                  <input
                    aria-label={`第 ${slot.rowIndex + 1} 行开始时间`}
                    type="time"
                    value={slot.startTime ?? ""}
                    onChange={(event) => {
                      setTimeSlots((current) =>
                        current.map((item) =>
                          item.rowIndex === slot.rowIndex
                            ? {
                                ...item,
                                startTime: event.target.value || null,
                                manuallyEdited: true,
                              }
                            : item,
                        ),
                      );
                      invalidateGeneratedState();
                    }}
                  />
                </label>
                <label className="field">
                  结束时间
                  <input
                    aria-label={`第 ${slot.rowIndex + 1} 行结束时间`}
                    type="time"
                    value={slot.endTime ?? ""}
                    onChange={(event) => {
                      setTimeSlots((current) =>
                        current.map((item) =>
                          item.rowIndex === slot.rowIndex
                            ? { ...item, endTime: event.target.value || null, manuallyEdited: true }
                            : item,
                        ),
                      );
                      invalidateGeneratedState();
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="schedule-cell-list">
            <h3>课程单元格</h3>
            {cells
              .filter(
                (cell) =>
                  headerMapping.weekdayMappings.some(
                    (mapping) => mapping.columnIndex === cell.columnIndex,
                  ) && cell.rowIndex !== headerMapping.weekdayHeaderRowIndex,
              )
              .map((cell) => (
                <article
                  className={`schedule-cell-editor ${selectedCellIds.has(cell.id) ? "selected" : ""}`}
                  key={cell.id}
                >
                  <label className="toggle">
                    <input
                      aria-label={`选择课程单元格 ${cell.rowIndex + 1}-${cell.columnIndex + 1}`}
                      type="checkbox"
                      checked={selectedCellIds.has(cell.id)}
                      onChange={() =>
                        setSelectedCellIds((current) => {
                          const next = new Set(current);
                          if (next.has(cell.id)) next.delete(cell.id);
                          else next.add(cell.id);
                          return next;
                        })
                      }
                    />
                    第 {cell.rowIndex + 1} 行 /{" "}
                    {
                      SCHEDULE_WEEKDAY_LABELS[
                        headerMapping.weekdayMappings.find(
                          (mapping) => mapping.columnIndex === cell.columnIndex,
                        )!.weekday
                      ]
                    }
                  </label>
                  <label className="field">
                    单元格角色
                    <select
                      aria-label={`单元格 ${cell.rowIndex + 1}-${cell.columnIndex + 1} 角色`}
                      value={cell.role}
                      onChange={(event) => {
                        setCells((current) =>
                          current.map((item) =>
                            item.id === cell.id
                              ? { ...item, role: event.target.value as GridCell["role"] }
                              : item,
                          ),
                        );
                        invalidateGeneratedState();
                      }}
                    >
                      <option value="unknown">空白/未知</option>
                      <option value="course">课程</option>
                      <option value="ignored">忽略</option>
                    </select>
                  </label>
                  <label className="field field-wide">
                    单元格文字
                    <textarea
                      aria-label={`课程单元格 ${cell.rowIndex + 1}-${cell.columnIndex + 1} 文字`}
                      rows={3}
                      value={cell.text}
                      onChange={(event) => {
                        setCells((current) =>
                          current.map((item) =>
                            item.id === cell.id
                              ? { ...item, text: event.target.value, manuallyEdited: true }
                              : item,
                          ),
                        );
                        invalidateGeneratedState();
                      }}
                    />
                  </label>
                  <small>OCR 原文：{cell.originalText || "（空）"}</small>
                  {cell.manuallyEdited && <span className="chip edited">已手工修改</span>}
                  {cell.manuallyMerged && (
                    <span className="chip default">纵向合并 {cell.rowSpan} 行</span>
                  )}
                  <button
                    onClick={() => {
                      setCells((current) =>
                        current.map((item) =>
                          item.id === cell.id
                            ? {
                                ...item,
                                role:
                                  item.role === "ignored"
                                    ? item.text.trim()
                                      ? "course"
                                      : "unknown"
                                    : "ignored",
                              }
                            : item,
                        ),
                      );
                      invalidateGeneratedState();
                    }}
                  >
                    {cell.role === "ignored" ? "恢复课程格" : "忽略课程格"}
                  </button>
                </article>
              ))}
          </div>
          <div className="actions">
            <button
              disabled={selectedCellIds.size < 2}
              onClick={() => {
                try {
                  setMergeSnapshot(cells);
                  setCells(mergeVerticalCourseCells(cells, [...selectedCellIds]));
                  setSelectedCellIds(new Set());
                  invalidateGeneratedState();
                  onMessage("已纵向合并课程单元格。");
                } catch (error) {
                  onMessage(error instanceof Error ? error.message : "课程单元格合并失败。");
                }
              }}
            >
              合并课程单元格
            </button>
            <button
              disabled={!mergeSnapshot}
              onClick={() => {
                if (!mergeSnapshot) return;
                setCells(mergeSnapshot);
                setMergeSnapshot(null);
                setSelectedCellIds(new Set());
                invalidateGeneratedState();
                onMessage("已撤销最近一次课程合并。");
              }}
            >
              撤销合并
            </button>
            <button className="primary" onClick={() => void confirmHeadersAndTimes()}>
              {headerConfirmed ? "表头和时间已确认" : "确认表头和时间"}
            </button>
          </div>
        </section>
      )}

      {gridConfirmed && (
        <section className="panel schedule-config-panel" aria-labelledby="schedule-config-title">
          <div className="section-heading">
            <span className="step">04</span>
            <div>
              <h2 id="schedule-config-title">教学周与导出设置</h2>
              <p>日期锚点必须是第一教学周的星期一，不使用当前日期推断</p>
            </div>
          </div>
          <div className="schedule-config-grid">
            <label className="field">
              第一教学周的星期一日期
              <input
                aria-label="第一教学周的星期一日期"
                type="date"
                value={config.weekOneMonday ?? ""}
                onChange={(event) => {
                  setConfig((current) => ({
                    ...current,
                    weekOneMonday: event.target.value || null,
                  }));
                  setExcludedOccurrenceIds(new Set());
                }}
              />
            </label>
            <label className="field">
              本学期总周数
              <input
                aria-label="本学期总周数"
                type="number"
                min={1}
                max={30}
                value={config.totalWeeks}
                onChange={(event) => {
                  const totalWeeks = Number(event.target.value);
                  setConfig((current) => {
                    const expression =
                      current.defaultWeekPattern.kind === "odd"
                        ? "单周"
                        : current.defaultWeekPattern.kind === "even"
                          ? "双周"
                          : current.defaultWeekPattern.kind === "explicit"
                            ? (current.defaultWeekPattern.originalExpression ?? "")
                            : "每周";
                    return {
                      ...current,
                      totalWeeks,
                      defaultWeekPattern: parseWeekPattern(expression, totalWeeks).pattern,
                    };
                  });
                  setTemplates([]);
                  setExcludedOccurrenceIds(new Set());
                }}
              />
            </label>
            <label className="field">
              时区
              <input
                aria-label="课程表时区"
                value={config.timeZone}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, timeZone: event.target.value }))
                }
              />
            </label>
            <label className="field">
              默认提醒（分钟）
              <input
                aria-label="课程表默认提醒"
                type="number"
                min={0}
                value={config.defaultReminderMinutes ?? ""}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    defaultReminderMinutes:
                      event.target.value === "" ? null : Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="field">
              未写周次时的默认值
              <select
                aria-label="默认上课周次"
                value={config.defaultWeekPattern.kind}
                onChange={(event) => {
                  const expression =
                    event.target.value === "odd"
                      ? "单周"
                      : event.target.value === "even"
                        ? "双周"
                        : event.target.value === "explicit"
                          ? ""
                          : "每周";
                  setConfig((current) => ({
                    ...current,
                    defaultWeekPattern: parseWeekPattern(expression, current.totalWeeks).pattern,
                  }));
                  setTemplates([]);
                  setExcludedOccurrenceIds(new Set());
                }}
              >
                <option value="all">每周</option>
                <option value="odd">单周</option>
                <option value="even">双周</option>
                <option value="explicit">自定义周次</option>
              </select>
            </label>
            {config.defaultWeekPattern.kind === "explicit" && (
              <label className="field">
                自定义默认周次
                <input
                  aria-label="自定义默认周次"
                  placeholder="例如：1-8,10-16周"
                  value={config.defaultWeekPattern.originalExpression ?? ""}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      defaultWeekPattern: {
                        ...parseWeekPattern(event.target.value, current.totalWeeks).pattern,
                        manuallyEdited: true,
                      },
                    }))
                  }
                />
              </label>
            )}
          </div>
          <div className="actions">
            <button className="primary" disabled={!headerConfirmed} onClick={generateTemplates}>
              生成课程模板与具体事件
            </button>
          </div>
        </section>
      )}

      {templates.length > 0 && (
        <section className="panel schedule-results" aria-labelledby="schedule-results-title">
          <div className="section-heading">
            <span className="step">05</span>
            <div>
              <h2 id="schedule-results-title">课程模板与具体事件</h2>
              <p>
                {templates.length} 门课程，{occurrenceResult.occurrences.length} 次具体课程，
                {occurrenceResult.occurrences.filter((item) => item.excludedByUser).length}{" "}
                次已排除，
                {
                  templates.filter((item) =>
                    item.warnings.some((warning) => warning.severity === "error"),
                  ).length
                }{" "}
                门无效，
                {
                  occurrenceResult.occurrences.filter((item) =>
                    item.warnings.some((warning) => warning.code === "COURSE_CONFLICT_DETECTED"),
                  ).length
                }{" "}
                次冲突
              </p>
            </div>
          </div>
          <div className="schedule-template-list">
            {templates.map((template, index) => (
              <article className="schedule-template" key={template.id}>
                <header>
                  <label className="toggle">
                    <input
                      aria-label={`导出课程 ${index + 1}`}
                      type="checkbox"
                      checked={template.selectedForExport}
                      onChange={(event) =>
                        updateTemplate(template.id, { selectedForExport: event.target.checked })
                      }
                    />
                    {SCHEDULE_WEEKDAY_LABELS[template.weekday]} · {template.startTime.value}-
                    {template.endTime.value}
                  </label>
                  <span>
                    {template.weekPattern.weeks.length} 周 /{" "}
                    {
                      occurrenceResult.occurrences.filter((item) => item.templateId === template.id)
                        .length
                    }{" "}
                    次
                  </span>
                </header>
                <div className="schedule-template-fields">
                  <label className="field">
                    课程名称
                    <input
                      aria-label={`课程 ${index + 1} 名称`}
                      value={template.title.value}
                      onChange={(event) =>
                        updateTemplate(template.id, {
                          title: {
                            ...template.title,
                            value: event.target.value,
                            manuallyEdited: true,
                          },
                          manuallyEdited: true,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    地点
                    <input
                      aria-label={`课程 ${index + 1} 地点`}
                      value={template.location.value}
                      onChange={(event) =>
                        updateTemplate(template.id, {
                          location: {
                            ...template.location,
                            value: event.target.value,
                            manuallyEdited: true,
                          },
                          manuallyEdited: true,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    教师
                    <input
                      aria-label={`课程 ${index + 1} 教师`}
                      value={template.teacher.value}
                      onChange={(event) =>
                        updateTemplate(template.id, {
                          teacher: {
                            ...template.teacher,
                            value: event.target.value,
                            manuallyEdited: true,
                          },
                          manuallyEdited: true,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    上课周次
                    <input
                      aria-label={`课程 ${index + 1} 上课周次`}
                      value={
                        template.weekPattern.originalExpression ??
                        template.weekPattern.weeks.join(",")
                      }
                      onChange={(event) => {
                        const parsed = parseWeekPattern(event.target.value, config.totalWeeks);
                        updateTemplate(template.id, {
                          weekPattern: { ...parsed.pattern, manuallyEdited: true },
                          manuallyEdited: true,
                          warnings: [
                            ...template.warnings.filter(
                              (item) =>
                                ![
                                  "COURSE_WEEK_PATTERN_MISSING",
                                  "COURSE_WEEK_PATTERN_INVALID",
                                ].includes(item.code),
                            ),
                            ...parsed.warnings.map((item) => ({ ...item, targetId: template.id })),
                          ],
                        });
                        setExcludedOccurrenceIds(new Set());
                      }}
                    />
                  </label>
                </div>
                <div className="actions schedule-template-actions">
                  <button
                    disabled={!template.selectedForExport}
                    onClick={() => {
                      const selection = selectScheduleEventsForExport(
                        occurrenceResult.occurrences.filter(
                          (item) => item.templateId === template.id,
                        ),
                      );
                      if (selection.valid)
                        onDownload(
                          selection.events,
                          `${config.weekOneMonday ?? "semester"}-${selection.events.length}-course-${index + 1}-snap2cal.ics`,
                        );
                    }}
                  >
                    下载此课程 ICS
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="schedule-occurrences">
            <h3>具体课程</h3>
            {occurrenceResult.occurrences.map((occurrence) => (
              <label
                className={`schedule-occurrence ${occurrence.warnings.length ? "conflict" : ""}`}
                key={occurrence.id}
              >
                <input
                  type="checkbox"
                  aria-label={`包含 ${occurrence.date} ${occurrence.event.title.value}`}
                  checked={!occurrence.excludedByUser}
                  onChange={(event) =>
                    setExcludedOccurrenceIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.delete(occurrence.id);
                      else next.add(occurrence.id);
                      return next;
                    })
                  }
                />
                <span>
                  {occurrence.date} · 第 {occurrence.weekNumber} 周
                </span>
                <strong>{occurrence.event.title.value}</strong>
                <span>
                  {occurrence.event.startTime.value}-{occurrence.event.endTime.value}
                </span>
                {occurrence.warnings.map((item) => (
                  <small key={item.code}>{item.message}</small>
                ))}
              </label>
            ))}
          </div>
        </section>
      )}

      {grid && allWarnings.length > 0 && (
        <section className="panel warnings" aria-labelledby="schedule-warnings-title">
          <div className="section-heading">
            <span className="step">!</span>
            <div>
              <h2 id="schedule-warnings-title">课程表提示</h2>
              <p>推断、歧义、冲突和阻止导出的错误都在此列出</p>
            </div>
          </div>
          <ul>
            {allWarnings.map((warning, index) => (
              <li className={warning.severity} key={`${warning.code}-${warning.targetId ?? index}`}>
                <span>{warning.severity}</span>
                <div>{warningText(warning)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {templates.length > 0 && (
        <section className="panel export-panel">
          <div>
            <span className="eyebrow">SEMESTER EXPORT</span>
            <h2>导出课程日历</h2>
            <p>
              {exportSelection.valid
                ? `将写入 ${exportSelection.events.length} 个独立 VEVENT，不使用 RRULE。`
                : "请处理阻止导出的课程字段或选择。"}
            </p>
          </div>
          <div className="actions">
            <button
              disabled={!exportSelection.valid}
              onClick={() =>
                void navigator.clipboard.writeText(
                  exportSelection.events
                    .map(
                      (event) =>
                        `${event.startDate.value} ${event.startTime.value}-${event.endTime.value} ${event.title.value}${event.location.value ? ` @ ${event.location.value}` : ""}`,
                    )
                    .join("\n"),
                )
              }
            >
              复制课程表摘要
            </button>
            <button
              onClick={() => {
                setGridConfirmed(false);
                invalidateGeneratedState();
              }}
            >
              返回调整网格
            </button>
            <button
              onClick={() =>
                globalThis.document
                  .getElementById("schedule-config-title")
                  ?.scrollIntoView({ block: "start" })
              }
            >
              返回调整周次
            </button>
            <button
              className="primary"
              disabled={!exportSelection.valid || !headerConfirmed}
              onClick={() => {
                if (!config.weekOneMonday) return;
                onDownload(
                  exportSelection.events,
                  `${config.weekOneMonday}-${exportSelection.events.length}-classes-snap2cal.ics`,
                );
              }}
            >
              下载全部选中课程 ICS
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
