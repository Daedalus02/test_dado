# video-tracker

Next.js 14 (App Router, TypeScript) per servire video su `/v/<id>`, registrare lato server ogni accesso
(con la sorgente `?s=`, tipicamente un QR code) e misurare quanto di ogni video viene effettivamente guardato.

- **Accessi**: registrati dal server component di `/v/[id]` prima del render (timestamp, video, source, IP, user-agent, referer, paese).
- **Progresso di visione**: il componente client `<TrackedVideo>` invia punto massimo, secondi guardati ed eventi del player.
- **Dashboard** `/admin` (Basic Auth): accessi, contatori, grafico giornaliero, retention, completamento, timeline per sessione.
- **Storage**: SQLite locale (better-sqlite3) oppure Turso/libSQL in produzione.

## Setup

Requisiti: Node.js 20+.

```bash
npm install
cp .env.example .env.local   # poi modifica ADMIN_USER / ADMIN_PASS
npm run dev
```

- Video di prova: <http://localhost:3000/v/sample?s=test>
- Dashboard: <http://localhost:3000/admin>

Il database SQLite viene creato in automatico in `./data/video-tracker.db` (percorso modificabile con `SQLITE_PATH`),
schema incluso.

### Variabili d'ambiente

| Variabile | Uso |
| --- | --- |
| `BASE_URL` | URL pubblico, usato dallo script QR |
| `ADMIN_USER`, `ADMIN_PASS` | Credenziali Basic Auth di `/admin`. Se mancano, `/admin` risponde 503 |
| `CONSENT_BANNER` | `eu` (default), `always`, `off` — vedi [Privacy](#privacy-e-consenso) |
| `SQLITE_PATH` | Percorso del file SQLite locale |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Solo per produzione: se sono impostate entrambe si usa Turso al posto di SQLite |
| `VIDEO_SRC_<ID>` | Sovrascrive la sorgente di un video (vedi sotto) |

## Aggiungere un video

Aggiungi una voce in `src/config.ts`:

```ts
export const videos: Record<string, VideoConfig> = {
  sample: { title: 'Video di prova', src: '/sample.mp4' },
  promo2026: { title: 'Promo 2026', src: 'https://cdn.example.com/promo-2026.mp4' },
};
```

- L'id deve rispettare `[A-Za-z0-9_-]{1,64}`; il video sarà su `/v/promo2026`.
- `src` può essere un file in `public/` (`/nome.mp4`) o un URL assoluto (CDN, Vercel Blob, S3…).
- Per cambiare la sorgente senza toccare il codice imposta `VIDEO_SRC_<ID>` (id in maiuscolo, caratteri
  non alfanumerici → `_`), es. `VIDEO_SRC_PROMO2026=https://…`. Basta la sola env var anche per un id non
  presente in `config.ts`.
- Id sconosciuti rispondono 404 e **non** vengono registrati.

## Generare un QR code

```bash
npm run qr -- <id> [source]

npm run qr -- promo2026 volantino   # -> qr/promo2026_volantino.png  → ${BASE_URL}/v/promo2026?s=volantino
npm run qr -- promo2026             # -> qr/promo2026.png            → ${BASE_URL}/v/promo2026
```

Lo script legge `BASE_URL` dall'ambiente o da `.env.local` / `.env`: impostalo sul **dominio di produzione**
prima di stampare i QR. Usa un `source` diverso per ogni canale (volantino, poster, instagram…) per
confrontarli in dashboard.

## Come funziona il tracking

### Accessi (`hits`)

`src/app/v/[id]/page.tsx` è un server component dinamico: chiama `logHit(id, source, headers())` prima di
renderizzare. IP da `x-forwarded-for` (primo valore), paese da `x-vercel-ip-country` (solo su Vercel).

### Progresso di visione (`sessions`)

`src/components/TrackedVideo.tsx`:

- `sessionId`: UUID v4 casuale salvato in `sessionStorage` (per scheda e per video). Se l'utente ricarica la
  pagina l'id resta lo stesso e il server fa UPSERT sulla stessa riga.
- `loadedmetadata` → `POST /api/progress/init` con durata.
- `timeupdate` aggiorna posizione e punto massimo; i secondi guardati crescono solo se il video non è in pausa
  e il salto è < 2s (così i seek non contano come visione).
- Eventi `play`, `pause`, `seeking`, `seeked`, `ended` vanno in un buffer.
- Ogni 10s, se c'è qualcosa di nuovo, `POST /api/progress/tick`. Il client invia **delta** (secondi guardati ed
  eventi dall'ultimo tick accettato): il server li somma/accoda. Se il tick fallisce o riceve 429, i delta
  vengono reintegrati e reinviati al giro successivo.
- `visibilitychange` → hidden e `beforeunload`: flush finale con `fetch(..., { keepalive: true })`, con fallback
  a `navigator.sendBeacon`.

Lato server (`src/lib/progress.ts`):

- `max_time` si aggiorna solo se maggiore del valore salvato; `watched_seconds` è una somma; gli eventi vengono
  accodati a `events_json`; `completed` diventa vero con `ended` o con `max_time >= 95%` della durata.
- **Rate limit**: un tick viene accettato solo se sono passati almeno 3s da `last_update` della sessione,
  altrimenti 429 (controllo atomico nella stessa UPSERT, funziona anche su serverless). Il flush finale
  (`final: true`) è esente, altrimenti gli ultimi secondi andrebbero persi.
- Payload validati: UUID, video esistente, `hit_id` accettato solo se esiste per lo stesso video, max 100
  eventi per tick, delta limitati.

### Dashboard

`/admin` — filtri per video e intervallo date (UTC); contatori totale / unici (IP+UA) / oggi / 7 giorni;
grafico accessi al giorno; per ogni video: sessioni, tasso di completamento, tempo medio guardato,
istogramma del punto massimo in decili della durata, curva di retention (per minuto; per video sotto i 3 minuti
il passo scende a pochi secondi), sessioni recenti.
`/admin/sessions/<id>` — timeline della sessione: tratti riprodotti ricostruiti dagli eventi, marker per ogni
evento, punto massimo.

## Privacy e consenso

- Banner (`CONSENT_BANNER`): `eu` lo mostra per paesi UE/SEE/UK **e quando il paese è sconosciuto** (quindi
  anche in locale); `always` sempre; `off` mai.
- Se il banner è mostrato, il tracking del progresso parte solo dopo "Accetta" (scelta salvata in
  `localStorage`); con "Rifiuta" non viene inviato nulla dal client.
- Il `sessionId` è un UUID casuale, non derivato da IP/UA, senza login né cookie, e vive solo in
  `sessionStorage`.
- **Da sapere**: la registrazione dell'accesso (`hits`, con IP e user-agent) avviene lato server prima del
  consenso, come da specifica, e `sessions.hit_id` punta a quella riga. Se vuoi che le sessioni siano
  davvero non collegabili a dati personali, valuta di non salvare `hit_id` oppure di salvare in `hits` un hash
  dell'IP invece dell'IP in chiaro. Verifica la base giuridica con chi si occupa di privacy.

## Deploy su Vercel

1. Crea il database Turso:
   ```bash
   turso db create video-tracker
   turso db show video-tracker --url      # -> TURSO_DATABASE_URL (libsql://…)
   turso db tokens create video-tracker   # -> TURSO_AUTH_TOKEN
   ```
   Le tabelle vengono create automaticamente alla prima richiesta.
2. Pubblica il codice su GitHub e su Vercel crea un progetto con *Add New → Project → Import Git Repository*
   (framework: Next.js, nessuna configurazione di build speciale).
3. In *Settings → Environment Variables* imposta: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_USER`,
   `ADMIN_PASS`, `BASE_URL` (es. `https://video.tuodominio.it`), opzionalmente `CONSENT_BANNER` e `VIDEO_SRC_*`.
4. Deploy (ogni push sul branch principale rideploya). Su Vercel il file system è di sola lettura:
   **senza Turso le scritture falliscono**.
5. Rigenera i QR con `BASE_URL` di produzione.

Note:

- Su Vercel si usa il client HTTP `@libsql/client/web` (nessun modulo nativo).
- I video pesanti è meglio servirli da un CDN/object storage (Vercel Blob, S3, Cloudflare R2) invece che da
  `public/`.
- `country` è popolato solo su Vercel (header `x-vercel-ip-country`).

## Script

| Comando | |
| --- | --- |
| `npm run dev` | sviluppo |
| `npm run build` / `npm start` | build e avvio produzione |
| `npm run typecheck` | controllo tipi |
| `npm run qr -- <id> [source]` | genera il QR code |

## Crediti

`public/sample.mp4`: estratto di *Big Buck Bunny* © Blender Foundation, CC BY 3.0.
