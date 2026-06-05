// Mapovací logika datumů (spec 6) - pure funkce bez DOM manipulací a bez fetch volání.
// Všechny Date hodnoty jsou lokální čas prohlížeče; posuny dnů se dělají kalendářně
// (zachovávají hodinu/minutu i přes přechod letního času).
window.CourseDuplicator = window.CourseDuplicator || {};

window.CourseDuplicator.Mapping = (() => {
    const MS_PER_DAY = 86400000;

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

    /** Nový start lekce s respektováním pinned hodnoty (spec 6.3). */
    const lectionNewStart = (lection) => lection.isPinned ? lection.pinnedNewStart : lection.newStart;

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
     * Vypočtené datum DO období (spec 6.5): MAX z konců (newStart + délka lekce)
     * všech ne-vyloučených lekcí ne-vyloučených kurzů. Pinned lekce se berou
     * z pinnedNewStart. Vrací null, pokud žádná lekce nemá spočítaný nový start.
     */
    const calculatePeriodEndDate = (courses) => {
        let max = null;
        for (const course of courses) {
            if (course.isExcluded) continue;
            for (const lection of course.lections) {
                if (lection.isExcluded) continue;
                const newStart = lectionNewStart(lection);
                if (!newStart) continue;
                const lengthMs = lection.originalEnd.getTime() - lection.originalStart.getTime();
                const endTime = new Date(newStart.getTime() + lengthMs);
                if (max === null || endTime > max) max = endTime;
            }
        }
        return max;
    };

    /**
     * Globální přepočet (spec 6.1-6.4): pro každou ne-pinned lekci nastaví newStart,
     * pro každý kurz newRegistrationEnd. Pinned hodnoty nepřepisuje. Mutuje state in-place.
     */
    const applyMappingToState = (state) => {
        if (!state.newFrom) return state;

        const { shiftDays } = calculateShift(state.sourceFrom, state.newFrom, state.shiftStrategy);

        for (const course of state.courses) {
            // Počítá se i pro vyloučené kurzy/lekce - po zpětném zařazení jsou hodnoty rovnou k dispozici.
            for (const lection of course.lections) {
                if (lection.isPinned) continue;
                lection.newStart = mapLectionDate(lection.originalStart, shiftDays);
            }

            // Nový start kurzu = minimum z nových startů ne-vyloučených lekcí (spec 6.4).
            let newCourseStart = null;
            for (const lection of course.lections) {
                if (lection.isExcluded) continue;
                const newStart = lectionNewStart(lection);
                if (newStart && (newCourseStart === null || newStart < newCourseStart)) {
                    newCourseStart = newStart;
                }
            }

            course.newRegistrationEnd = newCourseStart === null
                ? null
                : calculateRegistrationEnd(
                    course, newCourseStart, state.registrationEndStrategy, state.registrationEndDaysBefore);
        }

        return state;
    };

    return {
        calculateShift,
        mapLectionDate,
        calculateRegistrationEnd,
        calculatePeriodEndDate,
        applyMappingToState,
    };
})();
