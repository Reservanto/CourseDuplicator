# Course Duplicator

Webová aplikace pro **hromadnou duplikaci kurzů** merchantů [Reservanto](https://www.reservanto.cz/) z jednoho období do druhého. Merchant se přihlásí svým Reservanto účtem (povolí aplikaci přístup k jeho kurzům), načte kurzy zvoleného zaměření a období, zvolí cílové datum a aplikace mu kurzy (včetně všech lekcí) hromadně zkopíruje přes Reservanto API.

🔗 **Živá ukázka:** <https://demo-courseduplicator-gtecg0djhkakhses.westeurope-01.azurewebsites.net/>

🎬 **Video ukázka (1 min):** výběr bloku kurzů na časové ose, nový rozvrh se svátky a prázdninami, kontrola termínů a hromadná úprava názvů.

[![Video ukázka Course Duplicatoru na YouTube](https://img.youtube.com/vi/9QYyNGRkIA8/maxresdefault.jpg)](https://youtu.be/9QYyNGRkIA8)

---

## ⚠️ Disclaimer

- Tento projekt je **produktem soukromé osoby**. Společnost **Reservanto za něj nenese žádnou odpovědnost** a není jeho autorem ani provozovatelem.
- Aplikace pracuje s reálnými daty vašeho Reservanto účtu. **Vytvoření kurzů je nevratné** (viz níže) — používejte na vlastní odpovědnost.
- Vznikl tzv. **„vibecodingem"** s využitím [Claude Code](https://claude.com/claude-code) (model Claude Opus). Kód, prompty i specifikace odrážejí tento způsob vývoje.

## 📄 Licence a použití

Projekt je licencován pod licencí **[MIT](LICENSE)**.

Zdrojové kódy, Markdown prompty (`CLAUDE.md`) i specifikaci (`SPECIFICATION.md`) dávám volně k dispozici **ve stavu, v jakém jsou (as-is), bez záruk**. Kdokoli si je může stáhnout, upravit a libovolně použít — slouží k **inspiraci i volnému využití**.

> **Výjimka:** název a logo **Reservanto** a **Reservanto Design System** (soubory ve `wwwroot/css/design/` a `wwwroot/img/logo.svg`) jsou majetkem Reservanta a **nejsou kryty MIT licencí**. Jsou součástí repa jen kvůli nativnímu vzhledu ukázky — při použití projektu mimo kontext Reservanta je odeberte nebo nahraďte. Viz [`LICENSE`](LICENSE).

---

## 🧭 Jak to funguje

1. **Výběr zdrojového období.** Uživatel zvolí **Zaměření** a pod ním se zobrazí **časová osa bloků kurzů** za poslední rok. Blok tvoří kurzy, které začínají ve stejném týdnu a končí ve stejném týdnu. Typicky jde o jeden běh kurzů, třeba podzimní pololetí.
   - **Klik na blok** nastaví datum OD–DO přesně na jeho rozsah, **tažením** po ose jde vybrat vlastní rozsah. Datum OD–DO lze zadat i ručně.
   - Tlačítko **„Načíst kurzy"** načte kurzy daného zaměření a období.
2. **Přehled načtených kurzů.** Kurzy se stejným názvem a stejnými daty lekcí, typicky stejný kurz v různých časech nebo u různých lektorů, se **seskupí do jednoho řádku**, který jde rozbalit.
   - Křížkem lze z duplikace vyloučit jednotlivý kurz i celou skupinu.
   - Kurzy, které období jen **přesahují** (začínají dřív nebo končí později), jsou zvlášť a ve výchozím stavu se nekopírují. Zaškrtnutím „Zahrnout" se zkopírují celé.
3. **Cílové období a způsob mapování.** Uživatel zadá, kam se mají kurzy zkopírovat, a zvolí strategii:
   - **Zachovat dny v týdnu** — lekce se posunou o celé týdny, takže zůstanou ve stejných dnech v týdnu (efektivní datum OD se může lišit o ±3 dny).
   - **Přesný posun** — lekce se posunou přesně o zadaný počet dní.
   - **Nový rozvrh podle týdenního rytmu** — lekce se neposouvají, ale vygenerují znovu podle dne v týdnu a času každého kurzu, od začátku nového bloku do zadaného **data konce** nebo do zadaného **počtu lekcí**. Do seznamu **vynechaných dnů** jde jedním tlačítkem přidat **státní svátky (CZ/SK)** a ručně třeba školní prázdniny, lekce v těchto dnech nevzniknou. Volba je dostupná, jen když mají všechny vybrané kurzy pravidelný rytmus (jedna lekce týdně, stejný den a čas).
   > Pozn.: posun je ukotvený na **datum OD zdrojového období**, ne na první lekci. Chcete-li, aby první lekce začínala přesně zadaným dnem, zadejte v prvním kroku datum OD shodné s datem první lekce.
4. **Časová osa cílového období** ukáže nové lekce po dnech, státní svátky (zvýrazněné, pokud na ně padne lekce), vynechané dny a kurzy, které už v novém období existují. Na existující kurzy upozorní i samostatná hláška.
5. **Kontrola kurzů s novými daty.** Kliknutím na **„detail"** se u kurzu zobrazí jeho jednotlivé lekce. Pokud mají kurzy kvůli vynechaným dnům různý počet lekcí, aplikace na to upozorní.
   - Jednotlivé lekce lze vyloučit, nebo jim ručně **změnit datum/čas**. Takto upravená lekce se „připne" a globální přepočet ji už nemění.
6. **Globální nastavení nových kurzů:**
   - **„Povolit rezervace jednotlivých lekcí"** — toto nastavení API u původních kurzů nevrací, proto se volí tady pro všechny nové kurzy.
   - **„Konec registrace"** — zachovat odstup od začátku kurzu jako u původního kurzu, začátek první lekce, nebo N dní před začátkem.
   - **Hromadná úprava názvů** — nahradí text v názvech všech nových kurzů, např. označení období `AB/26` → `AB/27`.
7. Tlačítkem **„Vytvořit kurzy"** dojde k okamžitému vytvoření kurzů.

> 🛑 **Pozor, tato akce je nevratná!** Pokud takto zkopírujete kurzy do špatných dat, musíte je upravit nebo smazat ručně v administraci Reservanta.

Z původního kurzu se kopíruje zdroj (lektor), služba, kapacita, cena, popis a kalendář. **Přihlášení zákazníci se nekopírují.**

---

## 🛠️ Technologie

- **.NET 10** / ASP.NET Core
- **Razor Pages** (server-rendered shell, jedna stránka + JSON handlery)
- **Vanilla JS** (žádný framework, žádný build-step)
- Stateless — žádná databáze; jediný server-side stav je session (LTT/STT tokeny)

Komunikace s Reservanto API probíhá výhradně přes backend (proxy pattern) — **autentizační tokeny nikdy neopouští server**.

## 🚀 Spuštění lokálně

Potřebujete [.NET 10 SDK](https://dotnet.microsoft.com/download) a vlastní `ClientId` registrované u Reservanta (s registrovanou callback URL `https://localhost:5001/Auth/Callback`).

```bash
# v adresáři src/CourseDuplicator
dotnet user-secrets set "Reservanto:ClientId"    "<vaše-UUID>"
dotnet user-secrets set "Reservanto:CallbackUrl" "https://localhost:5001/Auth/Callback"

# spuštění přes HTTPS profil (port 5001 musí sedět s registrovanou callback URL)
dotnet run --launch-profile https
```

Aplikace pak běží na <https://localhost:5001>.

## ☁️ Nasazení (Azure App Service)

`ClientId`/`CallbackUrl` se v Azure nastaví jako **Application settings** (zanořená sekce přes dvojité podtržítko):

| Name | Value |
|---|---|
| `Reservanto__ClientId` | `<vaše-UUID>` |
| `Reservanto__CallbackUrl` | `https://<host>/Auth/Callback` |

Tutéž callback URL je nutné zaregistrovat i u Reservanta.

---

## 📚 Dokumentace v repu

- [`SPECIFICATION.md`](SPECIFICATION.md) — kompletní funkční specifikace
- [`CLAUDE.md`](CLAUDE.md) — instrukce a kontext pro Claude Code (prompt/architektura)
