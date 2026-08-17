// Lấy luồng âm thanh từ micro hoặc từ tab đang họp.

export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export const supportsTabAudio =
  !isMobile && !!navigator.mediaDevices?.getDisplayMedia;

export class AudioError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function captureMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new AudioError('UNSUPPORTED', 'Trình duyệt này không hỗ trợ thu âm từ micro.');
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      throw new AudioError(
        'DENIED',
        'Bạn đã từ chối quyền dùng micro. Bấm biểu tượng khoá bên trái thanh địa chỉ để bật lại, rồi tải lại trang.'
      );
    }
    if (err.name === 'NotFoundError') {
      throw new AudioError('NO_DEVICE', 'Không tìm thấy micro nào trên thiết bị này.');
    }
    throw new AudioError('FAILED', 'Không mở được micro: ' + err.message);
  }
}

/**
 * Chrome không cho xin audio-only, phải kèm video rồi tắt video track ngay sau đó.
 */
export async function captureTabAudio() {
  if (!supportsTabAudio) {
    throw new AudioError(
      'UNSUPPORTED',
      isMobile
        ? 'Điện thoại không chia sẻ được âm thanh tab. Hãy dùng micro, hoặc mở trang này trên máy tính.'
        : 'Trình duyệt này không hỗ trợ chia sẻ âm thanh tab. Hãy dùng Chrome hoặc Edge trên máy tính.'
    );
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new AudioError('DENIED', 'Bạn đã huỷ hộp thoại chia sẻ màn hình.');
    }
    throw new AudioError('FAILED', 'Không chia sẻ được tab: ' + err.message);
  }

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new AudioError(
      'NO_AUDIO',
      'Tab được chọn không kèm âm thanh. Chọn lại và nhớ bật ô "Cũng chia sẻ âm thanh của tab" ở góc dưới bên trái hộp thoại.'
    );
  }

  // Video chỉ để lách yêu cầu của Chrome, không cần giữ.
  stream.getVideoTracks().forEach((track) => track.stop());

  return stream;
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Ghi luồng thành từng đoạn để gửi lên Gemini khi Web Speech API không dùng được.
 */
export class ChunkRecorder {
  constructor(stream, { chunkMs = 6000, onChunk }) {
    this.onChunk = onChunk;
    this.chunkMs = chunkMs;
    this.mimeType = pickMimeType();
    this.recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 1000) this.onChunk(e.data, this.mimeType);
    };
  }

  start() {
    this.recorder.start(this.chunkMs);
  }

  stop() {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Không đọc được dữ liệu âm thanh.'));
    reader.readAsDataURL(blob);
  });
}
