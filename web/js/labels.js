// 列印展品標籤：每張標籤是展品的 QR Code（系統網址?item=編號）＋編號＋名稱。
// labels.html?ids=A31,A32 只預先勾選指定的展品（單品頁的「列印這件的標籤」用這個）。

import { api } from './api.js';
import * as store from './store.js';
import { esc, itemUrl } from './ui.js';

const controls = document.getElementById('controls');
const labelsBox = document.getElementById('labels');
const SIZES = [['s', '小（QR 2.5 cm）'], ['m', '中（QR 3.5 cm）'], ['l', '大（QR 5 cm）']];
const preset = new Set((new URLSearchParams(location.search).get('ids') || '')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));

const state = { search: '', category: '', size: 'm' };
let items = [];
let selected = new Set();
const labelCache = new Map();

function visibleItems() {
  const q = state.search.trim().toLowerCase();
  return items.filter((i) => (!state.category || i.category === state.category)
    && (!q || [i.item_id, i.name, i.location].some((v) => String(v || '').toLowerCase().includes(q))));
}

function labelFor(item) {
  if (!labelCache.has(item.item_id)) {
    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `<div class="qr"></div><div class="id">${esc(item.item_id)}</div><div class="name">${esc(item.name)}</div>`;
    new window.QRCode(el.querySelector('.qr'), {
      text: itemUrl(item.item_id),
      width: 300,
      height: 300,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    labelCache.set(item.item_id, el);
  }
  return labelCache.get(item.item_id);
}

function renderLabels() {
  labelsBox.className = `labels size-${state.size}`;
  labelsBox.replaceChildren(...items.filter((i) => selected.has(i.item_id)).map(labelFor));
  document.getElementById('count').textContent = `已選 ${selected.size} 件`;
  document.getElementById('print').disabled = selected.size === 0;
}

function renderPicks() {
  const shown = visibleItems();
  document.getElementById('picks').innerHTML = shown.length
    ? shown.map((i) => `
        <label class="pick"><input type="checkbox" value="${esc(i.item_id)}" ${selected.has(i.item_id) ? 'checked' : ''}>
          <span><span class="item-id">${esc(i.item_id)}</span> ${esc(i.name)} <span class="status">${esc(i.status)}</span></span></label>`).join('')
    : '<p class="empty">沒有符合的展品</p>';
}

async function main() {
  if (!store.get().adminKey) {
    controls.innerHTML = '<p>請先到 <a href="./#/admin">管理頁面</a> 登入管理者。</p>';
    return;
  }
  try {
    items = (await api('listItems')).filter((i) => i.status !== '報廢');
  } catch (err) {
    controls.innerHTML = `<p class="notice notice-warn">${esc(err.message)}</p>`;
    return;
  }
  selected = new Set(items.map((i) => i.item_id).filter((id) => !preset.size || preset.has(id)));
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();

  controls.innerHTML = `
    <h2>列印展品標籤</h2>
    <p class="small muted">QR Code 內容是系統網址加上展品編號，同仁用手機相機掃描就能借用或歸還。建議用貼紙或護貝後貼在展品上。</p>
    <div class="filters mt">
      <input type="search" id="q" placeholder="搜尋編號、名稱、存放位置" aria-label="搜尋展品">
      <select id="cat" aria-label="類別">
        <option value="">全部類別</option>
        ${categories.map((c) => `<option>${esc(c)}</option>`).join('')}
      </select>
      <select id="size" aria-label="標籤尺寸">
        ${SIZES.map(([v, label]) => `<option value="${v}" ${v === state.size ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
    <div class="btn-row mt">
      <button class="btn btn-sm" type="button" data-check="all">全選目前清單</button>
      <button class="btn btn-sm" type="button" data-check="none">全部取消</button>
    </div>
    <div class="picks mt" id="picks"></div>
    <div class="actions mt">
      <span class="muted small" id="count"></span>
      <button class="btn btn-primary" type="button" id="print">列印標籤</button>
    </div>`;

  document.getElementById('q').addEventListener('input', (e) => { state.search = e.target.value; renderPicks(); });
  document.getElementById('cat').addEventListener('change', (e) => { state.category = e.target.value; renderPicks(); });
  document.getElementById('size').addEventListener('change', (e) => { state.size = e.target.value; renderLabels(); });
  document.getElementById('picks').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) selected.add(e.target.value);
    else selected.delete(e.target.value);
    renderLabels();
  });
  controls.querySelectorAll('[data-check]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.check === 'all') visibleItems().forEach((i) => selected.add(i.item_id));
      else selected.clear();
      renderPicks();
      renderLabels();
    });
  });
  document.getElementById('print').addEventListener('click', () => window.print());
  renderPicks();
  renderLabels();
}

main();
