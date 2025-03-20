export class Semaphore {
    private readonly capacity: number;
    private current: number = 0;
    private waiting: any[] = [];

    public constructor(capacity: number = 1) {
        this.capacity = capacity;
    }

    public async acquire(): Promise<void> {
        if (this.current < this.capacity) {
            this.current++;
            return Promise.resolve();
        } else {
            return new Promise<void>((resolve) => {
                this.waiting.push(resolve);
            });
        }
    }

    public release(): void {
        if (this.waiting.length > 0) {
            const resolve = this.waiting.shift();
            resolve();
        } else {
            this.current--;
        }
    }
}
