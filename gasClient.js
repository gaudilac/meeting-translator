// Gọi Apps Script Web App của người dùng. Không bao giờ chạm tới API key.

const STORAGE_KEY = 'mt.connection';

export class GasError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function loadConnection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConnection(url, token) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: url.trim(), token: token.trim() }));
}

export function clearConnection() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Content-Type phải là text/plain: application/json kích hoạt preflight OPTIONS
 * mà Apps Script không xử lý, request sẽ fail vì CORS.
 */
async function post(conn, body, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, token: conn.token }),
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GasError('TIMEOUT', 'Script không phản hồi kịp. Kiểm tra kết nối mạng.');
    }
    throw new GasError(
      'NETWORK',
      'Không gọi được Apps Script. Kiểm tra URL và chắc chắn đã deploy với quyền truy cập "Anyone".'
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Apps Script trả HTML khi deploy sai quyền truy cập.
    throw new GasError(
      'BAD_DEPLOY',
      'Script trả về HTML thay vì dữ liệu. Deploy lại với "Who has access" = Anyone.'
    );
  }

  if (!data.ok) {
    throw new GasError(data.error || 'UNKNOWN', data.message || 'Script báo lỗi không rõ nguyên nhân.');
  }
  return data;
}

export function ping(conn) {
  return post(conn, { action: 'ping' }, { timeoutMs: 15000 });
}

export function listModels(conn) {
  return post(conn, { action: 'listModels' });
}

export function translate(conn, text, context) {
  return post(conn, { action: 'translate', text, context });
}

export function transcribeAndTranslate(conn, audioBase64, mimeType, context) {
  return post(
    conn,
    { action: 'transcribeAndTranslate', audio: audioBase64, mimeType, context },
    { timeoutMs: 60000 }
  );
}

/**
 * Hàng đợi dịch: gộp các câu tới gần nhau thành một request, giữ ngữ cảnh,
 * retry với backoff, và tự giãn nhịp khi chạm rate limit.
 */
export class TranslationQueue {
  constructor(conn, { onResult, onError, onStateChange, mergeWindowMs = 400 }) {
    this.conn = conn;
    this.onResult = onResult;
    this.onError = onError;
    this.onStateChange = onStateChange || (() => {});
    this.mergeWindowMs = mergeWindowMs;

    this.pending = [];
    this.mergeTimer = null;
    this.running = false;
    this.context = [];
    this.throttleUntil = 0;
    this.stats = { requests: 0, tokensIn: 0, tokensOut: 0 };
  }

  setConnection(conn) {
    this.conn = conn;
  }

  push(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.pending.push(trimmed);

    // Gộp câu: chờ thêm một nhịp phòng khi câu tiếp theo tới ngay sau.
    clearTimeout(this.mergeTimer);
    this.mergeTimer = setTimeout(() => this.flush(), this.mergeWindowMs);
  }

  flush() {
    clearTimeout(this.mergeTimer);
    if (!this.pending.length || this.running) return;
    const batch = this.pending.join(' ');
    this.pending = [];
    this.run(batch);
  }

  async run(text) {
    this.running = true;
    this.onStateChange('translating');

    const waitFor = this.throttleUntil - Date.now();
    if (waitFor > 0) await sleep(waitFor);

    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await translate(this.conn, text, this.context.slice(-3));

        this.context.push(res.translation);
        if (this.context.length > 6) this.context.shift();

        this.stats.requests += 1;
        this.stats.tokensIn += res.usage?.in || 0;
        this.stats.tokensOut += res.usage?.out || 0;

        this.onResult({ source: res.source || text, translation: res.translation, stats: this.stats });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;

        // Lỗi cấu hình: retry vô nghĩa, dừng ngay.
        if (['UNAUTHORIZED', 'NO_API_KEY', 'BAD_DEPLOY', 'TOO_LARGE', 'BAD_REQUEST'].includes(err.code)) {
          break;
        }

        if (err.code === 'RATE_LIMIT') {
          // Giãn nhịp toàn cục thay vì đập liên tục vào hạn mức.
          this.throttleUntil = Date.now() + 15000;
          break;
        }

        await sleep(1000 * Math.pow(2, attempt));
      }
    }

    if (lastError) this.onError(lastError, text);

    this.running = false;
    this.onStateChange('idle');

    if (this.pending.length) this.flush();
  }

  reset() {
    clearTimeout(this.mergeTimer);
    this.pending = [];
    this.context = [];
    this.throttleUntil = 0;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
