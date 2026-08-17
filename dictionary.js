// Tra từ điển tĩnh để hiện nghĩa tiếng Việt TỨC THÌ, không tốn token.
//
// Đây là bản gợi nghĩa theo từng từ, không phải bản dịch đúng ngữ pháp:
// tiếng Việt không chia thì và trật tự từ khác tiếng Anh. Nó tồn tại để
// người đọc bắt được ý ngay khi người ta còn đang nói; câu hoàn chỉnh do
// AI chốt lại sau đó.

let dict = null;
let loading = null;

export function isReady() {
  return dict !== null;
}

export function size() {
  return dict ? Object.keys(dict).length : 0;
}

export async function load(url = 'dictionary.json') {
  if (dict) return dict;
  if (loading) return loading;

  loading = fetch(url)
    .then((r) => (r.ok ? r.json() : {}))
    .then((data) => {
      dict = data || {};
      return dict;
    })
    .catch(() => {
      // Không có từ điển thì hệ thống vẫn chạy, chỉ mất phần gợi nghĩa tức thì.
      dict = {};
      return dict;
    });

  return loading;
}

/** Bỏ đuôi biến cách để tra được "meetings" -> "meeting". */
function stems(word) {
  const out = [word];

  if (word.endsWith("'s")) out.push(word.slice(0, -2));
  if (word.endsWith('ies') && word.length > 4) out.push(word.slice(0, -3) + 'y');
  if (word.endsWith('es') && word.length > 3) out.push(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) out.push(word.slice(0, -1));
  if (word.endsWith('ing') && word.length > 5) {
    const base = word.slice(0, -3);
    out.push(base, base + 'e');
    // "running" -> "run": phụ âm cuối bị gấp đôi
    if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) out.push(base.slice(0, -1));
  }
  if (word.endsWith('ed') && word.length > 4) {
    const base = word.slice(0, -2);
    out.push(base, base + 'e', word.slice(0, -1));
    if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) out.push(base.slice(0, -1));
  }
  if (word.endsWith('er') && word.length > 4) out.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('ly') && word.length > 4) out.push(word.slice(0, -2));

  return out;
}

// Tiếng Việt không có mạo từ và không dùng trợ động từ như tiếng Anh.
// Dịch chúng ra chữ ("the" -> "đó") làm câu rối hơn là bỏ hẳn.
const SKIP = new Set(['the', 'a', 'an', 'to', 'of', 'do', 'does', 'did', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being']);

export function lookupWord(word) {
  if (!dict) return null;
  const w = word.toLowerCase();
  for (const s of stems(w)) {
    if (dict[s]) return dict[s];
  }
  return null;
}

/**
 * Gợi nghĩa cả câu. Từ nào không tra được thì giữ nguyên tiếng Anh —
 * thà để lộ chỗ chưa biết còn hơn bịa ra nghĩa sai.
 */
export function glossSentence(text) {
  if (!dict || !text) return '';

  const tokens = text.match(/[A-Za-z']+|[^A-Za-z']+/g) || [];
  let hits = 0;
  let words = 0;

  const parts = tokens.map((tok) => {
    if (!/^[A-Za-z']+$/.test(tok)) return tok;
    words++;

    // Từ chức năng: tính là đã xử lý nhưng bỏ khỏi kết quả.
    if (SKIP.has(tok.toLowerCase())) {
      hits++;
      return '';
    }

    const found = lookupWord(tok);
    if (found) {
      hits++;
      return found;
    }
    return tok;
  });

  // Bỏ từ chức năng để lại khoảng trắng thừa.
  const glossed = parts.join('').replace(/\s{2,}/g, ' ').trim();

  return { text: glossed, coverage: words ? hits / words : 0 };
}
