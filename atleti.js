// TennisTavoloManager - atleti.js  (PWA cloud)
// Tesserati della stagione + inserimento di un nuovo atleta (anagrafica +
// affiliazione con tessera), anche offline.
//
// Dal 03/10:
//  - si cerca per cognome e nome SENZA scegliere prima la societa' (prima
//    la ricerca non trovava nulla finche' non se ne sceglieva una);
//  - la tendina delle societa' e' raggruppata: le nostre, poi FITET, poi CSI;
//  - accanto all'atleta compaiono categoria e punti FITET quando ci sono
//    (chi non e' tesserato FITET non li ha: non compare nulla).

let atSoc = '';                 // '' = tutte le societa'
try { atSoc = localStorage.getItem('ttm.societa') || ''; } catch { }
let atRighe = [];               // un tesseramento per riga (vedi atCarica)
let atSocieta = new Map();      // uid -> societa' (per il numero della societa' scelta)
const AT_MAX = 80;              // oltre, si chiede di scrivere qualche lettera in piu'

viste.atleti = {
    html: `
      <select id="selSoc"></select>
      <div id="socInfo" class="lvInfo"></div>
      <input id="cerca" type="search" placeholder="Cerca cognome e nome…" autocomplete="off">
      <button id="btnNuovo" class="pieno">+ Nuovo atleta</button>
      <form id="frmNuovo" hidden autocomplete="off">
        <input name="cognome" placeholder="Cognome" required maxlength="50" autocapitalize="words">
        <input name="nome"    placeholder="Nome"    required maxlength="50" autocapitalize="words">
        <div class="sesso">
          <label><input type="radio" name="sesso" value="1" style="width:auto"> M</label>
          <label><input type="radio" name="sesso" value="2" style="width:auto"> F</label>
        </div>
        <input name="tessera" placeholder="Tessera (facoltativa)" maxlength="20">
        <div id="msg"></div>
        <div class="riga">
          <button type="button" id="btnAnnulla" class="pieno chiaro">Annulla</button>
          <button type="submit" id="btnSalva" class="pieno">Salva</button>
        </div>
      </form>
      <ul id="lista"></ul>`,
    init: atInit,
    suDati: () => { if ($('#frmNuovo')?.hidden) atCarica(); }
};

// Per confrontare senza badare a maiuscole e accenti ("Niccolo'" trova "Niccolò")
const atNorma = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function atInit() {
    const stag = await stagioneCorrente();
    const [societa, squadre, campionati] = await Promise.all(['societa', 'squadre', 'campionati'].map(tutti));
    const C = perUid(campionati);
    atSocieta = perUid(societa);
    // Le societa' delle nostre squadre nella stagione: in cima alla tendina
    const nostre = new Set(squadre.filter(s => s.nostra_squadra && C.get(s.campionato_uid)?.stagione === stag).map(s => s.societa_uid));
    const perNome = (a, b) => a.nome.localeCompare(b.nome, 'it');
    // federazione(): societa.tipo arriva come "0"/"1", vedi app.js
    const fed = s => federazione(s.tipo) || 'Altro';
    const opz = (s, conTipo) => `<option value="${s.uid}">${esc(s.nome)}${conTipo ? ` (${esc(fed(s))})` : ''}</option>`;
    const gruppo = (titolo, lista, conTipo) => lista.length
        ? `<optgroup label="${esc(titolo)}">${lista.sort(perNome).map(s => opz(s, conTipo)).join('')}</optgroup>` : '';
    const altre = societa.filter(s => !nostre.has(s.uid));
    const federazioni = [...new Set(altre.map(fed))]
        .sort((a, b) => (ORDINE_FEDERAZIONI[a] ?? 9) - (ORDINE_FEDERAZIONI[b] ?? 9) || a.localeCompare(b, 'it'));

    const sel = $('#selSoc');
    sel.innerHTML = '<option value="">Tutte le società</option>' +
        gruppo('Le nostre', societa.filter(s => nostre.has(s.uid)), true) +
        federazioni.map(f => gruppo(f, altre.filter(s => fed(s) === f), false)).join('');
    if (!societa.some(s => s.uid === atSoc)) atSoc = '';
    sel.value = atSoc;
    sel.onchange = () => { atSoc = sel.value; try { localStorage.setItem('ttm.societa', atSoc); } catch { } atDisegna(); };

    $('#cerca').oninput = atDisegna;
    $('#btnNuovo').onclick = () => {
        if (!atSoc) { avviso('Per un nuovo atleta scegli prima la società nella tendina.'); return; }
        $('#frmNuovo').hidden = false; $('#frmNuovo').cognome.focus();
    };
    $('#btnAnnulla').onclick = () => { $('#frmNuovo').reset(); $('#frmNuovo').hidden = true; msg(''); };
    $('#frmNuovo').onsubmit = atSalva;
    atCarica();
}

// Una riga per TESSERAMENTO della stagione (atleta + societa'): lo stesso
// atleta tesserato FITET e CSI compare due volte, una per societa'. In fondo
// gli atleti attivi senza tesseramento nella stagione (societa' = null):
// si trovano solo cercando, e servono a non crearli una seconda volta.
async function atCarica() {
    const stag = await stagioneCorrente();
    const [atleti, societa, affiliazioni] = await Promise.all(['atleti', 'societa', 'atleti_societa'].map(tutti));
    const A = perUid(atleti), S = perUid(societa);
    const classifica = classificaFitet(affiliazioni, S, stag);

    const righe = [], visti = new Set(), tesserati = new Set();
    for (const af of affiliazioni) {
        const a = A.get(af.atleta_uid), s = S.get(af.societa_uid);
        if (af.stagione !== stag || !a || !a.attivo || !s) continue;
        const k = a.uid + '|' + s.uid;
        if (visti.has(k)) continue;
        visti.add(k); tesserati.add(a.uid);
        const cl = classifica.get(a.uid);
        righe.push({ a, s, tessera: af.tessera, categoria: cl?.categoria_fitet ?? null, punti: cl?.punti_fitet ?? null });
    }
    for (const a of atleti) if (a.attivo && !tesserati.has(a.uid)) righe.push({ a, s: null, tessera: null, categoria: null, punti: null });

    for (const r of righe) r.chiave = atNorma(r.a.cognome + ' ' + r.a.nome);
    righe.sort((x, y) => nomeAtleta(x.a).localeCompare(nomeAtleta(y.a), 'it') || (x.s?.nome || '').localeCompare(y.s?.nome || '', 'it'));
    atRighe = righe;
    atDisegna();
}

function atDisegna() {
    const lista = $('#lista');
    if (!lista) return;
    // Societa' scelta: federazione e numero (codice) della societa', se c'e'
    const scelta = atSocieta.get(atSoc), info = $('#socInfo');
    if (info) info.textContent = scelta
        ? `${federazione(scelta.tipo)} · codice società: ${codiceSocieta(scelta) || 'non indicato'}` : '';
    // Ogni parola scritta deve esserci, in qualsiasi ordine: "mario ros" trova "Rossi Mario"
    const parole = atNorma($('#cerca')?.value).split(/\s+/).filter(Boolean);
    const trova = r => parole.every(p => r.chiave.includes(p));

    let l;
    if (atSoc) l = atRighe.filter(r => r.s?.uid === atSoc && trova(r));
    else if (parole.join('').length < 2) {
        const n = new Set(atRighe.map(r => r.a.uid)).size;
        lista.innerHTML = `<li class="vuoto">Scrivi almeno due lettere del cognome o del nome per cercare fra tutti (${n} atleti), oppure scegli una società.</li>`;
        return;
    } else l = atRighe.filter(trova);

    if (!l.length) { lista.innerHTML = '<li class="vuoto">Nessun atleta</li>'; return; }
    const troppi = l.length > AT_MAX ? l.length - AT_MAX : 0;
    lista.innerHTML = l.slice(0, AT_MAX).map(r => {
        // Seconda riga: la societa' (solo cercando fra tutte), poi categoria e punti FITET
        const sotto = [];
        if (!atSoc) sotto.push(r.s ? `${r.s.nome} (${federazione(r.s.tipo)})` : 'non tesserato in questa stagione');
        if (r.categoria != null) sotto.push('cat ' + r.categoria);
        if (r.punti != null) sotto.push(r.punti + ' pti');
        return `<li class="atleta" data-uid="${r.a.uid}"><b>${esc(r.a.cognome)}</b> ${esc(r.a.nome)}
          <span>${esc({ 1: 'M', 2: 'F' }[r.a.sesso] || '-')} · ${esc(r.tessera || '—')}</span>
          ${sotto.length ? `<br><small>${esc(sotto.join(' · '))}</small>` : ''}</li>`;
    }).join('') + (troppi ? `<li class="vuoto">…e altri ${troppi}: scrivi qualche lettera in più.</li>` : '');
}

async function atSalva(e) {
    e.preventDefault();
    if (!atSoc) { msg('Scegli prima la società'); return; }
    const f = e.target;
    const cognome = f.cognome.value.trim(), nome = f.nome.value.trim();
    if (!cognome || !nome) { msg('Cognome e nome sono obbligatori.'); return; }

    // Doppio tocco = doppio atleta: si blocca il duplicato nella societa'
    const chiave = atNorma(cognome + ' ' + nome);
    const omonimi = atRighe.filter(r => r.chiave === chiave);
    if (omonimi.some(r => r.s?.uid === atSoc)) {
        msg(`${cognome} ${nome} è già tesserato per questa società.`);
        return;
    }
    // Stesso nome in un'altra societa': quasi sempre e' la stessa persona, e
    // crearla di nuovo fa due atleti distinti. Il tesseramento di un atleta
    // che esiste gia' si aggiunge dal PC.
    if (omonimi.length && !confirm(
        `Esiste già ${cognome} ${nome}: ${[...new Set(omonimi.map(r => r.s ? r.s.nome : 'senza tesseramento'))].join(', ')}.\n` +
        'Se è la stessa persona, il tesseramento per questa società va aggiunto dal PC: qui si creerebbe un doppione.\n\n' +
        'È un\'altra persona con lo stesso nome? OK per crearla.')) return;

    const atleta = { nome, cognome, codice_fiscale: null, sesso: +(f.sesso.value || 0), attivo: true, uid: nuovoUid() };
    const affiliazione = {
        atleta_uid: atleta.uid, societa_uid: atSoc, stagione: await stagioneCorrente(),
        tessera: f.tessera.value.trim() || null, ruoli: 1, carica: null, categoria_fitet: null, punti_fitet: null
    };
    // Stessa transazione: o entrano entrambe o nessuna
    await scriviLocale([{ t: 'atleti', riga: atleta }, { t: 'atleti_societa', riga: affiliazione }]);

    f.reset(); f.hidden = true; msg('');
    await atCarica();
    avviso(`${cognome} ${nome} aggiunto ✓`, true);
}
