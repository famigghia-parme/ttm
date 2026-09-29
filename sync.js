// TennisTavoloManager - sync.js  (PWA cloud)
// Stesse regole del SyncService del PC:
//  - PUSH: le righe in outbox vanno al cloud. Upsert su uid; il trigger del
//    cloud scarta le versioni piu' vecchie. Gli incontri si aggiornano con
//    PATCH dei soli campi di gara (il telefono non puo' creare incontri);
//  - PULL: righe con sincronizzato_il (orologio del SERVER) > ultimo pull
//    meno un minuto di margine. Una riga modificata qui e non ancora inviata
//    vince se e' piu' recente di quella del cloud;
//  - log_punti solo per gli incontri scaricati per la gara: sono tanti e
//    servono solo li'.

const FOGLIE = new Set(['atleti_societa', 'atleti_squadre', 'formazioni']);
const PAGINA = 1000;          // massimo di Supabase per richiesta
const LOTTO = 200;            // righe per upsert
const MARGINE_MS = 60000;

const Sync = {
    inCorso: false,
    stato: 'mai',             // mai | corso | ok | offline | errore | sessione
    ultimoOk: null,
    messaggio: '',
    avvisi: [],
    _ancora: false,

    async esegui() {
        if (!Cloud.sessione) return;
        // Richiesta durante un giro in corso (es. salvataggio a meta' push):
        // si rifa' un giro subito dopo, invece di aspettare il timer.
        if (this.inCorso) { this._ancora = true; return; }
        this.inCorso = true;
        this._ancora = false;
        this.avvisi = [];
        this._imposta('corso', 'Sincronizzazione…');
        try {
            // Cloud dell'altro ambiente o senza etichetta: nessuna riga deve
            // passare, in nessuna direzione (come SyncService sul PC).
            const errAmb = await ambienteSbagliato();
            if (errAmb) { this._imposta('errore', errAmb); return; }

            // Cloud azzerato (reset.sql) dopo l'ultimo giro: i dati locali
            // sono di un altro database e nessun pull li toglierebbe mai.
            // Si svuota tutto e si riparte, anche la coda da inviare.
            if (await cloudCambiato()) {
                await svuotaDb();
                location.reload();
                return;
            }
            await push(this.avvisi);
            const ricevute = await pull(this.avvisi);
            this.ultimoOk = new Date();
            this._imposta('ok', '');
            if (ricevute > 0) document.dispatchEvent(new Event('ttm-dati'));
        } catch (e) {
            if (e.offline) this._imposta('offline', 'Offline');
            else if (e.sessione) this._imposta('sessione', e.message);
            else { console.error(e); this._imposta('errore', e.message || String(e)); }
        } finally {
            this.inCorso = false;
            document.dispatchEvent(new Event('ttm-stato'));
        }
        if (this._ancora && this.stato === 'ok') return this.esegui();
    },

    _imposta(stato, messaggio) {
        this.stato = stato;
        this.messaggio = messaggio;
        document.dispatchEvent(new Event('ttm-stato'));
    }
};

// ----------------------------------------------------------------
// AMBIENTE: etichetta del progetto Supabase (tabella ambiente, script
// scriptSql/ambiente_*.sql) confrontata con l'ambiente scelto sul telefono.
// null = tutto a posto, altrimenti il messaggio da mostrare.
// ----------------------------------------------------------------
async function ambienteSbagliato() {
    const r = await Cloud.rest('GET', 'ambiente?select=nome');
    const nome = r.ok && r.json?.length ? String(r.json[0].nome || '').trim().toLowerCase() : '';
    if (!nome)
        return `Il cloud non dice se è Reale o di Prova: va eseguito scriptSql/ambiente_${AMBIENTE}.sql in Supabase.`;
    if (nome !== AMBIENTE)
        return `Questo è il cloud ${nome.toUpperCase()}, ma il telefono è in ${AMBIENTE.toUpperCase()}: ` +
            'sincronizzazione bloccata. Controlla config.js.';
    return null;
}

// ----------------------------------------------------------------
// ISTANZA: uid del database cloud (tabella istanza). Il primo valore
// visto si ricorda; se cambia, il cloud e' stato azzerato.
// ----------------------------------------------------------------
async function cloudCambiato() {
    const r = await Cloud.rest('GET', 'istanza?select=uid');
    if (!r.ok || !r.json?.length) return false;      // tabella assente (schema vecchio): nessun controllo
    const uid = r.json[0].uid;
    const noto = await metaLeggi('istanza');
    if (noto && noto !== uid) return true;
    if (!noto) await metaScrivi('istanza', uid);
    return false;
}

// ----------------------------------------------------------------
// PUSH
// ----------------------------------------------------------------
async function push(avvisi) {
    const db = await apriDb();
    const voci = await idbReq(db.transaction('outbox').objectStore('outbox').getAll());
    if (!voci.length) return;

    for (const t of TABELLE) {
        const mie = voci.filter(v => v.tabella === t);
        if (!mie.length) continue;

        if (t === 'incontri') {
            for (const v of mie) {
                const riga = await leggi(t, v.uid);
                if (!riga) { await togliDaOutbox(v); continue; }
                const corpo = { gara_modificato_il: riga.gara_modificato_il };
                for (const c of GARA_INCONTRO) corpo[c] = riga[c] ?? null;
                const r = await Cloud.rest('PATCH', `incontri?uid=eq.${v.uid}`, corpo, 'return=minimal');
                if (r.ok) await togliDaOutbox(v);
                else avvisi.push(`Incontro non inviato: ${descriviErrore(r)}`);
            }
            continue;
        }

        // Righe complete, raggruppate per insieme di colonne: PostgREST vuole
        // le stesse chiavi in tutti gli oggetti di un invio multiplo.
        const gruppi = new Map();
        for (const v of mie) {
            const riga = await leggi(t, v.uid);
            if (!riga) { await togliDaOutbox(v); continue; }
            const pulita = { ...riga };
            delete pulita.sincronizzato_il;           // la scrive il server
            const firma = Object.keys(pulita).sort().join(',');
            if (!gruppi.has(firma)) gruppi.set(firma, []);
            gruppi.get(firma).push({ v, riga: pulita });
        }

        for (const lista of gruppi.values()) {
            for (let i = 0; i < lista.length; i += LOTTO) {
                const lotto = lista.slice(i, i + LOTTO);
                const r = await upsert(t, lotto.map(x => x.riga));
                if (r.ok) { for (const x of lotto) await togliDaOutbox(x.v); continue; }
                // Lotto rifiutato: riga per riga, per far passare le buone
                for (const x of lotto) await inviaSingola(t, x, avvisi);
            }
        }
    }
}

const upsert = (t, righe) => Cloud.rest('POST', `${t}?on_conflict=uid`, righe,
    'resolution=merge-duplicates,return=minimal,missing=default');

async function inviaSingola(t, x, avvisi) {
    const r = await upsert(t, [x.riga]);
    if (r.ok) { await togliDaOutbox(x.v); return; }

    // Doppione creato offline su due dispositivi (stesso atleta in rosa,
    // stesso ruolo in formazione): vince la riga gia' nel cloud, la nostra si
    // elimina qui e il pull porta l'altra. Stessa regola del PC.
    if (r.json?.code === '23505' && FOGLIE.has(t)) {
        const db = await apriDb();
        const tx = db.transaction([t, 'outbox'], 'readwrite');
        tx.objectStore(t).put({ ...x.riga, eliminato: true });
        tx.objectStore('outbox').delete(x.v.chiave);
        await idbFine(tx);
        avvisi.push(`${t}: doppione di una riga gia' nel cloud, unito.`);
        return;
    }
    avvisi.push(`${t}: riga non inviata (${descriviErrore(r)}), si riprova al prossimo giro.`);
}

const descriviErrore = r => `${r.status}${r.json?.message ? ' ' + r.json.message : ''}`;

// Toglie la voce solo se non e' cambiata durante l'invio (tocco successivo)
async function togliDaOutbox(v) {
    const db = await apriDb();
    const tx = db.transaction('outbox', 'readwrite');
    const s = tx.objectStore('outbox');
    const attuale = await idbReq(s.get(v.chiave));
    if (attuale && attuale.rev === v.rev) s.delete(v.chiave);
    await idbFine(tx);
}

// ----------------------------------------------------------------
// PULL
// ----------------------------------------------------------------
async function pull(avvisi) {
    let ricevute = 0;
    for (const t of TABELLE) {
        if (t === 'log_punti') continue;
        ricevute += await pullTabella(t, '', 'pull.' + t);
    }
    ricevute += await pullLogPunti();
    return ricevute;
}

// filtro: condizione PostgREST in piu' (es. set_uid=in.(...))
async function pullTabella(t, filtro, chiaveMeta) {
    const segno = chiaveMeta ? await metaLeggi(chiaveMeta) : null;
    const da = segno ? new Date(Date.parse(segno) - MARGINE_MS).toISOString() : '1970-01-01T00:00:00Z';
    let massimo = segno, offset = 0, totale = 0;

    for (; ;) {
        const r = await Cloud.rest('GET',
            `${t}?select=*&sincronizzato_il=gt.${encodeURIComponent(da)}` +
            (filtro ? '&' + filtro : '') +
            `&order=sincronizzato_il.asc,uid.asc&limit=${PAGINA}&offset=${offset}`);
        if (!r.ok) throw new Error(`Lettura ${t} non riuscita (${descriviErrore(r)})`);
        const righe = r.json || [];
        if (righe.length) {
            totale += await unisci(t, righe);
            const ultimo = righe[righe.length - 1].sincronizzato_il;
            if (!massimo || Date.parse(ultimo) > Date.parse(massimo)) massimo = ultimo;
        }
        if (righe.length < PAGINA) break;
        offset += PAGINA;
    }
    if (chiaveMeta && massimo) await metaScrivi(chiaveMeta, massimo);
    return totale;
}

// Scrive nel db locale le righe arrivate dal cloud, rispettando le modifiche
// fatte qui e non ancora inviate. Ritorna quante righe sono cambiate.
async function unisci(t, righe) {
    const db = await apriDb();
    const tx = db.transaction([t, 'outbox'], 'readwrite');
    const st = tx.objectStore(t), ob = tx.objectStore('outbox');
    let n = 0;

    for (const cl of righe) {
        const chiave = t + ':' + cl.uid;
        const [loc, pend] = await Promise.all([idbReq(st.get(cl.uid)), idbReq(ob.get(chiave))]);

        if (!loc || !pend) { st.put(cl); if (cambiata(loc, cl)) n++; continue; }

        if (t === 'incontri') {
            // Il calendario viene sempre dal cloud; la gara solo se piu' recente
            if (Date.parse(loc.gara_modificato_il) > Date.parse(cl.gara_modificato_il)) {
                const r = { ...cl };
                for (const c of GARA_INCONTRO) r[c] = loc[c];
                r.gara_modificato_il = loc.gara_modificato_il;
                st.put(r);
            } else { st.put(cl); ob.delete(chiave); }
            n++;
            continue;
        }

        if (Date.parse(loc.modificato_il) > Date.parse(cl.modificato_il)) continue;   // vince la nostra
        st.put(cl);
        ob.delete(chiave);      // la nostra era piu' vecchia: non va piu' inviata
        n++;
    }
    await idbFine(tx);
    return n;
}

// La nostra stessa riga che torna dal cloud dopo il push non conta come
// novita': altrimenti ogni invio farebbe ridisegnare la schermata.
const stessoIstante = (a, b) => Date.parse(a || 0) === Date.parse(b || 0);
function cambiata(loc, cl) {
    if (!loc) return true;
    if (!stessoIstante(loc.modificato_il, cl.modificato_il) || !!loc.eliminato !== !!cl.eliminato) return true;
    return 'gara_modificato_il' in cl && !stessoIstante(loc.gara_modificato_il, cl.gara_modificato_il);
}

// ----------------------------------------------------------------
// INCONTRI SCARICATI PER LA GARA (log punto per punto)
// ----------------------------------------------------------------
async function setDiIncontro(uidIncontro) {
    const partite = await perIndice('partite', 'incontro_uid', uidIncontro);
    const set = [];
    for (const p of partite) set.push(...await perIndice('sets', 'partita_uid', p.uid));
    return set.map(s => s.uid);
}

async function pullLogPunti() {
    const scaricati = await metaLeggi('scaricati', []);
    if (!scaricati.length) return 0;
    const uidSet = [];
    for (const u of scaricati) uidSet.push(...await setDiIncontro(u));
    let n = 0;
    // Pezzi da 40 uid: l'indirizzo della richiesta resta sotto i limiti
    for (let i = 0; i < uidSet.length; i += 40)
        n += await pullTabella('log_punti', `set_uid=in.(${uidSet.slice(i, i + 40).join(',')})`, null);
    return n;
}

// Tocco su "Scarica per la gara": ricorda l'incontro e scarica subito
// tutto il suo punto per punto (anche quello piu' vecchio del segno).
async function scaricaIncontro(uidIncontro) {
    const scaricati = await metaLeggi('scaricati', []);
    if (!scaricati.includes(uidIncontro)) {
        scaricati.push(uidIncontro);
        await metaScrivi('scaricati', scaricati.slice(-10));     // gli ultimi 10 bastano
    }
    const uidSet = await setDiIncontro(uidIncontro);
    for (let i = 0; i < uidSet.length; i += 40)
        await pullTabella('log_punti', `set_uid=in.(${uidSet.slice(i, i + 40).join(',')})`, null);
    await metaScrivi('scaricato.' + uidIncontro, adesso());
}
