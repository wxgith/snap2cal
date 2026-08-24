export async function normalizedBlobToImageData(
  blob: Blob,
  expectedWidth: number,
  expectedHeight: number,
): Promise<ImageData> {
  if (typeof createImageBitmap !== "function")
    throw new Error("当前浏览器无法读取课程表像素。请使用支持 createImageBitmap 的现代浏览器。");
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = expectedWidth;
    canvas.height = expectedHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法创建课程表图像画布。");
    context.drawImage(bitmap, 0, 0, expectedWidth, expectedHeight);
    return context.getImageData(0, 0, expectedWidth, expectedHeight);
  } finally {
    bitmap.close();
  }
}
