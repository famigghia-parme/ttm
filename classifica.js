// TennisTavoloManager - classifica.js  (PWA cloud)
// Sezione "Classifica": la classifica di ogni girone della stagione,
// calcolata sul telefono dai dati locali (funziona anche offline).
//
// Il calcolo e' lo STESSO del PC (Services/Classifica.cs), funzione per
// funzione: statistiche -> CalcolaStatistiche, risolviParita ->
// RisolviParita, calcola -> CalcolaClassifica. Tools/TestPwaCloud/
// test-classifica.js lo confronta riga per riga con classifica.json
// (generato dal C#): se cambia Classifica.cs va cambiato anche qui.
// Il disegno (clHtml) sta in comune.js, uguale alla PWA in rete locale.

// Criteri di spareggio: i nomi sono quelli di CriterioSpareggio sul PC.
// Art. 2-3 FITET: punti negli scontri diretti, poi QUOZIENTI di partite,
// set e punti. Oggi tutte le formule usano questi (formule.json, "criteri").
const CRITERI_FITET = ['PuntiScontriDiretti', 'QuozientePartite', 'QuozienteSet', 'QuozientePunti'];

const Classifica = {
    // Confronta due quozienti vinte/perse senza divisioni (prodotto
    // incrociato). < 0 se A e' migliore (va prima), > 0 se e' migliore B.
    // Chi non ha giocato va dopo chi ha giocato; zero perse = "infinito".
    rapporto(vinteA, perseA, vinteB, perseB) {
        const aNiente = vinteA === 0 && perseA === 0, bNiente = vinteB === 0 && perseB === 0;
        if (aNiente && bNiente) return 0;
        if (aNiente) return 1;
        if (bNiente) return -1;
        const infA = perseA === 0, infB = perseB === 0;
        if (infA && infB) return 0;
        if (infA) return -1;
        if (infB) return 1;
        return Math.sign(vinteB * perseA - vinteA * perseB);
    },

    // I numeri di una squadra sugli incontri dati (tutti terminati).
    // incontro = { casa, ospite, pc, po, cc, co, partite: [{ sc, so, sets: [[c, o]...] }] }
    //   pc/po = partite vinte, cc/co = punti in classifica, sc/so = set vinti.
    statistiche(sq, incontri) {
        const r = { id: sq.id, squadra: sq.nome, nostra: !!sq.nostra, posizione: 0,
            giocati: 0, vinti: 0, pari: 0, persi: 0, punti: 0, partiteVinte: 0, partitePerse: 0,
            setVinti: 0, setPersi: 0, puntiFatti: 0, puntiSubiti: 0, sorteggio: false };
        for (const i of incontri) {
            const inCasa = i.casa === sq.id;
            if (!inCasa && i.ospite !== sq.id) continue;
            r.giocati++;
            const miei = (inCasa ? i.pc : i.po) ?? 0, suoi = (inCasa ? i.po : i.pc) ?? 0;
            if (miei > suoi) r.vinti++; else if (miei < suoi) r.persi++; else r.pari++;
            r.punti += (inCasa ? i.cc : i.co) ?? 0;
            r.partiteVinte += miei;
            r.partitePerse += suoi;
            for (const p of i.partite || []) {
                r.setVinti += inCasa ? p.sc : p.so;
                r.setPersi += inCasa ? p.so : p.sc;
                for (const [c, o] of p.sets || []) {
                    r.puntiFatti += inCasa ? c : o;
                    r.puntiSubiti += inCasa ? o : c;
                }
            }
        }
        return r;
    },

    // Ordina le squadre a pari punti guardando i soli incontri fra di loro,
    // con i criteri nell'ordine dato. Un blocco che resta pari su tutti i
    // criteri si ricalcola sui suoi soli incontri; se non cambia piu' nulla
    // le squadre finiscono in `sorteggiati` (art. 2 c.4).
    risolviParita(ids, incontriGirone, squadraDi, criteri, sorteggiati) {
        if (ids.length <= 1) return ids;
        const insieme = new Set(ids);
        const traLoro = incontriGirone.filter(i => insieme.has(i.casa) && insieme.has(i.ospite));
        const stat = new Map(ids.map(id => [id, this.statistiche(squadraDi.get(id), traLoro)]));

        const confronta = (idA, idB) => {
            const a = stat.get(idA), b = stat.get(idB);
            for (const criterio of criteri) {
                const c =
                    criterio === 'PuntiScontriDiretti' ? Math.sign(b.punti - a.punti) :
                    criterio === 'IncontriVinti' ? Math.sign(b.vinti - a.vinti) :
                    criterio === 'QuozientePartite' ? this.rapporto(a.partiteVinte, a.partitePerse, b.partiteVinte, b.partitePerse) :
                    criterio === 'DifferenzaPartite' ? Math.sign((b.partiteVinte - b.partitePerse) - (a.partiteVinte - a.partitePerse)) :
                    criterio === 'QuozienteSet' ? this.rapporto(a.setVinti, a.setPersi, b.setVinti, b.setPersi) :
                    criterio === 'DifferenzaSet' ? Math.sign((b.setVinti - b.setPersi) - (a.setVinti - a.setPersi)) :
                    criterio === 'QuozientePunti' ? this.rapporto(a.puntiFatti, a.puntiSubiti, b.puntiFatti, b.puntiSubiti) :
                    criterio === 'DifferenzaPunti' ? Math.sign((b.puntiFatti - b.puntiSubiti) - (a.puntiFatti - a.puntiSubiti)) : 0;
                if (c !== 0) return c;
            }
            return 0;
        };

        const ordinati = [...ids].sort(confronta);     // sort stabile, come OrderBy sul PC
        const risultato = [];
        let i = 0;
        while (i < ordinati.length) {
            let j = i + 1;
            while (j < ordinati.length && confronta(ordinati[i], ordinati[j]) === 0) j++;
            const blocco = ordinati.slice(i, j);
            if (blocco.length === 1) risultato.push(blocco[0]);
            else {
                const delBlocco = traLoro.filter(x => blocco.includes(x.casa) && blocco.includes(x.ospite));
                // Nessun progresso rispetto al gruppo di partenza: parita'
                // che a tavolino non si risolve, si segnala il sorteggio.
                if (blocco.length === ids.length && delBlocco.length === traLoro.length) {
                    blocco.forEach(id => sorteggiati.add(id));
                    risultato.push(...blocco);
                } else {
                    risultato.push(...this.risolviParita(blocco, delBlocco, squadraDi, criteri, sorteggiati));
                }
            }
            i = j;
        }
        return risultato;
    },

    // La classifica: squadre = [{ id, nome, nostra }], terminati = incontri
    // TERMINATI fra quelle squadre (forma di `statistiche`), aperti =
    // incontri ancora da giocare fra quelle squadre, [[casa, ospite]...]
    // (servono solo per la nota "sorteggio"). Ritorna le righe in ordine.
    calcola(squadre, terminati, aperti, criteri = CRITERI_FITET) {
        // In ordine di nome: le parita' che nessun criterio risolve (inizio
        // stagione, tutte a zero) restano in quest'ordine, uguale sul PC.
        const maiuscolo = s => String(s.nome ?? '').toUpperCase();
        const lista = [...squadre].sort((a, b) => {
            const na = maiuscolo(a), nb = maiuscolo(b);
            return na < nb ? -1 : na > nb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        const squadraDi = new Map(lista.map(s => [s.id, s]));
        const righe = lista.map(s => this.statistiche(s, terminati));
        const rigaDi = new Map(righe.map(r => [r.id, r]));

        // Gruppi a pari punti, dal piu' alto
        const perPunti = new Map();
        for (const r of righe) {
            if (!perPunti.has(r.punti)) perPunti.set(r.punti, []);
            perPunti.get(r.punti).push(r.id);
        }
        const ordinate = [];
        for (const punti of [...perPunti.keys()].sort((a, b) => b - a)) {
            const sorteggiati = new Set();
            for (const id of this.risolviParita(perPunti.get(punti), terminati, squadraDi, criteri, sorteggiati)) {
                const riga = rigaDi.get(id);
                // "sorteggio" solo se la parita' non si puo' piu' decidere sul
                // campo: la squadra ha giocato e non le resta nessun incontro
                // con le altre a pari merito.
                riga.sorteggio = sorteggiati.has(id) && riga.giocati > 0 &&
                    !aperti.some(([casa, ospite]) =>
                        (casa === id && sorteggiati.has(ospite)) || (ospite === id && sorteggiati.has(casa)));
                ordinate.push(riga);
            }
        }
        ordinate.forEach((r, k) => { r.posizione = k + 1; });
        return ordinate;
    }
};

// Per i test con Node (nel telefono module non esiste)
if (typeof module !== 'undefined') module.exports = { Classifica, CRITERI_FITET };

// ---------------- dati: una classifica per campionato + girone ----------------
// Stessa regola dell'endpoint /api/classifiche del PC: squadre senza girone
// = la classifica e' di tutto il campionato.
async function clGruppi() {
    const stag = await stagioneCorrente();
    const [camp, sq, gio, inc, par, sets] = await Promise.all(
        ['campionati', 'squadre', 'giornate', 'incontri', 'partite', 'sets'].map(tutti));
    const G = perUid(gio);

    // set per partita e partite per incontro, una volta sola
    const setDi = new Map();
    for (const s of sets) {
        if (!setDi.has(s.partita_uid)) setDi.set(s.partita_uid, []);
        setDi.get(s.partita_uid).push([s.punti_casa ?? 0, s.punti_ospite ?? 0]);
    }
    const partiteDi = new Map();
    for (const p of par) {
        if (!partiteDi.has(p.incontro_uid)) partiteDi.set(p.incontro_uid, []);
        partiteDi.get(p.incontro_uid).push({ sc: p.set_vinti_casa ?? 0, so: p.set_vinti_ospite ?? 0, sets: setDi.get(p.uid) || [] });
    }

    const gruppi = [];
    for (const c of camp.filter(x => x.stagione === stag)) {
        const sue = sq.filter(s => s.campionato_uid === c.uid);
        const suoi = inc.filter(i => G.get(i.giornata_uid)?.campionato_uid === c.uid);
        const criteri = formulaDi(c.formula).criteri || CRITERI_FITET;
        for (const girone of [...new Set(sue.map(s => (s.girone || '').trim()))]) {
            const squadre = (girone ? sue.filter(s => (s.girone || '').trim() === girone) : sue)
                .map(s => ({ id: s.uid, nome: s.nome, nostra: !!s.nostra_squadra }));
            const id = new Set(squadre.map(s => s.id));
            const fraLoro = suoi.filter(i => id.has(i.squadra_casa_uid) && id.has(i.squadra_ospite_uid));
            const terminati = fraLoro.filter(i => i.stato === 'Terminato').map(i => ({
                casa: i.squadra_casa_uid, ospite: i.squadra_ospite_uid,
                pc: i.punti_casa, po: i.punti_ospite, cc: i.punti_class_casa, co: i.punti_class_ospite,
                partite: partiteDi.get(i.uid) || []
            }));
            const aperti = fraLoro.filter(i => i.stato !== 'Terminato').map(i => [i.squadra_casa_uid, i.squadra_ospite_uid]);
            gruppi.push({ tipo: c.tipo, campionato: c.nome, girone, righe: Classifica.calcola(squadre, terminati, aperti, criteri) });
        }
    }
    return gruppi;
}

// ---------------- vista ----------------
if (typeof viste !== 'undefined') viste.classifica = {
    html: '<div id="clCorpo"></div>',
    init: async () => {
        const c = $('#clCorpo');
        if (!c) return;
        c.innerHTML = clHtml(await clGruppi());
        agganciaGruppi('classifica', c);
    },
    // Dati nuovi dal cloud (un risultato appena arrivato): si ridisegna
    suDati: () => viste.classifica.init()
};
