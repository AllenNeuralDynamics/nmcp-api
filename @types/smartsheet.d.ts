declare module "smartsheet" {
    export type Cell = {
        columnId?: number;
        value: any;
        displayValue: string;
        formula?: string;
    }

    export type Column = {
        title: string;
        id: number;
        index?: number;
        type?: string;
        primary?: boolean;
        systemColumnType?: string;
        symbol?: string;
        options?: string[];
        validation?: boolean;
        formula?: string;
        description?: string;
        hidden?: boolean;
    }

    export type Row = {
        id?: number;
        parentId?: number;
        rowNumber?: number;
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
        getSheet(options: SheetOptions): Promise<Sheet>;
    }

    export type ClientOptions = {
        logLevel?: string;
        accessToken?: string;
    }

    export type Client = {
        sheets: Sheets;
    }

    export function createClient(options: ClientOptions): Client;
}
