// 系統入口 QR Code：掃描後開啟系統首頁，可列印或下載成圖片分享。

const appUrl = new URL('./', location.href).href;
const box = document.getElementById('qr');
document.getElementById('url').textContent = appUrl;

new window.QRCode(box, {
  text: appUrl,
  width: 512,
  height: 512,
  correctLevel: window.QRCode.CorrectLevel.M,
});

document.getElementById('print').addEventListener('click', () => window.print());

// 下載的圖片加上白邊與標題，方便直接貼到 LINE 或 Email。
document.getElementById('download').addEventListener('click', () => {
  const qr = box.querySelector('canvas');
  const pad = 48;
  const size = qr.width;
  const canvas = document.createElement('canvas');
  canvas.width = size + pad * 2;
  canvas.height = size + pad * 2 + 120;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(qr, pad, pad);
  ctx.fillStyle = '#0f3b47';
  ctx.textAlign = 'center';
  ctx.font = 'bold 44px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  ctx.fillText('展品借還系統', canvas.width / 2, size + pad + 70);
  ctx.fillStyle = '#5f6b7a';
  ctx.font = '24px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  ctx.fillText('用手機相機掃描開啟', canvas.width / 2, size + pad + 108);

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = '展品借還系統-QR.png';
  link.click();
});
