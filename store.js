// TennisTavoloManager - store.js  (PWA cloud)
// Copia locale del cloud in IndexedDB: una tabella per ogni tabella di
// Supabase, stesse colonne (snake_case), chiave = uid.
// Le righe cancellate restano con eliminato = true: le funzioni di lettura
// le nascondono, il sync le usa.
// 'outbox' = righe modificate sul telefono e non ancora inviate.
// 'meta'   = segni di avanzamento del sync e impostazioni locali.

// ---------------- ambiente Reale / Prova ----------------
// Come le due cartelle dati del PC: ogni ambiente ha il suo progetto
// Supabase (config.js), il suo IndexedDB e il suo accesso. Si sceglie al
// login o da Account; il cambio ricarica la pagina (niente dati mescolati
// in memoria). CONFIG.SUPABASE_URL/KEY sono quelli dell'ambiente scelto.
const ambienteConfigurato = a => {
    const c = CONFIG.AMBIENTI?.[a];
    return !!c && /^https?:\/\/.+/.test(c.SUPABASE_URL || '') &&
        !c.SUPABASE_URL.includes('INSERISCI') && !(c.SUPABASE_KEY || '').includes('INSERISCI');
};
const AMBIENTI_PRONTI = ['reale', 'prova'].filter(ambienteConfigurato);
const AMBIENTE = (() => {
    let a = null;
    try { a = localStorage.getItem('ttm.ambiente'); } catch { }
    return AMBIENTI_PRONTI.includes(a) ? a : (AMBIENTI_PRONTI[0] || 'reale');
})();
const PROVA = AMBIENTE === 'prova';
if (CONFIG.AMBIENTI?.[AMBIENTE]) Object.assign(CONFIG, CONFIG.AMBIENTI[AMBIENTE]);

// Solo la scelta: i dati dell'ambiente lasciato restano sul telefono,
// compresi quelli non ancora inviati (partiranno al ritorno).
function cambiaAmbiente(a) {
    try { localStorage.setItem('ttm.ambiente', a); } catch { }
    location.reload();
}

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

// Formule di gioco: cio' che serve al telefono di FormuleGioco.cs del PC.
// Chiave = nome dell'enum CodiceFormula, come arriva dal cloud in
// campionati.formula.
//  titolari/riserve = NumTitolari / NumRiserve;
//  doppio: 'libero' = la coppia si sceglie, 'fisso' = la decide la formula
//          (Olimpica: doppioPosti dice quali posti la compongono), null =
//          nessun doppio;
//  punti: regola dei punti in classifica (Gioco.puntiClassifica);
//  dueTavoli = SupportaDueTavoli;
//  partite: la sequenza dell'incontro, nell'ordine di gioco. Serve a creare
//          le partite dal telefono quando il PC non le ha ancora create.
//          S(postoAbc, postoXyz, fase, tavolo con due tavoli), D(fase, tavolo).
// Se sul PC cambia una formula va cambiata anche qui: il confronto si fa
// con Tools/TestPwaCloud (formule.json generato dal C#).
const S = (abc, xyz, fase, tavolo2 = 1) => ({ tipo: 'Singolo', posto_abc: abc, posto_xyz: xyz, fase, tavolo2 });
const D = (fase, tavolo2 = 1) => ({ tipo: 'Doppio', posto_abc: 'Doppio', posto_xyz: 'Doppio', fase, tavolo2 });
const FORMULE = {
    Courbillon: { titolari: 2, riserve: 3, doppio: 'libero', punti: 'standard', dueTavoli: false,
        partite: [S('A', 'A', 1), S('B', 'B', 1), D(2), S('A', 'B', 3), S('B', 'A', 3)] },
    MiniSwaythling: { titolari: 3, riserve: 2, doppio: null, punti: 'standard', dueTavoli: true,
        partite: [S('A', 'A', 1, 1), S('B', 'B', 1, 2), S('C', 'C', 1, 1), S('B', 'A', 2, 2), S('A', 'C', 2, 1), S('C', 'B', 2, 2)] },
    NewSwaythling: { titolari: 3, riserve: 2, doppio: null, punti: 'standard', dueTavoli: false,
        partite: [S('A', 'A', 1), S('B', 'B', 1), S('C', 'C', 1), S('A', 'B', 2), S('B', 'A', 2)] },
    Olimpica: { titolari: 3, riserve: 2, doppio: 'fisso', doppioPosti: ['B', 'C'], punti: 'standard', dueTavoli: false,
        partite: [D(1), S('A', 'A', 2), S('C', 'C', 2), S('A', 'B', 3), S('B', 'A', 3)] },
    MiniSwaythlingDoppio: { titolari: 3, riserve: 3, doppio: 'libero', punti: 'miniDoppio', dueTavoli: true,
        partite: [S('A', 'A', 1, 1), S('B', 'B', 1, 2), S('C', 'C', 1, 1), D(2, 1), S('B', 'A', 3, 1), S('A', 'C', 3, 2), S('C', 'B', 3, 1)] },
    CSIFormula: { titolari: 3, riserve: 2, doppio: null, punti: 'vinte', dueTavoli: false,
        partite: [S('A', 'A', 1), S('B', 'B', 1), S('C', 'C', 1), S('B', 'A', 2), S('A', 'C', 2), S('C', 'B', 2)] },
    CsiCorbillon: { titolari: 2, riserve: 2, doppio: 'libero', punti: 'vinte', dueTavoli: true,
        partite: [S('A', 'A', 1, 1), S('B', 'B', 1, 2), D(2, 1), S('A', 'B', 3, 1), S('B', 'A', 3, 2)] }
};
// Partite da vincere per chiudere l'incontro (FormulaGioco.PartitePerChiudere)
const partitePerChiudere = f => Math.floor(f.partite.length / 2) + 1;
// Formula sconosciuta: stessa di riserva del PC (Mini Swaythling con doppio).
const formulaDi = nome => FORMULE[nome] || FORMULE.MiniSwaythlingDoppio;

// Minimo di atleti in rosa per poter giocare = titolari della formula del
// campionato. Come FormuleGioco.MinimoRosa sul PC: Courbillon 2, le altre 3.
function minimoRosa(formula) {
    return formulaDi(formula).titolari;
}

// Reale resta 'ttm' (il nome di sempre): chi aveva gia' scaricato non riparte da zero.
const DB_NOME = PROVA ? 'ttm-prova' : 'ttm';
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
// Degli incontri si ricorda anche QUALI campi di gara sono cambiati
// (colonne, nella voce di outbox): al cloud vanno solo quelli. Cosi' chi
// compila i dati del referto non riporta indietro il punteggio che un altro
// telefono sta segnando, e viceversa. Un salvataggio che non cambia nessun
// campo di gara non manda nulla.
async function scriviLocale(righe) {
    const db = await apriDb();
    const nomi = [...new Set(righe.map(x => x.t)), 'outbox'];
    const tx = db.transaction(nomi, 'readwrite');
    const ob = tx.objectStore('outbox');
    const ora = adesso();
    for (const { t, riga } of righe) {
        if (!riga.uid) riga.uid = nuovoUid();
        if (riga.eliminato === undefined) riga.eliminato = false;
        const chiave = t + ':' + riga.uid;
        const voce = { chiave, tabella: t, uid: riga.uid };
        if (t === 'incontri') {
            const [prima, inAttesa] = await Promise.all([idbReq(tx.objectStore(t).get(riga.uid)), idbReq(ob.get(chiave))]);
            const cambiate = GARA_INCONTRO.filter(c => (riga[c] ?? null) !== (prima?.[c] ?? null));
            // Voce in attesa senza elenco (scritta da una versione precedente): restano tutte
            const tutte = !prima || (inAttesa && !inAttesa.colonne);
            if (!tutte && !cambiate.length) { tx.objectStore(t).put(riga); continue; }
            if (!tutte) voce.colonne = [...new Set([...(inAttesa?.colonne || []), ...cambiate])];
            riga.gara_modificato_il = ora;
        }
        else riga.modificato_il = ora;
        tx.objectStore(t).put(riga);
        // rev: il push cancella la voce solo se nel frattempo non e' cambiata
        ob.put({ ...voce, rev: ora + Math.random() });
    }
    await idbFine(tx);
    document.dispatchEvent(new Event('ttm-locale'));
}

// ---------------- partite dell'incontro ----------------
// Uid ricavato da un altro uid + un numero. Due telefoni che creano offline
// la stessa cosa (le partite di un incontro, il set N di una partita)
// ottengono lo STESSO uid: nel cloud diventano la stessa riga invece di due
// doppioni rifiutati dall'indice univoco. Si sommano n agli ultimi 12
// caratteri (48 bit: stanno in un numero JavaScript senza perdere cifre).
function uidDerivato(base, n) {
    const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-)([0-9a-f]{12})$/i.exec(base);
    if (!m) return `${base}~${n}`;          // uid non standard: solo nei test
    const v = (parseInt(m[2], 16) + n) % 2 ** 48;
    return m[1] + v.toString(16).padStart(12, '0');
}
const uidPartita = (uidIncontro, ordine) => uidDerivato(uidIncontro, ordine * 256);
const uidSet = (uidPartita_, numero) => uidDerivato(uidPartita_, numero);

// Data e ora LOCALI senza fuso, come le scrive il PC nelle colonne
// "timestamp" (creato_il, registrato_il): "2026-10-02T20:31:05.123".
function oraLocale(d = new Date()) {
    const z = (n, l = 2) => String(n).padStart(l, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T` +
        `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}.${z(d.getMilliseconds(), 3)}`;
}

// Atleti di una partita presi dalla formazione. posto_abc / posto_xyz sono
// posizionali: si traducono in atleti passando per la squadra che ha
// scelto le lettere ABC, che non e' per forza quella di casa.
// posti = { <uid squadra>: { A: uid atleta, B: ..., C: ... } }.
// Il doppio libero NON sta nella formazione (si dichiara sulla partita):
// qui torna null e chi chiama lascia la coppia com'e'.
function atletiDaFormazione(p, inc, formula, posti) {
    const abcInCasa = inc.squadra_lettere_abc_uid !== inc.squadra_ospite_uid;
    const dellaCasa = posti[inc.squadra_casa_uid] || {}, dellOspite = posti[inc.squadra_ospite_uid] || {};
    const titolare = (sq, posto) => ['A', 'B', 'C'].includes(posto) ? (sq[posto] || null) : null;
    if (p.tipo === 'Doppio') {
        const pp = formula.doppio === 'fisso' ? formula.doppioPosti : null;
        if (!pp) return null;
        return { atleta_casa1_uid: titolare(dellaCasa, pp[0]), atleta_casa2_uid: titolare(dellaCasa, pp[1]),
            atleta_ospite1_uid: titolare(dellOspite, pp[0]), atleta_ospite2_uid: titolare(dellOspite, pp[1]) };
    }
    const a = titolare(abcInCasa ? dellaCasa : dellOspite, p.posto_abc);
    const x = titolare(abcInCasa ? dellOspite : dellaCasa, p.posto_xyz);
    return { atleta_casa1_uid: abcInCasa ? a : x, atleta_casa2_uid: null,
        atleta_ospite1_uid: abcInCasa ? x : a, atleta_ospite2_uid: null };
}

// Le partite dell'incontro; se non esistono ancora le crea dalla formula
// del campionato, come DatabaseService.CreaPartiteAsync sul PC. Serve
// quando l'incontro arriva dal calendario e sul PC non e' mai stato aperto:
// in palestra il PC non c'e'. Gli atleti si prendono dalla formazione gia'
// salvata. Un incontro terminato senza partite (risultato importato) resta
// senza. Ritorna le partite vive.
async function assicuraPartite(uidIncontro) {
    const vive = await perIndice('partite', 'incontro_uid', uidIncontro);
    if (vive.length) return vive;
    const inc = await leggi('incontri', uidIncontro);
    if (!inc || inc.eliminato || inc.stato === 'Terminato') return [];
    const giornata = await leggi('giornate', inc.giornata_uid);
    const camp = giornata && await leggi('campionati', giornata.campionato_uid);
    if (!camp) return [];
    const formula = formulaDi(camp.formula);

    const posti = {};
    for (const r of await perIndice('formazioni', 'incontro_uid', uidIncontro))
        if (r.atleta_uid && ['A', 'B', 'C'].includes(r.ruolo))
            (posti[r.squadra_uid] || (posti[r.squadra_uid] = {}))[r.ruolo] = r.atleta_uid;

    const dueTavoli = inc.numero_tavoli === 2 && formula.dueTavoli;
    const righe = formula.partite.map((d, i) => {
        const p = {
            uid: uidPartita(inc.uid, i + 1), incontro_uid: inc.uid, ordine: i + 1,
            tipo: d.tipo, posto_abc: d.posto_abc, posto_xyz: d.posto_xyz, fase: d.fase,
            numero_tavolo: dueTavoli ? d.tavolo2 : 1,
            servizio_iniziale_casa: null, casa_a_sinistra: null,
            doppio_apertura_casa1: null, doppio_apertura_ospite1: null,
            atleta_casa1_uid: null, atleta_casa2_uid: null, atleta_ospite1_uid: null, atleta_ospite2_uid: null,
            avversario_ospite1: null, avversario_ospite2: null,
            vinta_da_casa: null, set_vinti_casa: 0, set_vinti_ospite: 0,
            in_corso: false, completata: false, eliminato: false, creato_il: oraLocale()
        };
        return { t: 'partite', riga: { ...p, ...(atletiDaFormazione(p, inc, formula, posti) || {}) } };
    });
    await scriviLocale(righe);
    return righe.map(x => x.riga);
}

// Cancella tutto (logout). Il db si ricrea alla prossima apertura.
async function svuotaDb() {
    if (_db) { _db.close(); _db = null; }
    await idbReq(indexedDB.deleteDatabase(DB_NOME));
}
