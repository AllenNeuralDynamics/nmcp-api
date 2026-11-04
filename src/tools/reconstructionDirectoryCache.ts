/**
 * Whether each subject's top-level reconstruction directory exists, looked up once per subject.  A missing directory
 * is reported only for a subject at least one expected lookup asked about, whatever order the lookups came in: a
 * speculative lookup for an In Progress row can run before or after the expected one for another row of the same
 * specimen.
 *
 * Its own module so that a test can require it; the import tools start an import on load.
 */
export class ReconstructionDirectoryCache {
    private readonly found = new Map<string, boolean>();
    private readonly expected = new Set<string>();

    public constructor(private readonly lookup: (subjectId: string) => Promise<boolean>) {
    }

    public async exists(subjectId: string, expected: boolean): Promise<boolean> {
        if (expected) {
            this.expected.add(subjectId);
        }

        if (!this.found.has(subjectId)) {
            this.found.set(subjectId, await this.lookup(subjectId));
        }

        return this.found.get(subjectId);
    }

    public missingExpected(): string[] {
        return [...this.expected].filter(subjectId => this.found.get(subjectId) === false);
    }
}
