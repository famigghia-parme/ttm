// TennisTavoloManager - app.js  (PWA cloud)
// Guscio dell'app: login, barra di stato, navigazione, vista Account,
// service worker, sync periodico. Le viste stanno in incontri.js, rosa.js,
// atleti.js e si registrano in `viste`.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    const visibile = !!r && r.top >= 0 && r.bottom <= window.innerHeight - 64;   // 64 = barra in basso
    if (ok || !visibile) avviso(t, ok);
}

const viste = {};
// Versione letta dal ?v= con cui index.html carica questo file: un posto in meno da aggiornare
const VERSIONE_APP = new URL(document.currentScript.src).searchParams.get('v') || '?';
let vistaCorrente = null;

function mostra(nome) {
    viste[vistaCorrente]?.esci?.();      // la vista che si lascia chiude le sue cose (Punti)
    vistaCorrente = nome;
    try { localStorage.setItem('ttm.vista', nome); } catch { }
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('att', b.dataset.v === nome));
    $('#vista').innerHTML = viste[nome].html;
    viste[nome].init?.();
}

// ---------------- sync dopo una modifica ----------------
// Di norma una modifica parte subito al cloud. Con i Punti aperti i tocchi
// sono tanti: Sync.pausaMs (lo imposta live.js) = un giro al massimo ogni
// tot millisecondi. Il dato e' comunque gia' scritto sul telefono.
let _syncTimer = null;
function syncDopoModifica() {
    if (!Sync.pausaMs) { Sync.esegui(); return; }
    if (_syncTimer) return;                 // un giro e' gia' in programma
    _syncTimer = setTimeout(() => { _syncTimer = null; Sync.esegui(); }, Sync.pausaMs);
}
function syncSubito() {
    clearTimeout(_syncTimer); _syncTimer = null;
    Sync.esegui();
}

// ---------------- dati comuni alle viste ----------------

// Stagione: da config.js, altrimenti la piu' recente fra i campionati attivi
async function stagioneCorrente() {
    if (CONFIG.STAGIONE) return CONFIG.STAGIONE;
    const s = (await tutti('campionati')).filter(c => c.attivo).map(c => c.stagione).sort();
    return s[s.length - 1] || '';
}

const perUid = righe => new Map(righe.map(r => [r.uid, r]));
const nomeAtleta = a => a ? `${a.cognome} ${a.nome}` : '';

// Stessa etichetta di Partita.EtichettaOrdine sul PC
function etichettaPartita(p) {
    if (p.tipo === 'Doppio') return 'Doppio';
    if (!p.posto_abc || !p.posto_xyz)
        return { 1: 'A - X', 2: 'B - Y', 3: 'C - Z', 4: 'Doppio', 5: 'B - X', 6: 'A - Z', 7: 'C - Y' }[p.ordine] || `Partita ${p.ordine}`;
    return `${{ A: 'A', B: 'B', C: 'C' }[p.posto_abc] || 'D'} - ${{ A: 'X', B: 'Y', C: 'Z' }[p.posto_xyz] || 'D'}`;
}

const ORDINE_RUOLI = ['A', 'B', 'C', 'Riserva1', 'Riserva2', 'Riserva3', 'Capitano', 'Allenatore', 'Medico', 'Dirigente'];
function etichettaRuolo(r, abc) {
    if (r.length === 1) return abc ? r : { A: 'X', B: 'Y', C: 'Z' }[r];
    return { Riserva1: 'Ris. 1', Riserva2: 'Ris. 2', Riserva3: 'Ris. 3', Medico: 'Medico' }[r] || r;
}

// "sab 04/10 20:30" (data_ora e' ora locale, senza fuso)
function dataBreve(s) {
    if (!s) return 'data da definire';
    const d = new Date(s);
    return d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' ' +
        d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// ---------------- elenchi raggruppati ----------------
// Tre livelli: federazione (FITET, CSI) > campionato > girone. Ogni gruppo
// si apre e si chiude con un tocco; quelli aperti si ricordano per vista.
// Con un solo gruppo non c'e' nulla da scegliere: resta aperto.
// voci: [{ tipo, campionato, girone, ... }] gia' nell'ordine voluto dentro
// il gruppo; htmlVoce(voce) -> '<li>...</li>'.
const ORDINE_FEDERAZIONI = { FITET: 0, CSI: 1 };

function gruppiAperti(vista) {
    try { return JSON.parse(localStorage.getItem('ttm.gruppi.' + vista) || '[]'); } catch { return []; }
}

function htmlGruppi(vista, voci, htmlVoce) {
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
    let h = '', fed = null;
    for (const g of ordinati) {
        if (g.tipo !== fed) { fed = g.tipo; h += `<h3 class="grFed">${esc(fed || 'Altro')}</h3>`; }
        h += `<details class="gr" data-k="${esc(g.k)}"${ordinati.length === 1 || aperti.includes(g.k) ? ' open' : ''}>
          <summary><b>${esc(g.campionato)}</b>${g.girone ? ' · girone ' + esc(g.girone) : ''}<span>${g.voci.length}</span></summary>
          <ul>${g.voci.map(htmlVoce).join('')}</ul></details>`;
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
        const aperti = new Set(gruppiAperti(vista));
        if (d.open) aperti.add(d.dataset.k); else aperti.delete(d.dataset.k);
        try { localStorage.setItem('ttm.gruppi.' + vista, JSON.stringify([...aperti])); } catch { }
    }));
}

// ---------------- barra di stato ----------------
async function aggiornaStato() {
    const el = $('#stato');
    if (!el) return;
    const n = await contaInAttesa().catch(() => 0);
    const ora = Sync.ultimoOk ? Sync.ultimoOk.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const attesa = n ? ` · ${n} da inviare` : '';
    el.textContent =
        Sync.stato === 'corso' ? '🔄 sincronizzazione…' :
        Sync.stato === 'offline' ? `🔴 offline${attesa}` :
        Sync.stato === 'sessione' ? '⚠ rifai l\'accesso' :
        Sync.stato === 'errore' ? `🟠 errore${attesa}` :
        n ? `🟡${attesa}` :
        Sync.stato === 'ok' ? `🟢 aggiornato ${ora}` : '…';
}

// ---------------- login ----------------
function mostraLogin(avviso = '') {
    $('#nav').hidden = true;
    // Con due ambienti configurati si sceglie qui (ognuno col suo accesso).
    const scelta = AMBIENTI_PRONTI.length > 1
        ? `<div class="tabs">${AMBIENTI_PRONTI.map(a =>
            `<button type="button" data-amb="${a}"${a === AMBIENTE ? ' class="att"' : ''}>${a === 'prova' ? 'Prova' : 'Reale'}</button>`).join('')}</div>`
        : '';
    $('#vista').innerHTML = `
    <h3>Accesso${PROVA ? ' — ambiente di PROVA' : ''}</h3>
    ${scelta}
    <p class="vuoto" style="text-align:left">Usa l'email e la password che ti ha dato la società.</p>
    <form id="frmLogin" autocomplete="on">
      <input name="email" type="email" placeholder="Email" required autocomplete="username">
      <input name="password" type="password" placeholder="Password" required autocomplete="current-password">
      <div id="msg">${esc(avviso)}</div>
      <button class="pieno" id="btnEntra">Entra</button>
    </form>`;
    document.querySelectorAll('button[data-amb]').forEach(b => b.onclick = () => {
        if (b.dataset.amb !== AMBIENTE) cambiaAmbiente(b.dataset.amb);
    });
    $('#frmLogin').onsubmit = async e => {
        e.preventDefault();
        const f = e.target, b = $('#btnEntra');
        b.disabled = true; msg('');
        try {
            await Cloud.login(f.email.value.trim(), f.password.value);
            // Account valido ma non abilitato dalla societa' (tabella membri)
            const r = await Cloud.rest('GET', 'membri?select=nome');
            if (!r.ok || !r.json?.length) {
                Cloud.logout();
                msg('Account non abilitato: chiedi di essere aggiunto alla lista membri.');
                return;
            }
            // Progetto Supabase dell'altro ambiente (o senza etichetta): stop.
            const errAmb = await ambienteSbagliato();
            if (errAmb) { Cloud.logout(); msg(errAmb); return; }
            $('#vista').innerHTML = '<p class="vuoto">Primo scarico dei dati…</p>';
            await Sync.esegui();
            entra();
        } catch (ex) {
            msg(ex.offline ? 'Serve la rete per il primo accesso.' : ex.message);
        } finally { const x = $('#btnEntra'); if (x) x.disabled = false; }
    };
}

let _avviato = false;
function entra() {
    $('#nav').hidden = false;
    let v = 'incontri';
    try { v = localStorage.getItem('ttm.vista') || v; } catch { }
    mostra(viste[v] ? v : 'incontri');
    if (_avviato) return;
    _avviato = true;
    Sync.esegui();
    setInterval(() => Sync.esegui(), 60000);
    window.addEventListener('online', () => Sync.esegui());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Sync.esegui(); });
}

// ---------------- vista Account ----------------
viste.account = {
    html: '<div id="acCorpo"></div>',
    init: async () => {
        const n = await contaInAttesa();
        const avvisi = Sync.avvisi.length
            ? '<h4>Avvisi dell\'ultimo sync</h4><ul>' + Sync.avvisi.map(a => `<li class="atleta">${esc(a)}</li>`).join('') + '</ul>'
            : '';
        const altro = AMBIENTI_PRONTI.find(a => a !== AMBIENTE);
        $('#acCorpo').innerHTML = `
      <h4>Account</h4>
      <p>${esc(Cloud.sessione?.email || '')}</p>
      <p>Ambiente: <b class="${PROVA ? 'ambProva' : ''}">${PROVA ? 'PROVA' : 'REALE'}</b></p>
      <p><small>Stagione: ${esc(await stagioneCorrente() || 'n/d')} · Versione ${esc(VERSIONE_APP)}</small></p>
      <p><small>Ultima sincronizzazione: ${Sync.ultimoOk ? Sync.ultimoOk.toLocaleString('it-IT') : 'mai'}
        ${Sync.messaggio ? '<br>' + esc(Sync.messaggio) : ''}</small></p>
      <p><b>${n}</b> modifiche da inviare</p>
      <button class="pieno" id="acSync">Sincronizza ora</button>
      ${avvisi}
      <div id="msg"></div>
      ${altro ? `<button class="pieno chiaro" id="acAmbiente" style="margin-top:24px">Passa all'ambiente ${altro === 'prova' ? 'PROVA' : 'REALE'}</button>` : ''}
      <button class="pieno chiaro" id="acEsci" style="margin-top:24px">Esci</button>`;
        $('#acSync').onclick = async () => { await Sync.esegui(); viste.account.init(); };
        const ba = $('#acAmbiente');
        if (ba) ba.onclick = async () => {
            // Nulla si perde: dati e modifiche in attesa restano nell'ambiente lasciato.
            const n2 = await contaInAttesa();
            if (!confirm(`Passare all'ambiente ${altro.toUpperCase()}?` +
                (n2 ? `\n${n2} modifiche di ${AMBIENTE.toUpperCase()} restano da inviare: partiranno al ritorno.` : ''))) return;
            cambiaAmbiente(altro);
        };
        $('#acEsci').onclick = esci;
    }
};

async function esci() {
    const n = await contaInAttesa();
    if (n && !confirm(`Ci sono ${n} modifiche non ancora inviate: uscendo si PERDONO.\nUscire lo stesso?`)) return;
    if (!n && !confirm('Uscire? I dati scaricati vengono cancellati da questo telefono.')) return;
    Cloud.logout();
    await svuotaDb();
    location.reload();
}

// ---------------- service worker ----------------
function registraSw() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(reg => {
        // Nuova versione scaricata e in attesa: si chiede di aggiornare
        const avvisa = w => {
            const b = $('#aggiorna');
            b.hidden = false;
            b.onclick = () => w.postMessage('aggiorna');
        };
        if (reg.waiting && navigator.serviceWorker.controller) avvisa(reg.waiting);
        reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            w?.addEventListener('statechange', () => {
                if (w.state === 'installed' && navigator.serviceWorker.controller) avvisa(w);
            });
        });
        // Controllo aggiornamenti a ogni ritorno sull'app
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => { }); });
    });
    // Si ricarica solo quando una versione NUOVA prende il posto di una vecchia.
    // Al primo avvio clients.claim() fa scattare controllerchange: ricaricare
    // li' cancellerebbe il login a meta'.
    let controllata = !!navigator.serviceWorker.controller;
    let ricaricata = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!controllata) { controllata = true; return; }   // primo avvio: nessuna versione vecchia
        if (ricaricata) return;
        ricaricata = true;
        location.reload();
    });
}

// ---------------- avvio ----------------
async function avvio() {
    document.querySelectorAll('nav button').forEach(b => b.onclick = () => mostra(b.dataset.v));
    document.addEventListener('ttm-stato', () => {
        aggiornaStato();
        if (vistaCorrente === 'account' && !Sync.inCorso) viste.account.init();
    });
    document.addEventListener('ttm-locale', () => { aggiornaStato(); syncDopoModifica(); });
    // Dati nuovi dal cloud: ridisegna la vista se non si sta modificando nulla
    document.addEventListener('ttm-dati', () => { if (vistaCorrente) viste[vistaCorrente].suDati?.(); });

    registraSw();
    navigator.storage?.persist?.().catch(() => { });   // chiede di non cancellare i dati offline

    // Ambiente di Prova: intestazione arancione e scritta PROVA, sempre visibili.
    document.body.classList.toggle('prova', PROVA);
    $('#ambiente').textContent = PROVA ? 'PROVA' : '';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PROVA ? '#ff8c00' : '#1b5e20');

    if (!AMBIENTI_PRONTI.length) {
        $('#vista').innerHTML = '<p class="vuoto">config.js non compilato: inserisci indirizzo e chiave di Supabase (almeno un ambiente).</p>';
        return;
    }
    await apriDb();
    if (!Cloud.sessione) return mostraLogin();
    entra();
}

document.addEventListener('ttm-stato', () => {
    if (Sync.stato === 'sessione') mostraLogin('Sessione scaduta: rifai l\'accesso. I dati non inviati restano sul telefono.');
});

window.addEventListener('load', avvio);
