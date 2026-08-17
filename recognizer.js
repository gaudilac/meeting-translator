// Nhận dạng tiếng Anh bằng Web Speech API — miễn phí và cho kết quả tạm thời tức thì.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const supportsSpeechRecognition = !!SpeechRecognition;

export class Recognizer {
  constructor({ onInterim, onFinal, onError, lang = 'en-US' }) {
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onError = onError;
    this.lang = lang;

    this.recognition = null;
    this.wantRunning = false;
    this.restartDelay = 300;
  }

  start() {
    if (!supportsSpeechRecognition) {
      throw new Error('Trình duyệt này không hỗ trợ Web Speech API.');
    }
    this.wantRunning = true;
    this.spawn();
  }

  spawn() {
    const rec = new SpeechRecognition();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          this.onFinal(text.trim());
        } else {
          interim += text;
        }
      }
      if (interim.trim()) this.onInterim(interim.trim());
      this.restartDelay = 300; // nghe được thì reset backoff
    };

    rec.onerror = (event) => {
      // 'no-speech' và 'aborted' là bình thường khi im lặng, không phải lỗi thật.
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wantRunning = false;
        this.onError(new Error('Trình duyệt chặn quyền nhận dạng giọng nói. Bật lại quyền micro rồi tải lại trang.'));
        return;
      }
      if (event.error === 'network') {
        this.onError(new Error('Mất kết nối tới dịch vụ nhận dạng giọng nói. Đang thử lại...'));
        return;
      }
      this.onError(new Error('Lỗi nhận dạng giọng nói: ' + event.error));
    };

    // Chrome tự dừng sau khoảng một phút im lặng — phải tự khởi động lại,
    // nếu không phụ đề sẽ chết lặng lẽ giữa cuộc họp.
    rec.onend = () => {
      if (!this.wantRunning) return;
      setTimeout(() => {
        if (this.wantRunning) this.spawn();
      }, this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, 5000);
    };

    try {
      rec.start();
      this.recognition = rec;
    } catch {
      // start() ném lỗi nếu instance cũ chưa kịp dừng hẳn; onend sẽ thử lại.
    }
  }

  stop() {
    this.wantRunning = false;
    try {
      this.recognition?.stop();
    } catch {
      /* đã dừng rồi */
    }
    this.recognition = null;
  }
}
