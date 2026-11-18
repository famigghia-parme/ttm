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
// 13/11 (1.4.7): un tocco sull'atleta mostra i suoi incontri e partite
// (paCalcola qui sotto, disegno paHtml in comune.js), con il filtro stagione.

let atSoc = '';                 // '' = tutte le societa'
try { atSoc = localStorage.getItem('ttm.societa') || ''; } catch { }
let atRighe = [];               // un tesseramento per riga (vedi atCarica)
let atSocieta = new Map();      // uid -> societa' (per il numero della societa' scelta)
const AT_MAX = 80;              // oltre, si chiede di scrivere qualche lettera in piu'

viste.atleti = {
    html: `
      <div id="atElenco">
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
      <ul id="lista"></ul>
      </div>
      <div id="paCorpo" hidden></div>`,
    init: atInit,
    suDati: () => { if (paAperto) paApri(paAperto.uid, paAperto.stagione); else if ($('#frmNuovo')?.hidden) atCarica(); }
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
    // 13/11 (1.4.7): un tocco sull'atleta = i suoi incontri e partite
    $('#lista').onclick = e => { const li = e.target.closest('li.atleta[data-uid]'); if (li) paApri(li.dataset.uid); };
    atCarica();
    if (paRiapri) { const r = paRiapri; paRiapri = null; paApri(r.uid, r.stagione); }
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
        return `<li class="atleta cliccabile" data-uid="${r.a.uid}"><b>${esc(r.a.cognome)}</b> ${esc(r.a.nome)}
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
    if (omonimi.length && !await conferma(
        `Esiste già ${cognome} ${nome}: ${[...new Set(omonimi.map(r => r.s ? r.s.nome : 'senza tesseramento'))].join(', ')}.\n` +
        'Se è la stessa persona, il tesseramento per questa società va aggiunto dal PC: qui si creerebbe un doppione.\n\n' +
        'È un\'altra persona con lo stesso nome? Sì per crearla.', 'Attenzione')) return;

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

// ---------------- incontri e partite di un atleta (13/11, 1.4.7) ----------------
// Stessa regola di PartiteAtletaLogica.cs sul PC: solo le partite giocate
// (chiuse o con dei set) con l'atleta scritto, dal suo punto di vista.
// stagione: null = quella corrente, '' = tutte.
let paAperto = null;     // { uid, stagione } dell'atleta aperto
let paRiapri = null;     // tornando dalla scheda di un incontro

async function paCalcola(uid, stagione) {
    const [atleti, partite, incontri, giornate, campionati, squadre] =
        await Promise.all(['atleti', 'partite', 'incontri', 'giornate', 'campionati', 'squadre'].map(tutti));
    const A = perUid(atleti), I = perUid(incontri), G = perUid(giornate), C = perUid(campionati), S = perUid(squadre);
    const a = A.get(uid);
    if (!a) return null;
    const nome = u => u ? (nomeAtleta(A.get(u)) || '?') : '';
    const perInc = new Map();
    for (const p of partite) {
        const casa = p.atleta_casa1_uid === uid || p.atleta_casa2_uid === uid;
        const osp = p.atleta_ospite1_uid === uid || p.atleta_ospite2_uid === uid;
        if (!casa && !osp) continue;
        if (!p.completata && !p.set_vinti_casa && !p.set_vinti_ospite) continue;
        const i = I.get(p.incontro_uid);
        if (!i) continue;
        const compagno = casa ? (p.atleta_casa1_uid === uid ? p.atleta_casa2_uid : p.atleta_casa1_uid)
            : (p.atleta_ospite1_uid === uid ? p.atleta_ospite2_uid : p.atleta_ospite1_uid);
        const lato = (u, testo) => u ? nome(u) : String(testo || '').trim();
        const avv = (casa ? [lato(p.atleta_ospite1_uid, p.avversario_ospite1), lato(p.atleta_ospite2_uid, p.avversario_ospite2)]
            : [lato(p.atleta_casa1_uid), lato(p.atleta_casa2_uid)]).filter(Boolean).join(' / ');
        if (!perInc.has(i.uid)) perInc.set(i.uid, { i, casa, partite: [] });
        perInc.get(i.uid).partite.push({
            ordine: p.ordine, doppio: p.tipo === 'Doppio', compagno: compagno ? nome(compagno) : null, avversari: avv || '?',
            nostri: casa ? p.set_vinti_casa : p.set_vinti_ospite, loro: casa ? p.set_vinti_ospite : p.set_vinti_casa,
            vinta: p.completata && p.vinta_da_casa != null ? p.vinta_da_casa === casa : null
        });
    }
    const tuttiInc = [...perInc.values()].map(({ i, casa, partite }) => {
        const c = C.get(G.get(i.giornata_uid)?.campionato_uid);
        return {
            id: i.uid, data: i.data_ora || '', quando: i.data_ora ? dataBreve(i.data_ora) : '',
            campionato: c?.nome ?? '', stagione: c?.stagione ?? '',
            squadra: S.get(casa ? i.squadra_casa_uid : i.squadra_ospite_uid)?.nome ?? '?',
            avversaria: S.get(casa ? i.squadra_ospite_uid : i.squadra_casa_uid)?.nome ?? '?',
            inCasa: casa, partite: partite.sort((x, y) => x.ordine - y.ordine)
        };
    }).sort((x, y) => String(y.data).localeCompare(String(x.data)));
    const corrente = await stagioneCorrente();
    // 18/11: punti e partite TTitalia (copia sul telefono, vedi stLeggi)
    const copia = await stLeggi(uid);
    const st = copia ? stCalcola(uid, copia.partite, copia.punti) : null;
    const stagioni = [...new Set([...tuttiInc.map(x => x.stagione), ...(st ? stStagioni(st) : [])].filter(Boolean))].sort().reverse();
    if (corrente && !stagioni.includes(corrente)) stagioni.unshift(corrente);
    const scelta = stagione == null ? (corrente || '') : stagione;
    return {
        nome: nomeAtleta(a), stagione: scelta, stagioni, incontri: scelta ? tuttiInc.filter(x => x.stagione === scelta) : tuttiInc,
        storico: st ? stFiltra(st, scelta) : null,
        storicoNota: copia ? '' : (navigator.onLine ? '' : 'Lista partite: serve la rete la prima volta.')
    };
}

async function paApri(uid, stagione = null) {
    const d = await paCalcola(uid, stagione);
    stAggiorna(uid);         // 18/11: in sottofondo; se arriva qualcosa di nuovo si ridisegna
    const c = $('#paCorpo');
    if (!d || !c) return;
    const primaVolta = paAperto?.uid !== uid;
    paAperto = { uid, stagione: d.stagione };
    $('#atElenco').hidden = true;
    c.hidden = false;
    c.innerHTML = paHtml(d);
    if (primaVolta) window.scrollTo(0, 0);
    $('#paIndietro').onclick = paChiudi;
    $('#paStagione').onchange = e => paApri(uid, e.target.value === 'tutte' ? '' : e.target.value);
    c.querySelectorAll('li[data-inc]').forEach(li => li.onclick = () =>
        inApriDa(li.dataset.inc, d.nome, () => { paRiapri = { ...paAperto }; mostra('atleti'); }));
}

function paChiudi() {
    paAperto = null;
    const c = $('#paCorpo');
    if (c) { c.hidden = true; c.innerHTML = ''; }
    if ($('#atElenco')) $('#atElenco').hidden = false;
}

// ---------------- punti e partite dal sito TTitalia (18/11) ----------------
// Li scrive il PC (TtitaliaService) nelle tabelle punteggi_storici e
// partite_storiche. Non si sincronizzano tutte sul telefono (decine di
// migliaia di righe): si chiedono al cloud quelle dell'atleta aperto e se ne
// tiene una copia (voce di 'meta' "storico.<uid>"), cosi' si vedono anche
// senza rete dalla seconda volta. Stessa regola di StoricoAtletaLogica.cs
// sul PC; disegno: stHtml in comune.js.
const ST_RINFRESCO_MS = 10 * 60000;      // stesso atleta: al massimo una richiesta ogni 10 minuti
const stChiesti = new Map();             // uid -> quando

async function stLeggi(uid) { return await metaLeggi('storico.' + uid); }

// Chiede al cloud le righe dell'atleta; se sono cambiate le salva e, se la
// sua pagina e' ancora aperta, la ridisegna. Tabelle che il cloud non ha
// ancora (schema.sql non rieseguito): niente, senza errori.
async function stAggiorna(uid) {
    if (!navigator.onLine || !Cloud.sessione) return;
    const ultima = stChiesti.get(uid);
    if (ultima && Date.now() - ultima < ST_RINFRESCO_MS) return;
    stChiesti.set(uid, Date.now());
    try {
        const leggi = async q => {
            const r = await Cloud.rest('GET', q);
            if (!r.ok) throw Object.assign(new Error('lettura non riuscita'), { status: r.status });
            return r.json || [];
        };
        const u = encodeURIComponent(uid);
        const [a, b, punti] = await Promise.all([
            leggi(`partite_storiche?select=*&atleta_a_uid=eq.${u}&eliminato=eq.false&limit=1000`),
            leggi(`partite_storiche?select=*&atleta_b_uid=eq.${u}&eliminato=eq.false&limit=1000`),
            leggi(`punteggi_storici?select=*&atleta_uid=eq.${u}&eliminato=eq.false&limit=1000`)]);
        const nuova = { partite: [...a, ...b.filter(x => !a.some(y => y.uid === x.uid))], punti };
        const vecchia = await stLeggi(uid);
        const firma = c => c ? JSON.stringify([c.partite.map(x => x.uid + x.modificato_il).sort(), c.punti.map(x => x.uid + x.modificato_il).sort()]) : '';
        if (firma(vecchia) === firma(nuova)) return;
        await metaScrivi('storico.' + uid, nuova);
        if (paAperto?.uid === uid) paApri(uid, paAperto.stagione);
    } catch { /* senza rete o tabelle non ancora nel cloud: si resta con la copia che c'e' */ }
}

// Righe del cloud -> { punti, partite } dal suo punto di vista (come StoricoAtletaLogica.Calcola)
function stCalcola(uid, partite, punti) {
    const lista = [];
    for (const p of partite || []) {
        const a = p.atleta_a_uid === uid;
        if (!a && p.atleta_b_uid !== uid) continue;
        const data = String(p.data || '').slice(0, 10);
        lista.push({
            data, stagione: stStagioneDi(data), squadre: !!p.squadre, gara: p.gara || '', turno: p.turno || '',
            avversario: (a ? p.nome_b : p.nome_a) || '?',
            nostri: a ? p.set_a : p.set_b, loro: a ? p.set_b : p.set_a,
            vinta: a ? p.set_a > p.set_b : p.set_b > p.set_a,
            prob: p.probabilita_a == null ? null : (a ? p.probabilita_a : 1000 - p.probabilita_a)
        });
    }
    const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    lista.sort((x, y) => cmp(y.data, x.data) || cmp(x.gara, y.gara) || cmp(x.turno, y.turno) || cmp(x.avversario, y.avversario));
    return {
        partite: lista,
        punti: (punti || []).filter(p => p.atleta_uid === uid)
            .map(p => ({ data: String(p.data || '').slice(0, 10), punti: p.punti, inizio: !!p.inizio_stagione }))
            .sort((x, y) => cmp(x.data, y.data))
    };
}

// "2026-10-17" -> "2026/27"; "2026-04-19" -> "2025/26" (la stagione comincia il 1 luglio)
function stStagioneDi(data) {
    const anno = +data.slice(0, 4), mese = +data.slice(5, 7);
    const a = mese >= 7 ? anno : anno - 1;
    return `${a}/${String((a + 1) % 100).padStart(2, '0')}`;
}
function stStagioni(st) { return [...st.partite.map(p => p.stagione), ...st.punti.map(p => stStagioneDi(p.data))]; }
function stFiltra(st, stagione) {
    if (!stagione) return st;
    return { partite: st.partite.filter(p => p.stagione === stagione), punti: st.punti.filter(p => stStagioneDi(p.data) === stagione) };
}
