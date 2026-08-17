# PROMPT — Xây dựng "Meeting Translator": web phiên dịch hội thoại trực tiếp Anh → Việt

## 0. Tóm tắt một câu

Xây một web tĩnh (deploy trên GitHub Pages) nghe hội thoại tiếng Anh từ **micro** hoặc **âm thanh tab cuộc họp**, hiển thị phụ đề tiếng Việt gần thời gian thực; mọi lời gọi Google Gemini đi qua **Google Apps Script của chính người dùng**, nên API key không bao giờ rời khỏi tài khoản Google của họ và không đi qua bất kỳ máy chủ nào của tác giả.

---

## 1. Bối cảnh và vấn đề cần giải

Người dùng Việt Nam tham gia các cuộc họp tiếng Anh (Google Meet, Zoom, Teams, webinar) và cần hiểu nội dung ngay lúc đang diễn ra. Các công cụ sẵn có hoặc đắt, hoặc yêu cầu cài phần mềm, hoặc bắt người dùng dán API key vào một trang web lạ.

**Ràng buộc cốt lõi:** tác giả không muốn vận hành backend, không muốn trả tiền API cho người dùng, và không muốn chạm vào API key của bất kỳ ai.

**Giải pháp:** Web tĩnh + mỗi người dùng tự deploy một Google Apps Script Web App làm proxy cá nhân tới Gemini API.

---

## 2. Mô hình bảo mật — ĐỌC KỸ TRƯỚC KHI CODE

Đây là phần dễ làm sai nhất. Yêu cầu bắt buộc:

### 2.1 Nguyên tắc

- API key Gemini **chỉ** nằm trong `PropertiesService.getUserProperties()` của Apps Script thuộc tài khoản Google của chính người dùng.
- Web tĩnh **không bao giờ** nhận, lưu, log hay truyền API key. Nếu code có bất kỳ biến nào tên kiểu `apiKey` ở phía web, đó là lỗi thiết kế.
- Web chỉ lưu **URL Web App** của người dùng trong `localStorage`. URL này tự nó không đủ để dùng nếu deploy đúng chế độ (xem 2.2).

### 2.2 Chế độ deploy Apps Script

Người dùng deploy với:
- **Execute as:** `Me` (chính họ) — để script đọc được UserProperties của họ.
- **Who has access:** `Anyone` — bắt buộc, vì `Anyone with Google account` sẽ chặn `fetch` từ trình duyệt bằng redirect đăng nhập mà CORS không vượt qua được.

> ⚠️ Vì `Anyone` nghĩa là URL bị lộ = ai cũng gọi được, **phải** bù lại bằng shared secret (2.3). Không có secret thì thiết kế này KHÔNG an toàn. Đây là điều kiện bắt buộc, không phải tuỳ chọn.

### 2.3 Shared secret bắt buộc

1. Lần đầu chạy, script tự sinh một token ngẫu nhiên (dùng `Utilities.getUuid()` × 2, tối thiểu 32 ký tự) và lưu vào UserProperties.
2. Người dùng chạy hàm `showSetup()` trong editor để đọc token, rồi dán vào web cùng với URL.
3. Mọi request từ web phải kèm token trong body. Script so sánh và trả `401` nếu sai.
4. So sánh token phải **constant-time** (so sánh từng ký tự với biến tích luỹ, không `return` sớm) để tránh timing attack.

### 2.4 Chống lạm dụng phía script

- **Rate limit:** dùng `CacheService` đếm số request theo phút (mặc định 60/phút) và theo ngày (mặc định 1000/ngày). Vượt thì trả `429`.
- **Giới hạn kích thước:** từ chối text đầu vào > 8000 ký tự và audio blob > 8MB.
- **LockService:** dùng `getUserLock()` với timeout ngắn (2–3s) khi ghi counter để tránh race condition.
- Người dùng chỉnh được các hạn mức này qua UserProperties mà không phải sửa code.

### 2.5 Những gì phải nói thẳng với người dùng trong README

Không được giấu các đánh đổi sau — viết rõ trong README và trong màn hình cài đặt:

- Token lưu trong `localStorage` của trình duyệt. Ai truy cập được máy hoặc chèn được XSS vào trang thì đọc được token. Token chỉ bảo vệ khỏi người lạ trên Internet, không bảo vệ khỏi người dùng chung máy.
- Nội dung cuộc họp **được gửi tới Google Gemini** để nhận dạng và dịch. Không dùng cho họp có thông tin mật.
- Mỗi câu là một lời gọi API và phát sinh chi phí theo biểu giá Gemini. Người dùng nên đặt hạn mức chi tiêu trong Google Cloud Console.
- Free tier Gemini có giới hạn theo phút; họp dài liên tục có thể chạm `429`.
- Nếu nghi ngờ lộ token, chạy `rotateToken()` trong Apps Script editor để đổi token mới.

---

## 3. Kiến trúc

```
┌────────────────────────────────┐
│  Trình duyệt (GitHub Pages)    │
│  - Thu audio (mic / tab)       │
│  - Web Speech API → text EN    │  ← miễn phí, không tốn API
│  - Fallback: gửi audio đi STT  │
│  - Hiển thị phụ đề song ngữ    │
└──────────────┬─────────────────┘
               │ POST + token
               │ (text hoặc audio base64)
               ▼
┌────────────────────────────────┐
│  Apps Script Web App CỦA USER  │
│  - Kiểm tra token (const-time) │
│  - Rate limit qua CacheService │
│  - Đọc key từ UserProperties   │
└──────────────┬─────────────────┘
               │ UrlFetchApp + key
               ▼
┌────────────────────────────────┐
│  Google Gemini API             │
└────────────────────────────────┘
```

### 3.1 Vì sao dùng Web Speech API trước

Chrome có sẵn `webkitSpeechRecognition` nhận dạng tiếng Anh **miễn phí và có kết quả tạm thời (interim) gần như tức thì**. Dùng nó làm đường chính giúp:
- Độ trễ chỉ còn thời gian dịch text (~0.5–1.5s) thay vì upload audio (~4–8s).
- Chi phí giảm mạnh: chỉ trả tiền cho phần dịch text, không trả cho STT.

Chỉ dùng đường gửi audio lên Gemini khi Web Speech API không khả dụng (Firefox, Safari, hoặc nguồn tab audio mà SpeechRecognition không đọc được).

---

## 4. Yêu cầu chức năng

### 4.1 Nguồn âm thanh

**Ưu tiên 1 — Micro** (làm trước, chạy mọi thiết bị kể cả điện thoại):
- `getUserMedia({ audio: true })`.
- Bật `echoCancellation`, `noiseSuppression`, `autoGainControl`.

**Ưu tiên 2 — Âm thanh tab** (desktop Chrome/Edge):
- `getDisplayMedia({ video: true, audio: true })` — bắt buộc xin `video` vì Chrome không cho chia sẻ audio-only.
- Kiểm tra `stream.getAudioTracks().length > 0`; nếu người dùng quên tick "Share tab audio", hiện thông báo hướng dẫn cụ thể chứ không báo lỗi chung chung.
- Ngay sau khi có stream, dừng video track để tiết kiệm tài nguyên.
- **Phát hiện thiết bị:** nếu là mobile, ẩn hẳn nút này và giải thích ngắn gọn tại sao, không để nút chết.

### 4.2 Luồng dịch streaming

1. `SpeechRecognition` với `continuous = true`, `interimResults = true`, `lang = 'en-US'`.
2. Kết quả **interim** → hiện ngay tiếng Anh ở dòng đang chạy, đồng thời gửi đi **dịch nháp** theo nhịp giới hạn (mặc định 1,2 giây, chỉnh được bằng thanh trượt, đặt 0 để tắt).
3. Bản dịch nháp hiện mờ/nghiêng ngay trên dòng tiếng Anh, **cùng cỡ chữ với bản chốt** để lúc chốt không nhảy layout.
4. Kết quả **final** → đẩy vào hàng đợi dịch; bản chốt thay thế bản nháp tại chỗ.
5. **Gộp câu thông minh:** chờ 400ms; nếu có câu final mới tới trong lúc chờ thì gộp lại thành một request. Tránh gọi API cho từng mẩu 2–3 chữ.
6. Nhận bản dịch → thay dòng interim bằng cặp song ngữ hoàn chỉnh.
7. **Giữ ngữ cảnh:** gửi kèm 2–3 câu đã dịch trước đó để AI dịch đúng đại từ và thuật ngữ nối tiếp. Không gửi cả transcript (tốn token vô ích).

### 4.2.1 Quy tắc bắt buộc của luồng dịch nháp

Luồng nháp chạy song song luồng chốt và **luôn nhường đường**:

- Bỏ qua nếu chuỗi ngắn hơn 8 ký tự, chưa đổi so với lần trước, hoặc chưa tới nhịp.
- Bỏ qua nếu luồng chốt đang chạy hoặc một bản nháp khác đang bay — bản chuẩn quan trọng hơn.
- Đánh số thứ tự mỗi bản nháp; kết quả về trễ hơn lần chốt gần nhất thì **vứt bỏ**, nếu không nó sẽ ghi đè bản chuẩn.
- Bản nháp lỗi thì im lặng bỏ qua (bản chốt sẽ tới sau và đúng hơn), riêng `429` vẫn phải tôn trọng để không đào sâu rate limit.
- Bản nháp chỉ gửi kèm 2 câu ngữ cảnh thay vì 3, vì nó gọi thường xuyên hơn.

**Chi phí:** mỗi bản nháp là một request. Nhịp 1,2 giây làm chi phí tăng khoảng 2–3 lần so với chỉ dịch câu chốt. Thanh trượt phải nói rõ đánh đổi này ngay tại chỗ, không giấu trong tài liệu.

### 4.3 Xử lý lỗi bắt buộc

Mỗi lỗi phải có thông báo tiếng Việt nói rõ **chuyện gì xảy ra** và **cần làm gì**:

| Tình huống | Xử lý |
|---|---|
| `SpeechRecognition` tự dừng (Chrome dừng sau ~60s im lặng) | Tự khởi động lại, không để người dùng phát hiện |
| Mất mạng | Đưa vào hàng đợi, retry với exponential backoff (1s, 2s, 4s, tối đa 3 lần) |
| `429` từ Gemini | Hiện cảnh báo chạm hạn mức, tự giãn nhịp gửi, không spam retry |
| `401` từ script | "Token không đúng — kiểm tra lại phần Cài đặt" + nút mở lại màn hình cài |
| Không tick share audio | Hướng dẫn kèm ảnh/mô tả vị trí ô tick |
| Từ chối quyền micro | Hướng dẫn bật lại quyền trong thanh địa chỉ |

### 4.4 Giao diện

- **Mobile-first**, dùng được một tay khi đang họp.
- Khu vực phụ đề chiếm phần lớn màn hình, tự cuộn xuống, **có nút tạm dừng cuộn** để đọc lại mà không bị đẩy đi.
- Hiển thị **song ngữ**: tiếng Việt là chính (chữ lớn), tiếng Anh gốc nhỏ hơn ở dưới. Có công tắc ẩn tiếng Anh.
- Chỉnh cỡ chữ (3 mức), dark mode theo hệ thống.
- Thanh trạng thái: đang nghe / đang dịch / lỗi, kèm đếm số request đã dùng trong phiên.
- Xuất transcript ra `.txt` và `.md` (tải về từ chính trang, không cần server).
- Wake Lock API giữ màn hình sáng khi đang nghe (điện thoại).

### 4.5 Màn hình cài đặt lần đầu

Hướng dẫn từng bước, mỗi bước có nút copy sẵn:
1. Lấy Gemini API key tại `aistudio.google.com/apikey` (kèm link).
2. Tạo Apps Script mới tại `script.new`.
3. Copy toàn bộ `Code.gs` (nút copy một chạm).
4. Chạy `setup()` → dán API key khi được hỏi.
5. Deploy → Web app → Execute as **Me** → Who has access **Anyone**.
6. Chạy `showSetup()` → copy URL và token.
7. Dán cả hai vào web → bấm **Kiểm tra kết nối**.

Nút **Kiểm tra kết nối** phải gọi thật một request `ping` và báo rõ kết quả, không chỉ lưu vào localStorage rồi báo "đã lưu".

---

## 5. Yêu cầu kỹ thuật

### 5.1 Ràng buộc công nghệ

- **Không framework, không build step.** HTML + CSS + JS thuần, ES modules. Deploy GitHub Pages là xong.
- **Không dependency ngoài.** Không CDN, không npm. Trang phải chạy được khi mở file local.
- Hỗ trợ: Chrome/Edge desktop (đầy đủ), Chrome Android (mic), Safari iOS (mic, đường audio fallback).

### 5.2 Ràng buộc Apps Script

- `doPost` **không** đọc được custom header từ `fetch` cross-origin → token phải nằm trong **body**.
- `doPost` phải trả `ContentService.createTextOutput(...).setMimeType(JSON)`. Apps Script **không** đặt được CORS header tuỳ ý, nhưng Web App deploy `Anyone` đã trả `Access-Control-Allow-Origin: *` sẵn.
- Gửi request từ web bằng `Content-Type: text/plain` để **tránh preflight OPTIONS** — Apps Script không xử lý OPTIONS và sẽ fail. Đây là điểm gây lỗi phổ biến nhất, phải làm đúng ngay từ đầu.
- Giới hạn Apps Script: `UrlFetchApp` timeout ~60s, quota 20.000 lệnh fetch/ngày với tài khoản thường. Ghi rõ trong README.

### 5.3 Model AI

- Mặc định: `gemini-2.0-flash` (rẻ, nhanh, đủ tốt cho dịch hội thoại).
- Cho phép đổi model qua UserProperties.
- Có endpoint `listModels` để web hiện danh sách model mà key đó thực sự dùng được — không hard-code danh sách vì Google đổi tên model thường xuyên.

### 5.4 Prompt dịch gửi cho Gemini

Yêu cầu bản dịch phải:
- Giữ văn phong hội thoại tự nhiên, **không dịch word-by-word**.
- Giữ nguyên thuật ngữ chuyên ngành, tên riêng, tên sản phẩm, số liệu.
- Không thêm giải thích, không thêm lời dẫn, chỉ trả bản dịch.
- Nếu câu bị cắt giữa chừng, dịch phần có nghĩa, không tự bịa phần thiếu.
- Trả về **plain text**, không markdown, không dấu ngoặc kép bao ngoài.

---

## 6. Cấu trúc file

```
Meeting_Translator/
├── README.md              # Hướng dẫn cài đặt + giới hạn + rủi ro
├── PROMPT.md              # File này
├── web/
│   ├── index.html
│   ├── style.css
│   ├── app.js             # Điều phối chính, quản lý trạng thái
│   ├── audio.js           # getUserMedia / getDisplayMedia
│   ├── recognizer.js      # Web Speech API + fallback
│   ├── gasClient.js       # Gọi Apps Script, retry, hàng đợi
│   └── ui.js              # Render phụ đề, cài đặt, thông báo
└── gas/
    └── Code.gs            # Toàn bộ script (một file để dễ copy)
```

`Code.gs` phải là **một file duy nhất** — người dùng copy một lần là xong. Đừng tách nhiều file bắt họ copy nhiều lần.

---

## 7. API giữa web và Apps Script

Mọi request: `POST`, body JSON, `Content-Type: text/plain`.

```jsonc
// → Request
{
  "token": "<shared secret>",
  "action": "translate" | "transcribeAndTranslate" | "ping" | "listModels",
  "text": "câu tiếng Anh",          // với action=translate
  "audio": "<base64>",               // với action=transcribeAndTranslate
  "mimeType": "audio/webm",
  "context": ["câu trước 1", "câu trước 2"]
}

// ← Response thành công
{ "ok": true, "translation": "bản dịch", "source": "câu gốc", "usage": { "in": 120, "out": 45 } }

// ← Response lỗi
{ "ok": false, "error": "RATE_LIMIT", "message": "Thông báo tiếng Việt cho người dùng" }
```

Mã lỗi: `UNAUTHORIZED`, `RATE_LIMIT`, `NO_API_KEY`, `TOO_LARGE`, `UPSTREAM_ERROR`, `BAD_REQUEST`.

---

## 8. Tiêu chí hoàn thành

Coi là xong khi tất cả những điều sau đúng:

- [ ] Không có chuỗi nào chứa API key trong toàn bộ thư mục `web/`.
- [ ] Nói vào mic tiếng Anh → phụ đề tiếng Việt hiện trong vòng 3 giây.
- [ ] Interim text hiện gần như tức thì, trước khi bản dịch tới.
- [ ] Chia sẻ tab Google Meet có audio → dịch được hội thoại trong tab.
- [ ] Sai token → báo lỗi tiếng Việt rõ ràng kèm nút mở cài đặt.
- [ ] Rút mạng giữa chừng → tự retry, không mất câu, không crash.
- [ ] Mở trên Chrome Android → nút chia sẻ tab được ẩn kèm giải thích, mic vẫn chạy.
- [ ] Gửi 100 request liên tiếp → rate limit chặn đúng, trả `429`, web tự giãn nhịp.
- [ ] README nêu đủ 5 rủi ro ở mục 2.5, không giấu điều nào.
- [ ] Toàn bộ web chạy được từ `file://` không cần server.

---

## 9. Thứ tự triển khai

Làm theo đúng thứ tự, mỗi giai đoạn chạy được mới sang bước sau:

1. **Nền tảng bảo mật** — `Code.gs` hoàn chỉnh: setup, token, rate limit, action `ping` + `translate`. Test bằng `curl` trước khi viết web.
2. **Đường mic tối thiểu** — thu mic, Web Speech API, gọi script, hiện phụ đề. Xấu cũng được, miễn chạy.
3. **Chất lượng dịch** — gộp câu, ngữ cảnh, hàng đợi, retry.
4. **Nguồn tab audio** — `getDisplayMedia`, phát hiện thiếu audio track, ẩn trên mobile.
5. **Giao diện** — song ngữ, cỡ chữ, dark mode, xuất file, wake lock.
6. **Fallback audio** — `transcribeAndTranslate` cho trình duyệt không có Web Speech API.
7. **README** — hướng dẫn cài đặt kèm ảnh chụp màn hình các bước Apps Script.

---

## 10. Những sai lầm cần tránh

Đây là các lỗi đã biết sẽ xảy ra nếu không cẩn thận:

- ❌ Gửi `Content-Type: application/json` → preflight OPTIONS → Apps Script fail. **Phải dùng `text/plain`.**
- ❌ Deploy `Anyone with Google account` → redirect đăng nhập → CORS chặn. **Phải là `Anyone`.**
- ❌ Bỏ qua shared secret vì "URL khó đoán". URL sẽ lộ qua lịch sử duyệt web, log, chia sẻ màn hình.
- ❌ Gọi API cho từng interim result → cháy quota trong vài phút.
- ❌ Gửi toàn bộ transcript làm ngữ cảnh → token phình theo thời gian họp.
- ❌ Quên rằng `SpeechRecognition` tự dừng → phụ đề chết im lặng sau một phút.
- ❌ Xin `getDisplayMedia({ audio: true })` không kèm `video` → Chrome từ chối.
- ❌ Hứa "bảo mật tuyệt đối" trong README. Nói đúng: key an toàn, nội dung họp vẫn qua Google, token vẫn nằm trong localStorage.
