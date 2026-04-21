// Tiny one-off: render icons/icon.svg to PNG at 192 and 512.
// Run: node tools/gen-icons.mjs
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const svg = await readFile(resolve(root, 'icons/icon.svg'));

for (const size of [192, 512]) {
    const out = resolve(root, `icons/icon-${size}.png`);
    await sharp(svg, { density: 384 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toFile(out);
    console.log('✔', out);
}
