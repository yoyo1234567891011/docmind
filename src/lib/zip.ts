import JSZip from "jszip";

/** Construit un Buffer ZIP (compression DEFLATE). */
export async function buildZipBuffer(
  entries: Array<{ path: string; data: Buffer | string }>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.path.replace(/\\/g, "/"), entry.data);
  }
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return Buffer.from(out);
}
