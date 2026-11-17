/* Trang hồ sơ cá nhân: "đăng nhập" = kết nối ví. Lịch sử tiền được dựng từ event của contract. */
const ABI = [
  'function arbiter() view returns (address)',
  'function jobCounter() view returns (uint256)',
  'function jobs(uint256) view returns (uint256 id, address client, address freelancer, string title, uint256 amount, string workHash, uint256 deadline, uint256 submittedAt, uint8 status)',
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed freelancer, uint256 amount, uint256 deadline)',
  'event JobCompleted(uint256 indexed jobId, uint256 freelancerAmount, uint256 clientAmount)',
  'event JobCancelled(uint256 indexed jobId)'
];
const SEPOLIA = '0xaa36a7';
const EXPLORER = 'https://sepolia.etherscan.io';
const STATUS = ['Đã tạo', 'Đã nộp bài', 'Hoàn tất', 'Tranh chấp', 'Đã huỷ'];
const PAGE_SIZE = 10;
const $ = id => document.getElementById(id);

let provider, account, contract, isArbiter = false;
let history = [];       // danh sách giao dịch đã dựng
let filter = 'all';
let visible = PAGE_SIZE;
let loading = false;

/* ---------- tiện ích ---------- */
const store = {
  get(key, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* bỏ qua nếu bị chặn */ } }
};
function shortAddress(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function errorText(e) { return e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || String(e); }
function fmtEth(wei, digits = 6) {
  const [i, f = ''] = ethers.formatEther(wei).split('.');
  const frac = f.slice(0, digits).replace(/0+$/, '');
  return frac ? `${i}.${frac}` : i;
}
function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function setStatus(msg) { $('histStatus').textContent = msg; show('histStatus', !!msg); }

function showScreen(name, message) {
  show('loggedOut', name === 'loggedOut');
  show('needContract', name === 'needContract');
  show('profile', name === 'profile');
  if (name === 'loggedOut' && message) $('loggedOutMsg').textContent = message;
}

/* ---------- đăng nhập / ví ---------- */
async function switchNetwork() {
  try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA }] }); }
  catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: SEPOLIA, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: [EXPLORER] }] });
  }
}
async function connect() {
  if (!window.ethereum) throw new Error('Cần cài MetaMask hoặc ví tương thích EIP-1193.');
  if (!window.ethers) throw new Error('Không tải được Ethers.js. Kiểm tra kết nối mạng.');
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chain = await window.ethereum.request({ method: 'eth_chainId' });
  if (chain.toLowerCase() !== SEPOLIA) await switchNetwork();
  await init();
}

async function init() {
  account = undefined; contract = undefined; history = [];
  if (!window.ethereum || !window.ethers) {
    setNetwork('Chưa kết nối ví', 'amber');
    showScreen('loggedOut', 'Không tìm thấy ví hoặc Ethers.js chưa tải xong. Cần MetaMask và kết nối Internet.');
    return;
  }
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  const chain = await window.ethereum.request({ method: 'eth_chainId' });
  if (!accounts.length) { setNetwork('Chưa kết nối ví', 'amber'); $('connect').textContent = 'Đăng nhập bằng ví ↗'; showScreen('loggedOut'); return; }

  account = ethers.getAddress(accounts[0]);
  $('connect').textContent = shortAddress(account);
  if (chain.toLowerCase() !== SEPOLIA) {
    setNetwork('Sai mạng · hãy chuyển sang Sepolia', 'rose');
    showScreen('loggedOut', 'Ví đang ở sai mạng. Bấm "Kết nối ví" để chuyển sang Sepolia.');
    return;
  }
  setNetwork('Sepolia đã kết nối', 'emerald');
  provider = new ethers.BrowserProvider(window.ethereum);

  renderIdentity();
  showScreen('profile');
  loadBalance();

  const address = store.get('freelanceEscrowContract').trim();
  if (!address) { showScreen('needContract'); $('contractAddress').value = ''; return; }
  $('fromBlock').value = store.get('escrowFromBlock', '0');
  await loadHistory(address);
}

function setNetwork(text, color) {
  $('network').textContent = text;
  $('networkDot').className = `h-2 w-2 rounded-full bg-${color}-400 ${color === 'emerald' ? '' : 'animate-pulse'}`;
}

/* ---------- thông tin hồ sơ ---------- */
function profileKey() { return `escrowProfile:${account.toLowerCase()}`; }
function readProfile() { try { return JSON.parse(store.get(profileKey(), '{}')) || {}; } catch (_) { return {}; } }

function renderIdentity() {
  const p = readProfile();
  const name = (p.name || '').trim();
  $('displayName').textContent = name || shortAddress(account);
  $('bio').textContent = p.bio || 'Chưa có giới thiệu.';
  $('fullAddress').textContent = account;
  $('explorerLink').href = `${EXPLORER}/address/${account}`;
  const hue = parseInt(account.slice(2, 8), 16) % 360;
  const avatar = $('avatar');
  avatar.style.background = `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 60) % 360} 70% 40%))`;
  avatar.textContent = (name ? name[0] : account.slice(2, 4)).toUpperCase();
}

async function loadBalance() {
  try { $('balance').textContent = `${fmtEth(await provider.getBalance(account), 4)} ETH`; }
  catch (e) { $('balance').textContent = '—'; }
}

/* ---------- lịch sử giao dịch ---------- */
const PUBLIC_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
let readers = [];

// Thử lần lượt: RPC của ví, rồi RPC công khai
async function logsWindow(makeFilter, from, to) {
  let lastErr;
  for (const c of readers) {
    try { return await c.queryFilter(makeFilter(c), from, to); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
// Quét xuôi theo từng đoạn; nếu lỗi thì giảm kích thước đoạn
async function logsRange(makeFilter, from, to, size = 20000) {
  const out = [];
  let start = from;
  while (start <= to) {
    const end = Math.min(start + size - 1, to);
    try { out.push(...await logsWindow(makeFilter, start, end)); start = end + 1; }
    catch (e) { if (size <= 500) throw e; size = Math.max(500, Math.floor(size / 2)); }
  }
  return out;
}
// Quét ngược từ block mới nhất cho tới khi thấy đủ event JobCreated của các job của tôi
async function findCreated(latest, floor, needed) {
  const found = new Map();
  let end = latest, size = 20000;
  while (end >= floor && found.size < needed) {
    const start = Math.max(floor, end - size + 1);
    try {
      const [a, b] = await Promise.all([
        logsWindow(c => c.filters.JobCreated(null, account, null), start, end),
        logsWindow(c => c.filters.JobCreated(null, null, account), start, end)
      ]);
      for (const e of [...a, ...b]) found.set(e.args.jobId, e);
      end = start - 1;
    } catch (e) { if (size <= 500) throw e; size = Math.max(500, Math.floor(size / 2)); }
  }
  return found;
}

async function loadHistory(address) {
  if (loading) return;
  loading = true;
  $('histTable').classList.add('hidden'); show('showMore', false); show('histWarn', false);
  setStatus('Đang đọc dữ liệu từ contract…');
  try {
    if (!ethers.isAddress(address)) throw new Error('Địa chỉ contract không hợp lệ.');
    if (await provider.getCode(address) === '0x') throw new Error('Không có contract nào tại địa chỉ này trên Sepolia.');
    contract = new ethers.Contract(address, ABI, provider);
    readers = [contract, new ethers.Contract(address, ABI, new ethers.JsonRpcProvider(PUBLIC_RPC, 11155111, { staticNetwork: true }))];

    const arbiter = await contract.arbiter();
    isArbiter = arbiter.toLowerCase() === account.toLowerCase();
    show('roleBadge', isArbiter);

    // BƯỚC 1: danh sách job của tôi, đọc thẳng từ trạng thái contract (không cần event)
    const count = Number(await contract.jobCounter());
    const all = [];
    for (let i = 1; i <= count; i += 20) {
      const batch = [];
      for (let id = i; id < Math.min(i + 20, count + 1); id++) batch.push(contract.jobs(id));
      all.push(...await Promise.all(batch));
    }
    const me = account.toLowerCase();
    const mine = all.filter(j => j.client.toLowerCase() === me || j.freelancer.toLowerCase() === me);
    const jobs = new Map(mine.map(j => [j.id, j]));
    const isClient = j => j.client.toLowerCase() === me;

    // BƯỚC 2: event (bổ sung thời gian + mã giao dịch). Lỗi ở đây không làm mất dữ liệu bước 1
    let created = new Map(), completed = [], cancelled = [], eventsOk = true;
    if (mine.length) {
      try {
        setStatus('Đang đọc sự kiện giao dịch…');
        const latest = await provider.getBlockNumber();
        const floor = Math.max(0, Number(store.get('escrowFromBlock', '0')) || 0);
        created = await findCreated(latest, floor, mine.length);
        if (created.size) {
          const ids = [...jobs.keys()];
          const from = Math.min(...[...created.values()].map(e => e.blockNumber));
          [completed, cancelled] = await Promise.all([
            logsRange(c => c.filters.JobCompleted(ids), from, latest),
            logsRange(c => c.filters.JobCancelled(ids), from, latest)
          ]);
        }
      } catch (e) {
        console.error(e); eventsOk = false;
        $('histWarn').textContent = `Không đọc được sự kiện giao dịch (${errorText(e)}). Đang hiển thị dữ liệu từ trạng thái contract, nên có thể thiếu thời gian / mã giao dịch.`;
        show('histWarn', true);
      }
    }

    // BƯỚC 3: dựng các dòng lịch sử
    const rows = [];
    const meta = ev => ev ? { hash: ev.transactionHash, block: ev.blockNumber, index: ev.index } : {};
    for (const j of mine) {
      if (isClient(j)) rows.push({ ...meta(created.get(j.id)), type: 'Đặt cọc', dir: 'out', jobId: j.id, title: j.title, amount: j.amount });
    }
    for (const e of completed) {
      const j = jobs.get(e.args.jobId); if (!j) continue;
      const asClient = isClient(j);
      const got = asClient ? e.args.clientAmount : e.args.freelancerAmount;
      if (got <= 0n) continue;
      const split = e.args.freelancerAmount > 0n && e.args.clientAmount > 0n;
      const type = asClient ? 'Hoàn tiền (phân xử tranh chấp)' : (split ? 'Nhận (phân xử tranh chấp)' : 'Nhận thanh toán');
      rows.push({ ...meta(e), type, dir: 'in', jobId: j.id, title: j.title, amount: got });
    }
    const cancelledIds = new Set(cancelled.map(e => e.args.jobId));
    for (const e of cancelled) {
      const j = jobs.get(e.args.jobId);
      if (j && isClient(j)) rows.push({ ...meta(e), type: 'Hoàn tiền (huỷ job)', dir: 'in', jobId: j.id, title: j.title, amount: j.amount });
    }
    // Dự phòng khi không đọc được event: job đã huỷ thì chắc chắn đã hoàn tiền cho client
    for (const j of mine) {
      if (isClient(j) && Number(j.status) === 4 && !cancelledIds.has(j.id))
        rows.push({ type: 'Hoàn tiền (huỷ job)', dir: 'in', jobId: j.id, title: j.title, amount: j.amount });
    }

    // thời gian của block
    const blocks = [...new Set(rows.filter(r => r.block !== undefined).map(r => r.block))];
    const stamps = new Map();
    await Promise.all(blocks.map(async n => { try { const b = await provider.getBlock(n); if (b) stamps.set(n, b.timestamp); } catch (_) {} }));

    history = rows.map(r => ({ ...r, ts: stamps.get(r.block) || 0 }))
      .sort((a, b) => (b.block ?? 0) - (a.block ?? 0) || (b.index ?? 0) - (a.index ?? 0) || Number(b.jobId - a.jobId));

    renderStats(jobs);
    visible = PAGE_SIZE;
    renderHistory();
  } catch (error) {
    console.error(error);
    history = [];
    setStatus(`Lỗi: ${errorText(error)}`);
  } finally { loading = false; }
}

function renderStats(jobs) {
  let out = 0n, inn = 0n, lockedAsClient = 0n, lockedAsFree = 0n, asClient = 0, asFree = 0, done = 0, open = 0;
  for (const h of history) h.dir === 'out' ? out += h.amount : inn += h.amount;
  for (const j of jobs.values()) {
    const mineAsClient = j.client.toLowerCase() === account.toLowerCase();
    const status = Number(j.status);
    mineAsClient ? asClient++ : asFree++;
    if (status === 2) done++;
    if (status === 0 || status === 1 || status === 3) {
      open++;
      mineAsClient ? lockedAsClient += j.amount : lockedAsFree += j.amount;
    }
  }
  $('statOut').textContent = `${fmtEth(out)} ETH`;
  $('statIn').textContent = `${fmtEth(inn)} ETH`;
  $('statLocked').textContent = `${fmtEth(lockedAsClient + lockedAsFree)} ETH`;
  $('statLockedSub').textContent = `Bạn đã cọc ${fmtEth(lockedAsClient)} · Có thể nhận ${fmtEth(lockedAsFree)}`;
  $('statJobs').textContent = String(jobs.size);
  $('statJobsSub').textContent = `${asClient} làm client · ${asFree} làm freelancer · ${open} đang mở · ${done} hoàn tất`;
}

function renderHistory() {
  const rows = history.filter(h => filter === 'all' || h.dir === filter);
  const body = $('histBody'); body.replaceChildren();
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.f === filter));

  if (!rows.length) {
    $('histTable').classList.add('hidden'); show('showMore', false);
    setStatus(history.length ? 'Không có giao dịch nào trong bộ lọc này.' : 'Chưa có giao dịch tiền nào. Hãy tạo hoặc nhận một công việc ở trang chính.');
    return;
  }
  setStatus('');
  $('histTable').classList.remove('hidden');

  for (const h of rows.slice(0, visible)) {
    const tr = document.createElement('tr');
    const cell = (cls, node) => { const td = document.createElement('td'); td.className = cls; td.append(node); tr.append(td); return td; };
    const text = s => document.createTextNode(s);

    cell('py-3 pr-3 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400', text(h.ts ? fmtDate(h.ts) : '—'));

    const badge = document.createElement('span');
    badge.className = `rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${h.dir === 'in'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
      : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30'}`;
    badge.textContent = h.type;
    cell('py-3 pr-3', badge);

    const job = document.createElement('div');
    const t = document.createElement('div'); t.className = 'max-w-[220px] truncate font-medium text-slate-800 dark:text-slate-200'; t.textContent = h.title; t.title = h.title;
    const idv = document.createElement('div'); idv.className = 'text-[11px] text-slate-500'; idv.textContent = `Job #${h.jobId}`;
    job.append(t, idv);
    cell('py-3 pr-3', job);

    cell(`py-3 pr-3 text-right font-mono font-bold whitespace-nowrap ${h.dir === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`,
      text(`${h.dir === 'in' ? '+' : '−'}${fmtEth(h.amount)} ETH`));

    if (h.hash) {
      const link = document.createElement('a');
      link.href = `${EXPLORER}/tx/${h.hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.className = 'font-mono text-xs text-emerald-600 hover:underline dark:text-emerald-400';
      link.textContent = `${h.hash.slice(0, 10)}…`;
      cell('py-3', link);
    } else cell('py-3 text-xs text-slate-500', text('—'));

    body.append(tr);
  }
  show('showMore', rows.length > visible);
}

function exportCsv() {
  if (!history.length) return;
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['Thời gian', 'Loại', 'Job ID', 'Tiêu đề', 'Chiều', 'Số tiền (ETH)', 'Tx hash'].join(',')];
  for (const h of history) {
    lines.push([h.ts ? new Date(h.ts * 1000).toISOString() : '', h.type, h.jobId, h.title, h.dir === 'in' ? 'vào' : 'ra',
      `${h.dir === 'in' ? '' : '-'}${ethers.formatEther(h.amount)}`, h.hash || ''].map(esc).join(','));
  }
  const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `lich-su-giao-dich-${account.slice(0, 8)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- sự kiện giao diện ---------- */
const fail = e => { console.error(e); setStatus(`Lỗi: ${errorText(e)}`); };

$('connect').addEventListener('click', () => connect().catch(e => showScreen('loggedOut', errorText(e))));
$('connect2').addEventListener('click', () => connect().catch(e => showScreen('loggedOut', errorText(e))));

$('saveContract').addEventListener('click', () => {
  const value = $('contractAddress').value.trim();
  if (!window.ethers || !ethers.isAddress(value) || value === ethers.ZeroAddress) { $('contractMsg').textContent = 'Địa chỉ contract không hợp lệ.'; return; }
  $('contractMsg').textContent = '';
  store.set('freelanceEscrowContract', value);
  showScreen('profile');
  loadHistory(value).catch(fail);
});

$('editBtn').addEventListener('click', () => {
  const p = readProfile();
  $('nameInput').value = p.name || ''; $('bioInput').value = p.bio || '';
  show('editForm', true);
});
$('cancelEdit').addEventListener('click', () => show('editForm', false));
$('editForm').addEventListener('submit', event => {
  event.preventDefault();
  store.set(profileKey(), JSON.stringify({ name: $('nameInput').value.trim(), bio: $('bioInput').value.trim() }));
  renderIdentity(); show('editForm', false);
});

$('copyAddr').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(account); $('copyAddr').textContent = 'Đã chép ✓'; }
  catch (_) { $('copyAddr').textContent = 'Không chép được'; }
  setTimeout(() => { $('copyAddr').textContent = 'Sao chép'; }, 1500);
});

$('filters').addEventListener('click', e => {
  const btn = e.target.closest('[data-f]'); if (!btn) return;
  filter = btn.dataset.f; visible = PAGE_SIZE; renderHistory();
});
$('showMore').addEventListener('click', () => { visible += PAGE_SIZE; renderHistory(); });
$('refresh').addEventListener('click', () => { loadBalance(); const a = store.get('freelanceEscrowContract').trim(); if (a) loadHistory(a).catch(fail); });
$('exportCsv').addEventListener('click', exportCsv);
$('applyBlock').addEventListener('click', () => {
  store.set('escrowFromBlock', String(Math.max(0, parseInt($('fromBlock').value, 10) || 0)));
  const a = store.get('freelanceEscrowContract').trim(); if (a) loadHistory(a).catch(fail);
});

if (window.ethereum) {
  window.ethereum.on('accountsChanged', () => init().catch(fail));
  window.ethereum.on('chainChanged', () => init().catch(fail));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !account || loading) return;
  const a = store.get('freelanceEscrowContract').trim();
  if (a) { loadBalance(); loadHistory(a).catch(fail); }
});
// ethers tải với "defer", nên đợi trang tải xong rồi mới khởi tạo
window.addEventListener('load', () => init().catch(fail));
