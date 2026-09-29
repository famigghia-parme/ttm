// TennisTavoloManager - cloud.js  (PWA cloud)
// Colloquio con Supabase con fetch semplice, senza librerie esterne:
// login email/password, rinnovo del token, chiamate REST (PostgREST).
// Errori:
//   e.offline  = rete assente o Supabase irraggiungibile
//   e.sessione = login scaduto o revocato: serve rifare l'accesso

// Un accesso per ambiente (store.js: AMBIENTE): passando da Prova a Reale
// non si esce dall'altro.
const CHIAVE_SESSIONE = PROVA ? 'ttm.sessione.prova' : 'ttm.sessione';

const Cloud = {
    sessione: (() => { try { return JSON.parse(localStorage.getItem(CHIAVE_SESSIONE) || 'null'); } catch { return null; } })(),

    _salva(s) {
        this.sessione = s;
        try {
            if (s) localStorage.setItem(CHIAVE_SESSIONE, JSON.stringify(s));
            else localStorage.removeItem(CHIAVE_SESSIONE);
        } catch { }
    },

    // Risposta di /auth/v1/token -> sessione salvata
    _daToken(j) {
        const scade = j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in || 3600) * 1000;
        this._salva({
            access_token: j.access_token,
            refresh_token: j.refresh_token,
            scade,
            email: j.user?.email || this.sessione?.email || ''
        });
    },

    async _auth(tipo, corpo) {
        let r;
        try {
            r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=${tipo}`, {
                method: 'POST',
                headers: { apikey: CONFIG.SUPABASE_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo)
            });
        } catch { throw Object.assign(new Error('Rete assente'), { offline: true }); }
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, j };
    },

    async login(email, password) {
        const r = await this._auth('password', { email, password });
        if (!r.ok) throw new Error(r.status === 400 ? 'Email o password errati' : (r.j.msg || r.j.error_description || 'Errore ' + r.status));
        this._daToken(r.j);
    },

    logout() { this._salva(null); },

    async rinnova() {
        if (!this.sessione) throw Object.assign(new Error('Accesso richiesto'), { sessione: true });
        const r = await this._auth('refresh_token', { refresh_token: this.sessione.refresh_token });
        if (!r.ok) {
            this._salva(null);
            throw Object.assign(new Error('Sessione scaduta: rifai l\'accesso'), { sessione: true });
        }
        this._daToken(r.j);
    },

    async token() {
        if (!this.sessione) throw Object.assign(new Error('Accesso richiesto'), { sessione: true });
        if (Date.now() > this.sessione.scade - 60000) await this.rinnova();
        return this.sessione.access_token;
    },

    // Chiamata REST. Ritorna { ok, status, json }: gli errori HTTP NON sono
    // eccezioni (il sync decide cosa farne), la rete assente si'.
    async rest(metodo, percorso, corpo, prefer, riprova = true) {
        const tok = await this.token();
        const h = { apikey: CONFIG.SUPABASE_KEY, Authorization: 'Bearer ' + tok };
        if (corpo !== undefined) h['Content-Type'] = 'application/json';
        if (prefer) h.Prefer = prefer;

        let r;
        try {
            r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${percorso}`, {
                method: metodo, headers: h,
                body: corpo === undefined ? undefined : JSON.stringify(corpo)
            });
        } catch { throw Object.assign(new Error('Rete assente'), { offline: true }); }

        // Token revocato prima della scadenza prevista: si rinnova una volta
        if (r.status === 401 && riprova) {
            await this.rinnova();
            return this.rest(metodo, percorso, corpo, prefer, false);
        }
        const testo = await r.text();
        let json = null;
        try { json = testo ? JSON.parse(testo) : null; } catch { }
        return { ok: r.ok, status: r.status, json };
    }
};
