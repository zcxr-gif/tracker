/**
 * ifGrade.js — reading a pilot's grade out of an Infinite Flight stats block.
 *
 * THE TRAP THIS MODULE EXISTS FOR: `gradeDetails.gradeIndex` is NOT the grade.
 * It is the index of the pilot's grade within `gradeDetails.grades[]`, and that
 * array is zero-based — `grades[2].name` is "Grade 3". Printing gradeIndex
 * straight into the UI reports every pilot exactly one grade too low, and
 * reports a Grade 1 pilot as "Grade 0", because their index is 0.
 *
 * The Live API gives us the same number three ways and only one of them is an
 * index:
 *
 *   GET  /users/{id}  → gradeDetails.gradeIndex   zero-based INDEX (1 too low)
 *   POST /users       → grade                     the grade, 1–5
 *   our ACARS backend → calculatedGrade           gradeIndex + 1, already fixed
 *
 * So: never read gradeIndex at a display site. Call gradeNumber()/gradeLabel(),
 * which know which of the three they are looking at. Reading gradeIndex to
 * INDEX `grades[]` — for a grade's name, or to find the next grade up — is
 * correct and is what it is for; that is not what this module replaces.
 */

/**
 * The pilot's grade as a number 1–5, or null when the block has no grade in it.
 * @param {object} stats a stats block from the ACARS backend or the Live API
 */
export function gradeNumber(stats) {
    const idx = stats?.gradeDetails?.gradeIndex;
    if (Number.isFinite(idx)) return idx + 1;
    // Both of these are already the grade rather than an index, so they are
    // taken as they come.
    if (Number.isFinite(stats?.calculatedGrade)) return stats.calculatedGrade;
    if (Number.isFinite(stats?.grade)) return stats.grade;
    return null;
}

/**
 * The same thing as a string ready to drop into markup, with the caller's
 * placeholder when there is no grade to show.
 */
export function gradeLabel(stats, fallback = '—') {
    const n = gradeNumber(stats);
    return n == null ? fallback : String(n);
}
