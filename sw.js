// TennisTavoloManager - sw.js  (PWA cloud)
// Service worker: tiene in cache l'app, cosi' si apre anche senza rete.
// VERSIONE va aumentata a OGNI modifica di un file dell'app, insieme al ?v=
// di index.html (stesso numero). Il telefono vede la nuova versione e
// mostra "Nuova versione disponibile".
// Le chiamate a Supabase non passano da qui (altro dominio).

const VERSIONE = '3.13.3';
const CACHE = 'ttm-' + VERSIONE;

const SCRIPT = ['config.js', 'store.js', 'cloud.js', 'sync.js', 'app.js', 'incontri.js', 'formazione.js', 'gioco.js', 'live.js', 'rosa.js', 'atleti.js'];
const FILE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
    ...SCRIPT.map(s => `${s}?v=${VERSIONE}`)];

self.addEventListener('install', e => {
    // cache: 'reload' = dalla rete, non dalla cache HTTP del browser
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILE.map(f => new Request(f, { cache: 'reload' })))));
    // Niente skipWaiting qui: la nuova versione parte quando l'utente tocca
    // "aggiorna" (vedi message), non a meta' di una gara.
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
        await self.clients.claim();
    })());
});

self.addEventListener('message', e => { if (e.data === 'aggiorna') self.skipWaiting(); });

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    // Pagina: sempre index.html dalla cache (funziona offline)
    if (req.mode === 'navigate') {
        e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
        return;
    }
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
