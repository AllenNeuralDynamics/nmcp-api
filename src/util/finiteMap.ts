const DEFAULT_AGING_LIMIT = 100;

export class FiniteMap<K, V> extends Map<K, V> {
    private readonly agingLimit: number;

    private agingCache: K[] = [];

    public constructor(agingLimit: number = DEFAULT_AGING_LIMIT) {
        super();

        this.agingLimit = agingLimit;
    }

    public override set(key: K, value: V): this {
        if (!this.has(key)) {
            this.agingCache.push(key);
        }

        super.set(key, value);

        if (this.agingCache.length > this.agingLimit) {
            const oldest = this.agingCache.shift()
            this.delete(oldest);
        }

        return this;
    }
}
