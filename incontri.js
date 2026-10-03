// TennisTavoloManager - incontri.js  (PWA cloud)
// Elenco incontri della stagione e scheda dell'incontro, tutto dai dati
// locali: funziona anche offline. Dalla scheda si aprono la Formazione
// (formazione.js) e i Punti (live.js), che disegnano qui dentro, e si
// scarica il punto per punto per la gara.
//
// Due sezioni del menu usano questo file (stessa struttura nella PWA in
// rete locale, wwwroot/incontri.js):
//  - Incontri: elenco (da giocare / giocate) -> scheda dell'incontro;
//  - Punti:    solo gli incontri da giocare -> un tocco apre subito i Punti.

let inTutti = false, inPassate = false, inAperto = null;
let inModo = 'incontri';        // 'incontri' oppure 'punti': quale sezione e' aperta
try {
    inTutti = localStorage.getItem('ttm.tuttiIncontri') === '1';
    inPassate = localStorage.getItem('ttm.passateIncontri') === '1';
} catch { }

const inVista = modo => ({
    html: '<div id="inCorpo"></div>',
    init: () => { inModo = modo; inAperto = null; fz = null; fzModificata = false; fzRitorno = null; lvLascia(); inElenco(); },
    // Si passa a un'altra vista (Rosa, Atleti, Account): i Punti si chiudono.
    esci: () => lvLascia(),
    // Punti aperti: si ridisegnano dai dati locali (solo se e' cambiato
    // qualcosa). Formazione aperta: con modifiche non salvate non si
    // ridisegna nulla (si perderebbero); senza, si ricarica con i dati nuovi.
    suDati: () => lv ? lvDisegna()
        : fz ? (fzModificata ? null : fzApri(fz.uid, fz.sel, true))
        : inAperto ? inScheda(inAperto) : inElenco()
});
viste.incontri = inVista('incontri');
viste.punti = inVista('punti');

async function datiIncontri() {
    const stag = await stagioneCorrente();
    const [inc, gio, camp, sq, soc] = await Promise.all(
        ['incontri', 'giornate', 'campionati', 'squadre', 'societa'].map(tutti));
    const G = perUid(gio), C = perUid(camp), S = perUid(sq), SOC = perUid(soc);
    return inc.map(i => {
        const g = G.get(i.giornata_uid), c = g && C.get(g.campionato_uid);
        const casa = S.get(i.squadra_casa_uid), ospite = S.get(i.squadra_ospite_uid);
        return {
            i, c, casa, ospite,
            socCasa: SOC.get(casa?.societa_uid), socOspite: SOC.get(ospite?.societa_uid),
            nostro: !!(casa?.nostra_squadra || ospite?.nostra_squadra),
            terminato: i.stato === 'Terminato',
            quando: i.data_ora || null,       // per prossimoGiorno
            // per htmlGruppi: federazione > campionato > girone
            tipo: c?.tipo, campionato: c?.nome, girone: casa?.girone || ospite?.girone || ''
        };
    }).filter(x => x.c && x.c.stagione === stag);
}

async function inElenco() {
    inAperto = null;
    const c = $('#inCorpo');
    if (!c) return;
    const punti = inModo === 'punti';      // sezione Punti: solo le gare da giocare
    const passate = inPassate && !punti;
    let lista = await datiIncontri();
    // "Prossimi" guarda sempre e solo le nostre squadre, anche con "tutti" attivo
    const prossimi = passate ? null : prossimoGiorno(lista.filter(x => !x.terminato));
    // Solo i nostri, se ne esiste almeno uno marcato (stessa regola del PC)
    if (!inTutti && lista.some(x => x.nostro)) lista = lista.filter(x => x.nostro);

    // Due schede separate: "Da giocare" (prima la piu' vicina) e "Giocate"
    // (prima la piu' recente). Una lista per volta: niente scorrimento
    // lungo per arrivare alle gare giocate. inPassate = scheda Giocate.
    const t = x => x.i.data_ora ? Date.parse(x.i.data_ora) : Infinity;
    const da = lista.filter(x => !x.terminato).sort((a, b) => t(a) - t(b));
    const fatte = lista.filter(x => x.terminato)
        .sort((a, b) => (t(b) === Infinity ? 0 : t(b)) - (t(a) === Infinity ? 0 : t(a)));
    const mostrate = passate ? fatte : da;
    const scaricati = await metaLeggi('scaricati', []);

    // conCampionato: nei "Prossimi" (fuori dai gruppi) serve dire di che campionato e'
    const voce = (x, conCampionato) => `
      <li class="atleta cliccabile${inTutti && x.nostro ? ' nostro' : ''}${x.terminato ? ' giocato' : ''}" data-uid="${x.i.uid}">
        <b>${esc(x.casa?.nome)}</b> – <b>${esc(x.ospite?.nome)}</b>
        ${x.terminato ? `<span>${x.i.punti_casa ?? '-'} - ${x.i.punti_ospite ?? '-'}</span>`
            : scaricati.includes(x.i.uid) ? '<span>📥</span>' : ''}<br>
        <small>${esc(dataBreve(x.i.data_ora))}${conCampionato === true ? ' · ' + esc(x.c.nome) + (x.girone ? ' ' + esc(x.girone) : '') : ''}</small>
      </li>`;

    // Tanti incontri: raggruppati per federazione > campionato > girone
    // (htmlGruppi in app.js). Sopra, nella scheda "Da giocare", il gruppo
    // "Prossimi": tutte le nostre gare del prossimo giorno di gara.

    c.innerHTML = `
      ${punti ? '<div class="lvSceltaTit">Di quale incontro segni i punti?</div>' : ''}
      <label class="flagTutti"><input type="checkbox" id="chkTutti"${inTutti ? ' checked' : ''}>
        Mostra anche gli incontri delle altre squadre</label>
      ${punti ? '' : `<div class="tabs">
        <button id="tabDa"${passate ? '' : ' class="att"'}>Da giocare (${da.length})</button>
        <button id="tabFatte"${passate ? ' class="att"' : ''}>Giocate (${fatte.length})</button>
      </div>`}
      ${htmlProssimi(prossimi, x => voce(x, true))}
      ${mostrate.length ? htmlGruppi('incontri', mostrate, x => voce(x))
            : `<p class="vuoto">${passate ? 'Nessuna gara giocata' : 'Nessun incontro da giocare'}</p>`}`;
    agganciaGruppi('incontri', c);

    $('#chkTutti').onchange = e => { inTutti = e.target.checked; try { localStorage.setItem('ttm.tuttiIncontri', inTutti ? '1' : '0'); } catch { } inElenco(); };
    const scheda = v => { inPassate = v; try { localStorage.setItem('ttm.passateIncontri', v ? '1' : '0'); } catch { } inElenco(); };
    if (!punti) {
        $('#tabDa').onclick = () => scheda(false);
        $('#tabFatte').onclick = () => scheda(true);
    }
    // Incontri: un tocco apre la scheda. Punti: apre subito il conteggio.
    c.querySelectorAll('li[data-uid]').forEach(li => li.onclick = () => punti ? lvApri(li.dataset.uid) : inScheda(li.dataset.uid));
}

// Scheda: dati, partite con set, formazioni. Sola lettura.
async function inScheda(uid) {
    inAperto = uid;
    const c = $('#inCorpo');
    if (!c) return;
    const x = (await datiIncontri()).find(y => y.i.uid === uid);
    if (!x) { inElenco(); return; }
    const i = x.i;

    const [partite, formazioni, atleti] = await Promise.all([
        perIndice('partite', 'incontro_uid', uid),
        perIndice('formazioni', 'incontro_uid', uid),
        tutti('atleti')]);
    const A = perUid(atleti);
    const abcInCasa = i.squadra_lettere_abc_uid !== i.squadra_ospite_uid;

    const nome = (u, libero) => nomeAtleta(A.get(u)) || libero || '?';
    const lato = (p, casa) => {
        const n1 = casa ? nome(p.atleta_casa1_uid) : nome(p.atleta_ospite1_uid, p.avversario_ospite1);
        if (p.tipo !== 'Doppio') return n1;
        return n1 + ' / ' + (casa ? nome(p.atleta_casa2_uid) : nome(p.atleta_ospite2_uid, p.avversario_ospite2));
    };

    const righePartite = [];
    for (const p of partite.sort((a, b) => a.ordine - b.ordine)) {
        const set = (await perIndice('sets', 'partita_uid', p.uid))
            .filter(s => s.completato).sort((a, b) => a.numero - b.numero)
            .map(s => `${s.punti_casa}-${s.punti_ospite}`);
        righePartite.push(`
          <li class="rpPart">
            <b>Partita ${p.ordine}</b> <small>${esc(etichettaPartita(p))}${p.numero_tavolo > 1 ? ' · tavolo ' + p.numero_tavolo : ''}</small><br>
            <span class="${p.vinta_da_casa === true ? 'rpVince' : ''}">${esc(lato(p, true))}</span> –
            <span class="${p.vinta_da_casa === false ? 'rpVince' : ''}">${esc(lato(p, false))}</span><br>
            <small>${p.completata ? `${p.set_vinti_casa}-${p.set_vinti_ospite} · ${set.join('  ')}`
                : p.in_corso ? 'in corso' : 'da giocare'}</small>
          </li>`);
    }

    const giocate = partite.filter(p => p.completata);
    const pc = giocate.length ? giocate.filter(p => p.vinta_da_casa === true).length : i.punti_casa;
    const po = giocate.length ? giocate.filter(p => p.vinta_da_casa === false).length : i.punti_ospite;

    // Sotto il nome della squadra: societa' e suo numero (serve al referto)
    const squadra = (sq, casa) => {
        const f = formazioni.filter(r => r.squadra_uid === sq?.uid)
            .sort((a, b) => ORDINE_RUOLI.indexOf(a.ruolo) - ORDINE_RUOLI.indexOf(b.ruolo));
        const colore = casa ? i.colore_maglia_casa : i.colore_maglia_ospite;
        const soc = casa ? x.socCasa : x.socOspite, cod = codiceSocieta(soc);
        return `<div class="rpSq"><b>${esc(sq?.nome)}</b>${colore ? ' · maglia ' + esc(colore) : ''}
              ${soc ? `<small>Società: ${esc(soc.nome)}${cod ? ' · codice ' + esc(cod) : ''}</small>` : ''}</div>` +
            (f.length ? '<ul>' + f.map(r => `<li class="rpForm"><b>${esc(etichettaRuolo(r.ruolo, casa === abcInCasa))}</b>
                ${esc(nome(r.atleta_uid, r.nome_libero))}${r.tessera ? ` <small>${esc(r.tessera)}</small>` : ''}</li>`).join('') + '</ul>'
                : '<p class="vuoto">Formazione non registrata</p>');
    };

    const scaricato = await metaLeggi('scaricato.' + uid);
    c.innerHTML = `
      <button class="pieno chiaro" id="inIndietro">${inModo === 'punti' ? '← Punti' : '← Incontri'}</button>
      <div class="lvTesta"><b>${esc(x.casa?.nome)}</b>
        <span class="lvTot">${pc ?? '-'} – ${po ?? '-'}<small class="lvEtic">partite</small></span>
        <b>${esc(x.ospite?.nome)}</b></div>
      <div class="lvInfo">${esc([dataBreve(i.data_ora), x.c.nome, i.luogo].filter(Boolean).join(' · '))}</div>
      ${x.terminato ? '' : `
        <button class="pieno" id="inPunti">🏓 Segna i punti</button>
        <button class="pieno" id="inFormazione">✏️ Formazione</button>
        <button class="pieno chiaro" id="inScarica">${scaricato ? '📥 Scaricato — aggiorna' : '📥 Scarica per la gara'}</button>
        <div class="lvInfo">${scaricato ? 'Ultimo scarico: ' + new Date(scaricato).toLocaleString('it-IT') : 'Da fare prima di partire, con la rete: poi funziona anche senza.'}</div>`}
      <div id="msg"></div>
      <h4>Partite</h4>${righePartite.length ? '<ul>' + righePartite.join('') + '</ul>' : '<p class="vuoto">Partite non ancora create</p>'}
      <h4>Formazioni</h4>${squadra(x.casa, true)}${squadra(x.ospite, false)}`;

    $('#inIndietro').onclick = inElenco;
    const bp = $('#inPunti');
    if (bp) bp.onclick = () => lvApri(uid);
    const bf = $('#inFormazione');
    if (bf) bf.onclick = () => fzApri(uid);
    const b = $('#inScarica');
    if (b) b.onclick = async () => {
        b.disabled = true; msg('Scarico in corso…', true);
        try {
            await Sync.esegui();              // prima tutto il resto aggiornato
            await scaricaIncontro(uid);
            inScheda(uid);
        } catch (e) {
            msg(e.offline ? 'Serve la rete per scaricare.' : e.message);
            b.disabled = false;
        }
    };
}
