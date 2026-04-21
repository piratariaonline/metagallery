/* MetaGallery — Bluesky client (AT Protocol over XRPC).
 *
 * Authentication:
 *   - On the production host (`metagallery.alanmm.dev`), the user signs in
 *     via OAuth (see `./oauth.js`). All XRPC calls are routed through the
 *     OAuth-bound `Agent` from `@atproto/api` (which handles DPoP, PDS
 *     resolution and token refresh).
 *   - On any other host (localhost / LAN / dev preview), the OAuth client
 *     metadata isn't reachable, so we fall back to app-password auth via
 *     `login()` against `bsky.social` and store an app-password session in
 *     localStorage.
 *
 * The rest of the surface (`uploadBlob`, `createPost`, `getPostByUrl`,
 * `setThreadgate`, `resizeForUpload`) is identical for both paths.
 *
 * Notes:
 *   - App-password path assumes bsky.social PDS. OAuth path resolves the
 *     user's real PDS automatically via the DID document.
 *   - Bluesky enforces ~976 KB / blob; we resize before upload.
 *   - Facets: URLs and #tags. @mentions need handle→DID lookups; skipped
 *     for v1 (mentions still render as plain text).
 */

import * as oauth from './oauth.js';

const PDS = 'https://bsky.social';
const STORAGE_KEY = 'metagallery.bsky.session';

const MAX_BLOB_BYTES = 950_000;   // a hair under the 976_640 server limit
const MAX_IMAGE_LONG_EDGE = 2000;
const MAX_IMAGES_PER_POST = 4;
export const MAX_TEXT_LEN = 300;
export const MAX_ALT_LEN  = 2000;

let session = loadSession();
let profileCache = null;

function loadSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}
function saveSession() {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else         localStorage.removeItem(STORAGE_KEY);
}

export function isLoggedIn() { return oauth.isLoggedIn() || !!session; }
export function getSession() {
    if (oauth.isLoggedIn()) {
        const did = oauth.getDid();
        // For OAuth we don't always have the handle synchronously; expose the
        // DID and let `getMyProfile()` fill in the rest.
        return { did, handle: did, oauth: true };
    }
    return session ? { ...session } : null;
}
export function getDid() {
    return oauth.isLoggedIn() ? oauth.getDid() : (session?.did || null);
}
export function isOAuth() { return oauth.isLoggedIn(); }

/* ---------- Auth ---------- */

export async function login(identifier, password) {
    const id = String(identifier || '').trim().replace(/^@/, '');
    if (!id || !password) throw new Error('Handle and app password are required.');
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: id, password })
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.message || `Login failed (${res.status})`);
    session = {
        did: data.did,
        handle: data.handle,
        accessJwt: data.accessJwt,
        refreshJwt: data.refreshJwt
    };
    profileCache = null;
    saveSession();
    return session;
}

export function logout() {
    session = null;
    profileCache = null;
    saveSession();
    // Best-effort OAuth revoke; non-blocking for the caller.
    if (oauth.isLoggedIn()) oauth.signOut().catch(() => {});
}

async function refreshSession() {
    if (!session?.refreshJwt) throw new Error('No refresh token');
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.refreshSession`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.refreshJwt}` }
    });
    if (!res.ok) {
        logout();
        throw new Error('Session expired — please sign in again.');
    }
    const data = await res.json();
    session = { ...session, accessJwt: data.accessJwt, refreshJwt: data.refreshJwt };
    saveSession();
}

/* ---------- XRPC core ---------- */

async function xrpc(method, opts = {}) {
    // OAuth path: delegate to the @atproto/api Agent, which handles DPoP,
    // PDS routing and token refresh transparently.
    if (oauth.isLoggedIn()) {
        const agent = oauth.getAgent();
        if (!agent) throw new Error('OAuth session not ready.');
        const callOpts = {};
        if (opts.contentType) callOpts.encoding = opts.contentType;
        if (opts.headers) callOpts.headers = opts.headers;
        try {
            const res = await agent.call(method, opts.params, opts.body, callOpts);
            return res?.data ?? res;
        } catch (err) {
            // Surface the underlying error message in the same shape callers expect.
            const msg = err?.error?.message || err?.message || `${method} failed`;
            throw new Error(msg);
        }
    }

    // App-password path (dev / non-prod hosts).
    if (!session) throw new Error('Not signed in.');
    const search = opts.params ? '?' + new URLSearchParams(opts.params).toString() : '';
    const url = `${PDS}/xrpc/${method}${search}`;
    const headers = { authorization: `Bearer ${session.accessJwt}`, ...(opts.headers || {}) };

    let body = undefined;
    if (opts.body !== undefined) {
        if (opts.contentType) {
            headers['content-type'] = opts.contentType;
            body = opts.body;
        } else {
            headers['content-type'] = 'application/json';
            body = JSON.stringify(opts.body);
        }
    }

    let res = await fetch(url, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body });
    if (res.status === 401) {
        await refreshSession();
        headers.authorization = `Bearer ${session.accessJwt}`;
        res = await fetch(url, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body });
    }
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.message || `${method} failed (${res.status})`);
    return data;
}

async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
}

/* ---------- Profile ---------- */

export async function getMyProfile() {
    if (oauth.isLoggedIn()) return oauth.getMyProfile();
    if (!session) return null;
    if (profileCache) return profileCache;
    try {
        const data = await xrpc('app.bsky.actor.getProfile', { params: { actor: session.did } });
        profileCache = data;
        return data;
    } catch (e) {
        console.warn('getProfile failed', e);
        return { did: session.did, handle: session.handle, avatar: null, displayName: session.handle };
    }
}

/* ---------- Image resize for upload ---------- */

export async function resizeForUpload(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        // Fallback: <img> decode
        bitmap = await loadViaImg(file);
    }
    const w0 = bitmap.width, h0 = bitmap.height;
    const scale = Math.min(1, MAX_IMAGE_LONG_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    let quality = 0.85;
    let blob = null;
    for (let i = 0; i < 6; i++) {
        blob = await drawToBlob(bitmap, w, h, quality);
        if (blob && blob.size <= MAX_BLOB_BYTES) break;
        quality = Math.max(0.4, quality - 0.12);
    }
    bitmap.close?.();
    if (!blob) throw new Error('Could not encode image for upload.');
    return { blob, width: w, height: h };
}

async function drawToBlob(bitmap, w, h, quality) {
    if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        return await c.convertToBlob({ type: 'image/jpeg', quality });
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}

function loadViaImg(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
    });
}

/* ---------- Blob upload ---------- */

export async function uploadBlob(blob) {
    const data = await xrpc('com.atproto.repo.uploadBlob', {
        method: 'POST',
        body: blob,
        contentType: blob.type || 'application/octet-stream'
    });
    return data.blob; // { $type: 'blob', ref, mimeType, size }
}

/* ---------- Reply resolution ---------- */

export async function resolveHandle(handle) {
    const data = await xrpc('com.atproto.identity.resolveHandle', { params: { handle } });
    return data.did;
}

/** Accepts a `https://bsky.app/profile/<handle|did>/post/<rkey>` URL.
 *  Returns a rich object suitable for both the replyTo wire format *and*
 *  rendering a preview card:
 *    {
 *      uri, cid,
 *      root: {uri, cid},
 *      parentDid, parentHandle, parentDisplayName, parentAvatar,
 *      parentText,
 *      parentImages: [{thumb, alt}]
 *    }
 */
export async function getPostByUrl(url) {
    const m = String(url || '').match(/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!m) throw new Error('Not a Bluesky post URL.');
    const idInUrl = decodeURIComponent(m[1]);
    const rkey = decodeURIComponent(m[2]);
    const did = idInUrl.startsWith('did:') ? idInUrl : await resolveHandle(idInUrl);
    const atUri = `at://${did}/app.bsky.feed.post/${rkey}`;

    const data = await xrpc('app.bsky.feed.getPostThread', {
        params: { uri: atUri, depth: 0, parentHeight: 0 }
    });
    const post = data?.thread?.post;
    if (!post) throw new Error('Post not found.');

    // Extract image previews from any embed shape we recognise.
    const parentImages = extractEmbedImages(post.embed);

    // The conversation root (for the reply ref).
    const root = post.record?.reply?.root || { uri: post.uri, cid: post.cid };

    return {
        uri: post.uri,
        cid: post.cid,
        root,
        parentDid: post.author?.did || did,
        parentHandle: post.author?.handle || (idInUrl.startsWith('did:') ? did : idInUrl),
        parentDisplayName: post.author?.displayName || post.author?.handle || '',
        parentAvatar: post.author?.avatar || '',
        parentText: post.record?.text || '',
        parentImages
    };
}

function extractEmbedImages(embed) {
    if (!embed) return [];
    // Direct images embed view
    if (embed.$type === 'app.bsky.embed.images#view' && Array.isArray(embed.images)) {
        return embed.images.map(i => ({ thumb: i.thumb, alt: i.alt || '' }));
    }
    // recordWithMedia: images live under .media
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
        return extractEmbedImages(embed.media);
    }
    return [];
}

/* ---------- Facets (URLs + #tags) ---------- */

const enc = new TextEncoder();
function byteIdx(text, charIdx) { return enc.encode(text.slice(0, charIdx)).length; }

function parseFacets(text) {
    const facets = [];
    // URLs — terminate on whitespace or common trailing punctuation
    const urlRe = /https?:\/\/[^\s]+[^\s.,:;!?)\]'"]/g;
    let m;
    while ((m = urlRe.exec(text)) !== null) {
        facets.push({
            index: { byteStart: byteIdx(text, m.index), byteEnd: byteIdx(text, m.index + m[0].length) },
            features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }]
        });
    }
    // #tags (Unicode letters/numbers, ≤ 64 chars per Bluesky spec)
    const tagRe = /(^|\s)(#[\p{L}\p{N}_]{1,64})/gu;
    while ((m = tagRe.exec(text)) !== null) {
        const tagStart = m.index + m[1].length;
        const tagEnd   = tagStart + m[2].length;
        facets.push({
            index: { byteStart: byteIdx(text, tagStart), byteEnd: byteIdx(text, tagEnd) },
            features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2].slice(1) }]
        });
    }
    return facets;
}

/* ---------- Post creation ---------- */

/**
 * @param {Object} opts
 * @param {string} opts.text
 * @param {Array<{blob:Object, alt:string, width:number, height:number}>} [opts.images]
 * @param {{uri:string, cid:string, root:{uri:string,cid:string}}} [opts.replyTo]
 * @param {string[]} [opts.langs]   e.g. ['en']
 * @param {'everybody'|'following'|'mentioned'|'nobody'} [opts.threadgate]
 */
export async function createPost(opts) {
    if (!isLoggedIn()) throw new Error('Not signed in.');
    const repo = getDid();
    if (!repo) throw new Error('Could not resolve your DID.');
    const { text = '', images = [], replyTo, langs, threadgate } = opts;

    const record = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString()
    };
    const facets = parseFacets(text);
    if (facets.length) record.facets = facets;
    if (langs?.length) record.langs = langs.slice(0, 3);

    if (images.length) {
        if (images.length > MAX_IMAGES_PER_POST) {
            throw new Error(`Bluesky allows up to ${MAX_IMAGES_PER_POST} images per post.`);
        }
        record.embed = {
            $type: 'app.bsky.embed.images',
            images: images.map(img => ({
                image: img.blob,
                alt: (img.alt || '').slice(0, MAX_ALT_LEN),
                aspectRatio: { width: img.width, height: img.height }
            }))
        };
    }

    if (replyTo) {
        record.reply = {
            root:   { uri: replyTo.root.uri, cid: replyTo.root.cid },
            parent: { uri: replyTo.uri,      cid: replyTo.cid }
        };
    }

    const created = await xrpc('com.atproto.repo.createRecord', {
        method: 'POST',
        body: { repo, collection: 'app.bsky.feed.post', record }
    });

    // Threadgate (only meaningful on top-level posts; skip on replies)
    if (!replyTo && threadgate && threadgate !== 'everybody') {
        try { await setThreadgate(created.uri, threadgate); }
        catch (e) { console.warn('threadgate failed', e); }
    }

    return created; // { uri, cid }
}

async function setThreadgate(postUri, mode) {
    // The threadgate record's rkey must match the post's rkey.
    const rkey = postUri.split('/').pop();
    const allow = (() => {
        if (mode === 'nobody')    return [];
        if (mode === 'mentioned') return [{ $type: 'app.bsky.feed.threadgate#mentionRule' }];
        if (mode === 'following') return [{ $type: 'app.bsky.feed.threadgate#followingRule' }];
        return undefined; // everybody
    })();
    const record = {
        $type: 'app.bsky.feed.threadgate',
        post: postUri,
        createdAt: new Date().toISOString(),
        allow
    };
    await xrpc('com.atproto.repo.createRecord', {
        method: 'POST',
        body: { repo: getDid(), collection: 'app.bsky.feed.threadgate', rkey, record }
    });
}

/* ---------- Helper: convert at:// URI → bsky.app web URL ---------- */
export function postUriToWebUrl(uri, handle) {
    // at://did:plc:xxx/app.bsky.feed.post/3kabc
    const parts = String(uri).split('/');
    const rkey = parts[parts.length - 1];
    const id = handle || session?.handle || getDid() || parts[2];
    return `https://bsky.app/profile/${id}/post/${rkey}`;
}

/* ---------- Grapheme counting (Bluesky counts graphemes, not chars) ---------- */
const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
export function graphemeLength(s) {
    if (!s) return 0;
    if (!segmenter) return [...s].length; // good enough fallback
    let n = 0;
    for (const _ of segmenter.segment(s)) n++;
    return n;
}
