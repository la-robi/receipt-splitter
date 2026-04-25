# Ripartitore degli Scontrini di Coppia (aka Scoppia) v.1

Web app mobile-first per dividere le spese degli scontrini tra due persone.

## Obiettivo

L'app Scoppia v.1 permette di caricare una foto di uno scontrino, riconoscere testo e prezzo degli item, farne una lista che l'utente può catalogare con flag R, T, Entrambi. L'app calcula quindi quanto ha speso R e quanto ha speso T tra spese personali e la metà di quelle comuni.

## MVP iniziale

- Caricamento di una foto dello scontrino
- Estrazione automatica delle righe con AI/OCR in cui ogni riga ha
  - nome articolo
  - prezzo
  - assegnazione: Persona A, Persona B, Entrambi
- Possibilità di modificare la riga
- Calcolo automatico dei totali
- Sezione per eventuale caricamento buoni pasto utilizzati
- Riepilogo finale
- Interfaccia semplice e ottimizzata per smartphone

## Funzionalità future

- Guess dell'Ai sulla divisione degli item tra R, T o Entrambi (comunque modificabile) in base allo storico e alle istruzioni ricevute.

## Regola importante

L'AI non deve mai salvare dati automaticamente senza conferma dell'utente.
Ogni riga estratta deve essere modificabile prima del salvataggio.
