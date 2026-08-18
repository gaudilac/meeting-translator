// Render phụ đề, trạng thái, đồng hồ chi phí và bảng model.

import { priceOf, costOf, formatUsd, formatRate, PRICING_UPDATED } from './pricing.js';

const $ = (id) => document.getElementById(id);

export const el = {
  statusDot: $('statusDot'),
  statusLabel: $('statusLabel'),
  meters: $('meters'),
  meterFree: $('meterFree'),
  meterPaid: $('meterPaid'),
  meterCost: $('meterCost'),
  launch: $('launch'),
  btnMic: $('btnMic'),
  btnTab: $('btnTab'),
  btnStop: $('btnStop'),
  btnSettings: $('btnSettings'),
  btnEngineFree: $('btnEngineFree'),
  btnEngineGemini: $('btnEngineGemini'),
  engineNote: $('engineNote'),
  engineModel: $('engineModel'),
  hint: $('hint'),
  notice: $('notice'),
  noticeText: $('noticeText'),
  noticeAction: $('noticeAction'),
  transcript: $('transcript'),
  empty: $('empty'),
  live: $('live'),
  liveBody: $('liveBody'),
  btnScroll: $('btnScroll'),
  btnSource: $('btnSource'),
  btnFont: $('btnFont'),
  btnExport: $('btnExport'),
  btnClear: $('btnClear'),
  settings: $('settings'),
  inpUrl: $('inpUrl'),
  inpToken: $('inpToken'),
  btnTest: $('btnTest'),
  testResult: $('testResult'),
  btnCopyCode: $('btnCopyCode'),
  btnForget: $('btnForget'),
  inpDraft: $('inpDraft'),
  draftLabel: $('draftLabel'),
  draftNote: $('draftNote'),
  dictNote: $('dictNote'),
  btnRefreshModels: $('btnRefreshModels'),
  btnEditPrices: $('btnEditPrices'),
  modelsResult: $('modelsResult'),
  modelList: $('modelList'),
  modelsEmpty: $('modelsEmpty'),
  priceStamp: $('priceStamp')
};

export const lines = [];

let autoScroll = true;
let lineSeq = 0;
let onRegen = null;

/** app.js đăng ký hàm xử lý khi người dùng bấm nút Gemini trên một dòng. */
export function setRegenHandler(fn) {
  onRegen = fn;
}

export function setAutoScroll(on) {
  autoScroll = on;
  el.btnScroll.setAttribute('aria-pressed', String(on));
  el.btnScroll.textContent = on ? '↓ Tự cuộn' : '✋ Đang giữ';
  if (on) scrollToEnd();
}

export function isAutoScroll() {
  return autoScroll;
}

const STATUS_LABEL = {
  idle: 'Chưa chạy',
  listening: 'Đang nghe',
  translating: 'Đang dịch',
  error: 'Lỗi'
};

export function setStatus(state, hint) {
  el.statusDot.dataset.state = state;
  el.statusLabel.textContent = STATUS_LABEL[state] || state;
  if (hint !== undefined) el.hint.textContent = hint;
}

export function setRunning(running) {
  el.btnMic.hidden = running;
  el.btnTab.hidden = running;
  el.btnStop.hidden = !running;
}

export function setEngine(engine, model) {
  const free = engine === 'free';
  el.btnEngineFree.setAttribute('aria-pressed', String(free));
  el.btnEngineGemini.setAttribute('aria-pressed', String(!free));

  el.engineNote.textContent = free
    ? 'Google Translate trong Apps Script của bạn. Không tốn API, dịch từng câu rời.'
    : 'Gemini hiểu ngữ cảnh câu trước, văn phong tự nhiên hơn. Mỗi câu tính tiền theo token.';

  el.engineModel.hidden = free || !model;
  if (model) el.engineModel.textContent = model;
}

export function showNotice(message, { kind = 'error', actionLabel, onAction } = {}) {
  el.notice.hidden = false;
  el.notice.dataset.kind = kind;
  el.noticeText.textContent = message;

  if (actionLabel && onAction) {
    el.noticeAction.hidden = false;
    el.noticeAction.textContent = actionLabel;
    el.noticeAction.onclick = onAction;
  } else {
    el.noticeAction.hidden = true;
    el.noticeAction.onclick = null;
  }
}

export function hideNotice() {
  el.notice.hidden = true;
}

// Dòng đang chạy giữ ba phần: tiếng Anh nghe được, bản nháp AI, gợi nghĩa
// từ điển. Tách riêng vì ba luồng cập nhật độc lập với nhịp khác nhau.
let liveSource = '';
let liveDraft = '';
let liveGloss = '';

export function setInterim(text) {
  liveSource = text || '';
  if (!liveSource) {
    liveDraft = '';
    liveGloss = '';
  }
  renderLive();
}

export function setDraft(translation) {
  liveDraft = translation || '';
  renderLive();
}

export function setGloss(text) {
  liveGloss = text || '';
  renderLive();
}

function renderLive() {
  if (!liveSource && !liveDraft && !liveGloss) {
    el.live.hidden = true;
    el.liveBody.replaceChildren();
    return;
  }

  el.live.hidden = false;
  el.liveBody.replaceChildren();

  // Bản nháp AI đã có thì ưu tiên nó; gợi nghĩa từ điển chỉ lấp chỗ trống
  // trong lúc chờ, vì nó đúng nghĩa từng từ nhưng chưa đúng ngữ pháp.
  const vi = liveDraft || liveGloss;
  if (vi) {
    const node = document.createElement('div');
    node.className = 'live-vi' + (liveDraft ? '' : ' gloss');
    node.textContent = vi;
    el.liveBody.append(node);
  }

  if (liveSource) {
    const en = document.createElement('div');
    en.className = 'live-en';
    en.textContent = liveSource;
    el.liveBody.append(en);
  }

  if (autoScroll) scrollToEnd();
}

/**
 * Thêm dòng vào lịch sử.
 *
 * Trả về id để cập nhật sau: câu tiếng Anh được đưa vào lịch sử NGAY khi
 * người nói dứt câu, không đợi bản dịch từ mạng về. Nếu đợi, dòng lịch sử
 * chỉ xuất hiện sau vài giây và người đọc tưởng hệ thống bị treo.
 */
export function addLine({ source, translation, engine = 'free', failed = false, pending = false }) {
  el.empty.hidden = true;

  const time = new Date();
  const id = ++lineSeq;
  lines.push({ id, source, translation, time, failed, engine });

  const node = document.createElement('article');
  node.className = 'line' + (failed ? ' failed' : '') + (pending ? ' pending' : '');
  node.dataset.lineId = String(id);
  node.dataset.engine = engine;

  node.append(buildGutter(id), buildBody({ source, translation, time }));
  el.transcript.append(node);

  if (autoScroll) scrollToEnd();
  return id;
}

/**
 * Rãnh dọc bên trái: vừa cho biết dòng này dịch bằng gì, vừa là chỗ bấm để
 * gọi Gemini dịch lại. Gộp làm một vì cùng trả lời một câu hỏi.
 */
function buildGutter(id) {
  const gutter = document.createElement('div');
  gutter.className = 'gutter';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-regen';
  btn.textContent = '◈';
  btn.title = 'Dịch lại bằng Gemini';
  btn.setAttribute('aria-label', 'Dịch lại câu này bằng Gemini');
  btn.addEventListener('click', () => onRegen?.(id));

  gutter.append(btn);
  return gutter;
}

function buildBody({ source, translation, time }) {
  const body = document.createElement('div');

  const vi = document.createElement('div');
  vi.className = 'vi';
  vi.textContent = translation || '';

  const en = document.createElement('div');
  en.className = 'en';
  en.textContent = source;

  const stamp = document.createElement('time');
  stamp.dateTime = time.toISOString();
  stamp.textContent = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  body.append(vi, en, stamp);
  return body;
}

/** Điền hoặc thay bản dịch của một dòng đã hiện sẵn. */
export function updateLine(id, { translation, engine, failed = false, upgraded = false }) {
  const node = el.transcript.querySelector(`[data-line-id="${id}"]`);
  if (!node) return;

  node.classList.remove('pending');
  node.classList.toggle('failed', failed);
  if (engine) node.dataset.engine = engine;

  const vi = node.querySelector('.vi');
  if (vi) vi.textContent = translation;

  // Nháy nhẹ để mắt bắt được dòng vừa đổi khi người dùng chủ động bấm dịch lại.
  if (upgraded) {
    node.classList.remove('just-upgraded');
    void node.offsetWidth; // ép trình duyệt chạy lại animation
    node.classList.add('just-upgraded');
  }

  const rec = lines.find((l) => l.id === id);
  if (rec) {
    rec.translation = translation;
    rec.failed = failed;
    if (engine) rec.engine = engine;
  }

  if (autoScroll) scrollToEnd();
}

export function getLine(id) {
  return lines.find((l) => l.id === id) || null;
}

export function setRegenBusy(id, busy) {
  const btn = el.transcript.querySelector(`[data-line-id="${id}"] .btn-regen`);
  if (!btn) return;
  btn.disabled = busy;
  if (busy) btn.dataset.busy = '1';
  else delete btn.dataset.busy;
}

export function clearLines() {
  lines.length = 0;
  el.transcript.querySelectorAll('.line').forEach((n) => n.remove());
  el.empty.hidden = false;
  liveDraft = '';
  setInterim('');
}

/**
 * Đồng hồ chi phí. Tách riêng lượt miễn phí và lượt Gemini vì chỉ lượt Gemini
 * mới tốn tiền — gộp chung sẽ làm người dùng tưởng cả hai đều tính phí.
 */
export function updateUsage(stats, model) {
  if (!stats?.requests) {
    el.meters.hidden = true;
    return;
  }

  el.meters.hidden = false;
  el.meterFree.textContent = String(stats.freeRequests || 0);

  const paid = stats.requests - (stats.freeRequests || 0);
  el.meterPaid.textContent = String(paid);

  const usd = model ? costOf(model, stats.tokensIn, stats.tokensOut) : null;
  el.meterCost.textContent = paid === 0 ? '$0' : usd == null ? '—' : formatUsd(usd);
  el.meterCost.title = usd == null && paid > 0
    ? 'Chưa có đơn giá cho model này trong bảng giá nhúng sẵn.'
    : `${stats.tokensIn + stats.tokensOut} token`;
}

// ------------------------------------------------------------- bảng model

/**
 * Vẽ danh sách model kèm đơn giá.
 *
 * Model nào không có trong bảng giá thì ghi rõ "chưa rõ giá" — thà nói không
 * biết còn hơn đoán, vì con số này dẫn tới ước tính chi phí người dùng phải trả.
 */
export function renderModels(models, current, onPick) {
  el.priceStamp.textContent = `giá cập nhật ${PRICING_UPDATED}`;

  if (!models?.length) {
    el.modelList.replaceChildren(el.modelsEmpty);
    el.modelsEmpty.hidden = false;
    return;
  }

  const rows = models.map((m) => {
    const row = document.createElement('label');
    row.className = 'model-row';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'gemini-model';
    radio.value = m.name;
    radio.checked = m.name === current;
    radio.addEventListener('change', () => onPick(m.name));

    const mid = document.createElement('div');
    const id = document.createElement('div');
    id.className = 'model-id';
    id.textContent = m.name;

    const price = priceOf(m.name);
    if (price) {
      const pill = document.createElement('span');
      pill.className = 'tierpill';
      pill.dataset.tier = price.tier;
      pill.textContent = price.tier;
      id.append(pill);
    }

    const meta = document.createElement('div');
    meta.className = 'model-meta';
    meta.textContent = buildMeta(m, price);

    mid.append(id, meta);

    const cost = document.createElement('div');
    cost.className = 'model-price';
    if (price) {
      const inp = document.createElement('div');
      inp.className = 'in';
      inp.textContent = 'vào ' + formatRate(price.in);
      const outp = document.createElement('div');
      outp.className = 'out';
      outp.textContent = 'ra ' + formatRate(price.out);
      cost.append(inp, outp);
    } else {
      const unknown = document.createElement('div');
      unknown.className = 'unknown';
      unknown.textContent = 'chưa rõ giá';
      cost.append(unknown);
    }

    row.append(radio, mid, cost);
    return row;
  });

  el.modelList.replaceChildren(...rows);
}

function buildMeta(m, price) {
  const bits = [];
  if (m.inputLimit) bits.push('ngữ cảnh ' + formatTokens(m.inputLimit));
  if (price?.source === 'custom') bits.push('giá bạn tự nhập');
  else if (price?.source === 'alias') bits.push(`cùng giá ${price.aliasOf}`);
  return bits.join(' · ');
}

/** 1048576 → "1M" chứ không phải "1049K" — số tròn dễ đọc hơn số chính xác. */
function formatTokens(n) {
  if (n >= 1e6) {
    const m = n / 1e6;
    return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + 'M';
  }
  return Math.round(n / 1000) + 'K';
}

export function setModelsResult(state, message) {
  el.modelsResult.textContent = message;
  if (state) el.modelsResult.dataset.state = state;
  else el.modelsResult.removeAttribute('data-state');
}

function scrollToEnd() {
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

export function buildTranscriptText(format) {
  const stamp = (t) => t.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const mark = (l) => (l.engine === 'gemini' ? 'Gemini' : 'Google Translate');

  if (format === 'md') {
    const head = `# Biên bản phiên dịch\n\n_${new Date().toLocaleString('vi-VN')}_\n\n`;
    return head + lines
      .map((l) => `**[${stamp(l.time)}]** ${l.translation}\n\n> ${l.source}\n>\n> _${mark(l)}_\n`)
      .join('\n');
  }

  return lines
    .map((l) => `[${stamp(l.time)}] (${mark(l)})\nVI: ${l.translation}\nEN: ${l.source}\n`)
    .join('\n');
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
