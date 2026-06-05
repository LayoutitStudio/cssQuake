export interface QuakePakEntry {
  name: string;
  offset: number;
  size: number;
}

export type QuakePakSource = ArrayBuffer | ArrayBufferView;

interface QuakePakByteRange {
  buffer: ArrayBufferLike;
  byteOffset: number;
  byteLength: number;
}

export function parseQuakePakDirectory(source: QuakePakSource): QuakePakEntry[] {
  const range = quakePakByteRange(source);
  const view = new DataView(range.buffer, range.byteOffset, range.byteLength);
  if (readFixedAscii(view, 0, 4) !== "PACK") throw new Error("Not a Quake PAK file.");

  const dirOffset = view.getInt32(4, true);
  const dirSize = view.getInt32(8, true);
  if (dirOffset < 0 || dirSize < 0 || dirOffset + dirSize > range.byteLength || dirSize % 64 !== 0) {
    throw new Error("Invalid PAK directory.");
  }

  const entries: QuakePakEntry[] = [];
  for (let offset = dirOffset; offset < dirOffset + dirSize; offset += 64) {
    const entry = {
      name: readFixedAscii(view, offset, 56).toLowerCase(),
      offset: view.getInt32(offset + 56, true),
      size: view.getInt32(offset + 60, true),
    };
    if (!quakePakEntryInBounds(entry, range.byteLength)) {
      throw new Error(`Invalid PAK entry bounds for ${entry.name || "<unnamed>"}.`);
    }
    entries.push(entry);
  }
  return entries;
}

export function quakePakEntryBytes(source: QuakePakSource, entry: QuakePakEntry): Uint8Array {
  const range = quakePakByteRange(source);
  if (!quakePakEntryInBounds(entry, range.byteLength)) {
    throw new Error(`Invalid PAK entry bounds for ${entry.name || "<unnamed>"}.`);
  }
  return new Uint8Array(range.buffer, range.byteOffset + entry.offset, entry.size);
}

export function readFixedAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function quakePakByteRange(source: QuakePakSource): QuakePakByteRange {
  if (ArrayBuffer.isView(source)) {
    return {
      buffer: source.buffer,
      byteOffset: source.byteOffset,
      byteLength: source.byteLength,
    };
  }
  return {
    buffer: source,
    byteOffset: 0,
    byteLength: source.byteLength,
  };
}

function quakePakEntryInBounds(entry: QuakePakEntry, byteLength: number): boolean {
  return entry.offset >= 0 &&
    entry.size >= 0 &&
    entry.offset <= byteLength &&
    entry.size <= byteLength - entry.offset;
}
