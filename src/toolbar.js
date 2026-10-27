// Thanh công cụ dùng chung cho overlay và cửa sổ chỉnh sửa: chèn vào #toolbar trước khi annotator nối sự kiện.
const icon = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const tool = (name, title, d) => `<button data-tool="${name}" title="${title}">${icon(d)}</button>`;

document.getElementById('toolbar').innerHTML = `
  <div id="tools" class="group">
    ${tool('select', 'Chọn / di chuyển (V)', '<path d="M6 4l12 7-5 1.5L11 18z"/>')}
    ${tool('rect', 'Hình chữ nhật (R)', '<rect x="4.5" y="6.5" width="15" height="11" rx="1.5"/>')}
    ${tool('ellipse', 'Hình elip (O)', '<ellipse cx="12" cy="12" rx="8" ry="6"/>')}
    ${tool('arrow', 'Mũi tên (A)', '<path d="M5 19L19 5M10 5h9v9"/>')}
    ${tool('pen', 'Bút vẽ (P)', '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/>')}
    ${tool('text', 'Chữ (T)', '<path d="M6 6h12M12 6v13M9 19h6"/>')}
    ${tool('callout', 'Callout (C): bấm điểm cần chỉ, kéo ra vị trí bong bóng', '<path d="M5 5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>')}
  </div>
  <span class="sep"></span>
  <div class="group">
    <input id="color" type="color" value="#ef4444" title="Màu" />
    <div id="swatches"></div>
    <label class="num" title="Độ dày nét">
      ${icon('<path d="M4 7h16M4 12h16M4 17h16" stroke-width="1"/>')}
      <input id="width" type="number" min="1" max="30" value="4" />
    </label>
    <label class="num" title="Cỡ chữ">
      <b>Aa</b>
      <input id="fontsize" type="number" min="8" max="120" value="24" />
    </label>
  </div>
  <span class="sep"></span>
  <div class="group">
    <button id="btn-undo" title="Hoàn tác (Ctrl+Z)">${icon('<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -3)"/>')}</button>
    <button id="btn-redo" title="Làm lại (Ctrl+Y)">${icon('<path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12" transform="translate(0 -3)"/>')}</button>
    <button id="btn-delete" title="Xóa (Delete)">${icon('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>')}</button>
  </div>
  <span class="sep"></span>
  <div id="actions" class="group">
    <button id="btn-copy" title="Sao chép ảnh (Ctrl+C)">${icon('<rect x="8" y="8" width="11" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-8A1.5 1.5 0 0 0 5 5.5v10A1.5 1.5 0 0 0 6.5 17H8"/>')}Sao chép</button>
    <button id="btn-save" class="primary" title="Lưu ảnh (Ctrl+S)">${icon('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>')}Lưu</button>
  </div>`;

/** Tạo nút phụ cho từng trang (chọn lại, chỉnh sửa, đóng...). */
export function actionButton(id, title, svgInner, label = '') {
  const b = document.createElement('button');
  b.id = id;
  b.title = title;
  b.innerHTML = icon(svgInner) + label;
  return b;
}
