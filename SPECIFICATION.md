# Reservanto Course Duplicator - Specifikace

## 1. Účel

Webová aplikace umožňující merchantům Reservanto hromadně zduplikovat definice kurzů z jednoho časového období do dalšího. Typický scénář: kurzy z ledna-května se zduplikují do období od září dál, se zachováním stejné týdenní struktury (pondělní kurz zůstane pondělní).

## 2. Technologie

- **Backend:** ASP.NET Core na .NET 10, Razor Pages
- **Frontend:** Vanilla JS (ne TypeScript), žádný CSS framework
- **Architektura:** Server-side Razor Page jako shell; veškerá komunikace s Reservanto API probíhá přes backend handlery (proxy). API klíče / tokeny **nikdy** neopouští backend.
- **Hosting:** Nasazení jako jedna webová aplikace (např. Azure App Service). Aplikace je u Reservanta registrovaná jedním `clientId`; libovolný merchant se přihlásí svým Reservanto účtem přes OAuth-like flow (LongTimeToken → ShortTimeToken).

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
- `Segment_r` - načtení dropdownu zaměření (potvrzeno: `/v1/Segment/GetList`)
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

LTT chodí v query stringu callbacku (návrh Reservanta, nelze ovlivnit). Aby trvalý token
neunikal přes hlavičku `Referer` při navigaci pryč z `/Auth/Callback`, aplikace posílá
`Referrer-Policy: no-referrer` na všech odpovědích. Na úrovni nasazení se navíc doporučuje
nelogovat query string pro `/Auth/*` v access logu reverzní proxy.

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

**Chybějící konfigurace:** pokud `ClientId` nebo `CallbackUrl` není vyplněné, aplikace nespadne. Při startu zaloguje varování a stránka `/Auth/Login` místo tlačítka „Přihlásit se přes Reservanto" zobrazí hlášku „Přihlášení není k dispozici" s výčtem chybějících nastavení a návodem pro správce (v Development příkaz `dotnet user-secrets set ...`, jinak názvy proměnných prostředí `Reservanto__ClientId` / `Reservanto__CallbackUrl`). Případný POST na `Start` handler se stejně odmítne, zaloguje jako chyba a vrátí tutéž stránku.

### 3.7 Implementace STT cache

- STT se generuje on-demand a cachuje v session s expirací 25 minut (5min safety margin před 30min platností).
- Při expiraci STT se transparentně regeneruje z LTT.
- Pokud LTT vrátí chybu při generování STT (expiroval, byl revokován), uživatel je redirectován na autorizační flow.

## 4. Datový model

### 4.1 Reservanto entity (jen relevantní pole)

**Segment** (zaměření obchodníka, např. „kurzy jógy"):
- `Id`, `Name`
- **Terminologie:** interně (kód, DB, Reservanto API, JSON pole, názvy handlerů, právo `Segment_r`) se používá **Segment**. V **uživatelském rozhraní** (popisky, hlášky, texty pro merchanta) se vždy používá **Zaměření**. Při generování UI textů nikdy nepiš „segment".

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
  shiftStrategy: 'weekday' | 'exact' | 'rhythm',  // mapování dne v týdnu / nový rozvrh podle rytmu (6.6)

  // Jen pro shiftStrategy = 'rhythm' (6.6)
  rhythmEndMode: 'endDate' | 'count',  // výchozí 'endDate'
  newTo: Date | null,                  // konec nového bloku (včetně), pro 'endDate'
  lectionCount: number | null,         // počet lekcí, pro 'count'
  excludedDays: [                      // vynechané dny, od–do včetně, jen datum
    { from: Date, to: Date, label: string | null }  // label např. „Velký pátek" u svátku
  ],
  holidayCountry: 'CZ' | 'SK',         // seznam svátků pro tlačítko v sekci C (6.6.4)

  // Vstup ze sekce E
  singleLectionBookingEnabled: boolean,
  singleLectionBookingFrom: Date | null,
  registrationEndStrategy: 'keepOffset' | 'atStart' | 'daysBefore',
  registrationEndDaysBefore: number,  // jen pro 'daysBefore'
  nameFind: string,      // hromadná úprava názvů (sekce E), '' = beze změny
  nameReplace: string,

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
      isExcluded: false,
      isOverlapping: false,   // kurz přesahuje zdrojové období (7.4); u přesahujících výchozí isExcluded = true
      rhythm: { weekday: number, time: 'HH:mm', lengthMinutes: number } | null,  // detekce 6.6.1, null = nerytmický
      rhythmLections: [       // jen pro shiftStrategy = 'rhythm', generuje 6.6.2
        { newStart: Date, isExcluded: false, isPinned: false, pinnedNewStart: Date | null }
      ]
    }
  ]
}
```

Backend interně používá ekvivalentní C# modely pro deserializaci response z Reservanto API a pro request body při vytváření.
Skupiny stejných kurzů (sekce B a D) se ve state nedrží, počítají se z `courses` (klíč viz sekce B).

## 5. Uživatelský flow

Aplikace je **jedna stránka s progresivním odhalováním sekcí**, ne klasický wizard s krokem 1/2/3. Sekce se odhalují podle toho, jak uživatel postupuje, ale dříve vyplněné inputy zůstávají editovatelné.

### Sekce A: Volba zdrojového období

- Dropdown **Zaměření** (pokud má merchant jen jedno, automaticky předvybráno a sekce je sbalená).
- Inputy **datum OD** a **datum DO** zdrojového období.
- Tlačítko **„Načíst kurzy"**.

Po stisknutí: backend vrátí seznam kurzů včetně všech lekcí. Stav se uloží do JS objektu `state.sourceCourses[]`.

### Sekce B: Přehled načtených kurzů (read-only kontrola)

Zobrazí se hned po načtení (před zadáním nového data). Účel: uživatel zkontroluje, že vybral správné období a kurzy.

Tabulka kurzů:
- Název kurzu | Zdroj/služba | Kapacita | Počet lekcí | Rozsah dat (OD – DO + den v týdnu prvního a posledního dne)
- Křížek - vyloučí kurz z duplikace (rovnou v tomto kroku, ať uživatel nemusí potom)

Pod tabulkou: „Načteno X kurzů s celkem Y lekcemi. Vyloučeno Z kurzů."
**Seskupení stejných kurzů:**
- Kurzy se **stejným názvem a stejnými daty lekcí** (porovnává se jen kalendářní datum lekcí v Europe/Prague, ne čas) se zobrazí jako **jeden rozbalovací řádek skupiny**. Typicky jde o stejný kurz v různých časech nebo u různých lektorů.
- Řádek skupiny: Název + „×N" | zdroje/služby (zkráceně, celý seznam v tooltipu) | kapacita (jedna hodnota, nebo rozsah min–max) | počet lekcí | rozsah dat | časy začátku (např. „8:30, 9:30, 10:15") | [křížek] | [▸ rozbalit].
- Rozbalení ukáže jednotlivé kurzy skupiny jako běžné řádky.
- Křížek na řádku skupiny vyloučí (resp. vrátí) **všechny** kurzy skupiny; v rozbaleném stavu jde vyloučit i jednotlivý kurz. Skupina s částečně vyloučenými kurzy to ukáže (např. „×12, vyloučeno 2").
- Skupina s jediným kurzem se zobrazí jako obyčejný řádek.
- Stejné seskupení používá tabulka v sekci D.

**Kurzy přesahující zdrojové období:**
- Kurzy, které se se zdrojovým obdobím **protínají, ale neleží v něm celé** (7.4), se nezahazují. Zobrazí se pod hlavní tabulkou v samostatném sbaleném bloku „Přesahují zdrojové období (N kurzů)" s vysvětlením „Začínají před datem OD nebo končí po datu DO. Ve výchozím stavu se nekopírují."
- Řádky mají stejné sloupce a stejné seskupení jako hlavní tabulka; v rozsahu dat je zvýrazněná hranice, kterou kurz přesahuje.
- Místo křížku mají checkbox **„Zahrnout"** (výchozí nezaškrtnuto = `isExcluded: true`). Zahrnutý kurz se kopíruje **celý, se všemi lekcemi**, i těmi mimo zdrojové období. Nezahrnuté řádky jsou jen ztlumené, ne přeškrtnuté, aby zvýrazněná hranice zůstala čitelná.
- Souhrn pod tabulkou: „Načteno X kurzů s celkem Y lekcemi. Vyloučeno Z kurzů. Přesahuje období: W kurzů (zahrnuto V)." Do X a Y se počítají jen kurzy ležící v období.

### Sekce C: Cílové období

Zobrazí se, jakmile je v sekci B aspoň jeden kurz.

- Input **nové datum OD** (datetime picker, jen datum). Při změně se okamžitě (v JS) přepočítají všechny nové datumy lekcí.
- Radio buttons **strategie mapování dne v týdnu**:
  - **Zachovat dny v týdnu** (výchozí) - posun zaokrouhlený na celé týdny. Efektivní datum OD se může lišit od zadaného o ±3 dny.
  - **Přesný posun** - posun přesně podle zadaného data, dny v týdnu se posunou.
  - **Nový rozvrh podle týdenního rytmu** - lekce se neposouvají, ale vygenerují znovu z pravidla „den v týdnu + čas" každého kurzu (6.6). Nabízí se jen tehdy, když jsou **všechny nevyloučené kurzy rytmické** (6.6.1). Jinak je volba disabled a pod ní je hláška „Nový rozvrh nejde použít, protože tyto kurzy nemají pravidelný týdenní rytmus: …" se seznamem názvů a odkazem, který je v sekci B vyloučí.
  - Změna této volby okamžitě přepočítá všechny lekce.
- Read-only zobrazení:
  - **Efektivní datum OD** (při strategii „zachovat dny v týdnu" se může lišit od zadaného)
  - **Vypočtené datum DO** = maximum z nových datumů poslední lekce ze všech ne-vyloučených kurzů.
- **Parametry strategie „Nový rozvrh podle týdenního rytmu"** (zobrazí se jen při této volbě):
  - Pole „Nové datum OD" má popisek **„Začátek nového bloku"**. Datum se nezaokrouhluje; první lekce každého kurzu padne na první jeho den v týdnu od tohoto data (včetně). „Efektivní datum OD" se nezobrazuje, místo něj **„První lekce"** = nejdřívější vygenerovaná lekce.
  - Přepínač **konec bloku**:
    - **Datum konce** (výchozí) + date input **„Konec nového bloku"** (`newTo`, včetně). Musí být ≥ začátek bloku.
    - **Počet lekcí** + číselný input (`lectionCount`, 1–52). Vynechané dny se do počtu nepočítají - kurz se o ně prodlouží.
  - **Vynechané dny** (`excludedDays`):
    - Dva date inputy OD a DO (DO nepovinné = jeden den) + tlačítko **„Přidat"**. Položky se zobrazí jako seznam (chipy) „28. 10. 2027 (čtvrtek)" resp. „25. 10. – 29. 10. 2027", u svátku s názvem („Velký pátek"), každá s křížkem pro odebrání. Seznam je seřazený podle data, překrývající se položky se nespojují.
    - Tlačítko **„Přidat státní svátky v období"** + přepínač **CZ / SK** (`holidayCountry`). Vloží svátky z pevného seznamu (6.6.4) v intervalu začátek bloku – konec bloku (v režimu „Počet lekcí" začátek bloku + 12 měsíců). Svátek, který už v seznamu je (jednodenní položka se stejným datem), se nepřidá znovu; svátek ležící uvnitř ručně zadaného vícedenního rozsahu se přidá jako samostatná položka. Nic se nepřidává automaticky - vždy rozhoduje uživatel.
    - Školní prázdniny a jiné dny zadává uživatel ručně.
  - Každá změna parametrů okamžitě přegeneruje lekce (6.6.2). Pokud by přegenerování zahodilo ruční úpravy lekcí ze sekce D, nejdřív se zobrazí potvrzení „Změna zruší ruční úpravy u X lekcí. Pokračovat?" (6.3).
  - **Neúplné parametry** (chybí konec bloku / počet lekcí, konec bloku < začátek, počet mimo 1–52) se chovají jako nezadané nové datum OD: zobrazí se chyba u pole, sekce D/E se skryjí, vypočtená data jsou „–" a v sekci F je hláška „Zadejte konec nového bloku." resp. „Zadejte počet lekcí nového bloku.".
  - **Vypočtené datum DO** = poslední vygenerovaná lekce (6.5); v režimu „Datum konce" je vždy ≤ konec bloku.
  - Kontrola obsazenosti (`CheckPeriod`) se volá pro interval začátek bloku – vypočtené DO.
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

Tabulka obsahuje všechny kurzy ležící v období (vyloučené přeškrtnuté) a z přesahujících kurzů (7.4) jen ty zahrnuté, označené značkou „přesahuje období". Vyloučením v sekci D přesahující kurz z tabulky zmizí; vrátit ho jde checkboxem „Zahrnout" v sekci B.

Tabulka kurzů (rozšíření tabulky z B, plus nové datumy):
- Název | Zdroj/služba | Kapacita | Lekcí | Původní (OD – DO) | Nové (OD – DO) | [křížek] | [▸ detail]

Klik na „detail" rozbalí seznam jednotlivých lekcí daného kurzu:
- Pořadí | Původní datum + den v týdnu | Nové datum + den v týdnu | Délka | [křížek] | [edit]
- Křížek - vyloučí konkrétní lekci (ostatní zůstanou).
- Edit (klik na nové datum, input se stane editovatelným) - umožní ručně přepsat datum konkrétní lekce (`datetime-local`).
  - **Potvrzení:** `Enter` nebo opuštění editačního pole (klik mimo input, přesun na jiný prvek `Tab`em) zadanou hodnotu uloží a lekci připne.
  - **Zrušení:** `Escape` editaci zruší bez uložení.
  - Klik **uvnitř** editačního pole (přepínání mezi segmenty den/měsíc/hodina, nativní picker) editaci neukončuje - focus zůstává v inputu.
- **Změna data jakékoli lekce nepřepočítává ostatní lekce** - jen ručně přepsaná lekce se odpojí od globálního přepočtu (drží si vlastní hodnotu). Pokud uživatel později změní globální „nové datum OD", ručně editované lekce zůstanou na svých hodnotách. UI ručně editované lekce vizuálně odliší (např. ikona „připnuto") a nabídne tlačítko „obnovit automatický výpočet".
- Pokud uživatel přepíše datum **první lekce** a v sekci E je zvolena strategie RegistrationEnd „zachovat offset", **RegistrationEnd kurzu se přepočítá automaticky** podle nového data první lekce.
**Sekce D při strategii „Nový rozvrh podle týdenního rytmu":**
- Tabulka kurzů: Název | Zdroj/služba | Kapacita | Rytmus (např. „út 8:30, 45 min") | Původní (OD – DO, lekcí) | Nové (OD – DO, lekcí) | [křížek] | [▸ detail]. Seskupení jako v sekci B; u skupiny se rytmus zobrazí jako den + seznam časů.
- Detail kurzu ukazuje **vygenerované lekce** (`rhythmLections`): Pořadí | Nové datum + den v týdnu | Délka | [křížek] | [edit]. Původní lekce jde zobrazit přepínačem „Ukázat původní lekce" (jen pro čtení).
- Křížek a ruční editace data fungují stejně jako výše (připnutí, Enter/Escape, „obnovit automatický výpočet"). Změna parametrů v sekci C je ale zahodí (po potvrzení, viz sekce C a 6.3).
- **Rozdílný počet lekcí:** pokud nevyloučené kurzy nemají stejný počet nových lekcí, nad tabulkou je oranžová hláška „Kurzy mají různý počet lekcí (9–11) kvůli vynechaným dnům." a u kurzů s počtem odlišným od nejčastějšího se hodnota zvýrazní. Cena se nepřepočítává - jde jen o informaci.
- Lekce, která padne na vynechaný den, nevznikne (nejde ji vrátit křížkem). Ručně připnout lekci na vynechaný den lze.

### Sekce E: Globální nastavení nových kurzů

Zobrazí se zároveň se sekcí D.

- Checkbox **„Povolit rezervace jednotlivých lekcí"** - mapuje se na `SingleLectionBookingEnabled` všech nových kurzů. Default: nezaškrtnuto.
- Pokud checkbox zaškrtnut: input **„Povolit rezervace jednotlivých lekcí od (datum)"** - mapuje se na `SingleLectionBookingFrom`. Default: prázdné = od začátku.
- Dropdown **„Konec registrace"** (`RegistrationEnd`):
  - **Zachovat offset** (výchozí) - pro každý kurz se vypočte `(původní StartDate - původní RegistrationEnd)` ve dnech, stejný offset se aplikuje na nový kurz vůči nové první lekci.
  - **Začátek první lekce** - `RegistrationEnd` = StartDate prvního termínu kurzu.
  - **N dní před začátkem** + input pro N - `RegistrationEnd` = StartDate prvního termínu - N dní.
- **Hromadná úprava názvů** (`nameFind`, `nameReplace`): inputy „Najít v názvu" a „Nahradit za". Nahradí **všechny výskyty** textu v názvech všech nových kurzů (prostý text, rozlišuje velikost písmen, žádné regexy). Prázdné „Najít" = názvy beze změny. Typické použití: přepis prefixu období („AB/26" → „AB/27"). Platí pro všechny strategie.
  - Pod inputy: „Upraví se název u X kurzů."
  - Sekce D zobrazuje už upravené názvy (původní v tooltipu), změněné řádky mají drobnou značku.
  - Výsledný název nesmí být prázdný - jinak blokující chyba u daného kurzu.
  - Seskupení (sekce B/D) se počítá z **původních** názvů.

### Sekce F: Potvrzení a vytvoření

Vždy viditelná na spodku stránky.

- Souhrn: **„Bude vytvořeno X kurzů s celkem Y lekcemi."**
- Disabled tlačítko **„Vytvořit kurzy"** dokud není zadáno nové datum OD a alespoň jeden kurz není vyloučen.
- Při strategii „Nový rozvrh" musí být navíc vyplněný konec bloku, resp. počet lekcí.
- Po kliknutí: AJAX volání backendu, který sekvenčně vytváří kurzy (max 3 paralelně). Frontend ukazuje progress bar a aktuální stav („Vytvářím 5/23: Jóga začátečníci").
- Při chybě u konkrétního kurzu: pokračovat dál, chybu zaznamenat do souhrnu.

### Sekce G: Výsledek

- „Vytvořeno X kurzů (z toho 0/Y úspěšně)."
- Seznam případných chyb s detailem (název kurzu + chybová zpráva z API).
- Tlačítko **„Vytvořit další"** (vrátí na začátek stránky, vyprázdní stav).

## 6. Mapovací logika

Mapování probíhá **v JavaScriptu na frontendu** (pro okamžitý přepočet při změně inputu). Backend mapování neimplementuje - přijímá od frontendu finální UnixTimestamp hodnoty pro `Lections[].Start`.

**Kotva posunu:** posun je ukotvený na **datum OD zdrojového období** (vstup v sekci A), ne na první lekci. „Nové datum OD" tedy určuje, kam se posune *začátek období*; lekce si zachovají svůj odstup od něj. Pokud uživatel zadá okno OD dříve, než je první lekce, nové kurzy spadnou o tu mezeru později než „stejné datum v cílovém období". V UI je u pole „Nové datum OD" nápověda, která to vysvětluje (chce-li uživatel první lekci přesně na zadaný den, zadá v sekci A datum OD shodné s první lekcí). Toto chování je záměrné.

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
Při strategii „Nový rozvrh" se ruční úpravy a vyloučení drží na `rhythmLections`. Protože se lekce po změně parametrů generují znovu, nedají se spárovat s předchozími - **změna parametrů rytmu (začátek, konec/počet, vynechané dny) nebo přepnutí na jinou strategii `rhythmLections` zahodí**. Obsahují-li ruční úpravy nebo vyloučené lekce, frontend se nejdřív zeptá (sekce C). Ruční úpravy původních lekcí (posun) zůstávají nedotčené.

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
Při strategii „Nový rozvrh" stejně, jen z nevyloučených `rhythmLections` (u připnutých z `pinnedNewStart`).

### 6.6 Strategie „Nový rozvrh podle týdenního rytmu"

Místo posunu existujících lekcí se pro každý kurz vygeneruje nová řada lekcí z jeho týdenního rytmu. Řeší, co posun (6.1/6.2) neumí: jinou délku nového bloku a svátky/prázdniny, které v novém období padají na jiné dny. Díry po svátcích ze zdrojového období se nepřenášejí.

Logika patří do `mapping.js` (pure funkce) a pokrývají ji testy v `mapping.test.html`.

#### 6.6.1 Detekce rytmu (per kurz, po načtení)

Kurz je **rytmický**, pokud pro **všechny** jeho původní lekce (bez ohledu na vyloučení v sekci D) platí, počítáno v Europe/Prague:
- stejný den v týdnu,
- stejný čas začátku (HH:mm),
- stejná délka (minuty),
- rozdíl kalendářních dat sousedních lekcí je kladný násobek 7 dní (mezery kvůli svátkům nevadí).

Kurz s jedinou lekcí je rytmický. Kurz bez lekcí je nerytmický (není z čeho odvodit den a čas), takže blokuje strategii „Nový rozvrh", dokud se nevyloučí. Výsledek `rhythm = { weekday, time, lengthMinutes }`, jinak `null`. Kurzy s více lekcemi týdně (např. po + st) **nejsou podporované** - jsou nerytmické.

#### 6.6.2 Generování lekcí

```
vstup: rhythm kurzu, newFrom (začátek bloku), rhythmEndMode, newTo | lectionCount, excludedDays

d = první datum >= newFrom, jehož den v týdnu == rhythm.weekday
lekce = []
iterace = 0
OPAKUJ:
  pokud rhythmEndMode == 'endDate' a d > newTo: konec
  pokud rhythmEndMode == 'count' a lekce.length == lectionCount: konec
  pokud iterace >= 104: konec              // pojistka (2 roky)
  pokud d neleží v žádném intervalu excludedDays:
    lekce.push(d + rhythm.time)            // lokální čas Europe/Prague -> UTC
  d = d + 7 kalendářních dní
  iterace++
```

- Sčítání dní je kalendářní (čas lekce se zachová i přes změnu letního/zimního času), stejně jako u posunu.
- Délka každé lekce = `rhythm.lengthMinutes`.
- Kurz může vyjít s 0 lekcemi (např. celé období vynechané) - viz kapitola 8.
- V režimu `count` mají kurzy stejný počet lekcí, ale můžou končit v různých týdnech. V režimu `endDate` končí ve stejném týdnu, ale počet lekcí se může lišit (sekce D na to upozorní).

#### 6.6.3 RegistrationEnd a SingleLectionBookingFrom

Beze změny proti 6.4 a sekci E. `nove_StartDate_kurzu` = první nevyloučená vygenerovaná lekce. U „Zachovat offset" se offset počítá z původního `StartDate` a `RegistrationEnd` kurzu.

#### 6.6.4 Seznam státních svátků

Reservanto má svátky natvrdo v kódu a API je nevystavuje (jen nepřímo: `/v1/WorkingHours/GetForPeriod` pro svátek nevrací pracovní dobu). Aplikace proto drží vlastní seznam ve `mapping.js`:

**CZ:** 1. 1., Velký pátek, Velikonoční pondělí, 1. 5., 8. 5., 5. 7., 6. 7., 28. 9., 28. 10., 17. 11., 24. 12., 25. 12., 26. 12.

**SK:** 1. 1., 6. 1., Velký pátek, Velikonoční pondělí, 1. 5., 8. 5., 5. 7., 29. 8., 15. 9., 1. 11., 24. 12., 25. 12., 26. 12.

**Výjimky po letech:** pro SK se v roce 2026 neslaví 8. 5. a 15. 9. (konsolidační balíček). Seznam proto drží i tabulku výjimek ve tvaru `{ country, year, dates[] }` (svátky, které v daném roce odpadají), aby šly další změny doplnit bez úpravy logiky. Seznamy musí odpovídat kódu Reservanta.

Velikonoční neděle se počítá algoritmem pro gregoriánský kalendář (Meeus/Jones/Butcher); Velký pátek = neděle − 2 dny, Velikonoční pondělí = neděle + 1 den. Svátky se jen vkládají do `excludedDays` tlačítkem v sekci C - generování o nich samo neví.
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
**Přesahující kurzy:** kurzy, které filtrem neprojdou, ale se zdrojovým obdobím se protínají (`StartDate <= sourceTo AND EndDate >= sourceFrom`), se nezahazují. Backend je vrátí také, s příznakem `isOverlapping: true`, a frontend je zobrazí zvlášť (sekce B). Blokový `Course/GetList` je vrací už teď, další volání `GetList` nejsou potřeba. Lekce (`Course/Get`) se načítají i pro ně, aby šly zahrnout bez čekání - počet volání `Course/Get` tím vzroste.

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
- **Rate limiting (429)** → exponential backoff 1 s / 2 s / 4 s, max 3 retry. Řeší se centrálně ve `ReservantoClient` pro **všechna** volání API (čtení i zápis - `Course/GetList`, `Course/Get`, `Course/Create`), ne jen pro batch vytváření.
- **Síťová chyba** → message v UI, nic se nevytvořilo, stav se neztratil (klient může zkusit znovu).
- **Strategie „Nový rozvrh" a kurz s 0 vygenerovanými lekcemi** (celé období vynechané, konec bloku dřív než první den v týdnu kurzu) → kurz se v sekci D zobrazí s varováním „Nevznikne žádná lekce" a při vytváření se přeskočí (jako kurz s 0 lekcemi po vyloučení).
- **Zahrnutý přesahující kurz při posunu** → kopíruje se celý; lekce, které by po posunu padly do minulosti, se v sekci D označí jako chybné a tlačítko „Vytvořit kurzy" je disabled, dokud je uživatel nevyloučí nebo nezmění nové datum OD.
- **Změna výběru kurzů při strategii „Nový rozvrh"** → pokud tím mezi nevyloučené kurzy přibude nerytmický kurz, strategie se přepne na „Zachovat dny v týdnu" a zobrazí se hláška proč.

## 9. UX detaily

- Lokalizace: **česky**. Formát dat: `d. M. yyyy (EEEE)`, tedy např. „5. 1. 2026 (pondělí)".
- Časová zóna: **Europe/Prague**. Backend pracuje s `DateTimeOffset` v UTC, frontend zobrazuje v lokálním čase. UnixTimeStamp z Reservanta je v UTC.
- Validace v UI:
  - Datum OD ≤ datum DO
  - Nové datum OD musí být v budoucnu (> now) - blokující chyba (viz sekce C)
  - Nové datum OD > poslední lekce zdrojového období - jen warning v sekci F, neblokuje
- **Uchování naposledy zadaných hodnot:** cookie `cd_prefs` (JSON, expirace 30 dnů,
  `SameSite=Lax`) ukládá zaměření, datum OD/DO, nové datum OD, strategii mapování dne v týdnu
  a globální nastavení sekce E. Ukládá se při změně příslušné kontrolky a při „Načíst kurzy";
  při další návštěvě se hodnoty předvyplní. Nové datum OD z cookie se obnoví jen pokud je
  stále v budoucnu; zaměření jen pokud v dropdownu stále existuje.
- Cookie `cd_prefs` navíc ukládá `rhythmEndMode` a `holidayCountry`. Uložená strategie „Nový rozvrh" se po načtení použije jen tehdy, když jsou všechny kurzy rytmické. Konec bloku, počet lekcí, vynechané dny a hromadná úprava názvů se **neukládají** (patří ke konkrétnímu bloku).
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
4. **Fáze 2 (mimo současný rozsah): časová pravítka.** V sekci A pod datem OD/DO pás s řádkem pro každý „blok" kurzů zaměření za posledních ~12 měsíců (blok = kurzy se stejným týdnem začátku a stejným týdnem konce; stačí `StartDate`/`EndDate` z `Course/GetList`, bez `Course/Get`). Pruh ukazuje rozsah bloku a počet kurzů, tooltip názvy skupin; klik na pruh nastaví datum OD/DO, tažením jde vybrat vlastní rozsah. V sekci C obdobné pravítko pro cílové období: nové lekce, vynechané dny a existující kurzy. Podklady: dokument „Analýza kurzů – merchant 23210" v claude.ai projektu CourseDuplicator.

## 12. Rozšíření z 13. 11. 2026

Implementováno 13. 11. 2026 (seskupení kurzů, přesahující kurzy, strategie „Nový rozvrh podle týdenního rytmu" s vynechanými dny a svátky CZ/SK, hromadná úprava názvů) - závazný popis je v 4.2, 5, 6.6, 7.4, 8 a 9.
