// TennisTavoloManager - comune.js
// Parte UGUALE delle due PWA: questo file sta IDENTICO in pwa-cloud/
// (telefono via cloud) e in TennisTavoloManager/wwwroot/ (telefono in rete
// locale). Si modifica in pwa-cloud/ e si copia nell'altra cartella: il test
// Tools/TestPwaCloud/test-comune.js controlla che i due file siano uguali.
//
// Qui sta tutto cio' che l'utente vede allo stesso modo nei due casi:
// il menu (Home e barra in basso), i nomi delle sezioni, gli avvisi, gli
// elenchi raggruppati, i nomi dei ruoli della formazione, la classifica. Cio' che cambia
// (da dove arrivano i dati) sta negli altri file: nel cloud si legge il
// database del telefono, in rete locale si chiede al PC.
// Va caricato PRIMA di tutti gli altri script dell'app.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- nomi delle squadre ----------------
// Nome di squadra dove lo spazio e' poco (testata della scheda incontro e
// dei Punti: "Casa  2 – 1  Ospite"). Le squadre della stessa societa' si
// distinguono dall'ULTIMA parola ("Olimpia A", "Olimpia B"): se il nome non
// ci sta si accorcia la parte prima e l'ultima parola resta intera
// ("Unione Sportiva Oli… A"), invece dei puntini in fondo che la
// taglierebbero. Il taglio lo fa il CSS (.nmInizio / .nmFine in stile.css).
// Un nome di una parola sola si accorcia in fondo, come prima.
function htmlNomeSquadra(nome) {
    const n = String(nome ?? '').trim();
    const taglio = n.lastIndexOf(' ');
    return taglio < 0
        ? `<b class="nmSq"><span class="nmInizio">${esc(n)}</span></b>`
        : `<b class="nmSq"><span class="nmInizio">${esc(n.slice(0, taglio))}</span><span class="nmFine"> ${esc(n.slice(taglio + 1))}</span></b>`;
}

// ---------------- avvisi ----------------

// Avviso a comparsa sopra la barra in basso: si vede sempre, anche quando
// #msg e' fuori schermo (in fondo a una lista lunga) o la vista si ridisegna.
let _avvisoTimer = null;
function avviso(t, ok = false) {
    const el = $('#avviso');
    if (!el) return;
    el.textContent = t;
    el.className = ok ? 'ok' : '';
    el.hidden = false;
    clearTimeout(_avvisoTimer);
    _avvisoTimer = setTimeout(() => { el.hidden = true; }, ok ? 2500 : 5000);
}

// Messaggio della vista (#msg). Le conferme (ok) compaiono SEMPRE anche come
// avviso; gli errori solo se #msg non e' sullo schermo. Prima il "Salvata"
// della rosa finiva in fondo alla lista e non si vedeva (02/10).
function msg(t, ok = false) {
    const m = $('#msg');
    if (m) { m.style.color = ok ? 'var(--verde)' : ''; m.textContent = t; }
    if (!t) return;
    const r = m?.getBoundingClientRect();
    const visibile = !!r && r.top >= 0 && r.bottom <= window.innerHeight - 72;   // 72 = barra in basso
    if (ok || !visibile) avviso(t, ok);
}

// ---------------- menu: le sezioni dell'app ----------------
// UN solo elenco per la Home e per la barra in basso: stessi nomi, stesso
// ordine, in rete locale e via cloud. Per aggiungere o rinominare una
// sezione si tocca solo qui (e la vista corrispondente in `viste`).
const SEZIONI = [
    { v: 'incontri', nome: 'Incontri', icona: '🗓️', cosa: 'Calendario, formazione, risultati' },
    { v: 'rosa',     nome: 'Rosa',     icona: '👥', cosa: 'Chi può giocare in ogni squadra' },
    { v: 'punti',    nome: 'Punti',    icona: '🏓', cosa: 'Segna il punteggio di una gara' },
    { v: 'classifica', nome: 'Classifica', icona: '🏆', cosa: 'Punti e posizioni nei gironi' },
    { v: 'atleti',   nome: 'Atleti',   icona: '🪪', cosa: 'Cerca un tesserato, aggiungine uno' },
    { v: 'account',  nome: 'Account',  icona: '⚙️', cosa: 'Collegamento, ambiente, versione' }
];

// Le viste si registrano qui: { html, init, esci (facoltativo), suDati (facoltativo) }
const viste = {};
let vistaCorrente = null;

function mostra(nome) {
    viste[vistaCorrente]?.esci?.();      // la vista che si lascia chiude le sue cose (Punti)
    vistaCorrente = nome;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('att', b.dataset.v === nome));
    window.scrollTo(0, 0);
    // Vista assente = il suo .js non e' arrivato (file non copiato, cache
    // vecchia): lo si dice invece di non fare niente.
    if (!viste[nome]) {
        $('#vista').innerHTML = `<p class="vuoto">Sezione "${esc(nome)}" non caricata: manca il file ${esc(nome)}.js.</p>`;
        return;
    }
    $('#vista').innerHTML = viste[nome].html;
    viste[nome].init?.();
}

// Barra in basso: Home + le sezioni. Da chiamare una volta all'avvio.
function disegnaNav() {
    const voce = s => `<button data-v="${s.v}"><span>${s.icona}</span>${esc(s.nome)}</button>`;
    $('#nav').innerHTML = voce({ v: 'home', nome: 'Home', icona: '🏠' }) + SEZIONI.map(voce).join('');
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => mostra(b.dataset.v));
}

// Home: un pulsante grande per sezione. Sotto, una riga di informazioni che
// ogni app riempie a modo suo (infoHome, se esiste: ambiente e versione).
viste.home = {
    html: '<div id="hmCorpo"></div>',
    init: () => {
        $('#hmCorpo').innerHTML = `<div class="hmGriglia">${SEZIONI.map(s => `
            <button class="hmVoce" data-v="${s.v}"><span class="hmIcona">${s.icona}</span>
              <b>${esc(s.nome)}</b><small>${esc(s.cosa)}</small></button>`).join('')}</div>
          <div class="hmInfo" id="hmInfo"></div>`;
        document.querySelectorAll('.hmVoce').forEach(b => b.onclick = () => mostra(b.dataset.v));
        if (typeof infoHome === 'function') infoHome($('#hmInfo'));
    }
};

// ---------------- formazione: ruoli e nomi ----------------
// Chi sta a referto oltre ai giocatori (RuoloFormazione sul PC). Stesso
// elenco e stesso ordine nella Formazione di tutte e due le PWA.
const RUOLI_TITOLARI = ['A', 'B', 'C'];
const RUOLI_RISERVE = ['Riserva1', 'Riserva2', 'Riserva3'];
const RUOLI_STAFF = ['Capitano', 'Allenatore', 'Dirigente', 'Medico'];
const STAFF_ALTRO = '*';      // voce "scrivi il nome" nella tendina dello staff

// Ordine in cui si elencano le persone di una formazione (scheda incontro)
const ORDINE_RUOLI = [...RUOLI_TITOLARI, ...RUOLI_RISERVE, ...RUOLI_STAFF];

// Etichetta corta di un ruolo: A/B/C per chi ha scelto le lettere, X/Y/Z per
// l'altra squadra; "Ris. 1"; lo staff col suo nome.
function etichettaRuolo(r, abc) {
    if (r.length === 1) return abc ? r : { A: 'X', B: 'Y', C: 'Z' }[r];
    return { Riserva1: 'Ris. 1', Riserva2: 'Ris. 2', Riserva3: 'Ris. 3' }[r] || r;
}

// ---------------- elenchi raggruppati ----------------
// Tre livelli: federazione (FITET, CSI) > campionato > girone. Ogni gruppo
// si apre e si chiude con un tocco; quelli aperti si ricordano per vista.
// Con un solo gruppo non c'e' nulla da scegliere: resta aperto.
// voci: [{ tipo, campionato, girone, ... }] gia' nell'ordine voluto dentro
// il gruppo; htmlVoce(voce) -> '<li>...</li>'. testa (facoltativa) = html
// messo in cima a ogni gruppo, es. la riga con i nomi delle colonne.
const ORDINE_FEDERAZIONI = { FITET: 0, CSI: 1 };

function gruppiAperti(vista) {
    try { return JSON.parse(localStorage.getItem('ttm.gruppi.' + vista) || '[]'); } catch { return []; }
}

// apertoDiBase (facoltativa): g => true per i gruppi da mostrare aperti la
// PRIMA volta, quando l'utente non ha ancora aperto o chiuso niente in
// quella vista (Classifica: i gironi delle nostre squadre).
function htmlGruppi(vista, voci, htmlVoce, testa = '', apertoDiBase = null) {
    const gruppi = new Map();
    for (const v of voci) {
        const k = [v.tipo || '', v.campionato || '', v.girone || ''].join('|');
        if (!gruppi.has(k)) gruppi.set(k, { k, tipo: v.tipo || '', campionato: v.campionato || '', girone: v.girone || '', voci: [] });
        gruppi.get(k).voci.push(v);
    }
    const ordinati = [...gruppi.values()].sort((a, b) =>
        (ORDINE_FEDERAZIONI[a.tipo] ?? 9) - (ORDINE_FEDERAZIONI[b.tipo] ?? 9)
        || a.tipo.localeCompare(b.tipo, 'it')
        || a.campionato.localeCompare(b.campionato, 'it')
        || a.girone.localeCompare(b.girone, 'it'));
    const aperti = gruppiAperti(vista);
    let mai = false;
    try { mai = localStorage.getItem('ttm.gruppi.' + vista) === null; } catch { }
    let h = '', fed = null;
    for (const g of ordinati) {
        if (g.tipo !== fed) { fed = g.tipo; h += `<h3 class="grFed">${esc(fed || 'Altro')}</h3>`; }
        const aperto = ordinati.length === 1 || aperti.includes(g.k) || (mai && !!apertoDiBase?.(g));
        h += `<details class="gr" data-k="${esc(g.k)}"${aperto ? ' open' : ''}>
          <summary><b>${esc(g.campionato || 'Senza campionato')}</b>${g.girone ? ' · girone ' + esc(g.girone) : ''}<span>${g.voci.length}</span></summary>
          <ul>${testa}${g.voci.map(htmlVoce).join('')}</ul></details>`;
    }
    return h;
}

// "Prossimi": gli incontri delle NOSTRE squadre nel prossimo giorno di gara
// (oggi compreso), tutti insieme in un gruppo richiudibile come quelli dei
// gironi. voci = incontri non terminati con { nostro, quando } dove quando
// e' la data-ora (ISO locale) o null. Ritorna { giorno: 'sab 10/10', voci }
// in ordine di ora, oppure null se non c'e' nessuna gara in arrivo.
function prossimoGiorno(voci) {
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const futuri = voci.filter(v => v.nostro && v.quando && new Date(v.quando) >= oggi)
        .sort((a, b) => new Date(a.quando) - new Date(b.quando));
    if (!futuri.length) return null;
    const giorno = new Date(futuri[0].quando).toDateString();
    return {
        giorno: new Date(futuri[0].quando).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' }),
        voci: futuri.filter(v => new Date(v.quando).toDateString() === giorno)
    };
}

// Aperto finche' l'utente non lo chiude (al contrario dei gironi).
function htmlProssimi(p, htmlVoce) {
    if (!p) return '';
    let chiuso = false;
    try { chiuso = localStorage.getItem('ttm.prossimiChiusi') === '1'; } catch { }
    return `<details class="gr prossimi" data-k="*prossimi"${chiuso ? '' : ' open'}>
      <summary><b>Prossimi</b> · ${esc(p.giorno)}<span>${p.voci.length}</span></summary>
      <ul>${p.voci.map(htmlVoce).join('')}</ul></details>`;
}

// Da chiamare dopo aver messo l'html nella pagina: ricorda i gruppi aperti.
function agganciaGruppi(vista, contenitore) {
    contenitore.querySelectorAll('details.gr').forEach(d => d.addEventListener('toggle', () => {
        if (d.dataset.k === '*prossimi') {
            try { localStorage.setItem('ttm.prossimiChiusi', d.open ? '0' : '1'); } catch { }
            return;
        }
        // Si parte da quelli ricordati e si aggiorna con TUTTI i gruppi sullo
        // schermo (non solo quello toccato): cosi' restano aperti anche quelli
        // aperti "di base" e mai toccati.
        const aperti = new Set(gruppiAperti(vista));
        contenitore.querySelectorAll('details.gr').forEach(x => {
            if (x.dataset.k === '*prossimi') return;
            if (x.open) aperti.add(x.dataset.k); else aperti.delete(x.dataset.k);
        });
        try { localStorage.setItem('ttm.gruppi.' + vista, JSON.stringify([...aperti])); } catch { }
    }));
}

// ---------------- classifica ----------------
// Stesso disegno nelle due PWA; cambia solo da dove arrivano i numeri
// (classifica.js: nel cloud li calcola il telefono, in rete locale il PC).
// gruppi = [{ tipo, campionato, girone, righe: [{ posizione, squadra, nostra,
//   punti, giocati, vinti, pari, persi, partiteVinte, partitePerse, sorteggio }] }]
// Una riga per squadra: # · squadra · Pt · G V N P · partite vinte-perse.
// La nostra squadra ha la fascia a sinistra e il nome in grassetto (non
// solo il colore). "(sorteggio)" = parita' che nessun criterio risolve.
function clHtml(gruppi) {
    if (!gruppi.length) return '<p class="vuoto">Nessuna squadra in questa stagione</p>';
    const voci = gruppi.flatMap(g => g.righe.map(r => ({ ...r, tipo: g.tipo, campionato: g.campionato, girone: g.girone })));
    const nostri = new Set(gruppi.filter(g => g.righe.some(r => r.nostra))
        .map(g => [g.tipo || '', g.campionato || '', g.girone || ''].join('|')));
    const testa = `<li class="clRiga clTesta"><span>#</span><span>Squadra</span><span>Pt</span>
        <span>G</span><span>V</span><span>N</span><span>P</span><span>Partite</span></li>`;
    const riga = r => `<li class="clRiga${r.nostra ? ' nostra' : ''}">
        <span>${r.posizione}</span>
        <span class="clSq">${htmlNomeSquadra(r.squadra)}${r.sorteggio ? '<small>sorteggio</small>' : ''}</span>
        <b>${r.punti}</b><span>${r.giocati}</span><span>${r.vinti}</span><span>${r.pari}</span><span>${r.persi}</span>
        <span>${r.partiteVinte}-${r.partitePerse}</span></li>`;
    return `<div class="lvInfo">Pt punti · G giocati · V vinti · N pari · P persi · Partite vinte-perse</div>
      ${htmlGruppi('classifica', voci, riga, testa, g => nostri.has(g.k))}
      ${voci.some(r => r.sorteggio) ? '<div class="lvInfo">"sorteggio" = squadre a pari merito su tutti i criteri del regolamento: decide il sorteggio.</div>' : ''}`;
}

// ---------------- punti: sorteggio del doppio ----------------
// Nel primo set una coppia batte e l'altra riceve; in ognuna si sceglie chi
// dei due comincia. Quale coppia batte dipende da "Batte per primo", scelto
// poco sopra nello stesso modulo: le due domande cambiano con quella scelta
// (come nel Sorteggio del PC), cosi' non si deve ragionare su chi "apre".
//   batte la casa   -> "Batte la coppia di casa"  / "Riceve la coppia ospite"
//   batte l'ospite  -> "Riceve la coppia di casa" / "Batte la coppia ospite"
const lvEticDoppio = casaBatte => ({
    casa: casaBatte ? 'Batte la coppia di casa: chi batte per primo?' : 'Riceve la coppia di casa: chi riceve per primo?',
    ospite: casaBatte ? 'Riceve la coppia ospite: chi riceve per primo?' : 'Batte la coppia ospite: chi batte per primo?'
});

// Le due domande del doppio in fondo al sorteggio. r = la funzione che
// disegna un pallino di scelta (nome, valore, testo, scelto); c1, c2 e o1,
// o2 = i nomi dei due di casa e dei due ospiti.
function lvHtmlApreDoppio(r, c1, c2, o1, o2) {
    const e = lvEticDoppio(true);          // "Batte per primo" parte dalla casa
    return `<div class="lvDom" id="lvDomApC">${e.casa}</div>${r('apC', '1', c1, true)}${r('apC', '0', c2)}
      <div class="lvDom" id="lvDomApO">${e.ospite}</div>${r('apO', '1', o1, true)}${r('apO', '0', o2)}`;
}

// Da chiamare dopo aver messo il sorteggio nella pagina: a ogni cambio di
// "Batte per primo" riscrive le due domande.
function lvAgganciaApreDoppio() {
    const a = $('#lvDomApC'), b = $('#lvDomApO');
    if (!a || !b) return;
    const aggiorna = () => {
        const e = lvEticDoppio(document.querySelector('input[name="serv"]:checked')?.value !== '0');
        a.textContent = e.casa;
        b.textContent = e.ospite;
    };
    document.querySelectorAll('input[name="serv"]').forEach(x => x.addEventListener('change', aggiorna));
    aggiorna();
}

// ---------------- punti: asciugamano e time-out ----------------
// Uguali nelle due PWA (e nel Live del PC: SetService.Asciugamano,
// SetService.SecondiTimeout).

// Pausa per l'asciugamano: ogni 6 punti dall'inizio del set (6, 12, 18...)
const asciugamano = (pc, po) => (pc + po) > 0 && (pc + po) % 6 === 0;

// Colonna stretta al centro fra i due pulsanti punto: si colora (e mostra
// la scritta) quando i giocatori possono asciugarsi. C'e' sempre, anche
// spenta, cosi' i pulsanti non cambiano larghezza.
const htmlAsciugamano = (pc, po) => asciugamano(pc, po)
    ? '<div class="lvAsciuga on"><span>ASCIUGAMANO</span></div>'
    : '<div class="lvAsciuga"></div>';

// Time-out: un minuto AL MASSIMO, uno solo per giocatore (o coppia) in ogni
// partita. Chi l'ha chiamato puo' riprendere prima: il conto si ferma, il
// time-out resta usato.
const SECONDI_TIMEOUT = 60;

// Riga sotto il tabellone: un pulsante per lato, sotto la colonna del suo
// giocatore. sinistra / destra = { casa, usato } nell'ordine dello schermo.
// Disponibile e' giallo, usato diventa spento e cambia scritta (non conta
// solo il colore): vedi button.lvTo in stile.css.
function htmlPulsantiTimeout(sinistra, destra) {
    const b = l => l.usato
        ? '<button class="pieno chiaro lvTo" disabled>Time-out usato ✔</button>'
        : `<button class="pieno chiaro lvTo" data-to="${l.casa ? 1 : 0}">⏱ Time-out</button>`;
    return `<div class="lvCampo lvToRiga">${b(sinistra)}<div class="lvToCentro"></div>${b(destra)}</div>`;
}

// Fascia del time-out in corso, sopra il tabellone. I secondi li scrive
// avviaContoTimeout: qui non ci sono, cosi' la pagina non si ridisegna a
// ogni secondo.
// "Riprende il gioco" = si ricomincia prima del minuto: conto fermato,
// time-out usato. "Chiamato per errore" = torna disponibile.
function htmlTimeoutInCorso(nome, casa) {
    return `<div class="lvTimeout"><b>⏱ TIME-OUT</b>${esc(nome)}
        <span id="lvTimeoutSec"></span>
        <button class="pieno" id="lvToFine" data-to="${casa ? 1 : 0}">▶ Riprende il gioco</button>
        <button class="pieno chiaro" id="lvToAnnulla" data-to="${casa ? 1 : 0}">Chiamato per errore: annulla</button></div>`;
}

// Conto alla rovescia nella fascia. fine = istante (millisecondi,
// orologio di questo telefono) in cui il minuto scade; alTermine viene
// chiamata una volta, allo scadere.
let _toTimer = null;
function fermaContoTimeout() { clearInterval(_toTimer); _toTimer = null; }
function avviaContoTimeout(fine, alTermine) {
    const tic = () => {
        const el = $('#lvTimeoutSec');
        if (!el) { fermaContoTimeout(); return; }           // fascia non piu' sullo schermo
        const restano = Math.ceil((fine - Date.now()) / 1000);
        if (restano <= 0) { fermaContoTimeout(); el.textContent = '0:00'; alTermine?.(); return; }
        el.textContent = `${Math.floor(restano / 60)}:${String(restano % 60).padStart(2, '0')}`;
    };
    fermaContoTimeout();
    _toTimer = setInterval(tic, 250);
    tic();
}

// ---------------- dati del referto ----------------
// Cio' che il referto chiede oltre a formazione e punteggi: impianto,
// giudice arbitro, defibrillatore, orari, provvedimenti (sul PC: dialog
// "Dati referto"). Stesso modulo e stesso riepilogo nelle due PWA
// (referto.js li riempie: dal database del telefono o chiedendo al PC).
// d = { luogo, tavolo, palline, giudiceArbitro, qualificaArbitro,
//       defibrillatore (true / false / null = non indicato), operatoreDae,
//       oraInizio, oraFine ('HH:mm' oppure ''), provvedimenti }
// Il campo di gara (luogo) e' del calendario: qui si legge soltanto.

// Tavolo, palline, defibrillatore e operatore di solito non cambiano da una
// gara in casa all'altra: nei campi VUOTI si propongono quelli della scheda
// della squadra di casa (tavolo, palline) e dell'ultima gara in casa (prec,
// stessa forma di d: chi chiama ci ha gia' messo l'una e l'altra). Ritorna
// true se ha proposto qualcosa: si salva comunque solo con "Salva".
function rfProponi(d, prec) {
    if (!prec) return false;
    let proposto = false;
    for (const c of ['tavolo', 'palline', 'operatoreDae'])
        if (!d[c] && prec[c]) { d[c] = prec[c]; proposto = true; }
    if (d.defibrillatore == null && prec.defibrillatore != null) { d.defibrillatore = prec.defibrillatore; proposto = true; }
    return proposto;
}

function rfHtmlModulo(d, proposto) {
    const campo = (id, etic, val, max) =>
        `<label class="rfCampo"><span>${etic}</span><input id="${id}" maxlength="${max}" value="${esc(val || '')}"></label>`;
    const ora = (id, etic, val) =>
        `<label class="rfCampo"><span>${etic}</span><input type="time" id="${id}" value="${esc(val || '')}"></label>`;
    const dae = d.defibrillatore === true ? '1' : d.defibrillatore === false ? '0' : '';
    return `
      ${proposto ? '<div class="avviso">Tavolo, palline e defibrillatore vuoti sono stati proposti dalla scheda della squadra di casa o dalla sua ultima gara in casa: controllali prima di salvare.</div>' : ''}
      <h4>Impianto</h4>
      <div class="rfFisso"><span>Campo di gara</span><b>${esc(d.luogo || 'non indicato')}</b><small>Si cambia dal PC, nel calendario</small></div>
      ${campo('rfTavolo', 'Tavolo (marca e modello)', d.tavolo, 100)}
      ${campo('rfPalline', 'Palline (marca e modello)', d.palline, 100)}
      <h4>Giudice arbitro</h4>
      ${campo('rfArbitro', 'Nome e cognome', d.giudiceArbitro, 100)}
      ${campo('rfQualifica', 'In qualità di', d.qualificaArbitro, 60)}
      <h4>Defibrillatore</h4>
      <label class="rfCampo"><span>Presente nell'impianto (o ambulanza / auto medica all'esterno)</span>
        <select id="rfDae">${[['', 'Non indicato'], ['1', 'SÌ, presente'], ['0', 'NO, non presente']]
            .map(([v, t]) => `<option value="${v}"${v === dae ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      ${campo('rfOperatore', 'Operatore debitamente formato', d.operatoreDae, 100)}
      <h4>Orari</h4>
      <div class="riga">${ora('rfOraInizio', 'Inizio incontro', d.oraInizio)}${ora('rfOraFine', 'Fine incontro', d.oraFine)}</div>
      <div class="lvInfo">Segnando i punti dal telefono o dal PC, inizio e fine si compilano da soli.</div>
      <h4>Provvedimenti disciplinari</h4>
      <textarea id="rfProvvedimenti" maxlength="500" rows="4">${esc(d.provvedimenti || '')}</textarea>`;
}

// I valori scritti nel modulo, nella forma di d (luogo escluso)
function rfLeggiModulo() {
    const t = id => $('#' + id).value.trim();
    const dae = $('#rfDae').value;
    return {
        tavolo: t('rfTavolo'), palline: t('rfPalline'),
        giudiceArbitro: t('rfArbitro'), qualificaArbitro: t('rfQualifica'),
        defibrillatore: dae === '' ? null : dae === '1',
        operatoreDae: t('rfOperatore'),
        oraInizio: $('#rfOraInizio').value || '', oraFine: $('#rfOraFine').value || '',
        provvedimenti: t('rfProvvedimenti')
    };
}

// Riepilogo nella scheda dell'incontro: solo le righe compilate.
function rfHtmlRiepilogo(d) {
    const righe = [
        ['Tavolo', d.tavolo], ['Palline', d.palline],
        ['Giudice arbitro', [d.giudiceArbitro, d.qualificaArbitro].filter(Boolean).join(' · ')],
        ['Defibrillatore', d.defibrillatore == null ? '' : d.defibrillatore ? 'presente' : 'NON presente'],
        ['Operatore', d.operatoreDae],
        ['Orari', [d.oraInizio && 'inizio ' + d.oraInizio, d.oraFine && 'fine ' + d.oraFine].filter(Boolean).join(' · ')],
        ['Provvedimenti', d.provvedimenti]
    ].filter(r => r[1]);
    return righe.length
        ? '<ul>' + righe.map(([e, v]) => `<li class="rpForm"><b>${e}</b> ${esc(v)}</li>`).join('') + '</ul>'
        : '<p class="vuoto">Non ancora compilati</p>';
}

// Solo i campi che l'utente ha cambiato rispetto a quelli letti all'apertura
// (prima). Si salvano solo questi: se nel frattempo i Punti hanno scritto
// l'ora di inizio, un modulo aperto da prima non la cancella.
function rfCambiati(prima, d) {
    const r = {};
    for (const c of Object.keys(d))
        if ((d[c] ?? '') !== (prima[c] ?? '')) r[c] = d[c];
    return r;
}

// La pagina "Dati del referto", dentro #inCorpo. r = { casa, ospite, d,
// proposto }; toccata() a ogni modifica; indietro() e salva() sui pulsanti.
function rfDisegnaPagina(r, toccata, indietro, salva) {
    const c = $('#inCorpo');
    if (!c) return;
    c.innerHTML = `
      <button class="pieno chiaro" id="rfIndietro">← Incontro</button>
      <div class="lvSceltaTit">Dati del referto</div>
      <div class="lvInfo">${esc(r.casa)} – ${esc(r.ospite)}</div>
      ${rfHtmlModulo(r.d, r.proposto)}
      <div id="msg"></div>
      <button class="pieno" id="rfSalva">Salva i dati del referto</button>`;
    c.querySelectorAll('input, select, textarea').forEach(e => e.oninput = toccata);
    $('#rfIndietro').onclick = indietro;
    $('#rfSalva').onclick = salva;
    window.scrollTo(0, 0);
}

// ---------------- referto in PDF ----------------
// Frasi uguali nelle due PWA, sotto il pulsante "Referto PDF" della scheda
// dell'incontro. In rete locale il PDF lo crea il PC, via cloud il telefono
// (pdf.js): stesso modulo ufficiale, stessi dati.
const PDF_COSA = 'Il modulo ufficiale compilato con i dati di adesso: prima della gara intestazione e formazioni, dopo anche set e risultato.';
const PDF_SENZA_MODELLO = 'Referto PDF: per la formula di questo campionato non c\'è ancora il modulo ufficiale.';

// ---------------- formazione: tendine ----------------
// Usate dalla Formazione di tutte e due le PWA. Un atleta = { id, nome }
// (id = uid nel cloud, numero in rete locale: si confronta come testo).

function fzOpzioni(lista, sel) {
    return '<option value="">(nessuno)</option>' + lista.map(a =>
        `<option value="${esc(a.id)}"${String(a.id) === String(sel ?? '') ? ' selected' : ''}>${esc(a.nome)}</option>`).join('');
}

// Persona dello staff: { id (tesserato) oppure nome (scritto a mano), libero }
const fzStaffLibero = st => !st.id && (!!st.libero || !!st.nome);

// Tendina dello staff: (nessuno), rosa, altri tesserati, nome scritto a mano
function fzOpzioniStaff(rosa, altri, st) {
    const voce = a => `<option value="${esc(a.id)}"${String(a.id) === String(st.id ?? '') ? ' selected' : ''}>${esc(a.nome)}</option>`;
    return '<option value="">(nessuno)</option>' +
        (rosa.length ? `<optgroup label="Rosa">${rosa.map(voce).join('')}</optgroup>` : '') +
        (altri.length ? `<optgroup label="Altri tesserati">${altri.map(voce).join('')}</optgroup>` : '') +
        `<option value="${STAFF_ALTRO}"${fzStaffLibero(st) ? ' selected' : ''}>✍ scrivi il nome…</option>`;
}

// Le righe dello staff nella pagina della Formazione (uguali nelle due PWA).
// staff = { Capitano: {id, nome, libero}, ... }
function fzHtmlStaff(rosa, altri, staff) {
    return '<h4>Staff a referto</h4>' + RUOLI_STAFF.map(r => `
      <label class="fzRiga"><span>${r}</span><select data-staff="${r}">${fzOpzioniStaff(rosa, altri, staff[r])}</select></label>
      <label class="fzRiga" data-staff-riga="${r}"${fzStaffLibero(staff[r]) ? '' : ' hidden'}><span></span>
        <input data-staff-nome="${r}" maxlength="80" placeholder="nome e cognome" value="${esc(staff[r].nome || '')}"></label>`).join('');
}

// Aggancia tendine e caselle dello staff: ogni modifica va subito nel
// modello `staff`. numerico = gli id sono numeri (rete locale).
function fzAgganciaStaff(contenitore, staff, toccata, numerico = false) {
    contenitore.querySelectorAll('select[data-staff]').forEach(s => s.onchange = () => {
        const st = staff[s.dataset.staff], libero = s.value === STAFF_ALTRO;
        st.id = libero || !s.value ? null : (numerico ? +s.value : s.value);
        st.libero = libero;
        if (!libero) st.nome = '';
        const riga = contenitore.querySelector(`[data-staff-riga="${s.dataset.staff}"]`);
        riga.hidden = !libero;
        if (libero) riga.querySelector('input').focus(); else riga.querySelector('input').value = '';
        toccata();
    });
    contenitore.querySelectorAll('input[data-staff-nome]').forEach(i => i.oninput = () => {
        staff[i.dataset.staffNome].nome = i.value; toccata();
    });
}
