/**
 * OCR for photographed / scanned letters. Everything (worker, wasm core, English model) is
 * served from this app's own /ocr folder and loaded only on first use, then cached offline.
 */
export type Progress = (status: string, fraction: number) => void;

export async function ocrImage(file: Blob, onProgress?: Progress): Promise<string> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  // Absolute URL: the worker resolves relative paths against its own location, not the page.
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href;
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none', // the service worker already caches the model
    logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
  });
  try {
    // PSM 4 (one column, variable sizes) keeps table rows intact; auto mode trips on cell borders.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(await upscale(file));
    return data.text;
  } finally {
    await worker.terminate();
  }
}

/** Small or low-resolution images read far better at ~2000px wide. */
async function upscale(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width >= 1600) return file;
    const k = Math.min(3, 2000 / bmp.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), 'image/png'));
  } catch {
    return file;
  }
}
