# Ripartitore degli Scontrini di Coppia (aka Scoppia) v.1

Web app mobile-first per dividere le spese degli scontrini tra due persone (R e T).

## Cosa fa l'MVP

- Carica una foto dello scontrino da smartphone.
- Estrae automaticamente righe `articolo + prezzo` via OCR (`tesseract.js`, italiano+inglese).
- Mostra una lista completamente modificabile (nome e prezzo), con icona matita e cancellazione riga.
- Permette assegnazione di ogni riga a `R`, `T` o `Entrambi`.
- Gestisce item negativi (sconti): vengono sommati come valori negativi e quindi detratti dai totali.
- Permette di inserire i buoni pasto usati da R.
- Permette di scegliere chi ha pagato alla cassa (`R` oppure `T`).
- Calcola recap dettagliato:
  - Totali personali R/T
  - Spesa comune
  - Quote dovute (`personali + comune/2`)
  - Buoni pasto di R
  - Pagato alla cassa da T (se T è la persona selezionata)
  - Finale con formule richieste:
    - `R finale = quota dovuta R - buoni pasto`
    - `T finale = quota dovuta T - pagato alla cassa da T`
- Salva il conto accettato in archivio locale (`data/sessions.json`).
- Memorizza storico item/assegnazione (`data/item-memory.json`) per suggerire automaticamente il proprietario nei caricamenti futuri.

## Stack

- Node.js + Express
- Frontend vanilla HTML/CSS/JS (mobile-first)
- OCR: `tesseract.js`
- Storage locale: file JSON in `data/`

## Avvio locale

```bash
npm install
npm start
```

Poi apri `http://localhost:3000`.

## API essenziali

- `POST /api/ocr` (`multipart/form-data`, campo `receipt`)
- `GET /api/sessions`
- `POST /api/sessions`

## Nota

L'app non salva automaticamente il risultato OCR come conto definitivo: il salvataggio avviene solo quando premi **"Accetta conto e salva"**.
