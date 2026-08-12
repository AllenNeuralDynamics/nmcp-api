/**
 * Elements are individually nullable because importers and raw JSON sources can supply gaps, which are
 * dropped rather than rejected.
 */
export type KeywordsInput = (string | null | undefined)[] | string | null | undefined;

/**
 * Keywords are a list of discrete entries and nothing here treats any character as a separator - a client
 * that offers single-field entry decides how to split it before calling, and a keyword may itself contain a
 * comma or semicolon.  A bare string is therefore one keyword, not a list to be broken apart.  Duplicates are
 * compared without regard to case because the keyword filter is itself case-insensitive.
 * @param keywords a list of keywords, or a single keyword as a string
 */
export function normalizeKeywords(keywords: KeywordsInput): string[] {
    if (keywords === null || keywords === undefined) {
        return [];
    }

    const entries = (Array.isArray(keywords) ? keywords : [keywords])
        .map(entry => (entry ?? "").trim())
        .filter(entry => entry.length > 0);

    const seen = new Set<string>();

    return entries.filter(entry => {
        const folded = entry.toLowerCase();

        if (seen.has(folded)) {
            return false;
        }

        seen.add(folded);

        return true;
    });
}

/**
 * Normalized values turned into case-insensitive substring patterns for ILIKE.  The escaping is only for
 * LIKE's own wildcards - these are bound through query replacements or operator values, never interpolated
 * into SQL.
 * @param values requested values in any of the forms normalizeKeywords accepts
 */
export function substringMatchPatterns(values: KeywordsInput): string[] {
    return normalizeKeywords(values).map(value => `%${value.replace(/([\\%_])/g, "\\$1")}%`);
}
