# CourseDuplicator

Webová aplikace pro hromadnou duplikaci kurzů merchantů Reservanto z jednoho období do druhého. Single-tenant nasazení; merchanti se přihlašují přes Reservanto OAuth-like flow.

## Architektura

- **.NET 10** ASP.NET Core
- **Razor Pages** (server-rendered shell)
- **Vanilla JS** (žádný framework, žádný TypeScript)
- **Žádný CSS framework** (vanilla CSS)
- Veškerá komunikace s Reservanto API probíhá **přes backend handlery** (proxy pattern). Tokeny nikdy neopouští backend.

## Klíčové soubory

- `SPECIFICATION.md` - kompletní funkční specifikace, **vždy konzultuj při změnách**
- `Pages/Index.cshtml` (+ `.cs`) - hlavní stránka s wizardem
- `Services/ReservantoClient.cs` - HttpClient wrapper kolem Reservanto API
- `Services/CourseDuplicationService.cs` - business logika mapování datumů
- `wwwroot/js/duplicator.js` - frontend wizard

## Reservanto API

- Base URL: `https://api.reservanto.cz`
- OpenAPI schéma: `https://api.reservanto.cz/OpenApi/with-merchant.yaml?simple=True`
- Autentizace: STT v hlavičce `Authorization: <STT>`, generuje se z LTT (30min expirace)
- **`Course/GetList` má interval max 31 dní** - dlouhá období se musí načítat po blocích
- **`SimpleCourseApiModel` neobsahuje lekce** - pro lekce se musí volat `Course/Get` per kurz
- `RegistrationEnd` a `SingleLectionBookingEnabled` nejsou v `CourseApiModel` response - při duplikaci se nastavují z globálního UI

## Konvence

- **Časové zóny:** Backend UTC, Reservanto API používá UnixTimeStamp v UTC, frontend zobrazuje v Europe/Prague.
- **Lokalizace:** Čeština. Formát dat: `d. M. yyyy (EEEE)`.
- **Logování:** Strukturované, alespoň každá úspěšná duplikace + všechny chyby z Reservanto API.
- **Žádné secrets v kódu** - jen v `appsettings.json` / user-secrets / env vars.

## Konvence kódu

- C#: nullable reference types ON, file-scoped namespaces, top-level service registrations v `Program.cs`.
- JS: ES6+, žádné build-step, jen statické soubory ve `wwwroot/js/`. Funkční přístup, žádné classes pokud není důvod.
- CSS: BEM-like třídy, žádné inline styly mimo dynamicky generovaných (např. progress bar width).

## Co nedělat

- Negenerovat .NET solutiony pro celý projekt znova - jeden projekt stačí.
- Nepřidávat ORM/databázi - aplikace je stateless mimo session.
- Nepoužívat Blazor, MVC views, ani jiné UI frameworky.
- Nepřidávat npm/webpack/bundlery.
