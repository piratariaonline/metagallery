// Local-only build of the @atproto OAuth client + API as a single ESM bundle
// that the browser can load directly. The webapp itself stays no-build; this
// script is only run when the OAuth/API libs need to be (re)vendored.
//
//   npm install
//   npm run build:vendor
//
// Output: vendor/atproto-oauth.bundle.js (committed to the repo).

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(__dirname, 'vendor', 'atproto-oauth.bundle.js');
mkdirSync(dirname(outFile), { recursive: true });

// A tiny entry that re-exports just what oauth.js needs, so esbuild only
// pulls in the parts of @atproto/api we actually use.
const entryContents = `
export { BrowserOAuthClient } from '@atproto/oauth-client-browser';
export { Agent } from '@atproto/api';
`;

await build({
    stdin: {
        contents: entryContents,
        resolveDir: __dirname,
        loader: 'js'
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    outfile: outFile,
    define: {
        'process.env.NODE_ENV': JSON.stringify('production')
    },
    logLevel: 'info'
});

console.log(`\nBundled vendor written to ${outFile}`);
