// TennisTavoloManager - pdf.js  (PWA cloud)
// Il referto di gara in PDF creato DAL TELEFONO, anche senza rete: lo stesso
// modulo ufficiale e gli stessi dati di "Crea PDF" sul PC.
//
// E' la traduzione riga per riga di due file del PC:
//   Services/PdfSovrapposto.cs  ->  Pdf.Foglio, Pdf.larghezza, Pdf.adatta, Pdf.applica
//   Services/RefertoPdf.cs      ->  Pdf.nomeModello, Pdf.campi, Pdf.dividiLuogo, Pdf.genera
// Se cambia uno dei due, va cambiato anche qui. Il controllo lo fa
// Tools/TestPwaCloud/test-pdf.js: con gli stessi dati il PDF del telefono
// deve essere UGUALE a quello del PC, byte per byte.
//
// Come funziona, in breve (i dettagli sono nei due file del PC): il modello
// (referti/<nome>.pdf, preparato da Tools/Referti/prepara_modelli.py) non
// viene ne' letto ne' toccato; in fondo gli si aggiunge un pezzetto con i
// testi da scrivere, nei punti indicati dalla mappa (referti/<nome>.json).
// Carattere Helvetica, gia' dichiarato nel modello: le larghezze delle
// lettere stanno qui sotto, per centrare e per far stare un nome nella
// sua casella.
// I modelli li tiene in cache il service worker (sw.js): si usano offline.

// "Il dato dell'incontro oppure, se manca, quello della scheda della squadra".
// Campo di gara, maglie, tavolo e palline stanno sulla SQUADRA (import
// squadre / Modifica squadra sul PC) e l'import del calendario li copia
// sugli incontri; un incontro creato a mano, o una squadra completata dopo,
// ne restano senza. Chi mostra o stampa questi dati (scheda dell'incontro,
// Formazione, Dati referto, referto PDF) passa da qui.
// E' la stessa regola del PC: Incontro.LuogoOSquadra, TavoloOSquadra...
// in Models.cs (stessi tagli: 200, 100, 100, 40 caratteri).
// inc = riga dell'incontro, casa / ospite = righe delle due squadre.
const OSquadra = {
    pieno(s, max = Infinity) {
        if (s == null || String(s).trim() === '') return null;
        s = String(s).trim();
        return s.length <= max ? s : s.slice(0, max);
    },
    luogo(inc, casa) { return this.pieno(inc.luogo) ?? this.pieno(casa?.campo_gara, 200); },
    tavolo(inc, casa) { return this.pieno(inc.tavolo) ?? this.pieno(casa?.tavolo, 100); },
    palline(inc, casa) { return this.pieno(inc.palline) ?? this.pieno(casa?.palline, 100); },
    magliaCasa(inc, casa) { return this.pieno(inc.colore_maglia_casa) ?? this.pieno(casa?.colori, 40); },
    magliaOspite(inc, ospite) { return this.pieno(inc.colore_maglia_ospite) ?? this.pieno(ospite?.colori, 40); }
};

const Pdf = {
    SEGNAPOSTO: '% TTM-SOVRAPPOSIZIONE',

    // Numero come lo scrive il PC ("0.###" di .NET): al massimo 3 decimali,
    // senza zeri in coda. ATTENZIONE all'arrotondamento: .NET prima porta il
    // numero a 15 cifre significative, POI arrotonda a 3 decimali (il 5 va
    // in su). toFixed(3) invece guarda il valore binario esatto: 267.3825,
    // che in binario e' 267.38249999..., per il PC e' "267.383" e per
    // toFixed "267.382". Qui si fa come il PC, cifra per cifra
    // (test-pdf.js lo confronta con il C# su migliaia di numeri).
    n(v) {
        let s = Math.abs(v).toPrecision(15);
        if (s.includes('e')) s = Math.abs(v).toFixed(3);       // numeri piccolissimi o enormi: qui non capitano
        let [intero, dec = ''] = s.split('.');
        if (dec.length > 3) {
            let cifre = intero + dec.slice(0, 3);
            if (dec[3] >= '5') cifre = String(Number(cifre) + 1).padStart(cifre.length, '0');
            intero = cifre.slice(0, -3) || '0';
            dec = cifre.slice(-3);
        }
        dec = dec.replace(/0+$/, '');
        return (v < 0 ? '-' : '') + (dec ? `${intero}.${dec}` : intero);
    },

    // ------------------------------------------------------------------
    // Caratteri: da testo ai byte della codifica WinAnsi (quella del
    // carattere nel modello). Un carattere che non esiste perde l'accento;
    // se non basta diventa "?".
    // ------------------------------------------------------------------
    SPECIALI: {
        '\u20AC': 0x80, '\u2026': 0x85, '\u2018': 0x91, '\u2019': 0x92,
        '\u201C': 0x93, '\u201D': 0x94, '\u2013': 0x96, '\u2014': 0x97,
        '\u0160': 0x8A, '\u0161': 0x9A, '\u017D': 0x8E, '\u017E': 0x9E,
        '\u0152': 0x8C, '\u0153': 0x9C, '\u0178': 0x9F
    },

    // byte di UN carattere, oppure -1
    byte1(c) {
        const k = c.charCodeAt(0);
        if (c === '\t') return 32;
        if ((k >= 32 && k <= 126) || (k >= 160 && k <= 255)) return k;
        return this.SPECIALI[c] ?? -1;
    },

    codifica(testo) {
        const uscita = [];
        for (let i = 0; i < testo.length; i++) {
            const c = testo[i];
            let b = this.byte1(c);
            if (b >= 0) { uscita.push(b); continue; }
            // senza accento: "c con pipetta" -> "c"
            let messo = false;
            for (const d of c.normalize('NFD')) {
                if (/\p{Mn}/u.test(d)) continue;
                b = this.byte1(d);
                if (b >= 0) { uscita.push(b); messo = true; }
            }
            if (!messo) uscita.push(63);     // "?"
        }
        return uscita;
    },

    // ------------------------------------------------------------------
    // Misure
    // ------------------------------------------------------------------

    // Larghezza del testo in punti, a quel corpo
    larghezza(testo, corpo, grassetto = false) {
        const tabella = grassetto ? this.LARGHEZZE_GRASSETTO : this.LARGHEZZE_NORMALE;
        let somma = 0;
        for (const b of this.codifica(testo)) somma += b >= 32 ? tabella[b - 32] : 0;
        return somma * corpo / 1000;
    },

    // Fa stare il testo in una larghezza: prima rimpicciolisce il corpo (fino
    // a corpoMinimo), poi accorcia il testo e mette i puntini. -> [testo, corpo]
    adatta(testo, larghezza, corpo, corpoMinimo = 5.5, grassetto = false) {
        testo = testo.trim();
        while (corpo > corpoMinimo && this.larghezza(testo, corpo, grassetto) > larghezza)
            corpo = Math.max(corpoMinimo, corpo - 0.25);
        if (this.larghezza(testo, corpo, grassetto) > larghezza) {
            while (testo.length > 1 && this.larghezza(testo + '\u2026', corpo, grassetto) > larghezza)
                testo = testo.slice(0, -1).trimEnd();
            testo += '\u2026';
        }
        return [testo, corpo];
    },

    // ------------------------------------------------------------------
    // Disegno: cio' che si scrive sopra il modello. Coordinate in punti
    // (1/72 di pollice), origine in basso a sinistra, y verso l'alto.
    // ------------------------------------------------------------------
    Foglio() {
        const n = v => Pdf.n(v);
        return {
            contenuto: '',
            // Rettangolo bianco pieno: copre i puntini prima di scriverci sopra
            rettangoloBianco(x, y, larghezza, altezza) {
                this.contenuto += `1 g ${n(x)} ${n(y)} ${n(larghezza)} ${n(altezza)} re f 0 g\n`;
            },
            // Segmento nero (per barrare una casella)
            linea(x1, y1, x2, y2, spessore) {
                this.contenuto += `0 G ${n(spessore)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S\n`;
            },
            // Testo nero; (x, y) = inizio della linea di base
            testo(testo, x, y, corpo, grassetto = false) {
                if (!testo) return;
                let s = `BT 0 g /${grassetto ? 'TTM2' : 'TTM1'} ${n(corpo)} Tf ${n(x)} ${n(y)} Td (`;
                for (const b of Pdf.codifica(testo)) {
                    if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);      // ( ) \
                    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');       // ottale
                    else s += String.fromCharCode(b);
                }
                this.contenuto += s + ') Tj ET\n';
            }
        };
    },

    // ------------------------------------------------------------------
    // Scrittura: aggiornamento in coda al modello.
    // modello = Uint8Array del PDF preparato; contenuto = Foglio().contenuto.
    // Ritorna il nuovo PDF (Uint8Array).
    // ------------------------------------------------------------------
    applica(modello, contenuto) {
        // Un carattere per byte: le posizioni nel testo sono le posizioni nel file
        let testo = '';
        for (let i = 0; i < modello.length; i += 8192)
            testo += String.fromCharCode.apply(null, modello.subarray(i, i + 8192));

        const segno = testo.lastIndexOf(this.SEGNAPOSTO);
        if (segno < 0)
            throw new Error('Il modello del referto non è stato preparato (manca il segnaposto).');

        // L'oggetto che contiene il segnaposto: "N 0 obj" subito prima
        const obj = testo.lastIndexOf(' 0 obj', segno);
        let inizioNumero = obj;
        while (inizioNumero > 0 && /[0-9]/.test(testo[inizioNumero - 1])) inizioNumero--;
        if (obj < 0 || inizioNumero === obj)
            throw new Error('Modello del referto non valido: oggetto del segnaposto non trovato.');
        const numero = parseInt(testo.slice(inizioNumero, obj), 10);

        // L'ultimo indice del file e i dati che il nuovo indice deve ripetere
        const startxref = testo.lastIndexOf('startxref'), trailer = testo.lastIndexOf('trailer');
        if (startxref < 0 || trailer < 0 || trailer > startxref)
            throw new Error('Modello del referto non valido: indice finale non trovato.');
        const dopo = (t, chiave) => { const i = t.indexOf(chiave); return i < 0 ? '' : t.slice(i + chiave.length); };
        const intero = t => (/^\s*([0-9]*)/.exec(t) || [])[1] || '';       // il primo numero intero del testo
        const riferimento = (t, chiave) => {                               // "/Root 12 0 R" -> "12 0 R"
            const resto = dopo(t, chiave), num = intero(resto);
            if (!num) return '';
            const gen = intero(dopo(resto, num));
            return gen ? `${num} ${gen} R` : '';
        };
        const coda = testo.slice(trailer, startxref);
        const precedente = intero(testo.slice(startxref + 'startxref'.length));
        const dimensione = intero(dopo(coda, '/Size'));
        const radice = riferimento(coda, '/Root'), info = riferimento(coda, '/Info');
        if (!precedente || !dimensione || !radice)
            throw new Error('Modello del referto non valido: indice finale incompleto.');

        // contenuto e' solo ASCII: lunghezza in caratteri = in byte
        let s = modello.length > 0 && modello[modello.length - 1] !== 10 ? '\n' : '';
        const posizioneOggetto = modello.length + s.length;
        s += `${numero} 0 obj\n<< /Length ${contenuto.length} >>\nstream\n${contenuto}\nendstream\nendobj\n`;
        const posizioneIndice = modello.length + s.length;
        // Ogni riga dell'indice e' lunga esattamente 20 byte
        s += `xref\n${numero} 1\n${String(posizioneOggetto).padStart(10, '0')} 00000 n \n` +
            `trailer\n<< /Size ${dimensione} /Root ${radice}` + (info ? ` /Info ${info}` : '') +
            ` /Prev ${precedente} >>\nstartxref\n${posizioneIndice}\n%%EOF\n`;

        const risultato = new Uint8Array(modello.length + s.length);
        risultato.set(modello, 0);
        for (let i = 0; i < s.length; i++) risultato[modello.length + i] = s.charCodeAt(i);
        return risultato;
    },

    // ==================================================================
    // RefertoPdf.cs
    // ==================================================================

    // Nome del modello per federazione ("FITET" / "CSI") e formula (nome di
    // CodiceFormula). null = il modulo ufficiale non c'e' ancora.
    nomeModello(tipo, formula) {
        return {
            'FITET|Courbillon': 'fitet_corbillon',
            'FITET|MiniSwaythlingDoppio': 'fitet_mini_doppio',
            'CSI|CsiCorbillon': 'csi_corbillon'
        }[`${tipo}|${formula}`] ?? null;
    },

    // Nome proposto per il file: "Referto_2026-10-10_Olimpia A-Ponte C.pdf"
    nomeFile(d) {
        const nome = `Referto_${d.inc.data_ora ? String(d.inc.data_ora).slice(0, 10) : 'senza-data'}_` +
            `${d.casa?.nome ?? ''}-${d.ospite?.nome ?? ''}`;
        // i caratteri che Windows non accetta nei nomi dei file
        return nome.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf';
    },

    // Parole con cui comincia un indirizzo (seguite da uno spazio)
    INIZIO_VIA: /^(viale|via|v\.le|vicolo|piazzale|piazza|p\.zza|p\.za|corso|c\.so|largo|strada|contrada|localita'?|loc\.)(?=\s)/i,
    // Numero civico: "14", "14A", "14/B". Cinque cifre = CAP, non civico.
    CIVICO: /^[0-9]+[A-Za-z]?(\/[0-9A-Za-z]+)?$/,
    CAP: /^[0-9]{5}$/,

    // Il campo di gara e' scritto in una riga sola; il modulo lo vuole in tre
    // posti. -> [impianto, via, comune] (l'impianto puo' essere vuoto).
    // Forme riconosciute, come DividiLuogo sul PC (RefertoPdf.cs):
    //   "IMPIANTO, VIA BELLINI, 14, COMUNE"    calendario FITET e "Dati referto" del PC
    //   "Impianto Via Bellini, 14 Comune"      sito del CSI
    //   "Impianto Via Bellini 14 Comune"       senza virgole
    //   "Impianto, Comune" / "Impianto"        nessuna via
    dividiLuogo(luogo) {
        const parole = t => t.split(/\s+/).filter(x => x.length > 0);
        const pezzi = String(luogo ?? '').split(',').map(p => p.trim()).filter(p => p.length > 0);
        if (!pezzi.length) return ['', '', ''];

        // 1. un pezzo (fra due virgole) che COMINCIA con la parola "via"
        let i = pezzi.findIndex(p => this.INIZIO_VIA.test(p));

        // 2. altrimenti la parola "via" in mezzo a un pezzo: lo si spezza li'
        for (let a = 0; a < pezzi.length && i < 0; a++)
            for (let k = 1; k < pezzi[a].length; k++)
                if (/\s/.test(pezzi[a][k - 1]) && this.INIZIO_VIA.test(pezzi[a].slice(k))) {
                    const prima = pezzi[a].slice(0, k).trim(), dopo = pezzi[a].slice(k);
                    pezzi.splice(a, 1, prima, dopo);
                    i = a + 1;
                    break;
                }

        // il CAP non va sul referto
        const senzaCap = comune => comune.map(c => parole(c).filter(x => !this.CAP.test(x)).join(' ')).filter(c => c.length > 0).join(', ');

        // 3. nessuna via: l'ultimo pezzo e' il comune, il resto l'impianto
        if (i < 0)
            return pezzi.length === 1 ? [pezzi[0], '', ''] : [pezzi.slice(0, -1).join(', '), '', senzaCap([pezzi[pezzi.length - 1]])];

        const impianto = pezzi.slice(0, i).join(', ');
        let via = pezzi[i];
        const resto = pezzi.slice(i + 1), comune = [];

        if (resto.length) {
            // Dopo la via c'e' una virgola: se il pezzo seguente comincia con
            // il numero civico, quello va con la via e il resto e' il comune.
            const p = parole(resto[0]);
            if (this.CIVICO.test(p[0]) && !this.CAP.test(p[0])) {
                via += ', ' + p[0];
                resto[0] = p.slice(1).join(' ');
            }
            comune.push(...resto);
        } else {
            // Tutto in un pezzo ("Via Bellini 14 Bergamo"): il civico e'
            // l'ultimo numero che non segue subito la parola "via" (in "Via
            // 4 Novembre" il 4 e' il nome); cio' che lo segue e' il comune.
            const p = parole(via);
            let t = -1;
            p.forEach((x, n) => { if (this.CIVICO.test(x) && !this.CAP.test(x)) t = n; });
            if (t >= 2) {
                via = p.slice(0, t + 1).join(' ');
                comune.push(p.slice(t + 1).join(' '));
            }
        }

        // "in Via" e' gia' stampato sul modulo: non si ripete
        return [impianto, via.replace(/^via\s+/i, ''), senzaCap(comune)];
    },

    // Nome sul modulo di un ruolo della formazione; assente = non va sul referto
    CHIAVE_RUOLO: { A: 'A', B: 'B', C: 'C', Riserva1: 'R1', Riserva2: 'R2', Riserva3: 'R3',
        Capitano: 'CAP', Allenatore: 'ALL', Medico: 'MED', Dirigente: 'DIR' },

    // Dai dati dell'incontro ai testi da scrivere, per nome di campo. I campi
    // senza valore non compaiono (sul modulo restano da riempire a penna).
    // d = { inc, campionato, giornata, casa, ospite        righe del cloud
    //       partite: [riga + sets: [righe]], formazioni: [righe],
    //       atleti: Map(uid -> riga), tessera(uidSquadra, uidAtleta) -> testo o null }
    // S = squadra con le lettere A/B/C (a sinistra), D = squadra con X/Y/Z.
    campi(d) {
        const v = {};
        const metti = (campo, testo) => { if (testo != null && String(testo).trim() !== '') v[campo] = String(testo).trim(); };
        const inc = d.inc;
        const ora = t => t ? String(t).slice(0, 5) : null;
        const atleta = uid => uid ? d.atleti.get(uid) : null;
        const nomeCompleto = a => `${a.cognome} ${a.nome}`;
        const abcInCasa = inc.squadra_lettere_abc_uid !== inc.squadra_ospite_uid;
        const lati = [['S', abcInCasa], ['D', !abcInCasa]];
        const perOrdine = [...d.partite].sort((a, b) => a.ordine - b.ordine);

        // Nota (1) del modulo: campionato, girone, giornata; la versione corta
        // senza le parole "gir." e "giornata".
        const nomeGara = corto => {
            const pezzi = [];
            if (d.campionato?.nome && d.campionato.nome.trim()) pezzi.push(d.campionato.nome.trim());
            const girone = d.casa?.girone ?? d.ospite?.girone;
            if (girone && girone.trim()) pezzi.push((corto ? '' : 'gir. ') + girone.trim());
            if (d.giornata) pezzi.push(`${d.giornata.numero}\u00AA g${corto ? '.' : 'iornata'}`);
            return pezzi.join(corto ? ' ' : ' - ');
        };

        // --- intestazione ---
        // campo di gara, tavolo, palline e maglie: dell'incontro oppure, se
        // mancano, della scheda della squadra (OSquadra, qui sopra)
        const [impianto, via, comune] = this.dividiLuogo(OSquadra.luogo(inc, d.casa));
        metti('citta', comune);
        metti('data', inc.data_ora ? `${inc.data_ora.slice(8, 10)}/${inc.data_ora.slice(5, 7)}/${inc.data_ora.slice(0, 4)}` : null);
        metti('gara', nomeGara(false));
        metti('gara~', nomeGara(true));
        metti('svoltosiA', impianto.length > 0 ? impianto : comune);       // senza l'impianto: il comune
        metti('via', via);
        metti('tavolo', OSquadra.tavolo(inc, d.casa));
        metti('palline', OSquadra.palline(inc, d.casa));
        metti('squadraCasa', d.casa?.nome);
        metti('squadraOspite', d.ospite?.nome);

        // --- giudice arbitro e defibrillatore ---
        metti('arbitro.nome', inc.giudice_arbitro);
        metti('arbitro.qualifica', inc.qualifica_arbitro);
        metti('arbitro.firma', inc.giudice_arbitro);
        if (inc.defibrillatore === true) v['dae.si'] = 'X';
        if (inc.defibrillatore === false) v['dae.no'] = 'X';
        metti('dae.operatore', inc.operatore_dae);

        // --- formazione ---
        const doppio = perOrdine.find(p => p.tipo === 'Doppio');
        for (const [lato, casa] of lati) {
            const squadra = casa ? d.casa : d.ospite;
            const uidSquadra = casa ? inc.squadra_casa_uid : inc.squadra_ospite_uid;
            const sue = d.formazioni.filter(r => r.squadra_uid === uidSquadra);

            metti(`f.${lato}.squadra`, squadra?.nome);
            metti(`f.${lato}.maglia`, casa ? OSquadra.magliaCasa(inc, d.casa) : OSquadra.magliaOspite(inc, d.ospite));
            metti(`f.${lato}.ora`, ora(casa ? inc.ora_presentazione_casa : inc.ora_presentazione_ospite));

            for (const r of sue) {
                const chiave = this.CHIAVE_RUOLO[r.ruolo];
                if (!chiave) continue;
                const a = atleta(r.atleta_uid);
                metti(`f.${lato}.${chiave}.nome`, a ? nomeCompleto(a) : (r.nome_libero ?? ''));
                // La tessera della riga e' quella di QUANDO la formazione e'
                // stata salvata: se e' vuota si prende quella di adesso, dal
                // tesseramento con la societa' della squadra.
                metti(`f.${lato}.${chiave}.tessera`,
                    r.tessera != null && String(r.tessera).trim() !== '' ? r.tessera
                        : r.atleta_uid ? d.tessera?.(uidSquadra, r.atleta_uid) : null);
            }

            // Coppia del doppio (riga "D" dei moduli Corbillon): dalla partita
            // di doppio, perche' nella formazione il doppio non ha righe sue.
            if (doppio) {
                const coppia = casa ? [doppio.atleta_casa1_uid, doppio.atleta_casa2_uid]
                    : [doppio.atleta_ospite1_uid, doppio.atleta_ospite2_uid];
                coppia.forEach((uid, k) => {
                    const a = atleta(uid);
                    if (!a) return;
                    metti(`f.${lato}.D${k + 1}.nome`, nomeCompleto(a));
                    metti(`f.${lato}.D${k + 1}.tessera`,
                        sue.find(r => r.atleta_uid === uid && r.tessera != null && String(r.tessera).trim() !== '')?.tessera
                        ?? d.tessera?.(uidSquadra, uid));
                });
            }
        }

        // --- ordine di gioco ed esito dei set ---
        // Nome di uno dei giocatori: per l'ospite, se non e' in anagrafica,
        // vale il nome scritto a mano. Vuoto = casella vuota.
        const nomeDi = (p, casa, primo) => {
            const a = atleta(casa ? (primo ? p.atleta_casa1_uid : p.atleta_casa2_uid)
                : (primo ? p.atleta_ospite1_uid : p.atleta_ospite2_uid));
            const n = casa ? (a ? nomeCompleto(a) : null)
                : (a ? nomeCompleto(a) : (primo ? p.avversario_ospite1 : p.avversario_ospite2));
            return n == null || n === '?' ? '' : n;
        };
        // "Rossi M." (cognome e iniziale). Vuoto se l'atleta non e' in anagrafica.
        const nomeCorto = (p, casa, primo) => {
            const a = atleta(casa ? (primo ? p.atleta_casa1_uid : p.atleta_casa2_uid)
                : (primo ? p.atleta_ospite1_uid : p.atleta_ospite2_uid));
            if (!a || !a.cognome || !a.cognome.trim()) return '';
            const nome = (a.nome ?? '').trim();
            return nome.length === 0 ? a.cognome.trim() : `${a.cognome.trim()} ${nome[0]}.`;
        };

        metti('oraInizio', ora(inc.ora_inizio));
        let riga = 0, setS = 0, setD = 0, vinteS = 0, vinteD = 0, qualcosaGiocato = false;
        for (const p of perOrdine) {
            riga++;
            for (const [lato, casa] of lati) {
                // Le caselle dei nomi qui sono strette: accanto al nome intero
                // si da' quello corto ("Rossi M."), nel campo con la tilde.
                const n1 = nomeDi(p, casa, true), c1 = nomeCorto(p, casa, true);
                if (p.tipo === 'Doppio') {
                    const n2 = nomeDi(p, casa, false), c2 = nomeCorto(p, casa, false);
                    metti(`p.${riga}.${lato}.nome1`, n1);
                    metti(`p.${riga}.${lato}.nome1~`, c1);
                    metti(`p.${riga}.${lato}.nome2`, n2);
                    metti(`p.${riga}.${lato}.nome2~`, c2);
                    metti(`p.${riga}.${lato}.nome`, [n1, n2].filter(x => x.length > 0).join(' / '));
                    metti(`p.${riga}.${lato}.nome~`, [c1, c2].filter(x => x.length > 0).join(' / '));
                } else {
                    metti(`p.${riga}.${lato}.nome`, n1);
                    metti(`p.${riga}.${lato}.nome~`, c1);
                }
            }

            const chiusi = (p.sets || []).filter(s => s.completato).sort((a, b) => a.numero - b.numero);
            if (!chiusi.length) continue;

            qualcosaGiocato = true;
            let k = 0;
            for (const s of chiusi) {
                if (++k > 5) break;
                v[`p.${riga}.s${k}.S`] = String(abcInCasa ? s.punti_casa : s.punti_ospite);
                v[`p.${riga}.s${k}.D`] = String(abcInCasa ? s.punti_ospite : s.punti_casa);
            }
            const vintiS = (abcInCasa ? p.set_vinti_casa : p.set_vinti_ospite) ?? 0;
            const vintiD = (abcInCasa ? p.set_vinti_ospite : p.set_vinti_casa) ?? 0;
            v[`p.${riga}.tot.S`] = String(vintiS);
            v[`p.${riga}.tot.D`] = String(vintiD);
            setS += vintiS;
            setD += vintiD;

            // "indicare solo la cifra 1 nella casella di chi ha vinto la partita"
            if (p.completata && p.vinta_da_casa != null) {
                const vintaS = p.vinta_da_casa === abcInCasa;
                v[`p.${riga}.vinta.${vintaS ? 'S' : 'D'}`] = '1';
                if (vintaS) vinteS++; else vinteD++;
            }
        }

        if (qualcosaGiocato) {
            v['tot.set.S'] = String(setS);
            v['tot.set.D'] = String(setD);
            v['tot.partite.S'] = String(vinteS);
            v['tot.partite.D'] = String(vinteD);
        }

        // --- chiusura ---
        metti('oraFine', ora(inc.ora_fine));
        if (inc.stato === 'Terminato') {
            // Senza il dettaglio delle partite (risultato importato) vale il
            // risultato scritto sull'incontro.
            if (!qualcosaGiocato && inc.punti_casa != null && inc.punti_ospite != null) {
                vinteS = abcInCasa ? inc.punti_casa : inc.punti_ospite;
                vinteD = abcInCasa ? inc.punti_ospite : inc.punti_casa;
            }
            const sinistra = abcInCasa ? d.casa : d.ospite, destra = abcInCasa ? d.ospite : d.casa;
            if (vinteS !== vinteD) {
                metti('vintoDa', (vinteS > vinteD ? sinistra : destra)?.nome);
                v['per'] = `${Math.max(vinteS, vinteD)} - ${Math.min(vinteS, vinteD)}`;
            } else if (vinteS > 0) {
                v['vintoDa'] = 'nessuna (pareggio)';
                v['per'] = `${vinteS} - ${vinteD}`;
            }
        }
        metti('provvedimenti', inc.provvedimenti_disciplinari?.replace(/\r/g, ' ').replace(/\n/g, ' '));
        return v;
    },

    // Il PDF del referto: il modello con i valori scritti nei loro campi.
    // modello = Uint8Array, mappa = il .json del modello (gia' letto),
    // valori = cio' che ritorna campi(). Un valore senza campo nel modello
    // viene ignorato (es. la riga del doppio in formazione, che il modulo
    // Mini-Swaythling non ha).
    genera(modello, mappa, valori) {
        const foglio = this.Foglio();
        const ha = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
        for (const [nome, testo] of Object.entries(valori)) {
            if (!ha(mappa.campi, nome) || !testo || !testo.trim()) continue;
            const c = mappa.campi[nome];
            const corpoCampo = c.corpo ?? 9;

            // Doppio: se il modulo ha le due righe "nome1" e "nome2" si usano
            // quelle, e la versione su una riga sola ("A / B") si salta.
            if (ha(mappa.campi, nome + '1') && ha(valori, nome + '1')) continue;

            const margine = 2.5, spazio = c.w - 2 * margine;

            // Versione corta del testo (campo "nome~"): si usa quando quella
            // intera, per starci, andrebbe scritta troppo in piccolo.
            let scritto = testo;
            const corto = valori[nome + '~'];
            if (ha(valori, nome + '~') && corto.length > 0 &&
                this.larghezza(testo, Math.max(6.5, corpoCampo - 2)) > spazio)
                scritto = corto;

            switch (c.tipo ?? 'cella') {
                case 'croce':
                    foglio.linea(c.x, c.y, c.x + c.w, c.y + c.h, 1.2);
                    foglio.linea(c.x, c.y + c.h, c.x + c.w, c.y, 1.2);
                    break;

                case 'linea': {
                    // Riga da riempire: il testo ci sta sopra, allineato al
                    // testo stampato accanto se il modulo ne da' la linea di base.
                    const [t, corpo] = this.adatta(scritto, spazio, corpoCampo);
                    foglio.testo(t, c.x + margine, c.base != null ? c.base + 0.8 : c.y + 1.8, corpo);
                    break;
                }

                case 'puntini': {
                    // Si coprono i puntini (una striscia bianca a cavallo della
                    // linea di base) e si scrive sulla stessa linea.
                    const linea = c.base ?? c.y + 0.22 * c.h;
                    foglio.rettangoloBianco(c.x - 0.5, linea - 1.2, c.w + 1, 3.6);
                    const [t, corpo] = this.adatta(scritto, spazio, corpoCampo);
                    foglio.testo(t, c.x + margine, linea, corpo);
                    break;
                }

                default: {       // cella
                    const [t, corpo] = this.adatta(scritto, spazio, corpoCampo);
                    const x = (c.allinea ?? 'S') === 'C'
                        ? c.x + (c.w - this.larghezza(t, corpo)) / 2
                        : c.x + margine;
                    // centrato in altezza: le maiuscole di Helvetica sono alte 0,72 del corpo
                    const y = c.y + (c.h - 0.72 * corpo) / 2;
                    foglio.testo(t, x, y, corpo);
                }
            }
        }
        return this.applica(modello, foglio.contenuto);
    },

    // ------------------------------------------------------------------
    // Larghezze di Helvetica (millesimi del corpo), caratteri da 32 a 255
    // nella codifica WinAnsi. Le stesse di PdfSovrapposto.cs.
    // ------------------------------------------------------------------
    LARGHEZZE_NORMALE: [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
        556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
        722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
        278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350, 556, 350, 222, 556,
        333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 222, 222, 333, 333, 350, 556,
        1000, 333, 1000, 500, 333, 944, 350, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737,
        370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834,
        834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722,
        778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556,
        889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556,
        556, 556, 556, 500, 556, 500
    ],
    LARGHEZZE_GRASSETTO: [
        278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
        556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778,
        722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
        278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
        611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 350, 556, 350, 278, 556,
        500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350, 350, 278, 278, 500, 500, 350, 556,
        1000, 333, 1000, 556, 333, 944, 350, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737,
        370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834,
        834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722,
        778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556,
        889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611,
        611, 611, 611, 556, 611, 556
    ]
};

// Per i test con Node (nel telefono module non esiste)
if (typeof module !== 'undefined') module.exports = { Pdf, OSquadra };

// ==================================================================
// Dalla scheda dell'incontro (incontri.js): pulsante "Referto PDF"
// ==================================================================

// I dati dell'incontro dal database del telefono, nella forma di Pdf.campi
async function pdfDati(uid) {
    const inc = await leggi('incontri', uid);
    if (!inc) throw new Error('Incontro non trovato.');
    const [giornata, casa, ospite] = await Promise.all([
        leggi('giornate', inc.giornata_uid), leggi('squadre', inc.squadra_casa_uid), leggi('squadre', inc.squadra_ospite_uid)]);
    const campionato = giornata ? await leggi('campionati', giornata.campionato_uid) : null;
    const partite = await perIndice('partite', 'incontro_uid', uid);
    for (const p of partite) p.sets = await perIndice('sets', 'partita_uid', p.uid);
    const [formazioni, atleti, tesseramenti] = await Promise.all([
        perIndice('formazioni', 'incontro_uid', uid), tutti('atleti'), tutti('atleti_societa')]);
    // Tessera di chi gioca il doppio senza avere la sua riga in formazione:
    // quella del tesseramento con la societa' della squadra, nella stagione.
    const tessera = (uidSquadra, uidAtleta) => {
        const societa = (uidSquadra === casa?.uid ? casa : ospite)?.societa_uid;
        return tesseramenti.find(t => t.societa_uid === societa && t.atleta_uid === uidAtleta &&
            t.stagione === campionato?.stagione)?.tessera ?? null;
    };
    return { inc, campionato, giornata, casa, ospite, partite, formazioni, atleti: perUid(atleti), tessera };
}

// Modello e mappa: dalla cache del service worker (referti/), anche senza rete
async function pdfModello(nome) {
    try {
        const [pdf, mappa] = await Promise.all([fetch(`referti/${nome}.pdf`), fetch(`referti/${nome}.json`)]);
        if (!pdf.ok || !mappa.ok) throw new Error(String(pdf.ok ? mappa.status : pdf.status));
        return [new Uint8Array(await pdf.arrayBuffer()), await mappa.json()];
    } catch {
        throw new Error('Il modulo del referto non è ancora su questo telefono: apri l\'app una volta con la rete e riprova.');
    }
}

// L'ultimo referto creato: resta sotto il pulsante anche se la scheda si
// ridisegna per dati nuovi dal cloud. { uid, url, nome, kb, ora, file }
let pdfPronto = null;

function pdfLascia() {
    if (pdfPronto) URL.revokeObjectURL(pdfPronto.url);
    pdfPronto = null;
}

// Riquadro "Referto pronto" sotto il pulsante: scarica e, dove il telefono
// lo permette, condividi (da li' si apre, si stampa, si manda).
function pdfMostra(uid) {
    const box = $('#inPdfBox');
    if (!box || !pdfPronto || pdfPronto.uid !== uid) return;
    const p = pdfPronto;
    let condivisibile = false;
    try { condivisibile = !!p.file && !!navigator.canShare && navigator.canShare({ files: [p.file] }); } catch { }
    box.innerHTML = `<div class="pdfPronto">
        <b>Referto pronto</b> <small>creato alle ${esc(p.ora)} · ${p.kb} KB</small>
        <small>${esc(p.nome)}</small>
        ${condivisibile ? '<button class="pieno" id="pdfCondividi">📤 Condividi, apri o stampa</button>' : ''}
        <a class="pieno${condivisibile ? ' chiaro' : ''}" id="pdfScarica" href="${p.url}" download="${esc(p.nome)}">⬇ Scarica sul telefono</a>
        <div class="lvInfo">Ha i dati di quel momento: dopo una modifica (formazione, punti, dati del referto) crealo di nuovo.</div></div>`;
    const b = $('#pdfCondividi');
    // navigator.share va chiamato dentro il tocco, con il file gia' pronto
    if (b) b.onclick = () => navigator.share({ files: [p.file], title: p.nome }).catch(() => { });
}

async function pdfCrea(uid) {
    const b = $('#inPdf');
    if (b) b.disabled = true;
    try {
        const d = await pdfDati(uid);
        const modello = Pdf.nomeModello(d.campionato?.tipo, d.campionato?.formula);
        if (!modello) throw new Error(PDF_SENZA_MODELLO);
        const [pdf, mappa] = await pdfModello(modello);
        const byte = Pdf.genera(pdf, mappa, Pdf.campi(d));
        const nome = Pdf.nomeFile(d);
        const blob = new Blob([byte], { type: 'application/pdf' });
        pdfLascia();
        let file = null;
        try { file = new File([blob], nome, { type: 'application/pdf' }); } catch { }
        pdfPronto = {
            uid, nome, file, url: URL.createObjectURL(blob), kb: Math.round(byte.length / 1024),
            ora: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        };
        pdfMostra(uid);
        avviso('Referto PDF creato ✓', true);
    } catch (e) {
        msg('Referto PDF non creato: ' + e.message);
    } finally {
        const x = $('#inPdf');
        if (x) x.disabled = false;
    }
}
