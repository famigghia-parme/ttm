// TennisTavoloManager - ranking.js  (PWA cloud)
// Sezione "Classifica atleti" (10/10, versione 1.1.0): chi sale e chi scende
// fra i nostri atleti FITET nella classifica individuale ufficiale.
// Le classifiche le scarica il PC dal portale FITET ("Classifica atleti" ->
// "Scarica dal sito FITET") e le manda al cloud (tabella classifiche_atleti);
// il telefono le tiene in copia (sync.js: pullElenco, voce
// 'classifiche_atleti' di meta) e le mostra anche senza rete. Qui si
// leggono soltanto.
// I conti (caCalcola) e il disegno (caDisegna) stanno in comune.js, uguali
// nella PWA in rete locale (TennisTavoloManager/wwwroot/ranking.js, che
// chiede gli atleti al PC).

// I nostri atleti FITET col loro storico, come li vuole caCalcola.
// "Nostri" = stessa regola del PC (DatabaseService.GetNostriAtletiFitetAsync):
// tesserati con ruolo Atleta, nella stagione, di una societa' FITET
// dichiarata NOSTRA (societa.nostra, pannello Societa' del PC), attivi.
// "squadre" = i campionati FITET delle squadre in cui l'atleta e' in rosa in
// questa stagione ("D3", "C2 / D1"). Le squadre CSI non si contano: la
// classifica e' della FITET.
async function caAtleti() {
    const stag = await stagioneCorrente();
    const [societa, atleti, affiliazioni, squadre, campionati, rose] =
        await Promise.all(['societa', 'atleti', 'atleti_societa', 'squadre', 'campionati', 'atleti_squadre'].map(tutti));
    const classifiche = (await metaLeggi('classifiche_atleti', [])).filter(r => !r.eliminato);

    const nostre = new Set(societa.filter(s => s.nostra && federazione(s.tipo) === 'FITET').map(s => s.uid));
    const A = perUid(atleti), Sq = perUid(squadre), C = perUid(campionati);

    const campionatiDi = new Map();          // uid atleta -> Set di nomi di campionato
    for (const r of rose) {
        if (r.stagione !== stag) continue;
        const camp = C.get(Sq.get(r.squadra_uid)?.campionato_uid);
        const nome = String(camp?.nome || '').trim();
        if (!nome || federazione(camp.tipo) !== 'FITET') continue;
        if (!campionatiDi.has(r.atleta_uid)) campionatiDi.set(r.atleta_uid, new Set());
        campionatiDi.get(r.atleta_uid).add(nome);
    }
    const storicoDi = new Map();             // uid atleta -> righe di classifiche_atleti
    for (const c of classifiche) {
        if (!storicoDi.has(c.atleta_uid)) storicoDi.set(c.atleta_uid, []);
        storicoDi.get(c.atleta_uid).push({ data: caData(c.data), posizione: c.posizione ?? null, punti: c.punti ?? null, categoria: c.categoria ?? null });
    }

    const visti = new Set(), elenco = [];
    for (const af of affiliazioni) {
        if (af.stagione !== stag || !nostre.has(af.societa_uid) || !(af.ruoli & 1) || visti.has(af.atleta_uid)) continue;
        const a = A.get(af.atleta_uid);
        if (!a || !a.attivo) continue;
        visti.add(a.uid);
        elenco.push({
            id: a.uid, nome: nomeAtleta(a), sesso: { 1: 'M', 2: 'F' }[a.sesso] || '',
            squadre: [...(campionatiDi.get(a.uid) || [])].sort((x, y) => x.localeCompare(y, 'it')).join(' / '),
            storico: storicoDi.get(a.uid) || []
        });
    }
    return elenco.sort((x, y) => x.nome.localeCompare(y.nome, 'it'));
}

if (typeof viste !== 'undefined') viste.ranking = {
    html: '<div id="caCorpo"></div>',
    init: async () => {
        const c = $('#caCorpo');
        if (!c) return;
        const atleti = await caAtleti();
        if ($('#caCorpo') === c) caDisegna(c, atleti);
    },
    // Dati nuovi dal cloud: si ridisegna solo se e' cambiato qualcosa qui (lo decide caDisegna)
    suDati: () => viste.ranking.init()
};
