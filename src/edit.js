// Cửa sổ chỉnh sửa đầy đủ: nhận ảnh gốc + chú thích từ overlay, cho sửa tiếp.
import { configure, loadImage, fitTo, imageSize } from './annotator.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

// Hiển thị 1:1 theo pixel thật nếu vừa cửa sổ, nếu không thì thu nhỏ vừa khung.
function relayout() {
  const { w, h } = imageSize();
  if (!w) return;
  const wrap = $('stage-wrap');
  const pad = 48;
  const natural = 1 / window.devicePixelRatio;
  const s = Math.min(natural, (wrap.clientWidth - pad) / w, (wrap.clientHeight - pad) / h);
  fitTo(Math.round(w * s), Math.round(h * s));
  $('status-size').textContent = `${w} × ${h} px · ${Math.round(s * window.devicePixelRatio * 100)}%`;
}

configure({
  onEscape: () => {},
  onCopied: () => toast('Đã sao chép ảnh vào clipboard'),
  onSaved: (p) => toast('Đã lưu: ' + p, 3500),
});

const payload = await api.getEditPayload();
if (payload) {
  const blob = new Blob([payload.image], { type: 'image/png' });
  await loadImage(blob, 100, 100, payload.annotations);
  relayout();
}
window.addEventListener('resize', relayout);
