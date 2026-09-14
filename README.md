# Lykkelig tur

En turapp for Norge som kjører i nettleseren. Den finner ekte, merkede turer
der du er, og planlegger dem på Kartverkets kart – med høydeprofil fra
laserdata, værvarsel time for time langs ruta og en turdagbok som teller
kilometerne dine.

Ingen konto, ingen sporing, ingen server: turen din bor i nettleseren din.

**Prøv den:** <https://guttormsen.github.io/guttormsen/>
**Kjør lokalt:** `npm start` og åpne <http://localhost:8080>.

---

## Hva den gjør

Appen har tre faner: **Finn tur**, **Turen** og **Dagbok**.

Den het Turplan fram til nå. Lagrede turer og dagbok flyttes automatisk over
ved første besøk etter navnebyttet.

| | |
|---|---|
| **Nær meg** | Én knapp henter turene rundt der du står, sortert etter avstand. |
| **Finn tur** | Henter navngitte, merkede turer fra den nasjonale rutebasen der du er, og setter løse rutesegmenter sammen til hele turer. Filtrer på lengde, vanskegrad, rundtur, merking og rutetype – eller trykk «Overrask meg». Ett trykk på et kort laster hele turen inn ferdig planlagt. |
| **Bilder fra turen** | Foto fra Wikimedia Commons, funnet både på turens navn og på koordinat, koblet til riktig tur og rangert etter hvor godt de passer. Kart, kommunevåpen og kjøpesentre siles bort. Fotograf og lisens står på hvert bilde. |
| **Hva finnes langs ruta** | Badeplass, bålplass, rasteplass, utsikt, hytte, toalett, lekeplass og buss til start – hentet fra OpenStreetMap og vist som merker på turkortet. Filtrer på dem for å finne turen som passer dagen. |
| **Tilgjengelighet** | Fasiliteter merket som rullestolvennlige i OpenStreetMap vises med ♿, og kan filtreres på. Merket sier noe om toalettet, parkeringen eller rasteplassen – ikke om selve stien. |
| **Om stedet** | Et kort utdrag fra norsk Wikipedia når artikkelen faktisk handler om turen – ikke bare tilfeldigvis ligger i nærheten. |
| **Offline** | Last ned kartet langs ruta før du drar. Det ligger klart når dekningen tar slutt, og overlever at appen oppdateres. |
| **Turdagbok** | Marker en tur som gått, så samler den seg opp med kilometer og høydemeter. Fjorten merker å samle, og sammenligninger som gjør tallene til noe man kjenner igjen: «du har klatret 1,4 × Galdhøpiggen». |
| **Ekte kart** | Kartverkets topografiske kart, gråtonekart, turkart og sjøkart – det samme grunnlaget som norgeskart.no. |
| **Merkede ruter** | Turrutebasen legges oppå kartet: fotruter, skiløyper, sykkelruter og andre ruter. |
| **Følg sti** | Nye strekninger legges automatisk langs faktiske stier i stedet for luftlinje. Stinettet settes sammen av Turrutebasen og OpenStreetMap. |
| **Virkelig høydeprofil** | Høyder hentes punkt for punkt fra Kartverkets nasjonale høydemodell (DTM1, laserdata). Ikke anslag fra kartkoter. |
| **Realistisk tidsbruk** | Tobler-modellen for gangfart, justert for underlag, sekkevekt og pauser – med et ærlig usikkerhetsspenn. |
| **Vær der du er, når du er der** | Været hentes ikke bare for startpunktet, men for hvert sjekkpunkt langs ruta, på klokkeslettet du er beregnet å være der. |
| **Dagslyssjekk** | Sammenligner beregnet sluttid med solnedgangen og sier fra hvis du havner i mørket. |
| **Snøskredvarsel** | Varsom-varselet for regionen ruta går gjennom, med faregrad og råd. |
| **Langs ruta** | Hytter, gapahuker, fjellstuer, topper, drikkevann, bålplasser, parkering og busstopp innenfor 400 meter av ruta – og aldri mer enn 300 meter unna den. Hvert sted sier hva det er, hvor høyt det ligger, hvor langt inn i turen du treffer det, om det er DNT, om det koster, når det er åpent og hvor mange senger det har, når OpenStreetMap vet det. Alle har lenke til veibeskrivelse. |
| **Del og ta med** | Delbar lenke (hele turen ligger i URL-en), GPX ut og inn, lagring lokalt og offline-bruk. |

### Kom deg til start

Uten bil er det ofte turen *til* turen som avgjør om det blir noe av. Appen
henter kollektivforbindelser fra der du står til startpunktet – avgangstid,
linjenummer og hvor langt du må gå – og har en lenke som åpner veibeskrivelse
i telefonens eget kartprogram.

### Turen underveis

**Start turen** ligger som en knapp i selve kartet, ikke nede i panelet.
Så følger appen deg mot ruta:

- Hvor langt igjen, hvor lang tid, når du er fremme, og hvor mye stigning som
  gjenstår – store tall som er lesbare i sollys og i fart.
- Framdriftslinje, og varsel når du kommer mer enn seksti meter fra ruta.
- Kartet følger deg, og skjermen holdes våken så lenge nettleseren tillater det.
- Hvilken vei du skal videre: «Følg ruta mot SØ», målt til et punkt et stykke
  fram, ikke til det aller neste – ellers spriker retningen med hver sving.
- Står du nærmest målet når du starter, spør appen om du går ruta motsatt vei.
- Neste hytte, rasteplass eller topp foran deg, med avstand.
- **Posisjonen din i desimalgrader** med nøyaktighet, klar til å leses opp hvis
  du må ringe 113.

Avslutter du etter at du er fremme, føres turen i dagboka med tiden den
faktisk tok. Avslutter du underveis, spør appen først – det er din avgjørelse
om turen skal telle.

### Kartet er til for å se på

Et trykk i kartet legger ikke igjen noe. Det er lett å komme borti skjermen når
man drar og zoomer, og da skal det ikke dukke opp en markør man må rydde bort.

| Situasjon | Hva som skjer |
|---|---|
| Trykk på en merket sti | Den markeres, og et lite kort over kartet viser navn, lengde, stigning og tid |
| «Velg denne turen» på kortet | Turen lastes med høydeprofil, vær og bilder |
| Trykk i terrenget ellers | Ingenting, men appen tipser om «Tegn selv» |
| Tegnemodus på (knapp i kartet) | Trykk setter punkter, punktene kan dras og fjernes |

Panelet spretter aldri opp av seg selv. Det bytter innhold når du velger en tur,
men det er du som drar det opp når du vil lese mer. Da kan du se på flere turer
etter hverandre uten at kartet blir dekket hver gang.

Stien under pekeren markeres og får navnet sitt vist, så det er synlig at den
kan trykkes på. Turene lastes av seg selv første gang kartet står stille på
zoomnivå 11 eller nærmere – man trenger ikke be om det.

Når man tegner selv, følger ruta stier automatisk. En rett strek over stup og
vann er nesten aldri det noen mener med et trykk i kartet, så «følg sti» er på
som standard og kan slås av under Avansert.

### Første gang

Første gang appen åpnes ligger et lite kort over kartet med tre linjer: kartet
viser merkede stier, panelet nederst kan dras, og turmodus sier hvor langt det
er igjen. Det lukkes med én knapp – eller tilbakeknappen – og kommer ikke
tilbake. Ingenting er sperret bak det.

### Tilbake virker

Lagt til hjemskjerm har appen ingen nettleserlinje. Da er tilbakeknappen på
Android – eller sveipen fra kanten på iPhone – den eneste veien ut av noe man
har åpnet. Alt som legger seg over kartet melder seg inn i en lagstabel, og et
tilbaketrykk tar det øverste laget først:

    kartlagsmeny  →  filtre  →  forhåndsvisning  →  oppslått ark  →  fane

Er alt lukket, gjør tilbake det den skal: lukker appen. Nyere nettlesere har
[CloseWatcher](https://developer.mozilla.org/en-US/docs/Web/API/CloseWatcher),
som er laget nettopp for dette og som også fanger Escape. Der den mangler,
legges det én historikkoppføring per lag. Begge veier ender i `closestack.js`.

### Ett ark, tre stillinger

På mobil ligger alt innholdet i et ark nederst. Det kan **dras med fingeren**,
kastes opp eller ned, og står i tre stillinger:

| Stilling | Hva du ser |
|---|---|
| Sammenslått | Kartet, fanene og det første turkortet – nok til å skjønne hva som finnes |
| Halvveis | Turlista eller turen, med kartet fortsatt synlig over |
| Helt oppe | Bare innholdet, for lesing |

Snur man telefonen sidelengs, blir skjermen lav. Da er kartet viktigere enn
lista: arket krymper til håndtak og faner, og kartknappene legger seg på rad i
stedet for å stable seg nedover kartet.

Hele toppen av arket er dragflate – håndtaket, fanene og turlinja under turen.
Det er mye lettere å treffe enn en tynn strek. Ett trykk på håndtaket slår
arket opp eller sammen.

Arket overtar først når fingeren faktisk har flyttet seg seks piksler. Fanges
pekeren med én gang, blir klikket omadressert til dragflaten, og fanene inni
den slutter å virke. Etter et drag spises det neste klikket, ellers ville
arket sprette tilbake fordi håndtaket rakk å flytte seg under fingeren.

Knappene som ligger i kartet – «Start turen», navnet på stien under fingeren,
forhåndsvisningen og meldingene – vet hvor høyt arket står og legger seg rett
over det. De blir aldri liggende bak arket. Det samme gjelder kartutsnittet:
når en tur vises, får den plass i den delen av kartet du faktisk ser.

Turen er én sammenhengende flate å rulle i. Nøkkeltallene og høydeprofilen lå
før i et eget fast felt, så panelet var delt i to som rullet hver for seg.

### Ta kartet med offline

I fjellet er det ofte ikke dekning, og et kart som må lastes ned mens du står
der er ikke et kart. Under turen ligger **«Last ned kartet for denne turen»**.
Den henter kartrutene langs ruta – 700 meter ut til hver side, på fire
zoomnivåer valgt etter hvor lang turen er – og legger dem i det samme
mellomlageret som service workeren bruker.

- Anslått størrelse vises før du trykker, og framdriften mens den går.
- Ruter som allerede ligger der hentes ikke på nytt.
- Fire om gangen. Kartverket er et fellesgode.
- Dekker ruta et så stort område at det ville blitt over 900 kartruter, sier
  appen fra i stedet for å be om alt.

Flislageret er med vilje **ikke** versjonert. Har du lastet ned kartet for en
tur, skal det ikke forsvinne fordi appen fikk en oppdatering kvelden før.

### Filtrene viser alt de har

Filtrene lå i tre rader som rullet sidelengs. To tredeler av valgene lå utenfor
skjermkanten, i rader man måtte gjette at kunne dras. Nå brytes brikkene over
flere linjer under hver sin overskrift – «Hvor lang tur?», «Hva vil du ha med?»,
«Hvor krevende?», «Hva slags tur?» – og alt er synlig med én gang.

- Å åpne filtrene drar arket helt opp, så man ser hele lista.
- «Vis 34 turer» nederst lukker dem og setter arket tilbake med kartet synlig.
- Lista blir stående der den står når man trykker på et filter. Før hoppet den
  til toppen hver gang.
- Slått sammen vises de påslåtte filtrene som brikker man kan trykke av, så det
  aldri er skjult hvorfor lista er kort.

### Enkelt foran, avansert bak

Det som gjelder de fleste turer – marsjfart og når du starter – ligger framme.
Underlag, sekkevekt, pauser, «følg sti» og GPX ligger sammenslått under
**Avansert**. Kartlagene er flyttet ut av panelet og ligger på en knapp på
selve kartet. Vær og sikkerhet er seksjoner i turen, ikke egne faner, slik at
det er én ting å bla gjennom framfor fem å velge mellom.

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
| [OpenStreetMap via Overpass](https://overpass-api.de/) | Hytter, topper, badeplasser, rasteplasser, toaletter, busstopp og stier der Turrutebasen mangler | ODbL |
| [Wikimedia Commons](https://commons.wikimedia.org/) | Bilder fra turområdene | Per bilde – vises ved hvert foto |
| [Wikipedia (bokmål)](https://no.wikipedia.org/) | Korte stedsbeskrivelser | CC BY-SA 4.0 |
| [Entur Journey Planner](https://developer.entur.org/) | Kollektivforbindelser til startpunktet | NLOD |

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

### Hvorfor ikke Google Maps?

Google Places og Places Photos krever en API-nøkkel knyttet til et
betalingskort. I en statisk nettside uten server ligger den nøkkelen åpent i
koden, og hvem som helst kan bruke den på din regning. Vilkårene til Google
tillater heller ikke å lagre bildene eller vise dem løsrevet fra Google Maps.

Wikimedia Commons krever ingen nøkkel, har frie lisenser, tillater
mellomlagring og har god dekning i norsk natur. Det er derfor bildene kommer
derfra – ikke fordi Google ville vært bedre, men fordi det er den kilden som
faktisk kan brukes slik denne appen er bygget.

Samme sak for turdata: ut.no har ikke lenger noe åpent API, AllTrails og
Komoot har ingen offentlige endepunkter, og Strava krever OAuth per bruker.
Turrutebasen er både åpen og den kilden DNT og kommunene selv leverer til.

### Om bildene

Bildene hentes på to måter. Et **geosøk** finner alt som er geotagget rundt
kartutsnittet; utsnittet deles i fire søk, siden ett søk bare gir de femti
nærmeste og de i en by alle ligger i sentrum. Et **navnesøk** på turens navn
finner i tillegg de bildene ingen har geotagget langs ruta – det er slik
«Preikestolen – Pulpit Rock» og «Tromsdalstinden» dukker opp.

Begge kildene er upresise hver for seg. Et geosøk gir kart, kommunevåpen og en
fotballstadion i nabodalen; et navnesøk på «Preikestolen» gir «Panorama of
Lysefjord». Utvalget siles derfor på filnavn, og rangeres på navnetreff, nærhet
til ruta og om motivet ser ut til å være natur. Uten navnetreff må bildet ligge
tett på ruta, og et navnetreff langt utenfor landskapet forkastes.

Det er fortsatt et bilde *fra området*, ikke nødvendigvis av stien – og det er
sånn det står i appen. I Bergen får rundt 46 av 81 turer et bilde; resten vises
like fint uten.

### Om dekningen

Turrutebasen bygges på leveranser fra kommuner og turlag, og dekningen er
ujevn. Rundt Bergen finner appen over hundre navngitte turer; rundt Gjendesheim
finnes det ikke én eneste kartlagt rute, verken der eller i OpenStreetMap.
Attributtene varierer også: mange ruter mangler gradering, og da står de som
«ugradert» framfor å bli gjettet på.

Appen sier fra når den ikke finner noe, i stedet for å late som. «Følg sti»
tegner en rett strek og forklarer hvorfor, og «Finn tur» foreslår at du tegner
din egen der rutebasen er tom.

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
`main` til <https://guttormsen.github.io/guttormsen/>. Skal dette settes opp i et
nytt repo, må Pages slås på manuelt under **Settings → Pages → Source: GitHub
Actions** – en arbeidsflyt får ikke lov til å gjøre det selv.

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
  trips.js              turforslag: sy sammen ruter, filtrere og sortere
  journal.js            turdagbok, merker og sammenligninger
  photos.js             kobler bilder til riktig tur og siler bort kart og logoer
  sheet.js              bunnarket på mobil: drag, kast og tre stillinger
  closestack.js         tilbakeknappen: hvilket lag som lukkes først
  offline.js            kartrutene langs ruta, lastet ned på forhånd
  trailhit.js           finner hvilken sti som ligger under fingeren
  navigate.js           hvor du er på ruta, hva som gjenstår, og hvilken vei
  features.js           hva finnes langs ruta: bading, bål, buss, tilgjengelighet
  route.js              lengde, stigning, tidsestimat, gradering
  geo.js                ren geometri (avstand, fortetting, forenkling)
  snap.js               stigraf og korteste veg («Følg sti»)
  profile.js            høydeprofilen som SVG, med tastaturstyring
  weather.js            sjekkpunkter, ankomsttider og dagslys
  panels.js             alt innholdet i panelet
  search.js             stedsnavnsøk som tilgjengelig combobox
  share.js              delbare lenker (polylinjekoding)
  gpx.js                GPX inn og ut
  ui.js                 varsler, nedlasting, små byggeklosser
  util.js               formatering på norsk, småting
  api/                  én modul per tjeneste, alle over samme HTTP-lag
test/                   186 enhetstester
test/e2e/smoke.mjs      røyktest i Chromium, 86 sjekker mot ekte tjenester
scripts/skjermbilder.mjs bilder av hver skjerm på telefonstørrelse
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
- Mobil først: bunnark som kan dras, trykkflater på minst 42 px, filterrader
  som rulles sidelengs med uttoning i kanten, ingen vannrett rulling. Røyktesten
  måler både trykkflatene og rullingen.
- Lagt til på hjemskjerm har appen ingen nettleserlinje. Innholdet holder seg
  innenfor `env(safe-area-inset-*)`, så verken toppen eller hjemindikatoren
  spiser noe.
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

Lykkelig tur har ingen server og ingen konto. Turene dine lagres i `localStorage` i
din egen nettleser, og delbare lenker legger turen i URL-ens fragment (`#`),
som aldri sendes til noen tjener. Kartfliser og værvarsler hentes direkte fra
Kartverket, MET og NVE, som naturligvis ser IP-adressen din slik enhver
nettside ville gjort.

## Lisens

Koden er MIT. Dataene har sine egne lisenser – se tabellen over, og ta med
kildehenvisningene hvis du bygger videre.
