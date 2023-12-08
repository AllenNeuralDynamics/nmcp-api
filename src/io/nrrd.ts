import * as fs from "fs";

const debug = require("debug")("mnb:transform:io:nrrd");

import {parseNrrd} from "./nrrdHeader";

export enum Endian {
    Unrecognized,
    Little,
    Big
}

export type SpaceSize = Array<number>[3];

/**
 * A wrapper for accessing scalar values from NRRD files where the file remains open for some period of time.
 *
 *  @remarks
 *  When accessing individual values repeatedly the cost of file open outweighs the seek/read for the value.  This class
 *  is for simple encapsulation of multiple random access events without multiple open/close calls.  It is somewhat
 *  targeted towards the variations of nrrd used in the Mouse Light transform and ontology files, and in some cases
 *  assumes the correctness/completeness of those files as it is not expected to be used with random NRRD files.
 */
export class NrrdFile {
    public dataFile: string;

    public endian: Endian;

    public size: SpaceSize;

    public dataType: string;

    public dataOffset: number;

    public totalCount: number;

    public typeSize: number;

    public isValid: boolean;

    private fileDescriptor: number;

    public get FileDescriptor(): number {
        return this.fileDescriptor;
    }

    public constructor(dataFile: string) {
        this.dataFile = dataFile;
    }

    public init() {
        this.fileDescriptor = fs.openSync(this.dataFile, "r");

        const buffer = new DataView(new ArrayBuffer(100000));

        fs.readSync(this.fileDescriptor, buffer, 0, 100000, 0);

        const parsedHeader = parseNrrd(buffer.buffer);

        // TODO Verify encoding is raw and other assumptions.

        this.size = parsedHeader.Header.sizes;

        this.totalCount = this.size[0] * this.size[1] * this.size[2];

        this.endian = parsedHeader.Header.endian === "little" ? Endian.Little : Endian.Big;

        this.dataType = parsedHeader.Header.type;

        this.typeSize = dataTypeSize(this.dataType);

        this.dataOffset = parsedHeader.DataStart;

        this.isValid = true;
    }

    public close() {
        fs.closeSync(this.fileDescriptor);

        this.isValid = false;
    }

    public findStructureId(x: number, y: number, z: number): number {
        if (!this.isValid) {
            return null;
        }

        const rowStride = (this.size[0] * this.size[1]);

        const offset = x +  (y * this.size[0]) + (z * rowStride);

        if (offset >= this.totalCount) {
            return null;
        }

        const buffer = new Uint8Array(this.typeSize);

        fs.readSync(this.fileDescriptor, buffer, 0, this.typeSize, this.dataOffset + (offset * this.typeSize));

        return parseRawValue(buffer, this.dataType, this.endian);
    }
}

const systemEndianness = getSystemEndianness();

function getSystemEndianness(): Endian {
    const buffer = new ArrayBuffer(4);
    const byteArray = new Uint8Array(buffer);
    const uintArray = new Uint32Array(buffer);

    uintArray[0] = 0x01020304;

    if (byteArray[0] == 1 && byteArray[1] == 2 && byteArray[2] == 3 && byteArray[3] == 4) {
        return Endian.Big;
    } else if (byteArray[0] == 4 && byteArray[1] == 3 && byteArray[2] == 2 && byteArray[3] == 1) {
        return Endian.Little;
    }

    return Endian.Unrecognized;
}

function dataTypeSize(type: string): number {
    switch (type) {
        case "int8":
        case "uint8":
            return 1;
        case "int16":
        case "uint16":
            return 2;
        case "int32":
        case "uint32":
        case "float":
            return 4;
        case "double":
            return 8;
        default:
            debug("unsupported type: " + type);
            return undefined;
    }
}

function parseRawValue(buffer: Uint8Array, type: string, endian: Endian): number {
    if (type == "int8" || type == "uint8" || endian == systemEndianness) {
        switch (type) {
            case "int8":
                return new Int8Array(buffer.buffer)[0];
            case "uint8":
                return new Uint8Array(buffer.buffer)[0];
            case "int16":
                return new Int16Array(buffer.buffer)[0];
            case "uint16":
                return new Uint16Array(buffer.buffer)[0];
            case "int32":
                return new Int32Array(buffer.buffer)[0];
            case "uint32":
                return new Uint32Array(buffer.buffer)[0];
            case "float":
                return new Float32Array(buffer.buffer)[0]
            case "double":
                return new Float64Array(buffer.buffer)[0];
            default:
                debug("unsupported type: " + type);
                return undefined;
        }
    } else {
        let endianFlag;

        switch (endian) {
            case Endian.Big:
                endianFlag = false;
                break;
            case Endian.Little:
                endianFlag = true;
                break;
            default:
                debug("unsupported endianness: " + endian);
                return undefined;
        }

        const view = new DataView(buffer.buffer);

        switch (type) {
            case "int8":
                return view.getInt8(0);
            case "uint8":
                return view.getUint8(0);
            case "int16":
                return view.getInt16(0, endianFlag);
            case "uint16":
                return view.getUint16(0, endianFlag);
            case "int32":
                return view.getInt32(0, endianFlag);
            case "uint32":
                return view.getUint32(0, endianFlag);
            case "float":
                return view.getFloat32(0, endianFlag);
            case "double":
                return view.getFloat64(0, endianFlag);
            default:
                debug("unsupported type: " + type);
                return undefined;
        }
    }
}
