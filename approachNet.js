/**
 * approachNet.js — Approach multiplayer: the connection to the lobby server
 * (the ACARS backend's /approach Socket.IO namespace, approach_mp.cjs there).
 *
 * The Socket.IO client loads only when someone opens multiplayer.
 */

// window.APPROACH_MP_URL points a test page at a local lobby.
export const MP_URL = window.APPROACH_MP_URL || 'https://site--acars-backend--6dmjph8ltlhv.code.run';
const IO_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.min.js';

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

let sock = null;
/** The one socket, connected on first use. */
export async function socket() {
    const io = await loadIo();
    if (!sock) sock = io(MP_URL + '/approach', { transports: ['websocket', 'polling'] });
    return sock;
}

/** An event with an answer: resolves with it, rejects with its error or after 10 s. */
export async function call(ev, ...args) {
    const s = await socket();
    return new Promise((res, rej) => {
        s.timeout(10000).emit(ev, ...args, (err, r) => {
            if (err) rej(new Error('The multiplayer server didn\'t answer. Check your connection and try again.'));
            else if (r?.error) rej(Object.assign(new Error(r.error), { session: r.session }));
            else res(r);
        });
    });
}

/** A relayed message: from the host to one player (to) or everyone; from a guest, to the host. */
export function send(type, data, to) {
    if (sock) sock.emit('send', to == null ? { type, data } : { to, type, data });
}
