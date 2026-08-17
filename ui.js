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
  btnForget: $('btnForget')
};

export const lines = [];

let autoScroll = true;

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

export function setInterim(text) {
  if (!text) {
    el.live.hidden = true;
    el.live.textContent = '';
    return;
  }
  el.live.hidden = false;
  el.live.textContent = text;
  if (autoScroll) scrollToEnd();
}

export function addLine({ source, translation, failed = false }) {
  el.empty.hidden = true;

  const time = new Date();
  lines.push({ source, translation, time, failed });

  const node = document.createElement('article');
  node.className = 'line' + (failed ? ' failed' : '');

  const vi = document.createElement('div');
  vi.className = 'vi';
  vi.textContent = translation;

  const en = document.createElement('div');
  en.className = 'en';
  en.textContent = source;

  const stamp = document.createElement('time');
  stamp.dateTime = time.toISOString();
  stamp.textContent = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  node.append(vi, en, stamp);
  el.transcript.append(node);

  if (autoScroll) scrollToEnd();
}

export function clearLines() {
  lines.length = 0;
  el.transcript.querySelectorAll('.line').forEach((n) => n.remove());
  el.empty.hidden = false;
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
