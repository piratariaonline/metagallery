/* MetaGallery – format-aware metadata read/write
 * Supported:
 *   - JPEG  (EXIF via piexifjs + Microsoft XP* tags for Windows compatibility)
 *   - PNG   (tEXt/iTXt chunks + eXIf chunk for full EXIF/GPS)
 *   - WebP  (RIFF EXIF chunk + XMP chunk; auto-promotes to VP8X if needed)
 *
 * All readers/writers return / accept the same canonical "values" object:
 *   {
 *     ImageDescription, Artist, Copyright, Software, Make, Model,
 *     DateTimeOriginal,  // "YYYY-MM-DDTHH:MM:SS"
 *     UserComment,
 *     GPSLatitude, GPSLongitude, GPSAltitude   // numbers or '' (empty)
 *   }
 */
/* global piexif */

export const EMPTY_VALUES = {
    ImageDescription: '', Artist: '', Copyright: '', Software: '',
    Make: '', Model: '', DateTimeOriginal: '', UserComment: '',
    GPSLatitude: '', GPSLongitude: '', GPSAltitude: ''
};

export function detectFormat(file) {
    const t = (file.type || '').toLowerCase();
    const n = file.name.toLowerCase();
    if (t === 'image/jpeg' || /\.jpe?g$/.test(n)) return 'jpeg';
    if (t === 'image/png'  || /\.png$/.test(n))   return 'png';
    if (t === 'image/webp' || /\.webp$/.test(n))  return 'webp';
    return 'unknown';
}

export function isWritable(file) {
    return detectFormat(file) !== 'unknown';
}

/* ============================================================
 * Public API
 * ============================================================ */

export async function readMetadata(file) {
    const fmt = detectFormat(file);
    const buf = new Uint8Array(await file.arrayBuffer());
    try {
        if (fmt === 'jpeg') return readJpeg(buf);
        if (fmt === 'png')  return readPng(buf);
        if (fmt === 'webp') return readWebp(buf);
    } catch (e) {
        console.warn('readMetadata error', fmt, e);
    }
    return { ...EMPTY_VALUES };
}

export async function writeMetadata(file, values) {
    const fmt = detectFormat(file);
    const buf = new Uint8Array(await file.arrayBuffer());
    if (fmt === 'jpeg') return writeJpeg(buf, values);
    if (fmt === 'png')  return writePng(buf, values);
    if (fmt === 'webp') return writeWebp(buf, values);
    throw new Error('Unsupported format: ' + (file.type || file.name));
}

/* ============================================================
 * Helpers — binary string <-> Uint8Array (piexif speaks binary strings)
 * ============================================================ */
function bytesToBinaryString(bytes) {
    let s = ''; const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return s;
}
function binaryStringToBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

/* UTF-16LE encode a string, terminated by 0x0000, returned as Array<number>
 * (BYTE array as expected by piexif for XP* tags).            */
function utf16LeBytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        out.push(c & 0xff, (c >> 8) & 0xff);
    }
    out.push(0, 0); // null terminator
    return out;
}
function utf16LeDecode(bytes) {
    if (!bytes || !bytes.length) return '';
    let s = '';
    const len = bytes.length - (bytes.length % 2);
    for (let i = 0; i < len; i += 2) {
        const c = bytes[i] | (bytes[i + 1] << 8);
        if (c === 0) break;
        s += String.fromCharCode(c);
    }
    return s;
}

function exifDateToInput(s) {
    if (!s) return '';
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : '';
}
function inputToExifDate(s) {
    if (!s) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
    return m ? `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}` : '';
}

function decodeUserComment(v) {
    if (!v) return '';
    if (typeof v === 'string') {
        if (/^(ASCII|UNICODE|JIS)\0/.test(v)) return v.slice(8);
        // strip trailing nulls/spaces
        return v.replace(/[\u0000\s]+$/, '');
    }
    if (Array.isArray(v)) {
        // could be byte array; assume ASCII after 8-byte header
        const head = String.fromCharCode(...v.slice(0, 8));
        if (/^(ASCII|UNICODE|JIS)/.test(head)) {
            return String.fromCharCode(...v.slice(8)).replace(/\0+$/, '');
        }
        return String.fromCharCode(...v).replace(/\0+$/, '');
    }
    return '';
}

/* ============================================================
 * EXIF dictionary <-> values  (shared by JPEG / PNG-eXIf / WebP)
 * ============================================================ */
function emptyExif() {
    return { '0th': {}, 'Exif': {}, 'GPS': {}, 'Interop': {}, '1st': {}, 'thumbnail': null };
}

function exifToValues(exifObj) {
    const z   = exifObj['0th']  || {};
    const ex  = exifObj['Exif'] || {};
    const gps = exifObj['GPS']  || {};
    const out = { ...EMPTY_VALUES };

    // Prefer XPTitle (Windows) over ImageDescription if present
    const xpTitle   = utf16LeDecode(z[piexif.ImageIFD.XPTitle]);
    const xpComment = utf16LeDecode(z[piexif.ImageIFD.XPComment]);
    const xpAuthor  = utf16LeDecode(z[piexif.ImageIFD.XPAuthor]);

    out.ImageDescription = xpTitle || z[piexif.ImageIFD.ImageDescription] || '';
    out.Artist           = xpAuthor || z[piexif.ImageIFD.Artist] || '';
    out.Copyright        = z[piexif.ImageIFD.Copyright] || '';
    out.Software         = z[piexif.ImageIFD.Software]  || '';
    out.Make             = z[piexif.ImageIFD.Make]      || '';
    out.Model            = z[piexif.ImageIFD.Model]     || '';
    out.DateTimeOriginal = exifDateToInput(
        ex[piexif.ExifIFD.DateTimeOriginal] || z[piexif.ImageIFD.DateTime] || ''
    );
    out.UserComment      = xpComment || decodeUserComment(ex[piexif.ExifIFD.UserComment]);

    try {
        if (gps[piexif.GPSIFD.GPSLatitude] && gps[piexif.GPSIFD.GPSLatitudeRef]) {
            out.GPSLatitude = piexif.GPSHelper.dmsRationalToDeg(
                gps[piexif.GPSIFD.GPSLatitude], gps[piexif.GPSIFD.GPSLatitudeRef]);
        }
        if (gps[piexif.GPSIFD.GPSLongitude] && gps[piexif.GPSIFD.GPSLongitudeRef]) {
            out.GPSLongitude = piexif.GPSHelper.dmsRationalToDeg(
                gps[piexif.GPSIFD.GPSLongitude], gps[piexif.GPSIFD.GPSLongitudeRef]);
        }
        if (gps[piexif.GPSIFD.GPSAltitude]) {
            const r = gps[piexif.GPSIFD.GPSAltitude];
            let alt = r[0] / r[1];
            if (gps[piexif.GPSIFD.GPSAltitudeRef] === 1) alt = -alt;
            out.GPSAltitude = alt;
        }
    } catch (e) { console.warn('GPS parse error', e); }
    return out;
}

function valuesToExif(values, baseExif) {
    const exifObj = baseExif || emptyExif();
    exifObj['0th']  = exifObj['0th']  || {};
    exifObj['Exif'] = exifObj['Exif'] || {};
    exifObj['GPS']  = exifObj['GPS']  || {};
    const z = exifObj['0th'], ex = exifObj['Exif'], gps = exifObj['GPS'];

    // --- ASCII/standard tags ---
    setOrDel(z,  piexif.ImageIFD.ImageDescription, values.ImageDescription);
    setOrDel(z,  piexif.ImageIFD.Artist,           values.Artist);
    setOrDel(z,  piexif.ImageIFD.Copyright,        values.Copyright);
    setOrDel(z,  piexif.ImageIFD.Software,         values.Software);
    setOrDel(z,  piexif.ImageIFD.Make,             values.Make);
    setOrDel(z,  piexif.ImageIFD.Model,            values.Model);

    // --- Microsoft Windows XP tags (UTF-16LE byte arrays) ---
    setXp(z, piexif.ImageIFD.XPTitle,   values.ImageDescription);
    setXp(z, piexif.ImageIFD.XPAuthor,  values.Artist);
    setXp(z, piexif.ImageIFD.XPComment, values.UserComment);
    setXp(z, piexif.ImageIFD.XPSubject, values.ImageDescription); // mirror title->subject
    // (XPKeywords could be wired to a future tags field)

    // --- Date taken ---
    if (values.DateTimeOriginal) {
        const ed = inputToExifDate(values.DateTimeOriginal);
        ex[piexif.ExifIFD.DateTimeOriginal]  = ed;
        ex[piexif.ExifIFD.DateTimeDigitized] = ed;
        z[piexif.ImageIFD.DateTime]          = ed;
    } else {
        delete ex[piexif.ExifIFD.DateTimeOriginal];
        delete ex[piexif.ExifIFD.DateTimeDigitized];
        delete z[piexif.ImageIFD.DateTime];
    }

    // --- UserComment (EXIF, ASCII charset header) ---
    if (values.UserComment) {
        ex[piexif.ExifIFD.UserComment] = 'ASCII\0\0\0' + values.UserComment;
    } else {
        delete ex[piexif.ExifIFD.UserComment];
    }

    // --- GPS ---
    const lat = parseFloat(values.GPSLatitude);
    const lon = parseFloat(values.GPSLongitude);
    const alt = values.GPSAltitude === '' || values.GPSAltitude == null
        ? null : parseFloat(values.GPSAltitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        gps[piexif.GPSIFD.GPSLatitudeRef]  = lat >= 0 ? 'N' : 'S';
        gps[piexif.GPSIFD.GPSLatitude]     = piexif.GPSHelper.degToDmsRational(Math.abs(lat));
        gps[piexif.GPSIFD.GPSLongitudeRef] = lon >= 0 ? 'E' : 'W';
        gps[piexif.GPSIFD.GPSLongitude]    = piexif.GPSHelper.degToDmsRational(Math.abs(lon));
        gps[piexif.GPSIFD.GPSVersionID]    = [2, 3, 0, 0];
    } else {
        delete gps[piexif.GPSIFD.GPSLatitude];
        delete gps[piexif.GPSIFD.GPSLatitudeRef];
        delete gps[piexif.GPSIFD.GPSLongitude];
        delete gps[piexif.GPSIFD.GPSLongitudeRef];
    }
    if (Number.isFinite(alt)) {
        gps[piexif.GPSIFD.GPSAltitudeRef] = alt < 0 ? 1 : 0;
        gps[piexif.GPSIFD.GPSAltitude]    = [Math.round(Math.abs(alt) * 100), 100];
    } else {
        delete gps[piexif.GPSIFD.GPSAltitude];
        delete gps[piexif.GPSIFD.GPSAltitudeRef];
    }
    return exifObj;
}

function setOrDel(obj, key, val) {
    if (val == null || val === '') delete obj[key];
    else obj[key] = String(val);
}
function setXp(obj, key, val) {
    if (val == null || val === '') delete obj[key];
    else obj[key] = utf16LeBytes(String(val));
}

/* ============================================================
 * JPEG
 * ============================================================ */
function readJpeg(bytes) {
    const bin = bytesToBinaryString(bytes);
    let exifObj;
    try { exifObj = piexif.load(bin); } catch { exifObj = emptyExif(); }
    return exifToValues(exifObj);
}

function writeJpeg(bytes, values) {
    const bin = bytesToBinaryString(bytes);
    let exifObj;
    try { exifObj = piexif.load(bin); } catch { exifObj = emptyExif(); }
    valuesToExif(values, exifObj);
    const exifBin = piexif.dump(exifObj);
    const newBin  = piexif.insert(exifBin, bin);
    return new Blob([binaryStringToBytes(newBin)], { type: 'image/jpeg' });
}

/* ============================================================
 * PNG
 * Spec: 8-byte signature + chunks (length BE, type, data, CRC32 of type+data)
 * Standard text keywords used here:
 *   Title, Author, Copyright, Description, Software, Comment, Creation Time
 * Plus an `eXIf` chunk to carry full EXIF (incl. GPS, Make/Model).
 * ============================================================ */
const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

const _crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function* iterPngChunks(bytes) {
    let p = 8;
    while (p < bytes.length) {
        const len = (bytes[p] << 24) | (bytes[p+1] << 16) | (bytes[p+2] << 8) | bytes[p+3];
        const type = String.fromCharCode(bytes[p+4], bytes[p+5], bytes[p+6], bytes[p+7]);
        const dataStart = p + 8;
        const dataEnd   = dataStart + (len >>> 0);
        yield { type, start: p, dataStart, dataEnd, end: dataEnd + 4, length: len >>> 0 };
        if (type === 'IEND') break;
        p = dataEnd + 4;
    }
}

function buildPngChunk(type, data) {
    const typeBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
    const len = data.length;
    const out = new Uint8Array(4 + 4 + len + 4);
    out[0] = (len >>> 24) & 0xff; out[1] = (len >>> 16) & 0xff;
    out[2] = (len >>> 8)  & 0xff; out[3] =  len         & 0xff;
    out.set(typeBytes, 4);
    out.set(data, 8);
    const crcInput = new Uint8Array(4 + len);
    crcInput.set(typeBytes, 0); crcInput.set(data, 4);
    const c = crc32(crcInput);
    out[8 + len]     = (c >>> 24) & 0xff;
    out[8 + len + 1] = (c >>> 16) & 0xff;
    out[8 + len + 2] = (c >>> 8)  & 0xff;
    out[8 + len + 3] =  c         & 0xff;
    return out;
}

const PNG_KEY_MAP = {
    Title:           'ImageDescription',
    Description:     'ImageDescription',
    Author:          'Artist',
    Copyright:       'Copyright',
    Software:        'Software',
    Comment:         'UserComment',
    'Creation Time': 'DateTimeOriginal'
};
const PNG_OUT_KEYS = {
    ImageDescription: 'Title',
    Artist:           'Author',
    Copyright:        'Copyright',
    Software:         'Software',
    UserComment:      'Comment',
    DateTimeOriginal: 'Creation Time'
};

function decodeLatin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}
function encodeLatin1Safe(str) {
    // Latin-1 supports U+0000..U+00FF; for higher chars we'll fall back to iTXt.
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c > 0xff) return null;
        out[i] = c;
    }
    return out;
}
function isAscii(str) {
    for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) > 0x7f) return false;
    return true;
}
function utf8Encode(str) { return new TextEncoder().encode(str); }
function utf8Decode(bytes) { return new TextDecoder('utf-8').decode(bytes); }

function readPng(bytes) {
    const sig = bytes.subarray(0, 8);
    for (let i = 0; i < 8; i++) if (sig[i] !== PNG_SIG[i]) throw new Error('Not a PNG');

    const values = { ...EMPTY_VALUES };
    let exifFromChunk = null;

    for (const ch of iterPngChunks(bytes)) {
        if (ch.type === 'tEXt') {
            const data = bytes.subarray(ch.dataStart, ch.dataEnd);
            const zero = data.indexOf(0);
            if (zero < 0) continue;
            const key  = decodeLatin1(data.subarray(0, zero));
            const text = decodeLatin1(data.subarray(zero + 1));
            mapPngTextField(values, key, text);
        } else if (ch.type === 'iTXt') {
            const data = bytes.subarray(ch.dataStart, ch.dataEnd);
            // keyword\0 cflag(1) cmethod(1) lang\0 transKw\0 text
            const z1 = data.indexOf(0); if (z1 < 0) continue;
            const key = decodeLatin1(data.subarray(0, z1));
            const cflag = data[z1 + 1];
            // skip cmethod at z1+2
            let p = z1 + 3;
            const z2 = data.indexOf(0, p); if (z2 < 0) continue;
            // lang = data[p..z2]
            const z3 = data.indexOf(0, z2 + 1); if (z3 < 0) continue;
            // translatedKeyword = data[z2+1..z3]
            let textBytes = data.subarray(z3 + 1);
            if (cflag === 1) {
                // compressed; we don't decompress here (rare for our keys)
                continue;
            }
            const text = utf8Decode(textBytes);
            if (key === 'XML:com.adobe.xmp') {
                applyXmpToValues(text, values);
            } else {
                mapPngTextField(values, key, text);
            }
        } else if (ch.type === 'eXIf') {
            exifFromChunk = bytes.subarray(ch.dataStart, ch.dataEnd);
        }
    }

    if (exifFromChunk) {
        try {
            const bin = 'Exif\0\0' + bytesToBinaryString(exifFromChunk);
            const exifObj = piexif.load(bin);
            const ev = exifToValues(exifObj);
            // EXIF chunk takes precedence for fields it provides
            for (const k of Object.keys(ev)) {
                if (ev[k] !== '' && ev[k] != null) values[k] = ev[k];
            }
        } catch (e) { console.warn('eXIf parse failed', e); }
    }
    return values;
}

function mapPngTextField(values, key, text) {
    const target = PNG_KEY_MAP[key];
    if (!target) return;
    if (target === 'DateTimeOriginal') {
        // PNG "Creation Time" is RFC 1123 ideally, but often ISO. Try both.
        const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
        if (iso) {
            values.DateTimeOriginal =
                `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6] || '00'}`;
            return;
        }
        const d = new Date(text);
        if (!isNaN(d.valueOf())) {
            const pad = n => String(n).padStart(2, '0');
            values.DateTimeOriginal =
                `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }
    } else if (!values[target]) {
        values[target] = text;
    }
}

function writePng(bytes, values) {
    const sig = bytes.subarray(0, 8);
    for (let i = 0; i < 8; i++) if (sig[i] !== PNG_SIG[i]) throw new Error('Not a PNG');

    // Collect chunks, dropping ones we'll regenerate (text/exif).
    const keptHead = [];   // before IDAT
    const keptTail = [];   // IDAT and after, up to & including IEND
    let seenIDAT = false;
    const dropTextKeys = new Set([...Object.keys(PNG_KEY_MAP), 'XML:com.adobe.xmp']);

    for (const ch of iterPngChunks(bytes)) {
        const chunkBytes = bytes.subarray(ch.start, ch.end);
        if (ch.type === 'IDAT') seenIDAT = true;
        if (ch.type === 'eXIf') continue;
        if (ch.type === 'tEXt' || ch.type === 'iTXt' || ch.type === 'zTXt') {
            const data = bytes.subarray(ch.dataStart, ch.dataEnd);
            const zero = data.indexOf(0);
            if (zero >= 0) {
                const key = decodeLatin1(data.subarray(0, zero));
                if (dropTextKeys.has(key)) continue;
            }
        }
        (seenIDAT ? keptTail : keptHead).push(chunkBytes);
    }

    // Build new tEXt / iTXt chunks for the standard PNG keywords (used by some tools)
    const textChunks = [];
    for (const [valKey, pngKey] of Object.entries(PNG_OUT_KEYS)) {
        let text = values[valKey];
        if (text == null || text === '') continue;
        if (valKey === 'DateTimeOriginal') {
            const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
            text = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : text;
        }
        const latin = isAscii(text) ? encodeLatin1Safe(text) : null;
        if (latin) {
            const keyB = encodeLatin1Safe(pngKey);
            const data = new Uint8Array(keyB.length + 1 + latin.length);
            data.set(keyB, 0); data[keyB.length] = 0; data.set(latin, keyB.length + 1);
            textChunks.push(buildPngChunk('tEXt', data));
        } else {
            const keyB = encodeLatin1Safe(pngKey);
            const txtB = utf8Encode(text);
            const data = new Uint8Array(keyB.length + 1 + 1 + 1 + 0 + 1 + 0 + 1 + txtB.length);
            let p = 0;
            data.set(keyB, p); p += keyB.length; data[p++] = 0;
            data[p++] = 0; data[p++] = 0;          // not compressed, method 0
            data[p++] = 0;                         // empty language
            data[p++] = 0;                         // empty translated keyword
            data.set(txtB, p);
            textChunks.push(buildPngChunk('iTXt', data));
        }
    }

    // XMP packet as iTXt with the special keyword — this is what Windows Explorer reads.
    const xmpStr = buildXmpPacket(values);
    if (xmpStr) {
        const keyword = 'XML:com.adobe.xmp';
        const keyB = encodeLatin1Safe(keyword);
        const txtB = utf8Encode(xmpStr);
        const data = new Uint8Array(keyB.length + 1 + 1 + 1 + 0 + 1 + 0 + 1 + txtB.length);
        let p = 0;
        data.set(keyB, p); p += keyB.length; data[p++] = 0;
        data[p++] = 0; data[p++] = 0;          // uncompressed
        data[p++] = 0;                         // empty language
        data[p++] = 0;                         // empty translated keyword
        data.set(txtB, p);
        textChunks.push(buildPngChunk('iTXt', data));
    }

    // Build eXIf chunk for full EXIF (GPS, Make, Model, dates...)
    const exifObj = valuesToExif(values, emptyExif());
    let exifChunk = null;
    try {
        const exifBin = piexif.dump(exifObj);
        const tiff = binaryStringToBytes(exifBin.slice(6));
        if (tiff.length > 0 && hasAnyMeaningfulExif(exifObj)) {
            exifChunk = buildPngChunk('eXIf', tiff);
        }
    } catch (e) { console.warn('eXIf build failed', e); }

    const parts = [new Uint8Array(PNG_SIG), ...keptHead, ...textChunks];
    if (exifChunk) parts.push(exifChunk);
    parts.push(...keptTail);

    return new Blob(parts, { type: 'image/png' });
}

function hasAnyMeaningfulExif(exifObj) {
    const ifds = ['0th', 'Exif', 'GPS'];
    for (const k of ifds) {
        const o = exifObj[k];
        if (o && Object.keys(o).length > 0) return true;
    }
    return false;
}

/* ============================================================
 * WebP
 * RIFF: "RIFF" <size:LE32> "WEBP" <chunks>
 * Each chunk: <FourCC:4> <size:LE32> <data> [pad byte if size odd]
 * Extended file uses a "VP8X" chunk first; flags byte: bit3 EXIF, bit2 XMP.
 * ============================================================ */
function readU32LE(b, p) { return (b[p] | (b[p+1] << 8) | (b[p+2] << 16) | (b[p+3] << 24)) >>> 0; }
function writeU32LE(b, p, v) { b[p]=v&0xff; b[p+1]=(v>>>8)&0xff; b[p+2]=(v>>>16)&0xff; b[p+3]=(v>>>24)&0xff; }
function readFourCC(b, p) { return String.fromCharCode(b[p], b[p+1], b[p+2], b[p+3]); }

function parseWebp(bytes) {
    if (readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') {
        throw new Error('Not a WebP');
    }
    const chunks = [];
    let p = 12;
    while (p + 8 <= bytes.length) {
        const fcc  = readFourCC(bytes, p);
        const size = readU32LE(bytes, p + 4);
        const dataStart = p + 8;
        const dataEnd   = dataStart + size;
        chunks.push({ fcc, size, dataStart, dataEnd });
        p = dataEnd + (size & 1); // pad
    }
    return chunks;
}

function readWebp(bytes) {
    const chunks = parseWebp(bytes);
    const values = { ...EMPTY_VALUES };
    for (const ch of chunks) {
        if (ch.fcc === 'EXIF') {
            try {
                const bin = 'Exif\0\0' + bytesToBinaryString(bytes.subarray(ch.dataStart, ch.dataEnd));
                const exifObj = piexif.load(bin);
                const ev = exifToValues(exifObj);
                for (const k of Object.keys(ev)) if (ev[k] !== '' && ev[k] != null) values[k] = ev[k];
            } catch (e) { console.warn('WebP EXIF parse failed', e); }
        } else if (ch.fcc === 'XMP ') {
            try {
                const xmp = utf8Decode(bytes.subarray(ch.dataStart, ch.dataEnd));
                applyXmpToValues(xmp, values);
            } catch (e) { console.warn('WebP XMP parse failed', e); }
        }
    }
    return values;
}

function applyXmpToValues(xmp, values) {
    const pick = (re) => { const m = re.exec(xmp); return m ? decodeXml(m[1]) : ''; };
    values.ImageDescription ||= pick(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/) ||
                                pick(/<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
    values.Artist           ||= pick(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
    values.Copyright        ||= pick(/<dc:rights>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
}
function decodeXml(s) {
    return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
            .replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function encodeXml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function buildXmpPacket(values) {
    const dc = [];
    if (values.ImageDescription)
        dc.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${encodeXml(values.ImageDescription)}</rdf:li></rdf:Alt></dc:title>`);
    if (values.UserComment)
        dc.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${encodeXml(values.UserComment)}</rdf:li></rdf:Alt></dc:description>`);
    if (values.Artist)
        dc.push(`<dc:creator><rdf:Seq><rdf:li>${encodeXml(values.Artist)}</rdf:li></rdf:Seq></dc:creator>`);
    if (values.Copyright)
        dc.push(`<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${encodeXml(values.Copyright)}</rdf:li></rdf:Alt></dc:rights>`);

    const xmp = [];
    if (values.Software)
        xmp.push(`<xmp:CreatorTool>${encodeXml(values.Software)}</xmp:CreatorTool>`);
    if (values.DateTimeOriginal) {
        // ISO 8601 expected by XMP
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(values.DateTimeOriginal);
        if (m) {
            const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
            xmp.push(`<xmp:CreateDate>${iso}</xmp:CreateDate>`);
            xmp.push(`<xmp:ModifyDate>${iso}</xmp:ModifyDate>`);
        }
    }

    const tiff = [];
    if (values.Make)  tiff.push(`<tiff:Make>${encodeXml(values.Make)}</tiff:Make>`);
    if (values.Model) tiff.push(`<tiff:Model>${encodeXml(values.Model)}</tiff:Model>`);

    const exif = [];
    if (values.UserComment)
        exif.push(`<exif:UserComment><rdf:Alt><rdf:li xml:lang="x-default">${encodeXml(values.UserComment)}</rdf:li></rdf:Alt></exif:UserComment>`);

    if (!dc.length && !xmp.length && !tiff.length && !exif.length) return null;

    const descParts = [];
    if (dc.length)   descParts.push(`<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n   ${dc.join('\n   ')}\n  </rdf:Description>`);
    if (xmp.length)  descParts.push(`<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n   ${xmp.join('\n   ')}\n  </rdf:Description>`);
    if (tiff.length) descParts.push(`<rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/">\n   ${tiff.join('\n   ')}\n  </rdf:Description>`);
    if (exif.length) descParts.push(`<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/">\n   ${exif.join('\n   ')}\n  </rdf:Description>`);

    return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  ${descParts.join('\n  ')}
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function buildRiffChunk(fcc, data) {
    const padded = (data.length & 1) ? 1 : 0;
    const out = new Uint8Array(8 + data.length + padded);
    for (let i = 0; i < 4; i++) out[i] = fcc.charCodeAt(i);
    writeU32LE(out, 4, data.length);
    out.set(data, 8);
    return out;
}

function writeWebp(bytes, values) {
    const chunks = parseWebp(bytes);

    // Build EXIF blob
    const exifObj = valuesToExif(values, emptyExif());
    let exifData = null;
    if (hasAnyMeaningfulExif(exifObj)) {
        try {
            const exifBin = piexif.dump(exifObj);
            exifData = binaryStringToBytes(exifBin.slice(6));
        } catch (e) { console.warn('WebP EXIF build failed', e); }
    }

    // Build XMP packet (so non-Windows tools see title/description on WebP too)
    const xmpStr = buildXmpPacket(values);
    const xmpData = xmpStr ? utf8Encode(xmpStr) : null;

    // Find/create VP8X
    let vp8x = chunks.find(c => c.fcc === 'VP8X');
    let vp8xBytes;
    if (vp8x) {
        vp8xBytes = bytes.slice(vp8x.dataStart, vp8x.dataEnd);
    } else {
        // Need canvas dimensions from VP8 / VP8L
        const dim = getWebpDimensions(bytes, chunks);
        vp8xBytes = new Uint8Array(10);
        // bytes 4-6: canvasWidth-1 (24-bit LE), 7-9: canvasHeight-1 (24-bit LE)
        const w = dim.width - 1, h = dim.height - 1;
        vp8xBytes[4] = w & 0xff; vp8xBytes[5] = (w >> 8) & 0xff; vp8xBytes[6] = (w >> 16) & 0xff;
        vp8xBytes[7] = h & 0xff; vp8xBytes[8] = (h >> 8) & 0xff; vp8xBytes[9] = (h >> 16) & 0xff;
    }
    // Update flags: bit3 EXIF (0x08), bit2 XMP (0x04). Leave others.
    let flags = vp8xBytes[0];
    flags = exifData ? (flags | 0x08) : (flags & ~0x08);
    flags = xmpData  ? (flags | 0x04) : (flags & ~0x04);
    vp8xBytes[0] = flags;

    // Reassemble. Order: VP8X first, then ICCP/ANIM/ANMF/ALPH/VP8(L), then EXIF, then XMP.
    const parts = [];
    parts.push(buildRiffChunk('VP8X', vp8xBytes));
    for (const ch of chunks) {
        if (ch.fcc === 'VP8X' || ch.fcc === 'EXIF' || ch.fcc === 'XMP ') continue;
        const data = bytes.slice(ch.dataStart, ch.dataEnd);
        parts.push(buildRiffChunk(ch.fcc, data));
    }
    if (exifData) parts.push(buildRiffChunk('EXIF', exifData));
    if (xmpData)  parts.push(buildRiffChunk('XMP ', xmpData));

    // Total payload size (after "WEBP")
    let payloadSize = 4; // "WEBP"
    for (const p of parts) payloadSize += p.length;
    const out = new Uint8Array(8 + payloadSize);
    out[0]='R'.charCodeAt(0); out[1]='I'.charCodeAt(0); out[2]='F'.charCodeAt(0); out[3]='F'.charCodeAt(0);
    writeU32LE(out, 4, payloadSize);
    out[8]='W'.charCodeAt(0); out[9]='E'.charCodeAt(0); out[10]='B'.charCodeAt(0); out[11]='P'.charCodeAt(0);
    let off = 12;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return new Blob([out], { type: 'image/webp' });
}

function getWebpDimensions(bytes, chunks) {
    const vp8x = chunks.find(c => c.fcc === 'VP8X');
    if (vp8x) {
        const d = bytes.subarray(vp8x.dataStart, vp8x.dataEnd);
        const w = (d[4] | (d[5] << 8) | (d[6] << 16)) + 1;
        const h = (d[7] | (d[8] << 8) | (d[9] << 16)) + 1;
        return { width: w, height: h };
    }
    const vp8l = chunks.find(c => c.fcc === 'VP8L');
    if (vp8l) {
        const d = bytes.subarray(vp8l.dataStart, vp8l.dataEnd);
        // signature byte 0x2F at offset 0, then 14-bit width-1 + 14-bit height-1 + ...
        const b1 = d[1], b2 = d[2], b3 = d[3], b4 = d[4];
        const w = ((b1 | (b2 << 8)) & 0x3fff) + 1;
        const h = (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff) + 1;
        return { width: w, height: h };
    }
    const vp8 = chunks.find(c => c.fcc === 'VP8 ');
    if (vp8) {
        const d = bytes.subarray(vp8.dataStart, vp8.dataEnd);
        // Frame tag (3 bytes) + start code 0x9D 0x01 0x2A + width(2 LE, 14 bits) + height(2 LE, 14 bits)
        const w = ((d[6] | (d[7] << 8)) & 0x3fff);
        const h = ((d[8] | (d[9] << 8)) & 0x3fff);
        return { width: w, height: h };
    }
    return { width: 1, height: 1 };
}
