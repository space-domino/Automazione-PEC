import chardet from "chardet";
import { parse as parseStream } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import iconv from "iconv-lite";

export interface DetectedFormat {
  encoding: string;
  delimiter: string;
}

const DELIMITER_CANDIDATES = [",", ";", "\t", "|"];

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function hasHighByte(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if ((buf[i] ?? 0) >= 0x80) return true;
  }
  return false;
}

export function detectEncoding(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "utf-8";
  // Nessun byte >= 0x80 -> ASCII a 7 bit -> decodifica utf-8 senza ambiguità.
  if (!hasHighByte(buf)) return "utf-8";
  const detected = (chardet.detect(buf.subarray(0, 65_536)) ?? "utf-8").toLowerCase();
  if (detected.includes("ascii") || detected === "utf8") return "utf-8";
  return detected;
}

export function decodeBuffer(buf: Buffer, encoding: string): string {
  const enc = encoding.toLowerCase();
  if (enc === "utf-8" || enc === "utf8" || enc === "ascii") return stripBom(buf.toString("utf8"));
  if (iconv.encodingExists(enc)) return stripBom(iconv.decode(buf, enc));
  return stripBom(buf.toString("utf8"));
}

export function detectDelimiter(headerLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const c of DELIMITER_CANDIDATES) {
    const count = headerLine.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export function detectFormat(buf: Buffer): DetectedFormat {
  const encoding = detectEncoding(buf);
  const firstLine = decodeBuffer(buf.subarray(0, 8192), encoding).split(/\r?\n/)[0] ?? "";
  return { encoding, delimiter: detectDelimiter(firstLine) };
}

const PARSE_OPTS = {
  relax_column_count: true,
  skip_empty_lines: true,
  trim: true,
  bom: true,
} as const;

export interface PreviewResult {
  encoding: string;
  delimiter: string;
  headers: string[];
  rows: string[][];
  totalDataRows: number;
}

/** Anteprima sincrona (prime `maxRows` righe dati) per la UI di mapping. */
export function parsePreview(buf: Buffer, maxRows = 20): PreviewResult {
  const { encoding, delimiter } = detectFormat(buf);
  const text = decodeBuffer(buf, encoding);
  const records = parseSync(text, { delimiter, ...PARSE_OPTS }) as string[][];
  const headers = (records[0] ?? []).map((h) => h ?? "");
  const dataRows = records.slice(1);
  return {
    encoding,
    delimiter,
    headers,
    rows: dataRows.slice(0, maxRows).map((r) => r.map((c) => c ?? "")),
    totalDataRows: dataRows.length,
  };
}

/** Iterazione in streaming: `onRow` riceve (cellule, numeroRigaDati 1-based, intestazioni). */
export async function forEachRow(
  buf: Buffer,
  format: DetectedFormat,
  onRow: (row: string[], rowNumber: number, headers: string[]) => Promise<void>,
): Promise<{ headers: string[]; total: number }> {
  const text = decodeBuffer(buf, format.encoding);
  const parser = parseStream(text, { delimiter: format.delimiter, ...PARSE_OPTS });

  let headers: string[] = [];
  let seen = 0;
  let dataRow = 0;

  for await (const rec of parser) {
    const row = (rec as string[]).map((c) => c ?? "");
    if (seen === 0) {
      headers = row;
      seen++;
      continue;
    }
    seen++;
    dataRow++;
    await onRow(row, dataRow, headers);
  }

  return { headers, total: dataRow };
}
