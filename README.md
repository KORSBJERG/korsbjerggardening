# Korsbjerg Gardening

Samlet kildekode til Korsbjerg Gardenings hjemmeside, kundeportal og havekontor.

## De tre indgange

- `/` - hjemmeside med video, ydelser, billedgalleri og kontakt.
- `/app` - kundevisning med haveoversigt, opgaver, forbrug, tilbud og beskeder.
- `/kontor` - Antons arbejdsrum med opgaver, kalender, ind-/udtjekning, timer, værktøjsregister og tilbud.

Hjemmesiden linker til kundeportalen og havekontoret. Begge appvisninger har et link tilbage til hjemmesiden. Havekontoret og kundevisningen kan også skiftes fra appens topbjælke.

Aktuel udgivelse: https://antons-korsbjerg-gardening.peaknet.chatgpt.site/

## Kør lokalt

Kræver Node.js 22.13 eller nyere. Den aktive Worker-app har ingen npm-afhængigheder; PDF-biblioteket følger med i `worker/vendor/` med licens.

```sh
node scripts/build-custom.mjs
node scripts/preview-custom.mjs
```

Åbn http://127.0.0.1:3086/. Den lokale preview bruger en simuleret bruger og et midlertidigt datalager i hukommelsen. Lokale ændringer forsvinder, når preview-processen stoppes, og påvirker ikke produktionens data.

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
- `worker/attendance.js` - ind-/udtjekning og tidsregistrering.
- `worker/commerce.js` - værktøjer, priser, tilbud og opgavepriser.
- `worker/quote-pdf.js` - PDF-layout med logo, tilbudslinjer og prisoversigt.
- `worker/quote-delivery.js` - PDF-download, mailkladders vedhæftninger og mailafsendelse.
- `worker/pdf-mail-ui.js` - dialoger til PDF og mail.
- `worker/index.js` - Worker-routes og R2-adgang.
- `.openai/hosting.json` - eksisterende Sites-identitet og lagringsbinding.

Mappen `app/`, komponentbiblioteket og de øvrige framework-filer er bevaret fra det oprindelige starterprojekt. Det aktive build er `scripts/build-custom.mjs`; det skriver den selvstændige Worker til `dist/server/index.js`.

## Data, login og adgang

Den hostede løsning bruger Sites-login og R2-bindingen `BUCKET`. Appdata gemmes pr. autentificeret Site-bruger. Produktionens data, kundernes oplysninger og mailhistorik ligger i det hostede datalager og er ikke med i GitHub-repositoryet.

Sitet er aktuelt privat. Kundevisningen er en demonstration; selvstændig kundeadgang og tildeling af administrator-/kunderoller er endnu ikke implementeret. Et skift til offentlig adgang kræver særskilt afklaring af portalens adgangsmodel. `noindex` og robots-regler er SEO-indstillinger, ikke adgangskontrol.

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
