// Chạy trong cửa sổ ẩn: trộn âm thanh hệ thống + micro thành mono rồi mã hoá thẳng sang MP3 (CBR),
// gửi từng mẩu sang main để ghi ra đĩa. MP3 CBR tua được ở mọi trình phát, không như WebM của MediaRecorder.
import { Mp3Encoder } from '@breezystack/lamejs';

const api = window.api;
const SAMPLE_RATE = 44100;
const KBPS = 64; // đủ rõ cho giọng nói, khoảng 29 MB mỗi giờ

let audio = null;
let encoder = null;
let processor = null;
let streams = [];
let active = false;
let paused = false;
const pending = new Set(); // các mẩu đang gửi; phải gửi hết trước khi báo đã dừng

function send(bytes) {
  if (!bytes.length) return;
  const p = api.recChunk(bytes.slice().buffer);
  pending.add(p);
  p.finally(() => pending.delete(p));
}

window.__startRec = async () => {
  // Chromium bắt buộc xin cả video; bỏ track video ngay, chỉ giữ âm thanh loopback.
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  display.getVideoTracks().forEach((t) => t.stop());
  if (!display.getAudioTracks().length) {
    display.getTracks().forEach((t) => t.stop());
    throw new Error('Không lấy được âm thanh phát ra từ máy.');
  }
  streams.push(display);

  let mic = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streams.push(mic);
  } catch {
    // Không có micro hoặc bị chặn quyền: vẫn ghi tiếng phát ra từ máy.
  }

  audio = new AudioContext({ sampleRate: SAMPLE_RATE });
  const bus = audio.createGain();
  const mix = (stream) => {
    const g = audio.createGain();
    g.gain.value = 0.9;
    audio.createMediaStreamSource(stream).connect(g).connect(bus);
  };
  mix(new MediaStream(display.getAudioTracks()));
  if (mic) mix(mic);

  encoder = new Mp3Encoder(1, audio.sampleRate, KBPS);
  processor = audio.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!active || paused) return; // tạm dừng: bỏ qua dữ liệu, file không có khoảng lặng thừa
    const input = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const v = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    send(encoder.encodeBuffer(pcm));
  };
  // ScriptProcessor chỉ chạy khi nối tới đích; nối qua một nút câm để không phát lại ra loa.
  const mute = audio.createGain();
  mute.gain.value = 0;
  bus.connect(processor);
  processor.connect(mute).connect(audio.destination);

  active = true;
  paused = false;
  return { mic: !!mic };
};

window.__pauseRec = () => {
  paused = true;
};
window.__resumeRec = () => {
  paused = false;
};

window.__stopRec = async () => {
  active = false;
  processor.disconnect();
  send(encoder.flush());
  await Promise.all(pending);
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  await audio.close();
};
