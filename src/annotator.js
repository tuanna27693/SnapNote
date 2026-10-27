import Konva from 'konva';
import './toolbar.js'; // phải nạp trước để các nút tồn tại khi nối sự kiện

const api = window.api;
const opts = {};

/** Móc nối với trang chủ: onEscape, onCopied, onSaved. */
export function configure(o) {
  Object.assign(opts, o);
}

const $ = (id) => document.getElementById(id);
const ACCENT = '#6366f1';
const FONT = '"Segoe UI", system-ui, sans-serif';
const SWATCHES = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#111827', '#ffffff'];

// ---------- Trạng thái ----------
let tool = 'select';
let imgW = 0;
let imgH = 0;
let scale = 1;
let selected = null;
let drawing = null;
let lastPos = { x: 0, y: 0 };
let history = [];
let hIndex = -1;
let editing = false;

const stage = new Konva.Stage({ container: 'stage', width: 10, height: 10 });
const baseLayer = new Konva.Layer({ listening: false });
const annoLayer = new Konva.Layer();
const uiLayer = new Konva.Layer();
stage.add(baseLayer, annoLayer, uiLayer);

const tr = new Konva.Transformer({
  rotateAnchorOffset: 24,
  anchorSize: 9,
  anchorCornerRadius: 3,
  borderStroke: ACCENT,
  anchorStroke: ACCENT,
  anchorFill: '#fff',
  keepRatio: false,
});
const tipHandle = new Konva.Circle({
  radius: 7,
  fill: '#fff',
  stroke: ACCENT,
  strokeWidth: 2,
  draggable: true,
  visible: false,
});
uiLayer.add(tr, tipHandle);

// ---------- Tiện ích ----------
function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

function contrast(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.7 ? '#111827' : '#ffffff';
}

const style = () => ({
  color: $('color').value,
  width: Number($('width').value) || 4,
  font: Number($('fontsize').value) || 24,
});

const kind = (n) => (n.hasName('a-text') ? 'text' : n.hasName('a-callout') ? 'callout' : 'shape');

// ---------- Callout ----------
function calloutPath(w, h, tx, ty, r = 10) {
  const half = 12;
  const m = r + half + 2;
  const inside = tx >= 0 && tx <= w && ty >= 0 && ty <= h;
  let side = null;
  if (!inside) {
    const dx = tx - w / 2;
    const dy = ty - h / 2;
    side = Math.abs(dx) / w > Math.abs(dy) / h ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'B' : 'T';
  }
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  let d = `M${r},0`;
  if (side === 'T') { const c = cl(tx, m, w - m); d += `L${c - half},0L${tx},${ty}L${c + half},0`; }
  d += `L${w - r},0A${r},${r} 0 0 1 ${w},${r}`;
  if (side === 'R') { const c = cl(ty, m, h - m); d += `L${w},${c - half}L${tx},${ty}L${w},${c + half}`; }
  d += `L${w},${h - r}A${r},${r} 0 0 1 ${w - r},${h}`;
  if (side === 'B') { const c = cl(tx, m, w - m); d += `L${c + half},${h}L${tx},${ty}L${c - half},${h}`; }
  d += `L${r},${h}A${r},${r} 0 0 1 0,${h - r}`;
  if (side === 'L') { const c = cl(ty, m, h - m); d += `L0,${c + half}L${tx},${ty}L0,${c - half}`; }
  d += `L0,${r}A${r},${r} 0 0 1 ${r},0Z`;
  return d;
}

function layoutCallout(g) {
  const label = g.findOne('.label');
  const bubble = g.findOne('.bubble');
  const pad = label.padding();
  // Đo kích thước tự nhiên trước, nếu không chữ dài hơn bề rộng cũ sẽ bị cắt.
  label.width('auto');
  label.height('auto');
  const natW = label.getTextWidth() + pad * 2;
  const natH = label.textArr.length * label.fontSize() * label.lineHeight() + pad * 2;
  const w = Math.max(60, natW);
  const h = Math.max(48, natH);
  label.width(w);
  label.height(h);
  bubble.data(calloutPath(w, h, g.getAttr('tipX'), g.getAttr('tipY')));
  return { w, h };
}

function makeCallout(tip, anchor, text = 'Ghi chú') {
  const { color, font } = style();
  const g = new Konva.Group({ name: 'a-callout', x: anchor.x, y: anchor.y, tipX: tip.x - anchor.x, tipY: tip.y - anchor.y });
  g.add(new Konva.Path({ name: 'bubble', fill: color, data: '' }));
  g.add(new Konva.Text({
    name: 'label', text, fontSize: font, fontFamily: FONT, fontStyle: 'bold',
    fill: contrast(color), padding: 12, lineHeight: 1.2, wrap: 'none',
    align: 'center', verticalAlign: 'middle', listening: false,
  }));
  const { w, h } = layoutCallout(g);
  // Đưa tâm bong bóng về đúng điểm anchor, giữ nguyên vị trí đầu nhọn tuyệt đối.
  g.position({ x: anchor.x - w / 2, y: anchor.y - h / 2 });
  g.setAttrs({ tipX: tip.x - g.x(), tipY: tip.y - g.y() });
  layoutCallout(g);
  return g;
}

// ---------- Soạn chữ trên canvas ----------
function editText(textNode, owner, onDone) {
  editing = true;
  const isCallout = owner && kind(owner) === 'callout';
  const box = stage.container().getBoundingClientRect();
  const abs = textNode.getAbsolutePosition();
  const sc = textNode.getAbsoluteScale().x;
  const pad = textNode.padding() * sc;

  const ta = document.createElement('textarea');
  ta.className = 'canvas-editor';
  ta.value = textNode.text();
  Object.assign(ta.style, {
    position: 'fixed',
    left: box.left + abs.x + pad + 'px',
    top: box.top + abs.y + pad + 'px',
    fontSize: textNode.fontSize() * sc + 'px',
    fontFamily: FONT,
    fontWeight: textNode.fontStyle().includes('bold') ? '700' : '400',
    color: isCallout ? textNode.fill() : textNode.fill(),
    textAlign: isCallout ? 'center' : 'left',
    lineHeight: String(textNode.lineHeight()),
  });
  document.body.appendChild(ta);

  const sync = () => {
    textNode.text(ta.value);
    if (isCallout) layoutCallout(owner);
    const w = isCallout ? textNode.width() : Math.max(textNode.width(), textNode.fontSize() * 2);
    const h = isCallout ? textNode.height() : Math.max(textNode.height(), textNode.fontSize() * 1.2);
    ta.style.width = (w - textNode.padding() * 2) * sc + 4 + 'px';
    ta.style.height = (h - textNode.padding() * 2) * sc + 'px';
    annoLayer.batchDraw();
  };
  textNode.visible(false);
  sync();
  ta.focus();
  ta.select();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const value = ta.value;
    ta.remove();
    textNode.visible(true);
    editing = false;
    onDone(value);
  };
  ta.addEventListener('input', sync);
  ta.addEventListener('blur', finish);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.shiftKey === false && false))) finish();
    if (e.key === 'Enter' && e.ctrlKey) finish();
  });
}

function editNode(node) {
  if (kind(node) === 'text') {
    editText(node, node, (v) => {
      if (!v.trim()) { node.destroy(); select(null); } else { node.text(v); select(node); }
      setTool('select');
      pushHistory();
    });
  } else if (kind(node) === 'callout') {
    const label = node.findOne('.label');
    editText(label, node, (v) => {
      if (!v.trim()) { node.destroy(); select(null); } else { label.text(v); layoutCallout(node); select(node); }
      setTool('select');
      pushHistory();
    });
  }
}

// ---------- Chọn / biến đổi ----------
function select(node) {
  selected = node;
  if (!node) {
    tr.nodes([]);
  } else {
    const resizable = kind(node) === 'shape';
    tr.nodes([node]);
    tr.resizeEnabled(resizable);
    tr.rotateEnabled(resizable);
    syncToolbarFrom(node);
  }
  updateTipHandle();
  uiLayer.batchDraw();
}

function updateTipHandle() {
  if (selected && kind(selected) === 'callout') {
    tipHandle.position({ x: selected.x() + selected.getAttr('tipX'), y: selected.y() + selected.getAttr('tipY') });
    tipHandle.visible(true);
  } else {
    tipHandle.visible(false);
  }
}

tipHandle.on('dragmove', () => {
  if (!selected) return;
  selected.setAttrs({ tipX: tipHandle.x() - selected.x(), tipY: tipHandle.y() - selected.y() });
  layoutCallout(selected);
  annoLayer.batchDraw();
});
tipHandle.on('dragend', pushHistory);

function syncToolbarFrom(n) {
  const k = kind(n);
  if (k === 'callout') {
    $('color').value = n.findOne('.bubble').fill();
    $('fontsize').value = n.findOne('.label').fontSize();
  } else if (k === 'text') {
    $('color').value = n.fill();
    $('fontsize').value = n.fontSize();
  } else if (n.stroke()) {
    $('color').value = n.stroke();
    $('width').value = Math.round(n.strokeWidth());
  }
}

function applyStyleToSelected() {
  if (!selected) return;
  const { color, width, font } = style();
  const k = kind(selected);
  if (k === 'callout') {
    selected.findOne('.bubble').fill(color);
    const label = selected.findOne('.label');
    label.fill(contrast(color));
    label.fontSize(font);
    layoutCallout(selected);
  } else if (k === 'text') {
    selected.fill(color);
    selected.fontSize(font);
  } else {
    selected.stroke(color);
    selected.strokeWidth(width);
    if (selected.className === 'Arrow') {
      selected.fill(color);
      selected.pointerLength(width * 3 + 6);
      selected.pointerWidth(width * 3 + 6);
    }
  }
  annoLayer.batchDraw();
  updateTipHandle();
  pushHistory();
}

// ---------- Lịch sử ----------
function snapshot() {
  return annoLayer.getChildren().map((n) => n.toJSON());
}

function pushHistory() {
  history = history.slice(0, hIndex + 1);
  history.push(snapshot());
  if (history.length > 100) history.shift();
  hIndex = history.length - 1;
  updateButtons();
}

function restore(i) {
  select(null);
  annoLayer.destroyChildren();
  for (const json of history[i]) {
    const n = Konva.Node.create(json);
    annoLayer.add(n);
    wire(n);
  }
  hIndex = i;
  refreshDraggable();
  annoLayer.batchDraw();
  updateButtons();
}

const undo = () => hIndex > 0 && restore(hIndex - 1);
const redo = () => hIndex < history.length - 1 && restore(hIndex + 1);

function updateButtons() {
  $('btn-undo').disabled = hIndex <= 0;
  $('btn-redo').disabled = hIndex >= history.length - 1;
}

function wire(node) {
  node.on('dragmove', updateTipHandle);
  node.on('dragend transformend', pushHistory);
  node.on('dblclick dbltap', () => tool === 'select' && editNode(node));
}

function refreshDraggable() {
  annoLayer.getChildren().forEach((n) => n.draggable(tool === 'select'));
}

function removeSelected() {
  if (!selected) return;
  selected.destroy();
  select(null);
  annoLayer.batchDraw();
  pushHistory();
}

// ---------- Công cụ ----------
function setTool(t) {
  tool = t;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  if (t !== 'select') select(null);
  refreshDraggable();
  stage.container().style.cursor = t === 'select' ? 'default' : 'crosshair';
}

function topLevel(target) {
  if (!target || target === stage || target.getLayer() !== annoLayer) return null;
  let n = target;
  while (n.parent && n.parent !== annoLayer) n = n.parent;
  return n;
}

function pointer() {
  const p = annoLayer.getRelativePointerPosition();
  if (p) lastPos = p;
  return lastPos;
}

function startDraw() {
  const p = pointer();
  const { color, width } = style();
  const common = { stroke: color, strokeWidth: width, strokeScaleEnabled: false, name: 'a-shape', lineCap: 'round', lineJoin: 'round' };
  let node = null;
  switch (tool) {
    case 'rect': node = new Konva.Rect({ ...common, x: p.x, y: p.y, width: 0, height: 0, cornerRadius: 2 }); break;
    case 'ellipse': node = new Konva.Ellipse({ ...common, x: p.x, y: p.y, radiusX: 0, radiusY: 0 }); break;
    case 'arrow':
      node = new Konva.Arrow({ ...common, points: [p.x, p.y, p.x, p.y], fill: color, pointerLength: width * 3 + 6, pointerWidth: width * 3 + 6 });
      break;
    case 'pen': node = new Konva.Line({ ...common, points: [p.x, p.y], tension: 0.3 }); break;
    case 'callout':
      node = new Konva.Line({ points: [p.x, p.y, p.x, p.y], stroke: ACCENT, strokeWidth: 2, dash: [6, 4], strokeScaleEnabled: false });
      uiLayer.add(node);
      break;
    case 'text': break;
    default: return;
  }
  drawing = { tool, start: p, node };
  if (node && tool !== 'callout') annoLayer.add(node);
}

function moveDraw() {
  if (!drawing || !drawing.node) return;
  const p = pointer();
  const s = drawing.start;
  const n = drawing.node;
  if (drawing.tool === 'rect') n.setAttrs({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) });
  else if (drawing.tool === 'ellipse') n.setAttrs({ x: (s.x + p.x) / 2, y: (s.y + p.y) / 2, radiusX: Math.abs(p.x - s.x) / 2, radiusY: Math.abs(p.y - s.y) / 2 });
  else if (drawing.tool === 'arrow' || drawing.tool === 'callout') n.points([s.x, s.y, p.x, p.y]);
  else if (drawing.tool === 'pen') n.points(n.points().concat([p.x, p.y]));
  (drawing.tool === 'callout' ? uiLayer : annoLayer).batchDraw();
}

function endDraw() {
  if (!drawing) return;
  const { tool: t, start, node } = drawing;
  const p = lastPos;
  drawing = null;
  const dist = Math.hypot(p.x - start.x, p.y - start.y);

  if (t === 'text') {
    const { color, font } = style();
    const txt = new Konva.Text({ name: 'a-text', x: start.x, y: start.y, text: '', fontSize: font, fontFamily: FONT, fill: color, lineHeight: 1.2 });
    annoLayer.add(txt);
    wire(txt);
    editNode(txt);
    return;
  }
  if (t === 'callout') {
    node.destroy();
    uiLayer.batchDraw();
    const anchor = dist < 12 ? { x: start.x + 90, y: start.y - 70 } : p;
    const g = makeCallout(start, anchor);
    annoLayer.add(g);
    wire(g);
    g.draggable(false);
    editNode(g);
    return;
  }
  if ((t === 'rect' || t === 'ellipse' || t === 'arrow') && dist < 3) {
    node.destroy();
    annoLayer.batchDraw();
    return;
  }
  wire(node);
  node.draggable(false);
  pushHistory();
}

stage.on('mousedown touchstart', (e) => {
  if (!imgW || editing) return;
  if (e.target.getLayer() === uiLayer) return; // bấm vào tay nắm / transformer
  if (tool === 'select') {
    select(topLevel(e.target));
    return;
  }
  startDraw();
});
stage.on('mousemove touchmove', () => {
  pointer();
  moveDraw();
});
window.addEventListener('mouseup', endDraw);
window.addEventListener('touchend', endDraw);

// ---------- Ảnh nền ----------
let baseBlob = null;

function applyScale(cssWidth, cssHeight) {
  scale = cssWidth / imgW;
  stage.size({ width: cssWidth, height: cssHeight });
  stage.scale({ x: scale, y: scale });
  tipHandle.scale({ x: 1 / scale, y: 1 / scale });
  tr.anchorSize(9 / Math.max(scale, 0.5));
  stage.batchDraw();
}

/** Đổi kích thước hiển thị (CSS px), giữ nguyên toạ độ ảnh gốc. */
export function fitTo(cssWidth, cssHeight) {
  if (imgW) applyScale(cssWidth, cssHeight);
}

export const imageSize = () => ({ w: imgW, h: imgH });

/** Ảnh gốc (chưa vẽ) + các chú thích dạng JSON, để mở tiếp trong cửa sổ chỉnh sửa. */
export async function getState() {
  return { image: new Uint8Array(await baseBlob.arrayBuffer()), annotations: snapshot() };
}

/**
 * Nạp ảnh đã cắt; cssWidth/cssHeight là kích thước hiển thị (CSS px) của vùng chọn.
 * annotations (tuỳ chọn) khôi phục các chú thích đã vẽ trước đó, vẫn sửa được.
 */
export async function loadImage(blob, cssWidth, cssHeight, annotations = []) {
  baseBlob = blob;
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  imgW = img.naturalWidth;
  imgH = img.naturalHeight;
  baseLayer.destroyChildren();
  baseLayer.add(new Konva.Image({ image: img, width: imgW, height: imgH, listening: false }));
  annoLayer.destroyChildren();
  for (const json of annotations) {
    const n = Konva.Node.create(json);
    annoLayer.add(n);
    wire(n);
  }
  select(null);
  history = [];
  hIndex = -1;
  pushHistory();
  setTool('select');
  applyScale(cssWidth, cssHeight);
}

/** Bỏ ảnh hiện tại (khi người dùng chọn lại vùng). */
export function clearImage() {
  imgW = 0;
  select(null);
  annoLayer.destroyChildren();
  baseLayer.destroyChildren();
}

// ---------- Xuất ảnh ----------
async function exportBlob() {
  const prev = selected;
  tr.nodes([]);
  tipHandle.visible(false);
  uiLayer.draw();
  const url = stage.toDataURL({ x: 0, y: 0, width: stage.width(), height: stage.height(), pixelRatio: 1 / scale, mimeType: 'image/png' });
  if (prev) select(prev);
  return (await fetch(url)).blob();
}

async function copyImage() {
  if (!imgW) return;
  try {
    const blob = await exportBlob();
    await api.copyImage(new Uint8Array(await blob.arrayBuffer()));
    opts.onCopied?.();
  } catch (e) {
    toast('Không sao chép được: ' + e);
  }
}

async function saveImage() {
  if (!imgW) return;
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const name = `SnapNote_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
  try {
    const bytes = new Uint8Array(await (await exportBlob()).arrayBuffer());
    const path = await api.saveImage(bytes, name);
    if (path) opts.onSaved?.(path);
  } catch (e) {
    toast('Lưu thất bại: ' + e, 3000);
  }
}

// ---------- Nối giao diện ----------
document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
SWATCHES.forEach((c) => {
  const i = document.createElement('i');
  i.style.background = c;
  i.addEventListener('click', () => { $('color').value = c; applyStyleToSelected(); });
  $('swatches').appendChild(i);
});
$('color').addEventListener('input', applyStyleToSelected);
$('width').addEventListener('change', applyStyleToSelected);
$('fontsize').addEventListener('change', applyStyleToSelected);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-delete').addEventListener('click', removeSelected);
$('btn-copy').addEventListener('click', copyImage);
$('btn-save').addEventListener('click', saveImage);

const KEY_TOOLS = { v: 'select', r: 'rect', o: 'ellipse', a: 'arrow', p: 'pen', t: 'text', c: 'callout' };
window.addEventListener('keydown', (e) => {
  if (!imgW || editing) return;
  const inField = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
  const wantsCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && e.target.selectionStart === e.target.selectionEnd;
  if (inField && !wantsCopy) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (k === 'c') { e.preventDefault(); copyImage(); }
    else if (k === 's') { e.preventDefault(); saveImage(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
  else if (e.key === 'Escape') { if (selected) select(null); else if (tool !== 'select') setTool('select'); else opts.onEscape?.(); }
  else if (e.key === 'Enter' && selected && kind(selected) !== 'shape') editNode(selected);
  else if (KEY_TOOLS[k] && imgW) setTool(KEY_TOOLS[k]);
});

setTool('select');
updateButtons();
