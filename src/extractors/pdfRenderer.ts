import fs from "node:fs/promises";
import { renderPageAsImage } from "unpdf";

export async function renderPdfPageToPng(input: {
  sourcePath: string;
  pageNumber: number;
  outputPath: string;
  scale?: number;
}): Promise<{ byteLength: number }> {
  const data = new Uint8Array(await fs.readFile(input.sourcePath));
  const image = await renderPageAsImage(data, input.pageNumber, {
    scale: input.scale ?? 2,
    canvasImport: () => import("@napi-rs/canvas"),
  });
  const bytes = Buffer.from(image);
  await fs.writeFile(input.outputPath, bytes);

  return {
    byteLength: bytes.byteLength,
  };
}
