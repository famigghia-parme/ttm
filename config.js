// TennisTavoloManager - config.js  (PWA cloud)
// DA COMPILARE una volta con i dati di Supabase (pulsante Connect / Settings > API Keys).
// La publishable key e' pubblica per costruzione: la sicurezza la fanno login + RLS.
// ATTENZIONE: dopo ogni modifica di questo file aumentare VERSIONE in sw.js
// e il ?v= in index.html, altrimenti i telefoni tengono la copia vecchia.
const CONFIG = {
    SUPABASE_URL: 'https://gngoyidriidkqexsigug.supabase.co',
    SUPABASE_KEY: 'sb_publishable_aQa5bErHOLEkXmTVjtfhgQ_bWptJ1D5',

    // Vuoto = la stagione piu' recente fra i campionati attivi.
    // Da forzare (es. '2026/27') solo se quella dedotta non e' giusta.
    STAGIONE: '',

    // Massimo in rosa: lo stesso di config.json sul PC. 0 = nessun massimo.
    // Il minimo dipende dalla formula del campionato (minimoRosa in store.js).
    ROSA: {
        FITET: { max: 0 },
        CSI: { max: 0 }
    }
};
