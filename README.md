# Course Duplicator

Webová aplikace pro **hromadnou duplikaci kurzů** merchantů [Reservanto](https://www.reservanto.cz/) z jednoho období do druhého. Merchant se přihlásí svým Reservanto účtem (povolí aplikaci přístup k jeho kurzům), načte kurzy zvoleného zaměření a období, zvolí cílové datum a aplikace mu kurzy (včetně všech lekcí) hromadně zkopíruje přes Reservanto API.

🔗 **Živá ukázka:** <https://demo-courseduplicator-gtecg0djhkakhses.westeurope-01.azurewebsites.net/>

---

## ⚠️ Disclaimer

- Tento projekt je **produktem soukromé osoby**. Společnost **Reservanto za něj nenese žádnou odpovědnost** a není jeho autorem ani provozovatelem.
- Aplikace pracuje s reálnými daty vašeho Reservanto účtu. **Vytvoření kurzů je nevratné** (viz níže) — používejte na vlastní odpovědnost.
- Vznikl tzv. **„vibecodingem"** s využitím [Claude Code](https://claude.com/claude-code) (model Claude Opus). Kód, prompty i specifikace odrážejí tento způsob vývoje.

## 📄 Licence a použití

Projekt je licencován pod licencí **[MIT](LICENSE)**.

Zdrojové kódy, Markdown prompty (`CLAUDE.md`), specifikaci (`SPECIFICATION.md`) i design (`DESIGN.md`) dávám volně k dispozici **ve stavu, v jakém jsou (as-is), bez záruk**.

Kdokoli si je může stáhnout, upravit a libovolně použít — slouží k **inspiraci i volnému využití**.

---

## 🧭 Jak to funguje

1. Uživatel zvolí **Zaměření**, poté **datum OD–DO** pro načtení kurzů, které chce zduplikovat, a potvrdí tlačítkem **„Načíst kurzy"**.
2. Zobrazí se všechny kurzy z daného období a zaměření.
3. Uživatel zvolí **„Nové datum OD"** — tedy kam se mají kurzy zkopírovat.
4. Může zvolit i způsob posunu:
   - **Přesný posun** — kurzy se posunou přesně o zadaný počet dní.
   - **Zachovat dny v týdnu** — posun se zaokrouhlí na celé týdny, aby lekce zůstaly ve stejných dnech v týdnu (efektivní datum OD se může lišit o ±3 dny).
   > Pozn.: posun je ukotvený na **datum OD zdrojového období**, ne na první lekci. Chcete-li, aby první lekce začínala přesně zadaným dnem, zadejte v prvním kroku datum OD shodné s datem první lekce.
5. Následně je možné zkontrolovat všechny kurzy a jejich nové umístění — kliknutím na **„detail"** se u kurzu zobrazí i jeho jednotlivé lekce.
6. U konkrétních lekcí lze ručně **změnit datum/čas** (např. pokud by zasahovaly do svátku apod.). Takto upravená lekce se „připne" a globální přepočet ji už nemění.
7. Dají se nastavit dvě hodnoty, které aktuálně nejsou součástí API, a web je tedy nedokázal načíst:
   - **„Povolit rezervace jednotlivých lekcí"**
   - **„Konec registrace"** — tedy dokdy je možné se na kurz rezervovat.
8. Tlačítkem **„Vytvořit kurzy"** dojde k okamžitému vytvoření kurzů.

> 🛑 **Pozor, tato akce je nevratná!** Pokud takto zkopírujete kurzy do špatných dat, musíte je upravit nebo smazat ručně v administraci Reservanta.

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
- [`DESIGN.md`](DESIGN.md) — Reservanto Design System a konvence UI
