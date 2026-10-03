// TennisTavoloManager - config.js  (PWA cloud)
// DA COMPILARE con i dati di Supabase (pulsante Connect / Settings > API Keys),
// UN BLOCCO PER AMBIENTE: 'reale' = i dati veri, 'prova' = per simulare
// incontri (come le due cartelle dati del PC). Un ambiente lasciato con
// INSERISCI non compare. Sul telefono si sceglie al login o da Account; ogni
// ambiente ha il suo accesso e i suoi dati scaricati, separati.
// La publishable key e' pubblica per costruzione: la sicurezza la fanno login + RLS.
// Ogni progetto deve avere la sua etichetta (scriptSql/ambiente_reale.sql o
// ambiente_prova.sql): se non corrisponde il telefono NON sincronizza.
// ATTENZIONE: dopo ogni modifica di questo file aumentare VERSIONE in sw.js
// e il ?v= in index.html, altrimenti i telefoni tengono la copia vecchia.
const CONFIG = {
    AMBIENTI: {
        reale: {	
    SUPABASE_URL: 'https://kednlvkalkldkoctgnyw.supabase.co',
    SUPABASE_KEY: 'sb_publishable_tQmct8qCh38L92ljDK6ngg_0qYj7UM1'
        },
        prova: {
    SUPABASE_URL: 'https://gngoyidriidkqexsigug.supabase.co',
    SUPABASE_KEY: 'sb_publishable_aQa5bErHOLEkXmTVjtfhgQ_bWptJ1D5'
        }
    },

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
