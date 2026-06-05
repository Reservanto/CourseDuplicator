# Reservanto Course Duplicator - Specifikace

## 1. Účel

Webová aplikace umožňující merchantům Reservanto hromadně zduplikovat definice kurzů z jednoho časového období do dalšího. Typický scénář: kurzy z ledna-května se zduplikují do období od září dál, se zachováním stejné týdenní struktury (pondělní kurz zůstane pondělní).

## 2. Technologie

- **Backend:** ASP.NET Core na .NET 10, Razor Pages
- **Frontend:** Vanilla JS (ne TypeScript), žádný CSS framework
- **Architektura:** Server-side Razor Page jako shell; veškerá komunikace s Reservanto API probíhá přes backend handlery (proxy). API klíče / tokeny **nikdy** neopouští backend.
- **Hosting:** Single-tenant aplikace hostovaná Petrem. Merchanti (uživatelé) se přihlašují přes OAuth-like flow Reservanta (LongTimeToken → ShortTimeToken).

## 3. Autentizace

Postupuje podle oficiální dokumentace: https://api.reservanto.cz/Help-intro/Descriptions/MerchantAuthorization

### 3.1 Prerekvizity (deployment)

Aplikace musí být **u Reservanta zaregistrována**:
- Získat `clientId` (UUID).
- Zaregistrovat `redirectUrl` (callback URL aplikace) na straně Reservanta. Reservanto akceptuje jen předem registrované redirectUrl.

### 3.2 Princip

- **LongTimeToken (LTT)** - získává se přesměrováním uživatele na autorizační endpoint Reservanta, kde merchant souhlas potvrdí. Reservanto pak přesměruje uživatele zpět na `redirectUrl` s tokenem v query parametru.
- **ShortTimeToken (STT)** - generuje se z LTT přes `POST /v1/Authorize/GetShortTimeToken`. Krátká platnost (cca 30 minut). Předává se v hlavičce `Authorization: <STT>` u všech ostatních volání API.

### 3.3 Autorizační URL

Uživatel se přesměruje na:
```
GET https://api.reservanto.cz/v1/Authorize/GetLongTimeToken
  ?clientId=<UUID>
  &redirectUrl=<URL-encoded callback URL>
  &rights=Segment_r
  &rights=Course_r
  &rights=Course_w
  &rights=BookingResource_r
  &rights=BookingService_r
```

`rights` se opakuje pro každé požadované oprávnění.

**Pro Course Duplicator požadujeme tato práva:**
- `Segment_r` - načtení dropdown segmentů (potvrzeno: `/v1/Segment/GetList`)
- `Course_r` - načtení existujících kurzů a jejich detail (potvrzeno: `/v1/Course/GetList`, `/v1/Course/Get`)
- `Course_w` - vytváření nových kurzů (potvrzeno: `/v1/Course/Create`)
- `BookingResource_r` - pravděpodobně potřeba pro plnění `BookingResourceName` v response (TODO ověřit při testování - pokud se vrací jako null, je to potřeba)
- `BookingService_r` - pravděpodobně potřeba pro `BookingServiceName` (TODO ověřit)

### 3.4 Callback

Po souhlasu nebo zamítnutí Reservanto přesměruje uživatele zpět na zaregistrovanou `redirectUrl` s parametry:

| Případ | Query parametry |
|---|---|
| Uživatel souhlasil | `?accepted=1&token=<LTT GUID>` |
| Uživatel zamítl | `?accepted=0&token=` (prázdný token) |

Aplikace v callback handleru:
- Pokud `accepted=0` → zobrazit UI „Autorizace zrušena", odkaz „Zkusit znovu".
- Pokud `accepted=1` → uložit `token` jako LTT do session, redirect na `/`.

### 3.5 CSRF protection

**Reservanto nepodporuje OAuth `state` parametr** (dokumentace ho nezmiňuje). Místo toho použijeme **session flag**:

1. Před přesměrováním na autorizaci aplikace nastaví v session `awaitingAuthCallback = true` + timestamp (TTL 10 minut).
2. Callback handler kontroluje flag - bez něj odmítne s 400.
3. Po úspěšném zpracování flag smaže.

Toto je slabší ochrana než `state` (útočník s přístupem k uživatelově session cookie by ji obešel), ale standardní řešení pro neOAuth flow.

### 3.6 Konfigurace

V `appsettings.json` (nebo přes user-secrets pro produkci):
```json
{
  "Reservanto": {
    "ApiBaseUrl": "https://api.reservanto.cz",
    "ClientId": "<UUID získané registrací u Reservanta>",
    "CallbackUrl": "https://<host>/Auth/Callback",
    "RequestedRights": [
      "Segment_r",
      "Course_r",
      "Course_w",
      "BookingResource_r",
      "BookingService_r"
    ]
  }
}
```

**Žádný `ClientSecret` - Reservanto ho nepoužívá.** Bezpečnost je zajištěna registrací `redirectUrl`.

### 3.7 Implementace STT cache

- STT se generuje on-demand a cachuje v session s expirací 25 minut (5min safety margin před 30min platností).
- Při expiraci STT se transparentně regeneruje z LTT.
- Pokud LTT vrátí chybu při generování STT (expiroval, byl revokován), uživatel je redirectován na autorizační flow.

## 4. Datový model

### 4.1 Reservanto entity (jen relevantní pole)

**Segment** (zaměření obchodníka, např. „kurzy jógy"):
- `Id`, `Name`

**SimpleCourseApiModel** (z `Course/GetList`):
- `Id`, `Name`, `Description`
- `BookingResourceId`, `BookingServiceId` (nullable), `BookingResourceName`, `BookingServiceName`
- `Capacity`, `PriceWithVat` (nullable)
- `StartDate`, `EndDate` (UnixTimeStamp)
- `LectionCount` (počet lekcí, ale lekce samotné nejsou)

**CourseApiModel** (z `Course/Get`):
- Vše z `SimpleCourseApiModel` + `Appointments[]` (jednotlivé lekce) + `RegistrationEnd`
- Nemá `SingleLectionBookingEnabled` ani `SingleLectionBookingFrom` - tyto se z původního kurzu nedají načíst.

**AppointmentClassApiModel** (lekce kurzu):
- `Id`, `StartDate`, `EndDate`, `Capacity`

### 4.2 Aplikační model (frontend state v JS)

```js
state = {
  // Vstup ze sekce A
  segmentId: number,
  sourceFrom: Date,  // datum OD zdrojového období
  sourceTo: Date,    // datum DO zdrojového období

  // Vstup ze sekce C
  newFrom: Date | null,         // nové datum OD (null = ještě nezadáno)
  shiftStrategy: 'weekday' | 'exact',  // mapování dne v týdnu

  // Vstup ze sekce E
  singleLectionBookingEnabled: boolean,
  singleLectionBookingFrom: Date | null,
  registrationEndStrategy: 'keepOffset' | 'atStart' | 'daysBefore',
  registrationEndDaysBefore: number,  // jen pro 'daysBefore'

  // Načtená data + lokální stav
  courses: [
    {
      // Originální data z Reservanto API (neměnná):
      originalId: number,
      name: string,
      description: string,
      bookingResourceId: number,
      bookingResourceName: string,
      bookingServiceId: number | null,
      bookingServiceName: string,
      capacity: number,
      priceWithVat: number | null,
      originalStartDate: Date,
      originalEndDate: Date,
      originalRegistrationEnd: Date,
      lections: [
        {
          originalStart: Date,
          originalEnd: Date,        // pro výpočet LengthMinutes
          isExcluded: false,
          isPinned: false,
          pinnedNewStart: Date | null   // jen pokud isPinned
        }
      ],
      // Lokální stav:
      isExcluded: false
    }
  ]
}
```

Backend interně používá ekvivalentní C# modely pro deserializaci response z Reservanto API a pro request body při vytváření.

## 5. Uživatelský flow

Aplikace je **jedna stránka s progresivním odhalováním sekcí**, ne klasický wizard s krokem 1/2/3. Sekce se odhalují podle toho, jak uživatel postupuje, ale dříve vyplněné inputy zůstávají editovatelné.

### Sekce A: Volba zdrojového období

- Dropdown **Segment** (pokud má merchant jen jeden, automaticky předvybrán a sekce je sbalená).
- Inputy **datum OD** a **datum DO** zdrojového období.
- Tlačítko **„Načíst kurzy"**.

Po stisknutí: backend vrátí seznam kurzů včetně všech lekcí. Stav se uloží do JS objektu `state.sourceCourses[]`.

### Sekce B: Přehled načtených kurzů (read-only kontrola)

Zobrazí se hned po načtení (před zadáním nového data). Účel: uživatel zkontroluje, že vybral správné období a kurzy.

Tabulka kurzů:
- Název kurzu | Zdroj/služba | Kapacita | Počet lekcí | Rozsah dat (OD – DO + den v týdnu prvního a posledního dne)
- Křížek - vyloučí kurz z duplikace (rovnou v tomto kroku, ať uživatel nemusí potom)

Pod tabulkou: „Načteno X kurzů s celkem Y lekcemi. Vyloučeno Z kurzů."

### Sekce C: Cílové období

Zobrazí se, jakmile je v sekci B aspoň jeden kurz.

- Input **nové datum OD** (datetime picker, jen datum). Při změně se okamžitě (v JS) přepočítají všechny nové datumy lekcí.
- Radio buttons **strategie mapování dne v týdnu**:
  - **Zachovat dny v týdnu** (výchozí) - posun zaokrouhlený na celé týdny. Efektivní datum OD se může lišit od zadaného o ±3 dny.
  - **Přesný posun** - posun přesně podle zadaného data, dny v týdnu se posunou.
  - Změna této volby okamžitě přepočítá všechny lekce.
- Read-only zobrazení:
  - **Efektivní datum OD** (při strategii „zachovat dny v týdnu" se může lišit od zadaného)
  - **Vypočtené datum DO** = maximum z nových datumů poslední lekce ze všech ne-vyloučených kurzů.
- **Validace: nové datum OD musí být v budoucnu** (> now). Datum v minulosti zobrazí chybu
  a chová se jako nezadané (sekce D/E se skryjí, tlačítko „Vytvořit kurzy" je disabled).
  Date input má `min` nastavené na zítřek.
- **Kontrola obsazenosti cílového období:** po zadání/změně nového data OD (a při každém
  přepočtu, který změní vypočtené DO - strategie, pin, vyloučení) frontend zavolá `CheckPeriod`
  (viz 7.7) pro interval efektivní OD - vypočtené DO. Výsledek se zobrazí pod vypočtenými daty:
  zeleně „V novém období zatím žádné kurzy nejsou.", oranžově „Pozor: v novém období již existuje
  X kurzů (názvy, …)". Kontrola je informativní - vytvoření neblokuje. Volání je debounced
  (500 ms) se zahazováním zastaralých odpovědí.

### Sekce D: Detail kurzů s novými datumy

Zobrazí se, jakmile je vyplněno nové datum OD v sekci C.

Tabulka kurzů (rozšíření tabulky z B, plus nové datumy):
- Název | Zdroj/služba | Kapacita | Lekcí | Původní (OD – DO) | Nové (OD – DO) | [křížek] | [▸ detail]

Klik na „detail" rozbalí seznam jednotlivých lekcí daného kurzu:
- Pořadí | Původní datum + den v týdnu | Nové datum + den v týdnu | Délka | [křížek] | [edit]
- Křížek - vyloučí konkrétní lekci (ostatní zůstanou).
- Edit (klik na nové datum, input se stane editovatelným) - umožní ručně přepsat datum konkrétní lekce (`datetime-local`).
- **Změna data jakékoli lekce nepřepočítává ostatní lekce** - jen ručně přepsaná lekce se odpojí od globálního přepočtu (drží si vlastní hodnotu). Pokud uživatel později změní globální „nové datum OD", ručně editované lekce zůstanou na svých hodnotách. UI ručně editované lekce vizuálně odliší (např. ikona „připnuto") a nabídne tlačítko „obnovit automatický výpočet".
- Pokud uživatel přepíše datum **první lekce** a v sekci E je zvolena strategie RegistrationEnd „zachovat offset", **RegistrationEnd kurzu se přepočítá automaticky** podle nového data první lekce.

### Sekce E: Globální nastavení nových kurzů

Zobrazí se zároveň se sekcí D.

- Checkbox **„Povolit rezervace jednotlivých lekcí"** - mapuje se na `SingleLectionBookingEnabled` všech nových kurzů. Default: nezaškrtnuto.
- Pokud checkbox zaškrtnut: input **„Povolit rezervace jednotlivých lekcí od (datum)"** - mapuje se na `SingleLectionBookingFrom`. Default: prázdné = od začátku.
- Dropdown **„Konec registrace"** (`RegistrationEnd`):
  - **Zachovat offset** (výchozí) - pro každý kurz se vypočte `(původní StartDate - původní RegistrationEnd)` ve dnech, stejný offset se aplikuje na nový kurz vůči nové první lekci.
  - **Začátek první lekce** - `RegistrationEnd` = StartDate prvního termínu kurzu.
  - **N dní před začátkem** + input pro N - `RegistrationEnd` = StartDate prvního termínu - N dní.

### Sekce F: Potvrzení a vytvoření

Vždy viditelná na spodku stránky.

- Souhrn: **„Bude vytvořeno X kurzů s celkem Y lekcemi."**
- Disabled tlačítko **„Vytvořit kurzy"** dokud není zadáno nové datum OD a alespoň jeden kurz není vyloučen.
- Po kliknutí: AJAX volání backendu, který sekvenčně vytváří kurzy (max 3 paralelně). Frontend ukazuje progress bar a aktuální stav („Vytvářím 5/23: Jóga začátečníci").
- Při chybě u konkrétního kurzu: pokračovat dál, chybu zaznamenat do souhrnu.

### Sekce G: Výsledek

- „Vytvořeno X kurzů (z toho 0/Y úspěšně)."
- Seznam případných chyb s detailem (název kurzu + chybová zpráva z API).
- Tlačítko **„Vytvořit další"** (vrátí na začátek stránky, vyprázdní stav).

## 6. Mapovací logika

Mapování probíhá **v JavaScriptu na frontendu** (pro okamžitý přepočet při změně inputu). Backend mapování neimplementuje - přijímá od frontendu finální UnixTimestamp hodnoty pro `Lections[].Start`.

### 6.1 Strategie „Zachovat dny v týdnu"

```
zadanyNovyOD = uživatelský vstup (jen datum)
puvodniOD = datum OD zdrojového období (uživatelský vstup ze sekce A)

rozdilDni = (zadanyNovyOD - puvodniOD).Days
rozdilTydnu = Math.round(rozdilDni / 7)
posunDni = rozdilTydnu * 7

efektivniNovyOD = puvodniOD + posunDni

PRO KAŽDOU lekci, která NENÍ ručně připnutá:
  nove_datum_lekce = puvodni_datum_lekce + posunDni  (celé datum+čas)
```

### 6.2 Strategie „Přesný posun"

```
posunDni = (zadanyNovyOD - puvodniOD).Days

PRO KAŽDOU lekci, která NENÍ ručně připnutá:
  nove_datum_lekce = puvodni_datum_lekce + posunDni
```

### 6.3 Ručně připnuté lekce

Lekce, kterou uživatel ručně přepsal v sekci D, dostane atribut `isPinned: true` a `pinnedNewStart: <hodnota>`. Globální přepočet (při změně nového data OD nebo strategie) ji přeskočí.

Tlačítko „obnovit automatický výpočet" u lekce smaže `isPinned` a `pinnedNewStart`, lekce se zpětně zapojí do globálního přepočtu.

### 6.4 Vypočtený `RegistrationEnd` per kurz

Závisí na volbě v sekci E:

**Zachovat offset** (default):
```
puvodniOffset = puvodni_StartDate_kurzu - puvodni_RegistrationEnd_kurzu  (v ms / sekundách)
nove_RegistrationEnd = nove_StartDate_kurzu - puvodniOffset
```
kde `nove_StartDate_kurzu` = minimum z `nove_datum_lekce` všech ne-vyloučených lekcí kurzu.

**Začátek první lekce:**
```
nove_RegistrationEnd = nove_StartDate_kurzu
```

**N dní před začátkem:**
```
nove_RegistrationEnd = nove_StartDate_kurzu - N*86400 sekund
```

### 6.5 Vypočtený datum DO období (zobrazení v sekci C)

```
novyDO = MAX přes všechny ne-vyloučené lekce všech ne-vyloučených kurzů z nove_datum_lekce.endTime
```
kde `endTime = newStart + LengthMinutes`.

## 7. API integrace

### 7.1 Backend handlery (Razor Page handlery)

Aplikace má jednu Razor Page (`Pages/Index.cshtml`) s těmito handlery:

| Handler | URL | Volá Reservanto API |
|---|---|---|
| `OnGetSegmentsAsync` | `GET /?handler=Segments` | `POST /v1/Segment/GetList` |
| `OnPostLoadCoursesAsync(LoadRequest)` | `POST /?handler=LoadCourses` | `POST /v1/Course/GetList` (po měsíčních blocích) + per kurz `POST /v1/Course/Get` |
| `OnPostCheckPeriodAsync(CheckPeriodRequest)` | `POST /?handler=CheckPeriod` | `POST /v1/Course/GetList` (po měsíčních blocích) |
| `OnPostCreateCoursesAsync(CreateRequest)` | `POST /?handler=CreateCourses` | Pro každý kurz `POST /v1/Course/Create` |

Request/response body je JSON. Antiforgery token je vyžadován na všech POST handlerech a posílá se z JS v hlavičce `RequestVerificationToken`.

### 7.2 Request body pro `CreateCourses`

Frontend posílá kompletní data pro vytvoření kurzů (mapování datumů už proběhlo v JS):

```json
{
  "globalSettings": {
    "singleLectionBookingEnabled": false,
    "singleLectionBookingFrom": null
  },
  "courses": [
    {
      "name": "Jóga začátečníci",
      "description": "...",
      "segmentId": 42,
      "bookingResourceId": 100,
      "bookingServiceId": 200,
      "capacity": 15,
      "priceWithVat": 250.00,
      "registrationEnd": 1758355200,  // UnixTimestamp - spočteno v JS
      "calendarId": 5,  // null = výchozí
      "lections": [
        { "start": 1758441600, "lengthMinutes": 60 },
        { "start": 1759046400, "lengthMinutes": 60 }
      ]
    }
  ]
}
```

Backend tato data zvalidoval (rozsahy, povinné fieldy) a jednotlivě posílá do `POST /v1/Course/Create`.

### 7.3 Důležitý detail: `Course/GetList` má interval max 31 dní

Pokud uživatel zadá leden-květen (5 měsíců), backend volá `Course/GetList` opakovaně po blocích a výsledky sjednocuje (s deduplikací podle `Course.Id`, protože kurz překlenující dva bloky by se vrátil 2x).

Pseudokód:
```csharp
var allCourses = new Dictionary<int, SimpleCourseApiModel>();
var current = from;
while (current <= to)
{
    var blockEnd = (current.AddDays(30) > to) ? to : current.AddDays(30);
    var response = await reservanto.GetCourseList(segmentId, current, blockEnd);
    foreach (var c in response.Items)
        allCourses[c.Id] = c;
    current = blockEnd.AddDays(1);
}
```

### 7.4 Filtrace kurzů podle zadaného období

Po načtení všech kurzů z bloků se aplikuje **klientský filtr**: kurz se zahrne, pokud jeho `StartDate >= sourceFrom AND EndDate <= sourceTo`.

Důvod: kurz, který začal v prosinci a končí v lednu, by se vrátil v GetList pro lednový blok, ale uživatel ho nechce duplikovat (chce jen kurzy plně spadající do období).

### 7.5 Načítání lekcí (`Course/Get`)

Pro každý kurz z filtrovaného seznamu se musí zavolat `Course/Get`, protože lekce nejsou v `SimpleCourseApiModel`. To může být **mnoho volání** (50 kurzů = 50 volání).

Strategie:
- Volání paralelně s omezením na **max 5 souběžně** (`SemaphoreSlim`).
- Pro PoC jedno HTTP volání backendu, které čeká na vše a vrátí kompletní seznam (frontend ukazuje generic spinner s odhadem „Načítám 50 kurzů..."). Server-Sent Events / streaming řešit ve fázi 2, pokud bude potřeba.

### 7.6 Mapování `Course/Get` → `Course/Create` (provádí backend pro každý kurz)

```
Z CourseApiModel (load):                  Do CourseCreateRequest (create):
- BookingResourceId                    →  BookingResourceId
- BookingServiceId                     →  BookingServiceId
- Capacity                             →  Capacity
- Description                          →  Description
- Name                                 →  Name
- PriceWithVat                         →  PriceWithVat
- (z požadavku z frontendu)            →  SegmentId
- (z požadavku z frontendu, nebo null) →  CalendarId
- (z globálního UI - request body)     →  SingleLectionBookingEnabled
- (z globálního UI - request body)     →  SingleLectionBookingFrom
- (z požadavku z frontendu)            →  RegistrationEnd
- (z požadavku z frontendu)            →  Lections[].Start
- (z požadavku z frontendu)            →  Lections[].LengthMinutes
```

**`CalendarId`** není v `CourseApiModel` přímo, ale **JE v každém `AppointmentClassApiModel`** (potvrzeno v API yaml řádek 4732). Backend přečte `CalendarId` z prvního appointmentu kurzu a použije pro nový kurz. Pokud kurz nemá žádné appointmenty (krajní případ), nastav null - Reservanto použije výchozí kalendář.

### 7.7 Kontrola obsazenosti cílového období (`CheckPeriod`)

Request: `{ segmentId, from, to }` (UnixTimestamp). Backend načte kurzy přes blokový
`Course/GetList` (stejně jako 7.3) a vrátí kurzy, které se s obdobím **protínají**
(`StartDate <= to AND EndDate >= from`) - na rozdíl od `LoadCourses` se nepožaduje plné
spadnutí do období (kurz přesahující hranici se počítá taky).

Response: `{ count, names }`, kde `names` je max prvních 5 názvů kurzů seřazených podle začátku.

## 8. Edge cases a chyby

- **Kurz s 0 lekcemi po vyloučení uživatelem** → tlačítko „Vytvořit kurzy" musí kurz přeskočit, jinak Reservanto API zřejmě vrátí chybu.
- **Žádné kurzy v zadaném období** → Krok 3 zobrazí prázdný stav „Žádné kurzy k duplikaci" + tlačítko zpět.
- **STT expirovaný uprostřed batchového vytváření** → automaticky regenerovat, retry once.
- **API vrátí 403 (chybí oprávnění `Course_w`)** → zobrazit zřetelnou hlášku „Chybí oprávnění pro vytváření kurzů. Kontaktujte podporu Reservanta."
- **Rate limiting (429)** → exponential backoff, max 3 retry.
- **Síťová chyba** → message v UI, nic se nevytvořilo, stav se neztratil (klient může zkusit znovu).

## 9. UX detaily

- Lokalizace: **česky**. Formát dat: `d. M. yyyy (EEEE)`, tedy např. „5. 1. 2026 (pondělí)".
- Časová zóna: **Europe/Prague**. Backend pracuje s `DateTimeOffset` v UTC, frontend zobrazuje v lokálním čase. UnixTimeStamp z Reservanta je v UTC.
- Validace v UI:
  - Datum OD ≤ datum DO
  - Nové datum OD musí být v budoucnu (> now) - blokující chyba (viz sekce C)
  - Nové datum OD > poslední lekce zdrojového období - jen warning v sekci F, neblokuje
- **Uchování naposledy zadaných hodnot:** cookie `cd_prefs` (JSON, expirace 30 dnů,
  `SameSite=Lax`) ukládá segment, datum OD/DO, nové datum OD, strategii mapování dne v týdnu
  a globální nastavení sekce E. Ukládá se při změně příslušné kontrolky a při „Načíst kurzy";
  při další návštěvě se hodnoty předvyplní. Nové datum OD z cookie se obnoví jen pokud je
  stále v budoucnu; segment jen pokud v dropdownu stále existuje.
- Responzivita: alespoň desktop a tablet. Mobile není priorita.

## 10. Bezpečnost

- API klíče / tokeny pouze server-side.
- Razor antiforgery tokens na všech POST handlerech.
- CSRF protection.
- Validate `LongTimeToken` z callbacku - musí přijít přes HTTPS, parametr `state` pro CSRF u OAuth.
- Audit log (alespoň text log file): kdo a kdy zduplikoval kolik kurzů, případně chyby.

## 11. Otevřené body pro implementaci

1. **Registrace aplikace u Reservanta** (prerekvizita): získat `clientId` a zaregistrovat `redirectUrl` produkčního prostředí.
2. **Audit logging** - kam loguje. Stačí soubor nebo do existující infrastruktury?
3. **STT cache klíč** - pokud aplikace bude obsluhovat víc merchantů současně (různé session), STT se musí cachovat per session, ne globálně. (Pravděpodobně OK, session-bound cache je default.)
