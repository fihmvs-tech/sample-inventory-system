import { API_URL } from './config.js';
import * as store from './store.js';

// 本機預覽（localhost）一律用示範模式，開發時不會動到正式資料。
export const isDemo = !API_URL || ['localhost', '127.0.0.1'].includes(location.hostname);

// 所有後端呼叫都走這裡：POST {action, ...params}，回傳 data 或丟出錯誤訊息。
export async function api(action, params = {}) {
  const { adminKey, operatorName } = store.get();
  const body = { action, ...params };
  if (adminKey && !('adminKey' in params)) {
    body.adminKey = adminKey;
    body.operatorName = operatorName;
  }

  let res;
  if (isDemo) {
    const { demoCall } = await import('./demo/demo-backend.js');
    res = await demoCall(body);
  } else {
    let response;
    try {
      // text/plain 不會觸發 CORS 預檢，Apps Script 才能正常回應。
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('無法連線到伺服器，請檢查網路後再試一次');
    }
    if (!response.ok) throw new Error(`伺服器錯誤（${response.status}）`);
    res = await response.json();
  }
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// 借用事由、Email 網域等設定很少變動，載入一次後重複使用；管理者登入／登出時清除。
let configPromise = null;

export function getConfig() {
  configPromise ||= api('getConfig').catch((err) => {
    configPromise = null;
    throw err;
  });
  return configPromise;
}

export function clearConfig() {
  configPromise = null;
}
