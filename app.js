// TennisTavoloManager - app.js  (PWA cloud)
// Guscio dell'app: login, barra di stato, navigazione, vista Account,
// service worker, sync periodico. Le viste stanno in incontri.js, rosa.js,
// atleti.js e si registrano in `viste`.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const msg = (t, ok = false) => { const m = $('#msg'); if (m) { m.style.color = ok ? 'var(--verde)' : ''; m.textContent = t; } };

const viste = {};
// Versione letta dal ?v= con cui index.html carica questo file: un posto in meno da aggiornare
const VERSIONE_APP = new URL(document.currentScript.src).searchParams.get('v') || '?';
let vistaCorrente = null;

function mostra(nome) {
    vistaCorrente = nome;
    try { localStorage.setItem('ttm.vista', nome); } catch { }
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('att', b.dataset.v === nome));
    $('#vista').innerHTML = viste[nome].html;
    viste[nome].init?.();
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
    $('#vista').innerHTML = `
    <h3>Accesso</h3>
    <p class="vuoto" style="text-align:left">Usa l'email e la password che ti ha dato la società.</p>
    <form id="frmLogin" autocomplete="on">
      <input name="email" type="email" placeholder="Email" required autocomplete="username">
      <input name="password" type="password" placeholder="Password" required autocomplete="current-password">
      <div id="msg">${esc(avviso)}</div>
      <button class="pieno" id="btnEntra">Entra</button>
    </form>`;
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
        $('#acCorpo').innerHTML = `
      <h4>Account</h4>
      <p>${esc(Cloud.sessione?.email || '')}</p>
      <p><small>Stagione: ${esc(await stagioneCorrente() || 'n/d')} · Versione ${esc(VERSIONE_APP)}</small></p>
      <p><small>Ultima sincronizzazione: ${Sync.ultimoOk ? Sync.ultimoOk.toLocaleString('it-IT') : 'mai'}
        ${Sync.messaggio ? '<br>' + esc(Sync.messaggio) : ''}</small></p>
      <p><b>${n}</b> modifiche da inviare</p>
      <button class="pieno" id="acSync">Sincronizza ora</button>
      ${avvisi}
      <div id="msg"></div>
      <button class="pieno chiaro" id="acEsci" style="margin-top:24px">Esci</button>`;
        $('#acSync').onclick = async () => { await Sync.esegui(); viste.account.init(); };
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
    document.addEventListener('ttm-locale', () => { aggiornaStato(); Sync.esegui(); });
    // Dati nuovi dal cloud: ridisegna la vista se non si sta modificando nulla
    document.addEventListener('ttm-dati', () => { if (vistaCorrente) viste[vistaCorrente].suDati?.(); });

    registraSw();
    navigator.storage?.persist?.().catch(() => { });   // chiede di non cancellare i dati offline

    if (!/^https?:\/\/.+/.test(CONFIG.SUPABASE_URL) || CONFIG.SUPABASE_URL.includes('INSERISCI')) {
        $('#vista').innerHTML = '<p class="vuoto">config.js non compilato: inserisci indirizzo e chiave di Supabase.</p>';
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
