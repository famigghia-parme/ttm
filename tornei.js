// TennisTavoloManager - tornei.js  (PWA cloud)
// Sezione "Tornei": il calendario dei tornei individuali. I tornei li
// scarica il PC dal sito della federazione e li manda al cloud; il telefono
// li tiene in copia (sync.js: pullElenco, voce 'tornei' di meta) e li mostra
// anche senza rete. Qui si leggono soltanto.
// Il disegno (trDisegna) sta in comune.js, uguale nella PWA in rete locale
// (TennisTavoloManager/wwwroot/tornei.js, che chiede l'elenco al PC).

// Dalla riga del cloud al torneo come lo vuole trDisegna
async function trDati() {
    return (await metaLeggi('tornei', [])).filter(r => !r.eliminato).map(r => ({
        id: r.uid,
        federazione: r.federazione,
        regione: r.regione,
        tipo: r.tipo,
        nome: r.nome,
        localita: r.localita,
        inizio: String(r.data_inizio || '').slice(0, 10),
        fine: r.data_fine ? String(r.data_fine).slice(0, 10) : null,
        gare: String(r.gare || '').split('\n').map(g => g.trim()).filter(Boolean),
        km: r.distanza_km ?? null,          // in linea d'aria dal nostro campo di gara (lo calcola il PC)
        url: r.url,
        programma: r.url_programma
    }));
}

if (typeof viste !== 'undefined') viste.tornei = {
    html: '<div id="trCorpo"></div>',
    init: async () => {
        const c = $('#trCorpo');
        if (!c) return;
        const tornei = await trDati();
        if ($('#trCorpo') === c) trDisegna(c, tornei);
    },
    // Dati nuovi dal cloud: si ridisegna solo se sono cambiati i tornei
    suDati: () => viste.tornei.init()
};
