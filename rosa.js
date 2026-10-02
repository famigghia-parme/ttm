// TennisTavoloManager - rosa.js  (PWA cloud)
// Vista Rosa sui dati locali. Stessa logica del dialog desktop: sopra chi e'
// in rosa, sotto gli altri tesserati-atleti della societa' nella stagione
// del campionato. Nulla viene scritto finche' non si preme "Salva rosa";
// il salvataggio va in outbox e parte al cloud appena c'e' rete.

let rs = null;        // squadra aperta
let rsSesso = '';     // '' = tutti, 'F', 'M'
let rsModificata = false;

viste.rosa = {
    html: '<div id="rsCorpo"></div>',
    init: rsElenco,
    // Dati nuovi dal cloud: si ridisegna solo se non ci sono modifiche in corso
    suDati: () => { if (!rs) rsElenco(); else if (!rsModificata) rsApri(rs.uid, true); }
};

const SESSO = { 1: 'M', 2: 'F' };

async function rsElenco() {
    rs = null; rsModificata = false;
    const c = $('#rsCorpo');
    if (!c) return;
    const stag = await stagioneCorrente();
    const [squadre, campionati, rose] = await Promise.all(['squadre', 'campionati', 'atleti_squadre'].map(tutti));
    const C = perUid(campionati);

    const lista = squadre
        .map(s => ({ s, c: C.get(s.campionato_uid) }))
        .filter(x => x.c?.stagione === stag)
        .sort((a, b) => a.c.nome.localeCompare(b.c.nome, 'it')
            || (b.s.nostra_squadra - a.s.nostra_squadra)
            || a.s.nome.localeCompare(b.s.nome, 'it'));
    if (!lista.length) { c.innerHTML = '<p class="vuoto">Nessuna squadra in questa stagione</p>'; return; }

    // Federazione > campionato > girone, come gli incontri (htmlGruppi in app.js)
    const voci = lista.map(({ s, c: cp }) => ({
        s, tipo: cp.tipo, campionato: cp.nome, girone: s.girone || '',
        n: rose.filter(r => r.squadra_uid === s.uid && r.stagione === cp.stagione).length
    }));
    c.innerHTML = htmlGruppi('rosa', voci, v => `<li class="atleta cliccabile" data-uid="${v.s.uid}">
          <b>${esc(v.s.nome)}</b>${v.s.nostra_squadra ? ' <small class="rsNostra">nostra</small>' : ''}
          <span>${v.n} in rosa</span></li>`);
    agganciaGruppi('rosa', c);
    c.querySelectorAll('li[data-uid]').forEach(li => li.onclick = () => rsApri(li.dataset.uid));
}

// daSync = ricarica per dati nuovi dal cloud. La lettura e' asincrona: se
// nel frattempo l'utente ha toccato un atleta, la ricarica si abbandona,
// altrimenti cancellerebbe il tocco (visto il 02/10 con i test).
async function rsApri(uidSquadra, daSync = false) {
    const squadra = await leggi('squadre', uidSquadra);
    const campionato = await leggi('campionati', squadra.campionato_uid);
    const societa = await leggi('societa', squadra.societa_uid);
    const stag = campionato.stagione;

    const [affiliazioni, atleti, tutteSoc, rosaRighe] = await Promise.all([
        tutti('atleti_societa'), tutti('atleti'), tutti('societa'),
        perIndice('atleti_squadre', 'squadra_uid', uidSquadra)]);
    const A = perUid(atleti), S = perUid(tutteSoc);

    // Categoria/punti FITET della stagione: se piu' affiliazioni, quella con piu' punti
    const classifica = new Map();
    for (const af of affiliazioni) {
        if (af.stagione !== stag || S.get(af.societa_uid)?.tipo !== 'FITET') continue;
        if (af.categoria_fitet == null && af.punti_fitet == null) continue;
        const prima = classifica.get(af.atleta_uid);
        if (!prima || (af.punti_fitet ?? 0) > (prima.punti_fitet ?? 0)) classifica.set(af.atleta_uid, af);
    }

    const inRosa = new Set(rosaRighe.filter(r => r.stagione === stag).map(r => r.atleta_uid));
    const visti = new Set();
    const elenco = [];
    for (const af of affiliazioni) {
        // Solo atleti (niente dirigenti/tecnici puri), attivi, della societa' e stagione
        if (af.societa_uid !== squadra.societa_uid) continue;
        if (af.stagione !== stag || !(af.ruoli & 1) || visti.has(af.atleta_uid)) continue;
        const a = A.get(af.atleta_uid);
        if (!a || !a.attivo) continue;
        visti.add(a.uid);
        const cl = classifica.get(a.uid);
        elenco.push({
            uid: a.uid, cognome: a.cognome, nome: a.nome, sesso: SESSO[a.sesso] || '-',
            tessera: af.tessera, categoria: cl?.categoria_fitet, punti: cl?.punti_fitet,
            inRosa: inRosa.has(a.uid)
        });
    }
    // Chi e' in rosa ma non piu' tesserato resta visibile, per poterlo togliere
    for (const u of inRosa) if (!visti.has(u) && A.get(u)) {
        const a = A.get(u);
        elenco.push({ uid: a.uid, cognome: a.cognome, nome: a.nome, sesso: SESSO[a.sesso] || '-', inRosa: true });
    }

    if (daSync && (rsModificata || rs?.uid !== uidSquadra)) return;

    const lim = CONFIG.ROSA[societa?.tipo] || CONFIG.ROSA.FITET;
    rs = {
        uid: uidSquadra, squadra: squadra.nome, campionato: campionato.nome, stagione: stag,
        min: minimoRosa(campionato.formula), max: lim.max, atleti: elenco,
        femminile: /femminile/i.test(campionato.nome)
    };
    rsSesso = rs.femminile ? 'F' : '';
    rsModificata = false;
    rsDisegna();
}

// Scheletro costruito UNA volta; le liste si ridisegnano da sole (rsListe),
// cosi' la casella di ricerca non perde il fuoco.
function rsDisegna() {
    const filtro = (v, t) => `<button data-sx="${v}" class="${rsSesso === v ? 'att' : ''}">${t}</button>`;
    $('#rsCorpo').innerHTML = `
    <button class="pieno chiaro" id="rsIndietro">← Squadre</button>
    <h4>${esc(rs.squadra)}</h4>
    <div class="lvInfo">${esc(rs.campionato)} · ${esc(rs.stagione)}</div>
    <div id="rsConta" class="rsConta"></div>
    <h4 id="rsTitDentro"></h4><ul id="rsDentro"></ul>
    <h4 id="rsTitFuori"></h4>
    <div class="tabs">${filtro('', 'Tutti')}${filtro('F', 'Femmine')}${filtro('M', 'Maschi')}</div>
    <input id="rsCerca" type="search" placeholder="Cerca per nome…">
    <ul id="rsFuori"></ul>
    <div id="msg"></div>
    <button class="pieno rsSalva" id="rsSalva">Salva rosa</button>`;

    $('#rsIndietro').onclick = () => {
        if (rsModificata && !confirm('Rosa modificata e non salvata. Uscire lo stesso?')) return;
        rsElenco();
    };
    document.querySelectorAll('.tabs button[data-sx]').forEach(b => b.onclick = () => {
        rsSesso = b.dataset.sx;
        document.querySelectorAll('.tabs button[data-sx]').forEach(x => x.classList.toggle('att', x.dataset.sx === rsSesso));
        rsListe();
    });
    $('#rsCerca').oninput = rsListe;
    $('#rsSalva').onclick = rsSalva;
    rsListe();
}

const rsAlfa = (a, b) => (a.cognome + ' ' + a.nome).localeCompare(b.cognome + ' ' + b.nome, 'it');

function rsDettagli(a) {
    const p = [];
    if (a.sesso && a.sesso !== '-') p.push(a.sesso);
    if (a.tessera) p.push('tess. ' + a.tessera);
    if (a.categoria != null) p.push('cat ' + a.categoria);
    if (a.punti != null) p.push(a.punti + ' pti');
    return p.join(' · ');
}

function rsRiga(a, dentro) {
    return `<li class="rsRiga${dentro ? ' dentro' : ''}" data-uid="${a.uid}">
      <div><b>${esc(a.cognome)}</b> ${esc(a.nome)}<small>${esc(rsDettagli(a))}</small></div>
      <span class="rsAz">${dentro ? '✕' : '+'}</span></li>`;
}

function rsListe() {
    const q = ($('#rsCerca')?.value || '').trim().toLowerCase();
    const dentro = rs.atleti.filter(a => a.inRosa).sort(rsAlfa);
    const tuttiFuori = rs.atleti.filter(a => !a.inRosa);
    const fuori = tuttiFuori.filter(a =>
        (!rsSesso || a.sesso === rsSesso || a.sesso === '-') &&
        (!q || (a.cognome + ' ' + a.nome).toLowerCase().includes(q) || (a.nome + ' ' + a.cognome).toLowerCase().includes(q))
    ).sort(rsAlfa);

    $('#rsTitDentro').textContent = `In rosa (${dentro.length})`;
    $('#rsTitFuori').textContent = fuori.length === tuttiFuori.length
        ? `Altri tesserati (${tuttiFuori.length})`
        : `Altri tesserati (${fuori.length} di ${tuttiFuori.length})`;
    $('#rsDentro').innerHTML = dentro.length ? dentro.map(a => rsRiga(a, true)).join('') : '<li class="vuoto">Nessun atleta in rosa</li>';
    $('#rsFuori').innerHTML = fuori.length ? fuori.map(a => rsRiga(a, false)).join('') : '<li class="vuoto">Nessun atleta</li>';

    let conta = rs.max > 0 ? `In rosa: ${dentro.length} / ${rs.max}` : `In rosa: ${dentro.length}`;
    if (dentro.length < rs.min) conta += ` (minimo ${rs.min})`;
    $('#rsConta').textContent = conta + (rsModificata ? ' · da salvare' : '');
    document.querySelectorAll('.rsRiga[data-uid]').forEach(li => li.onclick = () => rsSposta(li.dataset.uid));
}

function rsSposta(uid) {
    const a = rs.atleti.find(x => x.uid === uid);
    if (!a) return;
    if (!a.inRosa && rs.max > 0 && rs.atleti.filter(x => x.inRosa).length >= rs.max) {
        msg(`Massimo ${rs.max} atleti in rosa`);
        return;
    }
    a.inRosa = !a.inRosa;
    rsModificata = true;
    msg('');
    rsListe();
}

// Come ImpostaRosaSquadraAsync sul PC: chi resta conserva la sua riga, chi
// esce diventa eliminato, chi entra riprende la sua vecchia riga se c'e'.
async function rsSalva() {
    const voluti = new Set(rs.atleti.filter(a => a.inRosa).map(a => a.uid));
    // Sotto il minimo per giocare: avviso, non blocco (come sul PC).
    if (voluti.size < rs.min &&
        !confirm(`In rosa ci sono ${voluti.size} atleti: per giocare ne servono almeno ${rs.min}.\nSalvare comunque?`)) return;
    if (rs.max > 0 && voluti.size > rs.max) { msg(`Massimo ${rs.max} atleti in rosa.`); return; }

    // Tutte le righe, anche quelle eliminate: si riusano
    const db = await apriDb();
    const righe = (await idbReq(db.transaction('atleti_squadre').objectStore('atleti_squadre')
        .index('squadra_uid').getAll(rs.uid))).filter(r => r.stagione === rs.stagione);

    const scritture = [];
    const atleti = new Set([...voluti, ...righe.map(r => r.atleta_uid)]);
    for (const u of atleti) {
        const sue = righe.filter(r => r.atleta_uid === u);
        const vive = sue.filter(r => !r.eliminato);
        if (voluti.has(u)) {
            if (vive.length) {
                // gia' in rosa: eventuali doppioni vivi si eliminano
                for (const r of vive.slice(1)) scritture.push({ t: 'atleti_squadre', riga: { ...r, eliminato: true } });
            } else if (sue.length) {
                scritture.push({ t: 'atleti_squadre', riga: { ...sue[0], eliminato: false } });   // rientra
            } else {
                scritture.push({ t: 'atleti_squadre', riga: { atleta_uid: u, squadra_uid: rs.uid, stagione: rs.stagione } });
            }
        } else {
            for (const r of vive) scritture.push({ t: 'atleti_squadre', riga: { ...r, eliminato: true } });
        }
    }
    if (scritture.length) await scriviLocale(scritture);
    rsModificata = false;
    await rsApri(rs.uid);
    msg(navigator.onLine ? 'Salvata ✓' : 'Salvata sul telefono ✓ — parte al cloud appena c\'è rete', true);
}
