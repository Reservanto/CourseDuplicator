// Časové pravítko (spec 5A, 5C) - generický render vodorovné časové osy s řádky.
// Jen DOM, žádný state ani fetch: co se kreslí, skládá duplicator.js. Pozice jsou
// v procentech šířky stopy, takže pravítko nepotřebuje znát svou šířku v pixelech.
window.CourseDuplicator = window.CourseDuplicator || {};

window.CourseDuplicator.Ruler = (() => {
    const Mapping = window.CourseDuplicator.Mapping;

    /** Posun ukazatele (px), od kterého je stisk tažení, ne klik. */
    const DRAG_THRESHOLD_PX = 4;
    /** Místo (% osy), které popisek pruhu potřebuje vedle pruhu; jinak jde na druhou stranu / dovnitř. */
    const LABEL_SPACE_PERCENT = 30;

    const monthShort = new Intl.DateTimeFormat('cs-CZ', { month: 'short' });

    const div = (className) => {
        const node = document.createElement('div');
        node.className = className;
        return node;
    };

    /**
     * Vykreslí pravítko do containeru (nahradí jeho obsah).
     *
     * config = {
     *   from, to: Date             - rozsah osy (celé dny, včetně)
     *   ariaLabel: string
     *   showLabels: boolean        - levý sloupec s popisky řádků
     *   rows: [{
     *     label?: string, className?: string,
     *     items: [{
     *       kind: 'bar' | 'column' | 'marker',
     *       from, to?: Date        - 'marker' a 'column' jsou jednodenní (to se ignoruje)
     *       className?, title?, text? (popisek pruhu), value? (výška 'column' 0..1),
     *       onClick?: () => void   - pruh/značka se vykreslí jako tlačítko
     *       selected?: boolean
     *     }],
     *     note?: string            - text v řádku místo položek (načítání, prázdný stav)
     *   }]
     *   bands?: [{ from, to, className?, title? }]   - svislé pásy přes všechny řádky
     *   selection?: { from, to } | null              - zvýrazněný rozsah
     *   today?: Date
     *   onRangeSelect?: (from, to) => void           - povolí výběr rozsahu tažením
     * }
     */
    const render = (container, config) => {
        const totalDays = Mapping.daysBetween(config.from, config.to) + 1;
        if (totalDays <= 0) {
            container.replaceChildren();
            return;
        }

        /** Levý okraj dne v % stopy. */
        const leftOf = (date) => (Mapping.daysBetween(config.from, date) / totalDays) * 100;
        /** Rozsah dní [from, to] oříznutý na osu, v % stopy; null = mimo osu. */
        const span = (from, to) => {
            const start = Math.max(0, Mapping.daysBetween(config.from, from));
            const end = Math.min(totalDays - 1, Mapping.daysBetween(config.from, to ?? from));
            if (end < start) return null;
            return { left: (start / totalDays) * 100, width: ((end - start + 1) / totalDays) * 100 };
        };
        const place = (node, box) => {
            node.style.left = `${box.left}%`;
            node.style.width = `${box.width}%`;
        };

        const root = div(`ruler${config.showLabels ? ' ruler--labels' : ''}`);
        root.setAttribute('role', 'group');
        if (config.ariaLabel) root.setAttribute('aria-label', config.ariaLabel);

        // Osa: měsíce
        root.appendChild(div('ruler__label ruler__label--axis'));
        const axis = div('ruler__axis');
        Mapping.monthStarts(config.from, config.to).forEach((month, index) => {
            const tick = div('ruler__month');
            tick.style.left = `${leftOf(month)}%`;
            const withYear = index === 0 || month.getMonth() === 0;
            tick.textContent = withYear
                ? `${monthShort.format(month)} ${month.getFullYear()}`
                : monthShort.format(month);
            axis.appendChild(tick);
        });
        root.appendChild(axis);

        // Podkladová vrstva přes všechny řádky stopy: mřížka měsíců, pásy, výběr, dnešek.
        const overlay = div('ruler__overlay');
        for (const month of Mapping.monthStarts(config.from, config.to)) {
            const line = div('ruler__gridline');
            line.style.left = `${leftOf(month)}%`;
            overlay.appendChild(line);
        }
        for (const band of config.bands ?? []) {
            const box = span(band.from, band.to);
            if (!box) continue;
            const node = div(`ruler__band ${band.className ?? ''}`);
            place(node, box);
            if (band.title) node.title = band.title;
            overlay.appendChild(node);
        }
        const selectionNode = div('ruler__selection');
        selectionNode.hidden = true;
        overlay.appendChild(selectionNode);
        const showSelection = (from, to) => {
            const box = from && to ? span(from, to) : null;
            selectionNode.hidden = !box;
            if (box) place(selectionNode, box);
        };
        showSelection(config.selection?.from, config.selection?.to);
        if (config.today && Mapping.daysBetween(config.from, config.today) >= 0
            && Mapping.daysBetween(config.today, config.to) >= 0) {
            const today = div('ruler__today');
            // Dnešek uprostřed dne, ať čára nesplývá s hranou pruhu začínajícího dnes.
            today.style.left = `${leftOf(config.today) + 50 / totalDays}%`;
            today.title = 'Dnes';
            overlay.appendChild(today);
        }
        // Řádky gridu se umisťují explicitně: osa = 1, řádky od 2, podklad přes všechny řádky
        // (auto-placement by jinak řádky stopy kolem podkladu přeskládal).
        overlay.style.gridRow = `2 / span ${Math.max(1, config.rows.length)}`;
        root.appendChild(overlay);

        // Řádky
        config.rows.forEach((row, index) => {
            const gridRow = String(index + 2);
            const label = div('ruler__label');
            label.textContent = row.label ?? '';
            label.style.gridRow = gridRow;
            root.appendChild(label);

            const track = div(`ruler__track ${row.className ?? ''}`);
            track.style.gridRow = gridRow;
            if (row.note) {
                const note = div('ruler__note');
                note.textContent = row.note;
                track.appendChild(note);
            }
            for (const item of row.items ?? []) {
                const box = item.kind === 'bar' ? span(item.from, item.to) : span(item.from, item.from);
                if (!box) continue;
                track.appendChild(renderItem(item, box, place));
                if (item.kind === 'bar' && item.text) track.appendChild(renderBarText(item.text, box));
            }
            root.appendChild(track);
        });

        if (config.onRangeSelect) enableRangeSelect(root, overlay, config, totalDays, showSelection);

        container.replaceChildren(root);
        thinAxisLabels(axis);
        // Úzké pravítko (nebo změna šířky okna): popisky měsíců proředit znovu.
        if (container._rulerObserver) container._rulerObserver.disconnect();
        if (typeof ResizeObserver === 'function') {
            container._rulerObserver = new ResizeObserver(() => thinAxisLabels(axis));
            container._rulerObserver.observe(axis);
        }
    };

    /** Min. mezera mezi popisky měsíců (px). */
    const AXIS_LABEL_GAP_PX = 6;

    /**
     * Skryje popisky měsíců, které by se překrývaly nebo přetékaly osu. Přednost mají
     * popisky s rokem (první a leden), pak zleva doprava. Bez layoutu (skrytá sekce) nic nedělá.
     */
    const thinAxisLabels = (axis) => {
        const axisRect = axis.getBoundingClientRect();
        if (axisRect.width === 0) return;
        const ticks = [...axis.querySelectorAll('.ruler__month')];
        for (const tick of ticks) tick.classList.remove('is-hidden');

        const measured = ticks.map((tick, index) => ({
            tick,
            rect: tick.getBoundingClientRect(),
            priority: tick.textContent.includes(' ') ? 0 : 1,
            index,
        }));
        measured.sort((a, b) => (a.priority - b.priority) || (a.index - b.index));

        const accepted = [];
        for (const item of measured) {
            const fits = item.rect.right <= axisRect.right + 1
                && accepted.every((other) => item.rect.right + AXIS_LABEL_GAP_PX <= other.left
                    || item.rect.left >= other.right + AXIS_LABEL_GAP_PX);
            if (fits) accepted.push(item.rect);
            else item.tick.classList.add('is-hidden');
        }
    };

    const renderItem = (item, box, place) => {
        const interactive = typeof item.onClick === 'function';
        const node = document.createElement(interactive ? 'button' : 'span');
        node.className = `ruler__${item.kind} ${item.className ?? ''}`;
        if (item.selected) node.classList.add('is-selected');
        if (interactive) {
            node.type = 'button';
            node.addEventListener('click', item.onClick);
        }
        if (item.title) {
            node.title = item.title;
            node.setAttribute('aria-label', item.title);
        }
        if (item.kind === 'marker') {
            // Značka je bod uprostřed dne, šířku má z CSS.
            node.style.left = `${box.left + box.width / 2}%`;
        } else {
            place(node, box);
        }
        if (item.kind === 'column') node.style.height = `${Math.max(0.08, Math.min(1, item.value ?? 1)) * 100}%`;
        return node;
    };

    /**
     * Popisek pruhu (řádek patří jednomu pruhu, okolí je volné): vpravo od pruhu, když je tam
     * místo, jinak vlevo, a když není ani tam, uvnitř pruhu.
     */
    const renderBarText = (text, box) => {
        const label = document.createElement('span');
        label.className = 'ruler__bar-text';
        label.textContent = text;
        label.setAttribute('aria-hidden', 'true');
        const end = box.left + box.width;
        if (100 - end >= LABEL_SPACE_PERCENT) {
            label.style.left = `${end}%`;
        } else if (box.left >= LABEL_SPACE_PERCENT) {
            label.style.right = `${100 - box.left}%`;
        } else {
            label.classList.add('ruler__bar-text--inside');
            label.style.left = `${box.left}%`;
        }
        return label;
    };

    /**
     * Výběr rozsahu tažením přes stopu (spec 5A). Krátký stisk bez pohybu je obyčejný klik
     * (na pruhu ho obslouží jeho tlačítko); po tažení se následný click potlačí.
     */
    const enableRangeSelect = (root, overlay, config, totalDays, showSelection) => {
        root.classList.add('ruler--selectable');
        let drag = null;
        let suppressClick = false;

        const dayAt = (clientX) => {
            const rect = overlay.getBoundingClientRect();
            const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 0.999999);
            return Mapping.addDays(config.from, Math.floor(ratio * totalDays));
        };
        const ordered = (a, b) => (a <= b ? [a, b] : [b, a]);

        root.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (!event.target.closest('.ruler__track, .ruler__axis')) return;
            drag = { startX: event.clientX, startDay: dayAt(event.clientX), active: false, pointerId: event.pointerId };
        });

        root.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            if (!drag.active) {
                if (Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
                drag.active = true;
                root.setPointerCapture(event.pointerId);
                root.classList.add('is-dragging');
            }
            const [from, to] = ordered(drag.startDay, dayAt(event.clientX));
            showSelection(from, to);
            event.preventDefault();
        });

        const finish = (event, commit) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const wasActive = drag.active;
            const [from, to] = ordered(drag.startDay, dayAt(event.clientX));
            drag = null;
            root.classList.remove('is-dragging');
            if (!wasActive) return;
            // Click (pokud vůbec přijde) se odbaví ve stejné úloze jako pointerup; pak pojistku zrušit.
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
            if (commit) {
                config.onRangeSelect(from, to);
            } else {
                showSelection(config.selection?.from, config.selection?.to);
            }
        };
        root.addEventListener('pointerup', (event) => finish(event, true));
        root.addEventListener('pointercancel', (event) => finish(event, false));

        // Click po tažení nesmí zároveň vybrat pruh, na kterém tažení skončilo.
        root.addEventListener('click', (event) => {
            if (!suppressClick) return;
            suppressClick = false;
            event.stopPropagation();
            event.preventDefault();
        }, true);
    };

    return { render };
})();
