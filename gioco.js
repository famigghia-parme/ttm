// TennisTavoloManager - gioco.js  (PWA cloud)
// Regole del set e della partita: le STESSE funzioni di SetService.cs del
// PC, riga per riga (stessi nomi, in minuscolo). Nessun accesso ai dati:
// si provano da sole. Se cambia SetService.cs va cambiato anche qui: il
// confronto, caso per caso, lo fa Tools/TestPwaCloud/test-regole.js su
// regole.json (generato dal C#).

const Gioco = {
    SET_PER_VINCERE: 3,          // al meglio dei 5, come SetService.SetPerVincere

    // 11 con due punti di scarto; dal 10-10 vince chi fa +2
    isSetTerminato(a, b) {
        const max = Math.max(a, b), min = Math.min(a, b);
        if (max < 11) return false;
        if (max === 11 && min <= 9) return true;
        return min >= 10 && max - min >= 2;
    },

    // Turni di servizio gia' completati: 2 punti l'uno fino al 10-10, poi 1
    bloccoServizio(pc, po) {
        const totale = pc + po;
        return (pc >= 10 && po >= 10) ? 10 + (totale - 20) : Math.floor(totale / 2);
    },

    // true = serve la casa. servizioInizioCasa = chi ha servito per primo NEL SET
    calcolaServizio(pc, po, servizioInizioCasa) {
        const totale = pc + po;
        const blocco = (pc >= 10 && po >= 10) ? totale % 2 : Math.floor(totale / 2) % 2;
        return servizioInizioCasa ? blocco === 0 : blocco !== 0;
    },

    // A ogni set il primo servizio passa all'altro (ITTF 2.13.5)
    servizioInizialeCasaDelSet(numeroSet, servizioInizialeCasaSet1) {
        return numeroSet % 2 === 0 ? !servizioInizialeCasaSet1 : servizioInizialeCasaSet1;
    },

    isSetDecisivo(numeroSet) { return numeroSet >= this.SET_PER_VINCERE * 2 - 1; },

    // Set decisivo: cambio campo quando il primo arriva a 5 (ITTF 2.13.4)
    cambioCampoAMetaSetDecisivo(numeroSet, pc, po) {
        return this.isSetDecisivo(numeroSet) && Math.max(pc, po) >= 5;
    },

    // Da che lato sta la casa adesso (vista arbitro)
    casaASinistra(numeroSet, casaASinistraSet1, pc, po) {
        let lato = numeroSet % 2 === 0 ? !casaASinistraSet1 : casaASinistraSet1;
        if (this.cambioCampoAMetaSetDecisivo(numeroSet, pc, po)) lato = !lato;
        return lato;
    },

    // DOPPIO: chi serve e chi riceve fra i quattro (ITTF 2.8.2 / 2.13.4 / 2.13.6).
    // Ritorna { serveCasa, serventeAtleta1, riceventeAtleta1 }.
    ruoliDelPunto(numeroSet, servizioInizialeCasaSet1, aperturaCasa1, aperturaOspite1, pc, po) {
        const casaServePerPrima = this.servizioInizialeCasaDelSet(numeroSet, servizioInizialeCasaSet1);
        let apCasa = aperturaCasa1, apOspite = aperturaOspite1;
        // Set decisivo, prima coppia a 5: la coppia che RICEVE inverte l'ordine
        if (this.cambioCampoAMetaSetDecisivo(numeroSet, pc, po)) {
            if (casaServePerPrima) apOspite = !apOspite; else apCasa = !apCasa;
        }
        // Ciclo di 4 posizioni: 0 = apertura di chi serve per primo nel set,
        // 1 = apertura dell'altra coppia, 2 e 3 = i compagni.
        const posizione = n => {
            const casa = (n % 2 === 0) === casaServePerPrima;
            const apertura = casa ? apCasa : apOspite;
            return { casa, atleta1: n < 2 ? apertura : !apertura };
        };
        const blocco = this.bloccoServizio(pc, po);
        const serve = posizione(blocco % 4), riceve = posizione((blocco + 1) % 4);
        return { serveCasa: serve.casa, serventeAtleta1: serve.atleta1, riceventeAtleta1: riceve.atleta1 };
    },

    isPartitaTerminata(setCasa, setOspite) {
        return setCasa >= this.SET_PER_VINCERE || setOspite >= this.SET_PER_VINCERE;
    },

    // Punti in classifica dal risultato dell'incontro. regola = FORMULE[...].punti:
    //  'standard'   2/0, pareggio 1/1 (FormulaGioco.PuntiStandard)
    //  'miniDoppio' 3/0 con 5+ partite vinte, 2/1 con 4-3 (PuntiMiniSwaythlingDoppio)
    //  'vinte'      partite vinte, CSI (PuntiPartiteVinte)
    puntiClassifica(regola, vc, vo) {
        if (regola === 'vinte') return [vc, vo];
        if (vc === vo) return [1, 1];
        const casa = vc > vo;
        if (regola === 'miniDoppio') {
            const netta = Math.max(vc, vo) >= 5;
            return casa ? (netta ? [3, 0] : [2, 1]) : (netta ? [0, 3] : [1, 2]);
        }
        return casa ? [2, 0] : [0, 2];
    }
};

// Per i test con Node (nel telefono module non esiste)
if (typeof module !== 'undefined') module.exports = { Gioco };
