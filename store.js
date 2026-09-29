// TennisTavoloManager - store.js  (PWA cloud)
// Copia locale del cloud in IndexedDB: una tabella per ogni tabella di
// Supabase, stesse colonne (snake_case), chiave = uid.
// Le righe cancellate restano con eliminato = true: le funzioni di lettura
// le nascondono, il sync le usa.
// 'outbox' = righe modificate sul telefono e non ancora inviate.
// 'meta'   = segni di avanzamento del sync e impostazioni locali.

// Ordine di dipendenza (prima i padri): lo stesso del SyncService sul PC.
const TABELLE = ['societa', 'campionati', 'atleti', 'atleti_societa', 'squadre', 'atleti_squadre',
    'giornate', 'incontri', 'partite', 'sets', 'log_punti', 'formazioni'];

const INDICI = {
    atleti_societa: ['societa_uid', 'atleta_uid'],
    squadre: ['campionato_uid'],
    atleti_squadre: ['squadra_uid'],
    giornate: ['campionato_uid'],
    incontri: ['giornata_uid'],
    partite: ['incontro_uid'],
    sets: ['partita_uid'],
    log_punti: ['set_uid'],
    formazioni: ['incontro_uid']
};

// Campi dell'incontro che il telefono puo' cambiare (formazione e gara).
// Il resto e' calendario: lo scrive solo il PC.
const GARA_INCONTRO = ['squadra_lettere_abc_uid', 'colore_maglia_casa', 'colore_maglia_ospite',
    'ora_presentazione_casa', 'ora_presentazione_ospite', 'ora_inizio', 'ora_fine',
    'stato', 'punti_casa', 'punti_ospite', 'punti_class_casa', 'punti_class_ospite',
    // dati del referto: stessi di SyncService.ColonneGaraIncontro e del grant in rls.sql
    'tavolo', 'palline', 'giudice_arbitro', 'qualifica_arbitro',
    'defibrillatore', 'operatore_dae', 'provvedimenti_disciplinari'];

// Minimo di atleti in rosa per poter giocare = titolari della formula del
// campionato. Come FormuleGioco.MinimoRosa sul PC: Courbillon 2, le altre 3.
// formula arriva dal cloud come nome dell'enum (CodiceFormula).
function minimoRosa(formula) {
    return formula === 'Courbillon' || formula === 'CsiCorbillon' ? 2 : 3;
}

const DB_NOME = 'ttm';
const DB_VERSIONE = 1;
let _db = null;

// Promessa su una richiesta IndexedDB
const idbReq = r => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
// Promessa sulla fine di una transazione (i dati sono davvero scritti solo qui)
const idbFine = t => new Promise((ok, ko) => { t.oncomplete = () => ok(); t.onerror = t.onabort = () => ko(t.error); });

function apriDb() {
    if (_db) return Promise.resolve(_db);
    return new Promise((ok, ko) => {
        const r = indexedDB.open(DB_NOME, DB_VERSIONE);
        r.onupgradeneeded = () => {
            const db = r.result;
            for (const t of TABELLE) {
                const s = db.createObjectStore(t, { keyPath: 'uid' });
                for (const i of INDICI[t] || []) s.createIndex(i, i);
            }
            db.createObjectStore('outbox', { keyPath: 'chiave' });
            db.createObjectStore('meta');
        };
        r.onsuccess = () => { _db = r.result; ok(_db); };
        r.onerror = () => ko(r.error);
    });
}

const nuovoUid = () => crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,
        c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
const adesso = () => new Date().toISOString();

// ---------------- lettura (solo righe vive) ----------------
async function tutti(t) {
    const db = await apriDb();
    const righe = await idbReq(db.transaction(t).objectStore(t).getAll());
    return righe.filter(r => !r.eliminato);
}

async function perIndice(t, indice, valore) {
    const db = await apriDb();
    const righe = await idbReq(db.transaction(t).objectStore(t).index(indice).getAll(valore));
    return righe.filter(r => !r.eliminato);
}

// Anche se eliminata: serve al sync e per riusare righe di rosa tolte.
async function leggi(t, uid) {
    const db = await apriDb();
    return idbReq(db.transaction(t).objectStore(t).get(uid));
}

async function metaLeggi(chiave, predefinito = null) {
    const db = await apriDb();
    const v = await idbReq(db.transaction('meta').objectStore('meta').get(chiave));
    return v === undefined ? predefinito : v;
}

async function metaScrivi(chiave, valore) {
    const db = await apriDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(valore, chiave);
    return idbFine(tx);
}

async function contaInAttesa() {
    const db = await apriDb();
    return idbReq(db.transaction('outbox').objectStore('outbox').count());
}

// ---------------- scrittura locale (va in outbox) ----------------
// righe: [{ t: 'atleti_squadre', riga: {...} }, ...] tutte nella stessa
// transazione: o passano tutte o nessuna.
// Per gli incontri si timbra gara_modificato_il (il telefono non tocca il
// calendario); per le altre tabelle modificato_il.
async function scriviLocale(righe) {
    const db = await apriDb();
    const nomi = [...new Set(righe.map(x => x.t)), 'outbox'];
    const tx = db.transaction(nomi, 'readwrite');
    const ora = adesso();
    for (const { t, riga } of righe) {
        if (!riga.uid) riga.uid = nuovoUid();
        if (riga.eliminato === undefined) riga.eliminato = false;
        if (t === 'incontri') riga.gara_modificato_il = ora;
        else riga.modificato_il = ora;
        tx.objectStore(t).put(riga);
        // rev: il push cancella la voce solo se nel frattempo non e' cambiata
        tx.objectStore('outbox').put({ chiave: t + ':' + riga.uid, tabella: t, uid: riga.uid, rev: ora + Math.random() });
    }
    await idbFine(tx);
    document.dispatchEvent(new Event('ttm-locale'));
}

// Cancella tutto (logout). Il db si ricrea alla prossima apertura.
async function svuotaDb() {
    if (_db) { _db.close(); _db = null; }
    await idbReq(indexedDB.deleteDatabase(DB_NOME));
}
