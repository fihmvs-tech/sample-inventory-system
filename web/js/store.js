// 本機狀態：借用／歸還清單（購物車）、記住的借用者、管理者金鑰。
// 存在 localStorage，所以用手機相機掃描開出新分頁時，清單也會延續。

const KEY = 'si.state.v1';
let memory = {};
const listeners = new Set();

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return memory;
  }
}

function write(state) {
  memory = state;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 無痕模式等情況下只保留在記憶體。
  }
}

export function get() {
  const s = read();
  return {
    borrow: s.borrow || [],
    ret: s.ret || [],
    me: s.me || null,
    recent: s.recent || [],
    adminKey: s.adminKey || '',
    operatorName: s.operatorName || '',
  };
}

export function update(patch) {
  write({ ...get(), ...patch });
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
}

// 其他分頁改了清單（例如用相機掃描開了新分頁），這個分頁也跟著更新。
window.addEventListener('storage', (e) => {
  if (e.key === KEY) listeners.forEach((fn) => fn());
});

export function rememberBorrower(email, name) {
  const recent = [{ email, name }, ...get().recent.filter((r) => r.email !== email)].slice(0, 5);
  update({ me: { email, name }, recent });
}
