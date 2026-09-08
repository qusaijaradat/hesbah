/**
 * Turns an uploaded logo into a black-and-white PNG before it is stored.
 *
 * The market prints on a black-only printer, so the printed invoice is designed to carry no
 * colour at all (see PrintInk in the backend's ExportService). A colour logo is the one thing that
 * could put colour back on the page: it goes into the PDF as an image, byte for byte, and the
 * printer then flattens it to a set of indistinct mid-greys — the ring, the text and the artwork
 * all landing on roughly the same tone.
 *
 * Converting here rather than in the API is deliberate: the browser already has decoders for all
 * three formats the upload accepts (PNG, JPEG, WebP), so a canvas does in ten lines what the API
 * would need a whole imaging library — and a new native dependency — to do. What gets stored is
 * the converted image, so every consumer (the invoice PDF, the Settings preview) sees the same
 * black-and-white logo, and nothing downstream has to remember to convert.
 *
 * The transform matches the bundled default logo exactly: Rec. 601 luminance, then a gamma pull
 * so the artwork reads as near-black on white instead of washed-out grey. Alpha is preserved, so a
 * logo with a transparent background stays transparent.
 */

/** Same curve the bundled Assets/default-logo.png was converted with — keep the two in step. */
const GAMMA = 2.1;

/** A header logo is printed about 2cm wide; anything past this is bytes nobody sees. Capping also
 *  keeps a large JPEG from re-encoding into a PNG bigger than the API's 3MB limit. */
const MAX_DIMENSION = 800;

/** What the conversion produced, and whether it actually happened. */
export type MonochromeResult = {
  file: File;
  /** False when the browser could not decode the image and the original is being passed through
   *  unchanged — the caller should say so rather than silently promising a black-and-white logo. */
  converted: boolean;
};

export async function toMonochromePng(file: File): Promise<MonochromeResult> {
  try {
    const bitmap = await decode(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, converted: false };
    ctx.drawImage(bitmap, 0, 0, width, height);

    const image = ctx.getImageData(0, 0, width, height);
    const curve = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.round(255 * Math.pow(i / 255, GAMMA));
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      const grey = curve[Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])];
      px[i] = px[i + 1] = px[i + 2] = grey;
      // px[i + 3] (alpha) left alone.
    }
    ctx.putImageData(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return { file, converted: false };

    const name = file.name.replace(/\.[^.]+$/, "") || "logo";
    return { file: new File([blob], `${name}.png`, { type: "image/png" }), converted: true };
  } catch {
    // A format the browser will not decode, a canvas the browser will not read back — either way
    // the upload itself should still go through, just with an honest message attached.
    return { file, converted: false };
  }
}

/** createImageBitmap is the direct route; the <img> path covers browsers that lack it. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return await createImageBitmap(file);

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
