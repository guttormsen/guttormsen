-- Vedlegg i meldinger.
--
-- «melding» sier hvem fila hører til: NULL for en dag, 0 for et vedlegg som
-- er lastet opp men ikke sendt ennå, ellers id-en til meldingen.
-- CREATE TABLE IF NOT EXISTS i schema.sql legger ikke til kolonner i en
-- tabell som allerede finnes, så den må komme herfra én gang.
ALTER TABLE filer ADD COLUMN melding INTEGER;
