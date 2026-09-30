import { readFileBytes } from "../core/loader";

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
