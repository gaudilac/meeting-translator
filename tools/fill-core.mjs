/**
 * Lấp các từ chức năng còn thiếu trong dictionary.json.
 *
 * build-dictionary.mjs sinh theo "vị trí tần suất" nhưng model không bám sát
 * thứ tự đó, nên nhiều từ cực phổ biến (was, should, until, please) lại lọt
 * lưới trong khi từ hiếm hơn thì có. Script này hỏi thẳng theo từng nhóm.
 *
 * Dùng:  GEMINI_KEY=... node tools/fill-core.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dictionary.json');
const KEY = process.env.GEMINI_KEY;
const MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];

if (!KEY) {
  console.error('Thiếu GEMINI_KEY.');
  process.exit(1);
}

const GROUPS = [
  'tất cả dạng chia của động từ be, have, do, go, get, make, take, come, see, know, think, want, need, use, find, give, tell, work, call, try, ask, feel, leave, put, mean, keep, let, begin, seem, help, show, hear, play, run, move, live, believe, bring, happen, write, sit, stand, lose, pay, meet, include, continue, set, learn, change, lead, understand, watch, follow, stop, create, speak, read, spend, grow, open, walk, win, teach, offer, remember, consider, appear, buy, serve, send, expect, build, stay, fall, cut, reach, kill, remain (was, were, been, being, had, did, went, gone, got, made, took, came, saw, knew, thought...)',
  'toàn bộ modal và trợ động từ: can, could, will, would, shall, should, may, might, must, ought, need, dare, cùng dạng phủ định viết tắt (cannot, cant, wont, wouldnt, shouldnt, couldnt, didnt, doesnt, dont, isnt, arent, wasnt, werent, hasnt, havent, hadnt)',
  'toàn bộ giới từ và liên từ tiếng Anh: about, above, across, after, against, along, among, around, at, before, behind, below, beneath, beside, between, beyond, but, by, despite, down, during, except, for, from, in, inside, into, like, near, of, off, on, onto, out, outside, over, past, since, through, throughout, till, to, toward, under, until, up, upon, with, within, without, and, or, nor, so, yet, because, although, though, while, whereas, unless, whether, if, than, as',
  'toàn bộ đại từ và từ hạn định: i, you, he, she, it, we, they, me, him, her, us, them, my, your, his, its, our, their, mine, yours, hers, ours, theirs, myself, yourself, himself, herself, itself, ourselves, themselves, this, that, these, those, who, whom, whose, which, what, where, when, why, how, all, any, both, each, either, every, few, many, most, much, neither, none, one, other, several, some, such',
  'từ lịch sự và giao tiếp hội thoại: please, thanks, thank, sorry, excuse, hello, hi, bye, goodbye, yes, no, okay, ok, sure, right, well, actually, maybe, perhaps, probably, certainly, definitely, exactly, absolutely, indeed, anyway, however, therefore, moreover, besides, otherwise, meanwhile, finally, basically, obviously, honestly',
  'thời gian và số lượng: today, tomorrow, yesterday, now, then, soon, later, early, late, always, never, often, sometimes, usually, rarely, again, already, still, yet, ever, once, twice, week, month, year, day, hour, minute, second, morning, afternoon, evening, night, weekend, monday, tuesday, wednesday, thursday, friday, saturday, sunday, january, february, march, april, may, june, july, august, september, october, november, december',
  'từ vựng họp online: mute, unmute, screen, share, camera, microphone, audio, video, call, chat, join, leave, host, participant, presentation, slide, agenda, minutes, action, item, follow, update, status, deadline, priority, task, project, milestone, deliverable, stakeholder, feedback, review, approve, reject, schedule, reschedule, cancel, postpone, confirm',
  'từ vựng công sở và kinh doanh: company, business, client, customer, market, product, service, sales, revenue, profit, cost, budget, invoice, contract, agreement, proposal, quote, order, delivery, quality, performance, target, goal, strategy, plan, report, analysis, data, result, issue, problem, solution, risk, opportunity, department, manager, employee, staff, team, meeting, office, email, document, file, system, process'
];

const SYSTEM = [
  'Bạn tạo từ điển Anh-Việt cho phần mềm phiên dịch hội thoại cuộc họp.',
  'Chỉ trả JSON object. Không markdown, không giải thích.',
  'Key: từ tiếng Anh viết thường (chỉ chữ cái, không dấu cách).',
  'Value: nghĩa tiếng Việt NGẮN GỌN NHẤT (1-3 từ) thường dùng nhất trong hội thoại công sở.',
  'Với động từ chia ở quá khứ, dùng nghĩa gốc (went -> "đi", was -> "là").',
  'PHẢI trả đủ mọi từ được yêu cầu, không bỏ sót.'
].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(prompt) {
  const payload = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 16384 }
  };

  for (let round = 0; round < 4; round++) {
    for (const model of MODELS) {
      let res;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );
      } catch { continue; }

      if ([503, 500, 404].includes(res.status)) continue;
      if (res.status === 429) { await sleep(60000); continue; }
      if (!res.ok) continue;

      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text.trim()) continue;
      try { return JSON.parse(text); } catch { return null; }
    }
    await sleep(3000 * (round + 1));
  }
  return null;
}

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
console.log(`Bắt đầu với ${Object.keys(dict).length} từ.\n`);

for (let i = 0; i < GROUPS.length; i++) {
  process.stdout.write(`[${i + 1}/${GROUPS.length}] `);
  const raw = await call(`Cho nghĩa tiếng Việt của: ${GROUPS[i]}\n\nTrả JSON object đầy đủ.`);
  const batch = clean(raw);

  let added = 0;
  for (const [w, m] of Object.entries(batch)) {
    if (!dict[w]) { dict[w] = m; added++; }
  }

  console.log(`+${added} từ mới (tổng ${Object.keys(dict).length})`);
  writeFileSync(OUT, JSON.stringify(dict, null, 0));
  await sleep(1000);
}

console.log(`\nXong: ${Object.keys(dict).length} từ.`);
