/**
 * approachNet.js — Approach multiplayer: the connection to the lobby server
 * (the ACARS backend's /approach Socket.IO namespace, approach_mp.cjs there).
 *
 * Players use their InFlight login: the same Supabase account as the map, read
 * from the session the site already keeps (same origin, so signing in on the
 * map signs you in here). The socket connects with its access token, and the
 * server takes the name others see from the account.
 *
 * The Socket.IO and Supabase clients load only when someone opens multiplayer.
 */

// window.APPROACH_MP_URL points a test page at a local lobby.
export const MP_URL = window.APPROACH_MP_URL || 'https://site--acars-backend--6dmjph8ltlhv.code.run';
const IO_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.min.js';
const SUPABASE_URL = 'https://lcgaoiqwwpyqndaucyzu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZ2FvaXF3d3B5cW5kYXVjeXp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNjkyOTksImV4cCI6MjA4NzY0NTI5OX0.9TO21knXR_P9E80pea7gUOu-gTjb17sCGk7BYgRRe3U';

let sb = null;
async function supabase() {
    if (!sb) {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return sb;
}

/** The signed-in InFlight account: { id, name, token }, name '' with no IF username on it; null when signed out. */
export async function account() {
    // A test page signs in without Supabase.
    if (window.APPROACH_TEST_ACCOUNT) return window.APPROACH_TEST_ACCOUNT;
    const { data } = await (await supabase()).auth.getSession();
    const s = data?.session;
    if (!s) return null;
    const m = s.user.user_metadata || {};
    return { id: s.user.id, name: m.if_username || m.username || m.full_name || m.name || '', token: s.access_token };
}

/** Calls fn when someone signs in or out (here or in another tab). */
export async function onAccountChange(fn) {
    if (window.APPROACH_TEST_ACCOUNT) return;
    (await supabase()).auth.onAuthStateChange(() => fn());
}

let ioReady = null;
function loadIo() {
    if (window.io) return Promise.resolve(window.io);
    return ioReady ||= new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = IO_SRC;
        s.onload = () => res(window.io);
        s.onerror = () => { ioReady = null; rej(new Error('Couldn\'t load the multiplayer client.')); };
        document.head.appendChild(s);
    });
}

let sock = null, ready = null;
const NO_ANSWER = 'The multiplayer server didn\'t answer. Check your connection and try again.';

/**
 * The one socket, connected. It signs in with the account's current token on
 * every (re)connect. Refused (signed out, an expired sign-in), it rejects with
 * the server's reason and tries again, freshly signed in, on the next call.
 */
export async function socket() {
    const io = await loadIo();
    if (!sock) {
        sock = io(MP_URL + '/approach', {
            transports: ['websocket', 'polling'],
            auth: cb => account().then(a => cb({ token: a?.token || '' }), () => cb({ token: '' })),
        });
    }
    if (sock.connected) return sock;
    ready ||= new Promise((res, rej) => {
        const done = () => { sock.off('connect', ok); sock.off('connect_error', bad); clearTimeout(t); ready = null; };
        const ok = () => { done(); res(sock); };
        // A refusal stops the socket; a network failure leaves it retrying, and the timer gives up on it.
        const bad = err => { if (sock.active) return; done(); rej(new Error(err.message || NO_ANSWER)); };
        const t = setTimeout(() => { done(); rej(new Error(NO_ANSWER)); }, 10000);
        sock.on('connect', ok);
        sock.on('connect_error', bad);
        if (!sock.active) sock.connect();
    });
    return ready;
}

/** An event with an answer: resolves with it, rejects with its error or after 10 s. */
export async function call(ev, ...args) {
    const s = await socket();
    return new Promise((res, rej) => {
        s.timeout(10000).emit(ev, ...args, (err, r) => {
            if (err) rej(new Error(NO_ANSWER));
            else if (r?.error) rej(Object.assign(new Error(r.error), { session: r.session }));
            else res(r);
        });
    });
}

/** Drops the connection (the next call connects again, with the account signed in then). */
export function disconnect() {
    if (sock?.connected) sock.disconnect();
}

/** A relayed message: from the host to one player (to) or everyone; from a guest, to the host. */
export function send(type, data, to) {
    if (sock?.connected) sock.emit('send', to == null ? { type, data } : { to, type, data });
}
