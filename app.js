// Điều phối: nguồn âm thanh → nhận dạng → hàng đợi dịch → phụ đề.

import * as ui from './ui.js';
import {
  captureMicrophone,
  captureTabAudio,
  stopStream,
  supportsTabAudio,
  isMobile,
  ChunkRecorder,
  blobToBase64,
  AudioError
} from './audio.js';
import { Recognizer, supportsSpeechRecognition } from './recognizer.js';
import {
  loadConnection,
  saveConnection,
  clearConnection,
  ping,
  transcribeAndTranslate,
  TranslationQueue,
  GasError
} from './gasClient.js';

const state = {
  conn: loadConnection(),
  stream: null,
  recognizer: null,
  recorder: null,
  queue: null,
  wakeLock: null,
  running: false,
  fontSize: localStorage.getItem('mt.font') || 'medium',
  showSource: localStorage.getItem('mt.source') !== 'off'
};

// ------------------------------------------------------------------ khởi tạo

function init() {
  applyPreferences();

  if (!supportsTabAudio) {
    ui.el.btnTab.disabled = true;
    ui.el.btnTab.title = isMobile
      ? 'Điện thoại không chia sẻ được âm thanh tab'
      : 'Trình duyệt này không hỗ trợ chia sẻ âm thanh tab';
  }

  if (state.conn) {
    ui.el.inpUrl.value = state.conn.url;
    ui.el.inpToken.value = state.conn.token;
  } else {
    openSettings();
    ui.showNotice('Chưa kết nối Apps Script. Làm theo các bước trong phần Cài đặt để bắt đầu.', { kind: 'warn' });
  }

  bindEvents();
  ui.setStatus('idle');
}

function applyPreferences() {
  document.documentElement.dataset.font = state.fontSize;
  document.body.dataset.source = state.showSource ? 'on' : 'off';

  const labels = { small: 'Nhỏ', medium: 'Vừa', large: 'Lớn' };
  ui.el.btnFont.textContent = 'Cỡ chữ: ' + labels[state.fontSize];
  ui.el.btnSource.setAttribute('aria-pressed', String(state.showSource));
  ui.el.btnSource.textContent = state.showSource ? 'Hiện tiếng Anh' : 'Ẩn tiếng Anh';
}

// ------------------------------------------------------------------ sự kiện

function bindEvents() {
  ui.el.btnMic.addEventListener('click', () => start('mic'));
  ui.el.btnTab.addEventListener('click', () => start('tab'));
  ui.el.btnStop.addEventListener('click', stop);

  ui.el.btnSettings.addEventListener('click', openSettings);
  ui.el.btnTest.addEventListener('click', testConnection);
  ui.el.btnCopyCode.addEventListener('click', copyGasCode);
  ui.el.btnForget.addEventListener('click', forgetConnection);

  ui.el.settings.addEventListener('close', () => {
    const url = ui.el.inpUrl.value.trim();
    const token = ui.el.inpToken.value.trim();
    if (url && token) {
      saveConnection(url, token);
      state.conn = loadConnection();
      state.queue?.setConnection(state.conn);
      ui.hideNotice();
    }
  });

  ui.el.btnScroll.addEventListener('click', () => ui.setAutoScroll(!ui.isAutoScroll()));

  ui.el.btnSource.addEventListener('click', () => {
    state.showSource = !state.showSource;
    localStorage.setItem('mt.source', state.showSource ? 'on' : 'off');
    applyPreferences();
  });

  ui.el.btnFont.addEventListener('click', () => {
    const order = ['small', 'medium', 'large'];
    state.fontSize = order[(order.indexOf(state.fontSize) + 1) % order.length];
    localStorage.setItem('mt.font', state.fontSize);
    applyPreferences();
  });

  ui.el.btnExport.addEventListener('click', exportTranscript);

  ui.el.btnClear.addEventListener('click', () => {
    if (ui.lines.length && !confirm('Xoá toàn bộ nội dung đã dịch?')) return;
    ui.clearLines();
    state.queue?.reset();
  });

  // Người dùng cuộn lên để đọc lại thì ngừng tự cuộn, tránh bị giật xuống.
  ui.el.transcript.addEventListener('scroll', () => {
    const nearBottom =
      ui.el.transcript.scrollHeight - ui.el.transcript.scrollTop - ui.el.transcript.clientHeight < 60;
    if (!nearBottom && ui.isAutoScroll()) ui.setAutoScroll(false);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.running) e.preventDefault();
  });
}

// ------------------------------------------------------------------ chạy

async function start(source) {
  if (!state.conn) {
    ui.showNotice('Cần kết nối Apps Script trước khi bắt đầu.', {
      kind: 'warn',
      actionLabel: 'Mở cài đặt',
      onAction: openSettings
    });
    openSettings();
    return;
  }

  ui.hideNotice();

  try {
    state.stream = source === 'mic' ? await captureMicrophone() : await captureTabAudio();
  } catch (err) {
    if (err instanceof AudioError) {
      ui.showNotice(err.message, { kind: err.code === 'DENIED' ? 'warn' : 'error' });
    } else {
      ui.showNotice('Không mở được nguồn âm thanh: ' + err.message);
    }
    return;
  }

  // Người dùng bấm "Stop sharing" của Chrome thì dừng luôn phiên.
  state.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    if (state.running) stop();
  });

  state.queue = new TranslationQueue(state.conn, {
    onResult: ({ source: src, translation, stats }) => {
      ui.setInterim('');
      ui.addLine({ source: src, translation });
      ui.updateUsage(stats);
    },
    onError: (err, text) => {
      handleTranslationError(err, text);
    },
    onStateChange: (s) => {
      if (!state.running) return;
      ui.setStatus(s === 'translating' ? 'translating' : 'listening');
    }
  });

  state.running = true;
  ui.setRunning(true);
  ui.setAutoScroll(true);
  await requestWakeLock();

  if (supportsSpeechRecognition && source === 'mic') {
    startRecognizer();
    ui.setStatus('listening', 'Đang nghe từ micro. Nói tiếng Anh để xem bản dịch.');
  } else {
    // Tab audio và trình duyệt không có Web Speech API đều đi đường gửi audio.
    startRecorder();
    ui.setStatus(
      'listening',
      source === 'tab'
        ? 'Đang nghe âm thanh tab. Bản dịch xuất hiện sau mỗi vài giây.'
        : 'Trình duyệt này không có nhận dạng giọng nói sẵn — đang gửi âm thanh đi dịch, trễ hơn một chút.'
    );
  }
}

function startRecognizer() {
  state.recognizer = new Recognizer({
    onInterim: (text) => ui.setInterim(text),
    onFinal: (text) => {
      ui.setInterim('');
      state.queue.push(text);
    },
    onError: (err) => {
      ui.showNotice(err.message, { kind: 'warn' });
    }
  });
  state.recognizer.start();
}

function startRecorder() {
  state.recorder = new ChunkRecorder(state.stream, {
    chunkMs: 6000,
    onChunk: async (blob, mimeType) => {
      if (!state.running) return;
      try {
        ui.setStatus('translating');
        const base64 = await blobToBase64(blob);
        const res = await transcribeAndTranslate(
          state.conn,
          base64,
          mimeType.split(';')[0],
          state.queue.context.slice(-3)
        );

        if (!res.translation?.trim()) return; // đoạn im lặng

        state.queue.context.push(res.translation);
        if (state.queue.context.length > 6) state.queue.context.shift();

        state.queue.stats.requests += 1;
        state.queue.stats.tokensIn += res.usage?.in || 0;
        state.queue.stats.tokensOut += res.usage?.out || 0;

        ui.addLine({ source: res.source || '(âm thanh)', translation: res.translation });
        ui.updateUsage(state.queue.stats);
      } catch (err) {
        handleTranslationError(err, '(đoạn âm thanh)');
      } finally {
        if (state.running) ui.setStatus('listening');
      }
    }
  });
  state.recorder.start();
}

function stop() {
  state.running = false;

  state.recognizer?.stop();
  state.recognizer = null;

  state.recorder?.stop();
  state.recorder = null;

  state.queue?.flush();

  stopStream(state.stream);
  state.stream = null;

  releaseWakeLock();

  ui.setRunning(false);
  ui.setInterim('');
  ui.setStatus('idle', 'Đã dừng. Nội dung đã dịch vẫn được giữ lại bên dưới.');
}

// ------------------------------------------------------------------ lỗi

function handleTranslationError(err, text) {
  const code = err instanceof GasError ? err.code : 'UNKNOWN';

  if (code === 'UNAUTHORIZED' || code === 'NO_API_KEY' || code === 'BAD_DEPLOY') {
    ui.showNotice(err.message, {
      kind: 'error',
      actionLabel: 'Mở cài đặt',
      onAction: openSettings
    });
    if (state.running) stop();
    return;
  }

  if (code === 'RATE_LIMIT') {
    ui.showNotice(err.message + ' Đang tự giãn nhịp gửi.', { kind: 'warn' });
    return;
  }

  ui.showNotice(err.message, { kind: 'error' });
  ui.addLine({ source: text, translation: '⚠ Không dịch được đoạn này', failed: true });
}

// ------------------------------------------------------------------ cài đặt

function openSettings() {
  ui.el.testResult.textContent = '';
  ui.el.testResult.removeAttribute('data-state');
  ui.el.settings.showModal();
}

async function testConnection() {
  const url = ui.el.inpUrl.value.trim();
  const token = ui.el.inpToken.value.trim();

  if (!url || !token) {
    setTestResult('fail', 'Cần điền cả URL và token.');
    return;
  }
  if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(url)) {
    setTestResult('fail', 'URL phải là link Web App kết thúc bằng /exec.');
    return;
  }

  ui.el.btnTest.disabled = true;
  setTestResult('', 'Đang kiểm tra...');

  try {
    const res = await ping({ url, token });
    if (res.ready) {
      setTestResult('ok', `Kết nối thành công · model ${res.model}`);
      saveConnection(url, token);
      state.conn = loadConnection();
      state.queue?.setConnection(state.conn);
      ui.hideNotice();
    } else {
      setTestResult('fail', 'Script chạy được nhưng chưa có API key. Chạy setKey("AIza...") trong editor.');
    }
  } catch (err) {
    setTestResult('fail', err.message);
  } finally {
    ui.el.btnTest.disabled = false;
  }
}

function setTestResult(stateName, message) {
  ui.el.testResult.textContent = message;
  if (stateName) ui.el.testResult.dataset.state = stateName;
  else ui.el.testResult.removeAttribute('data-state');
}

async function copyGasCode() {
  try {
    const res = await fetch('gas/Code.gs');
    if (!res.ok) throw new Error('không tải được');
    await navigator.clipboard.writeText(await res.text());
    ui.el.btnCopyCode.textContent = 'Đã sao chép ✓';
  } catch {
    ui.el.btnCopyCode.textContent = 'Mở file gas/Code.gs và copy thủ công';
  }
  setTimeout(() => {
    ui.el.btnCopyCode.textContent = 'Sao chép Code.gs';
  }, 3000);
}

function forgetConnection() {
  if (!confirm('Xoá URL và token khỏi trình duyệt này?')) return;
  clearConnection();
  state.conn = null;
  ui.el.inpUrl.value = '';
  ui.el.inpToken.value = '';
  setTestResult('', 'Đã xoá kết nối khỏi máy này.');
}

// ------------------------------------------------------------------ tiện ích

function exportTranscript() {
  if (!ui.lines.length) {
    ui.showNotice('Chưa có nội dung nào để tải.', { kind: 'warn' });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  ui.download(`phien-dich-${stamp}.md`, ui.buildTranscriptText('md'));
}

async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // Không giữ được màn hình sáng cũng không ảnh hưởng việc dịch.
  }
}

function releaseWakeLock() {
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
}

// Wake lock mất khi chuyển tab, xin lại khi quay về.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running && !state.wakeLock) {
    requestWakeLock();
  }
});

init();
