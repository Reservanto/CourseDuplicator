// Frontend duplikátoru - sekce A (zdrojové období) a B (přehled kurzů).
// Mapovací logika je v mapping.js, tady jen state, API volání a render.
(() => {
    'use strict';

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
        registrationEndDaysBefore: 0,

        courses: [],
    };
    // Pro ladění v konzoli
    window.CourseDuplicator = window.CourseDuplicator || {};
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
    const weekdayFormat = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long' });
    const formatDate = (date) =>
        `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()} (${weekdayFormat.format(date)})`;

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
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(false);
        }
    };

    // ---- Sekce B: render přehledu ----
    const renderSummary = () => {
        const included = state.courses.filter((c) => !c.isExcluded);
        const lectionCount = included.reduce((sum, c) => sum + c.lections.length, 0);
        const excludedCount = state.courses.length - included.length;
        courseSummary.textContent =
            `Načteno ${included.length} kurzů s celkem ${lectionCount} lekcemi. Vyloučeno ${excludedCount} kurzů.`;
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

        const table = document.createElement('table');
        table.className = 'course-table';

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['Název kurzu', 'Zdroj / služba', 'Kapacita', 'Lekcí', 'Rozsah dat', '']) {
            const th = document.createElement('th');
            th.className = 'course-table__head-cell';
            th.textContent = label;
            headRow.appendChild(th);
        }
        head.appendChild(headRow);
        table.appendChild(head);

        const body = document.createElement('tbody');
        for (const course of state.courses) {
            body.appendChild(renderCourseRow(course));
        }
        table.appendChild(body);

        courseList.appendChild(table);
        renderSummary();
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
        cell(course.bookingServiceName
            ? `${course.bookingResourceName} / ${course.bookingServiceName}`
            : course.bookingResourceName);
        cell(String(course.capacity));
        cell(String(course.lections.length));
        cell(`${formatDate(course.originalStartDate)} – ${formatDate(course.originalEndDate)}`);

        const actionCell = document.createElement('td');
        actionCell.className = 'course-row__cell course-row__cell--action';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'course-row__exclude';
        toggle.textContent = course.isExcluded ? '↩' : '✕';
        toggle.title = course.isExcluded ? 'Vrátit do duplikace' : 'Vyloučit z duplikace';
        toggle.addEventListener('click', () => {
            course.isExcluded = !course.isExcluded;
            row.replaceWith(renderCourseRow(course));
            renderSummary();
        });
        actionCell.appendChild(toggle);
        row.appendChild(actionCell);

        return row;
    };

    // ---- Init ----
    loadButton.addEventListener('click', loadCourses);
    loadSegments();
})();
