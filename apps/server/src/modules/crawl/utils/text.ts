export function containsKeyword(text: string, keyword: string): boolean {
  const normalizedText = text.toLowerCase();
  const value = keyword.trim().toLowerCase();
  if (!value) return false;

  const foldedText = foldVietnameseAscii(normalizedText);
  const foldedValue = foldVietnameseAscii(value);
  const allowFolded = allowFoldedMatch(value, foldedValue);

  if (value.includes(" ")) {
    if (normalizedText.includes(value)) return true;
    if (allowFolded && foldedText.includes(foldedValue)) return true;
    if (allowFolded && flexiblePhraseMatch(foldedText, foldedValue)) return true;
    if (allowFolded && containsCompactToken(foldedText, foldedValue)) return true;
    return false;
  }

  const pattern = new RegExp(`(?<![a-z0-9_])${escapeRegExp(value)}(?![a-z0-9_])`, "u");
  if (pattern.test(normalizedText)) return true;

  if (allowFolded) {
    const foldedPattern = new RegExp(`(?<![a-z0-9_])${escapeRegExp(foldedValue)}(?![a-z0-9_])`, "u");
    if (foldedPattern.test(foldedText)) return true;
  }

  if (allowFolded && containsCompactToken(foldedText, foldedValue)) return true;

  if (allowFolded && foldedValue.length <= 3 && /^[a-z0-9]+$/i.test(foldedValue) && foldedText.includes(".")) {
    const loose = Array.from(value).map(escapeRegExp).join("[^a-z0-9_]*");
    const foldedLoose = Array.from(foldedValue).map(escapeRegExp).join("[^a-z0-9_]*");
    return (
      new RegExp(`(?<![a-z0-9_])${loose}(?![a-z0-9_])`, "u").test(normalizedText) ||
      new RegExp(`(?<![a-z0-9_])${foldedLoose}(?![a-z0-9_])`, "u").test(foldedText)
    );
  }

  return false;
}

export function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => containsKeyword(text, keyword));
}

export function containsAllKeywords(text: string, keywords: string[]): boolean {
  return keywords.every((keyword) => containsKeyword(text, keyword));
}

export function slugifyAscii(value: string, fallback = "item"): string {
  const ascii = foldVietnameseAscii(value);
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

const VIETNAMESE_MARKERS =
  "ăâđêôơư" +
  "áàảãạ" +
  "ấầẩẫậ" +
  "ắằẳẵặ" +
  "éèẻẽẹ" +
  "ếềểễệ" +
  "íìỉĩị" +
  "óòỏõọ" +
  "ốồổỗộ" +
  "ớờởỡợ" +
  "úùủũụ" +
  "ứừửữự" +
  "ýỳỷỹỵ";

const VIETNAMESE_ASCII_PHRASES = [
  "tiet kiem",
  "het tien",
  "de danh",
  "khong co",
  "khong biet",
  "khong nen",
  "khong can",
  "cam on",
  "xin loi",
  "bong da",
  "world cup",
  "doi tuyen",
  "cau thu",
  "tran dau",
  "my pham",
  "cham soc da",
  "tim tro",
  "thue tro",
  "phong tro",
  "di lam",
  "sinh vien",
  "hoc phi",
];

const VIETNAMESE_ASCII_WORDS = new Set([
  "anh",
  "ban",
  "biet",
  "binh",
  "cam",
  "can",
  "chi",
  "chua",
  "co",
  "con",
  "cung",
  "cua",
  "dang",
  "de",
  "duoc",
  "dung",
  "gio",
  "hay",
  "het",
  "hoc",
  "hoi",
  "hom",
  "khong",
  "lam",
  "luon",
  "minh",
  "moi",
  "mua",
  "nay",
  "nen",
  "neu",
  "nguoi",
  "nha",
  "qua",
  "roi",
  "sao",
  "thoi",
  "tien",
  "tim",
  "tro",
  "viet",
  "vong",
  "xin",
]);

const VIETNAMESE_TEENCODE_WORDS = new Set([
  "ko",
  "k",
  "kh",
  "dc",
  "đc",
  "mn",
  "mng",
  "tụi",
  "tui",
  "mik",
  "mik",
  "hok",
  "hem",
  "thui",
  "z",
  "r",
  "cx",
  "vs",
  "bt",
  "ae",
  "ib",
  "inb",
]);

export function isLikelyVietnameseText(text: string): boolean {
  const lowered = String(text || "").trim().toLowerCase();
  if (!lowered) return false;
  if (Array.from(lowered).some((char) => VIETNAMESE_MARKERS.includes(char))) return true;

  const ascii = foldVietnameseAscii(lowered);
  if (!ascii) return false;
  if (VIETNAMESE_ASCII_PHRASES.some((marker) => ascii.includes(marker))) return true;

  const words = ascii.match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return false;
  const viHits = new Set(words.filter((word) => VIETNAMESE_ASCII_WORDS.has(word)));
  const teencodeHits = new Set(words.filter((word) => VIETNAMESE_TEENCODE_WORDS.has(word)));

  if (viHits.size >= 2) return true;
  if (viHits.size >= 1 && teencodeHits.size >= 1) return true;
  if (teencodeHits.size >= 3) return true;
  return false;
}

export function foldVietnameseAscii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "");
}

function allowFoldedMatch(value: string, foldedValue: string): boolean {
  if (value === foldedValue) return foldedValue.replace(/\s+/g, "").length > 3;
  return foldedValue.replace(/\s+/g, "").length > 3;
}

function flexiblePhraseMatch(text: string, phrase: string): boolean {
  const parts = phrase
    .split(/\s+/)
    .map((part) => compactAlphaNum(part))
    .filter((part) => part.length > 0);
  if (parts.length < 2) return false;

  const body = parts.map(escapeRegExp).join("[\\s._-]*");
  return new RegExp(`(?<![a-z0-9_])#?${body}(?:[0-9]{2,4})?(?![a-z0-9_])`, "u").test(text);
}

function containsCompactToken(text: string, value: string): boolean {
  const compactValue = compactAlphaNum(value);
  if (compactValue.length <= 3) return false;

  const tokens = text.match(/[#@]?[a-z0-9_.-]+/g) ?? [];
  return tokens.some((token) => compactTokenMatchesKeyword(compactAlphaNum(token), compactValue));
}

function compactTokenMatchesKeyword(token: string, keyword: string): boolean {
  if (!token || !keyword) return false;
  if (token === keyword) return true;
  if (!token.startsWith(keyword)) return false;
  return /^[0-9]{2,4}$/.test(token.slice(keyword.length));
}

function compactAlphaNum(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
