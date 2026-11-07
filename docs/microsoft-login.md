# Microsoft 365 og kundeinvitationer

Implementeret: Anton logger ind med Microsoft 365. Kunder opretter deres konto fra en mailinvitation og bruger derefter engangslinks til login. Ingen kundeadgangskoder opbevares. **Integrationen er ikke aktiveret i produktion endnu.**

Den aktuelle Sites-portal bruger fortsat Sites-login. Microsoft-flowet er beregnet til den selvstændige Cloudflare Worker, hvor appen kan være offentligt tilgængelig med sin egen loginbeskyttelse. Sites' private adgang ændres ikke. Standardfilen `wrangler.jsonc` beholder viderestillingen, indtil opsætning og dataflytning er klar. Microsoft-login aktiveres med `PORTAL_AUTH_MODE=microsoft` på den selvstændige Worker; samme indstilling må ikke aktiveres på det private Sites-origin.

## 1. Microsoft Entra

En Microsoft 365-administrator opretter en single-tenant appregistrering, fx **Korsbjerg Haveportal**. Vælg platform **Web** med denne præcise redirect-URI:

```
https://korsbjerggardening.peter-be8.workers.dev/auth/microsoft/callback
```

Ved senere domæneskift skal redirect-URI og `PORTAL_PUBLIC_ORIGIN` opdateres sammen. Brug authorization code-flow; aktiver ikke implicit grant eller public client-flow. Login beder kun om `openid profile email`. Microsoft Graph-adgang er ikke nødvendig til dette login.

Registrér i Cloudflares runtime-indstillinger:

| Indstilling | Værdi |
| --- | --- |
| `MS_TENANT_ID` | Directory (tenant) ID fra appregistreringen |
| `MS_CLIENT_ID` | Application (client) ID |
| `MS_ADMIN_OBJECT_ID` | **Brugerens** Object ID for `anton@korsbjerg.dk` under Entra → Users. Ikke appens Object ID. |
| `MS_ADMIN_EMAIL` | `anton@korsbjerg.dk` |
| `MS_CLIENT_PRIVATE_KEY` | Privat RSA-nøgle i PKCS#8 PEM-format; kun som Cloudflare-secret |
| `MS_CLIENT_CERT_SHA256` | Base64url-kodet SHA-256-fingeraftryk af certifikatets DER-data |
| `PORTAL_PUBLIC_ORIGIN` | `https://korsbjerggardening.peter-be8.workers.dev` |

I Korsbjergs tenant blokerer den eksisterende politik klienthemmeligheder. Brug derfor certifikat under **Certificates & secrets → Certificates → Upload certificate**. Upload kun det offentlige `.cer`-certifikat. Gem den tilhørende private nøgle som runtime-secret `MS_CLIENT_PRIVATE_KEY` i Cloudflare. Ændr ikke tenant-politikken. Koden sender en kortlivet PS256-signeret client assertion med `x5t#S256`, audience, issuer, subject og et unikt jti. Certifikatet skal roteres før udløb; upload et nyt offentligt certifikat og skift runtime-nøgle/fingeraftryk samlet. Fallback `MS_CLIENT_SECRET` findes kun til miljøer, hvor politikken tillader det; den bruges ikke, når en privat nøgle er konfigureret.

Administratoradgang afgøres af det signerede tenant-id og Antons uforanderlige bruger-Object ID, ikke af en mailadresse sendt fra browseren. Tokenkontrol bruger den medfølgende `jose`-pakke, RS256, fast Microsoft-issuer/JWKS, audience, levetid og nonce. OAuth bruger PKCE, et browserbundet state-cookie og engangs-state. Microsoft-token og privat nøgle sendes aldrig til browseren eller kundemails. MFA styres i Microsoft 365.

Microsofts vejledning: [Appregistrering](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc), [certifikatbaserede credentials](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials).

## 2. Mailafsendelse

Brug den eksisterende SMTP2GO-konto. Sæt `MAIL_PROVIDER=smtp2go`, `SMTP2GO_API_KEY` som secret og `MAIL_FROM` til den verificerede afsender, fx `Korsbjerg Gardening <Gardening@Korsbjerg.dk>`. Disse kræves til direkte invitationer og efterfølgende kundelogin. Nøglen behøver kun `/email/send`; deaktiver klik- og åbningssporing, så personlige loginlinks ikke omskrives eller spores. Hemmeligheder skal indtastes direkte i runtime-indstillingerne, ikke sendes i chat eller lægges i GitHub.

Fra **Brugere & adgang** kan driftsbrugeren sende en testmail til den konfigurerede administratoradresse (standard `anton@korsbjerg.dk`). Testen indeholder kun portalens adresse og ingen kundeoplysninger. Kundekonti har ikke adgang til denne handling, og modtageren kan ikke ændres via browserens request.

Fra **Brugere & adgang → Inviter bruger** vælger Anton navn, mail og haver og trykker **Send invitation på mail**. Status betyder accepteret af mailtjenesten, ikke bevis for levering til indbakken. **Opret mailkladde** åbner invitationen i Antons mailprogram; den sender ikke automatisk. I Microsoft-tilstand kan der kun inviteres kunder; administratoren fastlægges i Entra-opsætningen.

Invitationen er gyldig i 48 timer. Kunden bekræfter **Opret min konto** og får præcis invitationens mailadresse og haver. Loginlinks gælder 15 minutter. Begge bruger hemmelige engangstokens, som gemmes som hash. Links ligger i URL-fragmentet, så de ikke sendes i almindelige GET-requests/logs, og bekræftes med POST, så en mail-linkscanner ikke opretter en konto ved blot at følge linket. Kundens indbakke er adgangsfaktoren; invitations- og loginlinks skal behandles som personlige.

## 3. Cloudflare-data og aktivering

1. Opret/tilslut en D1-database som `DB` og en R2-bucket som `BUCKET`. Tilpas eksemplet `wrangler.portal.example.jsonc` med de rigtige ressource-id'er; det er ikke en aktiv deploy-konfiguration. Hold `PORTAL_AUTH_MODE` fraværende under klargøringen.
2. Anvend `drizzle/0000_portal_access.sql` og `drizzle/0001_microsoft_customer_login.sql` i den nye database. Med en særskilt konfigurationsfil kan dette gøres med `npx wrangler d1 migrations apply DB --remote --config <din-konfiguration>`. Brug ikke første migration igen på en allerede oprettet portal-database.
3. **Bevar eksisterende oplysninger:** Hent en sikkerhedskopi som nuværende Sites-administrator fra `/api/access/export`. Opbevar den privat uden for Git. Forbered SQL med `node scripts/prepare-state-import.mjs <backup.json> work/import.sql`, gennemgå og indlæs den i den tomme måldatabase. Importen fejler, hvis forretningsdata allerede findes; den overskriver ikke. Flyt eventuelle R2-dokumenter/mailkvitteringer særskilt. Sites-database, Sites-bruger-id'er, sessioner og R2-filer er ikke automatisk delt med din egen Cloudflare-konto.
4. Indstil Microsoft- og mailværdierne og test i en separat Cloudflare preview/staging-udgivelse med egne dataressourcer og præcis registreret callback-URI. Brug en rigtig, inviteret testmail, og kontroller Microsoft-login, maillevering, invitation, genlogin, kundeadskillelse, PDF og spærring.
5. Aktivér først derefter `PORTAL_AUTH_MODE=microsoft` og deploy den konfiguration, der indeholder `DB` og `BUCKET`. Appen åbner da på samme Cloudflare-origin som hjemmesiden. Den eksisterende Sites-portal og dens data bevares til tilbagefald; gamle Sites-kunder skal inviteres til den nye loginmodel.

Konfigurationen er kodeklar, men oprettelse af Entra-app, Cloudflare-ressourcer, dataflytning og verificering af mailafsender kræver adgang til de pågældende konti. De er ikke udført af implementeringen.

[Cloudflare D1-migrationer](https://developers.cloudflare.com/d1/reference/migrations/). [SMTP2GO mailafsendelse](https://developers.smtp2go.com/docs/send-an-email), [PDF-vedhæftninger](https://developers.smtp2go.com/docs/adding-attachments), [regionale endpoints](https://developers.smtp2go.com/docs/endpoints).

Appen bruger SMTP2GOs faste EU-endpoint. `korsbjerg.dk` skal godkendes som senderdomæne, da den eksisterende DMARC-politik afviser enkeltafsender-godkendelse. Tilføj de tre nye CNAME-poster fra SMTP2GO uden at ændre eksisterende MX-, SPF- eller DMARC-poster. API-nøgler og private certifikatnøgler må aldrig indgå i kildekode eller GitHub.

Afsendelser registreres før provider-kaldet. SMTP2GO kaldes én gang; samme transaktions-id kan ikke skabe en ekstra mail. Et timeout eller uklart svar markeres som ukendt og genafsendes ikke automatisk. Kontroller SMTP2GO Activity, før en ny afsendelse oprettes. Resend understøttes fortsat til ældre konfigurationer; den valgte provider ændres ikke automatisk ved fejl.

## Kontrol

`node scripts/test-all.mjs` omfatter den eksisterende portal og den nye loginmodel. Microsoft-signaturer og PS256-client assertions testes med et lokalt RSA-nøglepar og falske provider-responser; mails simuleres. Ingen rigtige kundemails udsendes af testene. Testene dokumenterer ikke, at den endnu ikke konfigurerede Microsoft/SMTP2GO-integration fungerer i produktion.
