/**
 * ifGrade.js — the one place that turns an Infinite Flight stats block into
 * the grade number a pilot actually sees in the app.
 *
 * `gradeDetails.gradeIndex` is an ARRAY INDEX into `gradeDetails.grades`, not
 * a grade number: grades[0] is "Grade 1" … grades[4] is "Grade 5". Printing
 * the index shows every pilot one grade too low, and any call site that guards
 * with `||` hides a Grade 1 pilot entirely, because index 0 is falsy.
 *
 * Resolution order:
 *   1. grades[gradeIndex].name — the API's own label, so a renamed tier or a
 *      future sixth grade still reads correctly.
 *   2. gradeIndex + 1 — the same mapping done arithmetically, for the cached
 *      stats blocks that keep the index without the grades array.
 *   3. A plain `grade` / `calculatedGrade` field — POST /users and our acars
 *      backend both hand back a ready 1–5 value.
 */

function numeric(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {object|null} stats a GradeInfo/UserStats block, or the gradeDetails
 *        object on its own.
 * @returns {number|null} the grade number, or null when nothing in the block
 *          identifies one.
 */
export function resolveGrade(stats) {
    if (!stats) return null;

    const details = stats.gradeDetails || stats;
    const idx = numeric(details?.gradeIndex);
    if (idx !== null && idx >= 0) {
        const name = details?.grades?.[idx]?.name;
        const digits = typeof name === 'string' ? name.match(/\d+/) : null;
        return digits ? Number(digits[0]) : idx + 1;
    }

    return numeric(stats.grade) ?? numeric(stats.calculatedGrade);
}

/**
 * Same resolution, rendered for display. `fallback` is what shows when the
 * grade is unknown — pass whatever placeholder the surrounding UI uses.
 */
export function formatGrade(stats, fallback = '—') {
    const grade = resolveGrade(stats);
    return grade === null ? fallback : String(grade);
}
