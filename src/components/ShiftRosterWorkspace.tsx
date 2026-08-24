import { useEffect, useMemo, useRef, useState } from "react";
import type { EventDraft } from "../domain/event";
import type { NormalizedImage } from "../image/image";
import type { OcrDocument, OcrEvidence } from "../ocr/types";
import {
  addGridLine,
  assignOcrBlocksToGridCellsDetailed,
  buildGridCells,
  moveGridLine,
  removeGridLine,
  sortGridLines,
  toggleGridLineLock,
  validateGrid,
} from "../schedule-table/grid";
import { normalizedBlobToImageData } from "../schedule-table/imageData";
import type {
  GridDetectionProgress,
  GridDetector,
  GridLine,
  TableGrid,
} from "../schedule-table/types";
import {
  applyRosterHeaderMapping,
  buildRosterDateColumns,
  buildRosterPeople,
  buildShiftAssignments,
  buildShiftCodeCatalog,
  createIndividualRosterFilename,
  createRosterCells,
  createRosterSummary,
  createShiftDefinition,
  createTeamRosterFilename,
  detectRosterHeaderMapping,
  generateShiftOccurrences,
  normalizeShiftCode,
  parseRosterDateText,
  selectShiftEventsForExport,
  validateShiftDefinitions,
  type RosterCell,
  type RosterConfig,
  type RosterDateColumn,
  type RosterHeaderMapping,
  type RosterPerson,
  type RosterWarning,
  type ShiftDefinition,
} from "../shift-roster";
import {
  ImageOcrWorkspace,
  type ImageNormalizer,
  type OcrAdapterFactory,
} from "./ImageOcrWorkspace";
import { ScheduleGridOverlay } from "./ScheduleGridOverlay";

export type RosterGridDetectorFactory = () => Promise<GridDetector>;
export type RosterImageDataLoader = (
  blob: Blob,
  width: number,
  height: number,
) => Promise<ImageData>;

export interface ShiftRosterWorkspaceProps {
  hidden?: boolean;
  ocrAdapterFactory?: OcrAdapterFactory;
  imageNormalizer?: ImageNormalizer;
  gridDetectorFactory?: RosterGridDetectorFactory;
  imageDataLoader?: RosterImageDataLoader;
  onDownload: (events: EventDraft[], filename: string) => void;
  onMessage: (message: string) => void;
}

async function defaultGridDetectorFactory(): Promise<GridDetector> {
  if (
    import.meta.env.VITE_SNAP2CAL_MOCK_OCR === "true" &&
    new URLSearchParams(window.location.search).get("mockOcr") === "roster" &&
    !new URLSearchParams(window.location.search).has("realGrid")
  ) {
    const { MockGridDetector } = await import("../schedule-table/MockGridDetector");
    const offset = new URLSearchParams(window.location.search).has("rosterOffset");
    return new MockGridDetector({
      horizontalPositions: [0, 50, offset ? 125 : 115, 180],
      verticalPositions: [0, 120, 240, 360, 480, 600],
    });
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

function defaultConfig(): RosterConfig {
  return {
    rosterYear: null,
    rosterMonth: null,
    timeZone: detectTimeZone(),
    exportMode: "team",
    includePersonNameInTitle: true,
    defaultReminderMinutes: null,
  };
}

function emptyMapping(): RosterHeaderMapping {
  return {
    dateHeaderRowIndex: null,
    weekdayHeaderRowIndex: null,
    personColumnIndex: null,
    firstPersonRowIndex: null,
    lastPersonRowIndex: null,
    firstDateColumnIndex: null,
    lastDateColumnIndex: null,
    manuallyConfirmed: false,
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
    warnings: grid.warnings.filter((warning) => !staleCodes.has(warning.code)),
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

function dedupeWarnings<T extends { code: string; message: string; targetId?: string }>(
  warnings: T[],
): T[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.targetId ?? ""}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function warningLabel(severity: string): string {
  return severity === "error" ? "错误" : severity === "warning" ? "注意" : "提示";
}

function cellEvidence(cell: RosterCell | undefined): OcrEvidence | null {
  if (!cell) return null;
  return {
    blockIds: cell.ocrBlockIds,
    bbox: cell.bbox,
    confidence: cell.confidence,
    containsManualCorrection: cell.manuallyEdited,
  };
}

function definitionKindLabel(definition: ShiftDefinition): string {
  return definition.kind === "timed"
    ? definition.crossesMidnight
      ? "跨夜"
      : "定时"
    : definition.kind === "all-day"
      ? "全天"
      : "跳过";
}

export default function ShiftRosterWorkspace({
  hidden = false,
  ocrAdapterFactory,
  imageNormalizer,
  gridDetectorFactory = defaultGridDetectorFactory,
  imageDataLoader = normalizedBlobToImageData,
  onDownload,
  onMessage,
}: ShiftRosterWorkspaceProps) {
  const [image, setImage] = useState<NormalizedImage | null>(null);
  const [document, setDocument] = useState<OcrDocument | null>(null);
  const [grid, setGrid] = useState<TableGrid | null>(null);
  const [detectedGrid, setDetectedGrid] = useState<TableGrid | null>(null);
  const [gridConfirmed, setGridConfirmed] = useState(false);
  const [gridCells, setGridCells] = useState<ReturnType<typeof buildGridCells>>([]);
  const [rosterCells, setRosterCells] = useState<RosterCell[]>([]);
  const [mapping, setMapping] = useState<RosterHeaderMapping>(emptyMapping);
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [dateColumns, setDateColumns] = useState<RosterDateColumn[]>([]);
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [definitions, setDefinitions] = useState<ShiftDefinition[]>([]);
  const [config, setConfig] = useState<RosterConfig>(defaultConfig);
  const [generated, setGenerated] = useState(false);
  const [excludedOccurrenceIds, setExcludedOccurrenceIds] = useState<Set<string>>(new Set());
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [activePersonId, setActivePersonId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GridDetectionProgress | null>(null);
  const [localWarnings, setLocalWarnings] = useState<RosterWarning[]>([]);
  const detectionAbortRef = useRef<AbortController | null>(null);
  const detectionTaskRef = useRef(0);
  const manualDefinitionCounterRef = useRef(0);

  const definitionValidation = useMemo(() => validateShiftDefinitions(definitions), [definitions]);
  const assignmentResult = useMemo(
    () =>
      mappingConfirmed
        ? buildShiftAssignments(rosterCells, people, dateColumns, definitions)
        : { assignments: [], warnings: [] },
    [mappingConfirmed, rosterCells, people, dateColumns, definitions],
  );
  const catalog = useMemo(
    () => buildShiftCodeCatalog(assignmentResult.assignments, rosterCells, people, dateColumns),
    [assignmentResult.assignments, rosterCells, people, dateColumns],
  );
  const occurrenceResult = useMemo(
    () =>
      generated
        ? generateShiftOccurrences(
            assignmentResult.assignments,
            people,
            dateColumns,
            definitions,
            config,
            excludedOccurrenceIds,
          )
        : { occurrences: [], warnings: [] },
    [
      generated,
      assignmentResult.assignments,
      people,
      dateColumns,
      definitions,
      config,
      excludedOccurrenceIds,
    ],
  );
  const teamExport = useMemo(
    () =>
      selectShiftEventsForExport(
        occurrenceResult.occurrences,
        assignmentResult.assignments,
        people,
        { mode: "team", includePersonNameInTitle: config.includePersonNameInTitle },
      ),
    [occurrenceResult.occurrences, assignmentResult.assignments, people, config],
  );
  const individualExport = useMemo(
    () =>
      selectShiftEventsForExport(
        occurrenceResult.occurrences,
        assignmentResult.assignments,
        people,
        {
          mode: "individual",
          personId: activePersonId ?? undefined,
          includePersonNameInTitle: false,
        },
      ),
    [occurrenceResult.occurrences, assignmentResult.assignments, people, activePersonId],
  );
  const activeCell = rosterCells.find((cell) => cell.gridCellId === activeCellId);
  const selectedLine = grid
    ? [...grid.horizontalLines, ...grid.verticalLines].find((line) => line.id === selectedLineId)
    : undefined;
  const rowCount = grid ? Math.max(0, grid.horizontalLines.length - 1) : 0;
  const columnCount = grid ? Math.max(0, grid.verticalLines.length - 1) : 0;
  const selectedPerson = people.find((person) => person.id === activePersonId) ?? null;
  const selectedPersonAssignments = assignmentResult.assignments.filter(
    (assignment) => assignment.personId === activePersonId,
  );
  const selectedPeopleCount = people.filter((person) => person.selectedForExport).length;
  const allWarnings = useMemo(
    () =>
      dedupeWarnings([
        ...localWarnings,
        ...dateColumns.flatMap((date) => date.warnings),
        ...people.flatMap((person) => person.warnings),
        ...definitionValidation.warnings,
        ...assignmentResult.warnings,
        ...occurrenceResult.warnings,
        ...(generated ? teamExport.warnings : []),
      ]),
    [
      localWarnings,
      dateColumns,
      people,
      definitionValidation.warnings,
      assignmentResult.warnings,
      occurrenceResult.warnings,
      generated,
      teamExport.warnings,
    ],
  );

  useEffect(
    () => () => {
      detectionTaskRef.current += 1;
      detectionAbortRef.current?.abort();
    },
    [],
  );

  const clearSemanticState = (clearDefinitions = false) => {
    setGridConfirmed(false);
    setRosterCells([]);
    setMapping(emptyMapping());
    setMappingConfirmed(false);
    setDateColumns([]);
    setPeople([]);
    if (clearDefinitions) setDefinitions([]);
    setGenerated(false);
    setExcludedOccurrenceIds(new Set());
    setActiveCellId(null);
    setActivePersonId(null);
    setLocalWarnings([]);
  };

  const clearDetection = (clearDefinitions = false) => {
    detectionTaskRef.current += 1;
    detectionAbortRef.current?.abort();
    detectionAbortRef.current = null;
    setGrid(null);
    setDetectedGrid(null);
    setGridCells([]);
    setSelectedLineId(null);
    setProgress(null);
    clearSemanticState(clearDefinitions);
  };

  const assignCells = (nextGrid: TableGrid, nextDocument = document) => {
    const nextGridCells = nextDocument
      ? assignOcrBlocksToGridCellsDetailed(nextDocument, nextGrid).cells
      : buildGridCells(nextGrid);
    const baseRosterCells = createRosterCells(nextGridCells);
    const detected = detectRosterHeaderMapping(baseRosterCells);
    setGridCells(nextGridCells);
    setRosterCells(detected.cells);
    setMapping(detected.mapping);
    setLocalWarnings(detected.warnings);
  };

  const invalidateMappedState = () => {
    setMappingConfirmed(false);
    setDateColumns([]);
    setPeople([]);
    setGenerated(false);
    setExcludedOccurrenceIds(new Set());
    setActivePersonId(null);
  };

  const updateGrid = (next: TableGrid) => {
    const validated = editableGrid(next);
    setGrid(validated);
    setGridConfirmed(false);
    assignCells(validated);
    invalidateMappedState();
  };

  const detectGrid = async () => {
    if (!image || !document) {
      onMessage("请先上传排班表并完成本地 OCR。");
      return;
    }
    detectionTaskRef.current += 1;
    const taskId = detectionTaskRef.current;
    detectionAbortRef.current?.abort();
    const controller = new AbortController();
    detectionAbortRef.current = controller;
    clearSemanticState(false);
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
      onMessage("网格检测完成，请检查并确认排班表边界。");
    } catch (error) {
      if (controller.signal.aborted || taskId !== detectionTaskRef.current) return;
      onMessage(error instanceof Error ? error.message : "排班表网格检测失败。");
    }
  };

  const updateMapping = (patch: Partial<RosterHeaderMapping>) => {
    const next = { ...mapping, ...patch, manuallyConfirmed: false };
    setMapping(next);
    setRosterCells((current) => applyRosterHeaderMapping(current, next));
    invalidateMappedState();
  };

  const reconcileDefinitions = (
    nextCells: RosterCell[],
    nextPeople: RosterPerson[],
    nextDates: RosterDateColumn[],
  ) => {
    const rawAssignments = buildShiftAssignments(nextCells, nextPeople, nextDates, []).assignments;
    const codes = [...new Set(rawAssignments.map((item) => item.normalizedCode).filter(Boolean))];
    setDefinitions((current) => {
      const covered = new Set(
        current.flatMap((definition) =>
          [definition.primaryCode, ...definition.aliases].map(normalizeShiftCode),
        ),
      );
      const additions = codes
        .filter((code) => !covered.has(code))
        .map((code, index) => createShiftDefinition(code, current.length + index));
      return [...current, ...additions];
    });
  };

  const confirmMapping = () => {
    if (!gridConfirmed) {
      onMessage("请先确认网格。");
      return;
    }
    const mappedCells = applyRosterHeaderMapping(rosterCells, mapping);
    const dates = buildRosterDateColumns(mappedCells, mapping, config);
    const peopleResult = buildRosterPeople(mappedCells, mapping);
    const structuralError = [...dates.warnings, ...peopleResult.warnings].some(
      (warning) =>
        warning.severity === "error" &&
        [
          "ROSTER_DATE_HEADER_NOT_FOUND",
          "ROSTER_PERSON_COLUMN_NOT_FOUND",
          "ROSTER_DATA_REGION_INVALID",
          "ROSTER_DATE_COLUMN_LIMIT_EXCEEDED",
          "ROSTER_PERSON_LIMIT_EXCEEDED",
        ].includes(warning.code),
    );
    setRosterCells(mappedCells);
    setDateColumns(dates.dateColumns);
    setPeople(peopleResult.people);
    setLocalWarnings(dedupeWarnings([...dates.warnings, ...peopleResult.warnings]));
    if (structuralError || !dates.dateColumns.length || !peopleResult.people.length) {
      setMappingConfirmed(false);
      onMessage("人员或日期区域无效，请校正映射。");
      return;
    }
    const confirmed = { ...mapping, manuallyConfirmed: true };
    setMapping(confirmed);
    setMappingConfirmed(true);
    setActivePersonId(peopleResult.people[0]?.id ?? null);
    reconcileDefinitions(mappedCells, peopleResult.people, dates.dateColumns);
    setGenerated(false);
    setExcludedOccurrenceIds(new Set());
    onMessage("人员和日期已确认，请配置并确认全部非空班次代码。");
  };

  const updateConfigDatePart = (patch: Partial<RosterConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (mappingConfirmed) {
      const parsed = buildRosterDateColumns(rosterCells, mapping, next);
      setDateColumns((current) =>
        parsed.dateColumns.map((date) => {
          const previous = current.find((item) => item.columnIndex === date.columnIndex);
          return previous?.manuallyEdited ? previous : date;
        }),
      );
      setLocalWarnings(parsed.warnings);
    }
    setExcludedOccurrenceIds(new Set());
  };

  const updateDefinition = (definitionId: string, patch: Partial<ShiftDefinition>) => {
    setDefinitions((current) =>
      current.map((definition) => {
        if (definition.id !== definitionId) return definition;
        const next = { ...definition, ...patch };
        if (patch.kind === "all-day" || patch.kind === "skip")
          return { ...next, startTime: null, endTime: null, crossesMidnight: false };
        return next;
      }),
    );
  };

  const updateRosterCell = (cellId: string, patch: Partial<RosterCell>) => {
    setRosterCells((current) =>
      current.map((cell) =>
        cell.gridCellId === cellId ? { ...cell, ...patch, manuallyEdited: true } : cell,
      ),
    );
    setActiveCellId(cellId);
  };

  const copySummary = async () => {
    const text = createRosterSummary(occurrenceResult.occurrences, people);
    if (!text) {
      onMessage("没有可复制的排班摘要。");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      onMessage("排班摘要已复制。");
    } catch {
      onMessage("浏览器未允许写入剪贴板。");
    }
  };

  const gridDisplayCells = gridCells.length ? gridCells : grid ? buildGridCells(grid) : [];

  return (
    <div hidden={hidden} aria-hidden={hidden || undefined} className="roster-workspace">
      <ImageOcrWorkspace
        adapterFactory={ocrAdapterFactory}
        imageNormalizer={imageNormalizer}
        document={document}
        onDocumentChange={(next) => {
          setDocument(next);
          if (!next) {
            clearDetection(true);
            return;
          }
          if (grid) {
            assignCells(grid, next);
            invalidateMappedState();
          }
        }}
        onNormalizedImageChange={(next) => {
          setImage(next);
          clearDetection(true);
        }}
        onRecognitionStart={() => clearDetection(false)}
        onParse={() => undefined}
        hasEvent={false}
        enableEventParsing={false}
        showOcrBoxes
        activeEvidence={cellEvidence(activeCell)}
        headingId="roster-image-title"
        title="导入排班表截图"
        description="单张 PNG、JPEG 或 WebP；图片、人员和班次只在当前浏览器内存中处理"
        overlay={
          <ScheduleGridOverlay
            grid={grid}
            cells={gridDisplayCells}
            selectedLineId={selectedLineId}
            selectedCellIds={activeCellId ? new Set([activeCellId]) : new Set()}
            onSelectLine={setSelectedLineId}
            onMoveLine={(lineId, position) =>
              grid && updateGrid(moveGridLine(grid, lineId, position))
            }
            onToggleCell={setActiveCellId}
            testId="roster-grid-overlay"
          />
        }
      />

      <section className="panel roster-grid-panel" aria-labelledby="roster-grid-title">
        <div className="section-heading">
          <span className="step">02</span>
          <div>
            <h2 id="roster-grid-title">检测并校正排班网格</h2>
            <p>网格保存图片自然坐标；调整边界不会重新执行 OCR</p>
          </div>
        </div>
        <div className="schedule-toolbar" role="toolbar" aria-label="排班网格线工具">
          <button
            className="primary"
            disabled={!document || !image}
            onClick={() => void detectGrid()}
          >
            检测排班表
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
              const restored = editableGrid(detectedGrid);
              setGrid(restored);
              assignCells(restored);
              setGridConfirmed(false);
              invalidateMappedState();
              onMessage("已恢复自动检测网格。");
            }}
          >
            恢复自动检测
          </button>
        </div>
        {selectedLine && (
          <div className="schedule-line-adjust" aria-label="排班网格线微调">
            <strong>
              当前{selectedLine.orientation === "horizontal" ? "水平" : "垂直"}线：
              {Math.round(selectedLine.position)} px
            </strong>
            {[-10, -1, 1, 10].map((amount) => (
              <button
                key={amount}
                disabled={selectedLine.locked}
                aria-label={`排班网格线${amount > 0 ? "增加" : "减少"} ${Math.abs(amount)} 像素`}
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
            aria-label="排班表网格检测进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.progress * 100)}
          >
            <span>{progress.message}</span>
            <strong>{Math.round(progress.progress * 100)}%</strong>
          </div>
        )}
        {grid && (
          <div className="schedule-grid-summary">
            <span>水平线 {grid.horizontalLines.length}</span>
            <span>垂直线 {grid.verticalLines.length}</span>
            <span>网格置信度 {Math.round(grid.confidence * 100)}%</span>
            <button
              className="primary"
              onClick={() => {
                const errors = validateGrid(grid).filter((warning) => warning.severity === "error");
                if (errors.length) {
                  onMessage("网格仍包含无效或过近的边界线。");
                  return;
                }
                setGridConfirmed(true);
                assignCells(grid);
                onMessage("网格已确认，请设置日期行、人员列和数据区域。");
              }}
            >
              {gridConfirmed ? "网格已确认" : "确认网格"}
            </button>
          </div>
        )}
      </section>

      {gridConfirmed && (
        <section className="panel roster-mapping-panel" aria-labelledby="roster-mapping-title">
          <div className="section-heading">
            <span className="step">03</span>
            <div>
              <h2 id="roster-mapping-title">人员、日期与数据区域</h2>
              <p>年份和月份只补足缺失部分，不会读取当前日期</p>
            </div>
          </div>
          <div className="roster-mapping-grid">
            <label className="field">
              日期标题行
              <select
                aria-label="排班日期标题行"
                value={mapping.dateHeaderRowIndex ?? ""}
                onChange={(event) =>
                  updateMapping({ dateHeaderRowIndex: Number(event.target.value) })
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
              星期验证行（可选）
              <select
                aria-label="排班星期验证行"
                value={mapping.weekdayHeaderRowIndex ?? ""}
                onChange={(event) =>
                  updateMapping({
                    weekdayHeaderRowIndex:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">不使用</option>
                {Array.from({ length: rowCount }, (_, index) => (
                  <option key={index} value={index}>
                    第 {index + 1} 行
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              人员姓名列
              <select
                aria-label="排班人员姓名列"
                value={mapping.personColumnIndex ?? ""}
                onChange={(event) =>
                  updateMapping({ personColumnIndex: Number(event.target.value) })
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
            {[
              ["第一条人员行", "firstPersonRowIndex", rowCount],
              ["最后一条人员行", "lastPersonRowIndex", rowCount],
              ["第一条日期列", "firstDateColumnIndex", columnCount],
              ["最后一条日期列", "lastDateColumnIndex", columnCount],
            ].map(([label, key, count]) => (
              <label className="field" key={String(key)}>
                {label}
                <select
                  aria-label={String(label)}
                  value={(mapping[key as keyof RosterHeaderMapping] as number | "") ?? ""}
                  onChange={(event) => updateMapping({ [key]: Number(event.target.value) })}
                >
                  <option value="">请选择</option>
                  {Array.from({ length: Number(count) }, (_, index) => (
                    <option key={index} value={index}>
                      第 {index + 1} {String(key).includes("Row") ? "行" : "列"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field">
              排班年份
              <input
                aria-label="排班年份"
                type="number"
                min={1}
                max={9999}
                value={config.rosterYear ?? ""}
                onChange={(event) =>
                  updateConfigDatePart({
                    rosterYear: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </label>
            <label className="field">
              排班月份
              <input
                aria-label="排班月份"
                type="number"
                min={1}
                max={12}
                value={config.rosterMonth ?? ""}
                onChange={(event) =>
                  updateConfigDatePart({
                    rosterMonth: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </label>
          </div>
          <div className="actions">
            <button className="primary" onClick={confirmMapping}>
              {mappingConfirmed ? "人员和日期已确认" : "确认人员和日期"}
            </button>
          </div>
          {mappingConfirmed && (
            <div className="roster-mapping-review">
              <div>
                <h3>日期列</h3>
                {dateColumns.map((date) => (
                  <label className="field" key={date.id}>
                    第 {date.columnIndex + 1} 列 · OCR：{date.originalText || "（空）"}
                    <input
                      aria-label={`日期列 ${date.columnIndex + 1}`}
                      type="date"
                      value={date.date ?? ""}
                      onFocus={() => setActiveCellId(date.sourceCellId)}
                      onChange={(event) => {
                        const parsed = parseRosterDateText(
                          event.target.value,
                          { rosterYear: null, rosterMonth: null },
                          date.sourceCellId,
                        );
                        setDateColumns((current) =>
                          current.map((item) =>
                            item.id === date.id
                              ? {
                                  ...item,
                                  date: parsed.date,
                                  warnings: parsed.warnings,
                                  manuallyEdited: true,
                                }
                              : item,
                          ),
                        );
                        setExcludedOccurrenceIds(new Set());
                      }}
                    />
                  </label>
                ))}
              </div>
              <div>
                <h3>人员</h3>
                {people.map((person) => (
                  <div className="roster-person-row" key={person.id}>
                    <label className="toggle">
                      <input
                        aria-label={`选择人员 ${person.displayName}`}
                        type="checkbox"
                        checked={person.selectedForExport}
                        onChange={(event) =>
                          setPeople((current) =>
                            current.map((item) =>
                              item.id === person.id
                                ? { ...item, selectedForExport: event.target.checked }
                                : item,
                            ),
                          )
                        }
                      />
                      导出
                    </label>
                    <input
                      aria-label={`人员 ${person.rowIndex + 1} 姓名`}
                      value={person.displayName}
                      onFocus={() => {
                        setActivePersonId(person.id);
                        setActiveCellId(person.sourceCellId);
                      }}
                      onChange={(event) =>
                        setPeople((current) =>
                          current.map((item) =>
                            item.id === person.id
                              ? { ...item, displayName: event.target.value, manuallyEdited: true }
                              : item,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`人员 ${person.displayName} 工号`}
                      placeholder="工号（可选）"
                      value={person.employeeId ?? ""}
                      onChange={(event) =>
                        setPeople((current) =>
                          current.map((item) =>
                            item.id === person.id
                              ? { ...item, employeeId: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {mappingConfirmed && (
        <section
          className="panel roster-definitions-panel"
          aria-labelledby="roster-definitions-title"
        >
          <div className="section-heading">
            <span className="step">04</span>
            <div>
              <h2 id="roster-definitions-title">班次代码与定义</h2>
              <p>代码只做精确匹配；跨午夜、全天和跳过都由用户明确确认</p>
            </div>
          </div>
          <div className="roster-code-catalog" aria-label="班次代码目录">
            {catalog.map((entry) => (
              <button
                className={entry.shiftDefinitionId ? "mapped" : "unmapped"}
                key={entry.normalizedCode}
                onClick={() => setActiveCellId(entry.exampleCellId)}
              >
                <strong>{entry.normalizedCode}</strong>
                <span>
                  {entry.occurrenceCount} 格 · {entry.personCount} 人
                </span>
                <span>
                  {entry.firstDate ?? "日期待确认"}
                  {entry.lastDate && entry.lastDate !== entry.firstDate
                    ? ` 至 ${entry.lastDate}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
          <div className="roster-definition-list">
            {definitions.map((definition, index) => (
              <article className="roster-definition" key={definition.id}>
                <header>
                  <h3>
                    班次 {index + 1} · {definition.primaryCode || "未命名代码"}
                  </h3>
                  <span className={`chip ${definition.manuallyConfirmed ? "edited" : "default"}`}>
                    {definition.manuallyConfirmed ? "已确认" : "待确认"}
                  </span>
                </header>
                <div className="roster-definition-fields">
                  <label className="field">
                    主代码
                    <input
                      aria-label={`班次 ${index + 1} 主代码`}
                      value={definition.primaryCode}
                      onChange={(event) =>
                        updateDefinition(definition.id, {
                          primaryCode: event.target.value,
                          manuallyConfirmed: false,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    班次名称
                    <input
                      aria-label={`班次 ${index + 1} 名称`}
                      value={definition.displayName}
                      onChange={(event) =>
                        updateDefinition(definition.id, {
                          displayName: event.target.value,
                          manuallyConfirmed: false,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    班次类型
                    <select
                      aria-label={`班次 ${index + 1} 类型`}
                      value={definition.kind}
                      onChange={(event) =>
                        updateDefinition(definition.id, {
                          kind: event.target.value as ShiftDefinition["kind"],
                          manuallyConfirmed: false,
                        })
                      }
                    >
                      <option value="timed">定时班次</option>
                      <option value="all-day">全天事件</option>
                      <option value="skip">不生成事件</option>
                    </select>
                  </label>
                  <label className="field">
                    别名（逗号分隔）
                    <input
                      aria-label={`班次 ${index + 1} 别名`}
                      value={definition.aliases.join(", ")}
                      onChange={(event) =>
                        updateDefinition(definition.id, {
                          aliases: event.target.value
                            .split(/[,，]/)
                            .map((value) => value.trim())
                            .filter(Boolean),
                          manuallyConfirmed: false,
                        })
                      }
                    />
                  </label>
                  {definition.kind === "timed" && (
                    <>
                      <label className="field">
                        开始时间
                        <input
                          aria-label={`班次 ${index + 1} 开始时间`}
                          type="time"
                          value={definition.startTime ?? ""}
                          onChange={(event) =>
                            updateDefinition(definition.id, {
                              startTime: event.target.value || null,
                              manuallyConfirmed: false,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        结束时间
                        <input
                          aria-label={`班次 ${index + 1} 结束时间`}
                          type="time"
                          value={definition.endTime ?? ""}
                          onChange={(event) =>
                            updateDefinition(definition.id, {
                              endTime: event.target.value || null,
                              manuallyConfirmed: false,
                            })
                          }
                        />
                      </label>
                      <label className="toggle roster-cross-midnight">
                        <input
                          aria-label={`班次 ${index + 1} 跨午夜`}
                          type="checkbox"
                          checked={definition.crossesMidnight}
                          onChange={(event) =>
                            updateDefinition(definition.id, {
                              crossesMidnight: event.target.checked,
                              manuallyConfirmed: false,
                            })
                          }
                        />
                        明确跨午夜，结束日期为次日
                      </label>
                    </>
                  )}
                  <label className="field">
                    地点
                    <input
                      aria-label={`班次 ${index + 1} 地点`}
                      value={definition.location}
                      onChange={(event) =>
                        updateDefinition(definition.id, {
                          location: event.target.value,
                          manuallyConfirmed: false,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    提醒（分钟）
                    <input
                      aria-label={`班次 ${index + 1} 提醒`}
                      type="number"
                      min={0}
                      value={definition.reminderMinutes ?? ""}
                      onChange={(event) =>
                        updateDefinition(definition.id, {
                          reminderMinutes:
                            event.target.value === "" ? null : Number(event.target.value),
                          manuallyConfirmed: false,
                        })
                      }
                    />
                  </label>
                  <label className="field roster-definition-description">
                    说明
                    <textarea
                      aria-label={`班次 ${index + 1} 说明`}
                      rows={2}
                      value={definition.description}
                      onChange={(event) =>
                        updateDefinition(definition.id, {
                          description: event.target.value,
                          manuallyConfirmed: false,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="actions roster-definition-actions">
                  <button
                    className="primary"
                    onClick={() => updateDefinition(definition.id, { manuallyConfirmed: true })}
                  >
                    确认班次定义
                  </button>
                  <button
                    onClick={() =>
                      setDefinitions((current) =>
                        current.filter((item) => item.id !== definition.id),
                      )
                    }
                  >
                    删除定义
                  </button>
                </div>
                {definitionValidation.definitions
                  .find((item) => item.id === definition.id)
                  ?.warnings.map((warning) => (
                    <small className="inline-warning" key={`${warning.code}-${warning.message}`}>
                      {warning.message} ({warning.code})
                    </small>
                  ))}
              </article>
            ))}
          </div>
          <button
            onClick={() => {
              manualDefinitionCounterRef.current += 1;
              const next = createShiftDefinition(
                "",
                definitions.length + manualDefinitionCounterRef.current,
              );
              setDefinitions((current) => [
                ...current,
                { ...next, id: `${next.id}:manual-${manualDefinitionCounterRef.current}` },
              ]);
            }}
          >
            新增班次定义
          </button>
        </section>
      )}

      {mappingConfirmed && (
        <section className="panel roster-review-panel" aria-labelledby="roster-review-title">
          <div className="section-heading">
            <span className="step">05</span>
            <div>
              <h2 id="roster-review-title">排班矩阵审阅</h2>
              <p>选择单元格会高亮原图证据；修改代码不会覆盖 OCR 原文</p>
            </div>
          </div>
          <div className="roster-matrix-wrap" tabIndex={0} aria-label="排班矩阵横向滚动区域">
            <table className="roster-matrix">
              <thead>
                <tr>
                  <th>人员</th>
                  {dateColumns.map((date) => (
                    <th key={date.id}>{date.date ?? date.originalText}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.id}>
                    <th>
                      <button
                        onClick={() => {
                          setActivePersonId(person.id);
                          setActiveCellId(person.sourceCellId);
                        }}
                      >
                        {person.displayName}
                      </button>
                    </th>
                    {dateColumns.map((date) => {
                      const assignment = assignmentResult.assignments.find(
                        (item) => item.personId === person.id && item.dateColumnId === date.id,
                      );
                      return (
                        <td key={date.id}>
                          <button
                            className={assignment?.status ?? "empty"}
                            aria-label={`${person.displayName} ${date.date ?? date.originalText} 班次 ${assignment?.normalizedCode || "空"}`}
                            aria-pressed={assignment?.sourceCellId === activeCellId}
                            onClick={() => {
                              setActivePersonId(person.id);
                              setActiveCellId(assignment?.sourceCellId ?? null);
                            }}
                          >
                            {assignment?.normalizedCode || "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="roster-mobile-review">
            <label className="field">
              当前人员
              <select
                aria-label="移动端当前人员"
                value={activePersonId ?? ""}
                onChange={(event) => setActivePersonId(event.target.value)}
              >
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </select>
            </label>
            {selectedPersonAssignments.map((assignment) => {
              const date = dateColumns.find((item) => item.id === assignment.dateColumnId);
              return (
                <button
                  className={`roster-mobile-assignment ${assignment.status}`}
                  key={assignment.id}
                  onClick={() => setActiveCellId(assignment.sourceCellId)}
                >
                  <span>{date?.date ?? date?.originalText}</span>
                  <strong>{assignment.normalizedCode || "空班次"}</strong>
                  <small>{assignment.status}</small>
                </button>
              );
            })}
          </div>
          {activeCell && ["assignment", "ignored"].includes(activeCell.role) && (
            <div className="roster-assignment-editor">
              <div>
                <strong>
                  活动单元格：第 {activeCell.rowIndex + 1} 行 / 第 {activeCell.columnIndex + 1} 列
                </strong>
                <small>OCR 原文：{activeCell.originalText || "（空）"}</small>
              </div>
              <label className="field">
                班次代码
                <input
                  aria-label="活动 assignment 班次代码"
                  value={activeCell.text}
                  onChange={(event) =>
                    updateRosterCell(activeCell.gridCellId, {
                      text: event.target.value,
                      role: "assignment",
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  updateRosterCell(activeCell.gridCellId, {
                    role: activeCell.role === "ignored" ? "assignment" : "ignored",
                  })
                }
              >
                {activeCell.role === "ignored" ? "恢复 assignment" : "忽略 assignment"}
              </button>
              {activeCell.manuallyEdited && <span className="chip edited">已手工修改</span>}
            </div>
          )}
        </section>
      )}

      {mappingConfirmed && (
        <section className="panel roster-export-panel" aria-labelledby="roster-export-title">
          <div className="section-heading">
            <span className="step">06</span>
            <div>
              <h2 id="roster-export-title">班次事件与导出</h2>
              <p>无效或未映射 assignment 会阻止导出，不会被静默跳过</p>
            </div>
          </div>
          <div className="roster-export-settings">
            <label className="field">
              时区
              <input
                aria-label="排班时区"
                value={config.timeZone}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, timeZone: event.target.value }))
                }
              />
            </label>
            <label className="field">
              默认提醒（分钟）
              <input
                aria-label="排班默认提醒"
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
            <label className="toggle">
              <input
                aria-label="团队标题包含人员姓名"
                type="checkbox"
                checked={config.includePersonNameInTitle}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    includePersonNameInTitle: event.target.checked,
                  }))
                }
              />
              团队标题包含人员姓名
            </label>
          </div>
          <div className="roster-summary-strip">
            <span>人员 {people.length}</span>
            <span>已选 {selectedPeopleCount}</span>
            <span>日期 {dateColumns.length}</span>
            <span>定义 {definitions.length}</span>
            <span>
              未映射{" "}
              {assignmentResult.assignments.filter((item) => item.status === "unmapped").length}
            </span>
            <span>
              跨夜{" "}
              {
                occurrenceResult.occurrences.filter((item) => item.endDate !== item.startDate)
                  .length
              }
            </span>
            <span>
              冲突{" "}
              {
                occurrenceResult.occurrences.filter((item) =>
                  item.warnings.some((warning) => warning.code === "SHIFT_OCCURRENCE_CONFLICT"),
                ).length
              }
            </span>
          </div>
          <div className="actions">
            <button
              onClick={() =>
                setPeople((current) =>
                  current.map((person) => ({ ...person, selectedForExport: true })),
                )
              }
            >
              选择全部人员
            </button>
            <button
              onClick={() =>
                setPeople((current) =>
                  current.map((person) => ({ ...person, selectedForExport: false })),
                )
              }
            >
              取消选择全部人员
            </button>
            <button
              className="primary"
              onClick={() => {
                setGenerated(true);
                onMessage("已根据当前映射生成班次事件预览。");
              }}
            >
              生成班次事件
            </button>
          </div>
          {generated && (
            <>
              <div className="roster-occurrence-list">
                {occurrenceResult.occurrences.map((occurrence) => {
                  const person = people.find((item) => item.id === occurrence.personId);
                  return (
                    <label
                      className={`roster-occurrence ${occurrence.warnings.length ? "conflict" : ""}`}
                      key={occurrence.id}
                    >
                      <input
                        aria-label={`导出 ${occurrence.rosterDate} ${person?.displayName} ${occurrence.event.title.value}`}
                        type="checkbox"
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
                        <strong>
                          {occurrence.rosterDate} · {person?.displayName} ·{" "}
                          {occurrence.event.title.value}
                        </strong>
                        <small>
                          {occurrence.event.allDay.value
                            ? "全天"
                            : `${occurrence.startTime}-${occurrence.endDate !== occurrence.startDate ? "次日 " : ""}${occurrence.endTime}`}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="roster-download-band">
                <label className="field">
                  个人导出人员
                  <select
                    aria-label="个人导出人员"
                    value={activePersonId ?? ""}
                    onChange={(event) => setActivePersonId(event.target.value)}
                  >
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!individualExport.valid || !selectedPerson}
                  onClick={() =>
                    selectedPerson &&
                    onDownload(
                      individualExport.events,
                      createIndividualRosterFilename(selectedPerson, config),
                    )
                  }
                >
                  下载个人排班 ICS
                </button>
                <button
                  className="primary"
                  disabled={!teamExport.valid}
                  onClick={() =>
                    onDownload(
                      teamExport.events,
                      createTeamRosterFilename(config, selectedPeopleCount),
                    )
                  }
                >
                  下载团队排班 ICS
                </button>
                <button onClick={() => void copySummary()}>复制排班摘要</button>
              </div>
            </>
          )}
        </section>
      )}

      {allWarnings.length > 0 && (
        <section className="panel warnings" aria-labelledby="roster-warnings-title">
          <div className="section-heading">
            <span className="step">!</span>
            <div>
              <h2 id="roster-warnings-title">排班表提示</h2>
              <p>未映射、跨夜配置、冲突和阻止导出的错误都在此列出</p>
            </div>
          </div>
          <ul>
            {allWarnings.map((warning) => (
              <li
                className={warning.severity}
                key={`${warning.code}-${warning.targetId ?? ""}-${warning.message}`}
              >
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
      {definitions.length > 0 && (
        <aside className="roster-definition-legend" aria-label="班次定义摘要">
          {definitions.map((definition) => (
            <span key={definition.id}>
              {definition.primaryCode || "?"} · {definitionKindLabel(definition)}
            </span>
          ))}
        </aside>
      )}
    </div>
  );
}
