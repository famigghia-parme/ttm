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

// ---------------- finestre di domanda e di messaggio ----------------
// Al posto di confirm() e alert() del browser, che in testa scrivono
// l'indirizzo del sito ("famigghia-parme.github.io dice"): una finestra
// dell'app, con un titolo che dice che cosa e' (07/10).
//   conferma(testo, titolo)  -> domanda con "Sì" e "No"; ritorna true/false
//   messaggio(testo, titolo) -> cosa da leggere, con "OK"
// Titolo: "Conferma" per le domande normali, "Attenzione" (col triangolo:
// non solo il colore) dove con il Sì si perde qualcosa, "Avviso" per i
// messaggi. Il testo puo' andare a capo con \n; non e' HTML.
// A differenza di quelle del browser NON fermano il programma: vanno
// aspettate con `await` (chi le chiama e' una funzione async) e mentre sono
// aperte il resto dell'app continua (sincronizzazione, orologi). Per questo
// nei Punti dopo il Sì si rilegge la situazione (live.js: lvAzione).
// Una alla volta: una seconda richiesta aspetta che si chiuda la prima.
// Si chiude solo con i pulsanti (o Esc = "No"/"OK"): toccare fuori non fa
// nulla, a una domanda si risponde.
let _dlgCoda = Promise.resolve();
function _dlgApri(testo, titolo, pulsanti) {
    const apri = () => new Promise(fatto => {
        const prima = document.activeElement;
        const velo = document.createElement('div');
        velo.className = 'dlgVelo';
        velo.innerHTML =
            `<div class="dlg${titolo === 'Attenzione' ? ' dlgAttenzione' : ''}" role="alertdialog" aria-modal="true"
                  aria-labelledby="dlgTitolo" aria-describedby="dlgTesto" tabindex="-1">
               <h3 id="dlgTitolo">${titolo === 'Attenzione' ? '⚠ ' : ''}${esc(titolo)}</h3>
               <div id="dlgTesto" class="dlgTesto">${esc(testo)}</div>
               <div class="dlgPulsanti">${pulsanti.map((b, i) =>
                   `<button type="button" class="pieno${b.chiaro ? ' chiaro' : ''}" data-dlg="${i}">${esc(b.testo)}</button>`).join('')}</div>
             </div>`;
        const chiudi = valore => {
            document.removeEventListener('keydown', tasto, true);
            velo.remove();
            prima?.focus?.();
            fatto(valore);
        };
        // Esc = l'ultimo pulsante ("No" nelle domande, "OK" nei messaggi)
        const tasto = e => {
            if (e.key !== 'Escape') return;
            e.preventDefault(); e.stopPropagation();
            chiudi(pulsanti[pulsanti.length - 1].valore);
        };
        velo.onclick = e => {
            const b = e.target.closest('button[data-dlg]');
            if (b) chiudi(pulsanti[+b.dataset.dlg].valore);
        };
        document.addEventListener('keydown', tasto, true);
        document.body.appendChild(velo);
        // Il fuoco va alla finestra, non a un pulsante: un Invio rimasto
        // sotto il dito non deve rispondere "Sì" al posto di chi legge.
        velo.querySelector('.dlg').focus();
    });
    const p = _dlgCoda.then(apri);
    _dlgCoda = p.catch(() => {});
    return p;
}
const conferma = (testo, titolo = 'Conferma') =>
    _dlgApri(testo, titolo, [{ testo: 'Sì', valore: true }, { testo: 'No', valore: false, chiaro: true }]);
const messaggio = (testo, titolo = 'Avviso') =>
    _dlgApri(testo, titolo, [{ testo: 'OK', valore: undefined }]);

// ---------------- menu: le sezioni dell'app ----------------
// UN solo elenco per la Home e per la barra in basso: stessi nomi, stesso
// ordine, in rete locale e via cloud. Per aggiungere o rinominare una
// sezione si tocca solo qui (e la vista corrispondente in `viste`).
const SEZIONI = [
    { v: 'incontri', nome: 'Incontri', icona: '🗓️', cosa: 'Calendario, formazione, risultati' },
    { v: 'rosa',     nome: 'Rosa',     icona: '👥', cosa: 'Chi può giocare in ogni squadra' },
    { v: 'punti',    nome: 'Punti',    icona: '🏓', cosa: 'Segna il punteggio di una gara' },
    { v: 'classifica', nome: 'Classifica', icona: '🏆', cosa: 'Punti e posizioni nei gironi' },
    { v: 'tornei',   nome: 'Tornei',   icona: '🏅', cosa: 'Calendario dei tornei' },
    { v: 'atleti',   nome: 'Atleti',   icona: '🪪', cosa: 'Cerca un tesserato, aggiungine uno' },
    // 10/10 (1.1.0): la tabella "chi sale e chi scende" dei nostri atleti
    // FITET. Solo nella Home (fuoriBarra): nella barra in basso non c'e' posto.
    { v: 'ranking',  nome: 'Classifica atleti', icona: '📈', cosa: 'Chi sale e chi scende (FITET)', fuoriBarra: true },
    // fuoriBarra (07/10): con i Tornei le voci sono 7 e nella barra in basso,
    // insieme a Home, non ci stanno piu' (a 360 px "Classifica" veniva
    // tagliata). Account, la meno usata, resta nella Home e si apre anche
    // toccando lo stato del collegamento in alto a destra.
    { v: 'account',  nome: 'Account',  icona: '⚙️', cosa: 'Collegamento, ambiente, versione', fuoriBarra: true }
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

// Barra in basso: Home + le sezioni (tranne quelle fuoriBarra). Da chiamare
// una volta all'avvio.
function disegnaNav() {
    const voce = s => `<button data-v="${s.v}"><span>${s.icona}</span>${esc(s.nome)}</button>`;
    $('#nav').innerHTML = voce({ v: 'home', nome: 'Home', icona: '🏠' }) + SEZIONI.filter(s => !s.fuoriBarra).map(voce).join('');
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => mostra(b.dataset.v));
    // Lo stato del collegamento in alto a destra porta all'Account (solo a
    // menu visibile: prima dell'accesso non c'e' nessun account da mostrare)
    const stato = $('#stato');
    if (stato) {
        stato.style.cursor = 'pointer';
        stato.title = 'Apri Account';
        stato.onclick = () => { if (!$('#nav').hidden) mostra('account'); };
    }
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

// ---------------- "in quadro" FITET ----------------
// (10/10) Per la rosa e per la formazione si scelgono solo giocatori "in
// quadro" nel database della federazione. Il valore sta sul tesseramento
// (atleti_societa.in_quadro): true = in quadro; null = non si sa (CSI,
// aggiunto a mano) e si puo' scegliere; false = NON si puo' aggiungere.
// Chi e' gia' in quella rosa o in quella formazione resta dov'e', con la
// scritta "non in quadro" accanto: lo toglie l'utente. Lo staff non c'entra.
// Stessa regola sul PC: Services/InQuadroLogica.cs.
const NON_IN_QUADRO = 'non in quadro';

// nonInQuadro, giaScelti: Set di id (uid nel cloud, numeri in rete locale)
function inQuadroProponibile(id, nonInQuadro, giaScelti) {
    return !nonInQuadro.has(id) || giaScelti.has(id);
}

// "Rossi Anna" oppure "Rossi Anna (non in quadro)"
function nomeInQuadro(nome, nonInQuadro) {
    return nonInQuadro ? `${nome} (${NON_IN_QUADRO})` : nome;
}

// Gli atleti NON in quadro di una societa' in una stagione (Set di uid),
// dalle righe di atleti_societa.
function fuoriQuadro(affiliazioni, societaUid, stagione) {
    return new Set(affiliazioni
        .filter(a => a.societa_uid === societaUid && a.stagione === stagione && a.in_quadro === false)
        .map(a => a.atleta_uid));
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

// "Prossimi": per CIASCUNA delle nostre squadre il suo prossimo incontro da
// giocare (oggi compreso), tutti insieme in un gruppo richiudibile come
// quelli dei gironi. Fino alla 3.15.1 erano le gare del solo prossimo giorno
// di gara: una nostra squadra che giocava qualche giorno dopo non compariva.
// voci = incontri non terminati con { nostro, quando, nostre } dove quando
// e' la data-ora (ISO locale) o null, e nostre e' l'elenco delle nostre
// squadre che giocano quell'incontro (uid o numero: di solito una, due se
// si incontrano fra loro; quella gara vale per tutte e due ma compare una
// volta sola). Ritorna { giorno, voci } in ordine di data, oppure null se
// non c'e' nessuna gara in arrivo. giorno = 'sab 10/10', oppure
// 'sab 10/10 – dom 18/10' se le gare cadono in giorni diversi.
function prossimiNostri(voci) {
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const futuri = voci.filter(v => v.nostro && v.quando && new Date(v.quando) >= oggi)
        .sort((a, b) => new Date(a.quando) - new Date(b.quando));
    const fatte = new Set(), scelti = [];        // squadre che hanno gia' la loro gara
    for (const v of futuri) {
        const nuove = (v.nostre || []).filter(k => !fatte.has(String(k)));
        if (!nuove.length) continue;
        nuove.forEach(k => fatte.add(String(k)));
        scelti.push(v);
    }
    if (!scelti.length) return null;
    const giorno = v => new Date(v.quando).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const primo = giorno(scelti[0]), ultimo = giorno(scelti[scelti.length - 1]);
    return { giorno: primo === ultimo ? primo : `${primo} – ${ultimo}`, voci: scelti };
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

// ---------------- tornei ----------------
// Calendario dei tornei individuali, stesso disegno nelle due PWA; cambia
// solo da dove arriva l'elenco (via cloud i dati scaricati sul telefono, in
// rete locale api/tornei del PC). Un torneo:
//   { id, federazione, regione, tipo, nome, localita,
//     inizio: 'AAAA-MM-GG', fine: 'AAAA-MM-GG' o null,
//     gare: ['...'], url, programma }
// Elenco da oggi in poi (un torneo di piu' giorni resta finche' non
// finisce), raggruppato per mese; un tocco sul torneo apre le gare e i
// collegamenti al sito della federazione. Accanto alla localita' i km in
// linea d'aria dal nostro campo di gara (t.km: li calcola il PC), con il
// filtro "entro ... km".

const trGiorno = iso => new Date(iso + 'T00:00:00');        // mezzanotte LOCALE (new Date('AAAA-MM-GG') sarebbe UTC)
const trOggi = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const trUltimo = t => trGiorno(t.fine && t.fine > t.inizio ? t.fine : t.inizio);

// 'sab 10/10', oppure 'sab 10 – dom 11/10' (stesso mese), oppure 'sab 31/10 – dom 01/11'
function trQuando(t) {
    const g = (d, conMese) => d.toLocaleDateString('it-IT', conMese
        ? { weekday: 'short', day: '2-digit', month: '2-digit' } : { weekday: 'short', day: '2-digit' });
    const a = trGiorno(t.inizio), b = trUltimo(t);
    if (b <= a) return g(a, true);
    return `${g(a, a.getMonth() !== b.getMonth())} – ${g(b, true)}`;
}

// Solo indirizzi web: arrivano da pagine scaricate, non si fidano.
const trIndirizzo = u => /^https?:\/\//i.test(u || '') ? u : '';

// Percorso in Google Maps fino alla localita' (strada e tempi veri: la
// distanza scritta accanto al torneo e' in linea d'aria). Senza partenza:
// Maps parte da dove si trova il telefono.
const trMappa = localita => String(localita || '').trim()
    ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(String(localita).trim() + ', Italia') : '';

// Filtro "entro ... km" (0 = qualsiasi distanza)
const TR_DISTANZE = [0, 50, 100, 200, 400];

// Filtro scelto. Regione e distanza si ricordano sul telefono; "Passati"
// no: chi riapre l'app giorni dopo deve trovare i tornei in arrivo.
const trStato = { regione: '', km: 0, passati: false };
try {
    trStato.regione = localStorage.getItem('ttm.tornei.regione') || '';
    trStato.km = TR_DISTANZE.includes(+localStorage.getItem('ttm.tornei.km')) ? +localStorage.getItem('ttm.tornei.km') : 0;
} catch { }

// Tornei da mostrare, in ordine di data (i passati, se chiesti, dal piu' recente)
function trVisibili(tornei, stato = trStato, oggi = trOggi()) {
    const validi = tornei.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.inizio || ''));
    const regione = validi.some(t => t.regione === stato.regione) ? stato.regione : '';   // regione sparita dall'elenco = tutte
    // Entro i km scelti; un torneo senza distanza (localita' non riconosciuta
    // dal PC) si vede sempre: non si puo' dire che sia lontano.
    const km = validi.some(t => t.km != null) ? (stato.km || 0) : 0;
    const suoi = validi.filter(t => (!regione || t.regione === regione) && (!km || t.km == null || t.km <= km));
    const perData = (a, b) => a.inizio.localeCompare(b.inizio) || String(a.nome || '').localeCompare(String(b.nome || ''), 'it');
    return {
        regione, km,
        prossimi: suoi.filter(t => trUltimo(t) >= oggi).sort(perData),
        passati: suoi.filter(t => trUltimo(t) < oggi).sort((a, b) => perData(b, a))
    };
}

function trHtmlTorneo(t, piuFederazioni, oggi) {
    const inCorso = trGiorno(t.inizio) <= oggi && trUltimo(t) >= oggi;
    const nome = String(t.nome || '').trim() || ('Torneo ' + (t.tipo || '')).trim();
    // La federazione si scrive solo se ce n'e' piu' d'una, e non due volte
    // (per il CSI il tipo e' gia' "CSI Bergamo", il comitato che organizza)
    const fed = piuFederazioni && !String(t.tipo || '').toUpperCase().includes(String(t.federazione || '').toUpperCase()) ? t.federazione : null;
    const dove = [t.localita, t.km != null ? `≈ ${t.km} km` : null, t.regione, t.tipo, fed].filter(Boolean).join(' · ');
    const url = trIndirizzo(t.url), programma = trIndirizzo(t.programma), mappa = trMappa(t.localita);
    const gare = (t.gare || []).filter(Boolean);
    return `<li class="atleta trVoce">
      <details class="trTorneo">
        <summary><b>${esc(trQuando(t))}</b>${inCorso ? ' <i class="trOggi">oggi</i>' : ''} ${esc(nome)}<br><small>${esc(dove)}</small></summary>
        <div class="trDett">
          ${gare.length ? '<ul class="trGare">' + gare.map(g => `<li>${esc(g)}</li>`).join('') + '</ul>'
            : '<p class="trNo">Gare non indicate sul sito.</p>'}
          ${url || programma || mappa ? `<p class="trLink">
            ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Scheda sul sito ${esc(t.federazione || '')}</a>` : ''}
            ${programma ? `<a href="${esc(programma)}" target="_blank" rel="noopener noreferrer">Programma (PDF)</a>` : ''}
            ${mappa ? `<a href="${esc(mappa)}" target="_blank" rel="noopener noreferrer">Indicazioni stradali</a>` : ''}</p>` : ''}
        </div>
      </details></li>`;
}

// Un gruppo richiudibile per mese (come i gironi negli Incontri). La prima
// volta e' aperto il primo, poi si ricordano quelli aperti.
function trHtmlMesi(lista, piuFederazioni, oggi) {
    const mesi = new Map();
    for (const t of lista) {
        const k = t.inizio.slice(0, 7);
        if (!mesi.has(k)) mesi.set(k, []);
        mesi.get(k).push(t);
    }
    const aperti = gruppiAperti('tornei');
    let mai = false;
    try { mai = localStorage.getItem('ttm.gruppi.tornei') === null; } catch { }
    let primo = true, h = '';
    for (const [k, suoi] of mesi) {
        const titolo = trGiorno(k + '-01').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
        const aperto = mesi.size === 1 || aperti.includes(k) || (mai && primo);
        primo = false;
        h += `<details class="gr" data-k="${esc(k)}"${aperto ? ' open' : ''}>
          <summary><b>${esc(titolo.charAt(0).toUpperCase() + titolo.slice(1))}</b><span>${suoi.length}</span></summary>
          <ul>${suoi.map(t => trHtmlTorneo(t, piuFederazioni, oggi)).join('')}</ul></details>`;
    }
    return h;
}

function trHtml(tornei, stato = trStato, oggi = trOggi()) {
    if (!tornei.length)
        return '<p class="vuoto">Nessun torneo. Si scaricano dal PC: sezione Tornei, "Scarica i tornei".</p>';
    const regioni = [...new Set(tornei.map(t => t.regione).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    const piuFederazioni = new Set(tornei.map(t => t.federazione || '')).size > 1;
    const v = trVisibili(tornei, stato, oggi);
    const lista = stato.passati ? v.passati : v.prossimi;
    // La tendina delle distanze c'e' solo se il PC le ha calcolate
    const conKm = tornei.some(t => t.km != null);
    const filtri = (regioni.length > 1 ? `<select id="trRegione" aria-label="Regione"><option value="">Tutte le regioni</option>
          ${regioni.map(r => `<option value="${esc(r)}"${r === v.regione ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>` : '')
        + (conKm ? `<select id="trDistanza" aria-label="Distanza">
          ${TR_DISTANZE.map(k => `<option value="${k}"${k === v.km ? ' selected' : ''}>${k ? 'Entro ' + k + ' km' : 'Ovunque'}</option>`).join('')}</select>` : '');
    return `${filtri ? `<div class="trFiltri">${filtri}</div>` : ''}
      <div class="tabs">
        <button id="trTabProssimi"${stato.passati ? '' : ' class="att"'}>In arrivo (${v.prossimi.length})</button>
        <button id="trTabPassati"${stato.passati ? ' class="att"' : ''}>Passati (${v.passati.length})</button>
      </div>
      ${lista.length ? trHtmlMesi(lista, piuFederazioni, oggi)
        : `<p class="vuoto">${stato.passati ? 'Nessun torneo passato' : 'Nessun torneo in arrivo'}${v.km ? ' entro ' + v.km + ' km' : ''}${v.regione ? ' in ' + esc(v.regione) : ''}.</p>`}
      ${conKm ? '<p class="trNota">I km sono in linea d\'aria dal nostro campo di gara: per strada sono di più.</p>' : ''}`;
}

// Disegna la sezione dentro c e aggancia filtro e schede. Richiamata con
// gli stessi tornei di prima (dati arrivati dal cloud ma senza novita' sui
// tornei) non ridisegna: chi sta leggendo le gare non se le vede richiudere.
function trDisegna(c, tornei) {
    const firma = JSON.stringify(tornei);
    if (c.dataset.firma === firma && c.firstChild) return;
    c.dataset.firma = firma;
    const ridisegna = () => {
        c.innerHTML = trHtml(tornei);
        agganciaGruppi('tornei', c);
        const reg = c.querySelector('#trRegione');
        if (reg) reg.onchange = () => {
            trStato.regione = reg.value;
            try { localStorage.setItem('ttm.tornei.regione', reg.value); } catch { }
            ridisegna();
        };
        const dist = c.querySelector('#trDistanza');
        if (dist) dist.onchange = () => {
            trStato.km = +dist.value || 0;
            try { localStorage.setItem('ttm.tornei.km', String(trStato.km)); } catch { }
            ridisegna();
        };
        const tab = (id, passati) => { const b = c.querySelector(id); if (b) b.onclick = () => { trStato.passati = passati; ridisegna(); }; };
        tab('#trTabProssimi', false);
        tab('#trTabPassati', true);
    };
    ridisegna();
}

// ---------------- classifica atleti ----------------
// "Classifica atleti" (10/10, versione 1.1.0): la tabella che la societa'
// faceva con Excel. Per ogni nostro atleta FITET: posizione nella classifica
// individuale ufficiale, quanto e' salito o sceso rispetto alla classifica
// prima, squadra e punti. Stesso disegno e stessi conti nelle due PWA;
// cambia solo da dove arrivano gli atleti (ranking.js: via cloud i dati
// scaricati sul telefono, in rete locale api/classifica-atleti del PC).
//   atleti = [{ id, nome, sesso: 'M' | 'F' | '', squadre: 'D3',
//               storico: [{ data: 'AAAA-MM-GG', posizione, punti, categoria }] }]
//   squadre = i campionati FITET delle squadre in cui e' in rosa (la
//   classifica e' della FITET: le squadre CSI non c'entrano).
// caCalcola e' il GEMELLO di ClassificaAtletiLogica.Calcola sul PC, riga
// per riga: Tools/TestPwaCloud/test-ranking.js li confronta sui casi di
// classifica-atleti.json (generato dal C#). Se cambia uno va cambiato l'altro.
// Le classifiche le scarica il PC ("Classifica atleti" -> "Scarica dal sito
// FITET"): i telefoni le leggono soltanto.
// Salito / sceso / uguale si leggono dal SIMBOLO e dal numero (il colore e'
// in piu'); la stella va ai primi 3 saliti di piu' (a pari merito col
// terzo, tutti quelli alla pari) e, in piu' (1.1.1), alle prime 2 fra le
// donne: sono poche, senza questo la stella andrebbe quasi solo agli uomini.

const CA_MIGLIORI = 3;
const CA_MIGLIORI_DONNE = 2;
const caData = d => String(d || '').slice(0, 10);
const caGiorno = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';

// ultima / precedente = le due classifiche da confrontare ('AAAA-MM-GG');
// vuote = le ultime due. Una "precedente" non piu' vecchia dell'ultima non
// vale: si prende quella subito prima. Ordine: prima le donne, poi gli
// uomini, ciascun gruppo per posizione; chi non ha posizione in fondo.
function caCalcola(atleti, ultima = null, precedente = null) {
    const date = [...new Set(atleti.flatMap(a => (a.storico || []).map(p => caData(p.data))))].sort().reverse();
    const t = { date, ultima: null, precedente: null, righe: [] };
    t.ultima = ultima && date.includes(caData(ultima)) ? caData(ultima) : date[0] || null;
    if (t.ultima) {
        const prima = date.filter(d => d < t.ultima);
        t.precedente = precedente && prima.includes(caData(precedente)) ? caData(precedente) : prima[0] || null;
    }

    for (const a of atleti) {
        const del = d => d ? (a.storico || []).find(p => caData(p.data) === d) : null;
        const adesso = del(t.ultima), prima = del(t.precedente);
        const r = {
            id: a.id, nome: a.nome || '', sesso: a.sesso || '', squadre: a.squadre || '',
            posizione: adesso?.posizione ?? null, prima: prima?.posizione ?? null,
            variazione: null,               // posti guadagnati: positivo = salito
            andamento: '',                  // salito | sceso | stabile | nuovo | senza (posizione)
            punti: adesso?.punti ?? null, categoria: adesso?.categoria ?? null, migliore: false
        };
        if (r.posizione == null) r.andamento = 'senza';
        else if (r.prima == null) r.andamento = 'nuovo';
        else {
            r.variazione = r.prima - r.posizione;
            r.andamento = r.variazione > 0 ? 'salito' : r.variazione < 0 ? 'sceso' : 'stabile';
        }
        t.righe.push(r);
    }

    // I primi 3 saliti di piu' in assoluto e, in piu', le prime 2 fra le
    // donne (a pari merito con l'ultimo del gruppo, tutti quelli alla pari)
    const segna = (righe, quanti) => {
        const saliti = righe.filter(r => r.andamento === 'salito').sort((a, b) => b.variazione - a.variazione);
        if (!saliti.length) return;
        const soglia = saliti[Math.min(quanti, saliti.length) - 1].variazione;
        for (const r of saliti) if (r.variazione >= soglia) r.migliore = true;
    };
    segna(t.righe, CA_MIGLIORI);
    segna(t.righe.filter(r => r.sesso === 'F'), CA_MIGLIORI_DONNE);

    const gruppo = r => r.sesso === 'F' ? 0 : r.sesso === 'M' ? 1 : 2;
    const maiuscolo = r => r.nome.toUpperCase();
    t.righe.sort((a, b) => gruppo(a) - gruppo(b)
        || (a.posizione == null ? 1 : 0) - (b.posizione == null ? 1 : 0)
        || (a.posizione ?? 0) - (b.posizione ?? 0)
        || (maiuscolo(a) < maiuscolo(b) ? -1 : maiuscolo(a) > maiuscolo(b) ? 1 : 0));
    return t;
}

// "▲ +50", "▼ -12", "=", "nuovo", "" (senza posizione)
const caVariazione = r => r.andamento === 'salito' ? `▲ +${r.variazione}`
    : r.andamento === 'sceso' ? `▼ ${r.variazione}`
    : r.andamento === 'stabile' ? '=' : r.andamento === 'nuovo' ? 'nuovo' : '';

// Le due classifiche scelte nelle tendine: valgono finche' l'app resta
// aperta (riaprendola si riparte dalle ultime due, quelle che servono).
const caStato = { ultima: null, precedente: null };
const CA_GRUPPI = { F: 'Femminile', M: 'Maschile', '': 'Altri' };

function caHtml(atleti, stato = caStato) {
    if (!atleti.length)
        return '<p class="vuoto">Nessun atleta FITET della nostra società in questa stagione.<br>Sul PC: pannello Società, casella "È la NOSTRA società".</p>';
    const t = caCalcola(atleti, stato.ultima, stato.precedente);
    if (!t.ultima)
        return '<p class="vuoto">Nessuna classifica. Si scaricano dal PC: "Classifica atleti", "Scarica dal sito FITET".</p>';

    const opzioni = (date, scelta) => date.map(d => `<option value="${d}"${d === scelta ? ' selected' : ''}>${caGiorno(d)}</option>`).join('');
    const prima = t.date.filter(d => d < t.ultima);
    const scelta = `<div class="caScelta">
        <label>Classifica del<select id="caUltima">${opzioni(t.date, t.ultima)}</select></label>
        ${prima.length ? `<label>rispetto al<select id="caPrima">${opzioni(prima, t.precedente)}</select></label>` : ''}
      </div>`;

    const piuGruppi = new Set(t.righe.map(r => r.sesso)).size > 1;
    let ultimoGruppo = null;
    const riga = r => {
        const testaGruppo = piuGruppi && r.sesso !== ultimoGruppo ? `<li class="caGruppo">${CA_GRUPPI[r.sesso] || CA_GRUPPI['']}</li>` : '';
        ultimoGruppo = r.sesso;
        return `${testaGruppo}<li class="caRiga ca-${r.andamento}${r.migliore ? ' migliore' : ''}">
          <span class="caPos">${r.posizione ?? '—'}</span>
          <span class="caNome"><b>${r.migliore ? '<i class="caStella">★</i> ' : ''}${esc(r.nome)}</b>${r.squadre ? `<small>${esc(r.squadre)}</small>` : ''}</span>
          <span class="caVar"><b>${caVariazione(r)}</b>${r.prima != null && r.posizione != null ? `<small>era ${r.prima}</small>` : ''}</span>
          <span class="caPunti">${r.punti ?? ''}</span></li>`;
    };
    return `${scelta}
      ${t.precedente ? `<div class="lvInfo">▲ salito · ▼ sceso · = uguale${t.righe.some(r => r.migliore) ? ` · ★ i ${CA_MIGLIORI} saliti di più${t.righe.some(r => r.sesso === 'F') ? ` e le prime ${CA_MIGLIORI_DONNE} donne` : ''}` : ''}</div>`
        : '<div class="lvInfo">C\'è una sola classifica: per il confronto serve la prossima.</div>'}
      <ul class="caElenco">
        <li class="caRiga caTesta"><span>Pos.</span><span>Atleta · squadra</span><span>Variazione</span><span>Punti</span></li>
        ${t.righe.map(riga).join('')}
      </ul>
      <p class="trNota">Posizioni nella classifica nazionale FITET. Le classifiche le scarica il PC quando la federazione ne pubblica una nuova.</p>`;
}

// Disegna la sezione dentro c e aggancia le due tendine. Richiamata con gli
// stessi atleti di prima (dati arrivati dal cloud ma niente di nuovo qui)
// non ridisegna.
function caDisegna(c, atleti) {
    const firma = JSON.stringify(atleti);
    if (c.dataset.firma === firma && c.firstChild) return;
    c.dataset.firma = firma;
    const ridisegna = () => {
        c.innerHTML = caHtml(atleti);
        const u = c.querySelector('#caUltima'), p = c.querySelector('#caPrima');
        // La prima voce di ogni tendina e' la scelta di base (l'ultima
        // classifica, quella subito prima): sceglierla = "nessuna scelta",
        // cosi' quando il PC scarica una classifica nuova si passa a quella.
        // Cambiata l'ultima, la precedente riparte da quella subito prima.
        if (u) u.onchange = () => { caStato.ultima = u.selectedIndex === 0 ? null : u.value; caStato.precedente = null; ridisegna(); };
        if (p) p.onchange = () => { caStato.precedente = p.selectedIndex === 0 ? null : p.value; ridisegna(); };
    };
    ridisegna();
}

// ---------------- disponibilita' per le gare ----------------
// (10/10 sera, versione 1.2.0) Chi c'e' per una gara di una nostra squadra:
// il foglio presenze della squadra. Ogni atleta della rosa ha una risposta
// fra quattro, decise con l'utente: Si' / Forse / No / Non so. "Non so" e'
// anche chi non ha ancora risposto (nessuna riga). Chiunque puo' rispondere
// per chiunque della rosa: gli account dei telefoni non sono legati a un
// atleta; il telefono ricorda soltanto "chi sono io" per mettere quella
// riga in cima. Nel cloud resta scritto chi ha toccato la riga.
// Per ora solo via cloud (pwa-cloud/disponibilita.js): chi risponde e' a
// casa, senza il PC. Conti, testi e disegno stanno qui, pronti anche per
// la rete locale. Gemelli sul PC: Services/DisponibilitaLogica.cs (Uid,
// Riassunto, nomi e segni): se cambia uno va cambiato l'altro.

// v = il valore che viaggia (enum RispostaDisponibilita del PC)
const DS_RISPOSTE = [
    { v: 'Si', nome: 'Sì', segno: '✔' },
    { v: 'Forse', nome: 'Forse', segno: '?' },
    { v: 'No', nome: 'No', segno: '✖' },
    { v: 'NonSo', nome: 'Non so', segno: '…' }
];
const dsRisposta = v => DS_RISPOSTE.find(r => r.v === v) || DS_RISPOSTE[3];

// L'uid della riga, ricavato da incontro e atleta: le 32 cifre esadecimali
// dell'incontro combinate una a una (XOR) con quelle dell'atleta lette AL
// CONTRARIO. Cosi' due telefoni (o il PC) che rispondono per lo stesso
// atleta nello stesso incontro scrivono la STESSA riga, e vale l'ultima
// risposta, invece di due doppioni. Al contrario: senza, due coppie
// "incrociate" (incontro 1 + atleta 4, incontro 4 + atleta 1) con uid che
// differiscono nelle stesse cifre darebbero la stessa riga.
function dsUid(uidIncontro, uidAtleta) {
    const a = String(uidIncontro).replace(/-/g, '').toLowerCase(), b = String(uidAtleta).replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(a) || !/^[0-9a-f]{32}$/.test(b)) return `${uidIncontro}~${uidAtleta}`;   // uid non standard: solo nei test
    let c = '';
    for (let i = 0; i < 32; i++) c += (parseInt(a[i], 16) ^ parseInt(b[31 - i], 16)).toString(16);
    return `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}`;
}

// "Sì 3 · Forse 1 · No 1 · Non so 2": sempre tutte e quattro, si vede subito chi manca
function dsRiassunto(risposte) {
    const n = Object.fromEntries(DS_RISPOSTE.map(r => [r.v, 0]));
    for (const v of risposte) n[dsRisposta(v).v]++;
    return DS_RISPOSTE.map(r => `${r.nome} ${n[r.v]}`).join(' · ');
}

// Accanto al nome nelle tendine della formazione: "Rossi Mario · ✔ sì".
// Chi non ha risposto resta col solo nome.
function dsNomeConRisposta(nome, risposta) {
    const r = dsRisposta(risposta);
    return r.v === 'NonSo' ? nome : `${nome} · ${r.segno} ${r.nome.toLowerCase()}`;
}

// d = { casa, ospite, info, io: id dell'atleta "sono io" (o null),
//       squadre: [{ nome, atleti: [{ id, nome, risposta }] }] }
// Una riga per atleta: il nome e sotto i quattro pulsanti, quello scelto e'
// pieno e ha davanti il suo segno. La riga di "io" e' la prima, con "tu".
function dsHtml(d) {
    const tutti = d.squadre.flatMap(s => s.atleti);
    if (!tutti.length)
        return `<button class="pieno chiaro" id="dsIndietro">← Incontro</button>
          <p class="vuoto">Nessun atleta in rosa per questa squadra.<br>La rosa si compila dalla sezione Rosa.</p>`;
    const noti = new Map(tutti.map(a => [String(a.id), a]));
    const io = d.io != null && noti.has(String(d.io)) ? String(d.io) : '';
    const riga = a => `<li class="dsRiga${String(a.id) === io ? ' io' : ''}">
        <b>${esc(a.nome)}${String(a.id) === io ? ' <small>tu</small>' : ''}</b>
        <span class="dsScelta">${DS_RISPOSTE.map(r => `<button type="button" data-a="${esc(a.id)}" data-r="${r.v}"${
            dsRisposta(a.risposta).v === r.v ? ' class="att" aria-pressed="true"' : ' aria-pressed="false"'}>${r.segno} ${r.nome}</button>`).join('')}</span></li>`;
    const elenco = s => {
        const ordinati = [...s.atleti].sort((x, y) => (String(y.id) === io) - (String(x.id) === io) || x.nome.localeCompare(y.nome, 'it'));
        return `${d.squadre.length > 1 ? `<h4>${esc(s.nome)}</h4>` : ''}
          ${ordinati.length ? `<ul class="dsElenco">${ordinati.map(riga).join('')}</ul>` : '<p class="vuoto">Rosa vuota</p>'}`;
    };
    const nomi = [...noti.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'it'));
    return `<button class="pieno chiaro" id="dsIndietro">← Incontro</button>
      <div class="lvTesta">${htmlNomeSquadra(d.casa)}<span class="lvTot">–</span>${htmlNomeSquadra(d.ospite)}</div>
      <div class="lvInfo">${esc(d.info || '')}</div>
      <h4>Chi c'è?</h4>
      <div class="dsRiassunto" id="dsRiassunto">${esc(dsRiassunto(tutti.map(a => a.risposta)))}</div>
      <label class="dsIo">Chi sei? (la tua riga va in cima)
        <select id="dsIo"><option value="">— scegli il tuo nome —</option>
          ${nomi.map(a => `<option value="${esc(a.id)}"${String(a.id) === io ? ' selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></label>
      ${d.squadre.map(elenco).join('')}
      <p class="trNota">Ognuno può rispondere anche per un compagno. "Non so" è anche chi non ha ancora risposto. La risposta si salva al tocco.</p>`;
}

// Disegna dentro c e aggancia i pulsanti.
//   azioni = { indietro(), scegli(idAtleta, risposta), sonoIo(idAtleta o '') }
// Richiamata con gli stessi dati di prima non ridisegna (niente sfarfallio
// a ogni sincronizzazione).
function dsDisegna(c, d, azioni) {
    const firma = JSON.stringify(d);
    if (c.dataset.dsFirma === firma && c.querySelector('#dsIndietro')) return;
    c.dataset.dsFirma = firma;
    c.innerHTML = dsHtml(d);
    c.querySelector('#dsIndietro').onclick = () => azioni.indietro();
    const io = c.querySelector('#dsIo');
    if (io) io.onchange = () => azioni.sonoIo(io.value);
    c.querySelectorAll('.dsScelta button').forEach(b => b.onclick = () => azioni.scegli(b.dataset.a, b.dataset.r));
}

// ---------------- punti: formazione non compilata ----------------
// Prima di aprire i Punti di un incontro: se una squadra (o tutte e due) non
// ha nemmeno un giocatore in formazione lo si dice, si ricorda dove si
// compila e si chiede se andare avanti lo stesso. Senza formazione i punti
// si segnano, ma al posto dei nomi ci sono le squadre e il referto resta da
// completare. Chi conferma non viene piu' interrogato su quell'incontro
// finche' l'app resta aperta.
// squadre = nomi delle squadre senza formazione (vuoto = tutto a posto).
// Ritorna (dopo la risposta: va aspettata con await) true se si possono
// aprire i Punti.
const lvSenzaFormazioneOk = new Set();
async function lvConfermaSenzaFormazione(incontro, squadre) {
    if (!squadre.length || lvSenzaFormazioneOk.has(String(incontro))) return true;
    const ok = await conferma(`Formazione non compilata: ${squadre.join(' e ')}.\n\n` +
        'La formazione si compila in Incontri: tocca l\'incontro, poi "Formazione".\n\n' +
        'Segnare i punti lo stesso, senza formazione? (non consigliato)', 'Attenzione');
    if (ok) lvSenzaFormazioneOk.add(String(incontro));
    return ok;
}

// ---------------- punti: sorteggio del doppio ----------------
// Nel primo set una coppia batte e l'altra riceve; in ognuna si sceglie chi
// dei due comincia. Quale coppia batte dipende da "Batte per primo", scelto
// poco sopra nello stesso modulo: le due domande cambiano con quella scelta
// (come nel Sorteggio del PC), cosi' non si deve ragionare su chi "apre".
//   batte la casa   -> "Batte la coppia di casa"  / "Riceve la coppia ospite"
//   batte l'ospite  -> "Riceve la coppia di casa" / "Batte la coppia ospite"
const lvEticDoppio = casaBatte => ({
    casa: casaBatte ? 'Batte la coppia di casa: batte per primo' : 'Riceve la coppia di casa: riceve per primo',
    ospite: casaBatte ? 'Riceve la coppia ospite: riceve per primo' : 'Batte la coppia ospite: batte per primo'
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

// Solo per i test in Node (test-ranking.js): nel browser `module` non esiste
if (typeof module !== 'undefined' && module.exports) module.exports = { caCalcola, caVariazione, caGiorno, CA_MIGLIORI,
    DS_RISPOSTE, dsUid, dsRiassunto, dsNomeConRisposta, dsRisposta };
