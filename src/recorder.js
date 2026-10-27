// Chạy trong cửa sổ ẩn: trộn âm thanh hệ thống + micro rồi ghi bằng MediaRecorder, gửi từng mẩu sang main.
const api = window.api;

let recorder = null;
let audio = null;
let streams = [];
const pending = new Set(); // các mẩu đang gửi; phải gửi hết trước khi báo đã dừng

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

  audio = new AudioContext();
  const dest = audio.createMediaStreamDestination();
  const mix = (stream, gain) => {
    const g = audio.createGain();
    g.gain.value = gain;
    audio.createMediaStreamSource(stream).connect(g).connect(dest);
  };
  mix(new MediaStream(display.getAudioTracks()), 0.9);
  if (mic) mix(mic, 0.9);

  recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 96000 });
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    const p = e.data.arrayBuffer().then((buf) => api.recChunk(buf));
    pending.add(p);
    p.finally(() => pending.delete(p));
  };
  recorder.start(1000);
  return { mic: !!mic };
};

window.__pauseRec = () => recorder.pause();
window.__resumeRec = () => recorder.resume();

window.__stopRec = () =>
  new Promise((resolve) => {
    recorder.onstop = async () => {
      await Promise.all(pending);
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      await audio.close();
      resolve();
    };
    recorder.stop();
  });
