/**
 * 每日逾期檢查與自動催還信。
 * 由 setup() 建立的每日觸發條件呼叫 sendOverdueReminders()，寄件者是部署此腳本的 Google 帳號。
 */

function sendOverdueReminders() {
  return withLock_(sendOverdueReminders_);
}

function escapeHtml_(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function daysBetween_(fromDate, toDate) {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
}

// 預計 10/9 歸還，10/10 起判定逾期。
function sendOverdueReminders_() {
  const settings = settings_();
  const today = today_();
  const loans = openTable_(SHEET.LOANS);
  const overdue = loans.rows.filter(function (r) {
    return r.status === LOAN_STATUS.OPEN && r.expected_return_date && String(r.expected_return_date) < today;
  });

  const byBorrower = {};
  overdue.forEach(function (r) {
    const key = String(r.borrower_email).toLowerCase();
    (byBorrower[key] = byBorrower[key] || []).push(r);
  });

  const cc = settings.ADMIN_EMAILS.split(',').map(function (s) { return s.trim(); }).filter(Boolean).join(',');
  const now = nowText_();
  const logs = [];
  const sent = [];
  Object.keys(byBorrower).forEach(function (email) {
    const rows = byBorrower[email];
    const message = {
      to: email,
      subject: '【展品催還】您有 ' + rows.length + ' 件展品已逾期未歸還',
      htmlBody: reminderHtml_(rows, today, settings.APP_URL),
      name: '展品借還管理系統',
    };
    if (cc) message.cc = cc;
    MailApp.sendEmail(message);
    rows.forEach(function (r) {
      updateRow_(loans, r, { reminder_count: (Number(r.reminder_count) || 0) + 1, last_reminded_at: now });
      logs.push({
        action: ACTION.REMINDER, item_id: r.item_id, loan_id: r.loan_id, borrower_email: email,
        operator: '系統排程', detail: '已逾期 ' + daysBetween_(r.expected_return_date, today) + ' 天',
      });
    });
    sent.push({ email: email, items: rows.length });
  });
  writeLogs_(logs);
  return { date: today, overdueItems: overdue.length, sent: sent };
}

function reminderHtml_(rows, today, appUrl) {
  const name = escapeHtml_(rows[0].borrower_name);
  const lines = rows.map(function (r) {
    return '<tr>' +
      '<td style="padding:6px 10px;border:1px solid #ddd">' + escapeHtml_(r.item_id) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd">' + escapeHtml_(r.item_name) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd">' + escapeHtml_(String(r.borrowed_at).slice(0, 10)) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd">' + escapeHtml_(r.expected_return_date) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd;color:#c62828">' + daysBetween_(r.expected_return_date, today) + ' 天</td>' +
      '</tr>';
  }).join('');
  const link = appUrl
    ? '<p>歸還時請用手機掃描展品上的 QR Code，或開啟 <a href="' + escapeHtml_(appUrl) + '">展品借還系統</a>。</p>'
    : '<p>歸還時請用手機掃描展品上的 QR Code。</p>';
  return '<div style="font-family:sans-serif;font-size:14px;color:#222">' +
    '<p>' + name + ' 您好：</p>' +
    '<p>以下展品已超過預計歸還日期，請儘速歸還，或與管理者聯絡延長借用。</p>' +
    '<table style="border-collapse:collapse">' +
    '<tr style="background:#f5f5f5">' +
    '<th style="padding:6px 10px;border:1px solid #ddd">編號</th>' +
    '<th style="padding:6px 10px;border:1px solid #ddd">名稱</th>' +
    '<th style="padding:6px 10px;border:1px solid #ddd">借用日期</th>' +
    '<th style="padding:6px 10px;border:1px solid #ddd">預計歸還</th>' +
    '<th style="padding:6px 10px;border:1px solid #ddd">逾期</th>' +
    '</tr>' + lines + '</table>' + link +
    '<p style="color:#888;font-size:12px">此信件由系統自動發送。</p></div>';
}
