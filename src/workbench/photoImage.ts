import { readFileBytes } from "../core/loader";
import type { SchematicDocument } from "../schematic/document";
import { contentBox, type PixelBox } from "./photo";

/** Longest side of a decoded photo; enough detail, bounded memory. */
const MAX_SIDE = 4096;
const cache = new Map<string, Promise<HTMLCanvasElement>>();

function mimeType(file: string): string {
  if (/\.png$/i.test(file)) return "image/png";
  if (/\.webp$/i.test(file)) return "image/webp";
  if (/\.heic$/i.test(file)) return "image/heic";
  return "image/jpeg";
}

async function decode(file: string): Promise<HTMLCanvasElement> {
  const bytes = await readFileBytes(file);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType(file) }));
  try {
    // An <img> applies the EXIF orientation of phone photos; drawing it
    // into a canvas keeps that orientation for the texture as well.
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A stored photo, decoded; the last few stay cached for flipping sides and tabs. */
export function loadPhotoImage(file: string): Promise<HTMLCanvasElement> {
  let image = cache.get(file);
  if (!image) {
    image = decode(file);
    cache.set(file, image);
    image.catch(() => cache.delete(file));
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
  }
  return image;
}

/** A page of a PDF (the board picture that comes with some boardviews) as a picture. */
export async function renderPageImage(doc: SchematicDocument, index: number): Promise<{ canvas: HTMLCanvasElement; png: Uint8Array }> {
  const page = await doc.page(index);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(MAX_SIDE / Math.max(base.width, base.height), 12) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvas, viewport, background: "#ffffff" }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG");
  return { canvas, png: new Uint8Array(await blob.arrayBuffer()) };
}

/** Where the board is in a picture, in its pixels (see `contentBox`). */
export function boardInPicture(canvas: HTMLCanvasElement): PixelBox | null {
  const k = Math.min(1, 800 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * k));
  const h = Math.max(1, Math.round(canvas.height * k));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, w, h);
  const box = contentBox(ctx.getImageData(0, 0, w, h).data, w, h);
  return box && { x0: box.x0 / k, y0: box.y0 / k, x1: box.x1 / k, y1: box.y1 / k };
}
