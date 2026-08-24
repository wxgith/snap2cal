import type { RosterWarning, ShiftDefinition } from "./types";

export function normalizeShiftCode(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

function validTime(value: string | null): boolean {
  const match = value ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function definitionWarning(
  code: RosterWarning["code"],
  message: string,
  definitionId: string,
): RosterWarning {
  return { code, message, severity: "error", scope: "definition", targetId: definitionId };
}

export function validateShiftDefinition(definition: ShiftDefinition): RosterWarning[] {
  const warnings: RosterWarning[] = [];
  if (!normalizeShiftCode(definition.primaryCode))
    warnings.push(definitionWarning("SHIFT_CODE_UNMAPPED", "班次主代码不能为空。", definition.id));
  if (!definition.displayName.trim())
    warnings.push(definitionWarning("SHIFT_NAME_MISSING", "班次名称不能为空。", definition.id));
  if (!definition.manuallyConfirmed)
    warnings.push(
      definitionWarning(
        "SHIFT_DEFINITION_UNCONFIRMED",
        `班次“${definition.primaryCode || "（空）"}”尚未由用户确认。`,
        definition.id,
      ),
    );
  if (definition.kind !== "timed") return warnings;
  if (!definition.startTime || !definition.endTime) {
    warnings.push(
      definitionWarning("SHIFT_TIME_MISSING", "定时班次必须填写开始和结束时间。", definition.id),
    );
    return warnings;
  }
  if (!validTime(definition.startTime) || !validTime(definition.endTime)) {
    warnings.push(
      definitionWarning("SHIFT_TIME_INVALID", "班次时间必须使用有效的 HH:mm。", definition.id),
    );
    return warnings;
  }
  const start = timeMinutes(definition.startTime);
  const end = timeMinutes(definition.endTime);
  if (start === end)
    warnings.push(
      definitionWarning(
        "SHIFT_TWENTY_FOUR_HOUR_UNSUPPORTED",
        "开始和结束时间相同；第一版不支持 24 小时班次。",
        definition.id,
      ),
    );
  else if (end < start && !definition.crossesMidnight)
    warnings.push(
      definitionWarning(
        "SHIFT_CROSS_MIDNIGHT_REQUIRED",
        "结束时间早于开始时间，必须由用户明确开启跨午夜。",
        definition.id,
      ),
    );
  else if (end > start && definition.crossesMidnight)
    warnings.push(
      definitionWarning(
        "SHIFT_CROSS_MIDNIGHT_INVALID",
        "结束时间晚于开始时间时不能开启跨午夜，否则时长会超过 24 小时。",
        definition.id,
      ),
    );
  return warnings;
}

export interface ShiftDefinitionValidationResult {
  definitions: ShiftDefinition[];
  warnings: RosterWarning[];
  codeOwners: Map<string, string[]>;
}

export function validateShiftDefinitions(
  definitions: ShiftDefinition[],
): ShiftDefinitionValidationResult {
  const codeOwners = new Map<string, string[]>();
  for (const definition of definitions) {
    const codes = [definition.primaryCode, ...definition.aliases]
      .map(normalizeShiftCode)
      .filter(Boolean);
    for (const code of new Set(codes)) {
      const owners = codeOwners.get(code) ?? [];
      owners.push(definition.id);
      codeOwners.set(code, owners);
    }
  }
  const definitionsWithWarnings = definitions.map((definition) => {
    const warnings = validateShiftDefinition(definition);
    const conflicted = [definition.primaryCode, ...definition.aliases]
      .map(normalizeShiftCode)
      .filter((code) => (codeOwners.get(code)?.length ?? 0) > 1);
    if (conflicted.length)
      warnings.push(
        definitionWarning(
          "SHIFT_CODE_ALIAS_CONFLICT",
          `代码或别名 ${[...new Set(conflicted)].join("、")} 同时属于多个班次定义。`,
          definition.id,
        ),
      );
    return { ...definition, warnings };
  });
  return {
    definitions: definitionsWithWarnings,
    warnings: definitionsWithWarnings.flatMap((definition) => definition.warnings),
    codeOwners,
  };
}

export function createShiftDefinition(code: string, index = 0): ShiftDefinition {
  const normalized = normalizeShiftCode(code);
  return {
    id: `shift-definition:${index}:${normalized || "empty"}`,
    primaryCode: normalized,
    aliases: [],
    displayName: normalized,
    kind: "timed",
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    location: "",
    description: "",
    reminderMinutes: null,
    manuallyConfirmed: false,
    warnings: [],
  };
}
