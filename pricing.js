// Bảng giá Gemini nhúng sẵn.
//
// Google KHÔNG có API công khai trả về đơn giá — listModels chỉ cho tên model,
// giới hạn token và phương thức hỗ trợ. Nên bảng này phải chép tay từ
// https://ai.google.dev/pricing và sẽ cũ dần theo thời gian.
//
// Nguyên tắc: model nào không có trong bảng thì hiện "chưa rõ giá", KHÔNG đoán
// theo tên. Đoán sai đơn giá làm ước tính chi phí sai, mà người dùng là người
// trả tiền cho API.
//
// Đơn vị: USD trên 1 triệu token.

export const PRICING_UPDATED = '2026-05';

export const PRICING_SOURCE = 'https://ai.google.dev/pricing';

const TABLE = {
  'gemini-3.7-flash':      { in: 0.30, out: 2.50, tier: 'flash' },
  'gemini-3.6-flash':      { in: 0.30, out: 2.50, tier: 'flash' },
  'gemini-3.5-flash':      { in: 0.30, out: 2.50, tier: 'flash' },
  'gemini-3.5-flash-lite': { in: 0.10, out: 0.40, tier: 'lite' },
  'gemini-3.1-flash-lite': { in: 0.10, out: 0.40, tier: 'lite' },
  'gemini-3.7-pro':        { in: 1.25, out: 10.00, tier: 'pro' },
  'gemini-3.5-pro':        { in: 1.25, out: 10.00, tier: 'pro' },
  'gemini-2.0-flash':      { in: 0.10, out: 0.40, tier: 'flash' },
  'gemini-2.0-flash-lite': { in: 0.075, out: 0.30, tier: 'lite' },
  'gemini-2.5-flash':      { in: 0.30, out: 2.50, tier: 'flash' },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40, tier: 'lite' },
  'gemini-2.5-pro':        { in: 1.25, out: 10.00, tier: 'pro' }
};

// Bí danh Google trỏ tới bản mới nhất — cùng giá với model nó trỏ tới.
const ALIASES = {
  'gemini-flash-latest': 'gemini-3.7-flash',
  'gemini-flash-lite-latest': 'gemini-3.5-flash-lite',
  'gemini-pro-latest': 'gemini-3.7-pro'
};

const OVERRIDE_KEY = 'mt.pricingOverride';

function overrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Người dùng tự sửa đơn giá khi bảng nhúng đã cũ. */
export function setPrice(model, input, output) {
  const all = overrides();
  all[model] = { in: Number(input), out: Number(output) };
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all));
}

export function clearPrices() {
  localStorage.removeItem(OVERRIDE_KEY);
}

export function hasOverrides() {
  return Object.keys(overrides()).length > 0;
}

/**
 * Đơn giá của một model, hoặc null nếu không biết.
 * Trả kèm `source` để UI nói rõ giá này từ đâu ra.
 */
export function priceOf(model) {
  const custom = overrides()[model];
  if (custom) return { ...custom, tier: TABLE[model]?.tier || 'khác', source: 'custom' };

  const direct = TABLE[model];
  if (direct) return { ...direct, source: 'table' };

  const alias = ALIASES[model];
  if (alias && TABLE[alias]) return { ...TABLE[alias], source: 'alias', aliasOf: alias };

  return null;
}

/** Chi phí USD cho một lượt gọi. null nếu chưa biết giá model. */
export function costOf(model, tokensIn, tokensOut) {
  const p = priceOf(model);
  if (!p) return null;
  return (tokensIn / 1e6) * p.in + (tokensOut / 1e6) * p.out;
}

/**
 * Định dạng tiền cho khoản rất nhỏ. Một cuộc họp thường chỉ vài cent, hiện
 * "$0.00" thì vô nghĩa nên giữ đủ chữ số để thấy được con số nhúc nhích.
 */
export function formatUsd(usd) {
  if (usd == null) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.01) return '$' + usd.toFixed(4);
  if (usd < 1) return '$' + usd.toFixed(3);
  return '$' + usd.toFixed(2);
}

export function formatRate(usdPerMillion) {
  return '$' + usdPerMillion.toFixed(usdPerMillion < 1 ? 2 : 2) + '/1M';
}
