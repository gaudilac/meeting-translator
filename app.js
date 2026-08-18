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
import * as dictionary from './dictionary.js';
import {
  loadConnection,
  saveConnection,
  clearConnection,
  ping,
  translate,
  listModels,
  setModel as saveModel,
  transcribeAndTranslate,
  TranslationQueue,
  GasError
} from './gasClient.js';
import { setPrice, priceOf, PRICING_SOURCE } from './pricing.js';

const state = {
  conn: loadConnection(),
  stream: null,
  recognizer: null,
  recorder: null,
  queue: null,
  wakeLock: null,
  running: false,
  fontSize: localStorage.getItem('mt.font') || 'medium',
  showSource: localStorage.getItem('mt.source') !== 'off',
  draftInterval: Number(localStorage.getItem('mt.draftInterval') ?? 1200),
  // Miễn phí là mặc định: mở web lên là chạy được, không tốn đồng nào.
  engine: localStorage.getItem('mt.engine') || 'free',
  model: localStorage.getItem('mt.model') || null,
  models: [],
  // Đồng hồ sống lâu hơn phiên chạy: bấm ◈ dịch lại sau khi đã dừng vẫn phải
  // được tính tiền, nếu không con số chi phí sẽ thấp hơn thực tế.
  stats: { requests: 0, tokensIn: 0, tokensOut: 0, freeRequests: 0 }
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
  ui.setRegenHandler(regenerateLine);
  ui.setStatus('idle');

  // Tải nền: chưa xong thì chỉ mất phần gợi nghĩa tức thì, không chặn gì.
  dictionary.load().then(() => {
    const n = dictionary.size();
    if (n) ui.el.dictNote.textContent = `Từ điển: ${n.toLocaleString('vi-VN')} từ, tra tức thì không tốn API.`;
  });

  // Hỏi script xem nó đang dùng model nào, để đồng hồ chi phí có đơn giá ngay
  // mà người dùng không phải mở bảng model.
  if (state.conn && !state.model) {
    ping(state.conn)
      .then((res) => {
        if (!res.model || state.model) return;
        state.model = res.model;
        ui.setEngine(state.engine, state.model);
      })
      .catch(() => {
        // Không hỏi được thì thôi, người dùng vẫn chọn tay được trong Cài đặt.
      });
  }
}

function applyPreferences() {
  document.documentElement.dataset.font = state.fontSize;
  document.body.dataset.source = state.showSource ? 'on' : 'off';

  const labels = { small: 'Nhỏ', medium: 'Vừa', large: 'Lớn', xlarge: 'Rất lớn' };
  ui.el.btnFont.textContent = 'Cỡ chữ: ' + labels[state.fontSize];
  ui.el.btnSource.setAttribute('aria-pressed', String(state.showSource));
  ui.el.btnSource.textContent = state.showSource ? 'Hiện tiếng Anh' : 'Ẩn tiếng Anh';

  ui.el.inpDraft.value = String(state.draftInterval);
  ui.setEngine(state.engine, state.model);
  renderDraftSetting();
}

function setEngine(engine) {
  state.engine = engine;
  localStorage.setItem('mt.engine', engine);
  state.queue?.setEngine(engine);
  ui.setEngine(engine, state.model);
  renderDraftSetting();
}

// Nói rõ đánh đổi ngay tại thanh trượt: nhịp càng dày thì càng mượt
// nhưng càng tốn tiền, và người dùng là người trả tiền cho API.
function renderDraftSetting() {
  const ms = state.draftInterval;
  const free = state.engine === 'free';

  if (ms === 0) {
    ui.el.draftLabel.textContent = 'tắt';
    ui.el.draftNote.textContent =
      'Chỉ dịch khi người nói dứt câu. Rẻ nhất, nhưng tiếng Việt hiện thành từng cục.';
    return;
  }

  ui.el.draftLabel.textContent = 'mỗi ' + (ms / 1000).toFixed(1).replace('.', ',') + ' giây';

  if (free) {
    ui.el.draftNote.textContent = ms <= 800
      ? 'Rất mượt. Chế độ miễn phí không tính tiền, nhưng nhịp dày ăn nhiều hạn mức Apps Script mỗi ngày.'
      : 'Chế độ miễn phí không tính tiền theo nhịp này.';
    return;
  }

  if (ms <= 800) {
    ui.el.draftNote.textContent = 'Rất mượt, gần như phiên dịch thật. Tốn API nhất — dễ chạm hạn mức gói miễn phí.';
  } else if (ms <= 1600) {
    ui.el.draftNote.textContent = 'Cân bằng giữa độ mượt và chi phí. Phù hợp cho hầu hết cuộc họp.';
  } else {
    ui.el.draftNote.textContent = 'Tiết kiệm API, tiếng Việt cập nhật chậm và giật hơn.';
  }
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

  ui.el.btnEngineFree.addEventListener('click', () => setEngine('free'));
  ui.el.btnEngineGemini.addEventListener('click', () => setEngine('gemini'));

  ui.el.btnRefreshModels.addEventListener('click', refreshModels);
  ui.el.btnEditPrices.addEventListener('click', editPrice);

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
    const order = ['small', 'medium', 'large', 'xlarge'];
    state.fontSize = order[(order.indexOf(state.fontSize) + 1) % order.length];
    localStorage.setItem('mt.font', state.fontSize);
    applyPreferences();
  });

  ui.el.inpDraft.addEventListener('input', () => {
    state.draftInterval = Number(ui.el.inpDraft.value);
    localStorage.setItem('mt.draftInterval', String(state.draftInterval));
    state.queue?.setDraftInterval(state.draftInterval);
    renderDraftSetting();
  });

  ui.el.btnExport.addEventListener('click', exportTranscript);

  ui.el.btnClear.addEventListener('click', () => {
    if (ui.lines.length && !confirm('Xoá toàn bộ nội dung đã dịch?')) return;
    ui.clearLines();
    state.queue?.reset();
    ui.updateUsage(state.stats, state.model);
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
    draftIntervalMs: state.draftInterval,
    engine: state.engine,
    model: state.model,
    stats: state.stats,
    onPending: ({ source: src }) => {
      ui.setInterim('');
      // Hiện dòng ngay với gợi nghĩa từ điển, rồi thay bằng bản dịch khi về.
      const gloss = dictionary.glossSentence(src);
      return ui.addLine({
        source: src,
        translation: gloss && gloss.coverage >= 0.5 ? gloss.text : '',
        engine: state.engine,
        pending: true
      });
    },
    onResult: ({ ticket, source: src, translation, engine, stats }) => {
      ui.setInterim('');
      if (ticket) ui.updateLine(ticket, { translation, engine });
      else ui.addLine({ source: src, translation, engine });
      ui.updateUsage(stats, state.model);
    },
    onDraft: ({ translation, stats }) => {
      ui.setDraft(translation);
      ui.updateUsage(stats, state.model);
    },
    onError: (err, text, ticket) => {
      handleTranslationError(err, text, ticket);
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
    ui.setStatus(
      'listening',
      state.engine === 'free'
        ? 'Đang nghe từ micro, dịch miễn phí bằng Google Translate. Bấm ◈ trên câu nào cần Gemini dịch lại.'
        : 'Đang nghe từ micro, dịch bằng Gemini. Mỗi câu tính tiền theo token.'
    );
  } else {
    // Tab audio và trình duyệt không có Web Speech API đều đi đường gửi audio.
    // Google Translate không nhận dạng được giọng nói, nên đường này bắt buộc
    // dùng Gemini — phải nói rõ vì người dùng đang chọn chế độ miễn phí.
    startRecorder();
    ui.setStatus(
      'listening',
      source === 'tab'
        ? 'Đang nghe âm thanh tab. Đường này bắt buộc dùng Gemini và có tính tiền — Google Translate không nhận dạng được giọng nói.'
        : 'Trình duyệt này không có nhận dạng giọng nói sẵn — đang gửi âm thanh cho Gemini, có tính tiền và trễ hơn một chút.'
    );
  }
}

function startRecognizer() {
  state.recognizer = new Recognizer({
    onInterim: (text) => {
      ui.setInterim(text);

      // Gợi nghĩa từ từ điển hiện NGAY, không chờ mạng — đây là thứ giữ cho
      // tiếng Việt bám kịp tiếng Anh. Bản nháp từ AI tới sau sẽ thay nó.
      const gloss = dictionary.glossSentence(text);
      if (gloss && gloss.coverage >= 0.5) ui.setGloss(gloss.text);

      state.queue.pushDraft(text);
    },
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
          state.queue.context.slice(-3),
          state.model
        );

        if (!res.translation?.trim()) return; // đoạn im lặng

        state.queue.context.push(res.translation);
        if (state.queue.context.length > 6) state.queue.context.shift();

        state.stats.requests += 1;
        state.stats.tokensIn += res.usage?.in || 0;
        state.stats.tokensOut += res.usage?.out || 0;

        // Nhận dạng âm thanh chỉ Gemini làm được, nên dòng này luôn là Gemini
        // dù người dùng đang để chế độ miễn phí.
        ui.addLine({ source: res.source || '(âm thanh)', translation: res.translation, engine: 'gemini' });
        ui.updateUsage(state.stats, state.model);
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

// -------------------------------------------------------- dịch lại bằng Gemini

/**
 * Người dùng bấm ◈ trên một dòng: gọi Gemini dịch lại câu đó.
 *
 * Đây là điểm chính của chế độ miễn phí — cả cuộc họp chạy không tốn tiền,
 * chỉ trả tiền cho đúng những câu người dùng thấy cần chính xác hơn.
 */
async function regenerateLine(id) {
  const line = ui.getLine(id);
  if (!line) return;

  if (!state.conn) {
    ui.showNotice('Cần kết nối Apps Script để dùng Gemini.', {
      kind: 'warn',
      actionLabel: 'Mở cài đặt',
      onAction: openSettings
    });
    return;
  }

  ui.setRegenBusy(id, true);

  try {
    // Lấy các câu quanh nó làm ngữ cảnh — đây chính là thứ Google Translate
    // không có, và là lý do bản Gemini đọc mượt hơn.
    const idx = ui.lines.findIndex((l) => l.id === id);
    const context = ui.lines.slice(Math.max(0, idx - 3), idx).map((l) => l.translation).filter(Boolean);

    const res = await translate(state.conn, line.source, context, state.model);

    ui.updateLine(id, {
      translation: res.translation,
      engine: 'gemini',
      upgraded: true
    });

    state.stats.requests += 1;
    state.stats.tokensIn += res.usage?.in || 0;
    state.stats.tokensOut += res.usage?.out || 0;
    ui.updateUsage(state.stats, state.model);
  } catch (err) {
    const msg = err instanceof GasError ? err.message : 'Không dịch lại được câu này.';
    ui.showNotice(msg, {
      kind: err.code === 'RATE_LIMIT' ? 'warn' : 'error',
      ...(err.code === 'NO_API_KEY' || err.code === 'UNAUTHORIZED'
        ? { actionLabel: 'Mở cài đặt', onAction: openSettings }
        : {})
    });
  } finally {
    ui.setRegenBusy(id, false);
  }
}

// --------------------------------------------------------------- bảng model

/**
 * Tải danh sách model mà API key thực sự dùng được.
 *
 * Nút này KHÔNG tải giá — Google không có API giá công khai. Nó làm mới danh
 * sách model, còn đơn giá lấy từ bảng nhúng trong pricing.js.
 */
async function refreshModels() {
  if (!state.conn) {
    ui.setModelsResult('fail', 'Cần kết nối Apps Script trước.');
    return;
  }

  ui.el.btnRefreshModels.disabled = true;
  ui.setModelsResult('', 'Đang tải...');

  try {
    const res = await listModels(state.conn);
    state.models = res.models || [];

    if (!state.model && res.current) state.model = res.current;

    const known = state.models.filter((m) => priceOf(m.name)).length;
    ui.renderModels(state.models, state.model, pickModel);
    ui.setModelsResult(
      'ok',
      `${state.models.length} model · ${known} có sẵn đơn giá`
    );
    ui.setEngine(state.engine, state.model);
  } catch (err) {
    ui.setModelsResult('fail', err.message);
  } finally {
    ui.el.btnRefreshModels.disabled = false;
  }
}

async function pickModel(name) {
  state.model = name;
  localStorage.setItem('mt.model', name);
  state.queue?.setModel(name);
  ui.setEngine(state.engine, name);
  ui.updateUsage(state.stats, name);

  // Lưu cả về script để đường tab audio và lần mở sau dùng đúng model này.
  try {
    await saveModel(state.conn, name);
  } catch {
    // Không lưu được thì model vẫn áp dụng cho phiên này qua tham số request.
  }
}

/** Bảng giá nhúng sẽ cũ dần — cho người dùng tự sửa khi Google đổi giá. */
function editPrice() {
  if (!state.model) {
    ui.setModelsResult('fail', 'Chọn một model trước khi sửa giá.');
    return;
  }

  const current = priceOf(state.model);
  const inp = prompt(
    `Đơn giá token VÀO của ${state.model}\n(USD trên 1 triệu token — xem ${PRICING_SOURCE})`,
    String(current?.in ?? '')
  );
  if (inp === null) return;

  const outp = prompt(
    `Đơn giá token RA của ${state.model}\n(USD trên 1 triệu token)`,
    String(current?.out ?? '')
  );
  if (outp === null) return;

  const a = Number(inp);
  const b = Number(outp);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
    ui.setModelsResult('fail', 'Đơn giá phải là số không âm.');
    return;
  }

  setPrice(state.model, a, b);
  ui.renderModels(state.models, state.model, pickModel);
  ui.updateUsage(state.stats, state.model);
  ui.setModelsResult('ok', 'Đã lưu đơn giá cho ' + state.model);
}

// ------------------------------------------------------------------ lỗi

function handleTranslationError(err, text, ticket) {
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

  // Hết hạn mức Google Translate: Gemini vẫn dùng được nên mời chuyển sang.
  if (code === 'FREE_LIMIT') {
    ui.showNotice(err.message, {
      kind: 'warn',
      actionLabel: 'Chuyển sang Gemini',
      onAction: () => {
        setEngine('gemini');
        ui.hideNotice();
      }
    });
    return;
  }

  ui.showNotice(err.message, { kind: 'error' });

  // Giữ lại gợi nghĩa từ điển nếu có — vẫn hơn là mất trắng câu đó.
  const gloss = dictionary.glossSentence(text);
  const fallback = gloss && gloss.coverage >= 0.5
    ? gloss.text + '  ⚠ (tra từ điển, máy dịch không trả kết quả)'
    : '⚠ Không dịch được đoạn này';

  if (ticket) ui.updateLine(ticket, { translation: fallback, failed: true });
  else ui.addLine({ source: text, translation: fallback, failed: true });
}

// ------------------------------------------------------------------ cài đặt

function openSettings() {
  ui.el.testResult.textContent = '';
  ui.el.testResult.removeAttribute('data-state');
  ui.setModelsResult('', '');
  if (state.models.length) ui.renderModels(state.models, state.model, pickModel);
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
      if (!state.model && res.model) {
        state.model = res.model;
        ui.setEngine(state.engine, state.model);
      }
      ui.hideNotice();
    } else {
      setTestResult('fail', 'Script chạy được nhưng chưa có API key. Dán key vào Script Properties (GEMINI_API_KEY) rồi chạy setup().');
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
