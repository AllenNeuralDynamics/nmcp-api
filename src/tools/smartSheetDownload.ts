import * as fs from "fs";
import * as path from "path";
import {randomInt} from "crypto";

import {createClient, Sheet} from "smartsheet";

const emailSource = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
const emailPattern = new RegExp(`^${emailSource}$`);

const syllables = ["ba", "ce", "di", "fo", "ga", "ke", "li", "mo", "na", "pe", "ri", "sa", "tu", "vo", "ze", "lan", "mir", "dor", "ten", "vas"];

type Person = {
    name: string;
    email: string;
}

function isEmail(value: unknown): value is string {
    return typeof value == "string" && emailPattern.test(value.trim());
}

function randomWord(): string {
    const word = Array.from({length: 2 + randomInt(2)}, () => syllables[randomInt(syllables.length)]).join("");

    return word.charAt(0).toUpperCase() + word.substring(1);
}

// Replaces people with random stand-ins, consistently: one real person maps to one fake name and email everywhere in the
// sheet, so rows that share an annotator still do and a contact cell's name still pairs with its email.  Names are only
// recognized when the sheet itself pairs them with an email (contact cells, contact options, and the like), so a name
// typed into free text without ever appearing in a contact field is left as is.
class Anonymizer {
    private readonly byEmail = new Map<string, Person>();
    private readonly byName = new Map<string, Person>();
    private readonly fakeNames = new Set<string>();

    public anonymize(sheet: Sheet): Sheet {
        this.learnSheet(sheet);

        const names = Array.from(this.byName.keys()).sort((lhs, rhs) => rhs.length - lhs.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

        // One pass over each string with a combined pattern, so replacement text is never itself rescanned.
        const pattern = new RegExp(names.length > 0 ? `${emailSource}|(?<![\\w])(?:${names.join("|")})(?![\\w])` : emailSource, "g");

        return this.replaceStrings(sheet, pattern);
    }

    private learnSheet(sheet: Sheet) {
        const contactColumnIds = new Set(sheet.columns.filter(column => column.type?.includes("CONTACT")).map(column => column.id));

        for (const row of sheet.rows) {
            for (const cell of row.cells) {
                if (contactColumnIds.has(cell.columnId) && isEmail(cell.value)) {
                    this.learn(isEmail(cell.displayValue) ? undefined : cell.displayValue, cell.value);
                }
            }
        }

        this.learnObjects(sheet);
    }

    // Contact options, objectValue contacts, and owner/creator records all carry an email with an optional name.
    private learnObjects(node: unknown) {
        if (Array.isArray(node)) {
            node.forEach(child => this.learnObjects(child));
        } else if (node && typeof node == "object") {
            const record = node as Record<string, unknown>;

            if (isEmail(record.email)) {
                this.learn(typeof record.name == "string" && !isEmail(record.name) ? record.name : undefined, record.email);
            }

            Object.values(record).forEach(child => this.learnObjects(child));
        }
    }

    private learn(name: string | undefined, email: string) {
        const emailKey = email.trim().toLowerCase();
        const nameKey = name?.trim();

        const person = this.byEmail.get(emailKey) ?? (nameKey ? this.byName.get(nameKey) : undefined) ?? this.createPerson();

        if (!this.byEmail.has(emailKey)) {
            this.byEmail.set(emailKey, person);
        }

        if (nameKey && !this.byName.has(nameKey)) {
            this.byName.set(nameKey, person);
        }
    }

    private createPerson(): Person {
        let first: string;
        let last: string;

        do {
            first = randomWord();
            last = randomWord();
        } while (this.fakeNames.has(`${first} ${last}`));

        this.fakeNames.add(`${first} ${last}`);

        return {name: `${first} ${last}`, email: `${first}.${last}@example.com`.toLowerCase()};
    }

    private replacement(match: string): string {
        if (!match.includes("@")) {
            return this.byName.get(match).name;
        }

        const emailKey = match.toLowerCase();

        if (!this.byEmail.has(emailKey)) {
            this.byEmail.set(emailKey, this.createPerson());
        }

        return this.byEmail.get(emailKey).email;
    }

    private replaceStrings<T>(node: T, pattern: RegExp): T {
        if (typeof node == "string") {
            return node.replace(pattern, match => this.replacement(match)) as unknown as T;
        }

        if (Array.isArray(node)) {
            return node.map(child => this.replaceStrings(child, pattern)) as unknown as T;
        }

        if (node && typeof node == "object") {
            return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, this.replaceStrings(value, pattern)])) as T;
        }

        return node;
    }
}

// Apart from the people in it, the response is saved as returned, so a test can hand it back from a stubbed getSheet in
// place of the live sheet.
async function smartSheetDownload(sheetId: number): Promise<string> {
    const token = process.env.SS_API_TOKEN;

    if (!token) {
        throw new Error("SmartSheet access token required (SS_API_TOKEN).");
    }

    const client = createClient({logLevel: "warn", accessToken: token});

    const sheet = new Anonymizer().anonymize(await client.sheets.getSheet({id: sheetId}));

    const outputPath = path.join(__dirname, "..", "..", "fixtures", `smartSheet-${sheetId}.json`);

    // One row per line keeps the file greppable and makes a refreshed download diff row by row.
    const {rows, ...header} = sheet;
    const headerJson = JSON.stringify(header, null, 2);
    const rowsJson = rows.map(row => `    ${JSON.stringify(row)}`).join(",\n");

    fs.writeFileSync(outputPath, `${headerJson.substring(0, headerJson.length - 2)},\n  "rows": [\n${rowsJson}\n  ]\n}\n`);

    return outputPath;
}

const cliArguments = process.argv.slice(2);

if (cliArguments.length < 1 || isNaN(parseInt(cliArguments[0]))) {
    console.error("SmartSheet sheet numeric id required.");
    process.exit(-1);
}

smartSheetDownload(parseInt(cliArguments[0])).then(outputPath => console.log(`Sheet written to ${outputPath}`)).catch(error => {
    console.error(error.message);
    process.exit(-1);
});
