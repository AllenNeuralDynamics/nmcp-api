import {FiniteMap} from "./finiteMap";

interface TimedEntry<V> {
    value: V;
    expiresAt: number;
}

export class TimedFiniteMap<K, V> {
    private readonly map: FiniteMap<K, TimedEntry<V>>;
    private readonly ttlMs: number;

    public constructor(agingLimit: number, ttlMs: number) {
        this.map = new FiniteMap<K, TimedEntry<V>>(agingLimit);
        this.ttlMs = ttlMs;
    }

    public setTimed(key: K, value: V): void {
        this.map.set(key, {value, expiresAt: Date.now() + this.ttlMs});
    }

    public getTimed(key: K): V | undefined {
        const entry = this.map.get(key);

        if (!entry) {
            return undefined;
        }

        if (Date.now() >= entry.expiresAt) {
            this.map.delete(key);
            return undefined;
        }

        return entry.value;
    }

    public has(key: K): boolean {
        return this.getTimed(key) !== undefined;
    }

    public get size(): number {
        return this.map.size;
    }
}
