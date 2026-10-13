// 頁面內連續掃描：開一次相機就能掃多件，不用每掃一件就跳出新網頁。

const LIB_URL = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
let libPromise = null;

function loadLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  libPromise ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = LIB_URL;
    el.onload = resolve;
    el.onerror = () => {
      libPromise = null;
      reject(new Error('無法載入掃描元件，請檢查網路'));
    };
    document.head.appendChild(el);
  });
  return libPromise;
}

// QR Code 內容可以是完整網址（…?item=A31）或單純的展品編號。
export function parseItemId(text) {
  const raw = String(text || '').trim();
  try {
    const id = new URL(raw).searchParams.get('item');
    if (id) return id.trim().toUpperCase();
  } catch {
    // 不是網址，當成編號處理。
  }
  return /^[A-Za-z0-9._-]{1,40}$/.test(raw) ? raw.toUpperCase() : null;
}

function cameraError(err) {
  const text = String(err && (err.name || err.message || err));
  if (!window.isSecureContext) return '相機需要 HTTPS 網址才能使用';
  if (/NotAllowed|Permission/i.test(text)) return '沒有相機權限，請在瀏覽器設定中允許此網站使用相機';
  if (/NotFound|Requested device not found/i.test(text)) return '找不到可用的相機';
  return '無法開啟相機：' + text;
}

const FLASH_MS = 2000;
const SAME_CODE_MS = 4000;

/**
 * 開啟全螢幕掃描畫面。按「完成」時呼叫 onClose。
 * onScan(itemId) 回傳 { message, added }，失敗時丟出錯誤：
 * 每次掃描的結果都會在掃描框中央顯示 2 秒；下方清單只記錄新加入的展品與錯誤，同樣的訊息不重複。
 */
export async function openScanner({ title, onScan, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'scanner';
  overlay.innerHTML = `
    <div class="scanner-head">
      <strong></strong>
      <button type="button" class="btn btn-primary" data-close>完成</button>
    </div>
    <div class="scanner-stage">
      <div id="qr-reader" class="scanner-video"></div>
      <div class="scan-flash" role="status" aria-live="assertive" hidden></div>
    </div>
    <p class="scanner-hint">將展品上的 QR Code 對準框內，可以連續掃描多件</p>
    <ul class="scanner-log"></ul>`;
  overlay.querySelector('strong').textContent = title;
  document.body.appendChild(overlay);
  const log = overlay.querySelector('.scanner-log');
  const flashEl = overlay.querySelector('.scan-flash');

  let flashTimer = null;
  const flash = (kind, text) => {
    flashEl.textContent = text;
    flashEl.className = `scan-flash ${kind}`;
    flashEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashEl.hidden = true; }, FLASH_MS);
  };

  const logged = new Set();
  const addLog = (kind, text) => {
    if (logged.has(text)) return;
    logged.add(text);
    const li = document.createElement('li');
    li.className = kind;
    li.textContent = text;
    log.prepend(li);
  };

  let scanner = null;
  let busy = false;
  let last = { text: null, at: 0 };

  overlay.querySelector('[data-close]').addEventListener('click', async () => {
    try {
      if (scanner && scanner.isScanning) await scanner.stop();
    } catch {
      // 相機已經關閉。
    }
    overlay.remove();
    onClose && onClose();
  });

  try {
    await loadLib();
    scanner = new window.Html5Qrcode('qr-reader');
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      async (text) => {
        const id = parseItemId(text);
        const now = Date.now();
        // 鏡頭停在同一個 QR Code 上會一直觸發，4 秒內同一個內容只處理一次。
        if (busy || (text === last.text && now - last.at < SAME_CODE_MS)) return;
        last = { text, at: now };
        if (!id) {
          flash('err', '這不是展品的 QR Code');
          return;
        }
        busy = true;
        try {
          const result = await onScan(id);
          flash(result.added ? 'ok' : 'info', result.message);
          if (result.added) addLog('ok', result.message);
          navigator.vibrate && navigator.vibrate(60);
        } catch (err) {
          flash('err', err.message);
          addLog('err', err.message);
          navigator.vibrate && navigator.vibrate([40, 40, 40]);
        } finally {
          busy = false;
        }
      },
      () => {},
    );
  } catch (err) {
    addLog('err', err.message && /掃描元件/.test(err.message) ? err.message : cameraError(err));
  }
}
