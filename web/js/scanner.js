// 頁面內連續掃描：開一次相機就能掃多件，不用每掃一件就跳出新網頁。

const LIB_URL = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
let libPromise = null;

function loadLib() {
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

/**
 * 開啟全螢幕掃描畫面。onScan(itemId) 回傳成功訊息或丟出錯誤；按「完成」時呼叫 onClose。
 */
export async function openScanner({ title, onScan, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'scanner';
  overlay.innerHTML = `
    <div class="scanner-head">
      <strong></strong>
      <button type="button" class="btn btn-primary" data-close>完成</button>
    </div>
    <div id="qr-reader" class="scanner-video"></div>
    <p class="scanner-hint">將展品上的 QR Code 對準框內，可以連續掃描多件</p>
    <ul class="scanner-log" aria-live="polite"></ul>`;
  overlay.querySelector('strong').textContent = title;
  document.body.appendChild(overlay);
  const log = overlay.querySelector('.scanner-log');

  const addLog = (kind, text) => {
    const li = document.createElement('li');
    li.className = kind;
    li.textContent = text;
    log.prepend(li);
  };

  let scanner = null;
  let busy = false;
  let last = { id: null, at: 0 };

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
        // 鏡頭停在同一個 QR Code 上會一直觸發，3 秒內同一件只處理一次。
        if (busy || (id === last.id && now - last.at < 3000)) return;
        last = { id, at: now };
        if (!id) {
          addLog('err', '這不是展品的 QR Code');
          return;
        }
        busy = true;
        try {
          addLog('ok', await onScan(id));
          navigator.vibrate && navigator.vibrate(60);
        } catch (err) {
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
