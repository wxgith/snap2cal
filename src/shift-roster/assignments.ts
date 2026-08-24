import type {
  RosterCell,
  RosterDateColumn,
  RosterPerson,
  RosterWarning,
  ShiftAssignment,
  ShiftCodeCatalogEntry,
  ShiftDefinition,
} from "./types";
import { ROSTER_LIMITS } from "./types";
import { normalizeShiftCode, validateShiftDefinitions } from "./shifts";

function assignmentWarning(
  code: RosterWarning["code"],
  message: string,
  targetId: string,
  severity: RosterWarning["severity"] = "error",
): RosterWarning {
  return { code, message, severity, scope: "assignment", targetId };
}

function containsMultipleCodes(code: string): boolean {
  return /\S\s*\/\s*\S/.test(code) || /\S\s*[+,，]\s*\S/.test(code);
}

export interface ShiftAssignmentBuildResult {
  assignments: ShiftAssignment[];
  warnings: RosterWarning[];
}

export function buildShiftAssignments(
  cells: RosterCell[],
  people: RosterPerson[],
  dates: RosterDateColumn[],
  definitions: ShiftDefinition[],
): ShiftAssignmentBuildResult {
  const warnings: RosterWarning[] = [];
  if (people.length * dates.length > ROSTER_LIMITS.maxAssignments) {
    warnings.push({
      code: "ASSIGNMENT_LIMIT_EXCEEDED",
      message: `排班单元格不能超过 ${ROSTER_LIMITS.maxAssignments} 个，请缩小数据区域。`,
      severity: "error",
      scope: "assignment",
    });
    return { assignments: [], warnings };
  }
  const validation = validateShiftDefinitions(definitions);
  const definitionsById = new Map(
    validation.definitions.map((definition) => [definition.id, definition]),
  );
  const assignments: ShiftAssignment[] = [];
  const seenPersonDates = new Map<string, string>();
  for (const person of people) {
    for (const date of dates) {
      const cell = cells.find(
        (item) => item.rowIndex === person.rowIndex && item.columnIndex === date.columnIndex,
      );
      if (!cell) continue;
      const id = `shift-assignment:${person.id}:${date.id}:${cell.gridCellId}`;
      const code = normalizeShiftCode(cell.text);
      const assignmentWarnings: RosterWarning[] = [];
      let status: ShiftAssignment["status"] = "empty";
      let shiftDefinitionId: string | null = null;
      if (cell.role === "ignored") {
        status = "ignored";
        assignmentWarnings.push(
          assignmentWarning(
            "ASSIGNMENT_IGNORED",
            `${person.displayName} ${date.date ?? date.originalText} 的排班单元格已由用户忽略。`,
            cell.gridCellId,
            "info",
          ),
        );
      } else if (code) {
        if (containsMultipleCodes(code)) {
          status = "needs-review";
          assignmentWarnings.push(
            assignmentWarning(
              "SHIFT_MULTIPLE_CODES_UNSUPPORTED",
              `代码“${code}”看起来包含多个班次，第一版不会自动拆分。`,
              cell.gridCellId,
            ),
          );
        } else {
          const ownerIds = validation.codeOwners.get(code) ?? [];
          if (!ownerIds.length) {
            status = "unmapped";
            assignmentWarnings.push(
              assignmentWarning(
                "SHIFT_CODE_UNMAPPED",
                `代码“${code}”尚未映射到班次定义。`,
                cell.gridCellId,
              ),
            );
          } else if (ownerIds.length > 1) {
            status = "needs-review";
            assignmentWarnings.push(
              assignmentWarning(
                "SHIFT_CODE_ALIAS_CONFLICT",
                `代码“${code}”匹配了多个班次定义。`,
                cell.gridCellId,
              ),
            );
          } else {
            shiftDefinitionId = ownerIds[0];
            const definition = definitionsById.get(shiftDefinitionId)!;
            const blocking = definition.warnings.filter((warning) => warning.severity === "error");
            status = blocking.length ? "needs-review" : "mapped";
            assignmentWarnings.push(...blocking);
          }
        }
        if (cell.confidence !== null && cell.confidence < 0.65 && !cell.manuallyEdited) {
          status = "needs-review";
          assignmentWarnings.push(
            assignmentWarning(
              "ASSIGNMENT_LOW_OCR_CONFIDENCE",
              `代码“${code}”的 OCR 置信度较低，请人工确认。`,
              cell.gridCellId,
              "warning",
            ),
          );
        }
      }
      if (date.date) {
        const key = `${person.id}:${date.date}`;
        const duplicate = seenPersonDates.get(key);
        if (duplicate) {
          status = "needs-review";
          assignmentWarnings.push(
            assignmentWarning(
              "ASSIGNMENT_DUPLICATE",
              `${person.displayName} 在 ${date.date} 存在重复 assignment。`,
              cell.gridCellId,
            ),
          );
        } else seenPersonDates.set(key, id);
      }
      assignments.push({
        id,
        personId: person.id,
        dateColumnId: date.id,
        sourceCellId: cell.gridCellId,
        originalText: cell.originalText,
        normalizedCode: code,
        shiftDefinitionId,
        status,
        selectedForExport: person.selectedForExport,
        manuallyEdited: cell.manuallyEdited,
        warnings: assignmentWarnings,
      });
    }
  }
  warnings.push(...assignments.flatMap((assignment) => assignment.warnings));
  return { assignments, warnings };
}

export function buildShiftCodeCatalog(
  assignments: ShiftAssignment[],
  cells: RosterCell[],
  people: RosterPerson[],
  dates: RosterDateColumn[],
): ShiftCodeCatalogEntry[] {
  const cellMap = new Map(cells.map((cell) => [cell.gridCellId, cell]));
  const dateMap = new Map(dates.map((date) => [date.id, date]));
  const groups = new Map<string, ShiftAssignment[]>();
  for (const assignment of assignments) {
    if (!assignment.normalizedCode || assignment.status === "ignored") continue;
    const group = groups.get(assignment.normalizedCode) ?? [];
    group.push(assignment);
    groups.set(assignment.normalizedCode, group);
  }
  return [...groups.entries()]
    .sort(([first], [second]) => first.localeCompare(second, "zh-CN"))
    .map(([normalizedCode, group]) => {
      const dated = group
        .map((assignment) => dateMap.get(assignment.dateColumnId)?.date)
        .filter((date): date is string => Boolean(date))
        .sort();
      const confidences = group
        .map((assignment) => cellMap.get(assignment.sourceCellId)?.confidence)
        .filter(
          (confidence): confidence is number => confidence !== null && confidence !== undefined,
        );
      return {
        normalizedCode,
        originalForms: [
          ...new Set(group.map((assignment) => assignment.originalText.trim()).filter(Boolean)),
        ],
        occurrenceCount: group.length,
        personCount: new Set(
          group
            .map((assignment) => people.find((person) => person.id === assignment.personId)?.id)
            .filter(Boolean),
        ).size,
        firstDate: dated[0] ?? null,
        lastDate: dated.at(-1) ?? null,
        averageConfidence: confidences.length
          ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length
          : null,
        shiftDefinitionId:
          group.find((assignment) => assignment.shiftDefinitionId)?.shiftDefinitionId ?? null,
        exampleCellId: group[0].sourceCellId,
      };
    });
}
