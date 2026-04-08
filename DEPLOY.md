# 🗞 PalermoOggi — Guida Deploy su Render.com (GRATIS)

## Cosa ottieni
- Sito online 24/7 gratis
- RSS automatico ogni ora da BlogSicilia e PalermoToday
- Pannello admin segreto (triplo click logo o tasti P-A-L)
- Meteo Palermo in tempo reale
- Ottimizzato mobile

---

## PASSO 1 — Crea account GitHub (se non ce l'hai)
1. Vai su https://github.com e registrati gratis

## PASSO 2 — Carica il progetto su GitHub
1. Vai su https://github.com/new
2. Nome repository: `palermooggi`
3. Clicca **Create repository**
4. Carica i file: trascina la cartella `palermooggi` oppure usa:
   ```
   git init
   git add .
   git commit -m "PalermoOggi primo commit"
   git remote add origin https://github.com/TUONOMEUTENTE/palermooggi.git
   git push -u origin main
   ```

## PASSO 3 — Deploy su Render.com
1. Vai su https://render.com e clicca **Get Started for Free**
2. Connetti il tuo account GitHub
3. Clicca **New** → **Web Service**
4. Seleziona il repository `palermooggi`
5. Impostazioni:
   - **Name:** palermooggi
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

## PASSO 4 — Variabili d'ambiente (IMPORTANTE)
Nella sezione **Environment Variables** di Render aggiungi:
```
ADMIN_USER = admin
ADMIN_PASS = latuapassword_sicura
```

5. Clicca **Create Web Service**
6. Aspetta 2-3 minuti → il sito sarà online!

---

## URL del tuo sito
Render ti darà un URL tipo: `https://palermooggi.onrender.com`

---

## ACCESSO ADMIN (segreto)
- **Triplo click** sul logo "PalermoOggi" in alto
- Oppure **tasti P → A → L** sulla tastiera (quando non sei in un campo testo)
- Credenziali: quelle impostate nelle variabili d'ambiente

---

## Come funziona il RSS automatico
- Ogni **60 minuti** il server scarica automaticamente le ultime notizie da:
  - BlogSicilia.it — sezione Palermo
  - PalermoToday.it — Cronaca, Sport, Politica
- Le notizie appaiono **con la fonte indicata** a fondo articolo
- Puoi anche forzare l'aggiornamento manuale dal pannello admin (bottone "Aggiorna RSS ora")

---

## NOTA sul piano gratuito di Render
Il piano gratuito "spegne" il server dopo 15 minuti di inattività.
Al primo accesso dopo una pausa, impiega ~30 secondi a riavviarsi.
Per avere il sito sempre attivo usa il piano **Starter** ($7/mese).

---

## Struttura file
```
palermooggi/
├── server.js          ← Backend Node.js (RSS + API)
├── package.json       ← Dipendenze
├── .gitignore
├── DEPLOY.md          ← Questa guida
├── data/
│   └── articles.json  ← Database notizie (creato automaticamente)
└── public/
    └── index.html     ← Frontend completo
```
