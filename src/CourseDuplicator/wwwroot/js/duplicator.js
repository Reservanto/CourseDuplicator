// Frontend duplikátoru - sekce A (zdrojové období), B (přehled), C (cílové období),
// D (detail s novými datumy), E (globální nastavení), F (vytvoření) a G (výsledek).
// Mapovací logika je v mapping.js, tady jen state, API volání a render.
(() => {
    'use strict';

    const Mapping = window.CourseDuplicator.Mapping;
    const Ruler = window.CourseDuplicator.Ruler;

    // ---- Globální state (spec 4.2) ----
    const state = {
        segmentId: null,
        sourceFrom: null,
        sourceTo: null,

        newFrom: null,
        shiftStrategy: 'weekday',

        // Jen pro shiftStrategy = 'rhythm' (spec 6.6)
        rhythmEndMode: 'endDate',
        newTo: null,
        lectionCount: null,
        excludedDays: [],
        holidayCountry: 'CZ',

        singleLectionBookingEnabled: false,
        singleLectionBookingFrom: null,
        registrationEndStrategy: 'keepOffset',
        registrationEndDaysBefore: 3,
        nameFind: '',
        nameReplace: '',

        courses: [],
    };
    // Pro ladění v konzoli
    window.CourseDuplicator.state = state;

    // Čistě UI stav (není součástí spec state): rozbalené skupiny a bloky, data časových pravítek.
    const ui = {
        openGroups: new Set(),
        overlapOpen: false,
        // Pravítko sekce A: { segmentId, from, to, blocks } | null; cache podle zaměření.
        sourceBlocks: null,
        sourceBlocksCache: new Map(),
        // Existující kurzy v cílovém období pro pravítko sekce C (z CheckPeriod):
        // { status: 'loading' | 'done' | 'error', courses: [] } | null
        periodCourses: null,
        // Interval cílového období z posledního přepočtu (efektivní OD / začátek bloku - vypočtené DO).
        targetPeriod: null,
    };

    // Strategie „Nový rozvrh" z cookie čeká, až se načtou kurzy (použije se, jen když jsou rytmické - spec 9).
    let pendingPrefStrategy = null;

    // ---- Elementy ----
    const el = (id) => document.getElementById(id);
    const segmentSelect = el('segment-select');
    const segmentField = el('segment-field');
    const segmentSingle = el('segment-single');
    const sourceFromInput = el('source-from');
    const sourceToInput = el('source-to');
    const sourceRulerBlock = el('source-ruler-block');
    const sourceRuler = el('source-ruler');
    const sourceRulerStatus = el('source-ruler-status');
    const loadButton = el('load-courses-btn');
    const loadSpinner = el('load-spinner');
    const loadStatus = el('load-status');
    const loadError = el('load-error');
    const sectionOverview = el('section-overview');
    const courseList = el('course-list');
    const overlapBlock = el('overlap-block');
    const overlapTitle = el('overlap-title');
    const overlapList = el('overlap-list');
    const courseSummary = el('course-summary');
    const sectionTarget = el('section-target');
    const newFromLabel = el('new-from-label');
    const newFromInput = el('new-from');
    const newFromHelpShift = el('new-from-help-shift');
    const newFromHelpRhythm = el('new-from-help-rhythm');
    const targetError = el('target-error');
    const rhythmOption = el('rhythm-option');
    const rhythmRadio = el('rhythm-radio');
    const rhythmUnavailable = el('rhythm-unavailable');
    const rhythmUnavailableText = el('rhythm-unavailable-text');
    const excludeNonRhythmicButton = el('exclude-nonrhythmic-btn');
    const strategyNotice = el('strategy-notice');
    const rhythmParams = el('rhythm-params');
    const newToField = el('new-to-field');
    const newToInput = el('new-to');
    const lectionCountField = el('lection-count-field');
    const lectionCountInput = el('lection-count');
    const rhythmError = el('rhythm-error');
    const excludedFromInput = el('excluded-from');
    const excludedToInput = el('excluded-to');
    const excludedAddButton = el('excluded-add-btn');
    const excludedError = el('excluded-error');
    const excludedList = el('excluded-list');
    const holidaysAddButton = el('holidays-add-btn');
    const holidaysStatus = el('holidays-status');
    const effectiveFromLabel = el('effective-from-label');
    const effectiveFromEl = el('effective-from');
    const computedToEl = el('computed-to');
    const targetRulerBlock = el('target-ruler-block');
    const targetRuler = el('target-ruler');
    const legendExcluded = el('legend-excluded');
    const periodCheck = el('period-check');
    const sectionDetail = el('section-detail');
    const lectionCountWarning = el('lection-count-warning');
    const courseDetailList = el('course-detail-list');
    const sectionSettings = el('section-settings');
    const singleLectionEnabled = el('single-lection-enabled');
    const singleLectionFromField = el('single-lection-from-field');
    const singleLectionFrom = el('single-lection-from');
    const registrationEndStrategy = el('registration-end-strategy');
    const registrationEndDaysField = el('registration-end-days-field');
    const registrationEndDays = el('registration-end-days');
    const nameFindInput = el('name-find');
    const nameReplaceInput = el('name-replace');
    const nameSummary = el('name-summary');
    const createSummary = el('create-summary');
    const createWarning = el('create-warning');
    const createBlocker = el('create-blocker');
    const createButton = el('create-courses-btn');
    const createSpinner = el('create-spinner');
    const createStatus = el('create-status');
    const createError = el('create-error');
    const sectionResult = el('section-result');
    const resultSummary = el('result-summary');
    const resultList = el('result-list');
    const resetButton = el('reset-btn');
    const confirmOverlay = el('confirm-overlay');
    const confirmText = el('confirm-text');
    const confirmOk = el('confirm-ok');
    const confirmCancel = el('confirm-cancel');

    // ---- API helpers ----
    const antiforgeryToken = () =>
        document.querySelector('input[name="__RequestVerificationToken"]').value;

    const fetchJson = async (url, options = {}) => {
        const response = await fetch(url, { ...options, headers: { ...options.headers } });
        // RequireAuth filtr přesměrovává na Login; fetch redirect následuje - pošleme tam celý prohlížeč.
        if (response.redirected || response.status === 401) {
            window.location.href = '/Auth/Login';
            throw new Error('Nepřihlášen');
        }
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(body?.error ?? `Server vrátil chybu ${response.status}.`);
        }
        return body;
    };

    const postJson = (url, body) => fetchJson(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'RequestVerificationToken': antiforgeryToken(),
        },
        body: JSON.stringify(body),
    });

    const api = {
        getSegments: () => fetchJson('/?handler=Segments'),
        getCourseBlocks: (segmentId) => fetchJson(`/?handler=CourseBlocks&segmentId=${encodeURIComponent(segmentId)}`),
        loadCourses: (segmentId, from, to) => postJson('/?handler=LoadCourses', { segmentId, from, to }),
        checkPeriod: (segmentId, from, to) => postJson('/?handler=CheckPeriod', { segmentId, from, to }),
        createCourses: (body) => postJson('/?handler=CreateCourses', body),
    };

    // ---- Formátování (čeština, Europe/Prague je lokální čas prohlížeče) ----
    const weekdayLong = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long' });
    const weekdayShort = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' });
    const pad2 = (n) => String(n).padStart(2, '0');

    /** "5. 1. 2026 (pondělí)" */
    const formatDate = (date) =>
        `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()} (${weekdayLong.format(date)})`;

    /** "5. 1. 2026 (po) 18:00" */
    const formatDateTime = (date) =>
        `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()} (${weekdayShort.format(date)}) ` +
        `${date.getHours()}:${pad2(date.getMinutes())}`;

    /** "8:30" */
    const formatTime = (date) => `${date.getHours()}:${pad2(date.getMinutes())}`;

    /** 'HH:mm' z rytmu -> "8:30" */
    const formatRhythmTime = (time) => {
        const [hours, minutes] = time.split(':');
        return `${Number(hours)}:${minutes}`;
    };

    /** Krátký název dne v týdnu podle indexu (0 = neděle): "út". 7. 1. 2024 je neděle. */
    const weekdayShortByIndex = (weekday) => weekdayShort.format(new Date(2024, 0, 7 + weekday));

    /** Vynechané dny: "28. 10. 2027 (čtvrtek)" nebo "25. 10. – 29. 10. 2027" (spec 5C). */
    const formatDayRange = (from, to) => {
        if (Mapping.isSameDay(from, to)) return formatDate(from);
        const sameYear = from.getFullYear() === to.getFullYear();
        const fromText = `${from.getDate()}. ${from.getMonth() + 1}.${sameYear ? '' : ` ${from.getFullYear()}`}`;
        return `${fromText} – ${to.getDate()}. ${to.getMonth() + 1}. ${to.getFullYear()}`;
    };

    /** Krátký rozsah bez dne v týdnu: "7. 9. – 7. 11. 2026", přes rok "30. 11. 2026 – 25. 1. 2027". */
    const formatShortRange = (from, to) => {
        const sameYear = from.getFullYear() === to.getFullYear();
        return `${from.getDate()}. ${from.getMonth() + 1}.${sameYear ? '' : ` ${from.getFullYear()}`}`
            + ` – ${to.getDate()}. ${to.getMonth() + 1}. ${to.getFullYear()}`;
    };

    /** Česká množná čísla: plural(3, 'kurz', 'kurzy', 'kurzů') -> 'kurzy'. */
    const plural = (n, one, few, many) => (n === 1 ? one : (n >= 2 && n <= 4 ? few : many));
    const coursesText = (n) => `${n} ${plural(n, 'kurz', 'kurzy', 'kurzů')}`;
    const lectionsText = (n) => `${n} ${plural(n, 'lekce', 'lekce', 'lekcí')}`;

    /** Hodnota pro input[type=date]: "2026-01-05" ('' pro null). */
    const toDateInputValue = (date) => date
        ? `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
        : '';

    /** Hodnota pro input[type=datetime-local]: "2026-01-05T18:00". */
    const toLocalInputValue = (date) =>
        `${toDateInputValue(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

    /** Parsování hodnoty datetime-local jako lokálního času (bez TZ překvapení). */
    const parseLocalInputValue = (value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
        if (!match) return null;
        const [, year, month, day, hour, minute] = match.map(Number);
        return new Date(year, month - 1, day, hour, minute);
    };

    const parseDateInput = (input, endOfDay) => {
        if (!input.value) return null;
        const [year, month, day] = input.value.split('-').map(Number);
        return endOfDay
            ? new Date(year, month - 1, day, 23, 59, 59)
            : new Date(year, month - 1, day);
    };

    const toUnix = (date) => Math.floor(date.getTime() / 1000);

    /** Aktuální nový start lekce s respektováním pinned hodnoty. */
    const lectionNewStart = (lection) =>
        (lection.isPinned ? lection.pinnedNewStart : lection.newStart) ?? null;

    const lectionLengthMinutes = (lection) =>
        Math.round((lection.originalEnd - lection.originalStart) / 60000);

    const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'cs'));

    // ---- Odvozené hodnoty ----
    const isRhythm = () => state.shiftStrategy === 'rhythm';

    /** Aktivní (ne-vyloučené) lekce kurzu pro aktuální strategii: [{ start, lengthMinutes, lection }]. */
    const activeLections = (course) => Mapping.activeLections(course, state.shiftStrategy);

    /** Název nového kurzu po hromadné úpravě (spec 5E). */
    const newName = (course) => Mapping.replaceInName(course.name, state.nameFind, state.nameReplace);
    const isNameInvalid = (course) => newName(course).trim() === '';

    /** Nevyloučené kurzy bez týdenního rytmu - blokují strategii „Nový rozvrh" (spec 5C). */
    const nonRhythmicIncluded = () => state.courses.filter((c) => !c.isExcluded && !c.rhythm);

    /** Kurzy zobrazené v sekci D: všechny v období + zahrnuté přesahující. */
    const detailCourses = () => state.courses.filter((c) => !c.isOverlapping || !c.isExcluded);

    /** Jsou zadané všechny vstupy cílového období (sekce D/E se zobrazí)? */
    const hasTargetInput = () => state.newFrom !== null && state.courses.length > 0
        && (!isRhythm() || Mapping.rhythmParamsComplete(state));

    /** Interval pro tlačítko svátků: začátek bloku – konec bloku, v režimu „Počet lekcí" + 12 měsíců (spec 5C). */
    const holidayRange = () => {
        if (!state.newFrom) return null;
        if (state.rhythmEndMode === 'count') {
            const from = state.newFrom;
            return { from, to: new Date(from.getFullYear() + 1, from.getMonth(), from.getDate()) };
        }
        if (!state.newTo || Mapping.daysBetween(state.newFrom, state.newTo) < 0) return null;
        return { from: state.newFrom, to: state.newTo };
    };

    const isPast = (date) => date <= new Date();

    // ---- Uchování naposledy zadaných hodnot (cookie, 30 dnů, spec 9) ----
    const PREFS_COOKIE = 'cd_prefs';
    const PREFS_MAX_AGE = 30 * 24 * 3600;

    const savePrefs = () => {
        const prefs = {
            segmentId: state.segmentId,
            sourceFrom: sourceFromInput.value || null,
            sourceTo: sourceToInput.value || null,
            newFrom: newFromInput.value || null,
            shiftStrategy: pendingPrefStrategy ?? state.shiftStrategy,
            rhythmEndMode: state.rhythmEndMode,
            holidayCountry: state.holidayCountry,
            singleLectionBookingEnabled: state.singleLectionBookingEnabled,
            singleLectionBookingFrom: singleLectionFrom.value || null,
            registrationEndStrategy: state.registrationEndStrategy,
            registrationEndDaysBefore: state.registrationEndDaysBefore,
        };
        document.cookie = `${PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(prefs))}`
            + `; max-age=${PREFS_MAX_AGE}; path=/; SameSite=Lax`;
    };

    const loadPrefs = () => {
        const entry = document.cookie.split('; ').find((c) => c.startsWith(`${PREFS_COOKIE}=`));
        if (!entry) return null;
        try {
            return JSON.parse(decodeURIComponent(entry.slice(PREFS_COOKIE.length + 1)));
        } catch {
            return null;
        }
    };

    const checkRadio = (name, value) => {
        const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (radio) radio.checked = true;
    };

    /** Předvyplní inputy a state z cookie. Segment se aplikuje až po načtení dropdownu. */
    const applyPrefs = (prefs) => {
        if (!prefs) return;

        if (prefs.sourceFrom) sourceFromInput.value = prefs.sourceFrom;
        if (prefs.sourceTo) sourceToInput.value = prefs.sourceTo;

        // Nové datum OD jen pokud je stále v budoucnu (pravidlo "nové OD > now").
        if (prefs.newFrom) {
            newFromInput.value = prefs.newFrom;
            const restored = parseDateInput(newFromInput, false);
            if (restored && restored > new Date()) {
                state.newFrom = restored;
            } else {
                newFromInput.value = '';
            }
        }

        if (prefs.shiftStrategy === 'rhythm') {
            // Použije se až po načtení kurzů, jen pokud jsou všechny rytmické (spec 9).
            pendingPrefStrategy = 'rhythm';
        } else if (Mapping.SHIFT_STRATEGIES.includes(prefs.shiftStrategy)) {
            state.shiftStrategy = prefs.shiftStrategy;
            checkRadio('shift-strategy', prefs.shiftStrategy);
        }

        if (Mapping.RHYTHM_END_MODES.includes(prefs.rhythmEndMode)) {
            state.rhythmEndMode = prefs.rhythmEndMode;
            checkRadio('rhythm-end-mode', prefs.rhythmEndMode);
        }
        if (Mapping.HOLIDAY_COUNTRIES.includes(prefs.holidayCountry)) {
            state.holidayCountry = prefs.holidayCountry;
            checkRadio('holiday-country', prefs.holidayCountry);
        }

        if (typeof prefs.singleLectionBookingEnabled === 'boolean') {
            state.singleLectionBookingEnabled = prefs.singleLectionBookingEnabled;
            singleLectionEnabled.checked = prefs.singleLectionBookingEnabled;
            singleLectionFromField.hidden = !prefs.singleLectionBookingEnabled;
        }
        if (state.singleLectionBookingEnabled && prefs.singleLectionBookingFrom) {
            singleLectionFrom.value = prefs.singleLectionBookingFrom;
            state.singleLectionBookingFrom = parseDateInput(singleLectionFrom, false);
        }

        if (Mapping.REGISTRATION_END_STRATEGIES.includes(prefs.registrationEndStrategy)) {
            state.registrationEndStrategy = prefs.registrationEndStrategy;
            registrationEndStrategy.value = prefs.registrationEndStrategy;
            registrationEndDaysField.hidden = prefs.registrationEndStrategy !== 'daysBefore';
        }
        if (Number.isFinite(prefs.registrationEndDaysBefore) && prefs.registrationEndDaysBefore >= 0) {
            state.registrationEndDaysBefore = prefs.registrationEndDaysBefore;
            registrationEndDays.value = String(prefs.registrationEndDaysBefore);
        }
    };

    const showError = (message) => {
        loadError.textContent = message;
        loadError.hidden = false;
    };

    const setLoading = (loading, status = '') => {
        loadButton.disabled = loading;
        loadSpinner.hidden = !loading;
        loadStatus.textContent = status;
    };

    // ---- Potvrzovací dialog (rds-modal) ----
    let confirmResolve = null;

    const confirmDialog = (text) => new Promise((resolve) => {
        confirmText.textContent = text;
        confirmOverlay.hidden = false;
        confirmResolve = (value) => {
            confirmOverlay.hidden = true;
            confirmResolve = null;
            resolve(value);
        };
        confirmOk.focus();
    });

    confirmOk.addEventListener('click', () => confirmResolve?.(true));
    confirmCancel.addEventListener('click', () => confirmResolve?.(false));
    confirmOverlay.addEventListener('click', (event) => {
        if (event.target === confirmOverlay) confirmResolve?.(false);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && confirmResolve) confirmResolve(false);
    });

    /**
     * Přegenerování rhythmLections zahodí ruční úpravy a vyloučení lekcí (spec 6.3).
     * Pokud nějaké jsou, zeptá se uživatele; vrací true = pokračovat.
     */
    const confirmDiscardRhythmEdits = async (prefix = '') => {
        const count = Mapping.countRhythmEdits(state.courses);
        if (count === 0) return true;
        return confirmDialog(`${prefix}Změna zruší ruční úpravy u ${count} lekcí. Pokračovat?`);
    };

    /** Nastaví strategii; 'rhythm' lekce vygeneruje, jiná strategie rhythmLections zahodí (spec 6.3). */
    const setStrategy = (strategy) => {
        state.shiftStrategy = strategy;
        checkRadio('shift-strategy', strategy);
        if (strategy === 'rhythm') {
            Mapping.regenerateRhythmLections(state);
        } else {
            for (const course of state.courses) course.rhythmLections = [];
        }
    };

    /**
     * Změna parametru rytmu (začátek, konec/počet, vynechané dny): po potvrzení aplikuje změnu
     * a přegeneruje lekce, jinak vrátí input (revert). Mimo strategii „Nový rozvrh" jen aplikuje.
     */
    const applyRhythmChange = async (apply, revert) => {
        if (isRhythm() && !(await confirmDiscardRhythmEdits())) {
            revert?.();
            return false;
        }
        apply();
        if (isRhythm()) Mapping.regenerateRhythmLections(state);
        recalculate();
        return true;
    };

    const showStrategyNotice = (text) => {
        strategyNotice.textContent = text;
        strategyNotice.hidden = !text;
    };

    /**
     * Vyloučení / zahrnutí kurzů (sekce B i D). Pokud tím při strategii „Nový rozvrh" přibude
     * mezi nevyloučené nerytmický kurz, strategie se přepne na „Zachovat dny v týdnu" (spec 8).
     */
    const setCoursesExcluded = async (courses, excluded) => {
        const previous = courses.map((c) => c.isExcluded);
        for (const course of courses) course.isExcluded = excluded;

        if (isRhythm()) {
            const nonRhythmic = nonRhythmicIncluded();
            if (nonRhythmic.length > 0) {
                const ok = await confirmDiscardRhythmEdits(
                    'Zahrnutý kurz nemá pravidelný týdenní rytmus, strategie se přepne na „Zachovat dny v týdnu". ');
                if (!ok) {
                    courses.forEach((course, i) => { course.isExcluded = previous[i]; });
                    renderOverview();
                    return;
                }
                setStrategy('weekday');
                showStrategyNotice('Strategie byla přepnuta na „Zachovat dny v týdnu", protože tyto kurzy nemají '
                    + `pravidelný týdenní rytmus: ${uniqueSorted(nonRhythmic.map((c) => c.name)).join(', ')}.`);
                savePrefs();
            }
        }

        renderOverview();
        recalculate();
    };

    // ---- Sekce A: zaměření ----
    const loadSegments = async () => {
        try {
            const segments = await api.getSegments();
            segmentSelect.innerHTML = '';

            if (segments.length === 0) {
                showError('Váš účet nemá žádná zaměření.');
                return;
            }

            for (const segment of segments) {
                const option = document.createElement('option');
                option.value = segment.id;
                option.textContent = segment.name;
                segmentSelect.appendChild(option);
            }
            segmentSelect.disabled = false;

            // Předvybrat naposledy použité zaměření z cookie, pokud stále existuje.
            if (restoredPrefs?.segmentId
                && [...segmentSelect.options].some((o) => Number(o.value) === restoredPrefs.segmentId)) {
                segmentSelect.value = String(restoredPrefs.segmentId);
            }
            state.segmentId = Number(segmentSelect.value);

            // Jediné zaměření: automaticky vybráno, dropdown sbalený na prostý text (spec 5A).
            if (segments.length === 1) {
                segmentField.hidden = true;
                segmentSingle.textContent = `Zaměření: ${segments[0].name}`;
                segmentSingle.hidden = false;
            }
            loadSourceBlocks();
        } catch (error) {
            showError(`Nepodařilo se načíst zaměření: ${error.message}`);
        }
    };

    // ---- Sekce A: časové pravítko bloků kurzů (spec 5A) ----
    let sourceBlocksSeq = 0;

    /** Max počet názvů skupin v tooltipu pruhu. */
    const BLOCK_TITLE_MAX_NAMES = 12;

    /** Tooltip bloku: rozsah, počet kurzů a názvy skupin (nejčastější první). */
    const blockTitle = (block) => {
        const lines = [
            `${formatDate(block.from)} – ${formatDate(block.to)}`,
            `${coursesText(block.courses.length)}, ${block.names.length} ${plural(block.names.length, 'název', 'názvy', 'názvů')}`,
        ];
        for (const { name, count } of block.names.slice(0, BLOCK_TITLE_MAX_NAMES)) {
            lines.push(count > 1 ? `${name} (×${count})` : name);
        }
        const rest = block.names.length - BLOCK_TITLE_MAX_NAMES;
        if (rest > 0) lines.push(`… a ${rest} dalších`);
        return lines.join('\n');
    };

    const toBlockCourse = (c) => ({
        id: c.id,
        name: c.name ?? '',
        startDate: new Date(c.startDate * 1000),
        endDate: new Date(c.endDate * 1000),
    });

    /** Načte kurzy zaměření za poslední rok (bez Course/Get) a seskupí je do bloků. */
    const loadSourceBlocks = async () => {
        const segmentId = state.segmentId;
        const seq = ++sourceBlocksSeq;
        if (!segmentId) {
            sourceRulerBlock.hidden = true;
            return;
        }

        const cached = ui.sourceBlocksCache.get(segmentId);
        if (cached) {
            ui.sourceBlocks = cached;
            renderSourceRuler();
            return;
        }

        ui.sourceBlocks = null;
        sourceRulerBlock.hidden = false;
        sourceRuler.replaceChildren();
        sourceRulerStatus.textContent = 'Načítám přehled kurzů za poslední rok…';
        sourceRulerStatus.hidden = false;
        try {
            const result = await api.getCourseBlocks(segmentId);
            if (seq !== sourceBlocksSeq) return; // mezitím se změnilo zaměření
            const data = {
                segmentId,
                from: new Date(result.from * 1000),
                to: new Date(result.to * 1000),
                blocks: Mapping.groupCourseBlocks(result.courses.map(toBlockCourse)),
            };
            ui.sourceBlocksCache.set(segmentId, data);
            ui.sourceBlocks = data;
            renderSourceRuler();
        } catch (error) {
            if (seq !== sourceBlocksSeq) return;
            sourceRulerStatus.textContent = `Přehled kurzů za poslední rok se nepodařilo načíst: ${error.message}`;
        }
    };

    /** Nastaví datum OD/DO sekce A (klik na pruh, tažení po pravítku). */
    const setSourceRange = (from, to) => {
        sourceFromInput.value = toDateInputValue(from);
        sourceToInput.value = toDateInputValue(to);
        loadError.hidden = true;
        savePrefs();
        renderSourceRuler();
    };

    const renderSourceRuler = () => {
        const data = ui.sourceBlocks;
        if (!data) return;
        sourceRulerBlock.hidden = false;

        if (data.blocks.length === 0) {
            sourceRuler.replaceChildren();
            sourceRulerStatus.textContent = 'Za poslední rok tu nejsou žádné kurzy.';
            sourceRulerStatus.hidden = false;
            return;
        }
        sourceRulerStatus.hidden = true;

        // Osa po celých měsících; bloky začínají v okně, ale můžou končit za ním.
        const latestEnd = data.blocks.reduce((max, b) => (b.to > max ? b.to : max), data.to);
        const axisFrom = new Date(data.from.getFullYear(), data.from.getMonth(), 1);
        const axisTo = new Date(latestEnd.getFullYear(), latestEnd.getMonth() + 1, 0);

        const selectedFrom = parseDateInput(sourceFromInput, false);
        const selectedTo = parseDateInput(sourceToInput, false);
        const selection = selectedFrom && selectedTo && selectedFrom <= selectedTo
            ? { from: selectedFrom, to: selectedTo }
            : null;

        Ruler.render(sourceRuler, {
            from: axisFrom,
            to: axisTo,
            ariaLabel: 'Bloky kurzů za poslední rok',
            showLabels: false,
            today: new Date(),
            selection,
            rows: data.blocks.map((block) => ({
                items: [{
                    kind: 'bar',
                    from: block.from,
                    to: block.to,
                    text: `${coursesText(block.courses.length)} · ${formatShortRange(block.from, block.to)}`,
                    title: blockTitle(block),
                    selected: selection !== null
                        && Mapping.isSameDay(selection.from, block.from) && Mapping.isSameDay(selection.to, block.to),
                    onClick: () => setSourceRange(block.from, block.to),
                }],
            })),
            onRangeSelect: setSourceRange,
        });
    };

    // ---- Sekce A -> B: načtení kurzů ----
    const loadCourses = async () => {
        loadError.hidden = true;

        state.segmentId = Number(segmentSelect.value);
        state.sourceFrom = parseDateInput(sourceFromInput, false);
        state.sourceTo = parseDateInput(sourceToInput, true);

        if (!state.segmentId || !state.sourceFrom || !state.sourceTo) {
            showError('Vyberte zaměření a zadejte obě data období.');
            return;
        }
        if (state.sourceFrom >= state.sourceTo) {
            showError('Datum OD musí být před datem DO.');
            return;
        }

        savePrefs();
        setLoading(true, 'Načítám kurzy…');
        try {
            const result = await api.loadCourses(
                state.segmentId, toUnix(state.sourceFrom), toUnix(state.sourceTo));

            state.courses = result.courses.map((c) => {
                const lections = c.lections.map((l) => ({
                    originalStart: new Date(l.start * 1000),
                    originalEnd: new Date(l.end * 1000),
                    isExcluded: false,
                    isPinned: false,
                    pinnedNewStart: null,
                }));
                const course = {
                    originalId: c.originalId,
                    name: c.name ?? '',
                    description: c.description ?? '',
                    bookingResourceId: c.bookingResourceId,
                    bookingResourceName: c.bookingResourceName ?? '',
                    bookingServiceId: c.bookingServiceId,
                    bookingServiceName: c.bookingServiceName ?? '',
                    capacity: c.capacity,
                    priceWithVat: c.priceWithVat,
                    calendarId: c.calendarId,
                    originalStartDate: new Date(c.startDate * 1000),
                    originalEndDate: new Date(c.endDate * 1000),
                    originalRegistrationEnd: new Date(c.registrationEnd * 1000),
                    lections,
                    // Přesahující kurzy se ve výchozím stavu nekopírují (spec 5B, 7.4).
                    isExcluded: Boolean(c.isOverlapping),
                    isOverlapping: Boolean(c.isOverlapping),
                    rhythm: Mapping.detectRhythm(lections),
                    rhythmLections: [],
                };
                course.groupKey = Mapping.courseGroupKey(course);
                return course;
            });
            ui.openGroups.clear();

            // Strategie „Nový rozvrh" (zvolená nebo z cookie) jen pokud jsou nevyloučené kurzy rytmické.
            const wasRhythm = isRhythm();
            const wantsRhythm = wasRhythm || pendingPrefStrategy === 'rhythm';
            pendingPrefStrategy = null;
            showStrategyNotice('');
            if (wantsRhythm) {
                const nonRhythmic = nonRhythmicIncluded();
                if (nonRhythmic.length === 0) {
                    setStrategy('rhythm');
                } else {
                    setStrategy('weekday');
                    if (wasRhythm) {
                        showStrategyNotice('Strategie byla přepnuta na „Zachovat dny v týdnu", protože tyto kurzy '
                            + `nemají pravidelný týdenní rytmus: ${uniqueSorted(nonRhythmic.map((x) => x.name)).join(', ')}.`);
                    }
                }
            }

            renderOverview();
            sectionOverview.hidden = false;
            sectionTarget.hidden = state.courses.length === 0;
            recalculate();
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(false);
        }
    };

    // ---- Sekce C: přepočet ----
    const recalculate = () => {
        renderTargetControls();

        const hasInput = hasTargetInput();
        sectionDetail.hidden = !hasInput;
        sectionSettings.hidden = !hasInput;
        if (!hasInput) {
            effectiveFromEl.textContent = '–';
            computedToEl.textContent = '–';
            schedulePeriodCheck(null, null);
            targetRulerBlock.hidden = true;
            updateCreateSection();
            return;
        }

        Mapping.applyMappingToState(state);

        let periodFrom;
        if (isRhythm()) {
            // Strategie „Nový rozvrh": místo efektivního OD se ukazuje první vygenerovaná lekce (spec 5C).
            periodFrom = state.newFrom;
            const firstLection = Mapping.calculatePeriodStartDate(state.courses, 'rhythm');
            effectiveFromEl.textContent = firstLection ? formatDate(firstLection) : '–';
        } else {
            const { effectiveNewFrom } = Mapping.calculateShift(state.sourceFrom, state.newFrom, state.shiftStrategy);
            periodFrom = effectiveNewFrom;
            effectiveFromEl.textContent = formatDate(effectiveNewFrom);
        }

        const periodEnd = Mapping.calculatePeriodEndDate(state.courses, state.shiftStrategy);
        computedToEl.textContent = periodEnd ? formatDate(periodEnd) : '–';

        schedulePeriodCheck(periodFrom, periodEnd);
        ui.targetPeriod = { from: periodFrom, to: periodEnd };
        renderTargetRuler();

        renderDetail();
        renderNameSummary();
        updateCreateSection();
    };

    /** Popisky, dostupnost a parametry strategie v sekci C. */
    const renderTargetControls = () => {
        const rhythm = isRhythm();
        newFromLabel.textContent = rhythm ? 'Začátek nového bloku' : 'Nové datum OD';
        newFromHelpShift.hidden = rhythm;
        newFromHelpRhythm.hidden = !rhythm;
        effectiveFromLabel.textContent = rhythm ? 'První lekce' : 'Efektivní datum OD';

        // „Nový rozvrh" jen pokud jsou všechny nevyloučené kurzy rytmické (spec 5C).
        const nonRhythmic = nonRhythmicIncluded();
        rhythmRadio.disabled = nonRhythmic.length > 0 && !rhythm;
        rhythmOption.classList.toggle('is-disabled', rhythmRadio.disabled);
        rhythmUnavailable.hidden = nonRhythmic.length === 0;
        rhythmUnavailableText.textContent = 'Nový rozvrh nejde použít, protože tyto kurzy nemají pravidelný '
            + `týdenní rytmus: ${uniqueSorted(nonRhythmic.map((c) => c.name)).join(', ')}.`;

        rhythmParams.hidden = !rhythm;
        if (!rhythm) return;

        const byCount = state.rhythmEndMode === 'count';
        newToField.hidden = byCount;
        lectionCountField.hidden = !byCount;

        let error = '';
        if (!byCount && state.newFrom && state.newTo && Mapping.daysBetween(state.newFrom, state.newTo) < 0) {
            error = 'Konec nového bloku musí být stejný nebo pozdější než začátek bloku.';
        } else if (byCount && state.lectionCount !== null && !(Number.isInteger(state.lectionCount)
            && state.lectionCount >= Mapping.LECTION_COUNT_MIN && state.lectionCount <= Mapping.LECTION_COUNT_MAX)) {
            error = `Počet lekcí musí být celé číslo ${Mapping.LECTION_COUNT_MIN}–${Mapping.LECTION_COUNT_MAX}.`;
        }
        rhythmError.textContent = error;
        rhythmError.hidden = !error;
        newToInput.classList.toggle('is-invalid', !byCount && Boolean(error));
        lectionCountInput.classList.toggle('is-invalid', byCount && Boolean(error));

        renderExcludedDays();
        holidaysAddButton.disabled = holidayRange() === null;
        holidaysAddButton.title = holidaysAddButton.disabled
            ? 'Nejdřív zadejte začátek a konec nového bloku.'
            : '';
    };

    const renderExcludedDays = () => {
        excludedList.innerHTML = '';
        state.excludedDays.forEach((range, index) => {
            const item = document.createElement('li');
            item.className = 'rds-badge rds-badge--neutral duplicator__chip';

            const text = document.createElement('span');
            text.textContent = formatDayRange(range.from, range.to);
            item.appendChild(text);
            if (range.label) {
                const label = document.createElement('span');
                label.className = 'duplicator__chip-label';
                label.textContent = range.label;
                item.appendChild(label);
            }

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'duplicator__chip-remove';
            remove.textContent = '✕';
            remove.title = 'Odebrat vynechaný den';
            remove.setAttribute('aria-label', `Odebrat ${text.textContent}`);
            remove.addEventListener('click', () => applyRhythmChange(() => {
                state.excludedDays.splice(index, 1);
            }));
            item.appendChild(remove);

            excludedList.appendChild(item);
        });
    };

    const sortExcludedDays = () => state.excludedDays.sort((a, b) => (a.from - b.from) || (a.to - b.to));

    // ---- Kontrola, zda v novém období již existují kurzy ----
    let periodCheckTimer = null;
    let periodCheckSeq = 0;

    let lastPeriodCheckKey = null;

    /** Naplánuje kontrolu nového období (debounce 500 ms; null = skrýt). */
    const schedulePeriodCheck = (from, to) => {
        if (!from || !to) {
            clearTimeout(periodCheckTimer);
            periodCheckSeq++;
            periodCheck.hidden = true;
            lastPeriodCheckKey = null;
            ui.periodCourses = null;
            return;
        }
        // Beze změny zaměření/dat kontrolu neopakuj - jinak hláška o načítání
        // probliká a posune stránku i při zavření editace bez úpravy. Čekající
        // kontrolu stejného intervalu přitom nerušit (jinak by se nikdy neprovedla).
        const key = `${state.segmentId}|${toUnix(from)}|${toUnix(to)}`;
        if (key === lastPeriodCheckKey) return;
        clearTimeout(periodCheckTimer);
        lastPeriodCheckKey = key;
        ui.periodCourses = { status: 'loading', courses: [] };
        periodCheckTimer = setTimeout(() => checkNewPeriod(from, to), 500);
    };

    const checkNewPeriod = async (from, to) => {
        const seq = ++periodCheckSeq;
        periodCheck.className = 'duplicator__period-check';
        periodCheck.textContent = 'Kontroluji, zda v novém období již existují kurzy…';
        periodCheck.hidden = false;
        try {
            const result = await api.checkPeriod(state.segmentId, toUnix(from), toUnix(to));
            if (seq !== periodCheckSeq) return; // mezitím přišel novější požadavek
            ui.periodCourses = { status: 'done', courses: (result.courses ?? []).map(toBlockCourse) };
            renderTargetRuler();
            if (result.count > 0) {
                const names = result.names.join(', ');
                const ellipsis = result.count > result.names.length ? ', …' : '';
                periodCheck.classList.add('duplicator__period-check--warning');
                periodCheck.textContent =
                    `Pozor: v novém období již existuje ${result.count} kurzů (${names}${ellipsis}).`;
            } else {
                periodCheck.classList.add('duplicator__period-check--ok');
                periodCheck.textContent = 'V novém období zatím žádné kurzy nejsou.';
            }
        } catch (error) {
            if (seq !== periodCheckSeq) return;
            ui.periodCourses = { status: 'error', courses: [] };
            renderTargetRuler();
            periodCheck.classList.add('duplicator__period-check--warning');
            periodCheck.textContent = `Kontrolu nového období se nepodařilo provést: ${error.message}`;
        }
    };

    // ---- Sekce C: časové pravítko cílového období (spec 5C) ----

    /**
     * Pravítko cílového období: nové lekce po dnech, svátky a vynechané dny, existující kurzy
     * (bloky z CheckPeriod). Jen pro čtení. Osa = cílové období ± týden, po celých týdnech.
     */
    const renderTargetRuler = () => {
        const period = ui.targetPeriod;
        if (!hasTargetInput() || !period?.from) {
            targetRulerBlock.hidden = true;
            return;
        }
        const rhythm = isRhythm();

        const starts = [];
        const pastDays = new Set();
        for (const course of state.courses) {
            if (course.isExcluded) continue;
            for (const { start } of activeLections(course)) {
                starts.push(start);
                if (isPast(start)) pastDays.add(Mapping.dayKey(start));
            }
        }
        const perDay = Mapping.countByDay(starts);
        const countOf = new Map(perDay.map((d) => [Mapping.dayKey(d.day), d.count]));

        // Konec cílového období: u „Nový rozvrh" s datem konce konec bloku, jinak vypočtené DO.
        const targetTo = rhythm && state.rhythmEndMode === 'endDate' && state.newTo ? state.newTo : period.to;
        let rangeFrom = period.from;
        let rangeTo = targetTo ?? period.from;
        if (perDay.length > 0) {
            if (perDay[0].day < rangeFrom) rangeFrom = perDay[0].day;
            if (perDay[perDay.length - 1].day > rangeTo) rangeTo = perDay[perDay.length - 1].day;
        }
        const axisFrom = Mapping.addDays(Mapping.startOfWeek(rangeFrom), -7);
        const axisTo = Mapping.addDays(Mapping.startOfWeek(rangeTo), 13);

        // 1) Nové lekce: sloupec za den, výška podle počtu lekcí.
        const maxCount = perDay.reduce((max, d) => Math.max(max, d.count), 0);
        const lectionRow = {
            label: 'Nové lekce',
            className: 'ruler__track--tall',
            note: perDay.length === 0 ? 'Nevznikne žádná lekce.' : undefined,
            items: perDay.map(({ day, count }) => {
                const past = pastDays.has(Mapping.dayKey(day));
                return {
                    kind: 'column',
                    from: day,
                    value: count / maxCount,
                    className: past ? 'ruler__column--past' : '',
                    title: `${formatDate(day)}: ${lectionsText(count)}${past ? ' (v minulosti)' : ''}`,
                };
            }),
        };

        // 2) Svátky (+ vynechané dny u „Nový rozvrh"): plná značka = ve svátek padnou lekce.
        const excludedItems = rhythm
            ? state.excludedDays.map((range) => ({
                kind: 'bar',
                from: range.from,
                to: range.to,
                className: 'ruler__bar--excluded',
                title: `Vynechané: ${formatDayRange(range.from, range.to)}${range.label ? ` (${range.label})` : ''}`,
            }))
            : [];
        const holidayItems = Mapping.holidaysInRange(state.holidayCountry, axisFrom, axisTo).map((holiday) => {
            const count = countOf.get(Mapping.dayKey(holiday.date)) ?? 0;
            return {
                kind: 'marker',
                from: holiday.date,
                className: count > 0 ? 'ruler__marker--hit' : '',
                title: `${holiday.label}, ${formatDate(holiday.date)}: `
                    + (count > 0 ? `padne na něj ${lectionsText(count)}` : 'bez lekcí'),
            };
        });
        const offRow = {
            label: rhythm ? 'Vynechané dny, svátky' : `Svátky (${state.holidayCountry})`,
            items: [...excludedItems, ...holidayItems],
            note: excludedItems.length + holidayItems.length === 0
                ? (rhythm ? 'Žádné vynechané dny ani svátky.' : 'Žádné svátky.')
                : undefined,
        };

        // 3) Existující kurzy v cílovém období (bloky jako v sekci A).
        const existing = ui.periodCourses;
        let existingRows;
        if (!existing || existing.status === 'loading') {
            existingRows = [{ label: 'Existující kurzy', note: 'Kontroluji…' }];
        } else if (existing.status === 'error') {
            existingRows = [{ label: 'Existující kurzy', note: 'Nepodařilo se zjistit.' }];
        } else if (existing.courses.length === 0) {
            existingRows = [{ label: 'Existující kurzy', note: 'Žádné.' }];
        } else {
            existingRows = Mapping.groupCourseBlocks(existing.courses).map((block, index) => ({
                label: index === 0 ? 'Existující kurzy' : '',
                items: [{
                    kind: 'bar',
                    from: block.from,
                    to: block.to,
                    className: 'ruler__bar--existing',
                    text: `${coursesText(block.courses.length)} · ${formatShortRange(block.from, block.to)}`,
                    title: blockTitle(block),
                }],
            }));
        }

        targetRulerBlock.hidden = false;
        legendExcluded.hidden = !rhythm;
        Ruler.render(targetRuler, {
            from: axisFrom,
            to: axisTo,
            ariaLabel: 'Cílové období na časové ose',
            showLabels: true,
            today: new Date(),
            selection: targetTo ? { from: period.from, to: targetTo } : null,
            bands: excludedItems.map((item) => ({ from: item.from, to: item.to, title: item.title })),
            rows: [lectionRow, offRow, ...existingRows],
        });
    };

    // ---- Společné stavební bloky tabulek ----
    const buildTable = (labels) => {
        const table = document.createElement('table');
        table.className = 'rds-table';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of labels) {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        }
        head.appendChild(headRow);
        table.appendChild(head);
        const body = document.createElement('tbody');
        table.appendChild(body);
        return { table, body };
    };

    /** Pomocník pro buňky řádku: cell(text | null, className). */
    const rowBuilder = (row) => (content, className = '') => {
        const td = document.createElement('td');
        if (className) td.className = className;
        if (content !== null && content !== undefined) td.textContent = content;
        row.appendChild(td);
        return td;
    };

    const badge = (text, variant, title = '') => {
        const span = document.createElement('span');
        span.className = `rds-badge rds-badge--${variant} duplicator__badge`;
        span.textContent = text;
        if (title) span.title = title;
        return span;
    };

    const smallButton = (text, title, onClick) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rds-btn rds-btn--ghost rds-btn--sm';
        button.textContent = text;
        if (title) button.title = title;
        button.addEventListener('click', onClick);
        return button;
    };

    const courseSourceLabel = (course) => course.bookingServiceName
        ? `${course.bookingResourceName} / ${course.bookingServiceName}`
        : course.bookingResourceName;

    /** Zdroje/služby skupiny: zkráceně, celý seznam v tooltipu (spec 5B). */
    const fillGroupSources = (td, courses) => {
        const labels = uniqueSorted(courses.map(courseSourceLabel));
        td.textContent = labels.length === 1 ? labels[0] : `${labels[0]} + ${labels.length - 1} další`;
        if (labels.length > 1) td.title = labels.join('\n');
    };

    const capacityLabel = (courses) => {
        const values = courses.map((c) => c.capacity);
        const min = Math.min(...values);
        const max = Math.max(...values);
        return min === max ? String(min) : `${min}–${max}`;
    };

    const numberRangeLabel = (values) => {
        if (values.length === 0) return '–';
        const min = Math.min(...values);
        const max = Math.max(...values);
        return min === max ? String(min) : `${min}–${max}`;
    };

    /** Čas začátku kurzu = čas první lekce (nebo StartDate, pokud lekce nejsou). */
    const courseStartTime = (course) => {
        const first = course.lections.length > 0
            ? course.lections.reduce((min, l) => (l.originalStart < min ? l.originalStart : min), course.lections[0].originalStart)
            : course.originalStartDate;
        return first;
    };

    const sortByStartTime = (courses) => [...courses].sort((a, b) =>
        (courseStartTime(a).getHours() * 60 + courseStartTime(a).getMinutes())
        - (courseStartTime(b).getHours() * 60 + courseStartTime(b).getMinutes()));

    const startTimesLabel = (courses) => sortByStartTime(courses)
        .map((c) => formatTime(courseStartTime(c)))
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(', ');

    /** Rozsah dat; u přesahujících kurzů zvýrazní hranici, kterou kurz přesahuje (spec 5B). */
    const fillDateRange = (td, from, to, highlightOverlap) => {
        const start = document.createElement('span');
        start.textContent = formatDate(from);
        const end = document.createElement('span');
        end.textContent = formatDate(to);
        if (highlightOverlap) {
            if (from < state.sourceFrom) {
                start.className = 'duplicator__boundary';
                start.title = 'Začíná před datem OD zdrojového období';
            }
            if (to > state.sourceTo) {
                end.className = 'duplicator__boundary';
                end.title = 'Končí po datu DO zdrojového období';
            }
        }
        td.append(start, ' – ', end);
    };

    const groupRange = (courses) => ({
        from: new Date(Math.min(...courses.map((c) => c.originalStartDate.getTime()))),
        to: new Date(Math.max(...courses.map((c) => c.originalEndDate.getTime()))),
    });

    const expandToggle = (key, onToggle) => {
        const open = ui.openGroups.has(key);
        return smallButton(open ? '▾ sbalit' : '▸ rozbalit', open ? 'Sbalit skupinu' : 'Rozbalit skupinu', () => {
            if (ui.openGroups.has(key)) ui.openGroups.delete(key); else ui.openGroups.add(key);
            onToggle();
        });
    };

    /** Křížek (✕ / ↩) pro kurz nebo celou skupinu - vyloučí / vrátí všechny kurzy. */
    const excludeToggle = (courses) => {
        const allExcluded = courses.every((c) => c.isExcluded);
        const group = courses.length > 1;
        return smallButton(
            allExcluded ? '↩' : '✕',
            allExcluded
                ? (group ? 'Vrátit všechny kurzy skupiny do duplikace' : 'Vrátit do duplikace')
                : (group ? 'Vyloučit všechny kurzy skupiny z duplikace' : 'Vyloučit z duplikace'),
            () => setCoursesExcluded(courses, !allExcluded));
    };

    /** Checkbox „Zahrnout" u přesahujících kurzů (výchozí nezaškrtnuto = vyloučeno). */
    const includeCheckbox = (courses) => {
        const label = document.createElement('label');
        label.className = 'rds-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        const includedCount = courses.filter((c) => !c.isExcluded).length;
        input.checked = includedCount === courses.length;
        input.indeterminate = includedCount > 0 && includedCount < courses.length;
        input.addEventListener('change', () => setCoursesExcluded(courses, !input.checked));
        label.append(input, 'Zahrnout');
        return label;
    };

    /** Název skupiny: „Název ×N" + počet vyloučených / zahrnutých (spec 5B). */
    const fillGroupName = (td, name, courses, overlapMode) => {
        td.append(name, ' ');
        const count = document.createElement('span');
        count.className = 'duplicator__group-count';
        const excluded = courses.filter((c) => c.isExcluded).length;
        let text = `×${courses.length}`;
        if (overlapMode) {
            const included = courses.length - excluded;
            if (included > 0 && included < courses.length) text += `, zahrnuto ${included}`;
        } else if (excluded > 0 && excluded < courses.length) {
            text += `, vyloučeno ${excluded}`;
        }
        count.textContent = text;
        td.appendChild(count);
    };

    // ---- Sekce B: přehled načtených kurzů ----
    const renderSummary = () => {
        const inPeriod = state.courses.filter((c) => !c.isOverlapping);
        const overlapping = state.courses.filter((c) => c.isOverlapping);
        const included = inPeriod.filter((c) => !c.isExcluded);
        const lectionCount = included.reduce((sum, c) => sum + c.lections.length, 0);
        const excludedCount = inPeriod.length - included.length;
        let text = `Načteno ${included.length} kurzů s celkem ${lectionCount} lekcemi. Vyloučeno ${excludedCount} kurzů.`;
        if (overlapping.length > 0) {
            const includedOverlapping = overlapping.filter((c) => !c.isExcluded).length;
            text += ` Přesahuje období: ${overlapping.length} kurzů (zahrnuto ${includedOverlapping}).`;
        }
        courseSummary.textContent = text;
    };

    const renderOverview = () => {
        courseList.innerHTML = '';
        overlapList.innerHTML = '';

        const inPeriod = state.courses.filter((c) => !c.isOverlapping);
        const overlapping = state.courses.filter((c) => c.isOverlapping);

        if (inPeriod.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'rds-empty';
            const icon = document.createElement('div');
            icon.className = 'rds-empty__icon';
            icon.textContent = '▤';
            const title = document.createElement('div');
            title.className = 'rds-empty__title';
            title.textContent = 'Žádné kurzy k duplikaci';
            const text = document.createElement('div');
            text.textContent = 'V zadaném období nejsou žádné kurzy. Zkuste upravit zaměření nebo rozsah dat.';
            empty.append(icon, title, text);
            courseList.appendChild(empty);
        } else {
            courseList.appendChild(buildOverviewTable(inPeriod, false));
        }

        overlapBlock.hidden = overlapping.length === 0;
        if (overlapping.length > 0) {
            overlapTitle.textContent = `Přesahují zdrojové období (${overlapping.length} kurzů)`;
            overlapBlock.open = ui.overlapOpen;
            overlapList.appendChild(buildOverviewTable(overlapping, true));
        }

        if (state.courses.length === 0) {
            courseSummary.textContent = '';
        } else {
            renderSummary();
        }
    };

    const buildOverviewTable = (courses, overlapMode) => {
        const { table, body } = buildTable(
            ['Název kurzu', 'Zdroj / služba', 'Kapacita', 'Lekcí', 'Rozsah dat', 'Začátek', overlapMode ? 'Zahrnout' : '', '']);
        for (const group of Mapping.groupCourses(courses)) {
            if (group.courses.length === 1) {
                body.appendChild(renderOverviewCourseRow(group.courses[0], overlapMode, false));
                continue;
            }
            const key = `B|${overlapMode ? 'over' : 'main'}|${group.key}`;
            body.appendChild(renderOverviewGroupRow(group, overlapMode, key));
            if (ui.openGroups.has(key)) {
                for (const course of sortByStartTime(group.courses)) {
                    body.appendChild(renderOverviewCourseRow(course, overlapMode, true));
                }
            }
        }
        return table;
    };

    const renderOverviewGroupRow = (group, overlapMode, key) => {
        const { courses } = group;
        const row = document.createElement('tr');
        row.className = 'is-group';
        // Nezahrnutý přesahující kurz je výchozí stav - jen ztlumit, nepřeškrtávat (hranice musí být čitelná).
        if (courses.every((c) => c.isExcluded)) row.classList.add(overlapMode ? 'is-muted' : 'is-excluded');
        const cell = rowBuilder(row);

        fillGroupName(cell(null, 'cell-strong'), courses[0].name, courses, overlapMode);
        fillGroupSources(cell(null), courses);
        cell(capacityLabel(courses));
        cell(numberRangeLabel(courses.map((c) => c.lections.length)));
        const { from, to } = groupRange(courses);
        fillDateRange(cell(null), from, to, overlapMode);
        cell(startTimesLabel(courses));
        cell(null, 'cell-action').appendChild(overlapMode ? includeCheckbox(courses) : excludeToggle(courses));
        cell(null, 'cell-action').appendChild(expandToggle(key, renderOverview));
        return row;
    };

    const renderOverviewCourseRow = (course, overlapMode, isChild) => {
        const row = document.createElement('tr');
        if (isChild) row.classList.add('is-child');
        if (course.isExcluded) row.classList.add(overlapMode ? 'is-muted' : 'is-excluded');
        const cell = rowBuilder(row);

        cell(course.name, 'cell-strong');
        cell(courseSourceLabel(course));
        cell(String(course.capacity));
        cell(String(course.lections.length));
        fillDateRange(cell(null), course.originalStartDate, course.originalEndDate, overlapMode);
        cell(formatTime(courseStartTime(course)));
        cell(null, 'cell-action').appendChild(overlapMode ? includeCheckbox([course]) : excludeToggle([course]));
        cell(null, 'cell-action');
        return row;
    };

    // ---- Sekce D: detail s novými datumy ----

    /** Nový rozsah kurzu: min start a max konec přes aktivní lekce aktuální strategie. */
    const courseNewRange = (course) => {
        let min = null;
        let max = null;
        for (const { start, lengthMinutes } of activeLections(course)) {
            const end = new Date(start.getTime() + lengthMinutes * 60000);
            if (min === null || start < min) min = start;
            if (max === null || end > max) max = end;
        }
        return { min, max };
    };

    const pastLectionCount = (course) => activeLections(course).filter((x) => isPast(x.start)).length;

    /** Popis rytmu kurzu / skupiny: „út 8:30, 45 min", u skupiny „út 8:30, 9:30, 10:15, 45 min" (spec 5D). */
    const rhythmLabel = (courses) => {
        const rhythms = courses.map((c) => c.rhythm).filter(Boolean);
        if (rhythms.length === 0) return '–';
        const days = uniqueSorted(rhythms.map((r) => String(r.weekday)))
            .map((d) => weekdayShortByIndex(Number(d))).join(', ');
        const times = [...new Set(rhythms.map((r) => r.time))].sort().map(formatRhythmTime).join(', ');
        const lengths = numberRangeLabel(rhythms.map((r) => r.lengthMinutes));
        return `${days} ${times}, ${lengths} min`;
    };

    /** Nejčastější počet nových lekcí (při shodě vyšší) - pro zvýraznění odlišných (spec 5D). */
    const mostCommon = (values) => {
        const counts = new Map();
        for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
        let best = null;
        for (const [value, count] of counts) {
            if (best === null || count > best.count || (count === best.count && value > best.value)) {
                best = { value, count };
            }
        }
        return best?.value ?? null;
    };

    const renderDetail = () => {
        courseDetailList.innerHTML = '';
        const courses = detailCourses();
        if (courses.length === 0) {
            lectionCountWarning.hidden = true;
            return;
        }

        // Rozdílný počet lekcí při strategii „Nový rozvrh" (spec 5D).
        let commonCount = null;
        lectionCountWarning.hidden = true;
        if (isRhythm()) {
            const counts = courses.filter((c) => !c.isExcluded).map((c) => activeLections(c).length);
            if (new Set(counts).size > 1) {
                commonCount = mostCommon(counts);
                lectionCountWarning.textContent =
                    `Kurzy mají různý počet lekcí (${Math.min(...counts)}–${Math.max(...counts)}) kvůli vynechaným dnům.`;
                lectionCountWarning.hidden = false;
            }
        }

        const labels = isRhythm()
            ? ['Název kurzu', 'Zdroj / služba', 'Kapacita', 'Rytmus', 'Původní (OD – DO, lekcí)', 'Nové (OD – DO, lekcí)', '', '']
            : ['Název kurzu', 'Zdroj / služba', 'Kapacita', 'Lekcí', 'Původní (OD – DO)', 'Nové (OD – DO)', '', ''];
        const { table, body } = buildTable(labels);

        const appendCourse = (course, isChild) => {
            body.appendChild(renderDetailRow(course, isChild, commonCount));
            if (course._detailOpen) body.appendChild(renderLectionsRow(course));
        };

        for (const group of Mapping.groupCourses(courses)) {
            if (group.courses.length === 1) {
                appendCourse(group.courses[0], false);
                continue;
            }
            const key = `D|${group.key}`;
            body.appendChild(renderDetailGroupRow(group, key, commonCount));
            if (ui.openGroups.has(key)) {
                for (const course of sortByStartTime(group.courses)) appendCourse(course, true);
            }
        }
        courseDetailList.appendChild(table);
    };

    /** Název nového kurzu s hromadnou úpravou (původní v tooltipu) a stavovými značkami. */
    const fillDetailName = (td, course) => {
        const renamed = newName(course);
        if (renamed.trim() === '') {
            td.appendChild(badge('Prázdný název', 'danger', `Původní název: ${course.name}`));
            return;
        }
        td.append(renamed);
        if (renamed !== course.name) {
            td.title = `Původní název: ${course.name}`;
            td.append(' ', badge('nový název', 'info', `Původní název: ${course.name}`));
        }
    };

    /** Značky stavu kurzu / skupiny: přesahující, bez lekcí, lekce v minulosti. */
    const appendCourseBadges = (td, courses) => {
        const included = courses.filter((c) => !c.isExcluded);
        if (courses.some((c) => c.isOverlapping)) {
            td.append(' ', badge('přesahuje období', 'warning', 'Kurz přesahuje zdrojové období - kopíruje se celý.'));
        }
        if (included.some((c) => activeLections(c).length === 0)) {
            td.append(' ', badge('Nevznikne žádná lekce', 'warning', 'Kurz se při vytváření přeskočí.'));
        }
        if (included.some((c) => pastLectionCount(c) > 0)) {
            td.append(' ', badge('lekce v minulosti', 'danger', 'Lekce v minulosti vylučte nebo změňte nové datum OD.'));
        }
    };

    /** Buňka rozsahu (+ u strategie „Nový rozvrh" druhý řádek s počtem lekcí, případně zvýrazněným). */
    const fillRangeCell = (td, rangeText, count, highlight) => {
        td.append(rangeText);
        if (count === null) return;
        const line = document.createElement('span');
        line.className = 'duplicator__subline';
        if (highlight) line.classList.add('duplicator__highlight');
        line.textContent = `${count} lekcí`;
        td.appendChild(line);
    };

    const renderDetailRow = (course, isChild, commonCount) => {
        const row = document.createElement('tr');
        if (isChild) row.classList.add('is-child');
        if (course.isExcluded) row.classList.add('is-excluded');
        const cell = rowBuilder(row);
        const rhythm = isRhythm();

        const active = activeLections(course).length;
        const { min, max } = courseNewRange(course);

        const nameCell = cell(null, 'cell-strong');
        fillDetailName(nameCell, course);
        appendCourseBadges(nameCell, [course]);
        cell(courseSourceLabel(course));
        cell(String(course.capacity));
        if (rhythm) {
            cell(rhythmLabel([course]));
        } else {
            cell(active === course.lections.length ? String(active) : `${active} z ${course.lections.length}`);
        }
        fillRangeCell(cell(null), `${formatDate(course.originalStartDate)} – ${formatDate(course.originalEndDate)}`,
            rhythm ? course.lections.length : null, false);
        fillRangeCell(cell(null), min && max ? `${formatDate(min)} – ${formatDate(max)}` : '–',
            rhythm && course.rhythm ? active : null,
            rhythm && !course.isExcluded && commonCount !== null && active !== commonCount);

        cell(null, 'cell-action').appendChild(excludeToggle([course]));
        cell(null, 'cell-action').appendChild(smallButton(course._detailOpen ? '▾ detail' : '▸ detail', '', () => {
            course._detailOpen = !course._detailOpen;
            renderDetail();
        }));
        return row;
    };

    const renderDetailGroupRow = (group, key, commonCount) => {
        const { courses } = group;
        const row = document.createElement('tr');
        row.className = 'is-group';
        if (courses.every((c) => c.isExcluded)) row.classList.add('is-excluded');
        const cell = rowBuilder(row);
        const rhythm = isRhythm();

        const included = courses.filter((c) => !c.isExcluded);
        const counted = included.length > 0 ? included : courses;
        const activeCounts = counted.map((c) => activeLections(c).length);

        let min = null;
        let max = null;
        for (const course of counted) {
            const range = courseNewRange(course);
            if (range.min && (min === null || range.min < min)) min = range.min;
            if (range.max && (max === null || range.max > max)) max = range.max;
        }

        const nameCell = cell(null, 'cell-strong');
        const renamed = newName(courses[0]);
        if (renamed.trim() === '') {
            nameCell.appendChild(badge('Prázdný název', 'danger', `Původní název: ${courses[0].name}`));
            fillGroupName(nameCell, '', courses, false);
        } else {
            fillGroupName(nameCell, renamed, courses, false);
            if (renamed !== courses[0].name) {
                nameCell.title = `Původní název: ${courses[0].name}`;
                nameCell.append(' ', badge('nový název', 'info', `Původní název: ${courses[0].name}`));
            }
        }
        appendCourseBadges(nameCell, courses);

        fillGroupSources(cell(null), courses);
        cell(capacityLabel(courses));
        cell(rhythm ? rhythmLabel(courses) : numberRangeLabel(activeCounts));
        const original = groupRange(courses);
        fillRangeCell(cell(null), `${formatDate(original.from)} – ${formatDate(original.to)}`,
            rhythm ? numberRangeLabel(courses.map((c) => c.lections.length)) : null, false);
        fillRangeCell(cell(null), min && max ? `${formatDate(min)} – ${formatDate(max)}` : '–',
            rhythm ? numberRangeLabel(activeCounts) : null,
            rhythm && commonCount !== null && included.some((c) => activeLections(c).length !== commonCount));

        cell(null, 'cell-action').appendChild(excludeToggle(courses));
        cell(null, 'cell-action').appendChild(expandToggle(key, renderDetail));
        return row;
    };

    const renderLectionsRow = (course) => {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.className = 'lections-cell';
        cell.colSpan = 8;

        if (isRhythm()) {
            // Vygenerované lekce (spec 5D) + přepínač původních lekcí (jen pro čtení).
            const toolbar = document.createElement('div');
            toolbar.className = 'lections-toolbar';
            toolbar.appendChild(smallButton(
                course._showOriginal ? 'Skrýt původní lekce' : 'Ukázat původní lekce', '', () => {
                    course._showOriginal = !course._showOriginal;
                    renderDetail();
                }));
            cell.appendChild(toolbar);

            if (course.rhythmLections.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'duplicator__warning';
                empty.textContent = 'Nevznikne žádná lekce: všechny dny kurzu v novém bloku jsou vynechané, '
                    + 'nebo blok končí dřív, než nastane den v týdnu kurzu. Kurz se při vytváření přeskočí.';
                cell.appendChild(empty);
            } else {
                const { table, body } = buildTable(['#', 'Nové datum', 'Délka', '', '']);
                course.rhythmLections.forEach((lection, index) => {
                    body.appendChild(renderLectionRow(lection, index, null, course.rhythm.lengthMinutes));
                });
                cell.appendChild(table);
            }

            if (course._showOriginal) {
                const caption = document.createElement('p');
                caption.className = 'rds-label lections-caption';
                caption.textContent = 'Původní lekce';
                const { table, body } = buildTable(['#', 'Původní datum', 'Délka']);
                course.lections.forEach((lection, index) => {
                    const lectionRow = document.createElement('tr');
                    const lectionCell = rowBuilder(lectionRow);
                    lectionCell(String(index + 1));
                    lectionCell(formatDateTime(lection.originalStart));
                    lectionCell(`${lectionLengthMinutes(lection)} min`);
                    body.appendChild(lectionRow);
                });
                cell.append(caption, table);
            }
        } else {
            const { table, body } = buildTable(['#', 'Původní datum', 'Nové datum', 'Délka', '', '']);
            course.lections.forEach((lection, index) => {
                body.appendChild(renderLectionRow(lection, index, lection.originalStart, lectionLengthMinutes(lection)));
            });
            cell.appendChild(table);
        }

        row.appendChild(cell);
        return row;
    };

    /** Řádek lekce; originalStart = null u vygenerovaných lekcí (bez sloupce „Původní datum"). */
    const renderLectionRow = (lection, index, originalStart, lengthMinutes) => {
        const row = document.createElement('tr');
        if (lection.isExcluded) row.className = 'is-excluded';
        const cell = rowBuilder(row);

        cell(String(index + 1));
        if (originalStart) cell(formatDateTime(originalStart));

        // Nové datum: klik -> inline edit (datetime-local), Enter / opuštění pole uloží, Escape zruší.
        const newStart = lectionNewStart(lection);
        const newCell = cell(null);
        if (lection.isPinned) {
            const pin = document.createElement('span');
            pin.textContent = '📌 ';
            pin.title = 'Ručně připnuté datum - globální přepočet ho nemění';
            newCell.appendChild(pin);
        }
        newCell.appendChild(document.createTextNode(newStart ? formatDateTime(newStart) : '–'));
        if (newStart && !lection.isExcluded && isPast(newStart)) {
            row.classList.add('is-invalid');
            newCell.append(' ', badge('v minulosti', 'danger'));
        }
        if (newStart && !lection.isExcluded) {
            newCell.classList.add('cell-editable');
            newCell.title = 'Klikněte pro ruční úpravu data';
            newCell.addEventListener('click', () => beginLectionEdit(newCell, lection));
        }

        cell(`${lengthMinutes} min`);

        cell(null, 'cell-action').appendChild(smallButton(
            lection.isExcluded ? '↩' : '✕',
            lection.isExcluded ? 'Vrátit lekci do duplikace' : 'Vyloučit lekci z duplikace',
            () => {
                lection.isExcluded = !lection.isExcluded;
                recalculate();
            }));

        const pinCell = cell(null, 'cell-action');
        if (lection.isPinned) {
            pinCell.appendChild(smallButton('obnovit auto výpočet', '', () => {
                lection.isPinned = false;
                lection.pinnedNewStart = null;
                recalculate();
            }));
        }

        return row;
    };

    const beginLectionEdit = (cell, lection) => {
        const current = lectionNewStart(lection);
        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'rds-input edit-input';
        input.value = toLocalInputValue(current);

        let finished = false;
        const finish = (save) => {
            if (finished) return;
            finished = true;
            document.removeEventListener('pointerdown', onOutsidePointerDown, true);
            if (save) {
                const parsed = parseLocalInputValue(input.value);
                if (parsed) {
                    lection.isPinned = true;
                    lection.pinnedNewStart = parsed;
                }
            }
            recalculate();
        };

        // Potvrzení až při kliknutí MIMO input. Segmenty datetime-local (den/měsíc/
        // hodina) jsou v shadow DOM, takže klik na ně má event.target === input
        // a edit se nezavře. Klik kamkoli jinam hodnotu uloží.
        const onOutsidePointerDown = (event) => {
            if (event.target === input || input.contains(event.target)) return;
            finish(true);
        };

        // Klik uvnitř inputu nesmí probublat na click listener buňky (td), který
        // by znovu spustil beginLectionEdit a zresetoval rozeditovaný segment.
        input.addEventListener('click', (event) => event.stopPropagation());

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(true);
            } else if (event.key === 'Escape') {
                finish(false);
            }
        });
        // Tab na jiný focusovatelný prvek hodnotu uloží. Přechod mezi segmenty
        // datetime-local zůstává uvnitř inputu (relatedTarget je retargetovaný na
        // input nebo jeho potomka) - to edit nezavírá. Nativní picker dává
        // relatedTarget === null, takže rovněž nezavře.
        input.addEventListener('focusout', (event) => {
            const next = event.relatedTarget;
            if (next && next !== input && !input.contains(next)) finish(true);
        });

        cell.replaceChildren(input);
        document.addEventListener('pointerdown', onOutsidePointerDown, true);
        // Klik na buňku s inputem nesmí znovu spustit edit
        cell.classList.remove('cell-editable');
        input.focus();
    };

    // ---- Sekce E: hromadná úprava názvů ----
    const renderNameSummary = () => {
        nameSummary.hidden = state.nameFind === '';
        if (nameSummary.hidden) return;
        const changed = detailCourses().filter((c) => !c.isExcluded && newName(c) !== c.name).length;
        nameSummary.textContent = `Upraví se název u ${changed} kurzů.`;
    };

    // ---- Sekce F: potvrzení a vytvoření ----

    /**
     * Kurzy k vytvoření: ne-vyloučené, se spočteným newRegistrationEnd a aspoň jednou
     * aktivní lekcí (u „Nový rozvrh" z rhythmLections). Kurzy s 0 lekcemi se přeskočí (spec 8).
     * Podmínka newRegistrationEnd brání pozdějšímu toUnix(null) v buildCreateRequest.
     */
    const coursesToCreate = () => state.courses
        .filter((c) => !c.isExcluded && c.newRegistrationEnd)
        .map((course) => ({
            course,
            lections: activeLections(course).sort((a, b) => a.start - b.start),
        }))
        .filter((x) => x.lections.length > 0);

    const updateCreateSection = () => {
        const hasInput = hasTargetInput();
        const toCreate = hasInput ? coursesToCreate() : [];
        const lectionCount = toCreate.reduce((sum, x) => sum + x.lections.length, 0);
        createSummary.textContent =
            `Bude vytvořeno ${toCreate.length} kurzů s celkem ${lectionCount} lekcemi.`;

        // Blokující chyby (spec 5E, 5F, 8).
        const blockers = [];
        if (isRhythm() && state.newFrom !== null && !Mapping.rhythmParamsComplete(state)) {
            blockers.push(state.rhythmEndMode === 'count'
                ? 'Zadejte počet lekcí nového bloku.'
                : 'Zadejte konec nového bloku.');
        }
        if (hasInput) {
            const past = toCreate.reduce((sum, x) => sum + x.lections.filter((l) => isPast(l.start)).length, 0);
            if (past > 0) {
                blockers.push(`${past} lekcí by padlo do minulosti. Vylučte je v detailu kurzů nebo změňte nové datum OD.`);
            }
            const emptyNames = toCreate.filter((x) => isNameInvalid(x.course)).length;
            if (emptyNames > 0) {
                blockers.push(`${emptyNames} kurzů by po hromadné úpravě mělo prázdný název. Upravte „Najít v názvu" / „Nahradit za".`);
            }
        }
        createBlocker.textContent = blockers.join(' ');
        createBlocker.hidden = blockers.length === 0;

        createButton.disabled = !hasInput || toCreate.length === 0 || blockers.length > 0;

        // Warning: nové datum OD nespadá za poslední lekci zdrojového období (nezablokuje).
        let lastSource = null;
        for (const course of state.courses) {
            if (course.isExcluded) continue;
            for (const lection of course.lections) {
                if (lection.isExcluded) continue;
                if (lastSource === null || lection.originalStart > lastSource) lastSource = lection.originalStart;
            }
        }
        const overlaps = state.newFrom !== null && lastSource !== null && state.newFrom <= lastSource;
        createWarning.hidden = !overlaps;
        if (overlaps) {
            createWarning.textContent =
                `Pozor: nové datum OD (${formatDate(state.newFrom)}) nespadá za poslední lekci `
                + `zdrojového období (${formatDate(lastSource)}). Nové kurzy se mohou překrývat se zdrojovými.`;
        }
    };

    const buildCreateRequest = () => ({
        globalSettings: {
            singleLectionBookingEnabled: state.singleLectionBookingEnabled,
            singleLectionBookingFrom: state.singleLectionBookingFrom
                ? toUnix(state.singleLectionBookingFrom)
                : null,
        },
        courses: coursesToCreate().map(({ course, lections }) => ({
            name: newName(course),
            description: course.description,
            segmentId: state.segmentId,
            bookingResourceId: course.bookingResourceId,
            bookingServiceId: course.bookingServiceId,
            capacity: course.capacity,
            priceWithVat: course.priceWithVat,
            registrationEnd: toUnix(course.newRegistrationEnd),
            calendarId: course.calendarId,
            lections: lections.map((l) => ({
                start: toUnix(l.start),
                lengthMinutes: l.lengthMinutes,
            })),
        })),
    });

    const createCourses = async () => {
        createError.hidden = true;
        const body = buildCreateRequest();

        createButton.disabled = true;
        createSpinner.hidden = false;
        createStatus.textContent = `Vytvářím ${body.courses.length} kurzů…`;
        try {
            const result = await api.createCourses(body);
            renderResult(result.results);
        } catch (error) {
            createError.textContent = error.message;
            createError.hidden = false;
            createButton.disabled = false;
        } finally {
            createSpinner.hidden = true;
            createStatus.textContent = '';
        }
    };

    // ---- Sekce G: výsledek ----
    const renderResult = (results) => {
        const successCount = results.filter((r) => r.success).length;
        resultSummary.textContent = `Vytvořeno ${successCount} z ${results.length} kurzů úspěšně.`;

        resultList.innerHTML = '';
        for (const result of results) {
            const item = document.createElement('li');
            item.className = 'result-list__item '
                + (result.success ? 'result-list__item--success' : 'result-list__item--error');
            item.textContent = result.success
                ? `✓ ${result.originalName}`
                : `✗ ${result.originalName} — ${result.error}`;
            resultList.appendChild(item);
        }

        sectionResult.hidden = false;
        sectionResult.scrollIntoView({ behavior: 'smooth' });
        // Tlačítko zůstává disabled, ať se batch omylem nespustí podruhé;
        // jakákoli změna vstupů ho přes updateCreateSection zase povolí.
    };

    // ---- Sekce B: wiring ----
    overlapBlock.addEventListener('toggle', () => {
        ui.overlapOpen = overlapBlock.open;
    });

    // ---- Sekce C + E: wiring ----
    segmentSelect.addEventListener('change', () => {
        state.segmentId = Number(segmentSelect.value);
        savePrefs();
        loadSourceBlocks();
    });

    // Ruční změna data OD/DO posune výběr na pravítku sekce A.
    for (const input of [sourceFromInput, sourceToInput]) {
        input.addEventListener('change', () => {
            savePrefs();
            renderSourceRuler();
        });
    }

    newFromInput.addEventListener('change', async () => {
        const selected = parseDateInput(newFromInput, false);
        const previous = state.newFrom;
        // Nové datum OD musí být v budoucnu - neplatná hodnota se chová jako nezadaná.
        const invalid = selected !== null && selected <= new Date();

        await applyRhythmChange(() => {
            targetError.textContent = invalid ? 'Nové datum OD musí být v budoucnu.' : '';
            targetError.hidden = !invalid;
            state.newFrom = invalid ? null : selected;
        }, () => {
            newFromInput.value = toDateInputValue(previous);
        });
        savePrefs();
    });

    for (const radio of document.querySelectorAll('input[name="shift-strategy"]')) {
        radio.addEventListener('change', async () => {
            const previous = state.shiftStrategy;
            const next = radio.value;
            if (previous === 'rhythm' && next !== 'rhythm' && !(await confirmDiscardRhythmEdits())) {
                checkRadio('shift-strategy', previous);
                return;
            }
            showStrategyNotice('');
            pendingPrefStrategy = null;
            setStrategy(next);
            savePrefs();
            recalculate();
        });
    }

    excludeNonRhythmicButton.addEventListener('click', () => setCoursesExcluded(nonRhythmicIncluded(), true));

    for (const radio of document.querySelectorAll('input[name="rhythm-end-mode"]')) {
        radio.addEventListener('change', async () => {
            const previous = state.rhythmEndMode;
            await applyRhythmChange(() => {
                state.rhythmEndMode = radio.value;
            }, () => checkRadio('rhythm-end-mode', previous));
            savePrefs();
        });
    }

    newToInput.addEventListener('change', () => {
        const previous = state.newTo;
        applyRhythmChange(() => {
            state.newTo = parseDateInput(newToInput, false);
        }, () => {
            newToInput.value = toDateInputValue(previous);
        });
    });

    lectionCountInput.addEventListener('change', () => {
        const previous = state.lectionCount;
        applyRhythmChange(() => {
            const value = lectionCountInput.value.trim();
            state.lectionCount = value === '' ? null : Number(value);
        }, () => {
            lectionCountInput.value = previous === null ? '' : String(previous);
        });
    });

    excludedAddButton.addEventListener('click', () => {
        const from = parseDateInput(excludedFromInput, false);
        const to = parseDateInput(excludedToInput, false) ?? from;

        let error = '';
        if (!from) {
            error = 'Zadejte datum OD vynechaného dne.';
        } else if (Mapping.daysBetween(from, to) < 0) {
            error = 'Datum DO musí být stejné nebo pozdější než OD.';
        } else if (state.excludedDays.some((d) => Mapping.isSameDay(d.from, from) && Mapping.isSameDay(d.to, to))) {
            error = 'Tento den už v seznamu je.';
        }
        excludedError.textContent = error;
        excludedError.hidden = !error;
        if (error) return;

        applyRhythmChange(() => {
            state.excludedDays.push({ from, to, label: null });
            sortExcludedDays();
            excludedFromInput.value = '';
            excludedToInput.value = '';
        });
    });

    holidaysAddButton.addEventListener('click', () => {
        const range = holidayRange();
        if (!range) return;
        const holidays = Mapping.holidaysInRange(state.holidayCountry, range.from, range.to);
        // Svátek, který už v seznamu je, se nepřidá znovu (spec 5C).
        const toAdd = holidays.filter((h) => !state.excludedDays.some(
            (d) => Mapping.isSameDay(d.from, h.date) && Mapping.isSameDay(d.to, h.date)));

        if (toAdd.length === 0) {
            holidaysStatus.textContent = holidays.length === 0
                ? 'V období nejsou žádné státní svátky.'
                : 'Všechny svátky v období už v seznamu jsou.';
            return;
        }
        applyRhythmChange(() => {
            for (const holiday of toAdd) {
                state.excludedDays.push({ from: holiday.date, to: holiday.date, label: holiday.label });
            }
            sortExcludedDays();
            holidaysStatus.textContent = `Přidáno svátků: ${toAdd.length}.`;
        });
    });

    for (const radio of document.querySelectorAll('input[name="holiday-country"]')) {
        radio.addEventListener('change', () => {
            state.holidayCountry = radio.value;
            holidaysStatus.textContent = '';
            savePrefs();
        });
    }

    singleLectionEnabled.addEventListener('change', () => {
        state.singleLectionBookingEnabled = singleLectionEnabled.checked;
        singleLectionFromField.hidden = !singleLectionEnabled.checked;
        if (!singleLectionEnabled.checked) {
            state.singleLectionBookingFrom = null;
            singleLectionFrom.value = '';
        }
        savePrefs();
    });

    singleLectionFrom.addEventListener('change', () => {
        state.singleLectionBookingFrom = parseDateInput(singleLectionFrom, false);
        savePrefs();
    });

    registrationEndStrategy.addEventListener('change', () => {
        state.registrationEndStrategy = registrationEndStrategy.value;
        registrationEndDaysField.hidden = registrationEndStrategy.value !== 'daysBefore';
        savePrefs();
        recalculate();
    });

    registrationEndDays.addEventListener('input', () => {
        state.registrationEndDaysBefore = Math.max(0, Number(registrationEndDays.value) || 0);
        savePrefs();
        recalculate();
    });

    // Hromadná úprava názvů se neukládá do cookie (patří ke konkrétnímu bloku, spec 9).
    nameFindInput.addEventListener('input', () => {
        state.nameFind = nameFindInput.value;
        recalculate();
    });
    nameReplaceInput.addEventListener('input', () => {
        state.nameReplace = nameReplaceInput.value;
        recalculate();
    });

    // ---- Init ----
    // Nové datum OD musí být v budoucnu - min je zítřek (date input dává půlnoc zvoleného dne).
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    newFromInput.min = toDateInputValue(tomorrow);
    newToInput.min = toDateInputValue(tomorrow);

    const restoredPrefs = loadPrefs();
    applyPrefs(restoredPrefs);

    state.registrationEndDaysBefore = Number(registrationEndDays.value) || 0;
    loadButton.addEventListener('click', loadCourses);
    createButton.addEventListener('click', createCourses);
    // „Vytvořit další": aplikace je stateless, čistý reload vrátí prázdný stav i sekci A (spec 5G).
    resetButton.addEventListener('click', () => window.location.reload());
    loadSegments();
})();
