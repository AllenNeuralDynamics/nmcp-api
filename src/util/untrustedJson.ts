export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The only way a response value becomes text.  JSON.parse can produce {"toString": null, "valueOf": null}, which makes
// String(), template literals and join throw, and a throw while converting a parsed response would be retried forever
// as an unavailable service.
export function primitiveText(value: unknown): string | null {
    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    return null;
}

export function describeReceived(value: unknown): string {
    const text = primitiveText(value);

    if (text !== null) {
        return text;
    }

    if (value === undefined) {
        return "<missing>";
    }

    if (value === null) {
        return "<null>";
    }

    return Array.isArray(value) ? "<array>" : "<object>";
}
