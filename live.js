// TennisTavoloManager - live.js  (PWA cloud)
// Vista Punti: il conteggio dei punti dal telefono, sui dati locali. Si apre
// dalla scheda dell'incontro (sezione Incontri) oppure direttamente
// dall'elenco della sezione Punti (incontri.js) e disegna dentro #inCorpo.
// Funziona anche senza rete: ogni tocco e' una scrittura sul telefono
// (scriviLocale), che parte al cloud appena possibile.
//
// E' la stessa "regia" di ApiLive.cs + wwwroot/live.js (rete locale), ma qui
// non c'e' un server che decide: decide il telefono, con le regole di
// gioco.js (copia di SetService.cs) e scrivendo le stesse righe che scrive
// DatabaseService sul PC:
//  - sorteggio  -> partita: servizio_iniziale_casa, casa_a_sinistra,
//                  doppio_apertura_*, in_corso; incontro: stato InCorso
//                  (ImpostaSorteggioAsync, ImpostaPartitaInCorsoAsync);
//  - punto      -> set (creato al primo punto), una riga di log_punti, e
//                  a fine set / partita / incontro: partita, risultato e
//                  punti classifica dell'incontro, ora di inizio e di fine
//                  (AggiungiPuntoAsync, AggiornaRisultatoIncontroAsync);
//  - annulla    -> toglie l'ultimo punto (AnnullaUltimoPuntoAsync);
//  - time-out   -> partita: timeout_casa_il / timeout_ospite_il = ora (UTC)
//                  della chiamata (ImpostaTimeoutAsync). Uno per lato in
//                  ogni partita; parte il conto alla rovescia di un minuto.
//                  Se si riprende a giocare prima, l'ora va indietro
//                  (lvChiudiTimeout): conto fermato, time-out usato.
// In piu', senza scrivere nulla: ogni 6 punti la colonna al centro del
// tabellone segnala la pausa per l'asciugamano (asciugamano in comune.js).
//
// Differenze volute rispetto al PC:
//  - aprire i Punti NON segna nulla: l'incontro passa "in corso" al
//    sorteggio, il set nasce al primo punto. Guardare non sporca i dati;
//  - prima del punto che chiude la partita si chiede conferma: dal telefono
//    una partita chiusa non si riapre (si corregge dal PC, "Correggi");
//  - "annulla" a inizio set riapre il set precedente (sul PC no);
//  - i nomi che mancano (avversari senza anagrafica) diventano il nome
//    della squadra invece di "?".
//
// Due telefoni su due partite diverse (due tavoli) vanno bene: il risultato
// dell'incontro si ricalcola dalle partite ogni volta che arrivano dati
// (lvAllineaRisultato), perche' ognuno conosce solo le partite che ha visto.
//
// Limite noto: una partita si segna da UN dispositivo alla volta. Due
// telefoni senza rete sulla stessa partita si sovrascrivono il punteggio
// (vince l'ultimo arrivato al cloud, riga per riga).

let lv = null;          // { uid: incontro aperto, partita: uid della partita scelta o null }
let lvBusy = false;     // un tocco alla volta
let lvHtml = '';        // ultimo disegno: si ridisegna solo se cambia
let lvVista = '';       // fotografia del punteggio mostrato (partita|set|casa|ospite)
let lvSveglia = null;   // blocco dello schermo acceso
// Time-out gia' "consumati" su questo telefono (finiti, o si e' ripreso a
// giocare prima): i valori di timeout_*_il di cui non mostrare piu' la fascia.
const lvToVisti = new Set();

// Con i Punti aperti i tocchi sono tanti: un giro di sync ogni tot al
// massimo (app.js: syncDopoModifica). Il punto e' comunque gia' salvato
// sul telefono. A fine partita il giro parte subito.
const LV_PAUSA_SYNC_MS = () => CONFIG.PAUSA_SYNC_PUNTI_MS ?? 5000;

// La partita scelta sopravvive a una ricarica (schermo bloccato, app
// riaperta): e' per incontro, non globale.
const lvChiaveMem = uid => 'ttm.partita.' + uid;
function lvRicorda(uid, uidPartita) {
    try { uidPartita ? localStorage.setItem(lvChiaveMem(uid), uidPartita) : localStorage.removeItem(lvChiaveMem(uid)); } catch { }
}
function lvRicordata(uid) {
    try { return localStorage.getItem(lvChiaveMem(uid)) || null; } catch { return null; }
}

// Schermo acceso finche' si segna (dove il telefono lo permette).
async function lvTieniAcceso(si) {
    try {
        if (si) { if (!lvSveglia || lvSveglia.released) lvSveglia = await navigator.wakeLock?.request('screen') || null; }
        else { await lvSveglia?.release(); lvSveglia = null; }
    } catch { }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && lv) lvTieniAcceso(true); });

// Una partita o un set creati qui hanno preso l'uid di quelli gia' nel
// cloud (sync.js: adotta): la scelta ricordata segue il nuovo uid.
document.addEventListener('ttm-uid', e => {
    const { tabella, da, a } = e.detail;
    if (tabella !== 'partite' || !lv || lv.partita !== da) return;
    lv.partita = a;
    lvRicorda(lv.uid, a);
});

async function lvApri(uid) {
    lv = { uid, partita: lvRicordata(uid) };
    lvHtml = '';
    Sync.pausaMs = LV_PAUSA_SYNC_MS();
    lvTieniAcceso(true);
    await assicuraPartite(uid);       // incontro mai aperto sul PC: le partite si creano qui
    await segnaPerLaGara(uid);        // da ora si tiene anche il suo punto per punto
    await lvDisegna(true);
    Sync.esegui();                    // con la rete: porta i punti gia' segnati da altri
}

// Lascia i Punti senza ridisegnare (cambio di vista, formazione).
function lvLascia() {
    fermaContoTimeout();
    if (!lv) return;
    lv = null; lvHtml = '';
    Sync.pausaMs = 0;
    lvTieniAcceso(false);
    syncSubito();
}

// ----------------------------------------------------------------
// Lettura: tutto quello che serve dell'incontro, dai dati locali
// ----------------------------------------------------------------
async function lvSituazione() {
    if (!lv) return null;
    const inc = await leggi('incontri', lv.uid);
    if (!inc || inc.eliminato) return null;
    const giornata = await leggi('giornate', inc.giornata_uid);
    const camp = giornata && await leggi('campionati', giornata.campionato_uid);
    const [casa, ospite] = await Promise.all([leggi('squadre', inc.squadra_casa_uid), leggi('squadre', inc.squadra_ospite_uid)]);
    const partite = (await perIndice('partite', 'incontro_uid', inc.uid)).sort((a, b) => a.ordine - b.ordine);

    const sets = new Map(), A = new Map();
    for (const p of partite) {
        sets.set(p.uid, (await perIndice('sets', 'partita_uid', p.uid)).sort((a, b) => a.numero - b.numero));
        for (const u of [p.atleta_casa1_uid, p.atleta_casa2_uid, p.atleta_ospite1_uid, p.atleta_ospite2_uid])
            if (u && !A.has(u)) A.set(u, await leggi('atleti', u));
    }
    return {
        inc, camp, casa, ospite, partite, sets, A,
        formula: formulaDi(camp?.formula),
        abcInCasa: inc.squadra_lettere_abc_uid !== inc.squadra_ospite_uid,
        vinteCasa: partite.filter(p => p.completata && p.vinta_da_casa === true).length,
        vinteOspite: partite.filter(p => p.completata && p.vinta_da_casa === false).length
    };
}

// La partita scelta e il suo set in corso. null se non c'e' nulla da
// giocare su quella partita (non scelta, sparita, gia' completata).
// Il set in corso e' quello non completato col numero piu' alto; se non
// c'e' ancora (primo punto non segnato) e' "virtuale": uid null, 0-0.
function lvGioco(s) {
    const p = lv?.partita && s.partite.find(x => x.uid === lv.partita);
    if (!p || p.completata || s.inc.stato === 'Terminato') return null;
    const sets = s.sets.get(p.uid) || [];
    const aperti = sets.filter(x => !x.completato);
    const set = aperti[aperti.length - 1] ||
        { uid: null, numero: sets.length + 1, punti_casa: 0, punti_ospite: 0, completato: false };
    const pc = set.punti_casa, po = set.punti_ospite;
    const doppio = p.tipo === 'Doppio';
    const giocato = sets.some(x => x.punti_casa > 0 || x.punti_ospite > 0);
    // Partita iniziata sul PC saltando il sorteggio: come il PC, si prosegue
    // con i valori predefiniti (casa batte, casa a sinistra) invece di
    // restare bloccati fra "fai il sorteggio" e "partita gia' iniziata".
    const sorteggio = p.servizio_iniziale_casa != null || giocato;
    const servBase = p.servizio_iniziale_casa ?? true;

    const serveCasa = Gioco.calcolaServizio(pc, po, Gioco.servizioInizialeCasaDelSet(set.numero, servBase));
    const ruoli = doppio ? Gioco.ruoliDelPunto(set.numero, servBase,
        p.doppio_apertura_casa1 ?? true, p.doppio_apertura_ospite1 ?? true, pc, po) : null;
    return {
        p, set, sets, pc, po, doppio, sorteggio, serveCasa, ruoli,
        casaASinistra: Gioco.casaASinistra(set.numero, p.casa_a_sinistra ?? true, pc, po),
        giocato,
        chiave: [p.uid, set.numero, pc, po].join('|')
    };
}

// ---------------- risultato dell'incontro ----------------
// Come AggiornaRisultatoIncontroAsync sul PC. Il risultato sono le partite
// vinte. Quando l'incontro e' finito dipende dal CAMPIONATO: di norma si
// giocano tutte le partite; con la chiusura anticipata (play-off) appena
// una squadra arriva al numero che decide.
function lvRisultato(camp, formula, partite) {
    const vc = partite.filter(p => p.completata && p.vinta_da_casa === true).length;
    const vo = partite.filter(p => p.completata && p.vinta_da_casa === false).length;
    const perChiudere = partitePerChiudere(formula);
    const chiuso = partite.length > 0 && (camp?.chiusura_anticipata ? (vc >= perChiudere || vo >= perChiudere)
        : partite.every(p => p.completata));
    return { vc, vo, chiuso };
}

// Scrive nell'incontro (copia `i`) il risultato calcolato; true se cambia.
function lvApplicaRisultato(i, r, formula) {
    let cambia = (i.punti_casa ?? 0) !== r.vc || (i.punti_ospite ?? 0) !== r.vo;
    if (r.vc + r.vo > 0) { i.punti_casa = r.vc; i.punti_ospite = r.vo; }
    if (r.chiuso && i.stato !== 'Terminato') {
        i.stato = 'Terminato';
        [i.punti_class_casa, i.punti_class_ospite] = Gioco.puntiClassifica(formula.punti, r.vc, r.vo);
        if (!i.ora_fine) i.ora_fine = lvOraReferto();
        cambia = true;
    }
    return cambia;
}

// Rimette in pari il risultato dell'incontro con le sue partite. Serve con
// due telefoni su due tavoli: ognuno chiude la sua partita contando solo
// quelle che conosce in quel momento; quando arrivano anche le altre il
// conto va rifatto, altrimenti l'incontro resterebbe "in corso" per sempre.
// Non tocca gli incontri terminati (li corregge il PC). true = ha scritto.
async function lvAllineaRisultato(uid) {
    const inc = await leggi('incontri', uid);
    if (!inc || inc.eliminato || inc.stato === 'Terminato') return false;
    const partite = await perIndice('partite', 'incontro_uid', uid);
    if (!partite.some(p => p.completata)) return false;
    const giornata = await leggi('giornate', inc.giornata_uid);
    const camp = giornata && await leggi('campionati', giornata.campionato_uid);
    if (!camp) return false;
    const formula = formulaDi(camp.formula);
    const i = { ...inc };
    if (!lvApplicaRisultato(i, lvRisultato(camp, formula, partite), formula)) return false;
    if (i.stato === 'Programmato') i.stato = 'InCorso';
    await scriviLocale([{ t: 'incontri', riga: i }]);
    return true;
}

// Dati nuovi dal cloud: si ricontrollano gli incontri che questo telefono
// sta seguendo (quelli dei Punti e gli scaricati per la gara).
document.addEventListener('ttm-dati', async () => {
    try {
        let scritto = false;
        for (const uid of await metaLeggi('scaricati', [])) scritto = await lvAllineaRisultato(uid) || scritto;
        if (scritto && vistaCorrente) viste[vistaCorrente].suDati?.();
    } catch (e) { console.error(e); }
});

// ---------------- nomi (come MessaggiReferto.cs) ----------------
// Nome di un giocatore, o null se non si sa (avversario senza anagrafica).
function lvNome(s, p, casa, primo) {
    const u = casa ? (primo ? p.atleta_casa1_uid : p.atleta_casa2_uid) : (primo ? p.atleta_ospite1_uid : p.atleta_ospite2_uid);
    return nomeAtleta(s.A.get(u)) || (casa ? null : (primo ? p.avversario_ospite1 : p.avversario_ospite2)) || null;
}
const lvSquadra = (s, casa) => (casa ? s.casa?.nome : s.ospite?.nome) || (casa ? 'Casa' : 'Ospite');

// Un giocatore, sempre con qualcosa da leggere: se il nome manca, la squadra
// (nel doppio "1° Stezzano A" / "2° Stezzano A").
function lvChi(s, p, casa, primo) {
    return lvNome(s, p, casa, primo) ||
        (p.tipo === 'Doppio' ? `${primo ? '1°' : '2°'} ${lvSquadra(s, casa)}` : lvSquadra(s, casa));
}

// Atleta (singolo) o coppia "A / B" (doppio) di un lato.
function lvLato(s, p, casa) {
    const n1 = lvNome(s, p, casa, true);
    if (p.tipo !== 'Doppio') return n1 || lvSquadra(s, casa);
    const n2 = lvNome(s, p, casa, false);
    return n1 || n2 ? `${n1 || '?'} / ${n2 || '?'}` : lvSquadra(s, casa);
}

// Sul referto chi ha le lettere A/B/C sta SEMPRE a sinistra: nomi e
// punteggi seguono quell'ordine, chiunque giochi in casa.
function lvConLettera(s, p, casa) {
    const abc = casa === s.abcInCasa;
    const lettera = { A: abc ? 'A' : 'X', B: abc ? 'B' : 'Y', C: abc ? 'C' : 'Z' }[abc ? p.posto_abc : p.posto_xyz] || '';
    return (lettera ? `(${lettera}) ` : '') + lvLato(s, p, casa);
}
const lvIntestazione = (s, p) => `${lvConLettera(s, p, s.abcInCasa)}  vs  ${lvConLettera(s, p, !s.abcInCasa)}`;
const lvPuntiSet = (s, x) => s.abcInCasa ? `${x.punti_casa}-${x.punti_ospite}` : `${x.punti_ospite}-${x.punti_casa}`;

const lvMsgFineSet = (s, p, set, vintoCasa) =>
    `Set ${set.numero} vinto da ${lvLato(s, p, vintoCasa)}:\n${lvIntestazione(s, p)}\n${lvPuntiSet(s, set)}\n\n` +
    'Cambio campo e cambio del primo servizio.';

const lvMsgFinePartita = (s, p, chiusi, vintaCasa) =>
    `Partita ${p.ordine} vinta da ${lvLato(s, p, vintaCasa)}. Risultato:\n${lvIntestazione(s, p)}\n` +
    chiusi.map(x => `(${lvPuntiSet(s, x)})`).join(' ');

// ----------------------------------------------------------------
// Disegno
// ----------------------------------------------------------------
async function lvDisegna(forza) {
    const c = $('#inCorpo');
    if (!c || !lv) return;
    const s = await lvSituazione();
    if (!lv) return;                                 // lasciato durante la lettura
    if (!s) { lvLascia(); inElenco(); return; }

    // La partita scelta e' finita (magari dall'altro telefono) o non c'e' piu'
    let g = lvGioco(s);
    if (lv.partita && !g) { lv.partita = null; lvRicorda(lv.uid, null); }
    lvVista = g ? g.chiave : '';

    // Dalla sezione Punti si torna all'elenco, dalla scheda all'incontro
    let toAttivo = null;       // time-out in corso sulla partita mostrata
    let h = `<button class="pieno chiaro" id="lvIndietro">${inModo === 'punti' ? '← Punti' : '← Incontro'}</button>
      <div class="lvTesta">${htmlNomeSquadra(s.casa?.nome)}
        <span class="lvTot">${s.vinteCasa} – ${s.vinteOspite}<small class="lvEtic">partite</small></span>
        ${htmlNomeSquadra(s.ospite?.nome)}</div>`;

    if (s.inc.stato === 'Terminato') h += '<p class="vuoto">Incontro terminato</p>';
    else if (!s.partite.length) h += '<p class="vuoto">Partite non ancora create: serve la formula del campionato (si imposta dal PC).</p>';
    else if (!g) h += lvHtmlScelta(s);
    else {
        const p = g.p;
        h += `<div class="lvInfo">Partita ${p.ordine} di ${s.partite.length} · Set ${g.set.numero}${g.doppio ? ' · doppio' : ''}${p.numero_tavolo > 1 ? ' · tavolo ' + p.numero_tavolo : ''}</div>`;
        if (!g.sorteggio) h += lvHtmlSorteggio(s, g);
        else {
            // Pallino del servizio: sempre presente, acceso solo per chi batte.
            const lato = casa => `
              <button class="lvLato ${casa ? 'casa' : 'ospite'}" data-casa="${casa ? 1 : 0}">
                <div class="lvNomi">${esc(lvLato(s, p, casa))}</div>
                <div class="lvPunti">${casa ? g.pc : g.po}</div>
                <div class="lvDot ${g.serveCasa === casa ? 'on' : ''}"></div>
                <div class="lvSet">set ${casa ? p.set_vinti_casa : p.set_vinti_ospite}</div>
              </button>`;
            const serve = g.ruoli ? lvChi(s, p, g.ruoli.serveCasa, g.ruoli.serventeAtleta1) : lvChi(s, p, g.serveCasa, true);
            const riceve = g.ruoli ? lvChi(s, p, !g.ruoli.serveCasa, g.ruoli.riceventeAtleta1) : lvChi(s, p, !g.serveCasa, true);
            const chiusi = g.sets.filter(x => x.completato);
            // La colonna sinistra e' di chi sta ORA a sinistra del tavolo (vista
            // arbitro). Al centro la colonna dell'asciugamano; sotto, un
            // pulsante time-out per lato; sopra, la fascia del time-out in corso.
            const sx = g.casaASinistra, usato = casa => !!(casa ? p.timeout_casa_il : p.timeout_ospite_il);
            toAttivo = lvTimeoutAttivo(p);
            h += `${toAttivo ? htmlTimeoutInCorso(lvLato(s, p, toAttivo.casa), toAttivo.casa) : ''}
              <div class="lvCampo">${lato(sx)}${htmlAsciugamano(g.pc, g.po)}${lato(!sx)}</div>
              ${htmlPulsantiTimeout({ casa: sx, usato: usato(sx) }, { casa: !sx, usato: usato(!sx) })}
              <div class="lvServe">Serve: <b>${esc(serve)}</b> → riceve: ${esc(riceve)}</div>
              ${chiusi.length ? `<div class="lvInfo">Set: ${chiusi.map(x => x.punti_casa + '-' + x.punti_ospite).join(' · ')}</div>` : ''}
              <button class="pieno chiaro" id="lvAnnulla">↶ Annulla ultimo punto</button>
              ${g.giocato ? '' : '<button class="pieno chiaro" id="lvRifai">↺ Rifai il sorteggio</button>'}
              <button class="pieno chiaro" id="lvCambia">↔ Cambia partita</button>`;
        }
    }
    h += '<div id="msg"></div>';

    if (!forza && h === lvHtml) return;              // niente sfarfallio
    // Ridisegno a sorteggio aperto (es. l'altro tavolo chiude una partita e
    // cambia il totale in alto): le scelte gia' fatte restano.
    const scelte = [...c.querySelectorAll('input[type="radio"]:checked')].map(x => [x.name, x.value]);
    lvHtml = h;
    c.innerHTML = h;
    for (const [n, v] of scelte) { const x = c.querySelector(`input[name="${n}"][value="${v}"]`); if (x) x.checked = true; }

    $('#lvIndietro').onclick = () => { const uid = lv.uid; lvLascia(); if (inModo === 'punti') inElenco(); else inScheda(uid); };
    c.querySelectorAll('.lvLato').forEach(b => b.onclick = () => lvPunto(b.dataset.casa === '1'));
    c.querySelectorAll('.lvPart[data-pid]').forEach(b => b.onclick = () => {
        lv.partita = b.dataset.pid; lvRicorda(lv.uid, lv.partita); lvDisegna(true);
    });
    const su = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    su('#lvAnnulla', lvAnnulla);
    su('#lvInizia', lvSorteggio);
    su('#lvRifai', lvRifaiSorteggio);
    su('#lvCambia', () => { lv.partita = null; lvRicorda(lv.uid, null); lvDisegna(true); });
    c.querySelectorAll('button[data-doppio]').forEach(b => b.onclick = () => lvDichiaraDoppio(b.dataset.doppio));
    c.querySelectorAll('button.lvTo[data-to]').forEach(b => b.onclick = () => lvTimeout(b.dataset.to === '1'));
    su('#lvToAnnulla', () => lvTimeoutAnnulla($('#lvToAnnulla').dataset.to === '1'));
    su('#lvToFine', () => lvTimeoutFine($('#lvToFine').dataset.to === '1'));
    // Conto alla rovescia: allo scadere la fascia sparisce, con un avviso
    if (toAttivo) {
        const il = toAttivo.il;
        avviaContoTimeout(toAttivo.fine, () => {
            lvToVisti.add(il);
            navigator.vibrate?.([200, 100, 200]);
            avviso('Time-out finito: si riprende a giocare', true);
            lvDisegna(true);
        });
    } else fermaContoTimeout();
}

// Il time-out in corso sulla partita, se c'e': { casa, il, fine }. In corso
// = chiamato da meno di un minuto e non ancora "visto" su questo telefono.
// fine e' in millisecondi sull'orologio di QUESTO telefono; se chi l'ha
// chiamato ha l'orologio avanti, l'inizio "nel futuro" vale come adesso.
function lvTimeoutAttivo(p) {
    const adesso = Date.now();
    let attivo = null;
    for (const casa of [true, false]) {
        const il = casa ? p.timeout_casa_il : p.timeout_ospite_il;
        if (!il || lvToVisti.has(il)) continue;
        const fine = Math.min(Date.parse(il), adesso) + SECONDI_TIMEOUT * 1000;
        if (fine > adesso && (!attivo || fine > attivo.fine)) attivo = { casa, il, fine };
    }
    return attivo;
}

// Selettore: quale partita segna QUESTO telefono (con due tavoli ce ne sono
// due insieme). Ordine: in corso, da giocare, gia' giocate in fondo. Le
// giocate restano visibili ma non si toccano: si correggono dal PC.
function lvHtmlScelta(s) {
    const rango = q => q.completata ? 2 : (q.in_corso ? 0 : 1);
    const elenco = [...s.partite].sort((a, b) => rango(a) - rango(b) || a.ordine - b.ordine);
    let titoloFatte = false;
    return '<div class="lvSceltaTit">Su quale partita segni i punti?</div>' + elenco.map(q => {
        const nomi = `${esc(lvLato(s, q, true))} – ${esc(lvLato(s, q, false))}`;
        const note = [etichettaPartita(q), q.numero_tavolo > 1 ? 'tavolo ' + q.numero_tavolo : null,
            q.completata ? `giocata ${q.set_vinti_casa}-${q.set_vinti_ospite}` : (q.in_corso ? 'in corso' : null)]
            .filter(Boolean).join(' · ');
        if (q.completata) {
            const tit = titoloFatte ? '' : '<div class="lvSceltaTit">Già giocate</div>';
            titoloFatte = true;
            return tit + `<button class="pieno chiaro lvPart fatta" disabled><b>Partita ${q.ordine}</b> ${nomi}<small>${esc(note)}</small></button>`;
        }
        return `<button class="pieno chiaro lvPart" data-pid="${esc(q.uid)}"><b>Partita ${q.ordine}</b> ${nomi}<small>${esc(note)}</small></button>`;
    }).join('');
}

function lvHtmlSorteggio(s, g) {
    const p = g.p;
    const r = (nome, v, testo, chk) =>
        `<label class="lvRadio"><input type="radio" name="${nome}" value="${v}"${chk ? ' checked' : ''}> ${esc(testo)}</label>`;
    let h = `<h4>Sorteggio</h4>
      <div class="lvDom">Batte per primo</div>${r('serv', '1', lvLato(s, p, true), true)}${r('serv', '0', lvLato(s, p, false))}
      <div class="lvDom">Gioca a SINISTRA (vista arbitro)</div>${r('lato', '1', lvLato(s, p, true), true)}${r('lato', '0', lvLato(s, p, false))}`;

    if (g.doppio) {
        // Doppio non ancora dichiarato: si propone di inserirlo adesso. Si
        // puo' anche iniziare lo stesso (avversari senza anagrafica).
        const manca = [];
        if (!p.atleta_casa1_uid || !p.atleta_casa2_uid) manca.push(s.casa);
        if ((!p.atleta_ospite1_uid && !p.avversario_ospite1) || (!p.atleta_ospite2_uid && !p.avversario_ospite2)) manca.push(s.ospite);
        if (manca.length)
            h = `<div class="avviso">Tocca al doppio, ma la coppia non è ancora stata indicata per: <b>${manca.map(m => esc(m?.nome)).join(', ')}</b></div>` +
                manca.map(m => `<button class="pieno" data-doppio="${esc(m?.uid)}">Inserisci il doppio di ${esc(m?.nome)}</button>`).join('') + h;
        h += `<div class="lvDom">Apre la coppia di casa</div>${r('apC', '1', lvChi(s, p, true, true), true)}${r('apC', '0', lvChi(s, p, true, false))}
          <div class="lvDom">Apre la coppia ospite</div>${r('apO', '1', lvChi(s, p, false, true), true)}${r('apO', '0', lvChi(s, p, false, false))}`;
    }
    return h + '<button class="pieno" id="lvInizia">Inizia partita</button>' +
        '<button class="pieno chiaro" id="lvCambia">↔ Cambia partita</button>';
}

// Apre la Formazione su questo incontro e squadra; dopo il salvataggio (o
// con "Torna ai punti") si rientra qui, sulla stessa partita.
function lvDichiaraDoppio(uidSquadra) {
    const uid = lv.uid;
    lvLascia();
    fzRitorno = () => lvApri(uid);
    fzApri(uid, uidSquadra);
}

// ----------------------------------------------------------------
// Azioni. Ognuna rilegge i dati: se il punteggio non e' piu' quello
// mostrato (un altro dispositivo ha segnato) non scrive e avvisa.
// ----------------------------------------------------------------
const LV_CAMBIATO = 'Punteggio cambiato da un altro dispositivo: ricontrolla.';
const lvOraReferto = () => new Date().toTimeString().slice(0, 5) + ':00';     // ore e minuti, come si scrive a mano

async function lvAzione(f) {
    if (lvBusy || !lv) return;
    lvBusy = true;
    try {
        const s = await lvSituazione();
        const g = s && lvGioco(s);
        if (!g || g.chiave !== lvVista) { await lvDisegna(true); msg(LV_CAMBIATO); return; }
        await f(s, g);
    } catch (e) {
        console.error(e);
        msg('Errore: ' + (e.message || e));
    } finally { lvBusy = false; }
}

const lvSorteggio = () => lvAzione(async (s, g) => {
    if (g.giocato) { await lvDisegna(true); msg('Partita già iniziata: sorteggio non modificabile.'); return; }
    const si = n => document.querySelector(`input[name="${n}"]:checked`)?.value === '1';
    const righe = [{ t: 'partite', riga: {
        ...g.p, servizio_iniziale_casa: si('serv'), casa_a_sinistra: si('lato'),
        // null nei singoli: la rotazione del doppio non ha senso
        doppio_apertura_casa1: g.doppio ? si('apC') : null,
        doppio_apertura_ospite1: g.doppio ? si('apO') : null,
        in_corso: true } }];
    if (s.inc.stato === 'Programmato') righe.push({ t: 'incontri', riga: { ...s.inc, stato: 'InCorso' } });
    await scriviLocale(righe);
    await lvDisegna(true);
});

// Solo finche' non si e' giocato un punto: dopo, il sorteggio e' verbale.
const lvRifaiSorteggio = () => lvAzione(async (s, g) => {
    if (g.giocato) { await lvDisegna(true); return; }
    await scriviLocale([{ t: 'partite', riga: {
        ...g.p, servizio_iniziale_casa: null, casa_a_sinistra: null,
        doppio_apertura_casa1: null, doppio_apertura_ospite1: null } }]);
    await lvDisegna(true);
});

// Time-out chiesto da un lato: si scrive l'ora (UTC) sulla partita e parte
// il minuto. Uno solo per lato in ogni partita.
const lvTimeout = casa => lvAzione(async (s, g) => {
    if (!g.sorteggio) return;
    const col = casa ? 'timeout_casa_il' : 'timeout_ospite_il';
    if (g.p[col]) { await lvDisegna(true); msg('Time-out già usato in questa partita.'); return; }
    if (!confirm(`Time-out per ${lvLato(s, g.p, casa)}?\nUn minuto di sospensione: ce n'è uno solo per partita.`)) return;
    await scriviLocale([{ t: 'partite', riga: { ...g.p, [col]: new Date().toISOString() } }]);
    await lvDisegna(true);
});

// Il minuto e' il massimo: se si riprende a giocare prima, il conto va
// fermato ma il time-out resta usato. Non c'e' una colonna in piu': l'ora
// della chiamata si sposta indietro di un'ora, cosi' resta scritta (= usato)
// ma il minuto risulta finito su ogni dispositivo, anche con l'orologio un
// po' diverso (come DatabaseService.ChiudiTimeoutAsync sul PC).
// p = copia della partita, modificata qui; casa non indicato = tutti e due
// i lati. Ritorna true se c'era un time-out in corso.
function lvChiudiTimeout(p, casa) {
    const adesso = Date.now();
    let chiuso = false;
    for (const c of [true, false]) {
        if (casa !== undefined && casa !== c) continue;
        const col = c ? 'timeout_casa_il' : 'timeout_ospite_il';
        if (!p[col]) continue;
        const inizio = Math.min(Date.parse(p[col]), adesso);
        if (inizio + SECONDI_TIMEOUT * 1000 <= adesso) continue;       // gia' finito
        p[col] = new Date(inizio - 3600 * 1000).toISOString();
        chiuso = true;
    }
    return chiuso;
}

// "Riprende il gioco" nella fascia del time-out.
const lvTimeoutFine = casa => lvAzione(async (s, g) => {
    const p = { ...g.p };
    if (lvChiudiTimeout(p, casa)) await scriviLocale([{ t: 'partite', riga: p }]);
    await lvDisegna(true);
});

// Chiamato per errore: il time-out torna disponibile.
const lvTimeoutAnnulla = casa => lvAzione(async (s, g) => {
    const col = casa ? 'timeout_casa_il' : 'timeout_ospite_il';
    if (!g.p[col] || !confirm(`Annullare il time-out di ${lvLato(s, g.p, casa)}?\nTorna disponibile.`)) return;
    await scriviLocale([{ t: 'partite', riga: { ...g.p, [col]: null } }]);
    await lvDisegna(true);
});

const lvPunto = casa => lvAzione(async (s, g) => {
    if (!g.sorteggio) return;
    // Si segna un punto durante il time-out: si e' ripreso a giocare. La
    // fascia va via qui e il conto si ferma anche sugli altri dispositivi
    // (lvChiudiTimeout: la partita si scrive insieme al punto).
    const inCorso = lvTimeoutAttivo(g.p);
    if (inCorso) lvToVisti.add(inCorso.il);
    const p = { ...g.p };
    const toChiuso = lvChiudiTimeout(p);
    const pc = g.pc + (casa ? 1 : 0), po = g.po + (casa ? 0 : 1);
    const fineSet = Gioco.isSetTerminato(pc, po);
    const svc = p.set_vinti_casa + (fineSet && casa ? 1 : 0), svo = p.set_vinti_ospite + (fineSet && !casa ? 1 : 0);
    const finePartita = fineSet && Gioco.isPartitaTerminata(svc, svo);

    // Dal telefono una partita chiusa non si riapre: meglio chiedere.
    if (finePartita && !confirm(`${pc}-${po}: con questo punto ${lvLato(s, p, casa)} vince la partita ${casa ? svc : svo}-${casa ? svo : svc}.\nConfermi?`))
        return;
    navigator.vibrate?.(30);

    // Set: nasce al primo punto. L'uid viene da partita + numero, cosi' due
    // telefoni non creano due "set 2" diversi; una riga eliminata con
    // quell'uid (set annullato) si riusa.
    let set = g.set;
    if (!set.uid) {
        const uid = uidSet(p.uid, set.numero);
        set = { ...(await leggi('sets', uid) || { creato_il: oraLocale() }),
            uid, partita_uid: p.uid, numero: set.numero, completato: false, vinto_da_casa: null, eliminato: false };
    }
    set = { ...set, punti_casa: pc, punti_ospite: po };
    if (fineSet) { set.completato = true; set.vinto_da_casa = casa; }

    const righe = [
        { t: 'sets', riga: set },
        // servizio_casa = chi serviva PRIMA del punto, come sul PC
        { t: 'log_punti', riga: { uid: nuovoUid(), set_uid: set.uid, punto_casa: casa,
            punteggio_casa: pc, punteggio_ospite: po, servizio_casa: g.serveCasa, registrato_il: oraLocale() } }];

    let inc = null;
    const incontro = () => inc || (inc = { ...s.inc });
    // Referto: "l'incontro inizia alle ore" = primo punto (solo se non c'e' gia')
    if (pc + po === 1 && !s.inc.ora_inizio) incontro().ora_inizio = lvOraReferto();
    if (s.inc.stato === 'Programmato') incontro().stato = 'InCorso';

    let ris = null;
    const partitaCambia = fineSet || !p.in_corso || toChiuso;
    if (fineSet) { p.set_vinti_casa = svc; p.set_vinti_ospite = svo; }
    if (finePartita) {
        p.completata = true; p.in_corso = false; p.vinta_da_casa = svc > svo;
        // Risultato dell'incontro con questa partita chiusa (lvRisultato)
        ris = lvRisultato(s.camp, s.formula, s.partite.map(q => q.uid === p.uid ? p : q));
        lvApplicaRisultato(incontro(), ris, s.formula);
    } else p.in_corso = true;
    if (partitaCambia) righe.push({ t: 'partite', riga: p });
    if (inc) righe.push({ t: 'incontri', riga: inc });

    // Tutto in una transazione: o passa tutto o niente.
    await scriviLocale(righe);
    if (!lv) return;                  // vista lasciata nel frattempo: il punto e' salvato

    let evento = null;
    if (finePartita) {
        const chiusi = [...g.sets.filter(x => x.completato && x.uid !== set.uid), set];
        evento = lvMsgFinePartita(s, p, chiusi, casa) + (ris.chiuso ? `\n\nIncontro terminato: ${ris.vc} - ${ris.vo}` : '');
        lv.partita = null; lvRicorda(lv.uid, null);      // si torna a scegliere
        syncSubito();
    } else if (fineSet) {
        evento = lvMsgFineSet(s, p, set, casa);
    } else if (Gioco.casaASinistra(set.numero, p.casa_a_sinistra ?? true, pc, po) !== g.casaASinistra) {
        evento = 'Set decisivo: uno dei due è a 5 punti.\nCAMBIO CAMPO (il servizio non cambia).';
    }
    await lvDisegna(true);
    if (evento) alert(evento);
});

// Toglie l'ultimo punto della partita. Nel set in corso si guarda il log
// per sapere di chi era; a inizio set (0-0) si riapre il set precedente:
// li' l'ultimo punto e' per forza di chi l'ha vinto.
const lvAnnulla = () => lvAzione(async (s, g) => {
    const vuoto = g.pc + g.po === 0;
    const prec = g.sets.filter(x => x.completato).pop();
    if (vuoto && !prec) { msg('Nessun punto da annullare.'); return; }
    const set = vuoto ? prec : g.set;
    if (!confirm(vuoto ? `Il set ${prec.numero} è finito ${prec.punti_casa}-${prec.punti_ospite}.\nAnnullare il suo ultimo punto e riaprirlo?`
        : 'Annullare l\'ultimo punto?')) return;

    // La riga di log di QUESTO punteggio (la piu' recente, se ce n'e' piu' d'una)
    const log = (await perIndice('log_punti', 'set_uid', set.uid))
        .filter(l => l.punteggio_casa === set.punti_casa && l.punteggio_ospite === set.punti_ospite)
        .sort((a, b) => String(a.registrato_il).localeCompare(String(b.registrato_il))).pop();
    const diCasa = log ? log.punto_casa : (vuoto ? prec.vinto_da_casa : null);
    if (diCasa == null) {
        msg('Questo punto è stato segnato da un altro dispositivo e qui manca il suo dettaglio: serve la rete per annullarlo.');
        Sync.esegui();
        return;
    }

    const righe = [{ t: 'sets', riga: { ...set,
        punti_casa: Math.max(0, set.punti_casa - (diCasa ? 1 : 0)), punti_ospite: Math.max(0, set.punti_ospite - (diCasa ? 0 : 1)),
        completato: false, vinto_da_casa: null } }];
    if (log) righe.push({ t: 'log_punti', riga: { ...log, eliminato: true } });
    if (vuoto) {
        // Si riapre il set precedente: un set vinto in meno, e il set vuoto
        // appena iniziato (se la riga esiste gia') non c'e' piu'.
        righe.push({ t: 'partite', riga: { ...g.p,
            set_vinti_casa: Math.max(0, g.p.set_vinti_casa - (diCasa ? 1 : 0)),
            set_vinti_ospite: Math.max(0, g.p.set_vinti_ospite - (diCasa ? 0 : 1)) } });
        if (g.set.uid) righe.push({ t: 'sets', riga: { ...g.set, eliminato: true } });
    }
    await scriviLocale(righe);
    await lvDisegna(true);
});
