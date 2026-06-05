// Frontend duplikátoru - sekce A (zdrojové období), B (přehled), C (cílové období),
// D (detail s novými datumy) a E (globální nastavení).
// Mapovací logika je v mapping.js, tady jen state, API volání a render.
(() => {
    'use strict';

    const Mapping = window.CourseDuplicator.Mapping;

    // ---- Globální state (spec 4.2) ----
    const state = {
        segmentId: null,
        sourceFrom: null,
        sourceTo: null,

        newFrom: null,
        shiftStrategy: 'weekday',

        singleLectionBookingEnabled: false,
        singleLectionBookingFrom: null,
        registrationEndStrategy: 'keepOffset',
        registrationEndDaysBefore: 3,

        courses: [],
    };
    // Pro ladění v konzoli
    window.CourseDuplicator.state = state;

    // ---- Elementy ----
    const el = (id) => document.getElementById(id);
    const segmentSelect = el('segment-select');
    const segmentField = el('segment-field');
    const segmentSingle = el('segment-single');
    const sourceFromInput = el('source-from');
    const sourceToInput = el('source-to');
    const loadButton = el('load-courses-btn');
    const loadSpinner = el('load-spinner');
    const loadStatus = el('load-status');
    const loadError = el('load-error');
    const sectionOverview = el('section-overview');
    const courseList = el('course-list');
    const courseSummary = el('course-summary');
    const sectionTarget = el('section-target');
    const newFromInput = el('new-from');
    const effectiveFromEl = el('effective-from');
    const computedToEl = el('computed-to');
    const sectionDetail = el('section-detail');
    const courseDetailList = el('course-detail-list');
    const sectionSettings = el('section-settings');
    const singleLectionEnabled = el('single-lection-enabled');
    const singleLectionFromField = el('single-lection-from-field');
    const singleLectionFrom = el('single-lection-from');
    const registrationEndStrategy = el('registration-end-strategy');
    const registrationEndDaysField = el('registration-end-days-field');
    const registrationEndDays = el('registration-end-days');

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

    const api = {
        getSegments: () => fetchJson('/?handler=Segments'),
        loadCourses: (segmentId, from, to) => fetchJson('/?handler=LoadCourses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'RequestVerificationToken': antiforgeryToken(),
            },
            body: JSON.stringify({ segmentId, from, to }),
        }),
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

    /** Hodnota pro input[type=datetime-local]: "2026-01-05T18:00". */
    const toLocalInputValue = (date) =>
        `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

    /** Parsování hodnoty datetime-local jako lokálního času (bez TZ překvapení). */
    const parseLocalInputValue = (value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
        if (!match) return null;
        const [, year, month, day, hour, minute] = match.map(Number);
        return new Date(year, month - 1, day, hour, minute);
    };

    /** Aktuální nový start lekce s respektováním pinned hodnoty. */
    const lectionNewStart = (lection) =>
        (lection.isPinned ? lection.pinnedNewStart : lection.newStart) ?? null;

    const lectionLengthMinutes = (lection) =>
        Math.round((lection.originalEnd - lection.originalStart) / 60000);

    const showError = (message) => {
        loadError.textContent = message;
        loadError.hidden = false;
    };

    const setLoading = (loading, status = '') => {
        loadButton.disabled = loading;
        loadSpinner.hidden = !loading;
        loadStatus.textContent = status;
    };

    // ---- Sekce A: segmenty ----
    const loadSegments = async () => {
        try {
            const segments = await api.getSegments();
            segmentSelect.innerHTML = '';

            if (segments.length === 0) {
                showError('Váš účet nemá žádné segmenty.');
                return;
            }

            for (const segment of segments) {
                const option = document.createElement('option');
                option.value = segment.id;
                option.textContent = segment.name;
                segmentSelect.appendChild(option);
            }
            segmentSelect.disabled = false;
            state.segmentId = Number(segmentSelect.value);

            // Jediný segment: automaticky vybrán, dropdown sbalený na prostý text (spec 5A).
            if (segments.length === 1) {
                segmentField.hidden = true;
                segmentSingle.textContent = `Segment: ${segments[0].name}`;
                segmentSingle.hidden = false;
            }
        } catch (error) {
            showError(`Nepodařilo se načíst segmenty: ${error.message}`);
        }
    };

    // ---- Sekce A -> B: načtení kurzů ----
    const parseDateInput = (input, endOfDay) => {
        if (!input.value) return null;
        const [year, month, day] = input.value.split('-').map(Number);
        return endOfDay
            ? new Date(year, month - 1, day, 23, 59, 59)
            : new Date(year, month - 1, day);
    };

    const toUnix = (date) => Math.floor(date.getTime() / 1000);

    const loadCourses = async () => {
        loadError.hidden = true;

        state.segmentId = Number(segmentSelect.value);
        state.sourceFrom = parseDateInput(sourceFromInput, false);
        state.sourceTo = parseDateInput(sourceToInput, true);

        if (!state.segmentId || !state.sourceFrom || !state.sourceTo) {
            showError('Vyberte segment a zadejte obě data období.');
            return;
        }
        if (state.sourceFrom >= state.sourceTo) {
            showError('Datum OD musí být před datem DO.');
            return;
        }

        setLoading(true, 'Načítám kurzy…');
        try {
            const result = await api.loadCourses(
                state.segmentId, toUnix(state.sourceFrom), toUnix(state.sourceTo));

            state.courses = result.courses.map((c) => ({
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
                lections: c.lections.map((l) => ({
                    originalStart: new Date(l.start * 1000),
                    originalEnd: new Date(l.end * 1000),
                    isExcluded: false,
                    isPinned: false,
                    pinnedNewStart: null,
                })),
                isExcluded: false,
            }));

            renderCourses();
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
        const hasInput = state.newFrom !== null && state.courses.length > 0;
        sectionDetail.hidden = !hasInput;
        sectionSettings.hidden = !hasInput;
        if (!hasInput) {
            effectiveFromEl.textContent = '–';
            computedToEl.textContent = '–';
            return;
        }

        Mapping.applyMappingToState(state);

        const { effectiveNewFrom } = Mapping.calculateShift(state.sourceFrom, state.newFrom, state.shiftStrategy);
        effectiveFromEl.textContent = formatDate(effectiveNewFrom);

        const periodEnd = Mapping.calculatePeriodEndDate(state.courses);
        computedToEl.textContent = periodEnd ? formatDate(periodEnd) : '–';

        renderDetail();

        // RegistrationEnd se v UI zatím per kurz nezobrazuje - kontrola přes konzoli.
        console.log('RegistrationEnd per kurz:', state.courses.map((c) => ({
            kurz: c.name,
            registrationEnd: c.newRegistrationEnd ? formatDateTime(c.newRegistrationEnd) : null,
        })));
    };

    // ---- Sekce B: render přehledu ----
    const renderSummary = () => {
        const included = state.courses.filter((c) => !c.isExcluded);
        const lectionCount = included.reduce((sum, c) => sum + c.lections.length, 0);
        const excludedCount = state.courses.length - included.length;
        courseSummary.textContent =
            `Načteno ${included.length} kurzů s celkem ${lectionCount} lekcemi. Vyloučeno ${excludedCount} kurzů.`;
    };

    const buildTable = (labels) => {
        const table = document.createElement('table');
        table.className = 'course-table';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of labels) {
            const th = document.createElement('th');
            th.className = 'course-table__head-cell';
            th.textContent = label;
            headRow.appendChild(th);
        }
        head.appendChild(headRow);
        table.appendChild(head);
        const body = document.createElement('tbody');
        table.appendChild(body);
        return { table, body };
    };

    const renderCourses = () => {
        courseList.innerHTML = '';

        if (state.courses.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'duplicator__empty';
            empty.textContent = 'Žádné kurzy k duplikaci v zadaném období.';
            courseList.appendChild(empty);
            courseSummary.textContent = '';
            return;
        }

        const { table, body } = buildTable(
            ['Název kurzu', 'Zdroj / služba', 'Kapacita', 'Lekcí', 'Rozsah dat', '']);
        for (const course of state.courses) {
            body.appendChild(renderCourseRow(course));
        }
        courseList.appendChild(table);
        renderSummary();
    };

    const courseSourceLabel = (course) => course.bookingServiceName
        ? `${course.bookingResourceName} / ${course.bookingServiceName}`
        : course.bookingResourceName;

    const excludeToggle = (course) => {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'course-row__exclude';
        toggle.textContent = course.isExcluded ? '↩' : '✕';
        toggle.title = course.isExcluded ? 'Vrátit do duplikace' : 'Vyloučit z duplikace';
        toggle.addEventListener('click', () => {
            course.isExcluded = !course.isExcluded;
            renderCourses();
            recalculate();
        });
        return toggle;
    };

    const renderCourseRow = (course) => {
        const row = document.createElement('tr');
        row.className = 'course-row' + (course.isExcluded ? ' course-row--excluded' : '');

        const cell = (content) => {
            const td = document.createElement('td');
            td.className = 'course-row__cell';
            td.textContent = content;
            row.appendChild(td);
            return td;
        };

        cell(course.name);
        cell(courseSourceLabel(course));
        cell(String(course.capacity));
        cell(String(course.lections.length));
        cell(`${formatDate(course.originalStartDate)} – ${formatDate(course.originalEndDate)}`);

        const actionCell = document.createElement('td');
        actionCell.className = 'course-row__cell course-row__cell--action';
        actionCell.appendChild(excludeToggle(course));
        row.appendChild(actionCell);

        return row;
    };

    // ---- Sekce D: detail s novými datumy ----

    /** Nový rozsah kurzu: min start a max konec přes ne-vyloučené lekce. */
    const courseNewRange = (course) => {
        let min = null;
        let max = null;
        for (const lection of course.lections) {
            if (lection.isExcluded) continue;
            const start = lectionNewStart(lection);
            if (!start) continue;
            const end = new Date(start.getTime() + lectionLengthMinutes(lection) * 60000);
            if (min === null || start < min) min = start;
            if (max === null || end > max) max = end;
        }
        return { min, max };
    };

    const renderDetail = () => {
        courseDetailList.innerHTML = '';
        if (state.courses.length === 0) return;

        const { table, body } = buildTable(
            ['Název kurzu', 'Zdroj / služba', 'Kapacita', 'Lekcí', 'Původní (OD – DO)', 'Nové (OD – DO)', '', '']);
        for (const course of state.courses) {
            body.appendChild(renderDetailRow(course));
            if (course._detailOpen) {
                body.appendChild(renderLectionsRow(course));
            }
        }
        courseDetailList.appendChild(table);
    };

    const renderDetailRow = (course) => {
        const row = document.createElement('tr');
        row.className = 'course-row' + (course.isExcluded ? ' course-row--excluded' : '');

        const cell = (content) => {
            const td = document.createElement('td');
            td.className = 'course-row__cell';
            td.textContent = content;
            row.appendChild(td);
            return td;
        };

        const activeLections = course.lections.filter((l) => !l.isExcluded).length;
        const { min, max } = courseNewRange(course);

        cell(course.name);
        cell(courseSourceLabel(course));
        cell(String(course.capacity));
        cell(activeLections === course.lections.length
            ? String(course.lections.length)
            : `${activeLections} z ${course.lections.length}`);
        cell(`${formatDate(course.originalStartDate)} – ${formatDate(course.originalEndDate)}`);
        cell(min && max ? `${formatDate(min)} – ${formatDate(max)}` : '–');

        const excludeCell = document.createElement('td');
        excludeCell.className = 'course-row__cell course-row__cell--action';
        excludeCell.appendChild(excludeToggle(course));
        row.appendChild(excludeCell);

        const detailCell = document.createElement('td');
        detailCell.className = 'course-row__cell course-row__cell--action';
        const detailToggle = document.createElement('button');
        detailToggle.type = 'button';
        detailToggle.className = 'course-row__detail-toggle';
        detailToggle.textContent = course._detailOpen ? '▾ detail' : '▸ detail';
        detailToggle.addEventListener('click', () => {
            course._detailOpen = !course._detailOpen;
            renderDetail();
        });
        detailCell.appendChild(detailToggle);
        row.appendChild(detailCell);

        return row;
    };

    const renderLectionsRow = (course) => {
        const row = document.createElement('tr');
        row.className = 'course-row__lections';
        const cell = document.createElement('td');
        cell.className = 'course-row__lections-cell';
        cell.colSpan = 8;

        const { table, body } = buildTable(
            ['#', 'Původní datum', 'Nové datum', 'Délka', '', '']);
        table.className = 'lection-table';
        course.lections.forEach((lection, index) => {
            body.appendChild(renderLectionRow(course, lection, index));
        });
        cell.appendChild(table);
        row.appendChild(cell);
        return row;
    };

    const renderLectionRow = (course, lection, index) => {
        const row = document.createElement('tr');
        row.className = 'lection-row' + (lection.isExcluded ? ' lection-row--excluded' : '');

        const cell = (content, className = '') => {
            const td = document.createElement('td');
            td.className = `lection-row__cell ${className}`.trim();
            if (content !== null) td.textContent = content;
            row.appendChild(td);
            return td;
        };

        cell(String(index + 1));
        cell(formatDateTime(lection.originalStart));

        // Nové datum: klik -> inline edit (datetime-local), enter potvrdí, esc/blur zruší.
        const newStart = lectionNewStart(lection);
        const newCell = cell(null, 'lection-row__new');
        if (lection.isPinned) {
            const pin = document.createElement('span');
            pin.className = 'lection-row__pin';
            pin.textContent = '📌 ';
            pin.title = 'Ručně připnuté datum - globální přepočet ho nemění';
            newCell.appendChild(pin);
        }
        newCell.appendChild(document.createTextNode(newStart ? formatDateTime(newStart) : '–'));
        if (newStart && !lection.isExcluded) {
            newCell.classList.add('lection-row__new--editable');
            newCell.title = 'Klikněte pro ruční úpravu data';
            newCell.addEventListener('click', () => beginLectionEdit(newCell, lection));
        }

        cell(`${lectionLengthMinutes(lection)} min`);

        const excludeCell = cell(null, 'lection-row__cell--action');
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'course-row__exclude';
        toggle.textContent = lection.isExcluded ? '↩' : '✕';
        toggle.title = lection.isExcluded ? 'Vrátit lekci do duplikace' : 'Vyloučit lekci z duplikace';
        toggle.addEventListener('click', () => {
            lection.isExcluded = !lection.isExcluded;
            recalculate();
        });
        excludeCell.appendChild(toggle);

        const pinCell = cell(null, 'lection-row__cell--action');
        if (lection.isPinned) {
            const unpin = document.createElement('button');
            unpin.type = 'button';
            unpin.className = 'course-row__detail-toggle';
            unpin.textContent = 'obnovit auto výpočet';
            unpin.addEventListener('click', () => {
                lection.isPinned = false;
                lection.pinnedNewStart = null;
                recalculate();
            });
            pinCell.appendChild(unpin);
        }

        return row;
    };

    const beginLectionEdit = (cell, lection) => {
        const current = lectionNewStart(lection);
        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'lection-row__edit-input';
        input.value = toLocalInputValue(current);

        let finished = false;
        const finish = (save) => {
            if (finished) return;
            finished = true;
            if (save) {
                const parsed = parseLocalInputValue(input.value);
                if (parsed) {
                    lection.isPinned = true;
                    lection.pinnedNewStart = parsed;
                }
            }
            recalculate();
        };

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(true);
            } else if (event.key === 'Escape') {
                finish(false);
            }
        });
        input.addEventListener('blur', () => finish(false));

        cell.replaceChildren(input);
        // Klik na buňku s inputem nesmí znovu spustit edit
        cell.classList.remove('lection-row__new--editable');
        input.focus();
    };

    // ---- Sekce C + E: wiring ----
    newFromInput.addEventListener('change', () => {
        state.newFrom = parseDateInput(newFromInput, false);
        recalculate();
    });

    for (const radio of document.querySelectorAll('input[name="shift-strategy"]')) {
        radio.addEventListener('change', () => {
            state.shiftStrategy = radio.value;
            recalculate();
        });
    }

    singleLectionEnabled.addEventListener('change', () => {
        state.singleLectionBookingEnabled = singleLectionEnabled.checked;
        singleLectionFromField.hidden = !singleLectionEnabled.checked;
        if (!singleLectionEnabled.checked) {
            state.singleLectionBookingFrom = null;
            singleLectionFrom.value = '';
        }
    });

    singleLectionFrom.addEventListener('change', () => {
        state.singleLectionBookingFrom = parseDateInput(singleLectionFrom, false);
    });

    registrationEndStrategy.addEventListener('change', () => {
        state.registrationEndStrategy = registrationEndStrategy.value;
        registrationEndDaysField.hidden = registrationEndStrategy.value !== 'daysBefore';
        recalculate();
    });

    registrationEndDays.addEventListener('input', () => {
        state.registrationEndDaysBefore = Math.max(0, Number(registrationEndDays.value) || 0);
        recalculate();
    });

    // ---- Init ----
    state.registrationEndDaysBefore = Number(registrationEndDays.value) || 0;
    loadButton.addEventListener('click', loadCourses);
    loadSegments();
})();
