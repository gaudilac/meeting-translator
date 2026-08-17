# Meeting Translator

**▶ Dùng ngay: [gaudilac.github.io/meeting-translator](https://gaudilac.github.io/meeting-translator/)**

Web phiên dịch hội thoại tiếng Anh sang tiếng Việt gần thời gian thực, dùng cho cuộc họp trực tuyến.

API key Gemini nằm trong Google Apps Script thuộc **tài khoản Google của chính bạn**. Trang web không nhận, không lưu và không gửi key đi bất cứ đâu — kể cả tới tác giả.

---

## Cách hoạt động

```
Trình duyệt ──POST + token──► Apps Script của bạn ──API key──► Google Gemini
   mic / tab audio                (proxy cá nhân)                (dịch)
```

- **Micro** — dùng Web Speech API có sẵn trong Chrome để nhận dạng tiếng Anh **miễn phí**, chỉ trả tiền cho phần dịch text. Độ trễ khoảng 1–3 giây.
- **Âm thanh tab** — ghi thành đoạn 6 giây và gửi lên Gemini nhận dạng + dịch. Độ trễ khoảng 6–10 giây. Chỉ chạy trên Chrome/Edge máy tính.

---

## Cài đặt

### 1. Lấy Gemini API key

Vào [aistudio.google.com/apikey](https://aistudio.google.com/apikey), tạo key mới (bắt đầu bằng `AIza`).

### 2. Tạo Apps Script

1. Mở [script.new](https://script.new)
2. Xoá nội dung mặc định, dán toàn bộ [`gas/Code.gs`](gas/Code.gs)
3. Đặt tên project bất kỳ, ví dụ `Meeting Translator`

### 3. Nạp API key

Ở đầu file, sửa hàm `setup()` — dán key của bạn vào giữa hai dấu nháy:

```javascript
function setup() {
  setKey('AIza...key-của-bạn...');
  showSetup();
}
```

Chọn hàm `setup` trong thanh công cụ rồi bấm **Run**. Xong thì xoá key khỏi dòng đó — key đã được lưu trong UserProperties, để lại trong code chỉ thêm rủi ro lộ.

Lần chạy đầu Google sẽ hỏi quyền — chọn tài khoản, bấm **Advanced** → **Go to ... (unsafe)** → **Allow**. Cảnh báo này xuất hiện vì script chưa được Google xét duyệt; đây là script của chính bạn nên không có bên thứ ba nào truy cập được.

> **Cách nhanh hơn — dùng clasp:** nếu đã cài [clasp](https://github.com/google/clasp) và `clasp login`, chạy trong thư mục `gas/`:
>
> ```bash
> clasp create-script --title "Meeting Translator" --type standalone
> clasp push --force
> clasp create-deployment --description "v1"
> clasp list-deployments        # lấy ID để ghép thành URL .../exec
> ```
>
> File `appsscript.json` trong repo đã khai sẵn `access: ANYONE_ANONYMOUS` và `executeAs: USER_DEPLOYING`, nên không cần chỉnh gì trong giao diện. **Vẫn phải mở script trong trình duyệt chạy `setup()` một lần** để cấp quyền OAuth — Google không cho ủy quyền qua dòng lệnh.

### 4. Deploy

**Deploy** → **New deployment** → biểu tượng bánh răng → **Web app**:

| Trường | Giá trị |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone** |

> ⚠️ Phải chọn **Anyone**, không phải "Anyone with Google account". Tuỳ chọn kia sẽ chuyển hướng sang trang đăng nhập và trình duyệt sẽ chặn vì CORS.
>
> "Anyone" nghĩa là ai biết URL đều gọi được — vì vậy script **bắt buộc** kiểm tra token, và token chính là thứ bảo vệ bạn.

### 5. Lấy URL và token

Chạy hàm `showSetup()`, mở **View → Logs** để đọc:

```
URL   : https://script.google.com/macros/s/AKfy.../exec
TOKEN : a1b2c3...
```

### 6. Kết nối web

Mở `web/index.html`, bấm ⚙, dán URL và token, bấm **Kiểm tra kết nối**.

---

## Chạy web

Mở trực tiếp `index.html` bằng Chrome là dùng được. Nếu muốn chạy qua server local:

```bash
python3 -m http.server 8080
```

Rồi mở `http://localhost:8080`.

### Deploy lên GitHub Pages

Vào **Settings → Pages**, chọn nhánh `main` và thư mục `/ (root)`. Không cần cấu hình gì thêm — trang hoàn toàn tĩnh, không dependency ngoài, không build step.

---

## Sử dụng

**Nghe từ micro** — dùng khi bạn nghe cuộc họp qua loa, hoặc muốn dịch chính lời mình nói. Chạy trên cả điện thoại.

**Nghe từ tab họp** — dùng khi họp trên Google Meet/Zoom web. Trong hộp thoại chia sẻ, chọn tab cuộc họp và **nhớ bật ô "Cũng chia sẻ âm thanh của tab"** ở góc dưới bên trái. Quên bật ô này là lỗi phổ biến nhất.

Thanh công cụ dưới cùng: tạm dừng tự cuộn để đọc lại, ẩn/hiện tiếng Anh gốc, đổi cỡ chữ, tải transcript về dạng Markdown.

---

## Những điều cần biết trước khi dùng

Đây là các đánh đổi thật, không giấu:

**Nội dung cuộc họp được gửi tới Google Gemini.** Đây là điều kiện để dịch được. Không dùng công cụ này cho cuộc họp có thông tin mật, dữ liệu khách hàng hay nội dung thuộc diện bảo mật.

**Token lưu trong `localStorage` của trình duyệt.** Nó bảo vệ bạn khỏi người lạ trên Internet tình cờ biết URL, nhưng không bảo vệ khỏi người dùng chung máy hoặc mã độc chạy trong trình duyệt. Nghi ngờ lộ thì chạy `rotateToken()` trong Apps Script và dán token mới vào web.

**Mỗi câu là một lời gọi API và tốn tiền** theo [biểu giá Gemini](https://ai.google.dev/pricing). Một cuộc họp một tiếng nói liên tục có thể tạo vài trăm request. Nên đặt hạn mức chi tiêu trong Google Cloud Console.

**Gói miễn phí giới hạn theo phút.** Họp dài liên tục có thể chạm `429` — web sẽ tự giãn nhịp và báo cho bạn, nhưng vài câu có thể bị bỏ qua.

**Đây không phải phiên dịch cấp hội nghị.** Độ trễ 1–3 giây với micro, 6–10 giây với tab audio. Câu bị cắt giữa chừng có thể dịch thiếu ngữ cảnh.

**Apps Script có hạn mức riêng:** khoảng 20.000 lệnh `UrlFetchApp` mỗi ngày với tài khoản Gmail thường, và mỗi request tối đa 60 giây.

---

## Chỉnh cấu hình

Chạy trong Apps Script editor:

| Hàm | Tác dụng |
|---|---|
| `setKey("AIza...")` | Đổi API key |
| `setModel("gemini-2.0-flash")` | Đổi model dịch |
| `setLimits(60, 1000)` | Đổi hạn mức: 60 request/phút, 1000/ngày |
| `rotateToken()` | Sinh token mới (phải dán lại vào web) |
| `showSetup()` | Xem URL, token và trạng thái hiện tại |
| `resetAll()` | Xoá sạch key và token khỏi tài khoản |

---

## Xử lý sự cố

| Triệu chứng | Nguyên nhân và cách sửa |
|---|---|
| "Script trả về HTML thay vì dữ liệu" | Deploy sai quyền. Deploy lại với **Who has access = Anyone** |
| "Token không đúng" | Chạy `showSetup()` lấy token hiện tại, dán lại vào web |
| "Chưa có Gemini API key" | Chạy `setKey("AIza...")` trong editor |
| "Tab được chọn không kèm âm thanh" | Chọn lại tab và bật ô chia sẻ âm thanh |
| Phụ đề dừng sau khoảng một phút | Đã xử lý tự khởi động lại. Nếu vẫn dừng, kiểm tra kết nối mạng |
| Nút "Nghe từ tab họp" bị mờ | Đang dùng điện thoại hoặc trình duyệt không hỗ trợ. Dùng micro thay thế |
| Sửa `Code.gs` xong không thấy đổi | Phải **Deploy → Manage deployments → Edit → New version** |
| "Rất tiếc, không thể mở tệp tại thời điểm này" | Script chưa được cấp quyền OAuth. Mở script trong trình duyệt, chạy `setup()` một lần và bấm **Allow** |

---

## Cấu trúc

```
Meeting_Translator/
├── PROMPT.md          # Đặc tả đầy đủ của dự án
├── README.md
├── index.html         # Ở gốc repo để GitHub Pages phục vụ trực tiếp
├── style.css
├── app.js             # Điều phối chính
├── audio.js           # Thu micro / tab audio
├── recognizer.js      # Web Speech API + tự khởi động lại
├── gasClient.js       # Gọi script, hàng đợi, retry
├── ui.js              # Render phụ đề
└── gas/
    └── Code.gs        # Proxy Apps Script (một file, copy một lần)
```

Không framework, không build step, không dependency ngoài.
