/* MetaGallery — local picture metadata editor (frontend only) */
import { readMetadata, writeMetadata, detectFormat, isWritable, EMPTY_VALUES } from './metadata.js';
import { getThumb, getCachedThumb, clearThumbCache } from './thumbs.js';
import { startIndexing, cancelIndexing, isIndexingDone, indexReady } from './searchIndex.js';
import * as bsky from './bluesky.js';
import { t, tHtml, applyI18n, setLocale, getLocale, getAvailableLocales } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- i18n boot ---------- */
applyI18n();
{
    const sel = $('#lang-switch');
    if (sel) {
        // Populate (in case we add locales later) and select the active one.
        sel.innerHTML = '';
        for (const loc of getAvailableLocales()) {
            const o = document.createElement('option');
            o.value = loc;
            o.textContent = loc.toUpperCase().replace('-BR', '-BR');
            sel.appendChild(o);
        }
        sel.value = getLocale();
        sel.addEventListener('change', () => setLocale(sel.value));
    }
}
document.addEventListener('localechange', () => {
    // Refresh anything that's not driven by data-i18n attributes.
    updateBskyButton();
    // Re-render gallery & sidebar so empty-state and counts pick up the new locale.
    if (items.length === 0) renderGallery();
    else { renderFileList(visibleItems || items); renderGallery(); }
    updateSelectionUI();
});

/* ---------- Welcome / help modal ---------- */
const WELCOME_KEY = 'metagallery.welcomeSeen';
function openWelcome() {
    const m = $('#welcome-modal');
    if (!m) return;
    $('#welcome-skip').checked = false;
    m.hidden = false;
}
function closeWelcome() {
    const m = $('#welcome-modal');
    if (!m) return;
    if ($('#welcome-skip').checked) {
        try { localStorage.setItem(WELCOME_KEY, '1'); } catch {}
    }
    m.hidden = true;
}
$('#btn-help')?.addEventListener('click', openWelcome);
$('#welcome-ok')?.addEventListener('click', closeWelcome);
// Auto-open on first visit.
try {
    if (!localStorage.getItem(WELCOME_KEY)) {
        // Defer one tick so the page paints first.
        setTimeout(openWelcome, 50);
    }
} catch {}

const PREVIEWABLE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const IS_EMBEDDED = window.self !== window.top;

/** @type {{handle: FileSystemFileHandle|null, file: File, name: string, dirty: boolean, edits: Object|null}[]} */
const items = [];
// Subset of `items` currently displayed (gallery + sidebar). Updated by the
// search filter; mirrors `items` when no filter is active.
let visibleItems = items;
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
        toast(t('folder.unsupported'), 'err');
        return;
    }
    if (IS_EMBEDDED) {
        toast(t('folder.embedded'), 'err');
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await loadDirectory(handle);
    } catch (e) {
        if (e?.name === 'AbortError') return;
        console.error(e);
        toast(t('folder.openFailed', { err: e?.message || e?.name || e }), 'err');
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
    if (gEl) gEl.innerHTML = `<div class="gallery-loading"><div class="spin"></div>${escapeHtml(t('gallery.loading'))}</div>`;
    $('#folder-name').textContent = handle.name ? t('gallery.loadingName', { name: handle.name }) : t('gallery.loading');
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
    visibleItems = items;
    currentIndex = -1;
    $('#folder-name').textContent = folderName || (arr.length ? t('sidebar.fileCount', { n: arr.length }) : t('sidebar.noFolder'));
    $('#file-count').textContent  = arr.length ? t('sidebar.imageCount', { n: arr.length }) : '';
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
    $('#filter-clear').hidden = !$('#filter').value;
    clearTimeout(searchDebounceT);
    searchDebounceT = setTimeout(onSearchInput, 120);
});
$('#filter-clear').addEventListener('click', () => {
    $('#filter').value = '';
    $('#filter-clear').hidden = true;
    $('#filter').focus();
    onSearchInput();
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
    visibleItems = matches;
    renderFileList(matches);
    renderGallery();

    // Bail early if Tier 2 wouldn't change anything.
    if (!term)                         return; // no query
    if (!wantTitle && !wantDesc)       return; // filename-only mode
    if (matches.length > 0)            return; // already have hits
    if (isIndexingDone())              return; // index is final, won't change

    // Tier 2 — wait for the bg pre-read to finish, then re-run.
    setSearchStatus(t('sidebar.searching'), true);
    await indexReady();
    if (myToken !== searchToken) return; // a newer query superseded us
    matches = filterItems(term, wantTitle, wantDesc);
    visibleItems = matches;
    renderFileList(matches);
    renderGallery();
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
        g.innerHTML = `<div class="empty"><h2>${escapeHtml(t('gallery.empty.noImages'))}</h2>
            <p>${escapeHtml(t('gallery.empty.noImages.hint'))}</p></div>`;
        return;
    }
    const list = visibleItems || items;
    if (!list.length) {
        g.innerHTML = `<div class="empty"><h2>${escapeHtml(t('gallery.empty.noMatches'))}</h2>
            <p>${escapeHtml(t('gallery.empty.noMatches.hint'))}</p></div>`;
        return;
    }
    const observer = ensureThumbObserver();
    const frag = document.createDocumentFragment();
    // Render only the filtered subset, but keep `dataset.index` aligned with
    // the canonical `items` array so selection / openItem / dirty flags etc.
    // keep working untouched.
    list.forEach((it) => {
        const i = items.indexOf(it);
        const div = document.createElement('div');
        div.className = 'thumb';
        if (i === currentIndex) div.classList.add('active');
        if (it.dirty) div.classList.add('dirty');
        div.dataset.index = i;
        div.innerHTML = `
            <div class="img-wrap loading">
                <img class="img" alt="" decoding="async">
                <span class="sel-mark">✓</span>
            </div>
            <div class="label" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>`;
        if (selectedIndexes.has(i)) div.classList.add('selected');
        div.addEventListener('click', (ev) => onThumbClick(i, ev));
        attachLongPress(div, () => enterSelectionWith(i));
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

/* ============================================================
 * Multi-select state + Bluesky compose flow
 * ============================================================ */

const MAX_SEL = 4;
const selectedIndexes = new Set();
let selectionMode = false;

function onThumbClick(i, ev) {
    // In selection mode, click toggles. Shift/Ctrl/Meta-click also toggles
    // (and enters selection mode) without needing long-press first.
    if (selectionMode || ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        toggleSelection(i);
        return;
    }
    openItem(i);
}

function enterSelectionWith(i) {
    if (!selectionMode) selectionMode = true;
    if (!selectedIndexes.has(i)) toggleSelection(i);
    else updateSelectionUI();
}

function toggleSelection(i) {
    if (selectedIndexes.has(i)) {
        selectedIndexes.delete(i);
    } else {
        if (selectedIndexes.size >= MAX_SEL) {
            const bar = $('#selection-bar');
            bar?.animate(
                [{ transform: 'translate(-50%, 0) scale(1)' }, { transform: 'translate(-50%, 0) scale(1.06)' }, { transform: 'translate(-50%, 0) scale(1)' }],
                { duration: 220 }
            );
            toast(t('sel.tooMany', { max: MAX_SEL }), 'err');
            return;
        }
        selectedIndexes.add(i);
    }
    updateSelectionUI();
}

function clearSelection() {
    selectedIndexes.clear();
    selectionMode = false;
    updateSelectionUI();
}

function updateSelectionUI() {
    document.querySelectorAll('.thumb').forEach(el => {
        const idx = +el.dataset.index;
        el.classList.toggle('selected', selectedIndexes.has(idx));
    });
    const bar = $('#selection-bar');
    const n = selectedIndexes.size;
    if (n === 0) { bar.hidden = true; selectionMode = false; }
    else {
        bar.hidden = false;
        // Render the count using the localized "{n} / {max} selected" string,
        // keeping the <strong> wrapper for the number.
        const wrap = $('#sel-count-wrap');
        const txt  = t('sel.count', { n, max: MAX_SEL });
        // Inject as text + bold for the number we can locate.
        wrap.innerHTML = txt.replace(String(n), `<strong id="sel-count">${n}</strong>`);
    }
}

/* Long-press helper: 450 ms hold without significant move = trigger.
 * Works for both touch and mouse without conflicting with click. */
function attachLongPress(el, cb) {
    let t = 0, sx = 0, sy = 0, fired = false;
    const start = (e) => {
        fired = false;
        const p = e.touches ? e.touches[0] : e;
        sx = p.clientX; sy = p.clientY;
        t = setTimeout(() => { fired = true; cb(); }, 450);
    };
    const move = (e) => {
        const p = e.touches ? e.touches[0] : e;
        if (Math.hypot(p.clientX - sx, p.clientY - sy) > 8) cancel();
    };
    const cancel = () => { clearTimeout(t); t = 0; };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('mousedown', start);
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
    // If long-press fired, swallow the subsequent click so we don't open the editor.
    el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); fired = false; } }, true);
}

$('#sel-clear').addEventListener('click', clearSelection);
$('#sel-post').addEventListener('click', () => beginPostFlow());

/* ---------- Bluesky login modal ---------- */
$('#btn-bsky').addEventListener('click', () => {
    if (bsky.isLoggedIn()) {
        // Quick toggle: show signed-in state via toast + offer sign out
        if (confirm(t('bsky.login.confirmSignOut', { handle: bsky.getSession().handle }))) {
            bsky.logout();
            toast(t('bsky.login.signedOut'));
            updateBskyButton();
        }
    } else {
        openLoginModal();
    }
});

function openLoginModal() {
    const m = $('#bsky-login-modal');
    m.hidden = false;
    // Render the intro line (which contains a translated link to bsky.app).
    const intro = $('#bsky-login-intro');
    if (intro) {
        const link = `<a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener">${tHtml('bsky.login.appPwd')}</a>`;
        // Use tHtml so we can swap {appPwd} with the link safely.
        intro.innerHTML = tHtml('bsky.login.intro').replace('{appPwd}', link);
    }
    setStatusEl($('#bsky-login-status'), '');
    setTimeout(() => m.querySelector('input[name="identifier"]')?.focus(), 50);
}
function closeLoginModal() { $('#bsky-login-modal').hidden = true; }

document.querySelectorAll('[data-close-modal]').forEach(b =>
    b.addEventListener('click', (e) => e.target.closest('.modal').hidden = true)
);

$('#bsky-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const status = $('#bsky-login-status');
    setStatusEl(status, t('bsky.login.signing'));
    try {
        await bsky.login(fd.get('identifier'), fd.get('password'));
        setStatusEl(status, t('bsky.login.success'), 'ok');
        updateBskyButton();
        closeLoginModal();
        toast(t('bsky.login.signedInAs', { handle: bsky.getSession().handle }), 'ok');
        if (pendingPostFlow) { pendingPostFlow = false; openComposeModal(); }
    } catch (err) {
        setStatusEl(status, err.message || String(err), 'err');
    }
});

function updateBskyButton() {
    const btn = $('#btn-bsky');
    if (bsky.isLoggedIn()) {
        btn.title = t('bsky.btn.signedInTitle', { handle: bsky.getSession().handle });
        btn.querySelector('.lbl').textContent = '@' + bsky.getSession().handle.split('.')[0];
    } else {
        btn.title = t('app.bsky.title');
        btn.querySelector('.lbl').textContent = t('app.bsky');
    }
}
updateBskyButton();

/* ---------- Compose modal ---------- */

let pendingPostFlow = false;
let composeImages = [];   // [{itemIndex, file, alt, blob, width, height}]
let composeReply = null;  // {uri, cid, root, parentText, parentAuthor}
let composeBusy = false;

function beginPostFlow() {
    if (selectedIndexes.size === 0) return;
    if (!bsky.isLoggedIn()) {
        pendingPostFlow = true;
        openLoginModal();
        return;
    }
    openComposeModal();
}

async function openComposeModal() {
    const indexes = [...selectedIndexes].sort((a, b) => a - b);
    composeImages = indexes.map(i => {
        const it = items[i];
        // Alt text source: prefer the User comment ("description") field;
        // fall back to ImageDescription ("title") when the comment is empty.
        const ed = it.edits || {};
        const idx = it.metaIndex || {};
        const alt = ed.UserComment || idx.description || ed.ImageDescription || idx.title || '';
        return { itemIndex: i, file: it.file, name: it.name, alt, blob: null, width: 0, height: 0 };
    });
    composeReply = null;

    // Reset UI
    $('#bsky-text').value = '';
    $('#bsky-reply-toggle').checked = false;
    $('#bsky-reply-url').hidden = true;
    $('#bsky-reply-url').value = '';
    $('#bsky-reply-status').hidden = true;
    $('#bsky-reply-ribbon').hidden = true;
    $('#bsky-reply-input').hidden = false;
    $('#bsky-post-status').textContent = '';
    $('#bsky-post-status').className = 'status';
    populateLanguages();
    renderComposeImages();
    updateComposeCount();

    $('#bsky-compose-modal').hidden = false;
    setTimeout(() => $('#bsky-text').focus(), 50);

    // Avatar (best-effort)
    try {
        const p = await bsky.getMyProfile();
        $('#bsky-avatar').src = p?.avatar || './icons/icon.svg';
        $('#bsky-me').textContent = '@' + (p?.handle || bsky.getSession().handle);
    } catch {
        $('#bsky-avatar').src = './icons/icon.svg';
    }
}

function closeComposeModal() {
    if (composeBusy) return;
    $('#bsky-compose-modal').hidden = true;
    composeImages = [];
    composeReply = null;
}

$('#bsky-cancel').addEventListener('click', closeComposeModal);
$('#bsky-signout').addEventListener('click', () => {
    if (composeBusy) return;
    bsky.logout();
    updateBskyButton();
    closeComposeModal();
    toast(t('bsky.login.signedOut'));
});

$('#bsky-text').addEventListener('input', updateComposeCount);

$('#bsky-reply-toggle').addEventListener('change', (e) => {
    const on = e.target.checked;
    $('#bsky-reply-url').hidden = !on;
    if (!on) {
        composeReply = null;
        $('#bsky-reply-ribbon').hidden = true;
        $('#bsky-reply-status').hidden = true;
        updateComposeCount();
    }
});

$('#bsky-reply-url').addEventListener('change', async (e) => {
    const url = e.target.value.trim();
    if (!url) { composeReply = null; $('#bsky-reply-ribbon').hidden = true; updateComposeCount(); return; }
    const status = $('#bsky-reply-status');
    setStatusEl(status, t('bsky.compose.resolving'));
    try {
        composeReply = await bsky.getPostByUrl(url);
        setStatusEl(status, '');
        renderReplyCard(composeReply);
        $('#bsky-reply-ribbon').hidden = false;
        // Collapse the picker once we have a confirmed reply target.
        $('#bsky-reply-input').hidden = true;
    } catch (err) {
        composeReply = null;
        setStatusEl(status, err.message || String(err), 'err');
        $('#bsky-reply-ribbon').hidden = true;
    }
    updateComposeCount();
});

$('#bsky-reply-clear').addEventListener('click', () => {
    composeReply = null;
    $('#bsky-reply-toggle').checked = false;
    $('#bsky-reply-url').hidden = true;
    $('#bsky-reply-url').value = '';
    $('#bsky-reply-ribbon').hidden = true;
    $('#bsky-reply-input').hidden = false;
    updateComposeCount();
});

function renderReplyCard(reply) {
    if (!reply) return;
    $('#bsky-reply-avatar').src = reply.parentAvatar || './icons/icon.svg';
    $('#bsky-reply-name').textContent   = reply.parentDisplayName || reply.parentHandle;
    $('#bsky-reply-author').textContent = '@' + reply.parentHandle;
    $('#bsky-reply-snippet').textContent = reply.parentText || t('bsky.compose.noText');
    const imgs = $('#bsky-reply-images');
    imgs.innerHTML = '';
    (reply.parentImages || []).slice(0, 4).forEach(img => {
        const i = document.createElement('img');
        i.src = img.thumb;
        i.alt = img.alt || '';
        i.title = img.alt || '';
        imgs.appendChild(i);
    });
}

function renderComposeImages() {
    const c = $('#bsky-images');
    c.innerHTML = '';
    composeImages.forEach((img, idx) => {
        const div = document.createElement('div');
        div.className = 'bsky-image';
        const url = URL.createObjectURL(img.file);
        div.innerHTML = `
            <div class="bsky-image-thumb">
                <img src="${url}" alt="" />
                <button type="button" class="img-remove" title="${escapeHtml(t('bsky.compose.removeImage.title'))}" aria-label="${escapeHtml(t('bsky.compose.removeImage'))}">✕</button>
            </div>
            <textarea placeholder="${escapeHtml(t('bsky.compose.altPlaceholder'))}" maxlength="${bsky.MAX_ALT_LEN + 200}">${escapeHtml(img.alt)}</textarea>
            <div class="alt-meta"><span class="src">${escapeHtml(t('bsky.compose.altPrefilled'))}</span><span class="cnt">0 / ${bsky.MAX_ALT_LEN}</span></div>`;
        const ta = div.querySelector('textarea');
        const cnt = div.querySelector('.cnt');
        const meta = div.querySelector('.alt-meta');
        const updateAlt = () => {
            img.alt = ta.value;
            const len = ta.value.length;
            cnt.textContent = `${len} / ${bsky.MAX_ALT_LEN}`;
            meta.classList.toggle('over', len > bsky.MAX_ALT_LEN);
        };
        ta.addEventListener('input', updateAlt);
        updateAlt();
        div.querySelector('.img-remove').addEventListener('click', () => removeComposeImage(img.itemIndex));
        c.appendChild(div);
    });
}

function removeComposeImage(itemIndex) {
    composeImages = composeImages.filter(i => i.itemIndex !== itemIndex);
    // Keep the gallery selection in sync so cancel→reopen reflects what the user kept.
    selectedIndexes.delete(itemIndex);
    updateSelectionUI();
    renderComposeImages();
    updateComposeCount();
    if (composeImages.length === 0 && !$('#bsky-text').value.trim()) {
        // Nothing left to post — just close the modal.
        closeComposeModal();
    }
}

function updateComposeCount() {
    const text = $('#bsky-text').value;
    const len = bsky.graphemeLength(text);
    const remaining = bsky.MAX_TEXT_LEN - len;
    const el = $('#bsky-count');
    el.textContent = remaining;
    el.classList.toggle('warn', remaining < 30 && remaining >= 0);
    el.classList.toggle('over', remaining < 0);
    const canPost = !composeBusy
        && remaining >= 0
        && (text.trim().length > 0 || composeImages.length > 0)
        && composeImages.every(i => (i.alt || '').length <= bsky.MAX_ALT_LEN)
        && (!$('#bsky-reply-toggle').checked || composeReply);
    $('#bsky-post-btn').disabled = !canPost;
}

function populateLanguages() {
    const sel = $('#bsky-lang');
    if (sel.options.length) return;
    const opts = [
        ['en', 'English'], ['pt', 'Português'], ['es', 'Español'],
        ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'],
        ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'], ['ru', 'Русский']
    ];
    for (const [v, l] of opts) {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        sel.appendChild(o);
    }
    const guess = (navigator.language || 'en').slice(0, 2).toLowerCase();
    sel.value = opts.some(o => o[0] === guess) ? guess : 'en';
}

$('#bsky-post-btn').addEventListener('click', submitPost);

async function submitPost() {
    if (composeBusy) return;
    composeBusy = true;
    const status = $('#bsky-post-status');
    setStatusEl(status, t('bsky.compose.preparing'));
    $('#bsky-post-btn').disabled = true;

    try {
        // 1. Resize + upload all images in parallel
        const uploads = await Promise.all(composeImages.map(async (img) => {
            const { blob, width, height } = await bsky.resizeForUpload(img.file);
            const ref = await bsky.uploadBlob(blob);
            return { blob: ref, alt: img.alt, width, height };
        }));

        setStatusEl(status, t('bsky.compose.posting'));

        // 2. Create the post
        const created = await bsky.createPost({
            text: $('#bsky-text').value,
            images: uploads,
            replyTo: composeReply || undefined,
            langs: [$('#bsky-lang').value],
            threadgate: $('#bsky-threadgate').value
        });

        const url = bsky.postUriToWebUrl(created.uri);
        setStatusEl(status, t('bsky.compose.posted'), 'ok');
        toast(t('bsky.compose.postedToast'), 'ok');
        // Open the post in a new tab so user can verify
        window.open(url, '_blank', 'noopener');
        composeBusy = false;
        clearSelection();
        closeComposeModal();
    } catch (err) {
        console.error(err);
        composeBusy = false;
        setStatusEl(status, t('bsky.compose.failed', { err: err?.message || err }), 'err');
        updateComposeCount();
    }
}

function setStatusEl(el, msg, kind = '') {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
    el.hidden = !msg;
}

/* ---------- Editor ---------- */
const form = $('#meta-form');
$('#btn-close-editor').addEventListener('click', closeEditor);
$('#btn-revert').addEventListener('click', () => {
    if (currentIndex < 0) return;
    items[currentIndex].edits = null;
    items[currentIndex].dirty = false;
    openItem(currentIndex);
    setStatus(t('editor.status.reverted'), 'ok');
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
        setStatus(t('editor.status.unsupported', { fmt: fmt.toUpperCase() || 'this format' }), 'err');
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
        setStatus(t('editor.status.unsupported.gen'), 'err');
        return;
    }
    const vals = readForm();
    setStatus(t('editor.status.saving'));
    try {
        const blob = await writeMetadata(it.file, vals);

        if (download || !it.handle) {
            triggerDownload(blob, it.name);
            setStatus(t('editor.status.downloaded'), 'ok');
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
            setStatus(t('editor.status.saved'), 'ok');
            document.querySelector(`#file-list li[data-index="${currentIndex}"]`)?.classList.remove('dirty');
            document.querySelector(`.thumb[data-index="${currentIndex}"]`)?.classList.remove('dirty');
            toast(t('editor.toast.saved', { name: it.name }), 'ok');
        }
    } catch (err) {
        console.error(err);
        setStatus(t('editor.status.saveFailed', { err: err?.message || err }), 'err');
        toast(t('editor.toast.saveFailed'), 'err');
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
