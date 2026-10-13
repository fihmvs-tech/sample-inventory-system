import { isDemo } from './api.js';
import * as store from './store.js';
import { parseItemId } from './scanner.js';
import { register, route, go, parseHash } from './router.js';
import { toast } from './ui.js';
import { home, borrow, giveBack, mine, addScanned } from './views/borrower.js';
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
store.subscribe(updateBadges);
updateBadges();

// 另一個分頁改了清單時，重新整理清單畫面（正在填寫借用表單時不打斷）。
window.addEventListener('storage', () => {
  const { name } = parseHash();
  if (['', 'borrow', 'return'].includes(name) && !document.querySelector('form[data-dirty]')) route();
});

window.addEventListener('hashchange', route);

route();

// 用手機相機掃描 QR Code 會開啟 …/?item=A31：放進對應清單後切到該清單。
const scanned = parseItemId(new URLSearchParams(location.search).get('item'));
if (scanned) {
  history.replaceState(null, '', location.pathname + location.hash);
  addScanned(scanned)
    .then((result) => {
      toast(result.message);
      go(result.list === 'borrow' ? '#/borrow' : '#/return');
    })
    .catch((err) => toast(err.message, 'error'));
}
