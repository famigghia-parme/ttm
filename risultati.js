// TennisTavoloManager - risultati.js  (PWA cloud)
// 20/11: "Risultati a fine gara" = il "Correggi" del PC sul telefono. Si
// ricopia il referto compilato a mano: per ogni partita i giocatori (dalla
// formazione: coppia del doppio, riserva entrata) e i set chiusi (11 e 7).
// Si apre dalla scheda dell'incontro (incontri.js) e disegna dentro
// #inCorpo; modulo e lettura sono in comune.js (riHtml, riLeggi...), uguali
// alla PWA in rete locale. Lavora sui dati locali: anche senza rete, il
// salvataggio va in outbox.
//
// Salvando si scrivono le STESSE righe di DatabaseService sul PC:
//  - SalvaAtletiPartiteAsync: giocatori sulle partite e sostituzione sulla
//    riga di formazione del titolare uscito (sostituito_da_atleta_uid,
//    sostituito_dopo_ordine), ricavata dai giocatori (riDeduci, copia di
//    SostituzioneLogica.Deduci);
//  - CorreggiPartitaAsync, solo per le partite con i set cambiati: set
//    riscritti (stessa riga per lo stesso numero, quelli in piu' eliminati),
//    punto per punto della partita eliminato (raccontava un punteggio che si
//    e' deciso essere sbagliato), set vinti / completata / vinta da casa;
//  - risultato dell'incontro dalle partite (AggiornaRisultatoIncontroAsync):
//    terminato quando tutte le partite sono chiuse (o con la chiusura
//    anticipata del campionato); un incontro terminato con partite riaperte
//    torna in corso. L'ora di fine NON si scrive (il referto ha la sua: si
//    mette in "Dati del referto").
// Le partite non toccate restano com'erano (anche quelle "solo set vinti"
// del sito CSI e il punto per punto segnato dal telefono).

let ri = null;          // { uid, dati, s } incontro aperto

async function riApri(uid) {
    await assicuraPartite(uid);            // incontro mai aperto: le partite dalla formula
    const s = await riSituazione(uid);
    if (!s) { ri = null; inScheda(uid); return; }
    const c = $('#inCorpo');
    if (!c) return;
    // Il punto per punto delle partite si tiene sul telefono solo per le gare
    // scaricate: lo si chiede adesso (con la rete) perche', se si cambiano i
    // set di una partita, il suo va eliminato anche nel cloud. Senza rete
    // resta li' (limite noto: lo vedra' il PC, che pero' usa i set).
    ri = { uid, s, dati: riDati(s), scarico: scaricaIncontro(uid).catch(() => { }) };
    c.innerHTML = riHtml(ri.dati, 'Incontro');
    window.scrollTo(0, 0);
    $('#riIndietro').onclick = () => { ri = null; inScheda(uid); };
    $('#riSalva').onclick = riSalva;
    riAggancia(c, ri.dati);
    if (!ri.dati.partite.length) c.querySelector('.riTesta').insertAdjacentHTML('afterend',
        '<p class="vuoto">Partite non ancora create: serve la formula del campionato (si imposta dal PC).</p>');
}

// Tutto quello che serve, dai dati locali
async function riSituazione(uid) {
    const inc = await leggi('incontri', uid);
    if (!inc || inc.eliminato) return null;
    const giornata = await leggi('giornate', inc.giornata_uid);
    const camp = giornata && await leggi('campionati', giornata.campionato_uid);
    const [casa, ospite, partite, formazioni, atleti] = await Promise.all([
        leggi('squadre', inc.squadra_casa_uid), leggi('squadre', inc.squadra_ospite_uid),
        perIndice('partite', 'incontro_uid', uid), perIndice('formazioni', 'incontro_uid', uid), tutti('atleti')]);
    const sets = new Map();
    for (const p of partite)
        sets.set(p.uid, (await perIndice('sets', 'partita_uid', p.uid)).sort((a, b) => a.numero - b.numero));
    partite.sort((a, b) => a.ordine - b.ordine);
    return {
        inc, camp, casa, ospite, partite, sets, formazioni, A: perUid(atleti),
        formula: formulaDi(camp?.formula),
        abcInCasa: inc.squadra_lettere_abc_uid !== inc.squadra_ospite_uid
    };
}

// Formazione di una squadra: titolari per posto, riserve, chi e' solo per
// il doppio, sostituzione gia' registrata (come PreparaSquadra del PC)
function riSquadra(s, sq, abc) {
    const righe = s.formazioni.filter(r => r.squadra_uid === sq?.uid && r.atleta_uid);
    const nome = u => nomeAtleta(s.A.get(u)) || '?';
    const titolari = {}, riserve = [], voci = [], vociDoppio = [];
    for (const r of righe.filter(r => RUOLI_TITOLARI.includes(r.ruolo)).sort((a, b) => a.ruolo.localeCompare(b.ruolo))) {
        titolari[r.ruolo] = r.atleta_uid;
        voci.push({ k: r.atleta_uid, nome: `${etichettaRuolo(r.ruolo, abc)} — ${nome(r.atleta_uid)}` });
    }
    for (const r of righe.filter(r => RUOLI_RISERVE.includes(r.ruolo)).sort((a, b) => a.ruolo.localeCompare(b.ruolo))) {
        if (Object.values(titolari).includes(r.atleta_uid)) continue;
        riserve.push(r.atleta_uid);
        voci.push({ k: r.atleta_uid, nome: `${etichettaRuolo(r.ruolo, abc)} — ${nome(r.atleta_uid)}` });
    }
    for (const r of righe.filter(r => RUOLI_DOPPIO.includes(r.ruolo)))
        if (!voci.some(v => v.k === r.atleta_uid) && !vociDoppio.some(v => v.k === r.atleta_uid))
            vociDoppio.push({ k: r.atleta_uid, nome: `Doppio — ${nome(r.atleta_uid)}` });
    const sost = righe.find(r => r.sostituito_da_atleta_uid);
    return {
        uid: sq?.uid, nome: sq?.nome || '?', abc, titolari, riserve, nomeDi: nome,
        prima: sost ? { ruolo: sost.ruolo, uscente: sost.atleta_uid, entrante: sost.sostituito_da_atleta_uid, dopo: sost.sostituito_dopo_ordine } : null,
        voci: Object.keys(titolari).length ? voci : null, vociDoppio
    };
}

function riDati(s) {
    const sqCasa = riSquadra(s, s.casa, s.abcInCasa), sqOspite = riSquadra(s, s.ospite, !s.abcInCasa);
    s.sqCasa = sqCasa; s.sqOspite = sqOspite;
    const [sx, dx] = s.abcInCasa ? [sqCasa, sqOspite] : [sqOspite, sqCasa];
    const lato = (p, casa) => {
        const u = casa ? [p.atleta_casa1_uid, p.atleta_casa2_uid] : [p.atleta_ospite1_uid, p.atleta_ospite2_uid];
        const liberi = casa ? [null, null] : [p.avversario_ospite1, p.avversario_ospite2];
        const doppio = p.tipo === 'Doppio';
        // 20/11: singolo non iniziato e senza giocatori: si propone chi dice
        // la formazione (come SostituzioneLogica.DallaFormazione sul PC). Si
        // scrive solo salvando.
        const sq = casa ? sqCasa : sqOspite;
        const iniziata = p.completata || (s.sets.get(p.uid) || []).some(x => x.punti_casa > 0 || x.punti_ospite > 0);
        if (!u[0] && !u[1] && !liberi[0] && !doppio && !iniziata && sq.voci) {
            const posto = sq.abc ? p.posto_abc : p.posto_xyz;
            let k = sq.titolari[posto] || null;
            if (k && sq.prima && sq.prima.uscente === k && (sq.prima.dopo ?? 0) < p.ordine) k = sq.prima.entrante;
            if (k) u[0] = k;
        }
        return {
            scelti: [u[0] || '', doppio ? (u[1] || '') : ''],
            nomi: [nomeAtleta(s.A.get(u[0])) || liberi[0] || '', doppio ? (nomeAtleta(s.A.get(u[1])) || liberi[1] || '') : '']
        };
    };
    // Risultato in archivio: riAggiorna lo mostra solo se diverso da quello scritto
    const archivio = s.inc.punti_casa != null && s.inc.punti_ospite != null ? riCasa(s, s.inc.punti_casa, s.inc.punti_ospite) : null;
    return {
        abcInCasa: s.abcInCasa, setPerVincere: Gioco.SET_PER_VINCERE,
        sx: { nome: sx.nome, voci: sx.voci, vociDoppio: sx.vociDoppio },
        dx: { nome: dx.nome, voci: dx.voci, vociDoppio: dx.vociDoppio },
        archivio,
        partite: s.partite.map(p => {
            const set = (s.sets.get(p.uid) || []).map(x => [x.punti_casa, x.punti_ospite]);
            const [lc, lo] = [lato(p, true), lato(p, false)];
            const csi = p.completata && !set.length && p.set_vinti_casa + p.set_vinti_ospite > 0
                ? riCasa(s, p.set_vinti_casa, p.set_vinti_ospite) : null;
            return {
                k: p.uid, ordine: p.ordine, tipo: p.tipo,
                nota: [etichettaPartita(p), p.numero_tavolo > 1 ? 'tavolo ' + p.numero_tavolo : null].filter(Boolean).join(' · '),
                csi,
                sx: s.abcInCasa ? lc : lo, dx: s.abcInCasa ? lo : lc,
                set: set.map(([c, o]) => riCasa(s, c, o))
            };
        })
    };
}

// ---------------- sostituzione (copia di SostituzioneLogica.Deduci) ----------------
// sq = riSquadra; scelte = [{ ordine, tipo, posto ('A'/'B'/'C' dalla parte
// della squadra, null nel doppio), a1, a2 }]; dopoOrdine = formula.sostDopo.
// Ritorna { sost: { ruolo, uscente, entrante, dopo } o null, errore }.
// Regole (art. 27 comma 2): una sola per squadra; la riserva prende la
// lettera del titolare da un singolo che viene DOPO la partita dopoOrdine;
// da li' il titolare non rientra. Nel doppio una riserva puo' giocare anche
// senza sostituzione (comma 7).
function riDeduci(sq, scelte, dopoOrdine) {
    const nome = sq.nomeDi;
    const lista = [...scelte].sort((a, b) => a.ordine - b.ordine);
    const titolari = Object.values(sq.titolari);
    const candidati = [];
    for (const p of lista.filter(p => p.tipo !== 'Doppio' && p.posto)) {
        if (!p.a1) continue;
        const t = sq.titolari[p.posto] || null;
        if (t && p.a1 === t) continue;
        const x = p.a1, lettera = p.posto;
        if (titolari.includes(x)) return { errore: `partita ${p.ordine}: ${nome(x)} è titolare con un'altra lettera, non può giocare al posto ${lettera}.` };
        if (!sq.riserve.includes(x)) return { errore: `partita ${p.ordine}: ${nome(x)} non è in formazione.` };
        if (!t) return { errore: `partita ${p.ordine}: al posto ${lettera} non c'è un titolare da sostituire.` };
        candidati.push({ posto: p.posto, titolare: t, riserva: x, ordine: p.ordine });
    }
    const distinti = [...new Map(candidati.map(c => [c.posto + '|' + c.riserva, c])).values()];
    if (!distinti.length) return { sost: null, errore: null };
    if (distinti.length > 1)
        return { errore: 'una sola sostituzione per squadra (art. 27 comma 2): ' +
            distinti.map(d => `${nome(d.riserva)} al posto ${d.posto}`).join(', ') + '.' };
    const primo = candidati[0];             // gia' in ordine di partita
    if (dopoOrdine <= 0)
        return { errore: `la formula non prevede sostituzioni: ${nome(primo.riserva)} non può giocare la partita ${primo.ordine} al posto di ${nome(primo.titolare)}.` };
    if (primo.ordine <= dopoOrdine)
        return { errore: `la sostituzione è ammessa solo dopo la partita ${dopoOrdine}: ${nome(primo.riserva)} non può entrare già nella partita ${primo.ordine}.` };
    for (const p of lista.filter(p => p.ordine > primo.ordine))
        if (p.a1 === primo.titolare || p.a2 === primo.titolare)
            return { errore: `partita ${p.ordine}: ${nome(primo.titolare)} è stato sostituito da ${nome(primo.riserva)} nella partita ${primo.ordine} e non può rientrare.` };
    return { sost: { ruolo: primo.posto, uscente: primo.titolare, entrante: primo.riserva, dopo: primo.ordine - 1 }, errore: null };
}

const riDescrivi = (sq, x) => `esce ${sq.nomeDi(x.uscente)}, entra ${sq.nomeDi(x.entrante)} (dalla partita ${(x.dopo ?? 0) + 1})`;

// ---------------- salvataggio ----------------
async function riSalva() {
    if (!ri) return;
    const c = $('#inCorpo'), b = $('#riSalva');
    const { partite: scritte, errore } = riLeggi(c, ri.dati);
    if (errore) { msg(errore); return; }
    b.disabled = true;
    try {
        await ri.scarico;
        // Dati di adesso (la sincronizzazione puo' aver portato qualcosa)
        const s = await riSituazione(ri.uid);
        if (!s) return;
        riDati(s);                                   // prepara s.sqCasa / s.sqOspite
        const P = new Map(s.partite.map(p => [p.uid, p]));

        // Giocatori: dall'ordine del referto (sx/dx) a casa/ospite
        const nuovi = new Map();
        for (const x of scritte) {
            const p = P.get(x.k);
            if (!p) continue;
            const [casa, osp] = riCasa(s, x.sx, x.dx);
            nuovi.set(p.uid, { c1: casa[0] || null, c2: p.tipo === 'Doppio' ? (casa[1] || null) : null,
                o1: osp[0] || null, o2: p.tipo === 'Doppio' ? (osp[1] || null) : null });
        }

        // Sostituzione di ciascuna squadra con la formazione
        const sostituzioni = new Map(), conferme = [];
        for (const [sq, casa] of [[s.sqCasa, true], [s.sqOspite, false]]) {
            if (!sq.voci) continue;
            const scelte = s.partite.map(p => {
                const n = nuovi.get(p.uid) || {};
                const posto = p.tipo === 'Doppio' ? null : (sq.abc ? p.posto_abc : p.posto_xyz);
                return { ordine: p.ordine, tipo: p.tipo, posto: RUOLI_TITOLARI.includes(posto) ? posto : null,
                    a1: casa ? n.c1 : n.o1, a2: casa ? n.c2 : n.o2 };
            });
            const d = riDeduci(sq, scelte, s.formula.sostDopo ?? 0);
            if (d.errore) { msg(`${sq.nome}: ${d.errore}`); return; }
            const nuova = d.sost, prima = sq.prima;
            const uguale = !nuova ? !prima : !!prima && prima.ruolo === nuova.ruolo && prima.uscente === nuova.uscente && prima.entrante === nuova.entrante;
            if (uguale) continue;
            sostituzioni.set(sq.uid, nuova);
            conferme.push(nuova && prima ? `${sq.nome}: la sostituzione diventa: ${riDescrivi(sq, nuova)} (prima: ${riDescrivi(sq, prima)}).`
                : nuova ? `${sq.nome}: sostituzione registrata: ${riDescrivi(sq, nuova)}.`
                : `${sq.nome}: la sostituzione (${riDescrivi(sq, prima)}) viene tolta: nei singoli giocano i titolari.`);
        }
        if (conferme.length && !await conferma(conferme.join('\n\n') + '\n\nSalvare?', 'Sostituzione')) return;

        const righe = [];
        const partiteDopo = [];
        for (const p0 of s.partite) {
            const x = scritte.find(y => y.k === p0.uid);
            const n = nuovi.get(p0.uid);
            const p = { ...p0 };
            let cambia = false;
            if (n && (n.c1 !== (p.atleta_casa1_uid || null) || n.c2 !== (p.atleta_casa2_uid || null)
                || n.o1 !== (p.atleta_ospite1_uid || null) || n.o2 !== (p.atleta_ospite2_uid || null))) {
                p.atleta_casa1_uid = n.c1; p.atleta_casa2_uid = n.c2;
                p.atleta_ospite1_uid = n.o1; p.atleta_ospite2_uid = n.o2;
                cambia = true;
            }
            // Set: solo se diversi da quelli salvati (come il PC)
            const vecchi = s.sets.get(p.uid) || [];
            const set = x ? x.set.map(([sx, dx]) => riCasa(s, sx, dx)) : null;
            if (set && JSON.stringify(set) !== JSON.stringify(vecchi.map(v => [v.punti_casa, v.punti_ospite]))) {
                for (const v of vecchi) {
                    for (const l of await perIndice('log_punti', 'set_uid', v.uid)) righe.push({ t: 'log_punti', riga: { ...l, eliminato: true } });
                    if (v.numero > set.length) righe.push({ t: 'sets', riga: { ...v, eliminato: true } });
                }
                let vc = 0, vo = 0;
                for (let i = 0; i < set.length; i++) {
                    const [pc, po] = set[i];
                    const esiste = vecchi.find(v => v.numero === i + 1);
                    const uid = esiste?.uid || uidSet(p.uid, i + 1);
                    const base = esiste || (await leggi('sets', uid)) || { creato_il: oraLocale() };   // set eliminato prima: si riusa
                    righe.push({ t: 'sets', riga: { ...base, uid, partita_uid: p.uid, numero: i + 1,
                        punti_casa: pc, punti_ospite: po, completato: true, vinto_da_casa: pc > po, eliminato: false } });
                    if (pc > po) vc++; else vo++;
                }
                const perVincere = Gioco.SET_PER_VINCERE;
                p.set_vinti_casa = vc; p.set_vinti_ospite = vo;
                p.completata = vc >= perVincere || vo >= perVincere;
                p.vinta_da_casa = p.completata ? vc > vo : null;
                p.in_corso = !p.completata && set.length > 0;
                cambia = true;
            }
            if (cambia) righe.push({ t: 'partite', riga: p });
            partiteDopo.push(p);
        }

        // Sostituzioni sulle righe di formazione (SalvaAtletiPartiteAsync)
        for (const [uidSq, nuova] of sostituzioni) {
            const fr = s.formazioni.filter(r => r.squadra_uid === uidSq);
            const cambiate = new Map();
            for (const r of fr.filter(r => r.sostituito_da_atleta_uid))
                cambiate.set(r.uid, { ...r, sostituito_da_atleta_uid: null, sostituito_dopo_ordine: null });
            if (nuova) {
                const r = fr.find(r => r.ruolo === nuova.ruolo && r.atleta_uid === nuova.uscente);
                if (r) cambiate.set(r.uid, { ...(cambiate.get(r.uid) || r), sostituito_da_atleta_uid: nuova.entrante, sostituito_dopo_ordine: nuova.dopo });
            }
            for (const r of cambiate.values()) righe.push({ t: 'formazioni', riga: r });
        }

        // Risultato dell'incontro dalle partite
        const inc = { ...s.inc };
        if (riRisultato(inc, s, partiteDopo)) righe.push({ t: 'incontri', riga: inc });

        if (!righe.length) { msg('Nessuna modifica da salvare.'); return; }
        await scriviLocale(righe);                   // tutto insieme: o passa tutto o niente
        syncSubito();
        ri = null;
        await inScheda(s.inc.uid);
        avviso('Risultati salvati ✓', true);
    } catch (e) {
        console.error(e);
        msg('Errore: ' + (e.message || e));
    } finally { if (b.isConnected) b.disabled = false; }
}

// Come AggiornaRisultatoIncontroAsync + la riapertura di CorreggiPartitaAsync.
// i = copia dell'incontro, modificata qui. true se cambia qualcosa.
function riRisultato(i, s, partite) {
    const prima = JSON.stringify([i.punti_casa, i.punti_ospite, i.stato, i.punti_class_casa, i.punti_class_ospite]);
    const vc = partite.filter(p => p.completata && p.vinta_da_casa === true).length;
    const vo = partite.filter(p => p.completata && p.vinta_da_casa === false).length;
    // Nessuna partita chiusa (incontro azzerato o risultato solo importato):
    // il risultato in archivio resta, come fa il telefono nei Punti
    if (vc + vo > 0) { i.punti_casa = vc; i.punti_ospite = vo; }
    const perChiudere = partitePerChiudere(s.formula);
    const decisoDaChiusura = !!s.camp?.chiusura_anticipata && (vc >= perChiudere || vo >= perChiudere);
    const chiuso = partite.length > 0 && (s.camp?.chiusura_anticipata ? decisoDaChiusura : partite.every(p => p.completata));
    if (chiuso) {
        i.stato = 'Terminato';
        [i.punti_class_casa, i.punti_class_ospite] = Gioco.puntiClassifica(s.formula.punti, vc, vo);
    } else if (i.stato === 'Terminato' && partite.some(p => !p.completata)) i.stato = 'InCorso';
    else if (i.stato === 'Programmato' && partite.some(p => p.completata || p.in_corso)) i.stato = 'InCorso';
    return JSON.stringify([i.punti_casa, i.punti_ospite, i.stato, i.punti_class_casa, i.punti_class_ospite]) !== prima;
}
