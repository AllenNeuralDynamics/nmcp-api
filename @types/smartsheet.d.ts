export type Cell = {
    value: any;
    displayValue: string;
}

export type Column = {
    title: string;
    id: number;
}

export type Row = {
    cells: Cell[];
}

export type Sheet = {
    name: string;
    columns: Column[];
    rows: Row[];
}

export type SheetOptions = {
    id?: number;
}

export type Sheets = {
    getSheet(options: SheetOptions) : Promise<Sheet>;
}

export type ClientOptions = {
    logLevel?: string;
    accessToken?: string;
}

export type Client = {
    sheets: Sheets;
}

declare module "smartsheet" {
    export function createClient(options: ClientOptions): Client;
}
