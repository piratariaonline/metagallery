/* MetaGallery — fast thumbnail generator
 *
 * Strategy per file:
 *   1. JPEG → try the EXIF embedded thumbnail (fast, no full decode).
 *   2. Otherwise / no embedded thumb → createImageBitmap downscale to ~256px.
 *
 * A small concurrency limiter keeps phones responsive.
 * Results are cached per File object via a Map.
 */
/* global piexif */

const MAX_THUMB     = 256;          // px, longest side
const HEAD_BYTES    = 128 * 1024;   // bytes to read for EXIF thumb attempt
const MAX_CONCURRENT = 4;
const JPEG_QUALITY  = 0.78;

const cache = new Map();   // File -> string (object URL)
const inflight = new Map(); // File -> Promise<string>

/* ---------- Concurrency limiter ---------- */
let running = 0;
const queue = [];
function enqueue(task) {
    return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
    });
}
function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
        const { task, resolve, reject } = queue.shift();
        running++;
        task().then(resolve, reject).finally(() => {
            running--;
            pump();
        });
    }
}

/* ---------- Public API ---------- */
export function getCachedThumb(file) {
    return cache.get(file) || null;
}

export function getThumb(file) {
    const hit = cache.get(file);
    if (hit) return Promise.resolve(hit);
    if (inflight.has(file)) return inflight.get(file);
    const p = enqueue(() => buildThumb(file)).then(url => {
        if (url) cache.set(file, url);
        inflight.delete(file);
        return url;
    });
    inflight.set(file, p);
    return p;
}

/** Free all generated thumbnails (call when loading a new folder). */
export function clearThumbCache() {
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
    inflight.clear();
}

/* ---------- Implementation ---------- */
async function buildThumb(file) {
    if (isJpeg(file)) {
        const exifThumb = await tryExifThumbnail(file);
        if (exifThumb) return exifThumb;
    }
    return await canvasDownscale(file);
}

function isJpeg(file) {
    return file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
}

async function tryExifThumbnail(file) {
    try {
        const slice = file.slice(0, Math.min(file.size, HEAD_BYTES));
        const buf   = new Uint8Array(await slice.arrayBuffer());
        // piexifjs wants a "binary string"
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < buf.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
        }
        const exif = piexif.load(bin);
        const thumb = exif && exif.thumbnail;
        if (thumb && thumb.length > 256) {           // ignore garbage tiny payloads
            const out = new Uint8Array(thumb.length);
            for (let i = 0; i < thumb.length; i++) out[i] = thumb.charCodeAt(i) & 0xff;
            return URL.createObjectURL(new Blob([out], { type: 'image/jpeg' }));
        }
    } catch (_) { /* fall through to canvas */ }
    return null;
}

async function canvasDownscale(file) {
    try {
        // Determine a reasonable target size (longest side -> MAX_THUMB)
        const bitmap = await createImageBitmap(file).catch(() => null);
        if (!bitmap) return null;

        const ratio = Math.min(1, MAX_THUMB / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width  * ratio));
        const h = Math.max(1, Math.round(bitmap.height * ratio));

        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(w, h);
        } else {
            canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();

        const blob = canvas.convertToBlob
            ? await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
            : await new Promise(r => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
        return blob ? URL.createObjectURL(blob) : null;
    } catch (e) {
        console.warn('canvasDownscale failed for', file.name, e);
        return null;
    }
}
