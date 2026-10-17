export function isNotNullOrUndefined<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

/**
 * Primarily used for fields than can be undefined (i.e., not included in an update or create request), but if present cannot be null or an empty string.
 * @param str potential value
 */
export function isNullOrEmpty(str: string): boolean {
    return str === null || (str !== undefined && str.length === 0);
}

/**
 * Merges an update into a stored JSON object.  An undefined update value is skipped rather than copied, since
 * JSON.stringify would drop the key and so remove the stored value.  A new object is always returned because
 * Sequelize compares a JSONB value against the current one and skips the write when they are the same object.
 */
export function mergeJsonProperties<T extends object>(stored: T | null | undefined, update: T): T {
    const merged = {...stored} as Record<string, unknown>;

    for (const [key, value] of Object.entries(update)) {
        if (value !== undefined) {
            merged[key] = value;
        }
    }

    return merged as T;
}

export function sum<T>(list: T[], selector: (arg: T) => number): number {
    return list.reduce((accumulator, currentValue) => accumulator + selector(currentValue), 0);
}
