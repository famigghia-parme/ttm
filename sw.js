// TennisTavoloManager - sw.js  (PWA cloud)
// Service worker: tiene in cache l'app, cosi' si apre anche senza rete.
// VERSIONE va aumentata a OGNI modifica di un file dell'app, insieme al ?v=
// di index.html (stesso numero). Il telefono vede la nuova versione e
// mostra "Nuova versione disponibile".
// Le chiamate a Supabase non passano da qui (altro dominio).

const VERSIONE = '1.6.0';
const CACHE = 'ttm-' + VERSIONE;

// Tutti i file caricati con ?v= da index.html (script e foglio di stile)
const SCRIPT = ['stile.css', 'comune.js', 'config.js', 'store.js', 'cloud.js', 'sync.js', 'app.js', 'incontri.js', 'formazione.js', 'disponibilita.js', 'referto.js', 'pdf.js', 'gioco.js', 'live.js', 'risultati.js', 'classifica.js', 'tornei.js', 'ranking.js', 'rosa.js', 'atleti.js'];
const FILE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
    ...SCRIPT.map(s => `${s}?v=${VERSIONE}`)];

// Modelli del referto PDF (pdf.js), cartella referti/: piu' di 1 MB, cambiano
// di rado. Stanno in una cache loro, che NON si butta a ogni versione
// dell'app: si riscaricano solo quando cambia MODELLI_VERSIONE (da
// aumentare se si sostituisce un modello o se ne aggiunge uno).
const MODELLI_VERSIONE = '1';
const CACHE_MODELLI = 'ttm-modelli-' + MODELLI_VERSIONE;
const MODELLI = ['fitet_corbillon', 'fitet_mini_doppio', 'csi_corbillon']
    .flatMap(m => [`referti/${m}.pdf`, `referti/${m}.json`]);

// Scarica i modelli che mancano. Un errore qui NON deve bloccare
// l'aggiornamento dell'app: il modello che manca si prendera' dalla rete
// alla prima richiesta (vedi fetch).
async function scaricaModelli() {
    try {
        const c = await caches.open(CACHE_MODELLI);
        for (const m of MODELLI)
            if (!(await c.match(m))) await c.add(new Request(m, { cache: 'reload' })).catch(() => { });
    } catch { }
}

self.addEventListener('install', e => {
    // cache: 'reload' = dalla rete, non dalla cache HTTP del browser
    e.waitUntil(Promise.all([
        caches.open(CACHE).then(c => c.addAll(FILE.map(f => new Request(f, { cache: 'reload' })))),
        scaricaModelli()]));
    // Niente skipWaiting qui: la nuova versione parte quando l'utente tocca
    // "aggiorna" (vedi message), non a meta' di una gara.
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k !== CACHE && k !== CACHE_MODELLI) await caches.delete(k);
        await self.clients.claim();
    })());
});

// 'aggiorna': parte la versione nuova in attesa (banner giallo).
// 'ricarica' (12/11, 1.4.1): "Ricarica i file dell'app" in Account. Riscarica
// dalla rete i file dell'app nella cache di QUESTA versione, anche se il
// numero non e' cambiato (prove). Tutto o niente: prima si scaricano tutti,
// poi si sostituiscono; se uno non arriva non si tocca nulla. Risposta sulla
// porta del messaggio: true oppure il testo dell'errore.
self.addEventListener('message', e => {
    if (e.data === 'aggiorna') self.skipWaiting();
    else if (e.data === 'ricarica') {
        const porta = e.ports && e.ports[0];
        e.waitUntil(ricaricaFile().then(() => porta?.postMessage(true), err => porta?.postMessage(String(err?.message || err))));
    }
});

async function ricaricaFile() {
    const scaricati = await Promise.all(FILE.map(async f => {
        const r = await fetch(new Request(f, { cache: 'reload' }));
        if (!r.ok) throw new Error(`${f}: risposta ${r.status}`);
        return [f, r];
    }));
    const c = await caches.open(CACHE);
    for (const [f, r] of scaricati) await c.put(f, r);
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    // Pagina: sempre index.html dalla cache (funziona offline)
    if (req.mode === 'navigate') {
        e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
        return;
    }
    // Modello del referto non in cache (scarico fallito all'installazione):
    // lo si prende dalla rete e lo si tiene per la prossima volta.
    if (new URL(req.url).pathname.includes('/referti/')) {
        e.respondWith(caches.match(req).then(r => r || fetch(req).then(async risposta => {
            if (risposta.ok) (await caches.open(CACHE_MODELLI)).put(req, risposta.clone());
            return risposta;
        })));
        return;
    }
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
