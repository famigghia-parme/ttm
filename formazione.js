// TennisTavoloManager - formazione.js  (PWA cloud)
// Formazione di un incontro dal telefono, sui dati locali: funziona anche
// senza rete, il salvataggio va in outbox e parte al cloud appena possibile.
// Si apre dalla scheda dell'incontro (incontri.js) e disegna dentro #inCorpo.
//
// Stesse regole del PC (DatabaseService.SalvaFormazioneAsync + ApiFormazione):
//  - candidati = rosa della squadra nella stagione del campionato; se la rosa
//    e' vuota, i tesserati-atleti della societa'. Chi e' gia' schierato resta
//    nell'elenco anche se nel frattempo e' uscito dalla rosa;
//  - (10/10) fra i candidati solo atleti "in quadro" FITET (comune.js): chi
//    non lo e' non si puo' schierare; se e' gia' schierato resta, con
//    "(non in quadro)" accanto al nome. Lo staff non si filtra;
//  - nessun atleta in due posti; il doppio solo fra gli schierati;
//  - posti vuoti = avviso, si puo' salvare lo stesso;
//  - staff a referto: capitano, allenatore, dirigente e medico (i primi due
//    dal 02/10, gli altri dal 03/10; elenco RUOLI_STAFF in comune.js). Per
//    ognuno un tesserato della societa' (rosa o altri tesserati, come sul
//    PC) oppure un nome scritto a mano; puo' essere anche uno che gioca;
//  - la formazione si RIVERSA sulle partite non ancora iniziate: posto_abc e
//    posto_xyz sono posizionali e si traducono in atleti passando per la
//    squadra che ha scelto le lettere ABC, che non e' per forza quella di
//    casa. "Iniziata" = completata o con almeno un punto giocato (in_corso
//    da solo NON basta: diventa vero appena si apre il Live).
//
// Differenze volute rispetto al PC:
//  - "Salva" scrive ENTRAMBE le squadre (le due schede sono un solo foglio);
//  - le righe di formazione si aggiornano sul posto (stesso uid) invece di
//    cancellarle e ricrearle: nel cloud c'e' un indice univoco su
//    (incontro, squadra, ruolo) e cosi' il push non lo viola mai. Una riga
//    tolta diventa eliminata e si riusa se il posto torna occupato.

let fz = null;             // incontro aperto in modifica (vedi fzApri)
let fzModificata = false;
// Dove tornare uscendo o dopo il salvataggio, se non alla scheda: lo usa
// la vista Punti (live.js) quando manda qui a dichiarare il doppio.
let fzRitorno = null;

// RUOLI_TITOLARI, RUOLI_RISERVE, RUOLI_STAFF e le tendine (fzOpzioni,
// fzHtmlStaff, fzAgganciaStaff) stanno in comune.js: sono gli stessi della
// PWA in rete locale. Un atleta nelle tendine e' { id, nome }: qui id = uid.

// "20:30:00" del cloud <-> "20:30" di <input type="time">
const fzOraCampo = v => v ? String(v).slice(0, 5) : '';
const fzOraCloud = v => v ? v.slice(0, 5) + ':00' : null;

// daSync = ricarica per dati nuovi dal cloud: se durante la lettura
// (asincrona) l'utente ha cambiato qualcosa, si abbandona per non
// cancellare la modifica.
async function fzApri(uidIncontro, uidSquadra, daSync = false) {
    const inc = await leggi('incontri', uidIncontro);
    if (!inc || inc.eliminato) { fz = null; fzRitorno = null; inElenco(); return; }
    const giornata = await leggi('giornate', inc.giornata_uid);
    const camp = giornata && await leggi('campionati', giornata.campionato_uid);
    const casa = await leggi('squadre', inc.squadra_casa_uid);
    const ospite = await leggi('squadre', inc.squadra_ospite_uid);
    // Incontro chiuso (anche da un altro dispositivo): si torna alla scheda.
    if (!camp || !casa || !ospite || inc.stato === 'Terminato') { fz = null; fzModificata = false; fzRitorno = null; inScheda(uidIncontro); return; }

    const formula = formulaDi(camp.formula);
    const titolari = RUOLI_TITOLARI.slice(0, formula.titolari);
    const riserve = RUOLI_RISERVE.slice(0, formula.riserve);
    const ruoli = [...titolari, ...riserve];

    // Partite non ancora create (incontro mai aperto sul PC): si creano qui,
    // altrimenti il doppio non si potrebbe dichiarare. Non su una ricarica
    // da sync: li' si guarda soltanto.
    const [righe, partite, atleti] = await Promise.all([
        perIndice('formazioni', 'incontro_uid', uidIncontro),
        daSync ? perIndice('partite', 'incontro_uid', uidIncontro) : assicuraPartite(uidIncontro),
        tutti('atleti')]);
    const A = perUid(atleti);
    const doppio = partite.find(p => p.tipo === 'Doppio');

    const squadra = async (sq, inCasa) => {
        const posti = {};
        for (const r of righe)
            if (r.squadra_uid === sq.uid && ruoli.includes(r.ruolo) && r.atleta_uid) posti[r.ruolo] = r.atleta_uid;

        // Candidati: rosa della stagione, altrimenti tesserati-atleti della societa'
        let uid = (await perIndice('atleti_squadre', 'squadra_uid', sq.uid))
            .filter(r => r.stagione === camp.stagione).map(r => r.atleta_uid);
        if (!uid.length)
            uid = (await perIndice('atleti_societa', 'societa_uid', sq.societa_uid))
                .filter(a => a.stagione === camp.stagione && (a.ruoli & 1)).map(a => a.atleta_uid);
        // Tesserati della societa' nella stagione: servono anche allo staff
        const tesserati = (await perIndice('atleti_societa', 'societa_uid', sq.societa_uid))
            .filter(a => a.stagione === camp.stagione);
        // Non in quadro FITET: fuori dai candidati, a meno che siano gia' schierati
        const nonQuadro = fuoriQuadro(tesserati, sq.societa_uid, camp.stagione);
        const schierati = new Set(Object.values(posti));
        uid = uid.filter(u => inQuadroProponibile(u, nonQuadro, schierati));

        // segna = accanto al nome "(non in quadro)": solo per chi gioca
        const voci = (lista, segna = false) => [...new Set(lista)].map(u => A.get(u)).filter(Boolean)
            .map(a => ({ id: a.uid, nome: nomeInQuadro(nomeAtleta(a), segna && nonQuadro.has(a.uid)) }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
        const candidati = voci([...uid, ...schierati], true);

        // Staff: valore attuale (tesserato o nome libero) e, oltre alla rosa,
        // gli altri tesserati della societa' nella stagione (dirigenti, tecnici,
        // atleti di altre squadre), come nel dialog del PC.
        const staff = {};
        for (const ruolo of RUOLI_STAFF) {
            const r = righe.find(x => x.squadra_uid === sq.uid && x.ruolo === ruolo);
            staff[ruolo] = { id: r?.atleta_uid || null, nome: r?.atleta_uid ? '' : (r?.nome_libero || '') };
        }
        const inRosa = new Set(candidati.map(a => a.id));
        const altri = voci([
            ...tesserati.map(a => a.atleta_uid),
            ...RUOLI_STAFF.map(r => staff[r].id).filter(Boolean)
        ]).filter(a => !inRosa.has(a.id));

        return {
            uid: sq.uid, nome: sq.nome, nostra: !!sq.nostra_squadra, societa: sq.societa_uid, inCasa,
            candidati, posti, staff, altri,
            doppio: inCasa ? [doppio?.atleta_casa1_uid || null, doppio?.atleta_casa2_uid || null]
                : [doppio?.atleta_ospite1_uid || null, doppio?.atleta_ospite2_uid || null],
            // maglia non ancora scritta sull'incontro: si propone quella della
            // scheda della squadra (OSquadra in pdf.js); si salva con "Salva"
            colore: (inCasa ? OSquadra.magliaCasa(inc, sq) : OSquadra.magliaOspite(inc, sq)) || '',
            ora: fzOraCampo(inCasa ? inc.ora_presentazione_casa : inc.ora_presentazione_ospite)
        };
    };

    const squadre = [await squadra(casa, true), await squadra(ospite, false)];
    if (daSync && (fzModificata || fz?.uid !== uidIncontro)) return;
    fz = {
        uid: uidIncontro, stagione: camp.stagione, formula, nomeFormula: camp.formula,
        titolari, riserve, ruoli,
        haDoppio: !!doppio, doppioLibero: !!doppio && formula.doppio === 'libero',
        abc: inc.squadra_lettere_abc_uid === ospite.uid ? ospite.uid : casa.uid,   // predefinito: casa
        squadre,
        // di solito si compila la nostra
        sel: squadre.find(s => s.uid === uidSquadra)?.uid || (squadre.find(s => s.nostra) || squadre[0]).uid
    };
    fzModificata = false;
    fzDisegna();
}

const fzSquadra = () => fz.squadre.find(s => s.uid === fz.sel);

// A/B/C per chi ha scelto le lettere, X/Y/Z per l'altra squadra
function fzEtichetta(ruolo, abc) {
    if (ruolo.length === 1) return abc ? ruolo : { A: 'X', B: 'Y', C: 'Z' }[ruolo];
    return ruolo.replace('Riserva', 'Riserva ');
}

// Il doppio si sceglie solo fra gli schierati (art. 27 comma 7)
function fzSchierati(sq) {
    const uid = fz.ruoli.map(r => sq.posti[r]).filter(Boolean);
    return sq.candidati.filter(a => uid.includes(a.id));
}

function fzDisegna() {
    const c = $('#inCorpo');
    if (!c || !fz) return;
    const sq = fzSquadra();
    const abc = fz.abc === sq.uid;
    const doppio = fz.doppioLibero;
    const riga = r => `<label class="fzRiga"><span>${fzEtichetta(r, abc)}</span>
      <select data-ruolo="${r}">${fzOpzioni(sq.candidati, sq.posti[r] || null)}</select></label>`;

    c.innerHTML = `
    <button class="pieno chiaro" id="fzIndietro">${fzRitorno ? '← Torna ai punti' : '← Incontro'}</button>
    <div class="tabs">${fz.squadre.map(s =>
        `<button data-sq="${s.uid}" class="${s.uid === fz.sel ? 'att' : ''}">${esc(s.nome)}</button>`).join('')}</div>
    <label class="fzRiga"><span>Lettere ABC</span>
      <select id="fzAbc">${fz.squadre.map(s =>
            `<option value="${s.uid}"${s.uid === fz.abc ? ' selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label>
    <label class="fzRiga"><span>Maglia</span>
      <input id="fzColore" maxlength="40" placeholder="colore maglia" value="${esc(sq.colore)}"></label>
    <label class="fzRiga"><span>In campo</span>
      <input id="fzOra" type="time" value="${esc(sq.ora)}"></label>
    ${sq.candidati.length ? '' : '<div class="avviso">Nessun atleta per questa squadra: mettili in rosa (scheda Rosa) o in anagrafica (scheda Atleti).</div>'}
    <h4>Titolari</h4>${fz.titolari.map(riga).join('')}
    ${fz.riserve.length ? '<h4>Riserve</h4>' + fz.riserve.map(riga).join('') : ''}
    ${doppio ? `<h4>Doppio</h4>
      <label class="fzRiga"><span>1°</span><select id="fzD1"></select></label>
      <label class="fzRiga"><span>2°</span><select id="fzD2"></select></label>` : ''}
    ${fzHtmlStaff(sq.candidati, sq.altri, sq.staff)}
    <div id="msg"></div>
    <button class="pieno" id="fzSalva">Salva formazione</button>
    <div class="lvInfo">Salva le due squadre insieme.</div>`;

    const aggiornaDoppio = () => {
        if (!doppio) return;
        const sch = fzSchierati(sq);
        // chi esce dalla formazione esce anche dal doppio
        sq.doppio = sq.doppio.map(u => sch.some(a => a.id === u) ? u : null);
        $('#fzD1').innerHTML = fzOpzioni(sch, sq.doppio[0]);
        $('#fzD2').innerHTML = fzOpzioni(sch, sq.doppio[1]);
    };
    aggiornaDoppio();

    // Ogni modifica va subito nel modello: cambiando scheda non si perde nulla.
    const toccata = () => { fzModificata = true; msg(''); };
    c.querySelectorAll('select[data-ruolo]').forEach(s => s.onchange = () => {
        sq.posti[s.dataset.ruolo] = s.value || null;
        toccata(); aggiornaDoppio();
    });
    if (doppio) {
        $('#fzD1').onchange = e => { sq.doppio[0] = e.target.value || null; toccata(); };
        $('#fzD2').onchange = e => { sq.doppio[1] = e.target.value || null; toccata(); };
    }
    // Staff: tesserato dalla tendina, oppure "scrivi il nome" + casella
    fzAgganciaStaff(c, sq.staff, toccata);
    $('#fzColore').oninput = e => { sq.colore = e.target.value; toccata(); };
    $('#fzOra').oninput = e => { sq.ora = e.target.value; toccata(); };      // "hh:mm" oppure ""
    $('#fzAbc').onchange = e => { fz.abc = e.target.value; fzModificata = true; fzDisegna(); };
    c.querySelectorAll('.tabs button[data-sq]').forEach(b =>
        b.onclick = () => { fz.sel = b.dataset.sq; fzDisegna(); });
    $('#fzIndietro').onclick = async () => {
        if (fzModificata && !await conferma('Formazione modificata e non salvata. Uscire lo stesso?', 'Attenzione')) return;
        const uid = fz.uid, ritorno = fzRitorno;
        fz = null; fzModificata = false; fzRitorno = null;
        if (ritorno) ritorno(); else inScheda(uid);
    };
    $('#fzSalva').onclick = fzSalva;
}

// Controlli che BLOCCANO il salvataggio. Ritorna il messaggio o null.
function fzErrore() {
    for (const sq of fz.squadre) {
        const uid = fz.ruoli.map(r => sq.posti[r]).filter(Boolean);
        if (new Set(uid).size !== uid.length)
            return `${sq.nome}: lo stesso atleta è assegnato a due posti.`;
        if (fz.doppioLibero) {
            const [d1, d2] = sq.doppio;
            if (d1 && d1 === d2) return `${sq.nome}: il doppio richiede due atleti diversi.`;
            if ((d1 && !uid.includes(d1)) || (d2 && !uid.includes(d2)))
                return `${sq.nome}: il doppio va scelto fra titolari e riserve schierati.`;
        }
        if (sq.colore.trim().length > 40) return `${sq.nome}: colore maglia troppo lungo (max 40 caratteri).`;
    }
    return null;
}

async function fzSalva() {
    const err = fzErrore();
    if (err) { msg(err); return; }

    // Lo stato si rilegge: l'incontro puo' essere stato chiuso da un altro dispositivo.
    const inc = await leggi('incontri', fz.uid);
    if (!inc || inc.stato === 'Terminato') { msg('Incontro terminato: formazione non più modificabile.'); return; }

    // Avvisi "soft" come sul PC (solo titolari): si puo' salvare comunque.
    // L'altra squadra si segnala solo se e' stata iniziata. Il doppio NON si
    // segnala: si puo' dichiarare fino a un attimo prima di giocarlo.
    const avvisi = [];
    for (const sq of fz.squadre) {
        const mancanti = fz.titolari.filter(r => !sq.posti[r]);
        const iniziata = fz.ruoli.some(r => sq.posti[r]);
        if (mancanti.length && (sq.uid === fz.sel || iniziata))
            avvisi.push(`${sq.nome}: mancano ${mancanti.map(r => fzEtichetta(r, fz.abc === sq.uid)).join(', ')}`);
    }
    if (avvisi.length && !await conferma('Formazione incompleta.\n' + avvisi.join('\n') + '\nSalvare comunque?', 'Attenzione')) return;

    $('#fzSalva').disabled = true;
    try {
        const scritture = [];
        const [casa, ospite] = fz.squadre;

        // ---- 1) incontro: lettere ABC, maglie, orari (solo se cambiati) ----
        const nuovo = {
            squadra_lettere_abc_uid: fz.abc,
            colore_maglia_casa: casa.colore.trim() || null,
            colore_maglia_ospite: ospite.colore.trim() || null,
            ora_presentazione_casa: fzOraCloud(casa.ora),
            ora_presentazione_ospite: fzOraCloud(ospite.ora)
        };
        const uguale = (c, v) => c.startsWith('ora_') ? fzOraCampo(inc[c]) === fzOraCampo(v) : (inc[c] ?? null) === v;
        if (Object.entries(nuovo).some(([c, v]) => !uguale(c, v)))
            scritture.push({ t: 'incontri', riga: { ...inc, ...nuovo } });

        // ---- 2) righe di formazione, anche quelle eliminate: si riusano ----
        const db = await apriDb();
        const tutteRighe = await idbReq(db.transaction('formazioni').objectStore('formazioni')
            .index('incontro_uid').getAll(fz.uid));
        for (const sq of fz.squadre) {
            const tessere = new Map((await perIndice('atleti_societa', 'societa_uid', sq.societa))
                .filter(a => a.stagione === fz.stagione).map(a => [a.atleta_uid, a.tessera]));
            const righeSq = tutteRighe.filter(r => r.squadra_uid === sq.uid);
            for (const ruolo of fz.ruoli) {
                const sue = righeSq.filter(r => r.ruolo === ruolo);
                const vive = sue.filter(r => !r.eliminato);
                const voluto = sq.posti[ruolo] || null;
                if (!voluto) {
                    for (const r of vive) scritture.push({ t: 'formazioni', riga: { ...r, eliminato: true } });
                    continue;
                }
                // Tessera della stagione; se manca, quella gia' scritta per lo stesso atleta
                const tessera = tessere.get(voluto) || righeSq.find(r => r.atleta_uid === voluto)?.tessera || null;
                const cambio = { atleta_uid: voluto, nome_libero: null, tessera,
                    sostituito_da_atleta_uid: null, sostituito_dopo_ordine: null, eliminato: false };
                if (vive.length) {
                    // stesso atleta: la riga resta com'e' (anche l'eventuale sostituzione)
                    if (vive[0].atleta_uid !== voluto) scritture.push({ t: 'formazioni', riga: { ...vive[0], ...cambio } });
                    // ... ma se era rimasta SENZA tessera e ora il numero c'e'
                    // (inserito dopo aver fatto la formazione) lo prende adesso.
                    // (04/10) Prima restava vuota per sempre. Una tessera gia'
                    // scritta, anche a mano dal PC, non si tocca.
                    else if (!vive[0].tessera && tessera) scritture.push({ t: 'formazioni', riga: { ...vive[0], tessera } });
                    for (const r of vive.slice(1)) scritture.push({ t: 'formazioni', riga: { ...r, eliminato: true } });
                } else if (sue.length) {
                    scritture.push({ t: 'formazioni', riga: { ...sue[0], ...cambio } });      // posto di nuovo occupato
                } else {
                    scritture.push({ t: 'formazioni', riga: {
                        incontro_uid: fz.uid, squadra_uid: sq.uid, ruolo, atleta_uid: voluto, tessera } });
                }
            }

            // Staff (capitano, allenatore, dirigente, medico): tesserato
            // (atleta_uid) o nome libero. Stesso criterio: riga aggiornata
            // sul posto, tolta = eliminata.
            for (const ruolo of RUOLI_STAFF) {
                const st = sq.staff[ruolo];
                const nome = st.id ? null : (st.nome.trim().slice(0, 80) || null);
                const sue = righeSq.filter(r => r.ruolo === ruolo);
                const vive = sue.filter(r => !r.eliminato);
                if (!st.id && !nome) {
                    for (const r of vive) scritture.push({ t: 'formazioni', riga: { ...r, eliminato: true } });
                    continue;
                }
                const stesso = r => (r.atleta_uid || null) === (st.id || null) && (r.nome_libero || null) === nome;
                // Tessera: del tesserato scelto; un nome libero non ne ha (si mette dal PC)
                const cambio = { atleta_uid: st.id || null, nome_libero: nome,
                    tessera: st.id ? (tessere.get(st.id) || null) : null, eliminato: false };
                if (vive.length) {
                    if (!stesso(vive[0])) scritture.push({ t: 'formazioni', riga: { ...vive[0], ...cambio } });
                    // stessa persona rimasta senza tessera: la prende adesso (come sopra)
                    else if (!vive[0].tessera && cambio.tessera) scritture.push({ t: 'formazioni', riga: { ...vive[0], tessera: cambio.tessera } });
                    for (const r of vive.slice(1)) scritture.push({ t: 'formazioni', riga: { ...r, eliminato: true } });
                } else if (sue.length) {
                    scritture.push({ t: 'formazioni', riga: { ...sue[0], ...cambio } });
                } else {
                    scritture.push({ t: 'formazioni', riga: {
                        incontro_uid: fz.uid, squadra_uid: sq.uid, ruolo,
                        atleta_uid: cambio.atleta_uid, nome_libero: nome, tessera: cambio.tessera } });
                }
            }
        }

        // ---- 3) riversamento sulle partite non ancora iniziate ----
        // Singolari e doppio fissato dalla formula (Olimpica): dai posti, con
        // atletiDaFormazione (store.js). Doppio libero: la coppia scelta qui.
        const posti = Object.fromEntries(fz.squadre.map(s => [s.uid, s.posti]));
        const incNuovo = { ...inc, squadra_lettere_abc_uid: fz.abc };
        for (const p of await perIndice('partite', 'incontro_uid', fz.uid)) {
            const set = await perIndice('sets', 'partita_uid', p.uid);
            if (p.completata || set.some(s => s.punti_casa > 0 || s.punti_ospite > 0)) continue;

            const dopo = p.tipo === 'Doppio' && fz.doppioLibero
                ? { atleta_casa1_uid: casa.doppio[0] || null, atleta_casa2_uid: casa.doppio[1] || null,
                    atleta_ospite1_uid: ospite.doppio[0] || null, atleta_ospite2_uid: ospite.doppio[1] || null }
                : atletiDaFormazione(p, incNuovo, fz.formula, posti);
            if (!dopo) continue;
            if (Object.entries(dopo).some(([k, v]) => (p[k] ?? null) !== v))
                scritture.push({ t: 'partite', riga: { ...p, ...dopo } });
        }

        // Tutto in una transazione: o passa tutto o niente.
        if (scritture.length) await scriviLocale(scritture);
        const conferma = navigator.onLine ? 'Salvata ✓' : 'Salvata sul telefono ✓ — parte al cloud appena c\'è rete';
        // Arrivati qui dai Punti (doppio da dichiarare): salvato, si torna la'.
        if (fzRitorno) {
            const ritorno = fzRitorno;
            fz = null; fzModificata = false; fzRitorno = null;
            await ritorno();
            avviso(conferma, true);
            return;
        }
        const sel = fz.sel;
        await fzApri(fz.uid, sel);
        msg(conferma, true);
    } catch (e) {
        console.error(e);
        msg('Errore nel salvataggio: ' + (e.message || e));
    } finally { const b = $('#fzSalva'); if (b) b.disabled = false; }
}
