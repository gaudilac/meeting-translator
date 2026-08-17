/**
 * Meeting Translator — proxy Gemini API chạy trong tài khoản Google của bạn.
 *
 * CÀI ĐẶT (làm một lần):
 *   1. Chạy setup()      → dán Gemini API key khi được hỏi
 *   2. Deploy > New deployment > Web app
 *        Execute as:      Me
 *        Who has access:  Anyone          ← bắt buộc, xem README
 *   3. Chạy showSetup()  → copy URL và token dán vào web
 *
 * API key nằm trong UserProperties của tài khoản này và không rời khỏi đây.
 */

var MODEL_DEFAULT = 'gemini-2.0-flash';
var LIMIT_PER_MIN_DEFAULT = 60;
var LIMIT_PER_DAY_DEFAULT = 1000;
var MAX_TEXT_CHARS = 8000;
var MAX_AUDIO_BYTES = 8 * 1024 * 1024;

var P_KEY = 'GEMINI_API_KEY';
var P_TOKEN = 'CLIENT_TOKEN';
var P_MODEL = 'MODEL';
var P_MIN = 'LIMIT_PER_MIN';
var P_DAY = 'LIMIT_PER_DAY';

var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// ---------------------------------------------------------------- cài đặt

/**
 * BƯỚC 1 — thay DÁN_API_KEY_VÀO_ĐÂY bằng key thật của bạn rồi bấm Run.
 *
 * Lấy key tại https://aistudio.google.com/apikey
 * Giữ nguyên hai dấu nháy, chỉ thay phần chữ bên trong.
 *
 * Sau khi chạy thành công, xoá key khỏi dòng này — key đã được lưu an toàn
 * trong UserProperties, để lại trong code chỉ thêm rủi ro lộ.
 */
function setup() {
  setKey('DÁN_API_KEY_VÀO_ĐÂY');
  showSetup();
}

/** Đặt hoặc đổi API key. */
function setKey(apiKey) {
  var key = String(apiKey == null ? '' : apiKey).trim();

  if (!key || key === 'DÁN_API_KEY_VÀO_ĐÂY') {
    throw new Error(
      'Bạn chưa thay chỗ giữ chỗ bằng key thật.\n' +
      'Sửa dòng setKey(\'DÁN_API_KEY_VÀO_ĐÂY\') trong hàm setup(), dán key của bạn vào giữa hai dấu nháy rồi Run lại.\n' +
      'Lấy key tại: https://aistudio.google.com/apikey'
    );
  }

  // Không chặn theo tiền tố: key Gemini thường bắt đầu bằng "AIza" nhưng
  // không phải dạng nào cũng vậy. Chỉ loại các trường hợp chắc chắn sai,
  // rồi để verifyKey_() hỏi thẳng Google xem key có dùng được không.
  if (key.length < 20 || /\s/.test(key)) {
    throw new Error(
      'Key trông không đúng định dạng (quá ngắn hoặc có khoảng trắng).\n' +
      'Copy lại toàn bộ key từ https://aistudio.google.com/apikey, không kèm dấu nháy hay khoảng trắng thừa.'
    );
  }

  var check = verifyKey_(key);
  if (!check.ok) throw new Error(check.message);

  PropertiesService.getUserProperties().setProperty(P_KEY, key);
  ensureToken_();
  Logger.log('Đã lưu API key và xác nhận Google chấp nhận key này.');
}

/** Hỏi Google xem key có thật sự dùng được không — chắc chắn hơn đoán theo tiền tố. */
function verifyKey_(key) {
  var resp;
  try {
    resp = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key),
      { method: 'get', muteHttpExceptions: true }
    );
  } catch (e) {
    return { ok: false, message: 'Không kết nối được tới Google để kiểm tra key: ' + e.message };
  }

  var code = resp.getResponseCode();
  if (code === 200) return { ok: true };

  if (code === 400 || code === 401 || code === 403) {
    return {
      ok: false,
      message:
        'Google từ chối key này (HTTP ' + code + ').\n' +
        'Kiểm tra: key đã copy đủ chưa, còn hiệu lực không, và đã bật Generative Language API cho project chưa.\n' +
        'Tạo key mới tại: https://aistudio.google.com/apikey'
    };
  }

  return {
    ok: false,
    message: 'Google trả lỗi HTTP ' + code + ' khi kiểm tra key. Thử lại sau ít phút.'
  };
}

/** In ra URL Web App và token để dán vào web. */
function showSetup() {
  var props = PropertiesService.getUserProperties();
  var token = ensureToken_();
  var url = ScriptApp.getService().getUrl();

  var msg =
    '\n================ MEETING TRANSLATOR ================\n\n' +
    'URL   : ' + (url || '(chưa deploy — Deploy > New deployment > Web app)') + '\n' +
    'TOKEN : ' + token + '\n\n' +
    'API key: ' + (props.getProperty(P_KEY) ? 'đã lưu' : 'CHƯA CÓ — chạy setup()') + '\n' +
    'Model  : ' + (props.getProperty(P_MODEL) || MODEL_DEFAULT) + '\n\n' +
    'Dán URL và TOKEN vào phần Cài đặt của web.\n' +
    'Giữ token như mật khẩu. Nghi ngờ lộ thì chạy rotateToken().\n' +
    '===================================================\n';

  Logger.log(msg);
  return msg;
}

/** Đổi token mới. Sau khi chạy phải dán lại token vào web. */
function rotateToken() {
  PropertiesService.getUserProperties().deleteProperty(P_TOKEN);
  var token = ensureToken_();
  Logger.log('Token mới: ' + token + '\nDán lại vào web để tiếp tục dùng.');
  return token;
}

/** Đổi model dùng để dịch. */
function setModel(model) {
  PropertiesService.getUserProperties().setProperty(P_MODEL, String(model).trim());
  Logger.log('Model hiện tại: ' + model);
}

/** Đổi hạn mức. setLimits(60, 1000) = 60 request/phút, 1000/ngày. */
function setLimits(perMinute, perDay) {
  var props = PropertiesService.getUserProperties();
  props.setProperty(P_MIN, String(perMinute));
  props.setProperty(P_DAY, String(perDay));
  Logger.log('Hạn mức: ' + perMinute + '/phút, ' + perDay + '/ngày');
}

/** Xoá sạch API key và token khỏi tài khoản này. */
function resetAll() {
  PropertiesService.getUserProperties().deleteAllProperties();
  Logger.log('Đã xoá API key và token.');
}

function ensureToken_() {
  var props = PropertiesService.getUserProperties();
  var token = props.getProperty(P_TOKEN);
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty(P_TOKEN, token);
  }
  return token;
}

// ---------------------------------------------------------------- endpoint

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return fail_('BAD_REQUEST', 'Request rỗng.');
    }

    var req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return fail_('BAD_REQUEST', 'Body không phải JSON hợp lệ.');
    }

    var props = PropertiesService.getUserProperties();
    var expected = props.getProperty(P_TOKEN);
    if (!expected) {
      return fail_('NO_API_KEY', 'Script chưa được cài đặt. Chạy setup() trong Apps Script editor.');
    }
    if (!constantTimeEquals_(String(req.token || ''), expected)) {
      return fail_('UNAUTHORIZED', 'Token không đúng. Kiểm tra lại phần Cài đặt và chạy showSetup() để lấy token hiện tại.');
    }

    var action = String(req.action || 'translate');

    if (action === 'ping') {
      return ok_({
        ready: !!props.getProperty(P_KEY),
        model: props.getProperty(P_MODEL) || MODEL_DEFAULT
      });
    }

    var apiKey = props.getProperty(P_KEY);
    if (!apiKey) {
      return fail_('NO_API_KEY', 'Chưa có Gemini API key. Chạy setup() trong Apps Script editor.');
    }

    var limited = checkRateLimit_(props);
    if (limited) return limited;

    if (action === 'listModels') return listModels_(apiKey);
    if (action === 'translate') return translate_(req, apiKey, props);
    if (action === 'transcribeAndTranslate') return transcribe_(req, apiKey, props);

    return fail_('BAD_REQUEST', 'Action không hợp lệ: ' + action);
  } catch (err) {
    return fail_('UPSTREAM_ERROR', 'Lỗi trong script: ' + err.message);
  }
}

function doGet() {
  return ContentService
    .createTextOutput('Meeting Translator đang chạy. Dùng POST để gọi.')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ---------------------------------------------------------------- hành động

function translate_(req, apiKey, props) {
  var text = String(req.text || '').trim();
  if (!text) return fail_('BAD_REQUEST', 'Không có nội dung để dịch.');
  if (text.length > MAX_TEXT_CHARS) {
    return fail_('TOO_LARGE', 'Đoạn văn quá dài (' + text.length + ' ký tự, tối đa ' + MAX_TEXT_CHARS + ').');
  }

  var model = props.getProperty(P_MODEL) || MODEL_DEFAULT;
  var payload = {
    system_instruction: { parts: [{ text: buildSystemPrompt_() }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt_(text, req.context) }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
  };

  var res = callGemini_(model, apiKey, payload);
  if (res.error) return res.error;

  return ok_({
    translation: res.text,
    source: text,
    usage: res.usage
  });
}

function transcribe_(req, apiKey, props) {
  var audio = String(req.audio || '');
  if (!audio) return fail_('BAD_REQUEST', 'Không có dữ liệu âm thanh.');

  var approxBytes = Math.floor(audio.length * 3 / 4);
  if (approxBytes > MAX_AUDIO_BYTES) {
    return fail_('TOO_LARGE', 'Đoạn âm thanh quá lớn (' + Math.round(approxBytes / 1048576) + 'MB, tối đa 8MB).');
  }

  var model = props.getProperty(P_MODEL) || MODEL_DEFAULT;
  var payload = {
    system_instruction: { parts: [{ text: buildSystemPrompt_() }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: String(req.mimeType || 'audio/webm'), data: audio } },
        { text: buildAudioPrompt_(req.context) }
      ]
    }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
  };

  var res = callGemini_(model, apiKey, payload);
  if (res.error) return res.error;

  var parsed = splitTranscript_(res.text);
  return ok_({
    translation: parsed.vi,
    source: parsed.en,
    usage: res.usage
  });
}

function listModels_(apiKey) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey);
  var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });

  if (resp.getResponseCode() !== 200) {
    return fail_('UPSTREAM_ERROR', 'Không lấy được danh sách model (HTTP ' + resp.getResponseCode() + ').');
  }

  var models = (JSON.parse(resp.getContentText()).models || [])
    .filter(function (m) {
      return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
    })
    .map(function (m) {
      return { name: String(m.name).replace('models/', ''), label: m.displayName || m.name };
    });

  return ok_({ models: models });
}

// ---------------------------------------------------------------- Gemini

function callGemini_(model, apiKey, payload) {
  var url = API_BASE + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();

  if (code === 429) {
    return { error: fail_('RATE_LIMIT', 'Gemini báo đã chạm hạn mức. Chờ một lát hoặc kiểm tra quota trong Google AI Studio.') };
  }
  if (code === 400 || code === 403) {
    return { error: fail_('UPSTREAM_ERROR', 'Gemini từ chối request (HTTP ' + code + '). Kiểm tra API key còn hiệu lực và model có tồn tại không.') };
  }
  if (code !== 200) {
    return { error: fail_('UPSTREAM_ERROR', 'Gemini trả lỗi HTTP ' + code + '.') };
  }

  var data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    return { error: fail_('UPSTREAM_ERROR', 'Không đọc được phản hồi từ Gemini.') };
  }

  var cand = (data.candidates || [])[0];
  if (!cand) {
    var blockMsg = data.promptFeedback && data.promptFeedback.blockReason
      ? 'Gemini chặn nội dung này (' + data.promptFeedback.blockReason + ').'
      : 'Gemini không trả về kết quả nào.';
    return { error: fail_('UPSTREAM_ERROR', blockMsg) };
  }

  var text = ((cand.content && cand.content.parts) || [])
    .map(function (p) { return p.text || ''; })
    .join('')
    .trim();

  if (!text) {
    return { error: fail_('UPSTREAM_ERROR', 'Gemini trả về nội dung rỗng.') };
  }

  var meta = data.usageMetadata || {};
  return {
    text: stripWrapping_(text),
    usage: {
      in: meta.promptTokenCount || 0,
      out: meta.candidatesTokenCount || 0
    }
  };
}

function buildSystemPrompt_() {
  return [
    'Bạn là phiên dịch viên tiếng Anh sang tiếng Việt cho các cuộc họp trực tiếp.',
    '',
    'Quy tắc:',
    '- Dịch theo văn phong hội thoại tự nhiên như người Việt nói, KHÔNG dịch từng chữ.',
    '- Giữ nguyên thuật ngữ chuyên ngành, tên riêng, tên sản phẩm, viết tắt và số liệu.',
    '- Nếu câu bị cắt giữa chừng, chỉ dịch phần có nghĩa. KHÔNG tự bịa phần còn thiếu.',
    '- KHÔNG thêm lời dẫn, chú thích hay giải thích.',
    '- Trả về plain text. KHÔNG markdown, KHÔNG dấu ngoặc kép bao ngoài.',
    '- Nếu nội dung đã là tiếng Việt, trả lại nguyên văn.'
  ].join('\n');
}

function buildUserPrompt_(text, context) {
  var parts = [];
  if (context && context.length) {
    parts.push('Ngữ cảnh các câu vừa dịch trước đó (chỉ để tham khảo đại từ và thuật ngữ, KHÔNG dịch lại):');
    parts.push(context.slice(-3).join('\n'));
    parts.push('');
  }
  parts.push('Dịch câu sau sang tiếng Việt:');
  parts.push(text);
  return parts.join('\n');
}

function buildAudioPrompt_(context) {
  var parts = [];
  if (context && context.length) {
    parts.push('Ngữ cảnh trước đó: ' + context.slice(-3).join(' '));
    parts.push('');
  }
  parts.push('Nghe đoạn âm thanh tiếng Anh trên và trả về đúng hai dòng:');
  parts.push('EN: <nguyên văn tiếng Anh>');
  parts.push('VI: <bản dịch tiếng Việt>');
  parts.push('Nếu không nghe rõ tiếng nói nào, trả về hai dòng rỗng.');
  return parts.join('\n');
}

function splitTranscript_(text) {
  var en = '';
  var vi = '';
  text.split('\n').forEach(function (line) {
    var t = line.trim();
    if (t.indexOf('EN:') === 0) en = t.substring(3).trim();
    else if (t.indexOf('VI:') === 0) vi = t.substring(3).trim();
  });
  // Model không theo định dạng thì coi toàn bộ là bản dịch.
  if (!vi && !en) vi = text.trim();
  return { en: en, vi: vi };
}

function stripWrapping_(text) {
  var t = text.trim();
  if (t.length > 1 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') {
    t = t.substring(1, t.length - 1).trim();
  }
  return t;
}

// ---------------------------------------------------------------- bảo vệ

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function checkRateLimit_(props) {
  var perMin = parseInt(props.getProperty(P_MIN), 10) || LIMIT_PER_MIN_DEFAULT;
  var perDay = parseInt(props.getProperty(P_DAY), 10) || LIMIT_PER_DAY_DEFAULT;

  var cache = CacheService.getUserCache();
  var now = new Date();
  var minKey = 'rl_m_' + Math.floor(now.getTime() / 60000);
  var dayKey = 'rl_d_' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');

  var lock = LockService.getUserLock();
  try {
    lock.waitLock(3000);
  } catch (e) {
    // Không lấy được lock thì cho qua — thà đếm hụt còn hơn chặn oan người dùng thật.
    return null;
  }

  try {
    var minCount = parseInt(cache.get(minKey), 10) || 0;
    if (minCount >= perMin) {
      return fail_('RATE_LIMIT', 'Đã dùng ' + perMin + ' request trong phút này. Chờ khoảng một phút rồi tiếp tục.');
    }

    var dayCount = parseInt(cache.get(dayKey), 10) || 0;
    if (dayCount >= perDay) {
      return fail_('RATE_LIMIT', 'Đã dùng hết ' + perDay + ' request hôm nay. Chạy setLimits() để nâng hạn mức nếu cần.');
    }

    cache.put(minKey, String(minCount + 1), 120);
    cache.put(dayKey, String(dayCount + 1), 21600);
  } finally {
    lock.releaseLock();
  }

  return null;
}

// ---------------------------------------------------------------- phản hồi

function ok_(data) {
  data.ok = true;
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: code, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
