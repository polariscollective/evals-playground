// Un écrivain ZIP minimal, sans dépendance.
//
// Le détail d'un run tient en deux fichiers qui ne se mélangent pas : un CSV
// d'une ligne par case, et un Markdown qui porte ce qui vaut pour tout le run —
// les notes, les outils, la configuration. Les proposer séparément obligerait à
// cliquer deux fois et à se souvenir du second ; une archive les tient ensemble.
//
// Écrit à la main plutôt qu'avec une bibliothèque : le format « stocké », sans
// compression, tient en trois structures, et Node sait calculer le CRC32 depuis
// la version 20. Deux fichiers de quelques centaines de kilo-octets ne gagnent
// rien à être compressés au prix d'une dépendance de plus.
import { crc32 } from "node:zlib";

interface Entry {
  name: string;
  data: Buffer;
  crc: number;
  offset: number;
}

/** Date et heure au format MS-DOS, que le format impose.
 *
 * Figées à 1980-01-01, la première date représentable : l'horodatage réel
 * ferait que deux archives du même run diffèrent octet pour octet, ce qui
 * empêcherait de vérifier qu'un export est reproductible. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function localHeader(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); // signature
  head.writeUInt16LE(20, 4); // version nécessaire
  head.writeUInt16LE(0x0800, 6); // drapeau : noms en UTF-8
  head.writeUInt16LE(0, 8); // méthode : stocké
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(entry.crc, 14);
  head.writeUInt32LE(entry.data.length, 18);
  head.writeUInt32LE(entry.data.length, 22);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28); // pas de champ supplémentaire
  return Buffer.concat([head, name]);
}

function centralEntry(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version d'écriture
  head.writeUInt16LE(20, 6); // version nécessaire
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

/** Une archive contenant les fichiers donnés, sans compression. */
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
  end.writeUInt16LE(0, 6); // disque du répertoire
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // commentaire

  return Buffer.concat([...morceaux, ...central, end]);
}
