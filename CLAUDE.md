# CourseDuplicator

Webová aplikace pro hromadnou duplikaci kurzů merchantů Reservanto z jednoho období do druhého. Single-tenant nasazení; merchanti se přihlašují přes Reservanto OAuth-like flow. Všechny sekce specifikace (A-G) jsou implementované včetně rozšíření ze spec kapitoly 12 (seskupení kurzů, přesahující kurzy, strategie „Nový rozvrh podle týdenního rytmu", vynechané dny a svátky CZ/SK, hromadná úprava názvů). Mimo rozsah zůstávají kurzy s více lekcemi týdně a časová pravítka (spec 11, bod 4).

## Architektura

- **.NET 10** ASP.NET Core
- **Razor Pages** (server-rendered shell, jediná stránka `Index` + JSON handlery)
- **Vanilla JS** (žádný framework, žádný TypeScript)
- **Reservanto Design System** (`wwwroot/css/design/` - **drž se ho při každé změně UI**): třídy `rds-*`, sémantické tokeny `--color-*`/density, merchant téma. `tokens.css` je runtime vrstva, `_tokens.scss` jen build-time zrcadlo. Pozn.: komponenty DS nastavují `display`, viditelnost přes atribut `hidden` jistí `[hidden] { display: none !important; }` v `site.css`.
- Veškerá komunikace s Reservanto API probíhá **přes backend handlery** (proxy pattern). Tokeny nikdy neopouští backend.
- **Mapování datumů běží ve frontendu** (`mapping.js`, spec 6) - backend přijímá hotové UnixTimestampy.

## Klíčové soubory

- `SPECIFICATION.md` - kompletní funkční specifikace, **vždy konzultuj při změnách a drž aktuální**
- `Pages/Index.cshtml` (+ `.cs`) - hlavní stránka; handlery `Segments`, `LoadCourses`, `CheckPeriod`, `CreateCourses`
- `Pages/Auth/` - Login / Callback / Logout (Reservanto autorizační flow)
- `Services/ReservantoClient.cs` - HttpClient wrapper kolem Reservanto API
- `Services/AuthService.cs` - LTT/STT v session, STT cache (TTL 25 min), CSRF flag callbacku
- `Filters/RequireAuthAttribute.cs` - globální page filtr, výjimky `/Auth/*` a `/Error`
- `wwwroot/js/mapping.js` - pure funkce mapování datumů (namespace `CourseDuplicator.Mapping`), detekce rytmu, generování lekcí, svátky CZ/SK + tabulka výjimek po letech (spec 6.6), seskupení kurzů a hromadná úprava názvů
- `wwwroot/js/mapping.test.html` - standalone testy mapování, otevřít v prohlížeči, vše musí být zelené
- `wwwroot/js/duplicator.js` - frontend: state (spec 4.2), API volání, render sekcí A-G

## Autentizace (spec 3)

- **Žádný ClientSecret ani OAuth `state`** - Reservanto je nepoužívá. CSRF řeší session flag „awaiting callback".
- `Reservanto:ClientId` je v **user-secrets**, nikdy v repu.
- Callback `https://localhost:5001/Auth/Callback` je registrovaný u Reservanta → dev se pouští přes profil `https` (port 5001): `dotnet run --launch-profile https`.
- LTT je trvalý (do revokace), STT krátkodobý; obojí jen v session (in-memory).

## Reservanto API

- Base URL: `https://api.reservanto.cz`
- OpenAPI schéma: `https://api.reservanto.cz/OpenApi/with-merchant.yaml?simple=True`
- Autentizace: STT v hlavičce `Authorization: <STT>` (surová hodnota, ne Bearer), generuje se z LTT (30min expirace)
- **`Course/GetList` má interval max 31 dní** - dlouhá období se načítají po blocích s dedupem podle Id
- **`SimpleCourseApiModel` neobsahuje lekce** - pro lekce se musí volat `Course/Get` per kurz (max 5 souběžně)
- `SingleLectionBookingEnabled/From` nejsou v `CourseApiModel` response - při duplikaci se nastavují z globálního UI; `CalendarId` se čte z prvního appointmentu
- Limity souběhu: `Course/Get` max 5, `Course/Create` max 3; 429 → backoff 1/2/4 s, max 3 retry

## Konvence

- **Časové zóny:** Backend UTC, Reservanto API používá UnixTimeStamp v UTC, frontend zobrazuje v Europe/Prague. Posuny dnů v JS jsou kalendářní (zachovávají hodinu přes DST).
- **Lokalizace:** Čeština. Formát dat: `d. M. yyyy (EEEE)`, s časem `d. M. yyyy (EE) H:mm`.
- **Logování:** Strukturované, alespoň každá úspěšná duplikace + všechny chyby z Reservanto API.
- **Žádné secrets v kódu** - jen v user-secrets / env vars.
- **Preferences cookie `cd_prefs`** (30 dnů) drží naposledy zadané hodnoty formulářů.

## Konvence kódu

- C#: nullable reference types ON, file-scoped namespaces, top-level service registrations v `Program.cs`.
- JS: ES6+, žádné build-step, jen statické soubory ve `wwwroot/js/`. Funkční přístup, žádné classes pokud není důvod. State je vystavený jako `window.CourseDuplicator.state` pro ladění.
- CSS: BEM-like třídy, žádné inline styly mimo dynamicky generovaných (např. progress bar width).

## Testování

- `mapping.test.html` - testy mapovací logiky bez frameworku (otevřít v prohlížeči).
- Frontend interakce se dají smoke-testovat bez přihlášení: dočasná HTML stránka s markup z `Index.cshtml` + zastubovaný `window.fetch` (mimo repo, např. `/tmp`).
- Plný E2E test vyžaduje přihlášení na testovací účet Reservanta - **`CreateCourses` reálně vytváří kurzy**, testovat s malým obdobím.

## Co nedělat

- Negenerovat .NET solutiony pro celý projekt znova - jeden projekt stačí.
- Nepřidávat ORM/databázi - aplikace je stateless mimo session.
- Nepoužívat Blazor, MVC views, ani jiné UI frameworky.
- Nepřidávat npm/webpack/bundlery.
- Nespouštět vlastní instanci na portech 5001/5240, pokud tam už běží uživatelova (debugger ve VS Code).
