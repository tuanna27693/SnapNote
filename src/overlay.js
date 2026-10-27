import { configure, loadImage, clearImage, getState } from './annotator.js';
import { actionButton } from './toolbar.js';

const api = window.api;
const $ = (id) => document.getElementById(id);
const bg = $('bg');
const sel = $('sel');
const sizeLabel = $('size');
const host = $('stage-host');
const toolbar = $('toolbar');

let blobUrl = null;
let start = null;
let phase = 'select'; // 'select' (đang kéo chọn vùng) | 'edit' (đã chọn, đang chú thích)

(async () => {
  const buf = await api.getCaptureImage();
  blobUrl = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
  bg.src = blobUrl;
})();

const close = () => api.cancelSelection();

// Toạ độ chuột (CSS px) -> toạ độ pixel thật của ảnh, bất kể DPI.
function toImage(r) {
  const sx = bg.naturalWidth / window.innerWidth;
  const sy = bg.naturalHeight / window.innerHeight;
  return { x: Math.round(r.x * sx), y: Math.round(r.y * sy), w: Math.round(r.w * sx), h: Math.round(r.h * sy) };
}

const rectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

function place(el, r) {
  Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
}

function draw(r) {
  sel.hidden = false;
  place(sel, r);
  sizeLabel.textContent = `${toImage(r).w} × ${toImage(r).h}`;
  sel.dataset.top = r.y < 32 ? '1' : '0';
}

function reset() {
  start = null;
  phase = 'select';
  sel.hidden = true;
  host.hidden = true;
  toolbar.hidden = true;
  document.body.classList.remove('dragging', 'editing');
  clearImage();
}

// Đặt thanh công cụ ngay dưới vùng chọn; hết chỗ thì lên trên, rồi vào trong.
function placeToolbar(r) {
  toolbar.hidden = false;
  const gap = 10;
  const tw = toolbar.offsetWidth;
  const th = toolbar.offsetHeight;
  let top = r.y + r.h + gap;
  if (top + th > window.innerHeight - gap) top = r.y - th - gap;
  if (top < gap) top = window.innerHeight - th - gap - 10;
  const left = Math.min(Math.max(gap, r.x + r.w - tw), window.innerWidth - tw - gap);
  toolbar.style.left = Math.max(gap, left) + 'px';
  toolbar.style.top = top + 'px';
}

// Cắt vùng chọn từ ảnh nền ngay tại overlay rồi chuyển sang chế độ chú thích.
async function beginEdit(r) {
  phase = 'edit';
  document.body.classList.add('editing');
  const p = toImage(r);
  const canvas = document.createElement('canvas');
  canvas.width = p.w;
  canvas.height = p.h;
  canvas.getContext('2d').drawImage(bg, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  draw(r);
  place(host, r);
  host.hidden = false;
  await loadImage(blob, r.w, r.h);
  placeToolbar(r);
}

configure({
  onEscape: close,
  onCopied: close,
  onSaved: close,
});

const actions = $('actions');
const reselectBtn = actionButton('btn-reselect', 'Chọn lại vùng', '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>');
const editBtn = actionButton('btn-edit', 'Mở trình chỉnh sửa đầy đủ', '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 'Chỉnh sửa');
const closeBtn = actionButton('btn-close', 'Đóng (Esc)', '<path d="M6 6l12 12M18 6L6 18"/>');
actions.prepend(reselectBtn, editBtn);
actions.append(closeBtn);

closeBtn.addEventListener('click', close);
reselectBtn.addEventListener('click', reset);
// Chuyển ảnh gốc + chú thích đã vẽ sang cửa sổ chỉnh sửa đầy đủ, rồi đóng overlay.
editBtn.addEventListener('click', async () => api.openEditor(await getState()));

window.addEventListener('mousedown', (e) => {
  if (phase !== 'select') return;
  if (e.button === 2) return close();
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  document.body.classList.add('dragging');
  draw({ ...start, w: 0, h: 0 });
});

window.addEventListener('mousemove', (e) => {
  if (phase === 'select' && start) draw(rectFrom(start, { x: e.clientX, y: e.clientY }));
});

window.addEventListener('mouseup', (e) => {
  if (phase !== 'select' || !start || e.button !== 0) return;
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  start = null;
  if (r.w < 6 || r.h < 6) return reset();
  beginEdit(r);
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (phase !== 'select') return; // trong chế độ chú thích, annotator tự xử lý phím
  if (e.key === 'Escape') close();
  if (e.key === 'Enter') beginEdit({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
});
