// TennisTavoloManager - app.js  (PWA cloud)
// Guscio dell'app via cloud: login, barra di stato, vista Account, service
// worker, sync periodico. Menu (Home e barra in basso), avvisi ed elenchi
// raggruppati stanno in comune.js, uguale a quello della PWA in rete locale.
// Le viste stanno in incontri.js (Incontri e Punti), rosa.js, atleti.js e
// si registrano in `viste`.

// Versione letta dal ?v= con cui index.html carica questo file: un posto in meno da aggiornare
const VERSIONE_APP = new URL(document.currentScript.src).searchParams.get('v') || '?';

// Riga in fondo alla Home (comune.js la chiama se esiste)
function infoHome(el) {
    el.innerHTML = `Via cloud · ambiente <b>${PROVA ? 'PROVA' : 'REALE'}</b> · versione ${esc(VERSIONE_APP)}`;
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

// Federazione di una SOCIETA'. Attenzione: societa.tipo arriva dal PC come
// NUMERO ("0" = FITET, "1" = CSI: l'enum TipoCampionato, che in Societa e'
// salvato cosi'), mentre campionati.tipo e' gia' la parola ("FITET"/"CSI").
// Qui si accettano tutte e due le forme e si restituisce sempre la parola.
// Trovato il 03/10: la tendina degli Atleti mostrava "0" e "1", e i punti
// FITET non comparivano mai (il confronto con 'FITET' falliva sempre).
const FEDERAZIONI = ['FITET', 'CSI'];
const federazione = t => FEDERAZIONI[t] ?? (t == null ? '' : String(t));

// Categoria e punti FITET di ogni atleta nella stagione: stanno sul
// tesseramento con una societa' FITET; se ce n'e' piu' d'uno vale quello con
// piu' punti. Chi non e' tesserato FITET non compare. Ritorna
// Map(uid atleta -> riga di atleti_societa). Usata da Rosa e Atleti.
function classificaFitet(affiliazioni, S, stagione) {
    const classifica = new Map();
    for (const af of affiliazioni) {
        if (af.stagione !== stagione || federazione(S.get(af.societa_uid)?.tipo) !== 'FITET') continue;
        if (af.categoria_fitet == null && af.punti_fitet == null) continue;
        const prima = classifica.get(af.atleta_uid);
        if (!prima || (af.punti_fitet ?? 0) > (prima.punti_fitet ?? 0)) classifica.set(af.atleta_uid, af);
    }
    return classifica;
}
const nomeAtleta = a => a ? `${a.cognome} ${a.nome}` : '';

// Numero (codice) della societa' nella sua federazione: FITET = codice_fitet
// (es. "2538"); CSI = codice_csi (es. "02400002", il "Codice societa'" del
// sito CSI). Le societa' CSI nate dall'import dei tesserati lo hanno ancora
// in codice_fitet: si guarda anche li'.
function codiceSocieta(s) {
    if (!s) return '';
    return (federazione(s.tipo) === 'CSI' ? (s.codice_csi || s.codice_fitet) : s.codice_fitet) || '';
}

// Stessa etichetta di Partita.EtichettaOrdine sul PC
function etichettaPartita(p) {
    if (p.tipo === 'Doppio') return 'Doppio';
    if (!p.posto_abc || !p.posto_xyz)
        return { 1: 'A - X', 2: 'B - Y', 3: 'C - Z', 4: 'Doppio', 5: 'B - X', 6: 'A - Z', 7: 'C - Y' }[p.ordine] || `Partita ${p.ordine}`;
    return `${{ A: 'A', B: 'B', C: 'C' }[p.posto_abc] || 'D'} - ${{ A: 'X', B: 'Y', C: 'Z' }[p.posto_xyz] || 'D'}`;
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
    mostra('home');
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
        // Sempre una risposta visibile: senza, non si capisce se il pulsante ha fatto qualcosa
        $('#acSync').onclick = async () => {
            await Sync.esegui();
            viste.account.init();
            const riuscita = Sync.stato === 'ok';
            avviso(riuscita ? 'Sincronizzazione riuscita ✓'
                : Sync.stato === 'offline' ? 'Niente rete: sincronizzazione non riuscita'
                : 'Sincronizzazione non riuscita' + (Sync.messaggio ? ': ' + Sync.messaggio : ''), riuscita);
        };
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
    disegnaNav();
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
