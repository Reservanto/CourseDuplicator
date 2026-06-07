# Reservanto Design System — MERCHANT ADMIN

> Samonosný návod pro Claude Code. Přilož tento soubor do nového projektu
> zakázkové administrace pro merchanty. Drž se ho — cílem je jednotný,
> negenerický vzhled napříč administracemi Reservanto.

---

## 1. Co stavíme a osobnost

Administrace, kterou používá **merchant** (majitel/personál provozovny), aby si
spravoval rezervace, klienty a nastavení. Charakter: **profesionální, moderní,
minimalistický — a navíc vzdušný, srozumitelný a důvěryhodný.** Merchant tu řeší
svůj byznys, takže rozhraní má působit klidně, čistě a bezpečně. Obsah jsou hlavně
**datové tabulky/seznamy a formuláře**, ale s větším dýchacím prostorem než interní
nástroje.

**Dělej:** víc bílého prostoru, měkčí rohy, srozumitelné popisky a microcopy,
pohodlně velké ovládací prvky. Strukturu nese bílá karta na šedém plátně.
**Nedělej:** vizuální šum, přebytečné ohraničení, výrazné stíny, gradienty,
dekorace, žargon. Žádné zahlcení — merchant není školený operátor.

---

## 2. Rychlý start

Zkopíruj do projektu tyto tři soubory (typicky do `wwwroot/css/design/`):
`tokens.css`, `components.css`, `theme.css` (merchant varianta).

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/design/tokens.css">
<link rel="stylesheet" href="/css/design/components.css">
<link rel="stylesheet" href="/css/design/theme.css">
```
```html
<body class="rds-app rds-theme--merchant">
```

Stack: Vanilla JS/TS, Razor, .NET, SCSS. Komponenty jsou **čisté CSS** — žádný JS
framework. Interaktivitu (otevření modalu, toast, řazení) řeš vlastním JS přes
třídy `.is-*` a atributy `data-*`.

---

## 3. Pravidla, na kterých to stojí

- **Dvě vrstvy tokenů.** Primitiva `--rds-*` (paleta) NEPOUŽÍVEJ v markupu napřímo.
  V komponentách a custom CSS používej JEN sémantické tokeny `--color-*`,
  `--control-*`, `--card-*`, density tokeny. Téma a budoucí dark mode přepisují
  právě sémantickou vrstvu.
- **Konvence tříd:** prefix `.rds-`, BEM modifikátory (`rds-btn--primary`,
  `rds-card__head`), stavy přes `.is-*` (`.is-active`, `.is-invalid`, `.is-stuck`).
- **Font Ubuntu** má jen váhy **300 / 400 / 500 / 700**. Řez 100/200 neexistuje
  (spadne na 300). Nikdy nepoužívej tenčí než 300.
- **Brand barva `#74b9bf` je světlá** → na plné výplně s bílým textem NEPROCHÁZÍ
  kontrast. Pro výplně tlačítek/akcí používej `--color-accent` (tmavší teal).
  `#74b9bf` (`--color-accent-brand`) je pro logo, focus ring a jemná podbarvení.
- **Žádný custom CSS, který obchází tokeny.** Když potřebuješ rozměr/barvu, vezmi
  token. Když token chybí, přidej ho do `tokens.css`, ne natvrdo hodnotu.
- **Microcopy je součást designu.** Popisky polí, prázdné stavy a potvrzovací
  dialogy piš lidsky a srozumitelně — merchant ocení vedení za ruku.

---

## 4. Token reference

### Barvy — sémantické (používej tyto)
| Token | Použití |
|---|---|
| `--color-bg` | plátno aplikace (šedé) |
| `--color-surface` | karty, panely (bílá) |
| `--color-surface-2` | zanořené plochy, paticky |
| `--color-ink` / `-ink-2` / `-ink-3` | text: primární / sekundární / tlumený |
| `--color-ink-inv` | text na akcentu/tmavém (bílá) |
| `--color-border` / `-border-strong` | jemné linky / ohraničení inputů |
| `--color-accent` / `-accent-hover` | výplně tlačítek a akcí |
| `--color-accent-brand` | oficiální #74b9bf — logo, focus ring |
| `--color-accent-muted` | aktivní položka menu, výběr |
| `--color-accent-soft` | nejjemnější podbarvení |
| `--color-success/-warning/-danger/-info` + `*-soft` | stavy + jejich podklady |
| `--color-focus-ring` / `-focus-halo` | barva a halo focus prstence |

### Brand teal (primitiva, jen pro referenci)
`50 #f0f7f8` · `100 #d9ebec` · `200 #b9dadd` · `300 #94c7cb` · **`400 #74b9bf` (BRAND)** ·
`500 #4ea3aa` · **`600 #2f8088` (tlačítka)** · `700 #256a71` (hover) · `800 #1f565c` · `900 #1a4549`

### Stavové barvy (ověřené na WCAG AA)
success `#147a52` / soft `#e6f6f0` · warning `#946000` / soft `#fdf3e0` ·
danger `#c0303a` / soft `#fdeef0` · info `#2660bf` / soft `#eaf1fc`

### Typografie
Velikosti: `--rds-text-xs 11.5` · `sm 12.5` · `base 13.5` · `md 14` · `lg 16` ·
`xl 18` · `2xl 22` · `3xl 28`. Váhy: light 300, regular 400, medium 500, bold 700.
Merchant používá základní font **14 px** (nastaveno tématem).

### Spacing (4px základ)
`--rds-space-1 2` · `2 4` · `3 6` · `4 8` · `5 10` · `6 12` · `8 16` · `10 20` ·
`12 24` · `16 32` · `20 40` · `24 48` · `32 64`. Pro vlastní mezery používej tyto.

### Rádius / stíny
Rádius: `sm 2` · `base 4` · `lg 5` · `xl 8` · `pill`. Merchant má prvky měkčí
(radius 5, karty 8). Stíny: `sm` (default karet) · `base` · `md` (dropdowny) ·
`lg` (modal/toast).

---

## 5. Katalog komponent (HTML vzory)

Všechno funguje uvnitř `<body class="rds-app rds-theme--merchant">`.

### Tlačítka
```html
<button class="rds-btn rds-btn--primary">Uložit</button>
<button class="rds-btn rds-btn--secondary">Zrušit</button>
<button class="rds-btn rds-btn--ghost">Více</button>
<button class="rds-btn rds-btn--danger">Smazat</button>
<button class="rds-btn rds-btn--secondary rds-btn--sm">Malé</button>
<button class="rds-btn rds-btn--primary" disabled>Disabled</button>
```
Jen jedna primární akce na sekci. Destruktivní akce = `--danger`.

### Formulářové pole
```html
<div class="rds-field">
  <label class="rds-label rds-label--required">Klient</label>
  <input class="rds-input" placeholder="Jméno nebo telefon">
  <span class="rds-help">Začni psát pro našeptávání.</span>
</div>

<div class="rds-field">
  <label class="rds-label">E-mail</label>
  <input class="rds-input is-invalid" value="spatny">
  <span class="rds-error">Neplatný formát e-mailu.</span>
</div>

<select class="rds-select">…</select>
<textarea class="rds-textarea"></textarea>

<div class="rds-input-icon"><span class="ico">⌕</span>
  <input class="rds-input" placeholder="Hledat…"></div>

<label class="rds-check"><input type="checkbox" checked> Poslat potvrzení</label>

<label class="rds-switch"><input type="checkbox" checked><span class="track"></span></label>
```

### Badge / stav
```html
<span class="rds-badge rds-badge--dot rds-badge--success">Potvrzeno</span>
<span class="rds-badge rds-badge--dot rds-badge--warning">Čeká</span>
<span class="rds-badge rds-badge--dot rds-badge--danger">Zrušeno</span>
<span class="rds-badge rds-badge--info">Info</span>
<span class="rds-badge rds-badge--neutral">Koncept</span>
```

### Karta
```html
<div class="rds-card">
  <div class="rds-card__head"><h2 class="rds-h2">Nadpis</h2>
    <button class="rds-btn rds-btn--secondary rds-btn--sm">Akce</button></div>
  <div class="rds-card__body"> … </div>
  <div class="rds-card__foot">
    <button class="rds-btn rds-btn--secondary">Zrušit</button>
    <button class="rds-btn rds-btn--primary">Uložit</button></div>
</div>
```

### Tabulka s toolbarem (hlavní vzor)
```html
<div class="rds-card">
  <div class="rds-toolbar">
    <h2 class="rds-h2">Dnešní rezervace</h2>
    <div class="filters">
      <div class="rds-input-icon"><span class="ico">⌕</span><input class="rds-input" placeholder="Hledat…"></div>
      <select class="rds-select"><option>Všichni pracovníci</option></select>
    </div>
  </div>
  <table class="rds-table">
    <thead><tr><th>Čas</th><th>Klient</th><th>Stav</th><th class="num">Cena</th><th></th></tr></thead>
    <tbody>
      <tr>
        <td>09:00</td>
        <td><span class="cell-strong">Marie Dvořáková</span><br><span class="rds-muted">+420 731 552 814</span></td>
        <td><span class="rds-badge rds-badge--dot rds-badge--success">Potvrzeno</span></td>
        <td class="num">890 Kč</td>
        <td><button class="rds-btn rds-btn--secondary rds-btn--sm">Detail</button></td>
      </tr>
    </tbody>
  </table>
</div>
```
Číselné sloupce: `class="num"` (zarovná vpravo, tabulkové číslice). Řaditelná
hlavička: `<th class="sortable">Cena <span class="arrow">▾</span></th>`.

### KPI
```html
<div class="rds-kpis">
  <div class="rds-kpi"><div class="rds-kpi__label">Rezervace</div>
    <div class="rds-kpi__value">42</div>
    <div class="rds-kpi__delta rds-kpi__delta--up">+8 %</div></div>
</div>
```

### App shell (layout)
```html
<div class="rds-layout">
  <aside class="rds-sidebar">
    <div class="rds-brand"><span class="rds-brand__mark">R</span> Reservanto</div>
    <nav class="rds-nav">
      <a href="#" class="is-active"><span class="ico">▤</span> Rezervace</a>
      <a href="#"><span class="ico">◉</span> Klienti</a>
    </nav>
  </aside>
  <div class="rds-main">
    <div class="rds-topbar"><div class="rds-crumb">Studio Harmonie / <b>Rezervace</b></div>
      <div class="rds-avatar">PJ</div></div>
    <div class="rds-content rds-stack-8"> … obsah stránky … </div>
  </div>
</div>
```
Sidebar i topbar jsou **bez pozadí** (splývají s plátnem). Při scrollu přidej
topbaru `.is-stuck` (sticky + jemný stín). U Merchanta dávej obsahu víc prostoru
(`rds-stack-8`).

### Modal
```html
<div class="rds-overlay">
  <div class="rds-modal">
    <div class="rds-modal__head"><h3>Zrušit rezervaci?</h3>
      <button class="rds-modal__close">×</button></div>
    <div class="rds-modal__body">Opravdu chcete zrušit rezervaci pro Karla Novotného
      v 13:00? Klient dostane informační e-mail.</div>
    <div class="rds-modal__foot">
      <button class="rds-btn rds-btn--secondary">Zpět</button>
      <button class="rds-btn rds-btn--danger">Zrušit rezervaci</button></div>
  </div>
</div>
```

### Toast
```html
<div class="rds-toasts">
  <div class="rds-toast rds-toast--success"><span class="bar"></span>Uloženo.</div>
  <div class="rds-toast rds-toast--danger"><span class="bar"></span>Nepodařilo se uložit.</div>
</div>
```

### Prázdný stav
```html
<div class="rds-card"><div class="rds-empty">
  <div class="rds-empty__icon">▤</div>
  <div class="rds-empty__title">Zatím žádné rezervace</div>
  <div>Jakmile přijde první rezervace, uvidíte ji tady.</div>
  <div style="margin-top:16px"><button class="rds-btn rds-btn--primary">+ Nová rezervace</button></div>
</div></div>
```

### Pomocné utility
`rds-stack-6` / `rds-stack-8` (svislé mezery mezi dětmi), `rds-row` (flex řádek),
`rds-spread` (space-between).

---

## 6. Typické stránky

**Seznam (list):** app shell → `rds-content` → volitelně `rds-kpis` → karta s
`rds-toolbar` + `rds-table`. Filtry vpravo v toolbaru. Prázdný stav s vlídným
textem místo tabulky, když nejsou data.

**Detail / formulář:** app shell → karta s `rds-card__body` obsahující grid polí
(`display:grid; grid-template-columns:1fr 1fr; gap: var(--rds-space-10)`) →
`rds-card__foot` s akcemi (sekundární vlevo od primární, obě vpravo). U merchant
formulářů přidávej `rds-help` popisky tam, kde by mohl tápat.

---

## 7. Přístupnost

- Text musí mít kontrast ≥ 4.5 vůči pozadí (stavové barvy už ověřené).
- Nikdy bílý text na `--color-accent-brand` (#74b9bf) — použij `--color-accent`.
- Interaktivní prvky mají focus stav (komponenty ho mají přes `:focus-visible`).
  Nevypínej outline bez náhrady.
- Stav nesignalizuj jen barvou — badge má i tečku/text, ne jen odstín.

---

## 8. Když něco chybí

Potřebuješ komponentu, která tu není? Postav ji ze stejných tokenů a stejné
konvence (`.rds-`, density tokeny, sémantické barvy), ať zapadne. Nepřidávej nové
barvy ani fonty. Když přidáš token, dej ho do `tokens.css`.
