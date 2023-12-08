// A modified subset of https://github.com/scijs/nrrd-js.  See https://github.com/scijs/nrrd-js/blob/master/LICENSE.

const lineSeparatorRE = /[ \f\t\v]*\r?\n/;
const NRRDMagicRE = /^NRRD\d{4}$/;
const lineRE = /^([^:]*)(:[ =])(.*)$/;
const dataFileListRE = /^LIST(?: (\d+))?$/;

export function parseNrrd(buffer: ArrayBuffer) {
    let i, header, dataStart, lines, match, match2, buf8 = new Uint8Array(buffer);

    const retFile = {
        Header: {
            endian: null,
            type: null,
            sizes: null,
            keys: {},
            version: null
        },
        DataStart: -1
    }

    // First find the separation between the header and the data (if there is one)
    // Note that we need to deal with with LF and CRLF as possible line endings.
    // Luckily this means the line always ends with LF, so we only need to consider
    // LFLF and LFCRLF as patterns for the separating empty line.
    i = 2; // It is safe to start at position 2 (in fact, we could start even later), as the file HAS to start with a magic word.
    while (i < buf8.length) {
        if (buf8[i] == 10) { // We hit an LF
            if (buf8[i - 1] == 10 || (buf8[i - 1] == 13 && buf8[i - 2] == 10)) { // Safe because we start at position 2 and never move backwards
                dataStart = i + 1;
                break;
            } else {
                i++; // Move forward just once
            }
        } else if (buf8[i] == 13) { // We hit a CR
            i++; // Move forward just once
        } else {
            i += 2; // Move forward two places,
        }
    }

    // Now split up the header and data
    if (dataStart === undefined) {
        header = String.fromCharCode.apply(null, buf8);
    } else {
        retFile.DataStart= dataStart;
        header = String.fromCharCode.apply(null, buf8.subarray(0, dataStart));
    }

    // Split header into lines, remove comments (and blank lines) and check magic.
    // All remaining lines except the first should be field specifications or key/value pairs.
    // TODO: This explicitly removes any whitespace at the end of lines, however, I am not sure that this is actually desired behaviour for all kinds of lines.
    lines = header.split(lineSeparatorRE);
    lines = lines.filter(function (l) {
        return l.length > 0 && l[0] != '#';
    }); // Remove comment lines
    if (!NRRDMagicRE.test(lines[0])) {
        throw new Error("File is not an NRRD file!");
    }
    retFile.Header.version = parseInt(lines[0].substring(4, 8), 10);
    if (retFile.Header.version > 5) {
        console.warn("Reading an unsupported version of the NRRD format; things may go haywire.");
    }

    // Parse lines
    for (i = 1; i < lines.length; i++) {
        match = lineRE.exec(lines[i]);
        if (!match) {
            console.warn("Unrecognized line in NRRD header: " + lines[i]);
            continue;
        }
        if (match[2] == ': ') { // Field specification
            match[1] = mapNRRDToJavascript(match[1]);
            if (match[1] == 'dataFile' &&
                (match2 = dataFileListRE.exec(match[3]))) {
                // This should be the last field specification,
                // and the rest of the lines should contain file names.
                if (match2.length == 2 && match2[1]) { // subdim specification
                    retFile.Header[match[1]] = {
                        files: lines.slice(i + 1),
                        subdim: parseNRRDInteger(match2[1])
                    };
                } else {
                    retFile.Header[match[1]] = lines.slice(i + 1);
                }
                lines.length = i;
            } else {
                retFile.Header[match[1]] = parseField(match[1], match[3]);
            }
        } else if (match[2] == ':=') { // Key/value pair
            retFile.Header.keys[match[1]] = unescapeValue(match[3]);
        } else {
            throw new Error("Logic error in NRRD parser."); // This should never happen (unless the NRRD syntax is extended and the regexp is updated, but this section is not, or some other programmer error).
        }
    }

    // Make sure the file satisfies the requirements of the NRRD format
    checkNRRD(retFile.Header);

    return retFile;
}

function unescapeValue(val) {
    return val.split('\\\\').map(
        function (s) {
            return s.replace('\\n', '\n');
        }
    ).join('\\');
}

// Parses and normalizes NRRD fields, assumes the field names are already lower case.
function parseField(identifier, descriptor) {
    switch (identifier) {
        // Literal (uninterpreted) fields
        case "content":
        case "number":
        case "sampleUnits":
            break;
        // Integers
        case "dimension":
        case "blockSize":
        case "lineSkip":
        case "byteSkip":
        case "spaceDimension":
            descriptor = parseNRRDInteger(descriptor);
            break;
        // Floats
        case "min":
        case "max":
        case "oldMin":
        case "oldMax":
            descriptor = parseNRRDFloat(descriptor);
            break;
        // Vectors
        case "spaceOrigin":
            descriptor = parseNRRDVector(descriptor);
            break;
        // Lists of strings
        case "labels":
        case "units":
        case "spaceUnits":
            descriptor = parseNRRDWhitespaceSeparatedList(descriptor, parseNRRDQuotedString);
            break;
        // Lists of integers
        case "sizes":
            descriptor = parseNRRDWhitespaceSeparatedList(descriptor, parseNRRDInteger);
            break;
        // Lists of floats
        case "spacings":
        case "thicknesses":
        case "axisMins":
        case "axisMaxs":
            descriptor = parseNRRDWhitespaceSeparatedList(descriptor, parseNRRDFloat);
            break;
        // Lists of vectors
        case "spaceDirections":
        case "measurementFrame":
            descriptor = parseNRRDWhitespaceSeparatedList(descriptor, parseNRRDVector);
            break;
        // One-of-a-kind fields
        case "type":
            descriptor = parseNRRDType(descriptor);
            break;
        case "encoding":
            descriptor = parseNRRDEncoding(descriptor);
            break;
        case "endian":
            descriptor = parseNRRDEndian(descriptor);
            break;
        case "dataFile":
            descriptor = parseNRRDDataFile(descriptor);
            break;
        case "centers":
            descriptor = parseNRRDWhitespaceSeparatedList(descriptor, parseNRRDCenter);
            break;
        case "kinds":
            descriptor = parseNRRDWhitespaceSeparatedList(descriptor, parseNRRDKind);
            break;
        case "space":
            descriptor = parseNRRDSpace(descriptor);
            break;
        // Something unknown
        default:
            console.warn("Unrecognized NRRD field: " + identifier);
    }
    return descriptor;
}

// This only includes names whose lower case form is different from the Javascript form.
const mapNRRDToJavascriptStatic = {
    "block size": "blockSize",
    "blocksize": "blockSize",
    "old min": "oldMin",
    "oldmin": "oldMin",
    "old max": "oldMax",
    "oldmax": "oldMax",
    "data file": "dataFile",
    "datafile": "dataFile",
    "line skip": "lineSkip",
    "lineskip": "lineSkip",
    "byte skip": "byteSkip",
    "byteskip": "byteSkip",
    "sample units": "sampleUnits",
    "sampleunits": "sampleUnits",
    "axis mins": "axisMins",
    "axis maxs": "axisMaxs",
    "centers": "centers", // Not different, just included so it is clear why centerings maps to centers
    "centerings": "centers",
    "space dimension": "spaceDimension",
    "space units": "spaceUnits",
    "space origin": "spaceOrigin",
    "space directions": "spaceDirections",
    "measurement frame": "measurementFrame"
};

function mapNRRDToJavascript(id) {
    // In any case, use the lower case version of the id
    id = id.toLowerCase();
    // Filter out any fields for which we have an explicit Javascript name
    if (id in mapNRRDToJavascriptStatic) return mapNRRDToJavascriptStatic[id];
    // Otherwise, just return the (lower case) id
    return id;
}

function parseNRRDInteger(str) {
    const val = parseInt(str, 10);
    if (Number.isNaN(val)) throw new Error("Malformed NRRD integer: " + str);
    return val;
}

function parseNRRDFloat(str) {
    str = str.toLowerCase();
    if (str.indexOf("nan") >= 0) return NaN;
    if (str.indexOf("-inf") >= 0) return -Infinity;
    if (str.indexOf("inf") >= 0) return Infinity;
    const val = parseFloat(str);
    if (Number.isNaN(val)) throw new Error("Malformed NRRD float: " + str);
    return val;
}

function parseNRRDVector(str) {
    if (str == "none") return null;
    if (str.length < 2 || str[0] !== "(" || str[str.length - 1] !== ")") throw new Error("Malformed NRRD vector: " + str);
    return str.slice(1, -1).split(",").map(parseNRRDFloat);
}

function parseNRRDQuotedString(str) {
    if (str.length < 2 || str[0] != '"' || str[str.length - 1] != '"') {
        throw new Error("Invalid NRRD quoted string: " + str);
    }
    return str.slice(1, -1).replace('\\"', '"');
}

const whitespaceListSeparator = /[ \t]+/; // Note that this excludes other types of whitespace on purpose!

function parseNRRDWhitespaceSeparatedList(str, parseElement) {
    return str.split(whitespaceListSeparator).map(parseElement);
}

function parseNRRDType(descriptor) {
    switch (descriptor.toLowerCase()) {
        case "signed char":
        case "int8":
        case "int8_t":
            return "int8";
        case "uchar":
        case "unsigned char":
        case "uint8":
        case "uint8_t":
            return "uint8";
        case "short":
        case "short int":
        case "signed short":
        case "signed short int":
        case "int16":
        case "int16_t":
            return "int16";
        case "ushort":
        case "unsigned short":
        case "unsigned short int":
        case "uint16":
        case "uint16_t":
            return "uint16";
        case "int":
        case "signed int":
        case "int32":
        case "int32_t":
            return "int32";
        case "uint":
        case "unsigned int":
        case "uint32":
        case "uint32_t":
            return "uint32";
        case "longlong":
        case "long long":
        case "long long int":
        case "signed long long":
        case "signed long long int":
        case "int64":
        case "int64_t":
            return "int64";
        case "ulonglong":
        case "unsigned long long":
        case "unsigned long long int":
        case "uint64":
        case "uint64_t":
            return "uint64";
        case "float":
            return "float";
        case "double":
            return "double";
        case "block":
            return "block";
        default:
            console.warn("Unrecognized NRRD type: " + descriptor);
            return descriptor;
    }
}

function parseNRRDEncoding(encoding) {
    switch (encoding.toLowerCase()) {
        case "raw":
            return "raw";
        case "txt":
        case "text":
        case "ascii":
            return "ascii";
        case "hex":
            return "hex";
        case "gz":
        case "gzip":
            return "gzip";
        case "bz2":
        case "bzip2":
            return "bzip2";
        default:
            console.warn("Unrecognized NRRD encoding: " + encoding);
            return encoding;
    }
}

function parseNRRDSpace(space) {
    switch (space.toLowerCase()) {
        case "right-anterior-superior":
        case "ras":
            return "right-anterior-superior";
        case "left-anterior-superior":
        case "las":
            return "left-anterior-superior";
        case "left-posterior-superior":
        case "lps":
            return "left-posterior-superior";
        case "right-anterior-superior-time":
        case "rast":
            return "right-anterior-superior-time";
        case "left-anterior-superior-time":
        case "last":
            return "left-anterior-superior-time";
        case "left-posterior-superior-time":
        case "lpst":
            return "left-posterior-superior-time";
        case "scanner-xyz":
            return "scanner-xyz";
        case "scanner-xyz-time":
            return "scanner-xyz-time";
        case "3d-right-handed":
            return "3D-right-handed";
        case "3d-left-handed":
            return "3D-left-handed";
        case "3d-right-handed-time":
            return "3D-right-handed-time";
        case "3d-left-handed-time":
            return "3D-left-handed-time";
        default:
            console.warn("Unrecognized space: " + space);
            return space;
    }
}

function parseNRRDEndian(endian) {
    switch (endian.toLowerCase()) {
        case "little":
            return "little";
        case "big":
            return "big";
        default:
            console.warn("Unrecognized NRRD endianness: " + endian);
            return endian;
    }
}

// Note that this function will never encounter the LIST data file specification format, as this is handled elsewhere.
const dataFileFormatRE = / (-?\d+) (-?\d+) (-?\d+)(?: (\d+))?$/;

function parseNRRDDataFile(dataFile) {
    const match = dataFileFormatRE.exec(dataFile);
    if (match) { // We have a format specification
        if (match.length == 5 && match[4]) { // subdim specification
            return {
                format: dataFile.substring(0, match.index),
                min: parseNRRDInteger(match[1]),
                max: parseNRRDInteger(match[2]),
                step: parseNRRDInteger(match[3]),
                subdim: parseNRRDInteger(match[4])
            };
        } else {
            return {
                format: dataFile.substring(0, match.index),
                min: parseNRRDInteger(match[1]),
                max: parseNRRDInteger(match[2]),
                step: parseNRRDInteger(match[3])
            };
        }
    } else { // Just a file
        return dataFile;
    }
}

function parseNRRDCenter(center) {
    switch (center.toLowerCase()) {
        case "cell":
            return "cell";
        case "node":
            return "node";
        case "???":
        case "none":
            return null;
        default:
            console.warn("Unrecognized NRRD center: " + center);
            return center;
    }
}

const NRRDKinds = {
    "domain": "domain",
    "space": "space",
    "time": "time",
    "list": "list",
    "point": "point",
    "vector": "vector",
    "covariant-vector": "covariant-vector",
    "normal": "normal",
    "stub": "stub",
    "scalar": "scalar",
    "complex": "complex",
    "2-vector": "2-vector",
    "3-color": "3-color",
    "rgb-color": "RGB-color",
    "hsv-color": "HSV-color",
    "xyz-color": "XYZ-color",
    "4-color": "4-color",
    "rgba-color": "RGBA-color",
    "3-vector": "3-vector",
    "3-gradient": "3-gradient",
    "3-normal": "3-normal",
    "4-vector": "4-vector",
    "quaternion": "quaternion",
    "2d-symmetric-matrix": "2D-symmetric-matrix",
    "2d-masked-symmetric-matrix": "2D-masked-symmetric-matrix",
    "2d-matrix": "2D-matrix",
    "2d-masked-matrix": "2D-masked-matrix",
    "3d-symmetric-matrix": "3D-symmetric-matrix",
    "3d-masked-symmetric-matrix": "3D-masked-symmetric-matrix",
    "3d-matrix": "3D-matrix",
    "3d-masked-matrix": "3D-masked-matrix",
    "???": null,
    "none": null
};

function parseNRRDKind(kind) {
    const kindLC = kind.toLowerCase();
    if (kindLC in NRRDKinds) return NRRDKinds[kindLC];
    console.warn("Unrecognized NRRD kind: " + kind);
    return kind;
}

function checkNRRD(ret) {
    // Always necessary fields
    if (ret.dimension === undefined) {
        throw new Error("Dimension missing from NRRD file!");
    } else if (ret.type === undefined) {
        throw new Error("Type missing from NRRD file!");
    } else if (ret.encoding === undefined) {
        throw new Error("Encoding missing from NRRD file!");
    } else if (ret.sizes === undefined) {
        throw new Error("Sizes missing from NRRD file!");
    }

    // Sometimes necessary fields
    if (ret.type != "block" && ret.type != "int8" && ret.type != "uint8" &&
        ret.encoding != "ascii" && ret.endian === undefined) {
        throw new Error("Endianness missing from NRRD file!");
    } else if (ret.type == "block" && ret.blockSize === undefined) {
        throw new Error("Missing block size in NRRD file!");
    }

    // Check dimension and per-axis field lengths
    if (ret.dimension === 0) {
        throw new Error("Zero-dimensional NRRD file?");
    } else if (ret.dimension != ret.sizes.length) {
        throw new Error("Length of 'sizes' is different from 'dimension' in an NRRD file!");
    } else if (ret.spacings && ret.dimension != ret.spacings.length) {
        throw new Error("Length of 'spacings' is different from 'dimension' in an NRRD file!");
    } else if (ret.thicknesses && ret.dimension != ret.thicknesses.length) {
        throw new Error("Length of 'thicknesses' is different from 'dimension' in an NRRD file!");
    } else if (ret.axisMins && ret.dimension != ret.axisMins.length) {
        throw new Error("Length of 'axis mins' is different from 'dimension' in an NRRD file!");
    } else if (ret.axisMaxs && ret.dimension != ret.axisMaxs.length) {
        throw new Error("Length of 'axis maxs' is different from 'dimension' in an NRRD file!");
    } else if (ret.centers && ret.dimension != ret.centers.length) {
        throw new Error("Length of 'centers' is different from 'dimension' in an NRRD file!");
    } else if (ret.labels && ret.dimension != ret.labels.length) {
        throw new Error("Length of 'labels' is different from 'dimension' in an NRRD file!");
    } else if (ret.units && ret.dimension != ret.units.length) {
        throw new Error("Length of 'units' is different from 'dimension' in an NRRD file!");
    } else if (ret.kinds && ret.dimension != ret.kinds.length) {
        throw new Error("Length of 'kinds' is different from 'dimension' in an NRRD file!");
    }
}
