# STOPP – egen app, egen verden

Denne mappa er **ikke** en del av «Lykkelig tur». Den deler ingenting med
turappen: ikke kode, ikke stilark, ikke service worker, ikke byggesteg, ikke
adresse, ikke datakilder. At den ligger i samme repo er en midlertidig
bekvemmelighet, ikke en kobling.

## Til deg som jobber på turappen

Ikke rør noe her inne. Konkret:

- **Ikke** importer herfra, og **ikke** importer turappens moduler hit.
- **Ikke** ta med filer herfra i turappens tester, lint eller Pages-utlegg.
  `npm test` og `npm run lint` i rota peker med vilje bare på rotas `src/`
  og `test/`, og Pages-jobben sletter denne mappa før den pakker siden.
- **Ikke** nevn denne appen i turappens README, meny, lenker eller manifest.
- Skal du rydde, refaktorere eller «samle ting» på tvers av repoet: hopp over
  `lykkeglasset/`.

Skal noe endres her, skjer det som en egen oppgave som handler om denne appen.

## Til deg som jobber på denne appen

- Kjør testene herfra: `cd lykkeglasset && npm test`.
- Appen kjører på Cloudflare Workers (API + statiske filer) med D1 som lager.
- **Ingen hemmeligheter i koden.** Telegram-token, koder og sesjonsnøkkel
  settes med `wrangler secret put` og ligger aldri i git. Repoet er offentlig.
- **Boten skal alltid følge etter.** Får appen en ny funksjon, skal den også
  kunne nås fra Telegram – som knapp i menyen, som kommando, eller begge.
  En funksjon som bare finnes i appen, er halvferdig. Nye varsler hører
  hjemme i `HENDELSER` i `varsler.js`, nye skjermer i `menyskjerm()` i
  `worker.js`, og de skal dele tekst med kommandoene, ikke ha sin egen.
- **Cloudflare Workers tåler maks 100 000 PBKDF2-runder.** Node har ingen
  slik grense, så et høyere tall går rett gjennom testene og faller først i
  produksjon. Se `MAKS_RUNDER` i `auth.js`. Den slags forskjeller hører
  hjemme i en test, ikke i hukommelsen.
- Innholdet er privat og personlig. Ikke legg inn analyse, sporing, tredjeparts
  skrifttyper eller CDN-er. Alt skal hentes fra egen opprinnelse.
