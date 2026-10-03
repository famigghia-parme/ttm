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
function rfDaIncontro(i) {
    return {
        luogo: i.luogo || '', tavolo: i.tavolo || '', palline: i.palline || '',
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

    // Proposta per l'impianto: l'ultima gara in casa della stessa squadra che
    // ha questi dati (come DatabaseService.GetDatiCampoPrecedentiAsync)
    const prec = tuttiInc
        .filter(x => x.squadra_casa_uid === inc.squadra_casa_uid && x.uid !== uid &&
            (x.tavolo || x.palline || x.operatore_dae || x.defibrillatore != null))
        .sort((a, b) => String(b.data_ora || '').localeCompare(String(a.data_ora || '')))[0];

    const prima = rfDaIncontro(inc), d = { ...prima };
    const proposto = rfProponi(d, prec && rfDaIncontro(prec));
    rf = { uid, casa: casa?.nome, ospite: ospite?.nome, prima, d, proposto };
    rfModificata = false;
    rfDisegnaPagina(rf, () => { rfModificata = true; msg(''); }, rfIndietro, rfSalva);
}

function rfIndietro() {
    if (rfModificata && !confirm('Dati del referto modificati e non salvati. Uscire lo stesso?')) return;
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
