/* MetaGallery — Bluesky OAuth (AT Protocol).
 *
 * Lazy-loads the vendored `@atproto/oauth-client-browser` + `@atproto/api`
 * bundle (`./vendor/atproto-oauth.bundle.js`, built locally via
 * `npm run build:vendor`) the first time the user signs in. Keeps the
 * cold-start payload tiny for visitors who never click "Sign in".
 *
 * OAuth is only used on the production host where `client-metadata.json`
 * is reachable and listed `redirect_uris` matches the current origin.
 * On any other host (localhost, LAN IP, Pages preview), `isOAuthHost()`
 * returns false and the rest of the app falls back to app-password auth.
 */

const PROD_ORIGIN = 'https://metagallery.alanmm.dev';
const CLIENT_ID   = `${PROD_ORIGIN}/client-metadata.json`;
const BUNDLE_URL  = './vendor/atproto-oauth.bundle.js';

let _modulePromise = null;
let client = null;
let session = null;
let agent   = null;
let profile = null;

export function isOAuthHost() {
    return location.origin === PROD_ORIGIN;
}

async function loadModules() {
    if (!_modulePromise) {
        _modulePromise = import(BUNDLE_URL).then(mod => ({
            BrowserOAuthClient: mod.BrowserOAuthClient,
            Agent: mod.Agent
        }));
    }
    return _modulePromise;
}

/** Initialise OAuth: handles the /?code=... callback if present, or restores
 *  a stored session. Safe to call on every boot. Returns the active session
 *  (or null if not signed in). No-op on non-prod hosts. */
export async function init() {
    if (!isOAuthHost()) return null;
    const { BrowserOAuthClient, Agent } = await loadModules();

    client = await BrowserOAuthClient.load({
        clientId: CLIENT_ID,
        handleResolver: 'https://bsky.social'
    });

    let result = null;
    try {
        result = await client.init();
    } catch (e) {
        console.warn('[oauth] init failed', e);
        // Clean any leftover ?code/state params so the URL doesn't keep
        // erroring on every reload.
        try {
            const u = new URL(location.href);
            ['code', 'state', 'iss', 'error', 'error_description'].forEach(p => u.searchParams.delete(p));
            history.replaceState(null, '', u.toString());
        } catch {}
        throw e;
    }

    if (result?.session) {
        session = result.session;
        agent = new Agent(session);
    }
    return session;
}

/** Begin the sign-in flow. `handle` may be a handle (alice.bsky.social),
 *  a DID, or a PDS URL. Causes a full-page redirect to the auth server;
 *  the returned Promise typically does not resolve. */
export async function signIn(handle) {
    if (!isOAuthHost()) throw new Error('OAuth is only available on the production host.');
    if (!client) await init();
    if (!client) throw new Error('OAuth client failed to initialise.');
    const id = String(handle || '').trim().replace(/^@/, '');
    if (!id) throw new Error('Please enter your Bluesky handle (e.g. alice.bsky.social).');
    await client.signIn(id, { state: 'metagallery' });
}

/** Revoke tokens & clear local OAuth session. */
export async function signOut() {
    if (!client || !session) { session = agent = profile = null; return; }
    try { await client.revoke(session.sub); } catch (e) { console.warn('[oauth] revoke failed', e); }
    session = agent = profile = null;
}

export function isLoggedIn() { return !!session; }
export function getDid()     { return session?.did || null; }
export function getAgent()   { return agent; }

/** Lightweight profile cache (avatar/displayName/handle) for the compose UI. */
export async function getMyProfile() {
    if (!agent || !session) return null;
    if (profile) return profile;
    try {
        const res = await agent.app.bsky.actor.getProfile({ actor: session.did });
        profile = res.data;
        return profile;
    } catch (e) {
        console.warn('[oauth] getProfile failed', e);
        return { did: session.did, handle: session.did, avatar: null, displayName: '' };
    }
}
