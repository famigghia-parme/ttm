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
    pausaMs: 0,               // > 0 con i Punti aperti: vedi syncDopoModifica in app.js
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
            // Punto per punto nell'ordine di gioco: il PC li numera come
            // arrivano e "annulla ultimo punto" toglie quello col numero piu' alto.
            if (t === 'log_punti')
                lista.sort((a, b) => String(a.riga.registrato_il).localeCompare(String(b.riga.registrato_il))
                    || (a.riga.punteggio_casa + a.riga.punteggio_ospite) - (b.riga.punteggio_casa + b.riga.punteggio_ospite));
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

    // Partita o set gia' creati da un altro dispositivo con un altro uid:
    // la nostra riga prende quell'uid (vedi adotta).
    if (r.json?.code === '23505' && CHIAVE_NATURALE[t] && await adotta(t, x)) {
        avvisi.push(`${t}: riga gia' creata da un altro dispositivo, unita.`);
        Sync._ancora = true;          // le righe unite partono al giro dopo
        return;
    }

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

// ----------------------------------------------------------------
// ADOZIONE: partite e set hanno una chiave naturale (incontro + ordine,
// partita + numero) con indice univoco nel cloud. Fra telefoni l'uid e'
// ricavato dalla chiave (uidDerivato in store.js) e il doppione non nasce;
// puo' nascere col PC, che usa uid casuali, se crea le stesse righe prima
// di aver sincronizzato (es. apre il Live sullo stesso incontro).
// Allora la riga del cloud resta, la nostra ne prende l'uid e le righe
// figlie (set della partita, punti del set) la seguono.
// Se la nostra era ancora vuota vale quella del cloud; se qui si e' gia'
// giocato valgono i nostri dati (i campi che non abbiamo restano i suoi).
// ----------------------------------------------------------------
const CHIAVE_NATURALE = { partite: ['incontro_uid', 'ordine'], sets: ['partita_uid', 'numero'] };
const FIGLIE_DI = { partite: ['sets', 'partita_uid'], sets: ['log_punti', 'set_uid'] };
const VUOTA = {
    partite: p => !p.completata && !p.in_corso && p.servizio_iniziale_casa == null && !p.set_vinti_casa && !p.set_vinti_ospite,
    sets: x => !x.completato && !x.punti_casa && !x.punti_ospite
};

// Campi che una partita ancora "vuota" puo' comunque avere di suo: gli
// atleti (dalla formazione salvata sul telefono, o la coppia del doppio).
const ATLETI_PARTITA = ['atleta_casa1_uid', 'atleta_casa2_uid', 'atleta_ospite1_uid', 'atleta_ospite2_uid',
    'avversario_ospite1', 'avversario_ospite2'];

async function adotta(t, x) {
    const [k1, k2] = CHIAVE_NATURALE[t], [tf, fk] = FIGLIE_DI[t];
    const r = await Cloud.rest('GET', `${t}?select=*&${k1}=eq.${encodeURIComponent(x.riga[k1])}` +
        `&${k2}=eq.${encodeURIComponent(x.riga[k2])}&eliminato=is.false`);
    const cl = r.ok ? (r.json || []).find(y => y.uid !== x.riga.uid) : null;
    if (!cl) return false;

    // Da qui tutto in UNA transazione, rileggendo la nostra riga e le sue
    // figlie: durante l'invio (tre chiamate di rete) l'utente puo' aver
    // segnato altri punti, e x.riga e' la fotografia di prima.
    const db = await apriDb();
    const ora = adesso();
    const tx = db.transaction([t, tf, 'outbox'], 'readwrite');
    const st = tx.objectStore(t), sf = tx.objectStore(tf), ob = tx.objectStore('outbox');
    const inAttesa = (tab, uid) => ob.put({ chiave: tab + ':' + uid, tabella: tab, uid, rev: ora + Math.random() });

    const mia = await idbReq(st.get(x.riga.uid));
    if (!mia) { await idbFine(tx); return true; }        // gia' unita in un giro precedente
    // anche le figlie eliminate: devono poter arrivare al cloud
    const figlie = await idbReq(sf.index(fk).getAll(mia.uid));

    st.delete(mia.uid);
    ob.delete(t + ':' + mia.uid);
    if (VUOTA[t](mia)) {
        // Nulla di giocato qui: vale la riga del cloud. Restano nostri solo
        // gli atleti che il cloud non ha (il PC crea le partite senza).
        const unita = { ...cl };
        let riempito = false;
        if (t === 'partite')
            for (const c of ATLETI_PARTITA) if (unita[c] == null && mia[c] != null) { unita[c] = mia[c]; riempito = true; }
        if (riempito) { unita.modificato_il = ora; inAttesa(t, cl.uid); }
        st.put(unita);
    } else {
        const unita = { ...cl, ...mia, uid: cl.uid, creato_il: cl.creato_il, modificato_il: ora };
        for (const c of Object.keys(cl)) if (unita[c] == null && cl[c] != null) unita[c] = cl[c];
        st.put(unita);
        inAttesa(t, cl.uid);
    }
    for (const f of figlie) {
        sf.put({ ...f, [fk]: cl.uid, modificato_il: ora });
        inAttesa(tf, f.uid);
    }
    await idbFine(tx);
    // Chi ha in mano il vecchio uid (la vista Punti) lo cambia
    document.dispatchEvent(new CustomEvent('ttm-uid', { detail: { tabella: t, da: mia.uid, a: cl.uid } }));
    document.dispatchEvent(new Event('ttm-dati'));
    return true;
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
    const r = await pullDa(t, filtro, segno);
    if (chiaveMeta && r.massimo) await metaScrivi(chiaveMeta, r.massimo);
    return r.totale;
}

// Righe con sincronizzato_il dopo `segno` (meno il margine). Ritorna quante
// sono cambiate qui e il sincronizzato_il piu' alto visto (il nuovo segno).
async function pullDa(t, filtro, segno) {
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
    return { totale, massimo };
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

// Log punti dei set indicati, a pezzi da 40 uid (l'indirizzo della
// richiesta resta sotto i limiti). Il segno e' uno solo per tutti i pezzi:
// si legge prima e si scrive alla fine, altrimenti il primo pezzo
// farebbe saltare righe al secondo.
async function pullLogDeiSet(uidSet, chiaveMeta) {
    const segno = chiaveMeta ? await metaLeggi(chiaveMeta) : null;
    let n = 0, massimo = segno;
    for (let i = 0; i < uidSet.length; i += 40) {
        const r = await pullDa('log_punti', `set_uid=in.(${uidSet.slice(i, i + 40).join(',')})`, segno);
        n += r.totale;
        if (r.massimo && (!massimo || Date.parse(r.massimo) > Date.parse(massimo))) massimo = r.massimo;
    }
    if (chiaveMeta && massimo) await metaScrivi(chiaveMeta, massimo);
    return n;
}

// A ogni giro solo i punti NUOVI degli incontri scaricati (prima si
// riscaricava tutto il log ogni volta: con i Punti aperti il giro e'
// frequente). Un incontro segnato senza essere mai stato scaricato per
// intero (Punti aperti senza rete) si scarica tutto, una volta.
async function pullLogPunti() {
    const scaricati = await metaLeggi('scaricati', []);
    if (!scaricati.length) return 0;
    let n = 0;
    const uidSet = [];
    for (const u of scaricati) {
        const suoi = await setDiIncontro(u);
        if (!await metaLeggi('scaricato.' + u)) {
            n += await pullLogDeiSet(suoi, null);
            await metaScrivi('scaricato.' + u, adesso());
        }
        uidSet.push(...suoi);
    }
    return n + await pullLogDeiSet(uidSet, 'pull.log_punti');
}

// Mette l'incontro fra quelli di cui si tiene il punto per punto, senza
// usare la rete (lo fa la vista Punti all'apertura). Il log gia' nel cloud
// arriva al primo giro di sync.
async function segnaPerLaGara(uidIncontro) {
    const scaricati = await metaLeggi('scaricati', []);
    if (scaricati.includes(uidIncontro)) return;
    scaricati.push(uidIncontro);
    await metaScrivi('scaricati', scaricati.slice(-10));     // gli ultimi 10 bastano
    await metaScrivi('scaricato.' + uidIncontro, null);      // da scaricare per intero
}

// Tocco su "Scarica per la gara": ricorda l'incontro e scarica subito
// tutto il suo punto per punto (anche quello piu' vecchio del segno).
async function scaricaIncontro(uidIncontro) {
    await segnaPerLaGara(uidIncontro);
    await pullLogDeiSet(await setDiIncontro(uidIncontro), null);
    await metaScrivi('scaricato.' + uidIncontro, adesso());
}
