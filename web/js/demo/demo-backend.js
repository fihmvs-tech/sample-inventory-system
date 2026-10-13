// 示範模式：在瀏覽器裡執行真正的 Apps Script 程式碼，資料存在這台裝置的 localStorage。
// 正式環境（config.js 設定了 API_URL）不會載入這個檔案。

import { installFakes, freshState, serialize, deserialize, GAS_FILES, loadScript } from './gas-fakes.js';

const STORAGE_KEY = 'si.demo.v1';
export const DEMO_ADMIN_KEY = 'demo';

const SAMPLE_ITEMS = [
  ['A01', '55 吋展示螢幕', '顯示器', 'A 櫃'],
  ['A02', '智慧手錶樣品（黑）', '穿戴裝置', 'A 櫃'],
  ['A03', '智慧手錶樣品（銀）', '穿戴裝置', 'A 櫃'],
  ['B11', '藍牙耳機展示組', '音訊', 'B 櫃'],
  ['B12', '車用充電器樣品', '車用', 'B 櫃'],
  ['C21', '5G 模組評估板', '通訊', 'C 櫃'],
];

let ready = null;
let state = null;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state));
  } catch (err) {
    console.warn('示範資料無法儲存：', err);
  }
}

function load() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? deserialize(text) : null;
  } catch (err) {
    console.warn('示範資料無法讀取，改用全新資料：', err);
    return null;
  }
}

function post(request) {
  const out = window.doPost({ postData: { contents: JSON.stringify(request) } });
  return JSON.parse(out.getContent());
}

async function boot() {
  const saved = load();
  state = installFakes(window, saved || freshState());
  for (const name of GAS_FILES) {
    await loadScript(new URL(`gas/${name}.js`, import.meta.url).href);
  }
  if (!saved) {
    state.props.ADMIN_KEY = DEMO_ADMIN_KEY;
    window.setup();
    for (const [item_id, name, category, location] of SAMPLE_ITEMS) {
      post({ action: 'saveItem', adminKey: DEMO_ADMIN_KEY, operatorName: '示範資料', item: { item_id, name, category, location } });
    }
    save();
  }
}

export async function demoCall(request) {
  ready ||= boot();
  await ready;
  const result = post(request);
  save();
  return result;
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 無法存取 localStorage 時沒有資料需要清除。
  }
}

export function demoMails() {
  return state ? state.mails.slice() : [];
}
