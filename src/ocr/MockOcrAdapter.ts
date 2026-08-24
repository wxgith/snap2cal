import { OcrError, type OcrAdapter, type OcrRawResult, type OcrRecognizeOptions } from "./types";

export interface MockOcrAdapterOptions {
  result?: OcrRawResult;
  failWith?: OcrError;
  delayMs?: number;
}

export const MOCK_EVENT_RESULT: OcrRawResult = {
  blocks: [
    {
      text: "8月26日",
      confidence: 0.96,
      bbox: { x: 20, y: 20, width: 150, height: 35 },
      lineIndex: 0,
      orderIndex: 0,
    },
    {
      text: "下午3点",
      confidence: 0.92,
      bbox: { x: 20, y: 70, width: 140, height: 35 },
      lineIndex: 1,
      orderIndex: 1,
    },
    {
      text: "在万达影城看电影",
      confidence: 0.9,
      bbox: { x: 20, y: 120, width: 300, height: 35 },
      lineIndex: 2,
      orderIndex: 2,
    },
    {
      text: "提前30分钟提醒",
      confidence: 0.94,
      bbox: { x: 20, y: 170, width: 260, height: 35 },
      lineIndex: 3,
      orderIndex: 3,
    },
  ],
};

export const MOCK_MULTI_EVENT_RESULT: OcrRawResult = {
  blocks: [
    {
      text: "8月26日",
      confidence: 0.96,
      bbox: { x: 20, y: 20, width: 150, height: 32 },
      lineIndex: 0,
      orderIndex: 0,
    },
    {
      text: "09:00 项目评审",
      confidence: 0.94,
      bbox: { x: 20, y: 65, width: 280, height: 32 },
      lineIndex: 1,
      orderIndex: 1,
    },
    {
      text: "14:00 客户沟通",
      confidence: 0.92,
      bbox: { x: 20, y: 110, width: 280, height: 32 },
      lineIndex: 2,
      orderIndex: 2,
    },
    {
      text: "19:00 团队晚餐",
      confidence: 0.9,
      bbox: { x: 20, y: 155, width: 280, height: 32 },
      lineIndex: 3,
      orderIndex: 3,
    },
  ],
};

export const MOCK_SCHEDULE_RESULT: OcrRawResult = {
  blocks: [
    {
      text: "时间",
      confidence: 0.98,
      bbox: { x: 18, y: 15, width: 55, height: 24 },
      lineIndex: 0,
      orderIndex: 0,
    },
    {
      text: "周一",
      confidence: 0.98,
      bbox: { x: 170, y: 15, width: 45, height: 24 },
      lineIndex: 0,
      orderIndex: 1,
    },
    {
      text: "周二",
      confidence: 0.98,
      bbox: { x: 350, y: 15, width: 45, height: 24 },
      lineIndex: 0,
      orderIndex: 2,
    },
    {
      text: "周三",
      confidence: 0.98,
      bbox: { x: 530, y: 15, width: 45, height: 24 },
      lineIndex: 0,
      orderIndex: 3,
    },
    {
      text: "08:00-09:40",
      confidence: 0.97,
      bbox: { x: 7, y: 76, width: 88, height: 22 },
      lineIndex: 1,
      orderIndex: 4,
    },
    {
      text: "10:00-11:40",
      confidence: 0.97,
      bbox: { x: 7, y: 141, width: 88, height: 22 },
      lineIndex: 2,
      orderIndex: 5,
    },
    {
      text: "高等数学",
      confidence: 0.96,
      bbox: { x: 145, y: 65, width: 90, height: 18 },
      lineIndex: 3,
      orderIndex: 6,
    },
    {
      text: "第一教学楼101",
      confidence: 0.94,
      bbox: { x: 132, y: 84, width: 116, height: 16 },
      lineIndex: 4,
      orderIndex: 7,
    },
    {
      text: "1-4周",
      confidence: 0.96,
      bbox: { x: 165, y: 101, width: 52, height: 15 },
      lineIndex: 5,
      orderIndex: 8,
    },
    {
      text: "大学英语",
      confidence: 0.95,
      bbox: { x: 505, y: 130, width: 90, height: 18 },
      lineIndex: 6,
      orderIndex: 9,
    },
    {
      text: "第二教学楼202",
      confidence: 0.93,
      bbox: { x: 492, y: 149, width: 116, height: 16 },
      lineIndex: 7,
      orderIndex: 10,
    },
    {
      text: "双周",
      confidence: 0.96,
      bbox: { x: 530, y: 166, width: 45, height: 15 },
      lineIndex: 8,
      orderIndex: 11,
    },
  ],
};

export const MOCK_ROSTER_RESULT: OcrRawResult = {
  blocks: [
    ...["人员", "9月1日", "9月2日", "9月3日", "9月4日"].map((text, index) => ({
      text,
      confidence: 0.98,
      bbox: { x: index === 0 ? 20 : index * 120 + 25, y: 14, width: 70, height: 22 },
      lineIndex: 0,
      orderIndex: index,
    })),
    {
      text: "张三",
      confidence: 0.97,
      bbox: { x: 28, y: 74, width: 55, height: 22 },
      lineIndex: 1,
      orderIndex: 5,
    },
    {
      text: "A",
      confidence: 0.98,
      bbox: { x: 170, y: 74, width: 20, height: 22 },
      lineIndex: 1,
      orderIndex: 6,
    },
    {
      text: "N",
      confidence: 0.98,
      bbox: { x: 290, y: 74, width: 20, height: 22 },
      lineIndex: 1,
      orderIndex: 7,
    },
    {
      text: "OFF",
      confidence: 0.98,
      bbox: { x: 400, y: 74, width: 45, height: 22 },
      lineIndex: 1,
      orderIndex: 8,
    },
    {
      text: "A",
      confidence: 0.98,
      bbox: { x: 530, y: 74, width: 20, height: 22 },
      lineIndex: 1,
      orderIndex: 9,
    },
    {
      text: "李四",
      confidence: 0.97,
      bbox: { x: 28, y: 139, width: 55, height: 22 },
      lineIndex: 2,
      orderIndex: 10,
    },
    {
      text: "N",
      confidence: 0.98,
      bbox: { x: 170, y: 139, width: 20, height: 22 },
      lineIndex: 2,
      orderIndex: 11,
    },
    {
      text: "A",
      confidence: 0.98,
      bbox: { x: 290, y: 139, width: 20, height: 22 },
      lineIndex: 2,
      orderIndex: 12,
    },
    {
      text: "A",
      confidence: 0.98,
      bbox: { x: 410, y: 139, width: 20, height: 22 },
      lineIndex: 2,
      orderIndex: 13,
    },
    {
      text: "OFF",
      confidence: 0.98,
      bbox: { x: 520, y: 139, width: 45, height: 22 },
      lineIndex: 2,
      orderIndex: 14,
    },
  ],
};

export class MockOcrAdapter implements OcrAdapter {
  public disposed = false;

  constructor(private readonly config: MockOcrAdapterOptions = {}) {}

  async recognize(_image: Blob, options: OcrRecognizeOptions): Promise<OcrRawResult> {
    const stages = [
      ["loading-engine", 0.15, "正在加载识别引擎"],
      ["loading-language", 0.4, "正在加载中文语言数据"],
      ["recognizing", 0.75, "正在识别图片"],
      ["building-document", 0.95, "正在整理识别结果"],
    ] as const;
    for (const [stage, progress, message] of stages) {
      if (options.signal?.aborted) throw new OcrError("OCR_CANCELLED", "识别已取消。");
      options.onProgress?.({ stage, progress, message });
      if (this.config.delayMs)
        await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }
    if (this.config.failWith) throw this.config.failWith;
    if (options.signal?.aborted) throw new OcrError("OCR_CANCELLED", "识别已取消。");
    options.onProgress?.({ stage: "completed", progress: 1, message: "识别完成" });
    return this.config.result ?? MOCK_EVENT_RESULT;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}
