// Render phụ đề, trạng thái và thông báo.

const $ = (id) => document.getElementById(id);

export const el = {
  statusDot: $('statusDot'),
  usage: $('usage'),
  controls: $('controls'),
  btnMic: $('btnMic'),
  btnTab: $('btnTab'),
  btnStop: $('btnStop'),
  btnSettings: $('btnSettings'),
  hint: $('hint'),
  notice: $('notice'),
  noticeText: $('noticeText'),
  noticeAction: $('noticeAction'),
  transcript: $('transcript'),
  empty: $('empty'),
  live: $('live'),
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
  dictNote: $('dictNote')
};

export const lines = [];

let autoScroll = true;
let lineSeq = 0;

export function setAutoScroll(on) {
  autoScroll = on;
  el.btnScroll.setAttribute('aria-pressed', String(on));
  el.btnScroll.textContent = on ? '↓ Tự cuộn' : '✋ Đang giữ';
  if (on) scrollToEnd();
}

export function isAutoScroll() {
  return autoScroll;
}

export function setStatus(state, hint) {
  el.statusDot.dataset.state = state;
  if (hint !== undefined) el.hint.textContent = hint;
}

export function setRunning(running) {
  el.btnMic.hidden = running;
  el.btnTab.hidden = running;
  el.btnStop.hidden = !running;
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

// Dòng đang chạy giữ hai phần: tiếng Anh nghe được và bản dịch nháp.
// Tách riêng vì hai luồng cập nhật độc lập với nhịp khác nhau.
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
    el.live.replaceChildren();
    return;
  }

  el.live.hidden = false;
  el.live.replaceChildren();

  // Bản nháp AI đã có thì ưu tiên nó; gợi nghĩa từ điển chỉ lấp chỗ trống
  // trong lúc chờ, vì nó đúng nghĩa từng từ nhưng chưa đúng ngữ pháp.
  const vi = liveDraft || liveGloss;
  if (vi) {
    const node = document.createElement('div');
    node.className = 'live-vi' + (liveDraft ? '' : ' gloss');
    node.textContent = vi;
    el.live.append(node);
  }

  if (liveSource) {
    const en = document.createElement('div');
    en.className = 'live-en';
    en.textContent = liveSource;
    el.live.append(en);
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
export function addLine({ source, translation, failed = false, pending = false }) {
  el.empty.hidden = true;

  const time = new Date();
  const id = ++lineSeq;
  lines.push({ id, source, translation, time, failed });

  const node = document.createElement('article');
  node.className = 'line' + (failed ? ' failed' : '') + (pending ? ' pending' : '');
  node.dataset.lineId = String(id);

  const vi = document.createElement('div');
  vi.className = 'vi';
  vi.textContent = translation || '';

  const en = document.createElement('div');
  en.className = 'en';
  en.textContent = source;

  const stamp = document.createElement('time');
  stamp.dateTime = time.toISOString();
  stamp.textContent = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  node.append(vi, en, stamp);
  el.transcript.append(node);

  if (autoScroll) scrollToEnd();
  return id;
}

/** Điền bản dịch vào dòng đã hiện sẵn. */
export function updateLine(id, { translation, failed = false }) {
  const node = el.transcript.querySelector(`[data-line-id="${id}"]`);
  if (!node) return;

  node.classList.remove('pending');
  node.classList.toggle('failed', failed);

  const vi = node.querySelector('.vi');
  if (vi) vi.textContent = translation;

  const rec = lines.find((l) => l.id === id);
  if (rec) {
    rec.translation = translation;
    rec.failed = failed;
  }

  if (autoScroll) scrollToEnd();
}

export function clearLines() {
  lines.length = 0;
  el.transcript.querySelectorAll('.line').forEach((n) => n.remove());
  el.empty.hidden = false;
  liveDraft = '';
  setInterim('');
}

export function updateUsage(stats) {
  if (!stats?.requests) {
    el.usage.hidden = true;
    return;
  }
  el.usage.hidden = false;
  el.usage.textContent = `${stats.requests} lượt · ${stats.tokensIn + stats.tokensOut} token`;
}

function scrollToEnd() {
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

export function buildTranscriptText(format) {
  const stamp = (t) => t.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (format === 'md') {
    const head = `# Biên bản phiên dịch\n\n_${new Date().toLocaleString('vi-VN')}_\n\n`;
    return head + lines
      .map((l) => `**[${stamp(l.time)}]** ${l.translation}\n\n> ${l.source}\n`)
      .join('\n');
  }

  return lines
    .map((l) => `[${stamp(l.time)}]\nVI: ${l.translation}\nEN: ${l.source}\n`)
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
