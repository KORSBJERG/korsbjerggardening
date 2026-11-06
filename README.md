# Korsbjerg Gardening

Samlet kildekode til Korsbjerg Gardenings hjemmeside, kundeportal og havekontor.

## De tre indgange

- `/` - hjemmeside med video, ydelser, billedgalleri og kontakt.
- `/app` - kundevisning med haveoversigt, opgaver, forbrug, tilbud og beskeder.
- `/kontor` - Antons arbejdsrum med opgaver, kalender, ind-/udtjekning, timer, værktøjsregister og tilbud.

Hjemmesiden linker til kundeportalen og havekontoret. Begge appvisninger har et link tilbage til hjemmesiden. Havekontoret og kundevisningen kan også skiftes fra appens topbjælke.

Aktuel udgivelse: https://antons-korsbjerg-gardening.peaknet.chatgpt.site/

## Kør lokalt

Kræver Node.js 24 eller nyere til tests og lokal SQLite-preview. Den aktive Worker-app har ingen npm-afhængigheder; PDF-biblioteket følger med i `worker/vendor/` med licens.

```sh
node scripts/build-custom.mjs
node scripts/preview-custom.mjs
```

Åbn http://127.0.0.1:3086/. Den lokale preview bruger en simuleret ejeridentitet, midlertidig SQLite og et R2-lager i hukommelsen. Lokale ændringer forsvinder, når preview-processen stoppes, og påvirker ikke produktionens data.

Med en almindelig Node/npm-installation kan du også bruge `npm run build`, `npm run dev` og `npm test`.

## Kontroller

```sh
node scripts/test-all.mjs
```

Kontrollerne bygger først Worker-filen og tester derefter routes, datalagring og brugeradskillelse, ind-/udtjekning, tilbud og priser, værktøjer, SEO, PDF-generering og mailfunktionens håndtering af fejl og dubletter. Mailtjenesten simuleres; testene sender ingen rigtige mails. PDF-testfiler placeres i den ignorerede mappe `work/pdf-qa/`.

## Aktive kildefiler

- `worker/front.html` - hjemmesidens layout, billeder, video og kontaktflow.
- `scripts/seo-pages.mjs` - tekster og skabeloner til de seks landingssider.
- `worker/seo.css` - landingssider samt mobil- og tabletjusteringer til hjemmesiden.
- `worker/ui.html` - havekontor og kundevisning.
- `worker/app-responsive.css` - mobil- og tabletvisning i appen.
- `worker/maps.js` og `worker/maps.css` - adressebaserede kort, luftfoto, placering og ruter.
- `worker/attendance.js` - ind-/udtjekning og tidsregistrering.
- `worker/commerce.js` - værktøjer, priser, tilbud og opgavepriser.
- `worker/quote-pdf.js` - PDF-layout med logo, tilbudslinjer og prisoversigt.
- `worker/quote-delivery.js` - PDF-download, mailkladders vedhæftninger og mailafsendelse.
- `worker/pdf-mail-ui.js` - dialoger til PDF og mail.
- `worker/index.js` - Worker-routes.
- `worker/access.js` - serverbaserede roller, sessionskontrol, D1-data og R2-import.
- `worker/access-ui.js` - login, kundehåndlinger og brugeradministration.
- `.openai/hosting.json` - eksisterende Sites-identitet og lagringsbinding.

Mappen `app/`, komponentbiblioteket og de øvrige framework-filer er bevaret fra det oprindelige starterprojekt. Det aktive build er `scripts/build-custom.mjs`; det skriver den selvstændige Worker til `dist/server/index.js`.

## Data, login og adgang

Sites håndterer identitet og login. Worker-koden kontrollerer særskilt adgang på serveren ved hvert beskyttet kald. Den separate Cloudflare Worker indeholder fortsat ingen app-/databindinger og viderestiller `/app` og `/kontor` til Sites.

- Administrator: brugere, roller, invitationer og revisionsoversigt. Adgang til kontorets data kræver desuden `can_operate`.
- Anton / driftsansvarlig: fælles havekontor, kunder, planlægning, priser, tidsregistrering og tilbud. Kan invitere kunder, men ikke administratorer eller andre driftsansvarlige.
- Kunde: kun eksplicit tildelte haver. Serveren sender kun kundevendte felter, publicerede tilbud og eksplicit delte tidsregistreringer. Kunden kan sende beskeder/opgaveønsker og besvare egne tilbud/opgaveforslag. Kundens identitet og svardato bestemmes af serveren.

**Før første udgivelse:** Sæt `PORTAL_OWNER_EMAIL` til ejerens verificerede Sites-login-e-mail i runtime-indstillingerne. Det er ikke en offentlig konfigurationsvariabel. Første match bindes atomisk til ejerens stabile Sites-bruger-id. En vilkårlig første besøgende kan aldrig blive administrator. Ejeren starter med administrator- og driftsadgang og kan ikke spærres fra brugeroversigten. Ingen kunde- eller Anton-identitet er gættet eller forudoprettet.

D1-bindingen `DB` indeholder brugere, havemedlemskaber, invitationer, sessioner, rategrænser og revisionshændelser. Forretningsdata ligger i et fælles versionsstyret JSON-snapshot i D1; det bevarer den eksisterende kontorbrugerflade og giver atomiske konflikttjek på kundesvar og kontorændringer. Dette er en bevidst overgangsmodel, ikke fuldt normaliserede tabeller for hver have/opgave. Snapshotgrænsen er 500 KB; større datamængder kræver efterfølgende normalisering/paginering.

`drizzle/0000_portal_access.sql` er den schema-only D1-migration. Det aktive custom build bruger ikke Drizzle ORM ved runtime. Fremtidige schemaændringer skal tilføjes som nye migrationer, og den medfølgende schemaerklæring holdes ajour.

Ved ejerens første indlæsning importeres eksisterende `gardening/<Sites-bruger-id>.json` fra R2 til D1. Originalen ændres ikke. En ekstra skrivebeskyttet-førstegangsbackup gemmes i `gardening-backups/access-v1/`. Data under andre loginidentiteter sammenflettes ikke automatisk. Ingen eksempeldata indsættes, hvis ejerens R2-fil er tom. Eksisterende mailhistorik bliver liggende uændret under sine oprindelige R2-nøgler; nye afsendelser gemmes fælles under `gardening-business/`.

En kunde inviteres fra **Brugere & adgang**: vælg login-e-mail og præcise haver, opret link og send det selv. Linket udløber efter 48 timer og kan kun bruges én gang af den inviterede verificerede e-mail. Kun tokenhashen gemmes. Linket bruger URL-fragment; portalen sender ingen referrer. Invitationslinks udsendes ikke automatisk. Hvis Sites-audiencen fortsat er privat, skal besøgende også være tilladt af Sites; en applikationsinvitation ophæver ikke platformens adgangspolitik.

App-sessioner er bundet til den aktuelle Sites-identitet med Secure/HttpOnly/SameSite-cookies, CSRF-token og streng Origin-kontrol. Medarbejdersessioner har 8 timers maksimum og 30 minutters inaktivitet; kundesessioner har 7 dages maksimum og 24 timers inaktivitet. Sites-login er fortsat den overordnede login-session; en ny app-session for en allerede Sites-indlogget bruger er ikke en garanti for ny MFA. MFA/passkeys skal aktiveres på login-kontoen; denne kode kan ikke konfigurere eller attestere Sites/ChatGPT MFA. Ingen OAuth-provider eller kodebaseret adgangskode er tilføjet.

Spærring og ændrede haver/roller kontrolleres ved næste kald, og eksisterende app-sessioner tilbagekaldes ved adgangsændringer. Kontorets bulk-save kræver driftsadgang og versionskontrol; kunder har kun afgrænsede operationsendpoints. Tilbudssnapshots er låst efter publicering. Nye beskeder, tilbudssvar og ind-/udtjekning stemples på serveren. Historiske og manuelt rettede tidsregistreringer er driftsfunktioner; noter offentliggøres kun efter eksplicit valg.

`noindex` og robots-regler er kun SEO. Hele Sites-udgivelsen må først åbnes efter test af anonym adgang, rollegrænser og platformens identitetsinjektion. Den offentlige Cloudflare-Worker må aldrig skiftes til `worker/index.js`.

## Havekort

Kort i havekontoret og kundevisningen er interaktive Google Maps-visninger baseret på den valgte haves adresse. Der kan skiftes mellem vejkort og luftfoto, åbnes rutevejledning og gemmes en præcis kortnål som breddegrad/længdegrad. Anton kan rette adressen eller indsætte koordinater kopieret fra Google Maps. Koordinater knyttes til den aktuelle adresse; ændres adressen andetsteds, bruges den nye adresse frem for en forældet kortnål. Placeringer gemmes i kontorets fælles D1-snapshot. Havearealer er registrerede oplysninger, ikke opmåling fra luftfoto.

Google Maps modtager adressen eller koordinaterne, når kortet indlæses. Visningerne kræver internet og afhænger af Googles kortdækning. Ingen API-nøgle eller betalt geokodningstjeneste er tilføjet. Hjemmesidens områdekort viser den offentlige firmaadresse ved Knebel.

## Tilbud og mail

- Tilbud gemmer deres egne priser. En ændret standardtimepris ændrer ikke tidligere tilbud.
- PDF'er kan hentes direkte fra gemte tilbud.
- En `.eml`-mailkladde kan hentes med PDF'en vedhæftet og sendes fra et kompatibelt mailprogram.
- Direkte mailafsendelse kræver `RESEND_API_KEY` og en verificeret `MAIL_FROM` i produktionens runtime-indstillinger. Disse er ikke tilsluttet i den nuværende udgivelse.
- Kontaktformularen på hjemmesiden åbner en mail i den besøgendes mailprogram; den indsender ikke en henvendelse til et CRM.

Se `.env.example` for variabelnavne. Filen indeholder ingen nøgler og indlæses ikke automatisk af den lokale preview.

## SEO-sider

- `/graesslaaning`
- `/haekklipning`
- `/buskrydning`
- `/fast-haveaftale`
- `/havehjaelp-djursland`
- `/havehjaelp-aarhus`

Siderne leveres som HTML med egne titler, beskrivelser, canonical-links, interne links og JSON-LD. `/sitemap.xml` indeholder hjemmesidens syv sider. Kundeportal, havekontor og API-data er markeret til ikke at blive indekseret. Google kan først tilgå hjemmesiden, når den er offentlig. `PUBLIC_SITE_URL` kan sættes til den endelige canonical-domæneadresse, når et eget domæne er tilkoblet.

## Udgivelse og GitHub

Det aktive Sites-projekt er `appgprj_6aee27fe0c788191b135ed3a37de3aae`. Build-output i `dist/` genereres lokalt og er ikke lagt i Git. Sites-versioner udgives gennem Sites' kilde- og deployment-workflow.

GitHub-repositoryet er en kopi af kildekoden. Et push til GitHub udgiver ikke automatisk en ny Sites-version. Der er ikke opsat en løbende GitHub-til-Sites-deploymentintegration.

Billeder og stemningsvideo hentes fra firmaets eksisterende Wix-materiale. Logoet er inkluderet i `worker/assets/`. `pdf-lib` er inkluderet under sin medfølgende MIT-licens.

## Cloudflare Workers Builds fra GitHub

Cloudflare har en selvstændig konfiguration i `wrangler.jsonc`. Den vælger Worker-entrypointet eksplicit, så de bevarede framework-filer ikke starter automatisk Next.js/Hydrogen-detektion.

I Cloudflare Workers Builds bruges repository-roden og branchen `main`. Deploy-kommandoen kan være `npx wrangler deploy`; Wrangler kører selv `node scripts/build-custom.mjs` fra konfigurationens `build.command`. Der er derfor ikke krav om en særskilt build-kommando i dashboardet. Worker-navnet i Cloudflare skal matche `korsbjerggardening` i konfigurationen; hvis din eksisterende Worker har et andet navn, tilpasses `name` til det navn.

Den selvstændige Cloudflare-udgivelse viser den offentlige hjemmeside og dens landingssider. `/app` og `/kontor` sender besøgende videre til den eksisterende beskyttede Sites-app via `PORTAL_ORIGIN`. Appens API-routes eksponeres ikke af den offentlige Worker. Dermed bruges det eksisterende login og datalager, og der skal ikke oprettes en tom erstatningsdatabase i den nye Worker.

`worker/index.js` er fortsat entrypointet i Sites-buildet. `worker/cloudflare.js` er entrypointet til selvstændig Cloudflare-hosting. De to udgivelser deler hjemmesidens kildekode, men har hver sin deployment.

Valider Cloudflare-pakken uden at udgive:

```sh
npx wrangler@4.158.0 deploy --dry-run --outdir work/wrangler-dry-run
```

Cloudflare-konto, API-token og egne domæner konfigureres i Cloudflare og indgår ikke i repositoryet.
