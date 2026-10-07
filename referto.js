// TennisTavoloManager - referto.js  (PWA cloud)
// Dati del referto di un incontro dal telefono (impianto, giudice arbitro,
// defibrillatore, orari, provvedimenti): gli stessi del dialog "Dati
// referto" del PC. Si apre dalla scheda dell'incontro (incontri.js) e
// disegna dentro #inCorpo. Lavora sui dati locali: funziona anche senza
// rete, il salvataggio va in outbox.
// Modulo e riepilogo stanno in comune.js (rfHtmlModulo, rfHtmlRiepilogo...):
// sono gli stessi della PWA in rete locale (wwwroot/referto.js).
//
// Sono campi di GARA dell'incontro (GARA_INCONTRO in store.js): al cloud
// vanno solo quelli cambiati, quindi si possono compilare da un telefono
// mentre un altro segna i punti.

let rf = null;             // incontro aperto: { uid, casa, ospite, prima, d, proposto }
let rfModificata = false;

// Riga del database locale -> dati del referto nella forma di comune.js.
// fzOraCampo / fzOraCloud ("20:30:00" <-> "20:30") stanno in formazione.js.
// casa = riga della squadra di casa. Il campo di gara e' sempre "dell'incontro
// oppure della scheda della squadra" (OSquadra in pdf.js): qui si legge
// soltanto. Tavolo e palline lo sono solo con conScheda (il riepilogo: e'
// cio' che va sul PDF); nel modulo no, li' la scheda e' una PROPOSTA che si
// salva con "Salva" (rfApri).
function rfDaIncontro(i, casa = null, conScheda = true) {
    return {
        luogo: OSquadra.luogo(i, casa) || '',
        tavolo: (conScheda ? OSquadra.tavolo(i, casa) : i.tavolo) || '',
        palline: (conScheda ? OSquadra.palline(i, casa) : i.palline) || '',
        giudiceArbitro: i.giudice_arbitro || '', qualificaArbitro: i.qualifica_arbitro || '',
        defibrillatore: i.defibrillatore ?? null, operatoreDae: i.operatore_dae || '',
        oraInizio: fzOraCampo(i.ora_inizio), oraFine: fzOraCampo(i.ora_fine),
        provvedimenti: i.provvedimenti_disciplinari || ''
    };
}

// Nome del campo nel modulo -> colonna dell'incontro e valore da scriverci
const RF_COLONNE = {
    tavolo: ['tavolo', v => v || null], palline: ['palline', v => v || null],
    giudiceArbitro: ['giudice_arbitro', v => v || null], qualificaArbitro: ['qualifica_arbitro', v => v || null],
    defibrillatore: ['defibrillatore', v => v], operatoreDae: ['operatore_dae', v => v || null],
    oraInizio: ['ora_inizio', fzOraCloud], oraFine: ['ora_fine', fzOraCloud],
    provvedimenti: ['provvedimenti_disciplinari', v => v || null]
};

// daSync = ricarica per dati nuovi dal cloud: se intanto l'utente ha scritto
// qualcosa si lascia tutto com'e'.
async function rfApri(uid, daSync = false) {
    const inc = await leggi('incontri', uid);
    if (!inc || inc.eliminato) { rf = null; rfModificata = false; inElenco(); return; }
    const [casa, ospite, tuttiInc] = await Promise.all([
        leggi('squadre', inc.squadra_casa_uid), leggi('squadre', inc.squadra_ospite_uid), tutti('incontri')]);
    if (daSync && (rfModificata || rf?.uid !== uid)) return;

    // Proposta per l'impianto: tavolo e palline della scheda della squadra di
    // casa; cio' che li' manca, e defibrillatore e operatore, dall'ultima gara
    // in casa della stessa squadra che ha questi dati (come sul PC: GET
    // /api/incontri/{id}/referto e DatabaseService.GetDatiCampoPrecedentiAsync)
    const prec = tuttiInc
        .filter(x => x.squadra_casa_uid === inc.squadra_casa_uid && x.uid !== uid &&
            (x.tavolo || x.palline || x.operatore_dae || x.defibrillatore != null))
        .sort((a, b) => String(b.data_ora || '').localeCompare(String(a.data_ora || '')))[0];

    const prima = rfDaIncontro(inc, casa, false), d = { ...prima };
    const daGara = prec ? rfDaIncontro(prec) : {};
    const proposto = rfProponi(d, {
        ...daGara,
        tavolo: OSquadra.tavolo({}, casa) || daGara.tavolo,
        palline: OSquadra.palline({}, casa) || daGara.palline
    });
    rf = { uid, casa: casa?.nome, ospite: ospite?.nome, prima, d, proposto };
    rfModificata = false;
    rfDisegnaPagina(rf, () => { rfModificata = true; msg(''); }, rfIndietro, rfSalva);
}

async function rfIndietro() {
    if (rfModificata && !await conferma('Dati del referto modificati e non salvati. Uscire lo stesso?', 'Attenzione')) return;
    const uid = rf.uid;
    rf = null; rfModificata = false;
    inScheda(uid);
}

async function rfSalva() {
    const cambiati = rfCambiati(rf.prima, rfLeggiModulo());
    const uid = rf.uid;
    if (!Object.keys(cambiati).length) {
        rf = null; rfModificata = false;
        await inScheda(uid);
        avviso('Nessuna modifica da salvare', true);
        return;
    }
    $('#rfSalva').disabled = true;
    try {
        // L'incontro si rilegge adesso: punteggio e stato possono essere
        // cambiati mentre il modulo era aperto.
        const inc = await leggi('incontri', uid);
        if (!inc || inc.eliminato) { msg('Incontro non più presente.'); return; }
        for (const [campo, v] of Object.entries(cambiati)) {
            const [colonna, valore] = RF_COLONNE[campo];
            inc[colonna] = valore(v);
        }
        await scriviLocale([{ t: 'incontri', riga: inc }]);
        rf = null; rfModificata = false;
        await inScheda(uid);
        avviso('Dati del referto salvati ✓', true);
    } catch (e) {
        msg('Salvataggio non riuscito: ' + (e.message || e));
    } finally { const b = $('#rfSalva'); if (b) b.disabled = false; }
}
