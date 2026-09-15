# Dagbok

Et kveldsrituale for to konti: en som fører, og en som leser. Dagen føres på
under ett minutt – hvordan den var, tre gode ting, og hva man trenger. Leseren
får beskjed på Telegram, og begge kan skrive i appen.

Fire faner: **I dag** (kveldsrunden), **Kalender** (hver dag som farge, med
stemningskurve og ukestall), **Glasset** (alt som er skrevet, søkbart) og
**Meldinger** (begge veier, og en ønskeliste begge fyller).

Ingen andre har tilgang. Ingen sporing, ingen analyse, ingen tredjeparter.

> Dette er et eget prosjekt og har ingenting med turappen i rotmappa å gjøre.
> Se `CLAUDE.md` her i mappa.

---

## De tre reglene appen er bygget rundt

**1. Forfatteren bestemmer hva leseren får se.** Ett valg per dag, ikke tre brytere:
**del**, eller **bare for meg**. En privat dag går ingenting ut
fra – leseren ser en skravert rute i kalenderen, og at dagen finnes, men ikke hva
som står i den. Siste steg i kveldsrunden viser ordrett hva som sendes, før
forfatteren lagrer. I koden går alt som skal til leseren gjennom `forLeseren()` i
`src/worker.js`, så det er ett sted å lese for å vite at det stemmer.

**2. Varsel bare når det betyr noe.** Pling hver kveld, og man slutter å se
etter. Pling bare når noe er tungt, og appen blir et alarmanlegg man vegrer seg
for å bruke. Derfor:

| Dagen | Hva som skjer |
|---|---|
| «Ring meg» eller «kom hit» | Varsel med lyd, med én gang |
| 1–2 av 5 | Varsel med lyd |
| To tunge dager på rad | Én stille beskjed i tillegg |
| 5 av 5 | Varsel – de gode dagene skal telle like mye |
| Alle andre delte dager | Stille melding med alt forfatteren skrev – ingen lyd |
| Melding fra forfatteren | Varsel med lyd |
| Nytt på ønskelista | Stille melding |
| Forfatteren åpner appen | Stille melding, høyst én gang i timen |
| Morgenen etter en tung kveld | Med lyd, kl. 08 – samme beskjed, når den kan brukes |
| Søndag kveld | Uka samlet: snitt, gode og tunge dager, hva forfatteren har bedt om |
| Nyttårsaften | Året i tall, og en påminnelse om å lese årsboka sammen |
| Merket «bare for meg» | Ingenting, uansett |

### Svar rett fra Telegram

Et varsel om en tung dag er ellers bare en beskjed: du får vite at det er
tungt, og så skjer det ingenting. Derfor ligger det knapper under dem:

> `Ringer deg nå` · `Kommer hjem` · `Tenker på deg 🫂`

Ett trykk, og forfatteren ser det i appen innen sekunder. Du kan også svare med
vanlig tekst – i en samtale med boten alene gjelder alt du skriver, og i en
gruppe må det være et svar på noe boten har sagt, eller `/si <tekst>`. Ellers
ville hver melding om melk og tannlegetimer havnet i dagboka forfatterens.

To lag holder fremmede ute: Telegram sender en hemmelighet bare den og
appen kjenner, og **bare kontoen som én gang har sagt `/eier <koden din>`**
blir hørt på. Alle andre får høflig ingenting.

`/logginn` gir deg en engangslenke rett inn i appen, gyldig i et kvarter.
Du trenger aldri taste koden din igjen.

### Slik henger skjermene sammen

Fire faner: **I dag** (kveldsrunden, det ferskeste fra den andre, ønskelista),
**Kalender** (måneden, stemningskurva, sammendrag for uke/måned/år),
**Glasset** (krukka, spørsmålslista, arkivet, årsboka) og **Meldinger**
(samtalen, med skrivefeltet nederst der det hører hjemme).

Brytere og nøkler ligger bak tannhjulet, ikke blant innholdet. Kort brukes
til ting – en dag, en melding, et brev – og overskrift med hårstrek til
resten. Ellers ser alt like viktig ut, og da er ingenting det.

### Spørsmålslista

Seksti spørsmål i fem kategorier, som er forfatterens egne. Forfatteren velger kategori og
hvor mange forfatteren orker å se – tre, ti, tjue eller tretti – og forslagene byttes
ut hver gang. Svarene legger seg i arkivet sammen med de gode tingene.

### Sammendrag

Uke, måned eller år: dager ført, snitt, gode og tunge dager, hva forfatteren oftest
har bedt om, beste og tyngste dagen med forfatterens egne ord. **Bare tall og det
forfatteren har skrevet** – ingen automatiske tolkninger. De blir fort tullete, og
verre: de blir feil om et menneske.

Trykker du på en dag i kalenderen, får du dagsarket: dagen satt til å leses,
ikke en liste med felter.

### Føring bakover i tid

Man husker ofte lenge etterpå at en dag var verdt å skrive ned. Trykk på en
tom dag som har vært i kalenderen, så åpnes kveldsrunden for den datoen.

Gamle dager varsler mildere enn dagens: «ring meg» fra en dag for tre uker
siden er ikke et rop om hjelp, det er et minne. Er dagen mer enn ett døgn
gammel, går det én stille beskjed om at den ble fylt ut – ikke alarmene.

### Kveldens spørsmål

Et skjema som ser likt ut 365 kvelder på rad blir et skjema. Derfor kommer
det et spørsmål til i tillegg til de tre gode tingene, og det veksler: «Hva
lo du av i dag?», «Hva sa du nei til?», «Hva vil du huske fra i dag om ti
år?». Datoen bestemmer hvilket, så begge ser det samme, og det samme
spørsmålet kommer igjen først om et par måneder.

### Milepæler og reaksjoner

Hundre, tusen, fem tusen gode ting i glasset gir en feiring i Telegram – én
gang per milepæl. Og meldinger kan få et hjerte: trykk på bobla, velg tegnet.

### Bilder og lyd

Ett eller flere bilder per dag, og lydklipp for de dagene det er lettere å si
noe enn å skrive det. Opptaksknappen finnes bare der nettleseren faktisk kan
det – den er et tilbud, ikke et krav.

Bildet krympes i nettleseren før det sendes: et telefonbilde er fem megabyte,
og ingen skjerm her trenger mer enn halvannen tusen piksler. Filene ligger i
Cloudflare KV, ikke R2 – R2 må skrus på med betalingskort, og ett bilde om
dagen holder seg godt innenfor gratisgrensa på 1 GB.

Legger forfatteren et bilde på en delt dag, følger det med til Telegram. På en privat
dag går det ingen steder – og leseren ser ikke engang at det ligger der, for en
id er nok til å spørre etter fila.

### Sikkerhetskopi

**Oss → Sikkerhetskopi** laster ned alt som én JSON-fil, og `/eksport` i boten
sender den samme fila i Telegram. Leserens utgave har bare det som er delt, og
brev forfatteren ikke har åpnet er med som datoer uten tekst.

Data man ikke kan få ut, er data man kan miste – og dette er det eneste
eksemplaret som finnes.

### Koder som kan byttes

Kodene starter som hemmeligheter hos Cloudflare, men de kan byttes inne i
appen – under **Innstillinger → Koder**. Begge kan bytte sin egen; leseren kan i tillegg
sette en ny for forfatteren, for de dagene den er glemt.

Da legges koden i databasen som en PBKDF2-hash med eget salt, ikke som tekst,
og det er den som gjelder fra da av. Hemmeligheten fra oppsettet er bare
utgangspunktet.

Setter leseren en ny for forfatteren, får forfatteren en melding om det i samtalen. En kode som
byttes i det skjulte er ikke en kode – det er en lås.

I den publiserte utgaven uten server er koden også nøkkelen til det som
holder for seg selv. Der kan ingen andre sette en ny, og bytter forfatteren selv,
låses alt det skjulte opp og igjen med den nye nøkkelen – eller så byttes
ingenting.

**3. Forfatteren får noe tilbake.** En app som bare rapporterer oppover blir en
plikt. Derfor ligger det en hilsen fra leseren klar om morgenen, brev leseren har
skrevet på forhånd til dårlige dager, og «glasset»: en tilfeldig god ting forfatteren
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
  worker.js           API-et: ruter, tilgang, og filteret forLeseren()
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
cd dagbok
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
| `AKTIV_VARSEL` | Sett til `"nei"` for å slutte å si fra når forfatteren er inne |
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

## Det som er verdt å vite først

**Spør den som skal skrive, først.** En app som varsler den ene om den andres
humør er bare i orden hvis begge er med på den. Forskjellen ligger ikke i koden –
den ligger i om den som fører vet hva appen gjør, og kan slå den av.

**Det som er sendt, kan ikke tas tilbake.** Trykkes det lagre på en dag som
utløser varsel, er meldingen ute. Å endre dagen etterpå sender ingenting nytt,
men fjerner heller ikke det som alt er sendt.

**Appen erstatter ikke en samtale.** Den er bygget for å starte dem: derfor
«hva trenger du?» framfor bare en tallskala. Beskjeden om at dagen var dårlig
er lite verdt uten neste linje, som sier hva leseren skal gjøre med det.

## Lisens

MIT.
