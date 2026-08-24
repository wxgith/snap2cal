import type { RosterCell, RosterHeaderMapping, RosterPerson, RosterWarning } from "./types";
import { ROSTER_LIMITS } from "./types";

export interface RosterPeopleResult {
  people: RosterPerson[];
  warnings: RosterWarning[];
}

export function buildRosterPeople(
  cells: RosterCell[],
  mapping: RosterHeaderMapping,
): RosterPeopleResult {
  const warnings: RosterWarning[] = [];
  if (
    mapping.personColumnIndex === null ||
    mapping.firstPersonRowIndex === null ||
    mapping.lastPersonRowIndex === null ||
    mapping.firstPersonRowIndex > mapping.lastPersonRowIndex
  ) {
    warnings.push({
      code: "ROSTER_PERSON_COLUMN_NOT_FOUND",
      message: "请指定人员姓名列和有效的人员行范围。",
      severity: "error",
      scope: "person",
    });
    return { people: [], warnings };
  }
  const people: RosterPerson[] = [];
  for (
    let rowIndex = mapping.firstPersonRowIndex;
    rowIndex <= mapping.lastPersonRowIndex;
    rowIndex += 1
  ) {
    const source = cells.find(
      (cell) => cell.rowIndex === rowIndex && cell.columnIndex === mapping.personColumnIndex,
    );
    if (!source || source.role === "ignored" || !source.text.trim()) {
      if (source && source.text.trim() === "")
        warnings.push({
          code: "ROSTER_PERSON_NAME_MISSING",
          message: `第 ${rowIndex + 1} 行人员姓名为空，已保留提示并忽略该行。`,
          severity: "warning",
          scope: "person",
          targetId: source.gridCellId,
        });
      continue;
    }
    const displayName = source.text.trim();
    people.push({
      id: `roster-person:${rowIndex}:${source.gridCellId}`,
      rowIndex,
      sourceCellId: source.gridCellId,
      originalText: source.originalText,
      displayName,
      selectedForExport: true,
      manuallyEdited: source.manuallyEdited,
      warnings: [],
    });
  }
  if (people.length > ROSTER_LIMITS.maxPeople) {
    warnings.push({
      code: "ROSTER_PERSON_LIMIT_EXCEEDED",
      message: `人员不能超过 ${ROSTER_LIMITS.maxPeople} 人，请缩小数据区域。`,
      severity: "error",
      scope: "person",
    });
    return { people: people.slice(0, ROSTER_LIMITS.maxPeople), warnings };
  }
  const byName = new Map<string, RosterPerson[]>();
  for (const person of people) {
    const group = byName.get(person.displayName) ?? [];
    group.push(person);
    byName.set(person.displayName, group);
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    for (const person of group)
      person.warnings.push({
        code: "ROSTER_DUPLICATE_PERSON_NAME",
        message: `姓名“${name}”出现 ${group.length} 次；可填写工号区分，但不会自动合并。`,
        severity: "warning",
        scope: "person",
        targetId: person.sourceCellId,
      });
  }
  warnings.push(...people.flatMap((person) => person.warnings));
  return { people, warnings };
}
