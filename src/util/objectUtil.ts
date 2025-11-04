export function isNotNullOrUndefined<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

export function sum<T>(list: T[], selector: (arg: T) => number): number {
    return list.reduce((accumulator, currentValue) => accumulator + selector(currentValue), 0);
}
