-- Dagbok. Kjøres med `npm run db:skjema`.
-- Alt er idempotent, så fila kan kjøres om igjen etter endringer.

-- Én rad per dag. Datoen er nøkkelen, i norsk tid, så en dag ikke kan
-- føres to ganger fordi klokka passerte midnatt i UTC.
CREATE TABLE IF NOT EXISTS dager (
  dato        TEXT PRIMARY KEY,          -- 'YYYY-MM-DD', Europe/Oslo
  humor       INTEGER NOT NULL,          -- 1–5
  gode_ting   TEXT NOT NULL DEFAULT '[]',-- JSON: [{ tekst, merket }]
  tungt       TEXT,                      -- fritekst
  behov       TEXT,                      -- nøkkel fra BEHOV i varsler.js
  del_gode    INTEGER NOT NULL DEFAULT 1,
  del_tungt   INTEGER NOT NULL DEFAULT 0,
  privat      INTEGER NOT NULL DEFAULT 0,-- hele dagen holdes for seg selv
  skrevet_kl  TEXT NOT NULL,
  endret_kl   TEXT NOT NULL
);

-- Meldinger begge veier. Den nyeste fra leseren ligger klar som «dagens hilsen»,
-- men forfatteren kan svare – ellers blir appen en postkasse med bare én luke.
CREATE TABLE IF NOT EXISTS meldinger (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fra       TEXT NOT NULL,               -- 'forfatter' eller 'leser'
  tekst     TEXT NOT NULL,
  laget_kl  TEXT NOT NULL,
  lest_kl   TEXT
);
CREATE INDEX IF NOT EXISTS meldinger_tid ON meldinger (laget_kl);

-- Ting dere skal gjøre. Begge kan legge til, begge kan huke av.
CREATE TABLE IF NOT EXISTS onsker (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tekst     TEXT NOT NULL,
  laget_av  TEXT NOT NULL,
  laget_kl  TEXT NOT NULL,
  gjort_kl  TEXT,
  gjort_av  TEXT
);

-- Kveldens spørsmål. Det veksler, så kveldsrunden ikke blir det samme
-- skjemaet 365 ganger. Egen tabell framfor en kolonne til i `dager`, fordi
-- SQLite ikke kan legge til kolonner uten å vite om de finnes fra før.
CREATE TABLE IF NOT EXISTS svar (
  dato      TEXT PRIMARY KEY,
  sporsmal  TEXT NOT NULL,
  tekst     TEXT NOT NULL,
  skrevet_kl TEXT NOT NULL
);

-- Spørsmålslista. Forfatterens egen: ett svar per spørsmål, når forfatteren vil.
CREATE TABLE IF NOT EXISTS sporsmalsvar (
  nokkel     INTEGER PRIMARY KEY,
  tekst      TEXT NOT NULL,
  skrevet_kl TEXT NOT NULL
);

-- Reaksjoner på meldinger. Én per melding per person.
CREATE TABLE IF NOT EXISTS reaksjoner (
  melding  INTEGER NOT NULL,
  hvem     TEXT NOT NULL,
  tegn     TEXT NOT NULL,
  satt_kl  TEXT NOT NULL,
  PRIMARY KEY (melding, hvem)
);

-- Bilder og lydklipp som hører til en dag. Selve fila ligger i KV; her står
-- bare det som trengs for å finne den igjen og vite hva den er.
CREATE TABLE IF NOT EXISTS filer (
  id        TEXT PRIMARY KEY,
  dato      TEXT NOT NULL,
  slag      TEXT NOT NULL,             -- 'bilde' eller 'lyd'
  type      TEXT NOT NULL,             -- MIME
  storrelse INTEGER NOT NULL,
  laget_kl  TEXT NOT NULL,
  -- NULL: hører til dagen. 0: lastet opp, ikke sendt ennå. Ellers: melding-id.
  melding   INTEGER
);
CREATE INDEX IF NOT EXISTS filer_dato ON filer (dato);

-- Brev som legges inn på forhånd og åpnes på en dårlig dag.
CREATE TABLE IF NOT EXISTS brev (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tekst     TEXT NOT NULL,
  laget_kl  TEXT NOT NULL,
  apnet_kl  TEXT
);

-- Hva som er sendt til Telegram. Finnes raden, sendes den ikke på nytt –
-- ellers ville hver retting av dagen utløst varselet om igjen.
CREATE TABLE IF NOT EXISTS varsler (
  slag     TEXT NOT NULL,
  dato     TEXT NOT NULL,
  sendt_kl TEXT NOT NULL,
  PRIMARY KEY (slag, dato)
);

-- Småting som må huskes mellom kjøringer: hvem som eier boten, sist brukte
-- engangslenke. Nøkkel og verdi, ikke mer.
CREATE TABLE IF NOT EXISTS oppsett (
  nokkel TEXT PRIMARY KEY,
  verdi  TEXT NOT NULL,
  satt_kl TEXT NOT NULL
);

-- Innloggingsforsøk, slik at en kode på seks tegn ikke kan gjettes i ro og mak.
CREATE TABLE IF NOT EXISTS forsok (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ip   TEXT NOT NULL,
  kl   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forsok_ip ON forsok (ip, kl);
