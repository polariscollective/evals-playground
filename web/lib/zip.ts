// A minimal ZIP writer, with no dependency.
//
// A run's detail fits in two files that do not mix: a CSV of one row per cell,
// and a Markdown carrying what holds for the whole run —
// the grades, the tools, the configuration. Offering them separately would
// mean clicking twice and remembering the second; an archive holds them
// together.
//
// Written by hand rather than with a library: the "stored" format, with no
// compression, fits in three structures, and Node has been able to compute the
// CRC32 since version 20. Two files of a few hundred kilobytes gain nothing from
// being compressed at the price of one more dependency.
import { crc32 } from "node:zlib";

interface Entry {
  name: string;
  data: Buffer;
  crc: number;
  offset: number;
}

/** Date and time in the MS-DOS format the format imposes.
 *
 * Frozen at 1980-01-01, the first representable date: a real timestamp would
 * make two archives of the same run differ byte for byte, which would stop an
 * export being checked as reproducible. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function localHeader(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); // signature
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0x0800, 6); // drapeau : noms en UTF-8
  head.writeUInt16LE(0, 8); // method: stored
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(entry.crc, 14);
  head.writeUInt32LE(entry.data.length, 18);
  head.writeUInt32LE(entry.data.length, 22);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28); // no extra field
  return Buffer.concat([head, name]);
}

function centralEntry(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version made by
  head.writeUInt16LE(20, 6); // version needed
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(DOS_TIME, 12);
  head.writeUInt16LE(DOS_DATE, 14);
  head.writeUInt32LE(entry.crc, 16);
  head.writeUInt32LE(entry.data.length, 20);
  head.writeUInt32LE(entry.data.length, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt16LE(0, 30); // extra
  head.writeUInt16LE(0, 32); // commentaire
  head.writeUInt16LE(0, 34); // disque
  head.writeUInt16LE(0, 36); // attributs internes
  head.writeUInt32LE(0, 38); // attributs externes
  head.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([head, name]);
}

/** An archive containing the given files, uncompressed. */
export function zip(files: { name: string; content: string }[]): Buffer {
  const morceaux: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  for (const file of files) {
    const data = Buffer.from(file.content, "utf8");
    const entry: Entry = {
      name: file.name,
      data,
      crc: crc32(data),
      offset,
    };
    entries.push(entry);
    const head = localHeader(entry);
    morceaux.push(head, data);
    offset += head.length + data.length;
  }

  const central = entries.map(centralEntry);
  const centralSize = central.reduce((total, buf) => total + buf.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disque
  end.writeUInt16LE(0, 6); // directory's disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // commentaire

  return Buffer.concat([...morceaux, ...central, end]);
}
