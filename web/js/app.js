import { isDemo } from './api.js';
import * as store from './store.js';
import { parseItemId } from './scanner.js';
import { register, route, go, parseHash } from './router.js';
import { view, esc, toast } from './ui.js';
import { home, borrow, giveBack, mine, addScanned, listHash } from './views/borrower.js';
import { admin, item, itemEdit } from './views/admin.js';

register({
  '': home,
  borrow,
  return: giveBack,
  mine,
  admin,
  item,
  'item-edit': itemEdit,
});

document.getElementById('demo-banner').hidden = !isDemo;

function updateBadges() {
  const s = store.get();
  document.querySelectorAll('[data-count]').forEach((el) => {
    const n = s[el.dataset.count].length;
    el.textContent = n;
    el.hidden = n === 0;
  });
}

// 底部的清單列（像點餐 App 的購物車）：清單有展品、而且不在首頁或清單頁時提醒下一步。
// 首頁頂端已有「下一步」卡片，借用／歸還頁本身就是清單，所以那幾頁不顯示。
const cartbar = document.getElementById('cartbar');
function updateCartbar() {
  const s = store.get();
  const { name } = parseHash();
  const show = !['', 'borrow', 'return', 'item-edit'].includes(name) && (s.borrow.length > 0 || s.ret.length > 0);
  cartbar.hidden = !show;
  document.body.classList.toggle('has-cartbar', show);
  if (!show) return;
  cartbar.innerHTML = [
    s.borrow.length ? `<a class="cartbar-btn" href="#/borrow"><span class="cart-count">${s.borrow.length}</span><span>件待借用</span><span class="cart-go">填寫送出 →</span></a>` : '',
    s.ret.length ? `<a class="cartbar-btn cartbar-return" href="#/return"><span class="cart-count">${s.ret.length}</span><span>件待歸還</span><span class="cart-go">確認歸還 →</span></a>` : '',
  ].join('');
}

function refreshChrome() {
  updateBadges();
  updateCartbar();
}
store.subscribe(refreshChrome);
window.addEventListener('hashchange', updateCartbar);
refreshChrome();

// 另一個分頁改了清單時，重新整理清單畫面（正在填寫借用表單時不打斷）。
window.addEventListener('storage', () => {
  const { name } = parseHash();
  if (['', 'borrow', 'return'].includes(name) && !document.querySelector('form[data-dirty]')) route();
});

window.addEventListener('hashchange', route);

// 用手機相機掃描 QR Code 會開啟 …/?item=A31：查詢期間顯示進度，放進對應清單後直接切到該清單。
const scanned = parseItemId(new URLSearchParams(location.search).get('item'));
if (scanned) {
  history.replaceState(null, '', location.pathname + location.hash);
  view.innerHTML = `<section class="card"><p class="empty">正在查詢展品 ${esc(scanned)}…</p></section>`;
  addScanned(scanned)
    .then((result) => {
      toast(result.message);
      go(listHash(result.list));
    })
    .catch((err) => {
      toast(err.message, 'error');
      route();
    });
} else {
  route();
}
