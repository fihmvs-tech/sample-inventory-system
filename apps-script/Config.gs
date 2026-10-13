/**
 * 全域常數：工作表名稱、欄位、狀態與預設設定。
 */

const SHEET = {
  ITEMS: 'Items',
  LOANS: 'Loans',
  LOGS: 'Logs',
  BORROWERS: 'Borrowers',
  SETTINGS: 'Settings',
};

// 每張工作表的欄位。程式依標題列名稱讀寫，欄位順序可以在試算表中自行調整。
const HEADERS = {
  Items: [
    'item_id', 'name', 'category', 'location', 'status',
    'current_borrower_email', 'current_borrower_name', 'current_loan_id', 'expected_return_date',
    'note', 'created_at', 'updated_at',
  ],
  // 按件獨立紀錄：一張借用單借 5 件就有 5 列，分批歸還時逐列結清。
  Loans: [
    'loan_id', 'item_id', 'item_name', 'borrower_email', 'borrower_name', 'reason',
    'expected_return_date', 'borrowed_at', 'operator', 'status',
    'returned_at', 'return_operator', 'reminder_count', 'last_reminded_at',
  ],
  Logs: ['timestamp', 'action', 'item_id', 'loan_id', 'borrower_email', 'operator', 'detail'],
  Borrowers: ['email', 'name', 'last_used_at'],
  Settings: ['key', 'value', 'description'],
};

// 設為純文字格式的欄位，避免 "001" 之類的編號被試算表轉成數字。
const TEXT_COLUMNS = ['item_id', 'loan_id', 'current_loan_id'];

const ITEM_STATUS = {
  IN_STOCK: '在庫',
  ON_LOAN: '借出',
  REPAIR: '送修',
  LOST: '遺失',
  RETIRED: '報廢',
};

const LOAN_STATUS = {
  OPEN: '借出中',
  RETURNED: '已歸還',
  TRANSFERRED: '已移轉',
};

const ACTION = {
  CREATE: '新增',
  EDIT: '編輯',
  CHECKOUT: '借出',
  PARTIAL_RETURN: '部分歸還',
  FULL_RETURN: '完全歸還',
  REPAIR: '送修',
  STATUS: '狀態變更',
  TRANSFER: '移轉',
  REMINDER: '催還通知',
};

const DEFAULT_SETTINGS = [
  ['REASONS', '客戶拜訪,展覽出國-日本,展覽出國-美國,內部維修,其他', '借用事由選項，以逗號分隔'],
  ['EMAIL_DOMAIN', '', '公司 Email 網域（例如 example.com）。設定後借用者只需輸入 Email 前綴'],
  ['ADMIN_EMAILS', '', '催還信的副本收件人，以逗號分隔'],
  ['REMINDER_HOUR', '17', '每日自動催還的時間（0-23 點）。修改後請重新執行 setup()'],
  ['APP_URL', '', '前端網址，會附在催還信中'],
];
