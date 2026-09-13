# Turplan

En turplanlegger for Norge som kjører i nettleseren. Den bruker Kartverkets
offisielle kart og høydedata, den nasjonale Turrutebasen, værvarselet fra
Meteorologisk institutt og snøskredvarselet fra NVE.

Ingen konto, ingen sporing, ingen server: turen din bor i nettleseren din.

**Kom i gang:** `npm start` og åpne <http://localhost:8080>.

---

## Hva den gjør

| | |
|---|---|
| **Ekte kart** | Kartverkets topografiske kart, gråtonekart, turkart og sjøkart – det samme grunnlaget som norgeskart.no. |
| **Merkede ruter** | Turrutebasen legges oppå kartet: fotruter, skiløyper, sykkelruter og andre ruter. |
| **Følg sti** | Nye strekninger legges automatisk langs faktiske stier i stedet for luftlinje. Stinettet settes sammen av Turrutebasen og OpenStreetMap. |
| **Virkelig høydeprofil** | Høyder hentes punkt for punkt fra Kartverkets nasjonale høydemodell (DTM1, laserdata). Ikke anslag fra kartkoter. |
| **Realistisk tidsbruk** | Tobler-modellen for gangfart, justert for underlag, sekkevekt og pauser – med et ærlig usikkerhetsspenn. |
| **Vær der du er, når du er der** | Været hentes ikke bare for startpunktet, men for hvert sjekkpunkt langs ruta, på klokkeslettet du er beregnet å være der. |
| **Dagslyssjekk** | Sammenligner beregnet sluttid med solnedgangen og sier fra hvis du havner i mørket. |
| **Snøskredvarsel** | Varsom-varselet for regionen ruta går gjennom, med faregrad og råd. |
| **Langs ruta** | Hytter, gapahuker, topper, drikkevann, bålplasser, parkering og busstopp innenfor 700 meter. |
| **Del og ta med** | Delbar lenke (hele turen ligger i URL-en), GPX ut og inn, lagring lokalt og offline-bruk. |

### Litt om tidsestimatet

Gåtiden regnes segment for segment med Toblers gangfunksjon, som gir høyest fart
i svakt utforbakke og faller raskt når det blir bratt. Farten skaleres til den
marsjfarten du velger, deles på en terrengfaktor (merket sti, umerket, ulendt,
snø) og justeres for sekkevekt. Pauser legges til med 8 minutter per gåtime
etter den første.

Modellen er kalibrert mot DNTs egne tidsanslag for kjente turer – en
Besseggen-lignende tur på 14 km og 1100 høydemeter i ulendt terreng lander på
6–8 timer, som er det DNT selv oppgir. Spennet appen viser (±20 %) er der fordi
føre, vær og dagsform betyr mer enn desimalene i et estimat.

---

## Datakilder

Alt er åpne data. Ingen API-nøkler kreves.

| Kilde | Brukes til | Lisens |
|---|---|---|
| [Kartverket – WMTS](https://kartkatalog.geonorge.no/) | Bakgrunnskart (topo, gråtone, turkart, sjøkart) | NLOD / CC BY 4.0 |
| [Turrutebasen (WMS + WFS)](https://kartkatalog.geonorge.no/metadata/turrutebasen/) | Merkede ruter, både som kartlag og som geometri til «Følg sti» | NLOD |
| [Geonorge – Høydedata](https://ws.geonorge.no/hoydedata/v1/) | Terrenghøyder fra DTM1 | NLOD |
| [Geonorge – Stedsnavn (SSR)](https://ws.geonorge.no/stedsnavn/v1/) | Stedsnavnsøk | NLOD |
| [MET Norway Locationforecast](https://api.met.no/) | Værvarsel og soloppgang/solnedgang | CC BY 4.0 |
| [NVE / Varsom](https://api01.nve.no/) | Snøskredvarsel | NLOD |
| [OpenStreetMap via Overpass](https://overpass-api.de/) | Hytter, topper og stier der Turrutebasen mangler | ODbL |

### Hvorfor ikke ut.no?

Kort svar: ut.no har ikke lenger noe åpent API. Nasjonal Turbase, som lå bak
`api.ut.no`, er lagt ned, og det finnes ingen offentlig erstatning å hente
turbeskrivelser fra. Å skrape nettsidene deres ville vært både skjørt og i strid
med vilkårene.

Det appen gjør i stedet:

- **Rutene** hentes fra Turrutebasen, som er den samme nasjonale databasen DNT
  og kommunene selv leverer rutedata til. Der ligger de merkede rutene ved
  kilden, ikke i andre hånd.
- **Hyttene** kommer fra OpenStreetMap, der DNT-hytter er merket med operatør.
  Hytter uten egen nettside lenkes videre til søk på ut.no, slik at du kommer
  til bookingen med ett klikk.

Skulle DNT åpne et API igjen, er `src/js/api/` stedet å legge det inn.

### Om dekningen

Turrutebasen bygges på leveranser fra kommuner og turlag, og dekningen er
ujevn. I Marka og langs de store turmålene er den god; i deler av høyfjellet
finnes det områder uten en eneste kartlagt rute. OpenStreetMap dekker delvis
opp, men ikke overalt. Når «Følg sti» ikke finner noe å følge, sier appen fra og
tegner en rett strek i stedet – den later ikke som den vet noe den ikke vet.

---

## Kom i gang

```bash
npm start          # utviklingsserver på http://localhost:8080
npm test           # enhetstester (node --test, ingen avhengigheter)
npm run test:e2e   # røyktest i ekte nettleser mot ekte API-er
```

Prosjektet har **ingen byggesteg**. Det er statiske filer med ES-moduler, og
Leaflet ligger med i `vendor/`. Vil du publisere det, kopier mappa til hvilken
som helst statisk vert – GitHub Pages, Netlify, en katalog bak nginx.

### Publisering på GitHub Pages

Arbeidsflyten i `.github/workflows/ci.yml` kjører testene og legger ut siden fra
`main`. Slå på Pages under **Settings → Pages → Source: GitHub Actions**.

---

## Slik henger koden sammen

```
index.html              markup og innlasting
sw.js                   service worker: app-skall, kartfliser og API-svar offline
src/css/app.css         hele stilarket, lys og mørk modus
src/js/
  main.js               oppstart og lim mellom modulene
  config.js             karttjenester, endepunkter, standardverdier
  state.js              turen som datamodell, med abonnement og lagring
  map.js                Leaflet: lag, markører, tegning av ruta
  route.js              lengde, stigning, tidsestimat, gradering
  geo.js                ren geometri (avstand, fortetting, forenkling)
  snap.js               stigraf og korteste veg («Følg sti»)
  profile.js            høydeprofilen som SVG, med tastaturstyring
  weather.js            sjekkpunkter, ankomsttider og dagslys
  panels.js             alt innholdet i sidepanelet
  search.js             stedsnavnsøk som tilgjengelig combobox
  share.js              delbare lenker (polylinjekoding)
  gpx.js                GPX inn og ut
  ui.js                 varsler, nedlasting, små byggeklosser
  util.js               formatering på norsk, småting
  api/                  én modul per tjeneste, alle over samme HTTP-lag
test/                   enhetstester
test/e2e/smoke.mjs      røyktest i Chromium
```

Modulene kjenner ikke hverandre på kryss og tvers: `state.js` roper ut at turen
er endret, `main.js` hører etter og bestiller det som må regnes om, og
`panels.js` tar imot ferdige data og lager DOM. Alt som kan være en ren funksjon
er en ren funksjon, og det er de som er dekket av testene.

---

## Tilgjengelighet og ytelse

- Alt kan betjenes med tastatur. Høydeprofilen har egne piltastkontroller, og
  søket følger ARIA-mønsteret for combobox.
- Lys og mørk modus følger systemet. Fargene har kontrast nok til å leses ute i
  sollys.
- Mobil først: bunnark som kan dras opp, minst 40 px trykkflater, ingen
  vannrett rulling.
- `prefers-reduced-motion` slår av animasjonene.
- Tjenestene er fellesgoder, og appen behandler dem deretter: svar
  mellomlagres, høydeoppslag går i bolker på 50 punkter, og Overpass prøves mot
  flere speil før den gir opp.

### En merknad om MET og User-Agent

MET ber om at klienter identifiserer seg med en `User-Agent`-header. Nettlesere
lar ikke JavaScript sette den, så kall herfra går med nettleserens egen. Skal du
kjøre dette med mye trafikk, sett opp en liten proxy som legger på en
identifiserende `User-Agent` – se [vilkårene til MET](https://api.met.no/doc/TermsOfService).

---

## Personvern

Turplan har ingen server og ingen konto. Turene dine lagres i `localStorage` i
din egen nettleser, og delbare lenker legger turen i URL-ens fragment (`#`),
som aldri sendes til noen tjener. Kartfliser og værvarsler hentes direkte fra
Kartverket, MET og NVE, som naturligvis ser IP-adressen din slik enhver
nettside ville gjort.

## Lisens

Koden er MIT. Dataene har sine egne lisenser – se tabellen over, og ta med
kildehenvisningene hvis du bygger videre.
