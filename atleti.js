// TennisTavoloManager - atleti.js  (PWA cloud)
// Tesserati di una societa' nella stagione + inserimento di un nuovo atleta
// (anagrafica + affiliazione con tessera), anche offline.

let atSoc = '';
try { atSoc = localStorage.getItem('ttm.societa') || ''; } catch { }
let atElenco = [];

viste.atleti = {
    html: `
      <select id="selSoc"></select>
      <input id="cerca" type="search" placeholder="Cerca per nome…">
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

async function atInit() {
    const societa = (await tutti('societa')).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    const sel = $('#selSoc');
    sel.innerHTML = '<option value="">— scegli la società —</option>' +
        societa.map(s => `<option value="${s.uid}">${esc(s.nome)} (${esc(s.tipo)})</option>`).join('');
    if (!societa.some(s => s.uid === atSoc)) atSoc = '';
    sel.value = atSoc;
    sel.onchange = () => { atSoc = sel.value; try { localStorage.setItem('ttm.societa', atSoc); } catch { } atCarica(); };

    $('#cerca').oninput = atDisegna;
    $('#btnNuovo').onclick = () => { $('#frmNuovo').hidden = false; $('#frmNuovo').cognome.focus(); };
    $('#btnAnnulla').onclick = () => { $('#frmNuovo').reset(); $('#frmNuovo').hidden = true; msg(''); };
    $('#frmNuovo').onsubmit = atSalva;
    atCarica();
}

async function atCarica() {
    atElenco = [];
    if (atSoc) {
        const stag = await stagioneCorrente();
        const A = perUid(await tutti('atleti'));
        const visti = new Set();
        for (const af of await perIndice('atleti_societa', 'societa_uid', atSoc)) {
            const a = A.get(af.atleta_uid);
            if (af.stagione !== stag || !a || !a.attivo || visti.has(a.uid)) continue;
            visti.add(a.uid);
            atElenco.push({ ...a, tessera: af.tessera });
        }
        atElenco.sort((x, y) => nomeAtleta(x).localeCompare(nomeAtleta(y), 'it'));
    }
    atDisegna();
}

function atDisegna() {
    const q = ($('#cerca')?.value || '').trim().toLowerCase();
    const l = atElenco.filter(a => nomeAtleta(a).toLowerCase().includes(q));
    $('#lista').innerHTML =
        !atSoc ? '<li class="vuoto">Scegli una società</li>'
            : !l.length ? '<li class="vuoto">Nessun atleta</li>'
                : l.map(a => `<li class="atleta"><b>${esc(a.cognome)}</b> ${esc(a.nome)}
                    <span>${esc({ 1: 'M', 2: 'F' }[a.sesso] || '-')} · ${esc(a.tessera || '—')}</span></li>`).join('');
}

async function atSalva(e) {
    e.preventDefault();
    if (!atSoc) { msg('Scegli prima la società'); return; }
    const f = e.target;
    const cognome = f.cognome.value.trim(), nome = f.nome.value.trim();
    if (!cognome || !nome) { msg('Cognome e nome sono obbligatori.'); return; }

    // Doppio tocco = doppio atleta: si blocca il duplicato nella societa'
    if (atElenco.some(a => a.cognome.toLowerCase() === cognome.toLowerCase() && a.nome.toLowerCase() === nome.toLowerCase())) {
        msg(`${cognome} ${nome} è già tesserato per questa società.`);
        return;
    }

    const atleta = { nome, cognome, codice_fiscale: null, sesso: +(f.sesso.value || 0), attivo: true, uid: nuovoUid() };
    const affiliazione = {
        atleta_uid: atleta.uid, societa_uid: atSoc, stagione: await stagioneCorrente(),
        tessera: f.tessera.value.trim() || null, ruoli: 1, carica: null, categoria_fitet: null, punti_fitet: null
    };
    // Stessa transazione: o entrano entrambe o nessuna
    await scriviLocale([{ t: 'atleti', riga: atleta }, { t: 'atleti_societa', riga: affiliazione }]);

    f.reset(); f.hidden = true; msg('');
    await atCarica();
}
