/**
 * Sinh từ điển Anh-Việt bằng Gemini, chạy MỘT LẦN rồi lưu thành file tĩnh.
 *
 * Dùng:  GEMINI_KEY=... node tools/build-dictionary.mjs [số_từ]
 *
 * Kết quả ghi vào dictionary.json ở gốc repo. Script chạy lại được nhiều lần:
 * nó đọc file cũ và chỉ sinh thêm phần còn thiếu, nên có thể dừng giữa chừng
 * rồi chạy tiếp mà không mất công đã làm.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dictionary.json');

const KEY = process.env.GEMINI_KEY;
const TARGET = Number(process.argv[2] || 15000);
const BATCH = 250;
const MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];

if (!KEY) {
  console.error('Thiếu GEMINI_KEY.\nDùng: GEMINI_KEY=... node tools/build-dictionary.mjs 15000');
  process.exit(1);
}

const SYSTEM = [
  'Bạn tạo từ điển Anh-Việt cho phần mềm phiên dịch hội thoại cuộc họp.',
  '',
  'Quy tắc:',
  '- Chỉ trả JSON object. Không markdown, không giải thích, không ```.',
  '- Key: từ tiếng Anh viết thường, chỉ chữ cái và dấu nháy đơn (không cụm từ).',
  '- Value: nghĩa tiếng Việt NGẮN GỌN NHẤT (1-3 từ), nghĩa thường dùng nhất',
  '  trong ngữ cảnh công sở/hội họp. Không liệt kê nhiều nghĩa, không dấu ngoặc.',
  '- Bỏ qua tên riêng, từ tục, từ cổ, từ chuyên ngành hẹp.',
  '- Ưu tiên từ thật sự hay gặp khi người ta nói chuyện trong cuộc họp.'
].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(prompt) {
  const payload = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 16384 }
  };

  // Gemini trả 503 "high demand" khá thường xuyên; đổi model và chờ đều giúp qua.
  for (let round = 0; round < 4; round++) {
    for (const model of MODELS) {
      let res;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );
      } catch {
        continue;
      }

      if (res.status === 503 || res.status === 500 || res.status === 404) continue;

      if (res.status === 429) {
        console.log('   chạm hạn mức, chờ 60 giây...');
        await sleep(60000);
        continue;
      }

      if (!res.ok) {
        console.log(`   HTTP ${res.status} với ${model}`);
        continue;
      }

      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text.trim()) continue;

      try {
        return JSON.parse(text);
      } catch {
        console.log('   JSON hỏng, bỏ lô này');
        return null;
      }
    }
    await sleep(3000 * (round + 1));
  }
  return null;
}

/** Chỉ nhận từ đơn sạch; loại cụm từ, số, ký tự lạ. */
function clean(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const word = String(k).trim().toLowerCase();
    const mean = String(v).trim();
    if (!/^[a-z][a-z']{0,24}$/.test(word)) continue;
    if (!mean || mean.length > 40) continue;
    out[word] = mean;
  }
  return out;
}

const dict = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
console.log(`Đã có ${Object.keys(dict).length} từ. Mục tiêu ${TARGET}.\n`);

let stall = 0;

while (Object.keys(dict).length < TARGET) {
  const have = Object.keys(dict).length;
  const from = have + 1;

  // Đưa mẫu từ đã có để model không lặp lại; gửi hết sẽ phình token vô ích.
  const sample = Object.keys(dict).slice(-40).join(', ');

  const prompt =
    `Cho ${BATCH} từ tiếng Anh phổ biến tiếp theo, xếp theo tần suất sử dụng, ` +
    `bắt đầu khoảng vị trí ${from} trong danh sách từ phổ biến nhất tiếng Anh.\n` +
    (sample ? `KHÔNG lặp lại các từ đã có, ví dụ: ${sample}\n` : '') +
    `Trả JSON object gồm ${BATCH} cặp từ-nghĩa.`;

  process.stdout.write(`[${have}/${TARGET}] sinh lô từ vị trí ~${from}... `);

  const raw = await callGemini(prompt);
  const batch = clean(raw);

  let added = 0;
  for (const [w, m] of Object.entries(batch)) {
    if (!dict[w]) {
      dict[w] = m;
      added++;
    }
  }

  console.log(`+${added} từ mới`);

  writeFileSync(OUT, JSON.stringify(dict, null, 0));

  // Model bắt đầu lặp lại thì dừng, ép thêm chỉ tốn tiền mà không có từ mới.
  if (added < 5) {
    if (++stall >= 3) {
      console.log('\nModel không sinh thêm được từ mới. Dừng.');
      break;
    }
  } else {
    stall = 0;
  }

  await sleep(1200);
}

const final = Object.keys(dict).length;
const bytes = Buffer.byteLength(JSON.stringify(dict));
console.log(`\nXong: ${final} từ, ${(bytes / 1024).toFixed(0)} KB -> dictionary.json`);
