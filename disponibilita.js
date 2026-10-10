// TennisTavoloManager - disponibilita.js  (PWA cloud)
// "Disponibilità" (10/10 sera, versione 1.2.0): chi c'e' per una gara di una
// nostra squadra. Si apre dalla scheda dell'incontro (incontri.js, pulsante
// "Disponibilità") e disegna li' dentro, come la Formazione.
// Per ogni atleta in rosa quattro risposte: Sì / Forse / No / Non so
// ("Non so" e' anche chi non ha ancora risposto). Un tocco salva subito:
// la riga va nell'elenco locale e in coda per il cloud (store.js:
// scriviElenco), quindi funziona anche senza rete e parte dopo.
// Chiunque puo' rispondere per chiunque della rosa; "Chi sei?" si sceglie
// una volta e resta su questo telefono (serve solo a mettere la propria
// riga in cima). Le stesse risposte si vedono e si scrivono dal PC
// (pannello Incontri, pulsante "Dispon.").
// Conti, testi e disegno (dsUid, dsRiassunto, dsDisegna) stanno in comune.js.
// In rete locale questa pagina non c'e' ancora.

let ds = null;                  // { uid } = incontro di cui si guardano le disponibilita'

// "Chi sono io": l'uid dell'atleta, uno per ambiente (in Prova gli atleti sono altri)
const dsChiaveIo = () => 'ttm.io.' + AMBIENTE;
function dsIo() { try { return localStorage.getItem(dsChiaveIo()) || null; } catch { return null; } }

// Le risposte di un incontro: Map(uid atleta -> risposta)
async function dsRisposte(uidIncontro) {
    const m = new Map();
    for (const r of await metaLeggi('disponibilita', []))
        if (!r.eliminato && r.incontro_uid === uidIncontro) m.set(r.atleta_uid, r.risposta);
    return m;
}

// Le NOSTRE squadre che giocano l'incontro, ciascuna con la sua rosa nella
// stagione del campionato e la risposta di ogni atleta. null = incontro
// sparito; squadre vuoto = nessuna delle due e' nostra.
async function dsDati(uidIncontro) {
    const inc = await leggi('incontri', uidIncontro);
    if (!inc || inc.eliminato) return null;
    const giornata = await leggi('giornate', inc.giornata_uid);
    const camp = giornata && await leggi('campionati', giornata.campionato_uid);
    const casa = await leggi('squadre', inc.squadra_casa_uid), ospite = await leggi('squadre', inc.squadra_ospite_uid);
    if (!camp || !casa || !ospite) return null;

    const A = perUid(await tutti('atleti'));
    const risposte = await dsRisposte(uidIncontro);
    const squadre = [];
    for (const sq of [casa, ospite]) {
        if (!sq.nostra_squadra) continue;
        const uid = [...new Set((await perIndice('atleti_squadre', 'squadra_uid', sq.uid))
            .filter(r => r.stagione === camp.stagione).map(r => r.atleta_uid))];
        squadre.push({
            nome: sq.nome,
            atleti: uid.map(u => A.get(u)).filter(a => a && a.attivo)
                .map(a => ({ id: a.uid, nome: nomeAtleta(a), risposta: dsRisposta(risposte.get(a.uid)).v }))
        });
    }
    return {
        casa: casa.nome, ospite: ospite.nome, terminato: inc.stato === 'Terminato',
        info: [dataBreve(inc.data_ora), camp.nome].filter(Boolean).join(' · '),
        io: dsIo(), squadre
    };
}

// "Sì 3 · Forse 1 · No 1 · Non so 2" per un incontro; '' se non e' di una
// nostra squadra o la rosa e' vuota. Serve all'elenco e alla scheda.
async function dsBreve(uidIncontro) {
    const d = await dsDati(uidIncontro);
    const tutti_ = d ? d.squadre.flatMap(s => s.atleti) : [];
    return tutti_.length ? dsRiassunto(tutti_.map(a => a.risposta)) : '';
}

async function dsApri(uidIncontro) {
    ds = { uid: uidIncontro };
    await dsMostra();
}

// Ridisegna dai dati locali (anche dopo una sincronizzazione: le risposte
// degli altri compaiono da sole; dsDisegna non ridisegna se nulla e' cambiato).
// Puo' essere chiamata piu' volte di seguito (un tocco, una sincronizzazione
// che finisce): disegna solo l'ULTIMA chiamata, altrimenti una partita prima
// ma arrivata dopo rimetterebbe sullo schermo i dati vecchi.
let dsGiro = 0;
async function dsMostra() {
    if (!ds) return;
    const uid = ds.uid, c = $('#inCorpo'), giro = ++dsGiro;
    if (!c) return;
    const d = await dsDati(uid);
    if (giro !== dsGiro || !ds || ds.uid !== uid) return;      // c'e' una chiamata piu' nuova, o si e' usciti
    // Incontro sparito, chiuso o non piu' di una nostra squadra: si torna alla scheda
    if (!d || d.terminato || !d.squadre.length) { ds = null; inScheda(uid); return; }
    dsDisegna(c, d, {
        indietro: () => { ds = null; inScheda(uid); },
        scegli: async (atleta, risposta) => {
            const adesso_ = d.squadre.flatMap(s => s.atleti).find(a => a.id === atleta);
            if (!adesso_ || adesso_.risposta === risposta) return;      // gia' quella: niente da scrivere
            await scriviElenco('disponibilita', {
                uid: dsUid(uid, atleta), incontro_uid: uid, atleta_uid: atleta, risposta
            });
            await dsMostra();
        },
        sonoIo: atleta => {
            try { if (atleta) localStorage.setItem(dsChiaveIo(), atleta); else localStorage.removeItem(dsChiaveIo()); } catch { }
            dsMostra();
        }
    });
}
