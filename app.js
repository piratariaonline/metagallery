/* MetaGallery — local picture metadata editor (frontend only) */
import { readMetadata, writeMetadata, detectFormat, isWritable, EMPTY_VALUES } from './metadata.js';
import { getThumb, getCachedThumb, clearThumbCache } from './thumbs.js';
import { startIndexing, cancelIndexing, isIndexingDone, indexReady } from './searchIndex.js';

const $ = (sel, root = document) => root.querySelector(sel);

const PREVIEWABLE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const IS_EMBEDDED = window.self !== window.top;

/** @type {{handle: FileSystemFileHandle|null, file: File, name: string, dirty: boolean, edits: Object|null}[]} */
const items = [];
let currentIndex = -1;
let dirHandle = null;
let installPromptEvent = null;

/* Make sure the editor truly starts hidden, regardless of CSS specificity. */
hideEditor();

/* ---------- Service worker ----------
 * Skip on plain-HTTP localhost so dev hot-reload isn't fighting a stale cache.
 * On HTTPS (incl. mkcert dev or production) → register, so install prompt is eligible.
 */
const IS_PLAIN_LOCAL_HTTP =
    location.protocol === 'http:' &&
    ['localhost', '127.0.0.1', ''].includes(location.hostname);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    if (IS_PLAIN_LOCAL_HTTP) {
        navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    } else {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(reg => {
                // When a new SW is found, activate it immediately and reload
                // so users always get the latest CSS/JS without manual cache clears.
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    if (!nw) return;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            nw.postMessage('SKIP_WAITING');
                        }
                    });
                });
                // Force an update check on every page load.
                reg.update().catch(() => {});
            }).catch(err => console.warn('SW registration failed', err));
            let reloaded = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloaded) return;
                reloaded = true;
                location.reload();
            });
            navigator.serviceWorker.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'SW_UPDATED' && !reloaded) {
                    reloaded = true;
                    location.reload();
                }
            });
        });
    }
}

/* ---------- PWA install prompt ---------- */
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPromptEvent = e;
    $('#btn-install').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    $('#btn-install').hidden = true;
});

/* ---------- File / folder loading ---------- */
$('#btn-open-dir').addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) {
        toast('Your browser cannot open a folder. Use "Pick files" instead, or try Chrome/Edge.', 'err');
        return;
    }
    if (IS_EMBEDDED) {
        toast('Folder access is blocked inside an embedded preview. Open the app in a real browser tab (e.g. http://localhost:5173).', 'err');
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await loadDirectory(handle);
    } catch (e) {
        if (e?.name === 'AbortError') return;
        console.error(e);
        toast('Open folder failed: ' + (e?.message || e?.name || e), 'err');
    }
});

$('#btn-open-files').addEventListener('click', async () => {
    if ('showOpenFilePicker' in window && !IS_EMBEDDED) {
        try {
            const handles = await window.showOpenFilePicker({
                multiple: true,
                types: [{
                    description: 'Images',
                    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'] }
                }]
            });
            const newItems = await Promise.all(handles.map(async h => {
                const f = await h.getFile();
                return { handle: h, file: f, name: f.name, dirty: false, edits: null };
            }));
            setItems(newItems, null);
            return;
        } catch (e) {
            if (e?.name === 'AbortError') return;
            console.warn('showOpenFilePicker failed, falling back to <input>', e);
        }
    }
    // Fallback: works everywhere (Firefox / Safari / iframes)
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = 'image/*';
    input.onchange = () => {
        const newItems = Array.from(input.files).map(f => ({
            handle: null, file: f, name: f.name, dirty: false, edits: null
        }));
        setItems(newItems, null);
    };
    input.click();
});

async function loadDirectory(handle) {
    dirHandle = handle;
    // Show a loading indicator immediately — enumerating a large folder
    // (DCIM, Downloads…) can take a noticeable moment before render.
    const gEl = $('#gallery');
    if (gEl) gEl.innerHTML = '<div class="gallery-loading"><div class="spin"></div>Loading folder…</div>';
    $('#folder-name').textContent = handle.name ? `Loading ${handle.name}…` : 'Loading…';
    const collected = [];
    for await (const [name, entry] of handle.entries()) {
        if (entry.kind !== 'file') continue;
        if (!PREVIEWABLE.test(name)) continue;
        try {
            const file = await entry.getFile();
            collected.push({ handle: entry, file, name, dirty: false, edits: null });
        } catch (e) { console.warn('Skip', name, e); }
    }
    collected.sort((a, b) => a.name.localeCompare(b.name));
    setItems(collected, handle.name || 'Folder');
}

function setItems(arr, folderName) {
    clearThumbCache();
    cancelIndexing();
    items.length = 0;
    items.push(...arr);
    currentIndex = -1;
    $('#folder-name').textContent = folderName || (arr.length ? `${arr.length} file(s)` : 'No folder loaded');
    $('#file-count').textContent  = arr.length ? `${arr.length} image(s)` : '';
    $('#empty-state')?.remove();
    renderFileList();
    renderGallery();
    closeEditor();
    closeSidebar();
    // Fire-and-forget: pre-read metadata so search can match title/description
    // without waiting at query time. The first user query that hits zero
    // filename matches will await this Promise (see onSearchInput).
    if (arr.length) startIndexing(items);
}

/* ---------- Sidebar drawer (mobile) ---------- */
$('#btn-toggle-sidebar').addEventListener('click', () => {
    const open = $('.sidebar').classList.toggle('open');
    $('#sidebar-backdrop').hidden = !open;
});
$('#sidebar-backdrop').addEventListener('click', closeSidebar);
function closeSidebar() {
    $('.sidebar').classList.remove('open');
    $('#sidebar-backdrop').hidden = true;
}

/* ---------- Sidebar list + search ---------- */
let searchToken = 0;
let searchDebounceT = 0;

$('#filter').addEventListener('input', () => {
    clearTimeout(searchDebounceT);
    searchDebounceT = setTimeout(onSearchInput, 120);
});
$('#search-title').addEventListener('change', onSearchInput);
$('#search-desc').addEventListener('change', onSearchInput);

async function onSearchInput() {
    const myToken = ++searchToken;
    const term = $('#filter').value.trim().toLowerCase();
    const wantTitle = $('#search-title').checked;
    const wantDesc  = $('#search-desc').checked;

    setSearchStatus('');

    // Tier 1 — synchronous, uses whatever's already in memory.
    let matches = filterItems(term, wantTitle, wantDesc);
    renderFileList(matches);

    // Bail early if Tier 2 wouldn't change anything.
    if (!term)                         return; // no query
    if (!wantTitle && !wantDesc)       return; // filename-only mode
    if (matches.length > 0)            return; // already have hits
    if (isIndexingDone())              return; // index is final, won't change

    // Tier 2 — wait for the bg pre-read to finish, then re-run.
    setSearchStatus('Searching, please wait…', true);
    await indexReady();
    if (myToken !== searchToken) return; // a newer query superseded us
    matches = filterItems(term, wantTitle, wantDesc);
    renderFileList(matches);
    setSearchStatus('');
}

function filterItems(term, wantTitle, wantDesc) {
    if (!term) return items.slice();
    return items.filter(it => {
        if (it.name.toLowerCase().includes(term)) return true;
        // In-memory edits take precedence over the cached pre-read.
        const ed = it.edits;
        if (ed) {
            if (wantTitle && (ed.ImageDescription || '').toLowerCase().includes(term)) return true;
            if (wantDesc  && (ed.UserComment      || '').toLowerCase().includes(term)) return true;
        }
        const idx = it.metaIndex;
        if (idx) {
            if (wantTitle && idx.title.includes(term))       return true;
            if (wantDesc  && idx.description.includes(term)) return true;
        }
        return false;
    });
}

function setSearchStatus(msg, withSpinner = false) {
    const el = $('#search-status');
    if (!el) return;
    if (!msg) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    el.hidden = false;
    el.innerHTML = (withSpinner ? '<span class="spin"></span>' : '') +
                   `<span>${escapeHtml(msg)}</span>`;
}

function renderFileList(filtered) {
    const ul = $('#file-list');
    const list = filtered || items;
    ul.innerHTML = '';
    list.forEach(it => {
        const i = items.indexOf(it);
        const li = document.createElement('li');
        li.dataset.index = i;
        if (i === currentIndex) li.classList.add('active');
        if (it.dirty) li.classList.add('dirty');
        const fmt = detectFormat(it.file).toUpperCase();
        const fmtLabel = fmt !== 'UNKNOWN' ? `${fmt} · ` : '';
        li.innerHTML = `<span class="name">${escapeHtml(it.name)}</span>
                        <span class="badge">${fmtLabel}${formatSize(it.file.size)}</span>`;
        li.addEventListener('click', () => openItem(i));
        ul.appendChild(li);
    });
}

/* ---------- Gallery ---------- */
let thumbObserver = null;

function ensureThumbObserver() {
    if (thumbObserver || !('IntersectionObserver' in window)) return thumbObserver;
    thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const tile = entry.target;
            thumbObserver.unobserve(tile);
            loadThumbInto(tile);
        }
    }, {
        root: $('#gallery'),
        rootMargin: '300px 0px',     // start loading a bit before the tile is visible
        threshold: 0.01
    });
    return thumbObserver;
}

async function loadThumbInto(tile) {
    const i = +tile.dataset.index;
    const it = items[i];
    if (!it) return;
    const wrap = tile.querySelector('.img-wrap');
    const img  = tile.querySelector('.img');
    try {
        const url = await getThumb(it.file);
        if (!url) { wrap.classList.remove('loading'); wrap.classList.add('failed'); return; }
        img.onload = () => {
            wrap.classList.remove('loading');
            img.classList.add('loaded');
        };
        img.src = url;
    } catch (e) {
        console.warn('thumb error', it.name, e);
        wrap.classList.remove('loading');
        wrap.classList.add('failed');
    }
}

function renderGallery() {
    const g = $('#gallery');
    g.innerHTML = '';
    if (!items.length) {
        g.innerHTML = `<div class="empty"><h2>No images loaded.</h2>
            <p>Open a folder or pick files to begin.</p></div>`;
        return;
    }
    const observer = ensureThumbObserver();
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
        const div = document.createElement('div');
        div.className = 'thumb';
        if (i === currentIndex) div.classList.add('active');
        if (it.dirty) div.classList.add('dirty');
        div.dataset.index = i;
        div.innerHTML = `
            <div class="img-wrap loading">
                <img class="img" alt="" decoding="async">
            </div>
            <div class="label" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>`;
        div.addEventListener('click', () => openItem(i));
        frag.appendChild(div);

        // If we already have a cached thumb, set immediately; otherwise observe.
        const cached = getCachedThumb(it.file);
        if (cached) {
            const img = div.querySelector('.img');
            const wrap = div.querySelector('.img-wrap');
            img.onload = () => { wrap.classList.remove('loading'); img.classList.add('loaded'); };
            img.src = cached;
        } else if (observer) {
            observer.observe(div);
        } else {
            // No IntersectionObserver: fall back to immediate load
            loadThumbInto(div);
        }
    });
    g.appendChild(frag);
}

/* ---------- Editor ---------- */
const form = $('#meta-form');
$('#btn-close-editor').addEventListener('click', closeEditor);
$('#btn-revert').addEventListener('click', () => {
    if (currentIndex < 0) return;
    items[currentIndex].edits = null;
    items[currentIndex].dirty = false;
    openItem(currentIndex);
    setStatus('Reverted unsaved changes.', 'ok');
});
$('#btn-clear-gps').addEventListener('click', () => {
    form.GPSLatitude.value = '';
    form.GPSLongitude.value = '';
    form.GPSAltitude.value  = '';
    form.dispatchEvent(new Event('input'));
});
form.addEventListener('input', () => {
    if (currentIndex < 0) return;
    items[currentIndex].edits = readForm();
    items[currentIndex].dirty = true;
    markDirtyUI();
});
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveCurrent({ download: false });
});
$('#btn-download').addEventListener('click', async () => {
    await saveCurrent({ download: true });
});

function hideEditor() {
    const ed = $('#editor');
    if (!ed) return;
    ed.hidden = true;
    ed.style.display = 'none'; // belt + suspenders against CSS specificity
    document.querySelector('.layout')?.classList.add('no-editor');
}
function showEditor() {
    const ed = $('#editor');
    ed.hidden = false;
    ed.style.display = ''; // restore CSS-driven flex
    document.querySelector('.layout')?.classList.remove('no-editor');
}

/* Just hide the editor and clear active highlight — keep currentIndex
 * cleared but DO NOT rebuild the gallery (avoids flicker). */
function closeEditor() {
    hideEditor();
    if (currentIndex >= 0) {
        document.querySelectorAll('.thumb.active, #file-list li.active')
            .forEach(el => el.classList.remove('active'));
        currentIndex = -1;
    }
}

async function openItem(i) {
    currentIndex = i;
    const it = items[i];

    // Update active states without rebuilding lists
    document.querySelectorAll('.thumb.active, #file-list li.active')
        .forEach(el => el.classList.remove('active'));
    document.querySelector(`#file-list li[data-index="${i}"]`)?.classList.add('active');
    document.querySelector(`.thumb[data-index="${i}"]`)?.classList.add('active');

    showEditor();
    closeSidebar(); // mobile: close drawer when opening an item
    $('#editor-name').textContent = it.name;
    const fmt = detectFormat(it.file);
    const writable = isWritable(it.file);
    $('#editor-meta').textContent =
        `${fmt.toUpperCase()} · ${formatSize(it.file.size)}` +
        (writable ? '' : ' · metadata not editable');

    $('#preview').src = URL.createObjectURL(it.file);

    let meta = { ...EMPTY_VALUES };
    if (writable) {
        try { meta = await readMetadata(it.file); }
        catch (err) { console.warn('Could not parse metadata for', it.name, err); }
        setStatus('');
    } else {
        setStatus(`Metadata editing isn't supported for ${fmt.toUpperCase() || 'this format'}. Preview only.`, 'err');
    }

    fillForm(it.edits || meta);
    setFormDisabled(!writable);
}

function fillForm(values) {
    Object.keys(EMPTY_VALUES).forEach(k => {
        if (form.elements[k] != null) form.elements[k].value = values[k] ?? '';
    });
}
function readForm() {
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = typeof v === 'string' ? v : ''; });
    return data;
}
function setFormDisabled(disabled) {
    Array.from(form.elements).forEach(el => { el.disabled = disabled; });
}

/* ---------- Save ---------- */
async function saveCurrent({ download }) {
    if (currentIndex < 0) return;
    const it = items[currentIndex];
    if (!isWritable(it.file)) {
        setStatus('Saving metadata is not supported for this format.', 'err');
        return;
    }
    const vals = readForm();
    setStatus('Saving…');
    try {
        const blob = await writeMetadata(it.file, vals);

        if (download || !it.handle) {
            triggerDownload(blob, it.name);
            setStatus('Downloaded a copy with new metadata.', 'ok');
        } else {
            const writable = await it.handle.createWritable();
            await writable.write(blob);
            await writable.close();
            it.file = await it.handle.getFile();
            it.dirty = false;
            it.edits = null;
            // Refresh the cached search index for this item from the just-saved values.
            it.metaIndex = {
                title:       (vals.ImageDescription || '').toString().toLowerCase(),
                description: (vals.UserComment      || '').toString().toLowerCase()
            };
            setStatus('Saved to original file ✔', 'ok');
            document.querySelector(`#file-list li[data-index="${currentIndex}"]`)?.classList.remove('dirty');
            document.querySelector(`.thumb[data-index="${currentIndex}"]`)?.classList.remove('dirty');
            toast(`Saved ${it.name}`, 'ok');
        }
    } catch (err) {
        console.error(err);
        setStatus('Save failed: ' + (err?.message || err), 'err');
        toast('Save failed', 'err');
    }
}

/* ---------- Helpers ---------- */
function markDirtyUI() {
    $(`#file-list li[data-index="${currentIndex}"]`)?.classList.add('dirty');
    $(`.thumb[data-index="${currentIndex}"]`)?.classList.add('dirty');
}
function setStatus(msg, kind = '') {
    const el = $('#save-status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
}
function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3500);
}
function triggerDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/(\.[^.]+)?$/, (m) => '-edited' + (m || ''));
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function formatSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* Warn before leaving with unsaved changes */
window.addEventListener('beforeunload', (e) => {
    if (items.some(it => it.dirty)) {
        e.preventDefault();
        e.returnValue = '';
    }
});
