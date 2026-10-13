// 以網址 # 切換畫面：#/borrow、#/item/A31…

import { view, errorHtml } from './ui.js';

let routes = {};
const TAB_OF = { item: 'admin', 'item-edit': 'admin' };

export function register(table) {
  routes = table;
}

export function parseHash() {
  const [name = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name, arg: decodeURIComponent(rest.join('/')) };
}

export async function route() {
  const { name, arg } = parseHash();
  const tab = TAB_OF[name] ?? (routes[name] ? name : '');
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    await (routes[name] || routes[''])(arg);
  } catch (err) {
    view.innerHTML = errorHtml(err.message);
  }
}

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// 非同步載入資料期間使用者可能已切到別頁；回傳的函式用來判斷結果是否還該顯示。
export function current() {
  const hash = location.hash;
  return () => location.hash === hash;
}
