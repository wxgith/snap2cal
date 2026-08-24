import type { EventDraft, ExtractionWarning } from "./event";

export function validateEvent(event: EventDraft): ExtractionWarning[] {
  const errors: ExtractionWarning[] = [];
  if (!event.title.value.trim()) {
    errors.push({
      code: "MISSING_TITLE",
      message: "请输入事件标题后再导出。",
      severity: "error",
      relatedField: "title",
    });
  }
  if (!event.startDate.value) {
    errors.push({
      code: "MISSING_DATE",
      message: "请选择开始日期后再导出。",
      severity: "error",
      relatedField: "startDate",
    });
  }
  if (!event.allDay.value && !event.startTime.value) {
    errors.push({
      code: "MISSING_TIME",
      message: "非全天事件需要开始时间。",
      severity: "error",
      relatedField: "startTime",
    });
  }
  if (event.reminderMinutes.value !== null && event.reminderMinutes.value < 0) {
    errors.push({
      code: "INVALID_REMINDER",
      message: "提醒分钟数不能为负数。",
      severity: "error",
      relatedField: "reminderMinutes",
    });
  }
  if (
    event.startDate.value &&
    event.endDate.value &&
    event.startTime.value &&
    event.endTime.value &&
    `${event.endDate.value}T${event.endTime.value}` <
      `${event.startDate.value}T${event.startTime.value}`
  ) {
    errors.push({
      code: "END_BEFORE_START",
      message: "结束时间不能早于开始时间。",
      severity: "error",
      relatedField: "endTime",
    });
  }
  return errors;
}
