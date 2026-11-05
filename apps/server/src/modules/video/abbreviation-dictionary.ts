import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AbbreviationDictionaryEntry {
  key: string;
  value: string;
}

const DEFAULT_ENTRIES: AbbreviationDictionaryEntry[] = [
  { key: "ae", value: "anh em" },
  { key: "b", value: "bạn" },
  { key: "bả", value: "bà ấy" },
  { key: "r", value: "rồi" },
  { key: "đc", value: "được" },
  { key: "đh", value: "đại học" },
  { key: "đ", value: "đíu" },
  { key: "biet", value: "biết" },
  { key: "bik", value: "biết" },
  { key: "bit", value: "biết" },
  { key: "bn", value: "bao nhiêu" },
  { key: "bnh", value: "bao nhiêu" },
  { key: "bth", value: "bình thường" },
  { key: "bthg", value: "bình thường" },
  { key: "bthuong", value: "bình thường" },
  { key: "bthường", value: "bình thường" },
  { key: "bt", value: "bình thường" },
  { key: "cc", value: "cờ cờ" },
  { key: "ce", value: "chị em" },
  { key: "chx", value: "chưa" },
  { key: "ck", value: "chồng" },
  { key: "cl", value: "xê lờ" },
  { key: "cmn", value: "con mẹ nó" },
  { key: "cmt", value: "cờ mờ tờ" },
  { key: "cgi", value: "cái gì" },
  { key: "cj", value: "cái gì" },
  { key: "cjz", value: "cái gì vậy" },
  { key: "chs", value: "chơi" },
  { key: "clg", value: "cái gì" },
  { key: "cty", value: "công ty" },
  { key: "cx", value: "cũng" },
  { key: "dc", value: "được" },
  { key: "dk", value: "được" },
  { key: "dm", value: "đờ mờ" },
  { key: "dmm", value: "đờ mờ mờ" },
  { key: "duma", value: "đu má" },
  { key: "dume", value: "đu mé" },
  { key: "dcm", value: "đờ cờ mờ" },
  { key: "djt", value: "dịt" },
  { key: "djtme", value: "dịt me" },
  { key: "dl", value: "du lịch" },
  { key: "fb", value: "facebook" },
  { key: "haiz", value: "haizz" },
  { key: "hk", value: "không" },
  { key: "hqua", value: "hôm qua" },
  { key: "hnay", value: "hôm nay" },
  { key: "hquaaa", value: "hôm qua" },
  { key: "hs", value: "học sinh" },
  { key: "hum", value: "hôm" },
  { key: "ib", value: "nhắn tin" },
  { key: "ibox", value: "nhắn tin" },
  { key: "inb", value: "nhắn tin" },
  { key: "j", value: "gì" },
  { key: "ko", value: "không" },
  { key: "k", value: "không" },
  { key: "kg", value: "không" },
  { key: "kh", value: "không" },
  { key: "khg", value: "không" },
  { key: "kb", value: "không biết" },
  { key: "klq", value: "không liên quan" },
  { key: "kkk", value: "ka ka ka" },
  { key: "kp", value: "không phải" },
  { key: "kq", value: "kết quả" },
  { key: "ksao", value: "không sao" },
  { key: "kt", value: "kiểm tra" },
  { key: "lm", value: "làm" },
  { key: "lmj", value: "làm gì" },
  { key: "lmao", value: "lờ mao" },
  { key: "lq", value: "liên quan" },
  { key: "l", value: "lờ" },
  { key: "m", value: "mày" },
  { key: "mik", value: "mình" },
  { key: "mn", value: "mọi người" },
  { key: "mng", value: "mọi người" },
  { key: "ms", value: "mới" },
  { key: "mun", value: "muốn" },
  { key: "mún", value: "muốn" },
  { key: "nch", value: "nói chuyện" },
  { key: "ncl", value: "nói chung là" },
  { key: "nh", value: "nhỉ" },
  { key: "nhg", value: "nhưng" },
  { key: "nhma", value: "nhưng mà" },
  { key: "ngt", value: "người ta" },
  { key: "ngta", value: "người ta" },
  { key: "nt", value: "nhắn tin" },
  { key: "ny", value: "người yêu" },
  { key: "oke", value: "ô kê" },
  { key: "okela", value: "ô kê la" },
  { key: "onl", value: "online" },
  { key: "ovtk", value: "o vờ thinh kinh" },
  { key: "pass", value: "pass" },
  { key: "rep", value: "trả lời" },
  { key: "rl", value: "rồi" },
  { key: "ròi", value: "rồi" },
  { key: "rui", value: "rồi" },
  { key: "rùi", value: "rồi" },
  { key: "sdt", value: "số điện thoại" },
  { key: "sl", value: "số lượng" },
  { key: "sll", value: "số lượng lớn" },
  { key: "sml", value: "sờ mờ lờ" },
  { key: "sn", value: "sinh nhật" },
  { key: "sv", value: "sinh viên" },
  { key: "tb", value: "thông báo" },
  { key: "tbh", value: "thì bình thường" },
  { key: "tdn", value: "thế điếu nào" },
  { key: "tđn", value: "thế điếu nào" },
  { key: "th", value: "trường hợp" },
  { key: "thik", value: "thích" },
  { key: "thui", value: "thôi" },
  { key: "thks", value: "cảm ơn" },
  { key: "ths", value: "cảm ơn" },
  { key: "tk", value: "tài khoản" },
  { key: "tks", value: "thank" },
  { key: "tml", value: "người đó" },
  { key: "ntn", value: "như thế nào" },
  { key: "tnao", value: "thế nào" },
  { key: "tna", value: "thế nào" },
  { key: "tnx", value: "tin nhắn" },
  { key: "tpa", value: "thành phố" },
  { key: "tr", value: "triệu" },
  { key: "trc", value: "trước" },
  { key: "vid", value: "video" },
  { key: "trk", value: "trước" },
  { key: "trl", value: "trả lời" },
  { key: "trog", value: "trong" },
  { key: "trv", value: "trộm vía" },
  { key: "tt", value: "thông tin" },
  { key: "ttoi", value: "tôi" },
  { key: "tươngg", value: "tương" },
  { key: "tươngq", value: "tương" },
  { key: "vc", value: "vãi chưởng" },
  { key: "vch", value: "vãi chưởng" },
  { key: "vcl", value: "vãi cả lìn" },
  { key: "vd", value: "ví dụ" },
  { key: "vl", value: "vãi lồng" },
  { key: "vler", value: "vê lờ" },
  { key: "vlerz", value: "vê lờ" },
  { key: "vozer", value: "vãi lồng" },
  { key: "vs", value: "với" },
  { key: "vãi", value: "vãi" },
  { key: "wk", value: "công việc" },
  { key: "xl", value: "xin lỗi" },
  { key: "xloi", value: "xin lỗi" },
  { key: "xongg", value: "xong" },
  { key: "z", value: "vậy" },
  { key: "zay", value: "vậy" },
  { key: "zị", value: "dị" },
  { key: "t", value: "tao" },
  { key: "v", value: "vậy" },
  { key: "dth", value: "dễ thương" },
  { key: "jz", value: "gì vậy" },
  { key: "h", value: "giờ" },
  { key: "stk", value: "số tài khoản " },
  { key: "qr", value: "quy rờ" },
  { key: "dhs", value: "đéo hiểu sao" },
  { key: "đhs", value: "đéo hiểu sao" },
  { key: "T", value: "tao" },
  { key: "vcđ", value: "vãi cả đạn" },
  { key: "vcd", value: "vãi cả đạn" },
  { key: "đcm", value: "đờ cờ mờ" },
  { key: "dcm", value: "đờ cờ mờ" },
  { key: "nx", value: "nữa" },
  { key: "bsv", value: "băng vệ sinh" },
  { key: "nc", value: "nước" },
  { key: "trg", value: "trường" },
  { key: "vkl", value: "vãi cả lờ" },
  { key: "dell", value: "đéo" },
  { key: "chn", value: "chúng nó" },
  { key: "đth", value: "điện thoại" },
  { key: "cno", value: "chúng nó" },
  { key: "Ngiu", value: "người yêu" },
  { key: "ngiu", value: "người iu" },
  { key: "VN", value: "việt nam" },
  { key: "vn", value: "việt nam" },
  { key: "qte", value: "quốc tế" },
  { key: "Ngy", value: "người yêu" },
  { key: "cno", value: "chúng nó" },
  { key: "nvs", value: "nhà vệ sinh" },
  { key: "đg", value: "đang" },
  { key: "c1", value: "cấp 1" },
  { key: "c2", value: "cấp 2" },
  { key: "c3", value: "cấp 3" },
  { key: "nx", value: "nữa" },
  { key: "BS", value: "bác sĩ" },
  { key: "bs", value: "bác sĩ" },
  { key: "thk", value: "thằng" },
  { key: "cđời", value: "cuộc đời" },
  { key: "kph", value: "không phải" },  
  { key: "kphai", value: "không phải" },
  { key: "ctrai", value: "con trai" },
  { key: "ntin", value: "nhắn tin" },
  { key: "ctay", value: "chia tay " },
  { key: "cgai", value: "con gái" },
  { key: "bthan", value: "bạn thân" },
  { key: "nc", value: "nước" },
  { key: "kph", value: "không phải" },
  { key: "ngkh", value: "người khác" },
  { key: "xog", value: "xong" },
  { key: "chtay", value: "chia tay" },
  { key: "ks", value: "khách sạn" },
  { key: "tht", value: "thật" },
  { key: "dhs", value: "đéo hiểu sao" },
  { key: "đhs", value: "đéo hiểu sao" },
  { key: "tngt", value: "tai nạn giao thông" },
  { key: "chm", value: "chúng mày" },
  { key: "vlin", value: "vãi lìn" },
  { key: "tbao", value: "thông báo" },
  { key: "dcd", value: "đéo chịu được" },
  { key: "đcđ", value: "đéo chịu được" },
  { key: "gđ", value: "gia đình" },
  { key: "gd", value: "gia đình" },
  { key: "bgio", value: "bây giờ" },
  { key: "ptrien ", value: "phát triển" },
  { key: "khôg ", value: "không" },
  { key: "trg", value: "trường" },
  { key: "mtrg", value: "môi trường" },
  { key: "ptrien", value: "phát triển" },
  { key: "hc", value: "học" },
  { key: "kbt", value: "không biết" },
  { key: "cmnr", value: "con mẹ nó rồi" },
  { key: "lgi", value: "làm gì" },
  { key: "hdi", value: "hỏi đi" },
  { key: "hdoi", value: "hỏi đi" },
  { key: "ngta", value: "người ta" },
  { key: "ko", value: "không" },
  { key: "nthe", value: "như thế" },
  { key: "cđg", value: "cái đéo j" },
  { key: "cdg", value: "cái đéo j" },
];

export async function readAbbreviationDictionary(
  filePath: string,
): Promise<Record<string, string>> {
  await ensureAbbreviationDictionary(filePath);
  const content = await readFile(filePath, "utf8");
  const parsed = entriesToRecord(parseAbbreviationCsv(content));
  const repaired = repairAbbreviationRecord(parsed);

  if (JSON.stringify(parsed) !== JSON.stringify(repaired)) {
    await writeAbbreviationDictionary(filePath, repaired);
  }

  return repaired;
}

export async function writeAbbreviationDictionary(
  filePath: string,
  abbreviations: Record<string, string>,
): Promise<Record<string, string>> {
  const normalized = normalizeAbbreviationRecord(abbreviations);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    withUtf8Bom(serializeAbbreviationCsv(recordToEntries(normalized))),
    "utf8",
  );
  return normalized;
}

export async function importAbbreviationDictionaryFromUrl(
  url: string,
): Promise<Record<string, string>> {
  const sourceUrl = normalizeAbbreviationImportUrl(url);
  const response = await fetch(sourceUrl, {
    headers: {
      Accept:
        "text/csv,text/tab-separated-values,text/plain,application/json;q=0.1,*/*;q=0.01",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Không tải được sheet online (${response.status} ${response.statusText}).`,
    );
  }

  const content = await response.text();
  const imported = parseImportedAbbreviationTable(content);
  if (Object.keys(imported).length === 0) {
    throw new Error(
      "Sheet online chưa có 2 cột hợp lệ: cột trái viết tắt, cột phải là tiếng Việt.",
    );
  }

  return imported;
}

async function ensureAbbreviationDictionary(filePath: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      withUtf8Bom(serializeAbbreviationCsv(DEFAULT_ENTRIES)),
      "utf8",
    );
  }
}

function parseAbbreviationCsv(content: string): AbbreviationDictionaryEntry[] {
  const rows = parseCsvRows(content).slice(1);
  return rows
    .map((row) => ({
      key: String(row[0] ?? "").trim(),
      value: String(row[1] ?? "").trim(),
    }))
    .filter((entry) => entry.key && entry.value);
}

function parseImportedAbbreviationTable(
  content: string,
): Record<string, string> {
  const normalizedContent = String(content ?? "").replace(/^\uFEFF/, "");
  const rows = parseDelimitedRows(normalizedContent);
  if (rows.length === 0) {
    return {};
  }

  const header = rows[0]?.map((cell) => normalizeCsvHeader(cell)) ?? [];
  const keyIndex = findHeaderIndex(header, [
    "key",
    "viettat",
    "abbreviation",
    "abbr",
    "tuviettat",
  ]);
  const valueIndex = findHeaderIndex(header, [
    "value",
    "docthanh",
    "expansion",
    "meaning",
    "tiengviet",
    "dichratiengviet",
    "dich",
  ]);
  const hasMappedHeader = keyIndex >= 0 && valueIndex >= 0;
  const dataRows = hasMappedHeader
    ? rows.slice(1).map((row) => [row[keyIndex] ?? "", row[valueIndex] ?? ""])
    : rows;

  return normalizeAbbreviationRecord(
    Object.fromEntries(
      dataRows
        .map(
          (row) =>
            [String(row[0] ?? "").trim(), String(row[1] ?? "").trim()] as const,
        )
        .filter(([key, value]) => key && value),
    ),
  );
}

function serializeAbbreviationCsv(
  entries: AbbreviationDictionaryEntry[],
): string {
  const lines = [
    ["key", "value"],
    ...entries.map((entry) => [entry.key, entry.value]),
  ].map((row) => row.map(escapeCsvField).join(","));
  return `${lines.join("\n")}\n`;
}

function parseCsvRows(content: string): string[][] {
  return parseRowsByDelimiter(content, ",");
}

function parseTsvRows(content: string): string[][] {
  return parseRowsByDelimiter(content, "\t");
}

function parseDelimitedRows(content: string): string[][] {
  const csvRows = parseCsvRows(content);
  const tsvRows = parseTsvRows(content);
  const csvScore = scoreDelimitedRows(csvRows);
  const tsvScore = scoreDelimitedRows(tsvRows);
  return tsvScore > csvScore ? tsvRows : csvRows;
}

function parseRowsByDelimiter(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      if (row.some((item) => item.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((item) => item.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function scoreDelimitedRows(rows: string[][]): number {
  return rows.reduce(
    (score, row) => score + (row.length >= 2 ? row.length : 0),
    0,
  );
}

function escapeCsvField(value: string): string {
  const normalized = String(value ?? "");
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

function normalizeCsvHeader(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function findHeaderIndex(headers: string[], acceptedHeaders: string[]): number {
  return headers.findIndex((header) => acceptedHeaders.includes(header));
}

function entriesToRecord(
  entries: AbbreviationDictionaryEntry[],
): Record<string, string> {
  return normalizeAbbreviationRecord(
    Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
  );
}

function recordToEntries(
  abbreviations: Record<string, string>,
): AbbreviationDictionaryEntry[] {
  return Object.entries(normalizeAbbreviationRecord(abbreviations)).map(
    ([key, value]) => ({
      key,
      value,
    }),
  );
}

function normalizeAbbreviationRecord(
  abbreviations: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(abbreviations ?? {})) {
    const key = repairMojibake(
      String(rawKey ?? "")
        .trim()
        .toLowerCase(),
    );
    const value = repairMojibake(String(rawValue ?? "").trim());
    if (!key || !value) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function repairAbbreviationRecord(
  abbreviations: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(abbreviations).map(([key, value]) => [
      repairMojibake(key),
      repairMojibake(value),
    ]),
  );
}

function repairMojibake(value: string): string {
  const normalized = stripInvisibleControlChars(String(value ?? "").trim());
  if (!looksLikeMojibake(normalized)) {
    return normalized;
  }

  try {
    const repaired = stripInvisibleControlChars(
      Buffer.from(normalized, "latin1").toString("utf8").trim(),
    );
    return isPreferableRepair(normalized, repaired) ? repaired : normalized;
  } catch {
    return normalized;
  }
}

function withUtf8Bom(value: string): string {
  return value.startsWith("\uFEFF") ? value : `\uFEFF${value}`;
}

function normalizeAbbreviationImportUrl(url: string): string {
  const normalized = String(url ?? "").trim();
  if (!normalized) {
    throw new Error("Ban chua nhap link sheet online.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Link sheet online không hợp lệ.");
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;
  if (host === "docs.google.com" && pathname.includes("/spreadsheets/d/")) {
    const match = pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    const sheetId = match?.[1];
    if (!sheetId) {
      throw new Error("Không đọc được Google Sheet ID từ link bạn cung cấp.");
    }

    const gid = parsed.searchParams.get("gid") ?? "0";
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=tsv&gid=${encodeURIComponent(gid)}`;
  }

  return parsed.toString();
}

function stripInvisibleControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function looksLikeMojibake(value: string): boolean {
  return (
    value.includes("\uFFFD") ||
    /[ÃÂÄÅÆ]/u.test(value) ||
    /â[\u0080-\u00BF]/u.test(value)
  );
}

function isPreferableRepair(original: string, repaired: string): boolean {
  if (!repaired) {
    return false;
  }

  return (
    getSuspiciousCharacterScore(repaired) <
    getSuspiciousCharacterScore(original)
  );
}

function getSuspiciousCharacterScore(value: string): number {
  let score = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (char === "\uFFFD") {
      score += 5;
    } else if (/[ÃÂÄÅÆ]/u.test(char)) {
      score += 2;
    } else if ((codePoint >= 0 && codePoint < 32) || codePoint === 127) {
      score += 3;
    }
  }
  return score;
}
