// 產生展品 QR Code 標籤。QR Code 內容是「前端網址?item=編號」，手機相機一掃就會開啟借還頁面。

import { api } from './api.js';
import * as store from './store.js';
import { esc } from './ui.js';

const controls = document.getElementById('controls');
const labels = document.getElementById('labels');
const appUrl = new URL('./', location.href).href;

function renderLabels(items) {
  const chosen = new Set([...controls.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value));
  labels.innerHTML = '';
  items.filter((i) => chosen.has(i.item_id)).forEach((i) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `<div class="qr"></div><div class="id">${esc(i.item_id)}</div><div class="name">${esc(i.name)}</div>`;
    new window.QRCode(el.querySelector('.qr'), {
      text: `${appUrl}?item=${encodeURIComponent(i.item_id)}`,
      width: 240,
      height: 240,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    labels.appendChild(el);
  });
}

async function main() {
  if (!store.get().adminKey) {
    controls.innerHTML = '<p>請先到 <a href="./#/admin">管理頁面</a> 登入管理者。</p>';
    return;
  }
  let items;
  try {
    items = (await api('listItems')).filter((i) => i.status !== '報廢');
  } catch (err) {
    controls.innerHTML = `<p class="notice notice-warn">${esc(err.message)}</p>`;
    return;
  }

  controls.innerHTML = `
    <h2>選擇要列印的展品</h2>
    <p class="small muted">QR Code 內容為 <code>${esc(appUrl)}?item=編號</code>，用手機相機掃描就會開啟借還頁面。</p>
    <div class="btn-row">
      <button class="btn btn-sm" type="button" data-check="all">全選</button>
      <button class="btn btn-sm" type="button" data-check="none">全不選</button>
    </div>
    <div class="picks mt">${items.map((i) => `
      <label class="pick"><input type="checkbox" value="${esc(i.item_id)}" checked>
        <span><span class="item-id">${esc(i.item_id)}</span> ${esc(i.name)}</span></label>`).join('')}</div>
    <button class="btn btn-primary btn-block mt" type="button" id="print">列印標籤</button>`;

  controls.addEventListener('change', () => renderLabels(items));
  controls.querySelectorAll('[data-check]').forEach((button) => {
    button.addEventListener('click', () => {
      controls.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = button.dataset.check === 'all'; });
      renderLabels(items);
    });
  });
  document.getElementById('print').addEventListener('click', () => window.print());
  renderLabels(items);
}

main();
