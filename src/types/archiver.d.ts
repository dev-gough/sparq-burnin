/**
 * Minimal types for archiver@8 (ESM, ZipArchive class).
 * Upstream package does not ship declarations yet.
 */
declare module "archiver" {
  import { Transform } from "stream";

  export interface ArchiverOptions {
    zlib?: { level?: number };
    store?: boolean;
  }

  export interface EntryData {
    name: string;
    date?: Date | string;
    mode?: number;
  }

  export class Archiver extends Transform {
    append(
      source: Buffer | string | NodeJS.ReadableStream,
      data: EntryData,
    ): this;
    finalize(): Promise<void>;
    pointer(): number;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  export class TarArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  export class JsonArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }
}
