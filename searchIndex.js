/* MetaGallery — background metadata pre-read for search.
 *
 * Goal: after a folder/file set is loaded, eagerly read each file's metadata
 * so the search box can match against title (ImageDescription) and
 * description (UserComment) without waiting at query time.
 *
 * The work is fire-and-forget; it never blocks the UI. A Promise
 * (`indexReady()`) is exposed so the search code can await completion when a
 * Tier-1 filename search comes back empty.
 *
 * Two passes:
 *   1. Try every item. Anything that throws goes onto `failed[]`.
 *   2. Retry just the failed list once. Anything still failing is silently
 *      marked indexed-with-no-meta so it just won't match by metadata.
 */

import { readMetadata, isWritable } from './metadata.js';

const MAX_CONCURRENT = 4;

/** @type {{items: any[], aborted: boolean, done: boolean, promise: Promise<void>} | null} */
let currentRun = null;

/** Start a new indexing run. Cancels any previous run. */
export function startIndexing(items) {
    cancelIndexing();
    const run = { items, aborted: false, done: false };
    run.promise = (async () => {
        const failed = [];
        await runPass(items, run, failed);
        if (!run.aborted && failed.length) {
            // Second chance for transient errors
            const stillFailed = [];
            await runPass(failed, run, stillFailed);
            // Mark anything still failing so we don't retry forever and so
            // hasIndex() returns true for them.
            for (const it of stillFailed) {
                if (it.metaIndex === undefined) {
                    it.metaIndex = { title: '', description: '' };
                }
            }
        }
        run.done = true;
    })();
    currentRun = run;
    return run.promise;
}

export function cancelIndexing() {
    if (currentRun) currentRun.aborted = true;
    currentRun = null;
}

export function isIndexingDone() {
    return !currentRun || currentRun.done;
}

/** Returns a Promise that resolves when the current run finishes (or
 *  immediately if no run is active). */
export function indexReady() {
    return currentRun ? currentRun.promise : Promise.resolve();
}

async function runPass(list, run, failed) {
    let next = 0;
    const workers = Array.from({ length: MAX_CONCURRENT }, async () => {
        while (!run.aborted) {
            const i = next++;
            if (i >= list.length) return;
            const item = list[i];
            if (item.metaIndex !== undefined) continue;
            try {
                if (!isWritable(item.file)) {
                    item.metaIndex = { title: '', description: '' };
                    continue;
                }
                const m = await readMetadata(item.file);
                item.metaIndex = {
                    title:       (m.ImageDescription || '').toString().toLowerCase(),
                    description: (m.UserComment      || '').toString().toLowerCase()
                };
            } catch (e) {
                failed.push(item);
            }
        }
    });
    await Promise.all(workers);
}
