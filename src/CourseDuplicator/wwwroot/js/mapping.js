// Mapovací logika datumů (spec 6) - pure funkce bez DOM manipulací a bez fetch volání.
// Všechny Date hodnoty jsou lokální čas prohlížeče; posuny dnů se dělají kalendářně
// (zachovávají hodinu/minutu i přes přechod letního času).
window.CourseDuplicator = window.CourseDuplicator || {};

window.CourseDuplicator.Mapping = (() => {
    const MS_PER_DAY = 86400000;

    // Jediný zdroj pravdy pro povolené hodnoty (spec 4.2, 6). Konzumuje je validace
    // v duplicator.js (applyPrefs); zdejší switche/podmínky enumerují stejné hodnoty.
    const SHIFT_STRATEGIES = ['weekday', 'exact', 'rhythm'];
    const REGISTRATION_END_STRATEGIES = ['keepOffset', 'atStart', 'daysBefore'];
    const RHYTHM_END_MODES = ['endDate', 'count'];
    const HOLIDAY_COUNTRIES = ['CZ', 'SK'];

    /** Rozsah počtu lekcí v režimu 'count' (spec 5C). */
    const LECTION_COUNT_MIN = 1;
    const LECTION_COUNT_MAX = 52;
    /** Pojistka generování - max počet týdnů (2 roky, spec 6.6.2). */
    const RHYTHM_MAX_ITERATIONS = 104;

    const pad2 = (n) => String(n).padStart(2, '0');

    /** Rozdíl celých kalendářních dnů mezi dvěma daty (ignoruje čas, imunní vůči DST). */
    const daysBetween = (from, to) => {
        const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
        const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
        return Math.round((toUtc - fromUtc) / MS_PER_DAY);
    };

    /** Posun o celé dny se zachováním hodiny/minuty (kalendářní aritmetika, ne ms). */
    const addDays = (date, days) => new Date(
        date.getFullYear(), date.getMonth(), date.getDate() + days,
        date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());

    /** Půlnoc daného dne (lokální čas). */
    const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const isSameDay = (a, b) => daysBetween(a, b) === 0;

    /** Čas začátku ve tvaru 'HH:mm'. */
    const timeOfDay = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

    /** Nový start lekce s respektováním pinned hodnoty (spec 6.3). */
    const lectionNewStart = (lection) => (lection.isPinned ? lection.pinnedNewStart : lection.newStart) ?? null;

    const lengthMinutes = (lection) =>
        Math.round((lection.originalEnd.getTime() - lection.originalStart.getTime()) / 60000);

    /**
     * Spočítá posun dnů podle strategie (spec 6.1, 6.2).
     * 'weekday' zaokrouhlí posun na celé týdny (zachová dny v týdnu),
     * 'exact' posune přesně o zadaný počet dnů.
     * Vrací { shiftDays, effectiveNewFrom } - efektivní nové OD je sourceFrom + shiftDays.
     */
    const calculateShift = (sourceFromDate, newFromDate, strategy) => {
        const dayDiff = daysBetween(sourceFromDate, newFromDate);
        const shiftDays = strategy === 'weekday'
            ? Math.round(dayDiff / 7) * 7
            : dayDiff;
        return { shiftDays, effectiveNewFrom: addDays(sourceFromDate, shiftDays) };
    };

    /** Posune datum lekce o shiftDays dnů, hodina/minuta zůstávají (spec 6.1/6.2). */
    const mapLectionDate = (originalDate, shiftDays) => addDays(originalDate, shiftDays);

    /**
     * Spočítá nový RegistrationEnd kurzu (spec 6.4).
     * 'keepOffset' zachová původní offset od startu kurzu,
     * 'atStart' = začátek první lekce,
     * 'daysBefore' = N*86400 sekund před začátkem.
     */
    const calculateRegistrationEnd = (course, newCourseStart, strategy, daysBefore) => {
        switch (strategy) {
            case 'keepOffset': {
                const offsetMs = course.originalStartDate.getTime() - course.originalRegistrationEnd.getTime();
                return new Date(newCourseStart.getTime() - offsetMs);
            }
            case 'atStart':
                return new Date(newCourseStart.getTime());
            case 'daysBefore':
                return new Date(newCourseStart.getTime() - daysBefore * MS_PER_DAY);
            default:
                throw new Error(`Neznámá strategie RegistrationEnd: ${strategy}`);
        }
    };

    /**
     * Aktivní (ne-vyloučené) lekce kurzu pro danou strategii jako [{ start, lengthMinutes, lection }].
     * Posun bere course.lections (délka z původní lekce), 'rhythm' bere course.rhythmLections
     * (délka z rytmu kurzu, spec 6.6.2). Lekce bez spočteného startu se vynechají.
     */
    const activeLections = (course, strategy) => {
        const result = [];
        if (strategy === 'rhythm') {
            const length = course.rhythm ? course.rhythm.lengthMinutes : 0;
            for (const lection of course.rhythmLections ?? []) {
                if (lection.isExcluded) continue;
                const start = lectionNewStart(lection);
                if (start) result.push({ start, lengthMinutes: length, lection });
            }
        } else {
            for (const lection of course.lections) {
                if (lection.isExcluded) continue;
                const start = lectionNewStart(lection);
                if (start) result.push({ start, lengthMinutes: lengthMinutes(lection), lection });
            }
        }
        return result;
    };

    /**
     * Vypočtené datum DO období (spec 6.5): MAX z konců (newStart + délka lekce)
     * všech ne-vyloučených lekcí ne-vyloučených kurzů. Pinned lekce se berou
     * z pinnedNewStart. Vrací null, pokud žádná lekce nemá spočítaný nový start.
     * Bez strategie (nebo s 'weekday'/'exact') počítá z posunutých lekcí, s 'rhythm' z rhythmLections.
     */
    const calculatePeriodEndDate = (courses, strategy = 'weekday') => {
        let max = null;
        for (const course of courses) {
            if (course.isExcluded) continue;
            for (const { start, lengthMinutes: length } of activeLections(course, strategy)) {
                const endTime = new Date(start.getTime() + length * 60000);
                if (max === null || endTime > max) max = endTime;
            }
        }
        return max;
    };

    /** Nejdřívější nový start přes ne-vyloučené lekce ne-vyloučených kurzů (null = žádná). */
    const calculatePeriodStartDate = (courses, strategy = 'weekday') => {
        let min = null;
        for (const course of courses) {
            if (course.isExcluded) continue;
            for (const { start } of activeLections(course, strategy)) {
                if (min === null || start < min) min = start;
            }
        }
        return min;
    };

    /**
     * Globální přepočet (spec 6.1-6.4, 6.6.3): u posunu nastaví newStart každé ne-pinned lekci,
     * pro každý kurz newRegistrationEnd. Pinned hodnoty nepřepisuje. U strategie 'rhythm'
     * lekce negeneruje (to dělá regenerateRhythmLections), jen spočítá newRegistrationEnd
     * z rhythmLections. Mutuje state in-place.
     */
    const applyMappingToState = (state) => {
        if (!state.newFrom) return state;

        const isRhythm = state.shiftStrategy === 'rhythm';
        const shiftDays = isRhythm
            ? 0
            : calculateShift(state.sourceFrom, state.newFrom, state.shiftStrategy).shiftDays;

        for (const course of state.courses) {
            // Počítá se i pro vyloučené kurzy/lekce - po zpětném zařazení jsou hodnoty rovnou k dispozici.
            if (!isRhythm) {
                for (const lection of course.lections) {
                    if (lection.isPinned) continue;
                    lection.newStart = mapLectionDate(lection.originalStart, shiftDays);
                }
            }

            // Nový start kurzu = minimum z nových startů ne-vyloučených lekcí (spec 6.4, 6.6.3).
            let newCourseStart = null;
            for (const { start } of activeLections(course, state.shiftStrategy)) {
                if (newCourseStart === null || start < newCourseStart) newCourseStart = start;
            }

            course.newRegistrationEnd = newCourseStart === null
                ? null
                : calculateRegistrationEnd(
                    course, newCourseStart, state.registrationEndStrategy, state.registrationEndDaysBefore);
        }

        return state;
    };

    // ---- Strategie „Nový rozvrh podle týdenního rytmu" (spec 6.6) ----

    /**
     * Detekce rytmu kurzu (spec 6.6.1). Kurz je rytmický, pokud všechny jeho lekce mají
     * stejný den v týdnu, čas začátku a délku a sousední lekce jsou od sebe kladný násobek
     * 7 kalendářních dnů. Jedna lekce = rytmický. Bez lekcí není z čeho rytmus odvodit -> null.
     * Vrací { weekday (0 = neděle), time: 'HH:mm', lengthMinutes } nebo null.
     */
    const detectRhythm = (lections) => {
        if (!lections || lections.length === 0) return null;
        const sorted = [...lections].sort((a, b) => a.originalStart - b.originalStart);
        const first = sorted[0];
        const rhythm = {
            weekday: first.originalStart.getDay(),
            time: timeOfDay(first.originalStart),
            lengthMinutes: lengthMinutes(first),
        };
        for (let i = 1; i < sorted.length; i++) {
            const lection = sorted[i];
            if (lection.originalStart.getDay() !== rhythm.weekday) return null;
            if (timeOfDay(lection.originalStart) !== rhythm.time) return null;
            if (lengthMinutes(lection) !== rhythm.lengthMinutes) return null;
            const gap = daysBetween(sorted[i - 1].originalStart, lection.originalStart);
            if (gap <= 0 || gap % 7 !== 0) return null;
        }
        return rhythm;
    };

    /** Leží den v některém intervalu vynechaných dnů (od-do včetně, jen datum)? */
    const isDayExcluded = (day, excludedDays) => (excludedDays ?? []).some(
        (range) => daysBetween(range.from, day) >= 0 && daysBetween(day, range.to) >= 0);

    /**
     * Jsou parametry rytmu kompletní a platné pro generování (spec 5C)?
     * Začátek bloku musí být zadán; 'endDate' vyžaduje konec >= začátek,
     * 'count' celé číslo 1-52.
     */
    const rhythmParamsComplete = (params) => {
        if (!params.newFrom) return false;
        if (params.rhythmEndMode === 'count') {
            return Number.isInteger(params.lectionCount)
                && params.lectionCount >= LECTION_COUNT_MIN
                && params.lectionCount <= LECTION_COUNT_MAX;
        }
        return params.newTo instanceof Date && daysBetween(params.newFrom, params.newTo) >= 0;
    };

    /**
     * Vygeneruje starty lekcí z rytmu (spec 6.6.2). params = { newFrom, rhythmEndMode,
     * newTo, lectionCount, excludedDays }. Den, který padne do vynechaných dnů, lekci
     * nevytvoří; v režimu 'count' se tím kurz prodlouží, v 'endDate' sníží počet lekcí.
     * Čas lekce se skládá kalendářně (lokální čas), takže přežije přechod letního času.
     * Vrací pole Date (může být prázdné). Neúplné parametry -> [].
     */
    const generateRhythmLections = (rhythm, params) => {
        if (!rhythm || !rhythmParamsComplete(params)) return [];

        const [hours, minutes] = rhythm.time.split(':').map(Number);
        const blockStart = startOfDay(params.newFrom);
        let day = addDays(blockStart, (rhythm.weekday - blockStart.getDay() + 7) % 7);

        const starts = [];
        for (let iteration = 0; ; iteration++) {
            if (params.rhythmEndMode === 'endDate' && daysBetween(params.newTo, day) > 0) break;
            if (params.rhythmEndMode === 'count' && starts.length === params.lectionCount) break;
            if (iteration >= RHYTHM_MAX_ITERATIONS) break;
            if (!isDayExcluded(day, params.excludedDays)) {
                starts.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes));
            }
            day = addDays(day, 7);
        }
        return starts;
    };

    /**
     * Přegeneruje course.rhythmLections všech kurzů (i vyloučených - po zpětném zařazení jsou
     * hned k dispozici). Zahodí předchozí ruční úpravy a vyloučení (spec 6.3). Kurz bez rytmu
     * dostane prázdný seznam. Mutuje state in-place.
     */
    const regenerateRhythmLections = (state) => {
        for (const course of state.courses) {
            course.rhythmLections = generateRhythmLections(course.rhythm, state).map((newStart) => ({
                newStart,
                isExcluded: false,
                isPinned: false,
                pinnedNewStart: null,
            }));
        }
        return state;
    };

    /** Počet lekcí v rhythmLections s ruční úpravou nebo vyloučením (ty by přegenerování zahodilo). */
    const countRhythmEdits = (courses) => courses.reduce(
        (sum, course) => sum + (course.rhythmLections ?? []).filter((l) => l.isPinned || l.isExcluded).length, 0);

    // ---- Státní svátky CZ/SK (spec 6.6.4) ----

    /** Velikonoční neděle - Meeus/Jones/Butcher, gregoriánský kalendář. */
    const easterSunday = (year) => {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    };

    // Pevné svátky ve tvaru 'MM-DD'. Pohyblivé (Velký pátek, Velikonoční pondělí) se dopočítají.
    // Musí odpovídat seznamu svátků v kódu Reservanta.
    const FIXED_HOLIDAYS = {
        CZ: [
            ['01-01', 'Nový rok, Den obnovy samostatného českého státu'],
            ['05-01', 'Svátek práce'],
            ['05-08', 'Den vítězství'],
            ['07-05', 'Den slovanských věrozvěstů Cyrila a Metoděje'],
            ['07-06', 'Den upálení mistra Jana Husa'],
            ['09-28', 'Den české státnosti'],
            ['10-28', 'Den vzniku samostatného československého státu'],
            ['11-17', 'Den boje za svobodu a demokracii'],
            ['12-24', 'Štědrý den'],
            ['12-25', '1. svátek vánoční'],
            ['12-26', '2. svátek vánoční'],
        ],
        SK: [
            ['01-01', 'Den vzniku Slovenské republiky'],
            ['01-06', 'Zjevení Páně (Tři králové)'],
            ['05-01', 'Svátek práce'],
            ['05-08', 'Den vítězství nad fašismem'],
            ['07-05', 'Svátek sv. Cyrila a Metoděje'],
            ['08-29', 'Výročí Slovenského národního povstání'],
            ['09-15', 'Sedmibolestná Panna Maria'],
            ['11-01', 'Všech svatých'],
            ['12-24', 'Štědrý den'],
            ['12-25', '1. svátek vánoční'],
            ['12-26', '2. svátek vánoční'],
        ],
    };

    /**
     * Výjimky po letech: svátky ('MM-DD'), které v daném roce odpadají (spec 6.6.4).
     * Další změny se doplní sem, bez úpravy logiky.
     */
    const HOLIDAY_EXCEPTIONS = [
        { country: 'SK', year: 2026, dates: ['05-08', '09-15'] }, // konsolidační balíček
    ];

    /** Svátky země v roce jako [{ date, label }] seřazené podle data. */
    const holidaysForYear = (country, year) => {
        const fixed = FIXED_HOLIDAYS[country];
        if (!fixed) throw new Error(`Neznámá země svátků: ${country}`);

        const removed = new Set(HOLIDAY_EXCEPTIONS
            .filter((x) => x.country === country && x.year === year)
            .flatMap((x) => x.dates));

        const easter = easterSunday(year);
        const holidays = fixed
            .filter(([monthDay]) => !removed.has(monthDay))
            .map(([monthDay, label]) => {
                const [month, day] = monthDay.split('-').map(Number);
                return { date: new Date(year, month - 1, day), label };
            });
        holidays.push(
            { date: addDays(easter, -2), label: 'Velký pátek' },
            { date: addDays(easter, 1), label: 'Velikonoční pondělí' });

        return holidays.sort((a, b) => a.date - b.date);
    };

    /** Svátky země v intervalu od-do (včetně, jen datum) jako [{ date, label }] seřazené podle data. */
    const holidaysInRange = (country, from, to) => {
        const result = [];
        for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
            for (const holiday of holidaysForYear(country, year)) {
                if (daysBetween(from, holiday.date) >= 0 && daysBetween(holiday.date, to) >= 0) {
                    result.push(holiday);
                }
            }
        }
        return result;
    };

    // ---- Seskupení a názvy (spec 5B, 5E) ----

    /**
     * Klíč skupiny stejných kurzů (spec 5B): původní název + kalendářní data lekcí
     * (bez času). Kurzy se stejným klíčem jsou typicky stejný kurz v různých časech.
     */
    const courseGroupKey = (course) => {
        const dates = [...course.lections]
            .sort((a, b) => a.originalStart - b.originalStart)
            .map((l) => {
                const d = l.originalStart;
                return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            });
        return `${course.name}\u0000${dates.join(',')}`;
    };

    /** Rozdělí kurzy do skupin podle courseGroupKey; zachová pořadí prvního výskytu. */
    const groupCourses = (courses) => {
        const groups = new Map();
        for (const course of courses) {
            const key = courseGroupKey(course);
            if (!groups.has(key)) groups.set(key, { key, courses: [] });
            groups.get(key).courses.push(course);
        }
        return [...groups.values()];
    };

    /**
     * Hromadná úprava názvu (spec 5E): nahradí všechny výskyty `find` za `replace`.
     * Prostý text, rozlišuje velikost písmen, žádné regexy. Prázdné `find` = beze změny.
     */
    const replaceInName = (name, find, replace) =>
        find ? name.split(find).join(replace ?? '') : name;

    // ---- Časová pravítka (spec 5A, 5C) ----

    /** Pondělí týdne, do kterého datum patří (půlnoc, lokální čas). */
    const startOfWeek = (date) => {
        const day = startOfDay(date);
        return addDays(day, -((day.getDay() + 6) % 7));
    };

    /** Klíč kalendářního dne 'YYYY-MM-DD' (lokální čas). */
    const dayKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

    /**
     * Bloky kurzů pro pravítko (spec 5A): blok = kurzy se stejným týdnem začátku a stejným
     * týdnem konce. Vstup [{ name, startDate, endDate }] (Date). Výstup seřazený podle začátku
     * (při shodě kratší blok dřív): [{ key, from, to, courses, names: [{ name, count }] }],
     * kde from/to = nejdřívější začátek / nejpozdější konec kurzů bloku a names jsou různé
     * názvy (skupiny) seřazené podle počtu kurzů sestupně, pak abecedně.
     */
    const groupCourseBlocks = (courses) => {
        const blocks = new Map();
        for (const course of courses) {
            const key = `${dayKey(startOfWeek(course.startDate))}|${dayKey(startOfWeek(course.endDate))}`;
            let block = blocks.get(key);
            if (!block) {
                block = { key, from: course.startDate, to: course.endDate, courses: [] };
                blocks.set(key, block);
            }
            block.courses.push(course);
            if (course.startDate < block.from) block.from = course.startDate;
            if (course.endDate > block.to) block.to = course.endDate;
        }

        for (const block of blocks.values()) {
            const counts = new Map();
            for (const course of block.courses) {
                const name = course.name ?? '';
                counts.set(name, (counts.get(name) ?? 0) + 1);
            }
            block.names = [...counts]
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'cs'));
        }

        return [...blocks.values()].sort((a, b) => (a.from - b.from) || (a.to - b.to));
    };

    /** Počty startů po kalendářních dnech: [{ day (půlnoc), count }] seřazené podle data. */
    const countByDay = (dates) => {
        const days = new Map();
        for (const date of dates) {
            const key = dayKey(date);
            const entry = days.get(key);
            if (entry) entry.count++;
            else days.set(key, { day: startOfDay(date), count: 1 });
        }
        return [...days.values()].sort((a, b) => a.day - b.day);
    };

    /** Prvních dnů měsíců v intervalu od-do (včetně, jen datum) - značky osy pravítka. */
    const monthStarts = (from, to) => {
        const result = [];
        let month = new Date(from.getFullYear(), from.getMonth(), 1);
        if (daysBetween(from, month) < 0) month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
        while (daysBetween(month, to) >= 0) {
            result.push(month);
            month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
        }
        return result;
    };

    return {
        SHIFT_STRATEGIES,
        REGISTRATION_END_STRATEGIES,
        RHYTHM_END_MODES,
        HOLIDAY_COUNTRIES,
        LECTION_COUNT_MIN,
        LECTION_COUNT_MAX,
        daysBetween,
        addDays,
        startOfDay,
        isSameDay,
        calculateShift,
        mapLectionDate,
        calculateRegistrationEnd,
        activeLections,
        calculatePeriodEndDate,
        calculatePeriodStartDate,
        applyMappingToState,
        detectRhythm,
        isDayExcluded,
        rhythmParamsComplete,
        generateRhythmLections,
        regenerateRhythmLections,
        countRhythmEdits,
        easterSunday,
        holidaysForYear,
        holidaysInRange,
        courseGroupKey,
        groupCourses,
        replaceInName,
        startOfWeek,
        dayKey,
        groupCourseBlocks,
        countByDay,
        monthStarts,
    };
})();
