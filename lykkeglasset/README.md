# Lykkeglasset

Et kveldsrituale for to. Hun fører dagen på under ett minutt – hvordan den
var, tre gode ting, og hva hun trenger. Han får beskjed på Telegram, og de
skriver sammen i appen.

Fire faner: **I dag** (kveldsrunden), **Kalender** (hver dag som farge, med
stemningskurve og ukestall), **Glasset** (alt hun har skrevet, søkbart) og
**Oss** (meldinger begge veier, og en ønskeliste dere fyller sammen).

Ingen andre har tilgang. Ingen sporing, ingen analyse, ingen tredjeparter.

> Dette er et eget prosjekt og har ingenting med turappen i rotmappa å gjøre.
> Se `CLAUDE.md` her i mappa.

---

## De tre reglene appen er bygget rundt

**1. Hun bestemmer hva han får se.** Ett valg per dag, ikke tre brytere:
**del med Mathias**, eller **bare for meg**. En privat dag går ingenting ut
fra – han ser en skravert rute i kalenderen, og at dagen finnes, men ikke hva
som står i den. Siste steg i kveldsrunden viser ordrett hva som sendes, før
hun lagrer. I koden går alt som skal til Mathias gjennom `forHam()` i
`src/worker.js`, så det er ett sted å lese for å vite at det stemmer.

**2. Varsel bare når det betyr noe.** Pling hver kveld, og han slutter å se
etter. Pling bare når det er tungt, og appen blir et alarmanlegg hun vegrer
seg for å bruke. Derfor:

| Dagen | Hva som skjer |
|---|---|
| «Ring meg» eller «kom hit» | Varsel med lyd, med én gang |
| 1–2 av 5 | Varsel med lyd |
| To tunge dager på rad | Én stille beskjed i tillegg |
| 5 av 5 | Varsel – de gode dagene skal telle like mye |
| Alle andre delte dager | Stille melding med alt hun skrev – ingen lyd |
| Melding fra henne | Varsel med lyd |
| Nytt på ønskelista | Stille melding |
| Hun åpner appen | Stille melding, høyst én gang i timen |
| Morgenen etter en tung kveld | Med lyd, kl. 08 – samme beskjed, når den kan brukes |
| Søndag kveld | Uka samlet: snitt, gode og tunge dager, hva hun har bedt om |
| Nyttårsaften | Året i tall, og en påminnelse om å lese årsboka sammen |
| Merket «bare for meg» | Ingenting, uansett |

### Svar rett fra Telegram

Et varsel om en tung dag er ellers bare en beskjed: du får vite at det er
tungt, og så skjer det ingenting. Derfor ligger det knapper under dem:

> `Ringer deg nå` · `Kommer hjem` · `Tenker på deg 🫂`

Ett trykk, og hun ser det i appen innen sekunder. Du kan også svare med
vanlig tekst – i en samtale med boten alene gjelder alt du skriver, og i en
gruppe må det være et svar på noe boten har sagt, eller `/si <tekst>`. Ellers
ville hver melding om melk og tannlegetimer havnet i dagboka hennes.

To lag holder fremmede ute: Telegram sender en hemmelighet bare den og
appen kjenner, og **bare kontoen som én gang har sagt `/eier <koden din>`**
blir hørt på. Alle andre får høflig ingenting.

`/logginn` gir deg en engangslenke rett inn i appen, gyldig i et kvarter.
Du trenger aldri taste koden din igjen.

### Bilder og lyd

Ett eller flere bilder per dag, og lydklipp for de dagene det er lettere å si
noe enn å skrive det. Opptaksknappen finnes bare der nettleseren faktisk kan
det – den er et tilbud, ikke et krav.

Bildet krympes i nettleseren før det sendes: et telefonbilde er fem megabyte,
og ingen skjerm her trenger mer enn halvannen tusen piksler. Filene ligger i
Cloudflare KV, ikke R2 – R2 må skrus på med betalingskort, og ett bilde om
dagen holder seg godt innenfor gratisgrensa på 1 GB.

Legger hun et bilde på en delt dag, følger det med til Telegram. På en privat
dag går det ingen steder – og han ser ikke engang at det ligger der, for en
id er nok til å spørre etter fila.

### Sikkerhetskopi

**Oss → Sikkerhetskopi** laster ned alt som én JSON-fil, og `/eksport` i boten
sender den samme fila i Telegram. Hans utgave har bare det som er delt, og
brev hun ikke har åpnet er med som datoer uten tekst.

Data man ikke kan få ut, er data man kan miste – og dette er det eneste
eksemplaret som finnes.

### Koder som kan byttes

Kodene starter som hemmeligheter hos Cloudflare, men de kan byttes inne i
appen – under **Oss → Koder**. Begge kan bytte sin egen; Mathias kan i tillegg
sette en ny for Lykke, for de dagene hun har glemt sin.

Da legges koden i databasen som en PBKDF2-hash med eget salt, ikke som tekst,
og det er den som gjelder fra da av. Hemmeligheten fra oppsettet er bare
utgangspunktet.

Setter han en ny for henne, får hun en melding om det i samtalen. En kode som
byttes i det skjulte er ikke en kode – det er en lås.

I den publiserte utgaven uten server er koden hennes også nøkkelen til det hun
holder for seg selv. Der kan ingen andre sette en ny, og bytter hun selv,
låses alt det skjulte opp og igjen med den nye nøkkelen – eller så byttes
ingenting.

**3. Hun får noe tilbake.** En app som bare rapporterer oppover blir en
plikt. Derfor ligger det en hilsen fra ham klar om morgenen, brev han har
skrevet på forhånd til dårlige dager, og «glasset»: en tilfeldig god ting hun
selv skrev for flere måneder siden og har rukket å glemme.

Ingen streaks. Det siste noen trenger på en tung dag er å miste en rekke.

**Og en fjerde, som ikke er en funksjon:** dette er ikke kriseverktøy.
«Ring meg» er en knapp, ikke en behandling. Går det virkelig galt, er
telefonen riktig sted – og Mental Helse svarer på 116 123, hele døgnet.

---

## Slik henger det sammen

```
wrangler.toml         hvor appen kjører, og hva som ikke er hemmelig
schema.sql            tabellene
src/
  worker.js           API-et: ruter, tilgang, og filteret forHam()
  auth.js             to koder, signert informasjonskapsel i et halvår
  dato.js             døgnet regnes i norsk tid, ikke UTC
  varsler.js          hva som utløser varsel, og hva det står i dem
  telegram.js         ett kall ut
public/
  index.html          skallet
  app.js              hele grensesnittet, uten rammeverk
  api.js              den eneste veien til serveren – kan byttes ut
  app.css             lys og mørk modus
  sw.js               offline – men aldri mellomlagring av /api/
scripts/
  oppsett.mjs         hele oppsettet i ett kjør
  ikoner.mjs          tegner appikonene som PNG
artefakt/             samme app mot et annet lager, for publisering uten server
test/                 70 enhetstester av det som kan gå galt stille
```

`varsler.js` og `dato.js` er rene funksjoner uten avhengigheter. Det er de
reglene som er verdt å teste – at en privat dag aldri lekker, at «ring meg»
går foran, at en rettelse ikke sender varselet på nytt, og at døgnet skifter
ved norsk midnatt og ikke ved UTC.

---

## Sette det opp

Du trenger ingen server. Cloudflare kjører både siden og API-et på gratisplanen,
uten kort, og alt er ett skript:

```bash
cd lykkeglasset
npm install
npm run oppsett
```

Skriptet logger deg inn hos Cloudflare, lager databasen, setter inn tabellene,
spør om de to kodene og Telegram-tokenet, og legger appen ut. Til slutt får du
adressen. Åpne den på telefonen og legg den til på hjemskjermen.

### Telegram

Boten er laget i [@BotFather](https://t.me/BotFather). To ting må stemme:

1. **Boten må være medlem av gruppa** varslene skal til. Legg den inn, og send
   en melding i gruppa etterpå.
2. **Tokenet er et passord.** Det settes med `wrangler secret put` og skal
   aldri stå i en fil i repoet. Har det vært innom en chat, en skjermdeling
   eller en e-post: lag et nytt med `/revoke` hos BotFather. Den som har
   tokenet, kan lese alt boten ser.

Gruppa som varslene går til står i `wrangler.toml` som `TELEGRAM_CHAT_ID`.
Den er ikke hemmelig – uten token er den ubrukelig.

### Justeringer uten å røre koden

I `wrangler.toml`:

| Nøkkel | Hva den gjør |
|---|---|
| `PAMINNELSE_KL` | Når appen minner om kveldsrunden hvis dagen står tom (norsk tid) |
| `PAMINNELSE` | Sett til `"nei"` for å droppe påminnelsen helt |
| `AKTIV_VARSEL` | Sett til `"nei"` for å slutte å si fra når hun er inne |
| `DELT_MODUS` | `"ja"` fjerner «bare for meg»-valget: alt deles, og appen sier det rett ut |
| `TELEGRAM_CHAT_ID` | Hvilken samtale varslene går til |
| `TIDSSONE` | Hvilken tidssone døgnet regnes i |

### Under utvikling

```bash
npm test     # enhetstestene
npm run dev  # kjører lokalt med egen database
npm run ikoner
```

---

## Det som er verdt å vite før dere begynner

**Spør henne først.** En app som varsler den ene om den andres humør er en
fin gave hvis hun er med på den, og noe helt annet hvis hun ikke er det.
Forskjellen ligger ikke i koden – den ligger i om hun vet hva den gjør, og
kan slå den av.

**Det som er sendt, kan ikke tas tilbake.** Trykker hun lagre på en dag som
utløser varsel, er meldingen ute. Å endre dagen etterpå sender ingenting nytt,
men fjerner heller ikke det som alt er sendt.

**Appen erstatter ikke en samtale.** Den er bygget for å starte dem: derfor
«hva trenger du?» framfor bare en tallskala. Beskjeden om at dagen var dårlig
er lite verdt uten neste linje, som sier hva han skal gjøre med det.

## Lisens

MIT.
