# PROMPT — Bộ sắp xếp câu tiếng Việt chạy trong trình duyệt

## 0. Tóm tắt một câu

Xây một bộ xử lý JavaScript thuần, không gọi mạng, nhận câu tiếng Anh nghe được từ cuộc họp và trả về câu tiếng Việt **đọc hiểu được ngay** — bằng cách nhận diện cụm từ, xác định từ loại, rồi sắp xếp lại theo trật tự tiếng Việt, thay vì tra rời từng chữ.

---

## 1. Vấn đề đang giải

Bản tra từ điển hiện tại dịch rời từng từ theo đúng thứ tự tiếng Anh. Kết quả không đọc nổi khi đang họp:

| Tiếng Anh | Hiện tại (sai) | Cần đạt |
|---|---|---|
| Can you walk us through the results | có thể bạn **đi bộ chúng tôi qua** kết quả | bạn hướng dẫn chúng tôi qua kết quả được không |
| Let us move on to the next agenda item | **cho phép chúng tôi di chuyển trên** tiếp theo chương trình họp hạng mục | chúng ta chuyển sang mục tiếp theo |
| That makes sense | đó **làm cảm nhận** | điều đó hợp lý |
| We need to follow up on this | chúng ta cần **theo dõi lên trên** này | chúng ta cần theo sát việc này |
| I was on mute | tôi **trên tắt tiếng** | tôi bị tắt tiếng |

Bốn nguyên nhân, xếp theo mức độ gây hại:

1. **Cụm động từ bị xé lẻ** — `walk through`, `follow up`, `makes sense`, `move on` mang nghĩa nguyên khối, tra rời là sai hẳn nghĩa.
2. **Không biết từ loại** — từ điển chỉ có nghĩa, không biết `walk` ở đây là động từ hay danh từ, nên không thể sắp xếp.
3. **Trật tự từ khác nhau** — tiếng Anh để tính từ trước danh từ (`next item`), tiếng Việt để sau (`mục tiếp theo`).
4. **Từ thừa** — tiếng Việt không có mạo từ, không dùng trợ động từ, không cần đại từ chủ ngữ lặp lại.

---

## 2. Ràng buộc bắt buộc

Đây không phải bài toán dịch máy tổng quát. Phải bám các ràng buộc sau, nếu không sẽ phình ra vô hạn:

- **Không gọi mạng, không AI, không dependency.** Chạy hoàn toàn trong trình duyệt, kết quả phải có trong **dưới 5ms** cho câu 20 từ.
- **Chỉ phục vụ hội thoại cuộc họp công sở.** Không cần xử lý văn học, thơ, câu phức nhiều mệnh đề lồng nhau.
- **Đầu vào là lời nói đã nhận dạng:** không có dấu câu, không viết hoa đáng tin, có thể cụt giữa chừng.
- **Thà im lặng còn hơn sai.** Câu nào xử lý không nổi thì trả về rỗng để tầng trên chỉ hiện tiếng Anh — tuyệt đối không trả câu lộn xộn.
- Kết quả này là **bản tạm chờ AI chốt**, không phải bản dịch cuối. Không tối ưu đến mức hoàn hảo.

---

## 3. Dữ liệu cần bổ sung

### 3.1 Từ điển hiện tại thiếu từ loại

`dictionary.json` đang là `{"walk": "đi bộ"}` — không đủ để sắp xếp câu. Cần nâng cấp:

```jsonc
{
  "walk":   { "vi": "đi bộ",   "pos": "v"  },
  "result": { "vi": "kết quả", "pos": "n"  },
  "next":   { "vi": "tiếp theo","pos": "adj" },
  "quickly":{ "vi": "nhanh",   "pos": "adv" }
}
```

`pos` nhận: `n` (danh từ), `v` (động từ), `adj` (tính từ), `adv` (trạng từ), `prep` (giới từ), `pron` (đại từ), `det` (từ hạn định), `conj` (liên từ), `modal` (động từ khiếm khuyết), `interj` (thán từ).

Một từ có nhiều từ loại thì ghi dạng mảng, xếp theo tần suất: `"walk": [{"vi":"đi bộ","pos":"v"}, {"vi":"buổi đi bộ","pos":"n"}]`.

**Giữ tương thích ngược:** giá trị dạng chuỗi (`"walk": "đi bộ"`) vẫn phải đọc được, coi như `pos` không xác định.

### 3.2 Từ điển cụm từ — phần quan trọng nhất

Tạo `phrases.json` riêng, tra **trước** khi tra từ đơn. Ưu tiên theo thứ tự này:

**Nhóm 1 — cụm động từ hay gặp trong họp (~300 cụm):**
```jsonc
{
  "walk through":  "hướng dẫn",
  "follow up":     "theo sát",
  "move on":       "chuyển sang",
  "catch up":      "cập nhật",
  "figure out":    "tìm ra",
  "come up with":  "nghĩ ra",
  "run out of":    "hết",
  "look into":     "xem xét",
  "reach out":     "liên hệ",
  "bring up":      "nêu ra",
  "sign off":      "duyệt",
  "roll out":      "triển khai",
  "scale up":      "mở rộng",
  "break down":    "phân tích"
}
```

**Nhóm 2 — thành ngữ hội họp (~150 cụm):**
```jsonc
{
  "makes sense":        "hợp lý",
  "on the same page":   "thống nhất",
  "circle back":        "quay lại sau",
  "touch base":         "trao đổi",
  "deep dive":          "đi sâu",
  "low hanging fruit":  "việc dễ làm trước",
  "moving forward":     "từ giờ trở đi",
  "as soon as possible":"càng sớm càng tốt",
  "keep in mind":       "lưu ý",
  "off the top of my head": "nghĩ nhanh thì"
}
```

**Nhóm 3 — mẫu câu cố định (~100 mẫu):**
```jsonc
{
  "let us":           "chúng ta hãy",
  "let me":           "để tôi",
  "i was on mute":    "tôi bị tắt tiếng",
  "can you hear me":  "nghe rõ không",
  "sorry to interrupt":"xin lỗi cắt ngang",
  "any questions":    "có câu hỏi gì không",
  "does that make sense": "vậy có hợp lý không"
}
```

**Quy tắc tra cụm:** luôn khớp cụm **dài nhất trước** (`come up with` phải thắng `come up`). Cho phép chèn tân ngữ ở giữa: `walk us through` vẫn phải khớp `walk through`.

### 3.3 Cách sinh dữ liệu

Mở rộng `tools/build-dictionary.mjs` để sinh thêm `pos`, và viết `tools/build-phrases.mjs` sinh cụm từ. Yêu cầu AI trả JSON có cấu trúc, xác thực bằng schema trước khi ghi. Chạy **một lần**, kết quả lưu tĩnh trong repo.

---

## 4. Thuật toán sắp xếp

Chạy theo 5 bước, mỗi bước có thể dừng sớm nếu phát hiện câu quá khó.

### Bước 1 — Tách token và khớp cụm

1. Chuẩn hoá: viết thường, bỏ dấu câu thừa, gộp khoảng trắng.
2. Quét cụm từ dài nhất trước, thay bằng một token đơn có nghĩa sẵn.
3. Còn lại tách thành từ đơn.

### Bước 2 — Gán từ loại

Tra `pos` từ từ điển. Từ nhiều từ loại thì chọn bằng **quy tắc ngữ cảnh đơn giản**, không cần mô hình thống kê:

- Sau `det` (`the`, `a`, `this`) → ưu tiên `n`
- Sau `pron` chủ ngữ (`i`, `we`, `you`, `they`) → ưu tiên `v`
- Sau `modal` (`can`, `should`, `will`) → bắt buộc `v`
- Sau `prep` → ưu tiên `n`
- Đứng trước `n` → ưu tiên `adj`
- Kết thúc bằng `-ly` → `adv`

Không xác định được thì đánh dấu `unknown`, **không đoán bừa**.

### Bước 3 — Nhận diện khung câu

Chỉ cần phân biệt 5 khung, đủ dùng cho hội thoại họp:

| Khung | Dấu hiệu | Ví dụ |
|---|---|---|
| Trần thuật | mặc định | *we need more time* |
| Nghi vấn | mở đầu bằng `modal`/`do`/`is`/`wh-` | *can you share the screen* |
| Mệnh lệnh | mở đầu bằng `v`, không có chủ ngữ | *send me the file* |
| Phủ định | có `not`/`n't`/`no` | *that does not work* |
| Cảm thán | mở đầu bằng `interj` | *sorry, thanks, okay* |

### Bước 4 — Sắp xếp lại theo tiếng Việt

Áp dụng các phép biến đổi sau, theo thứ tự:

**4.1 Bỏ từ không cần trong tiếng Việt**
- Mạo từ: `the`, `a`, `an`
- Trợ động từ khi không mang nghĩa: `do`, `does`, `did`, `is`, `are`, `was`, `were` (giữ lại nếu là động từ chính: *that is correct* → *điều đó đúng*)
- `to` trong động từ nguyên mẫu: `need to go` → `cần đi`

**4.2 Đảo tính từ ra sau danh từ**
- `next item` → `mục tiếp theo`
- `final report` → `báo cáo cuối cùng`
- Ngoại lệ giữ nguyên: số đếm và lượng từ đứng trước (`three items` → `ba mục`, `many people` → `nhiều người`)

**4.3 Đảo sở hữu**
- `our team` → `đội của chúng ta`
- `the client's request` → `yêu cầu của khách hàng`

**4.4 Chuyển câu hỏi**
- `can you X` → `bạn X được không`
- `do you X` → `bạn có X không`
- `is it X` → `nó có X không`
- Từ để hỏi giữ nguyên vị trí đầu: `when is the meeting` → `khi nào họp`

**4.5 Chuyển phủ định**
- `not` đứng trước động từ trong tiếng Việt: `does not work` → `không hoạt động`
- `no + danh từ` → `không có + danh từ`

**4.6 Thêm dấu thì khi cần**
- Quá khứ rõ ràng (`was`, `did`, đuôi `-ed`, có `yesterday`/`last week`) → thêm `đã`
- Tương lai (`will`, `going to`) → thêm `sẽ`
- Tiếp diễn (`is + -ing`) → thêm `đang`
- **Chỉ thêm một lần cho mỗi mệnh đề**, không lặp lại ở mỗi động từ.

### Bước 5 — Chấm điểm và quyết định hiện hay ẩn

Tính điểm tin cậy từ 0 đến 1:

```
điểm = 0.5 × (tỉ lệ từ tra được)
     + 0.3 × (tỉ lệ từ xác định được từ loại)
     + 0.2 × (1 nếu nhận được khung câu, 0 nếu không)
```

Trừ điểm khi:
- Có từ `unknown` nằm giữa câu: −0.15 mỗi từ
- Câu dài hơn 25 từ: −0.2 (câu dài khả năng sắp sai cao)

**Ngưỡng:**
- `≥ 0.75` → hiện bình thường
- `0.55 – 0.75` → hiện kèm dấu hiệu chưa chắc chắn (mờ hơn)
- `< 0.55` → **trả rỗng**, tầng trên chỉ hiện tiếng Anh

---

## 5. Giao diện hàm

```javascript
/**
 * @param {string} english   Câu tiếng Anh đã nhận dạng
 * @returns {{ text: string, score: number, frame: string }}
 *          text rỗng nghĩa là không đủ tin cậy để hiện.
 */
export function glossSentence(english)
```

Phải giữ nguyên tên và chữ ký hàm cũ để không phải sửa nơi gọi.

---

## 6. Tiêu chí hoàn thành

Coi là xong khi:

- [ ] Cả 6 câu trong bảng ở mục 1 cho ra kết quả đọc hiểu được ngay.
- [ ] Câu toàn từ lạ (`asdf qwer zxcv`) trả về rỗng, không trả rác.
- [ ] Câu cụt giữa chừng (`we should probably`) vẫn cho ra phần có nghĩa.
- [ ] Xử lý câu 20 từ trong dưới 5ms trên máy tầm trung.
- [ ] Không có lời gọi mạng nào phát sinh.
- [ ] Bộ test có tối thiểu **60 câu hội thoại họp thật**, mỗi câu ghi rõ đầu vào và đầu ra mong đợi.
- [ ] Chạy được từ `file://`, không cần server.

---

## 7. Bộ test bắt buộc

Tạo `tests/gloss.test.mjs` với tối thiểu 60 câu, chia đều 5 khung câu ở mục 3. Mỗi ca ghi:

```javascript
{ en: "can you walk us through the results",
  expect: "bạn hướng dẫn chúng tôi qua kết quả được không",
  minScore: 0.75 }
```

Test phải chạy được bằng `node tests/gloss.test.mjs` và in rõ ca nào hỏng.

Ngoài ra cần **10 ca âm tính** — câu phải trả về rỗng: toàn từ lạ, câu quá dài rối, câu chỉ có một từ vô nghĩa.

---

## 8. Những sai lầm cần tránh

- ❌ **Cố xây bộ phân tích cú pháp đầy đủ.** Đây là bản tạm chờ AI, không cần đúng ngữ pháp học thuật.
- ❌ **Trả câu lộn xộn thay vì trả rỗng.** Người dùng thà đọc tiếng Anh còn hơn đọc "đi bộ chúng tôi qua".
- ❌ **Tra từ đơn trước cụm từ.** Sẽ hỏng toàn bộ cụm động từ.
- ❌ **Thêm `đã`/`sẽ`/`đang` ở mọi động từ.** Tiếng Việt chỉ đánh dấu thì một lần cho cả mệnh đề.
- ❌ **Quên tương thích ngược với `dictionary.json` cũ.** Người dùng đã tải bản cũ về cache.
- ❌ **Bỏ trợ động từ một cách máy móc.** `that is correct` mà bỏ `is` thì mất nghĩa.
- ❌ **Đảo tính từ với mọi trường hợp.** Số đếm và lượng từ vẫn đứng trước danh từ trong tiếng Việt.
- ❌ Hứa rằng bản này thay thế được AI. Nó chỉ lấp khoảng trống chờ đợi.

---

## 9. Thứ tự triển khai

1. **Bộ test trước** — viết 60 ca với đầu ra mong đợi. Đây là bản đặc tả thật.
2. **Từ điển cụm từ** — nhóm 1 và 3 trước, chúng sửa được phần lớn lỗi nặng nhất.
3. **Tra cụm dài nhất trước** — chỉ riêng bước này đã sửa `walk through`, `follow up`, `makes sense`.
4. **Gán từ loại + bỏ từ thừa** — sửa `the`, `to`, trợ động từ.
5. **Đảo tính từ và sở hữu** — sửa trật tự từ.
6. **Khung câu hỏi và phủ định** — sửa `can you X`, `not`.
7. **Chấm điểm và ngưỡng ẩn/hiện** — làm cuối, sau khi đã biết chất lượng thật.

Sau mỗi bước, chạy lại bộ test và ghi lại số ca đạt. Nếu một bước không tăng được số ca đạt, dừng bước đó lại thay vì cố sửa tiếp.
