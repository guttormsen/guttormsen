-- Lykkeglasset. Kjøres med `npm run db:skjema`.
-- Alt er idempotent, så fila kan kjøres om igjen etter endringer.

-- Én rad per dag. Datoen er nøkkelen, i norsk tid, så en dag ikke kan
-- føres to ganger fordi klokka passerte midnatt i UTC.
CREATE TABLE IF NOT EXISTS dager (
  dato        TEXT PRIMARY KEY,          -- 'YYYY-MM-DD', Europe/Oslo
  humor       INTEGER NOT NULL,          -- 1–5
  gode_ting   TEXT NOT NULL DEFAULT '[]',-- JSON: [{ tekst, om_oss }]
  tungt       TEXT,                      -- fritekst
  behov       TEXT,                      -- nøkkel fra BEHOV i varsler.js
  del_gode    INTEGER NOT NULL DEFAULT 1,
  del_tungt   INTEGER NOT NULL DEFAULT 0,
  privat      INTEGER NOT NULL DEFAULT 0,-- hele dagen holdes for seg selv
  skrevet_kl  TEXT NOT NULL,
  endret_kl   TEXT NOT NULL
);

-- Meldinger begge veier. Den nyeste fra ham ligger klar som «dagens hilsen»,
-- men hun kan svare – ellers blir appen en postkasse med bare én luke.
CREATE TABLE IF NOT EXISTS meldinger (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fra       TEXT NOT NULL,               -- 'lykke' eller 'mathias'
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

-- Innloggingsforsøk, slik at en kode på seks tegn ikke kan gjettes i ro og mak.
CREATE TABLE IF NOT EXISTS forsok (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ip   TEXT NOT NULL,
  kl   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forsok_ip ON forsok (ip, kl);
