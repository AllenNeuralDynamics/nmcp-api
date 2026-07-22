export class ServiceBackoff {
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private currentDelayMs: number = 0;
    private nextAttemptTime: number = 0;

    public constructor(baseDelayMs: number, maxDelayMs: number) {
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs = maxDelayMs;
    }

    // True when the caller is allowed to attempt the service at `now`.
    public ready(now: number): boolean {
        return now >= this.nextAttemptTime;
    }

    // Record a failed/unavailable attempt at `now` and grow the backoff.
    // Returns true only on the transition INTO the backing-off state (for one-time logging).
    public recordFailure(now: number): boolean {
        const wasBackingOff = this.currentDelayMs > 0;

        this.currentDelayMs = this.currentDelayMs === 0
            ? this.baseDelayMs
            : Math.min(this.currentDelayMs * 2, this.maxDelayMs);

        this.nextAttemptTime = now + this.currentDelayMs;

        return !wasBackingOff;
    }

    // Record a fully successful pass and reset the backoff.
    // Returns true only on the transition OUT of the backing-off state (for one-time logging).
    public recordSuccess(): boolean {
        const wasBackingOff = this.currentDelayMs > 0;
        this.currentDelayMs = 0;
        this.nextAttemptTime = 0;
        return wasBackingOff;
    }

    public get currentDelay(): number {
        return this.currentDelayMs;
    }
}
