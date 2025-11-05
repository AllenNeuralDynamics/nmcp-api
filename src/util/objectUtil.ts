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

export function sum<T>(list: T[], selector: (arg: T) => number): number {
    return list.reduce((accumulator, currentValue) => accumulator + selector(currentValue), 0);
}
