/* ==========================================================
   Табло заработка — личный кабинет
   Аккаунты хранятся ТОЛЬКО в localStorage этого браузера
   (без сервера, без синхронизации между устройствами).
   ========================================================== */

const USERS_KEY = 'zpUsers';
const SESSION_KEY = 'zpSession';
const AVG_DAYS_PER_MONTH = 30.44;
const CURRENCY_SYMBOL = { UZS: 'сум', USD: '$', EUR: '€', RUB: '₽' };
const MAX_PHOTO_SIDE = 240;

const PERIODS = {
  second: { label: 'секунду', bigLabel: 'НАКОПЛЕНО ЗА ТЕКУЩУЮ СЕКУНДУ', rateKey: 'perSecond', durationSec: 1,
    startOf: (d) => new Date(Math.floor(d.getTime() / 1000) * 1000) },
  minute: { label: 'минуту', bigLabel: 'НАКОПЛЕНО С НАЧАЛА МИНУТЫ', rateKey: 'perMinute', durationSec: 60,
    startOf: (d) => { const x = new Date(d); x.setSeconds(0, 0); return x; } },
  hour: { label: 'час', bigLabel: 'НАКОПЛЕНО С НАЧАЛА ЧАСА', rateKey: 'perHour', durationSec: 3600,
    startOf: (d) => { const x = new Date(d); x.setMinutes(0, 0, 0); return x; } },
  day: { label: 'день', bigLabel: 'НАКОПЛЕНО С НАЧАЛА ДНЯ', rateKey: 'perDay', durationSec: 86400,
    startOf: (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; } },
  week: { label: 'неделю', bigLabel: 'НАКОПЛЕНО С НАЧАЛА НЕДЕЛИ', rateKey: 'perWeek', durationSec: 7 * 86400,
    startOf: (d) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x; } },
  month: { label: 'месяц', bigLabel: 'НАКОПЛЕНО С НАЧАЛА МЕСЯЦА', rateKey: 'perMonth',
    durationSec: (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() * 86400,
    startOf: (d) => new Date(d.getFullYear(), d.getMonth(), 1) },
  year: { label: 'год', bigLabel: 'НАКОПЛЕНО С НАЧАЛА ГОДА', rateKey: 'perYear', durationSec: 365 * 86400,
    startOf: (d) => new Date(d.getFullYear(), 0, 1) },
};

let state = {
  currentUsername: null,
  profile: null,       // объект текущего пользователя (без пароля/соли)
  rates: { UZS: 1 },
  currency: 'UZS',
  period: 'day',
  editMode: false,
};

/* ================= утилиты ================= */

function buildRates(salaryMonthlyUZS) {
  const perMonth = Number(salaryMonthlyUZS) || 0;
  const perYear = perMonth * 12;
  const perDay = perMonth / AVG_DAYS_PER_MONTH;
  const perWeek = perDay * 7;
  const perHour = perDay / 24;
  const perMinute = perHour / 60;
  const perSecond = perMinute / 60;
  return { perSecond, perMinute, perHour, perDay, perWeek, perMonth, perYear };
}

function convert(amountUZS, currency) {
  const rate = state.rates[currency];
  if (!rate) return null;
  return amountUZS / rate;
}

function formatNumber(value, currency) {
  if (currency === 'UZS') return Math.round(value).toLocaleString('ru-RU');
  let decimals = 2;
  if (Math.abs(value) < 1) decimals = 4;
  else if (Math.abs(value) < 10) decimals = 3;
  return value.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatMoney(amountUZS, currency) {
  const converted = convert(amountUZS, currency);
  if (converted === null) return '—';
  const symbol = CURRENCY_SYMBOL[currency];
  return currency === 'UZS' ? `${formatNumber(converted, currency)} ${symbol}` : `${symbol} ${formatNumber(converted, currency)}`;
}

function initialsAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || '?')}&background=1f4a38&color=eae7dd&size=128&bold=true`;
}

/* ================= курсы валют ================= */

async function fetchRates() {
  const statusEl = document.getElementById('rateStatus');
  try {
    const res = await fetch('https://cbu.uz/ru/arkhiv-kursov-valyut/json/', { mode: 'cors' });
    if (!res.ok) throw new Error('CBU non-200');
    const data = await res.json();
    const rates = { UZS: 1 };
    let dateStr = null;
    for (const row of data) {
      const nominal = parseFloat(row.Nominal) || 1;
      const rate = parseFloat(row.Rate);
      if (!row.Ccy || Number.isNaN(rate)) continue;
      rates[row.Ccy] = rate / nominal;
      dateStr = row.Date || dateStr;
    }
    if (!rates.USD) throw new Error('нет USD в ответе ЦБ');
    state.rates = rates;
    statusEl.textContent = `курс ЦБ РУз на ${dateStr || 'сегодня'}`;
    statusEl.className = 'rate-status is-live';
    return;
  } catch (err) { /* пробуем резерв */ }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/UZS');
    if (!res.ok) throw new Error('fallback non-200');
    const data = await res.json();
    if (data.result !== 'success') throw new Error('fallback bad payload');
    const rates = { UZS: 1 };
    for (const code of ['USD', 'EUR', 'RUB']) {
      const perUzs = data.rates[code];
      if (perUzs) rates[code] = 1 / perUzs;
    }
    state.rates = rates;
    statusEl.textContent = 'курс: резервный источник (ЦБ недоступен из браузера)';
    statusEl.className = 'rate-status is-fallback';
  } catch (err) {
    statusEl.textContent = 'курс валют недоступен — показаны только суммы в UZS';
    statusEl.className = 'rate-status is-fallback';
  }
}

/* ================= хранилище пользователей (localStorage) ================= */

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); }
  catch (err) { return {}; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

function randomSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ================= регистрация / вход / выход ================= */

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('registerError');
  errorEl.textContent = '';

  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const password2 = document.getElementById('regPassword2').value;
  const name = document.getElementById('regName').value.trim();
  const age = Number(document.getElementById('regAge').value) || 0;
  const position = document.getElementById('regPosition').value.trim();
  const salaryUZS = Number(document.getElementById('regSalary').value) || 0;
  const photoFile = document.getElementById('regPhoto').files[0];

  if (!username || !password || !name) { errorEl.textContent = 'Заполните логин, пароль и имя.'; return; }
  if (password !== password2) { errorEl.textContent = 'Пароли не совпадают.'; return; }

  const users = loadUsers();
  const key = username.toLowerCase();
  if (users[key]) { errorEl.textContent = 'Такой логин уже занят в этом браузере.'; return; }

  let photo = '';
  if (photoFile) {
    try { photo = await resizeImageToDataUrl(photoFile); }
    catch (err) { /* фото необязательно, просто пропустим при ошибке */ }
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);

  users[key] = { username, salt, passwordHash, name, age, position, photo, salaryUZS };
  saveUsers(users);
  localStorage.setItem(SESSION_KEY, key);

  enterDashboard(key);
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const users = loadUsers();
  const key = username.toLowerCase();
  const user = users[key];

  if (!user) { errorEl.textContent = 'Неверный логин или пароль.'; return; }
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) { errorEl.textContent = 'Неверный логин или пароль.'; return; }

  localStorage.setItem(SESSION_KEY, key);
  enterDashboard(key);
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  sw = { running: false, startMs: null, label: 'Совещание', lastSec: 0 };
  state.currentUsername = null;
  state.profile = null;
  document.getElementById('dashboard').hidden = true;
  document.getElementById('authSection').hidden = false;
  document.getElementById('headerControls').innerHTML = '';
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
}

function enterDashboard(key) {
  const users = loadUsers();
  state.currentUsername = key;
  state.profile = users[key];

  document.getElementById('authSection').hidden = true;
  document.getElementById('dashboard').hidden = false;

  const controls = document.getElementById('headerControls');
  controls.innerHTML = `<button type="button" id="btnLogout" class="btn">Выйти (${escapeHtml(users[key].name || key)})</button>`;
  document.getElementById('btnLogout').addEventListener('click', logout);

  renderProfile();
  initStopwatchForUser();
  fetchRates().then(tick);
  tick();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ================= рендер профиля / карточки ================= */

function renderProfile() {
  const p = state.profile;
  document.getElementById('profilePhoto').src = p.photo || initialsAvatarUrl(p.name);
  document.getElementById('profilePhoto').onerror = function () { this.onerror = null; this.src = initialsAvatarUrl(p.name); };
  document.getElementById('profileName').value = p.name || '';
  document.getElementById('profileAge').value = p.age || '';
  document.getElementById('profilePosition').value = p.position || '';
  document.getElementById('profileSalary').value = p.salaryUZS || 0;
}

function setEditMode(on) {
  state.editMode = on;
  ['profileName', 'profileAge', 'profilePosition'].forEach((id) => { document.getElementById(id).readOnly = !on; });
  document.getElementById('salaryEditRow').hidden = !on;
  document.getElementById('profilePhotoEditBtn').hidden = !on;
  document.getElementById('btnEditProfile').textContent = on ? '✕ Отмена' : '✏️ Редактировать';
}

function saveProfileEdits() {
  const p = state.profile;
  p.name = document.getElementById('profileName').value.trim() || p.name;
  p.age = Number(document.getElementById('profileAge').value) || 0;
  p.position = document.getElementById('profilePosition').value.trim();
  p.salaryUZS = Number(document.getElementById('profileSalary').value) || 0;

  const users = loadUsers();
  users[state.currentUsername] = p;
  saveUsers(users);

  setEditMode(false);
  renderProfile();

  const controls = document.getElementById('headerControls');
  const btn = document.getElementById('btnLogout');
  if (btn) btn.textContent = `Выйти (${escapeHtml(p.name || state.currentUsername)})`;

  tick();
}

async function handleProfilePhotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageToDataUrl(file);
    state.profile.photo = dataUrl;
    document.getElementById('profilePhoto').src = dataUrl;
    const users = loadUsers();
    users[state.currentUsername] = state.profile;
    saveUsers(users);
  } catch (err) {
    alert('Не удалось обработать фото. Попробуйте другой файл.');
  }
}

/* ================= переключатели ================= */

function initCurrencySwitch() {
  document.querySelectorAll('.currency-switch__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.currency-switch__btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.currency = btn.dataset.currency;
      tick();
      if (state.profile) renderSwHistory();
    });
  });
}

function initPeriodSwitch() {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.period = btn.dataset.period;
      document.getElementById('bigCounterLabel').textContent = PERIODS[state.period].bigLabel;
      tick();
    });
  });
}

/* ================= live-тикер ================= */

function tick() {
  if (!state.profile) return;
  const rates = buildRates(state.profile.salaryUZS);
  const now = new Date();
  const def = PERIODS[state.period];

  const start = def.startOf(now);
  const elapsedSec = (now.getTime() - start.getTime()) / 1000;
  const durationSec = typeof def.durationSec === 'function' ? def.durationSec(now) : def.durationSec;
  const earned = rates.perSecond * elapsedSec;
  const progressPct = Math.min(100, (elapsedSec / durationSec) * 100);

  document.getElementById('bigCounterValue').textContent = formatMoney(earned, state.currency);
  document.getElementById('bigCounterProgress').style.width = `${progressPct.toFixed(2)}%`;
  document.getElementById('bigCounterSub').textContent =
    `итого за ${def.label} (в среднем): ${formatMoney(rates[def.rateKey], state.currency)}`;

  document.getElementById('bigCounterEquiv').textContent = equivalentsText(earned);
  tickStopwatch(rates);

  document.querySelector('[data-role="rate-second"]').textContent = formatMoney(rates.perSecond, state.currency);
  document.querySelector('[data-role="rate-minute"]').textContent = formatMoney(rates.perMinute, state.currency);
  document.querySelector('[data-role="rate-hour"]').textContent = formatMoney(rates.perHour, state.currency);
  document.querySelector('[data-role="rate-day"]').textContent = formatMoney(rates.perDay, state.currency);
  document.querySelector('[data-role="rate-week"]').textContent = formatMoney(rates.perWeek, state.currency);
  document.querySelector('[data-role="rate-month"]').textContent = formatMoney(rates.perMonth, state.currency);
  document.querySelector('[data-role="rate-year"]').textContent = formatMoney(rates.perYear, state.currency);
}

/* ================= эквиваленты ("на что хватит") ================= */

const PRICES_KEY = 'zpPrices';
const DEFAULT_PRICES = { coffee: 25000, taxi: 20000, lunch: 40000, netflix: 100000 };
const EQUIV_ITEMS = [
  { key: 'netflix', forms: ['месяц Netflix', 'месяца Netflix', 'месяцев Netflix'] },
  { key: 'lunch',   forms: ['обед', 'обеда', 'обедов'] },
  { key: 'taxi',    forms: ['поездка на такси', 'поездки на такси', 'поездок на такси'] },
  { key: 'coffee',  forms: ['чашка кофе', 'чашки кофе', 'чашек кофе'] },
];

function loadPrices() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRICES_KEY) || '{}');
    return { ...DEFAULT_PRICES, ...saved };
  } catch (err) { return { ...DEFAULT_PRICES }; }
}

function plural(n, forms) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

function equivalentsText(earnedUZS) {
  if (!(earnedUZS > 0)) return '';
  const prices = loadPrices();
  const items = EQUIV_ITEMS
    .map((it) => ({ ...it, price: Number(prices[it.key]) || DEFAULT_PRICES[it.key] }))
    .sort((a, b) => b.price - a.price);

  const parts = [];
  for (const it of items) {
    const count = Math.floor(earnedUZS / it.price);
    if (count >= 1) parts.push(`${count.toLocaleString('ru-RU')} ${plural(count, it.forms)}`);
    if (parts.length === 3) break;
  }
  if (!parts.length) {
    const cheapest = items[items.length - 1];
    const frac = earnedUZS / cheapest.price;
    return `≈ ${frac.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${cheapest.forms[1]}`;
  }
  return `≈ ${parts.join(' · ')}`;
}

function initPriceSettings() {
  const map = { priceCoffee: 'coffee', priceTaxi: 'taxi', priceLunch: 'lunch', priceNetflix: 'netflix' };
  const prices = loadPrices();
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.value = prices[key];
    el.addEventListener('input', () => {
      const current = loadPrices();
      const v = Number(el.value);
      if (v > 0) current[key] = v;
      localStorage.setItem(PRICES_KEY, JSON.stringify(current));
      tick();
    });
  });
}

/* ================= секундомер событий ================= */

const SW_HISTORY_LIMIT = 20;
let sw = { running: false, startMs: null, label: 'Совещание', lastSec: 0 };

function swRunKey() { return `zpSwRun:${state.currentUsername}`; }
function swHistKey() { return `zpEvents:${state.currentUsername}`; }

function loadSwHistory() {
  try { return JSON.parse(localStorage.getItem(swHistKey()) || '[]'); }
  catch (err) { return []; }
}
function saveSwHistory(list) { localStorage.setItem(swHistKey(), JSON.stringify(list.slice(0, SW_HISTORY_LIMIT))); }

function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map((x) => String(x).padStart(2, '0')).join(':');
}

function initStopwatchForUser() {
  sw = { running: false, startMs: null, label: 'Совещание', lastSec: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(swRunKey()) || 'null');
    if (saved && saved.startMs) {
      sw.running = true;
      sw.startMs = saved.startMs;
      sw.label = saved.label || 'Совещание';
    }
  } catch (err) { /* нет сохранённого замера */ }
  syncSwUi();
  renderSwHistory();
}

function syncSwUi() {
  document.getElementById('btnSwToggle').textContent = sw.running ? '■ Стоп' : '▶ Старт';
  document.getElementById('swLabels').classList.toggle('is-locked', sw.running);
  document.querySelector('.sw-display').classList.toggle('is-running', sw.running);
  document.querySelectorAll('#swLabels .chip').forEach((c) => {
    c.classList.toggle('is-active', c.dataset.label === sw.label || (c.dataset.label === '__custom' && !isPresetLabel(sw.label)));
  });
}

function isPresetLabel(label) {
  return Array.from(document.querySelectorAll('#swLabels .chip')).some((c) => c.dataset.label === label);
}

function toggleStopwatch() {
  if (!state.profile) return;
  const perSecond = buildRates(state.profile.salaryUZS).perSecond;

  if (!sw.running) {
    sw.running = true;
    sw.startMs = Date.now();
    sw.lastSec = 0;
    localStorage.setItem(swRunKey(), JSON.stringify({ startMs: sw.startMs, label: sw.label }));
  } else {
    const endMs = Date.now();
    const elapsedSec = (endMs - sw.startMs) / 1000;
    const earnedUZS = perSecond * elapsedSec;
    const history = loadSwHistory();
    history.unshift({ label: sw.label, startMs: sw.startMs, endMs, seconds: elapsedSec, earnedUZS });
    saveSwHistory(history);
    sw.running = false;
    sw.lastSec = elapsedSec;
    localStorage.removeItem(swRunKey());
    renderSwHistory();
  }
  syncSwUi();
  tick();
}

function renderSwHistory() {
  const list = document.getElementById('swHistory');
  list.innerHTML = '';
  const history = loadSwHistory();
  if (!history.length) {
    const li = document.createElement('li');
    li.className = 'sw-history__empty';
    li.textContent = 'Пока пусто — запустите первый замер.';
    list.appendChild(li);
    return;
  }
  history.forEach((h) => {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'sw-history__label';
    label.textContent = h.label;
    const meta = document.createElement('div');
    meta.className = 'sw-history__meta';
    const when = new Date(h.endMs).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    meta.textContent = `${formatDuration(h.seconds)} · ${when}`;
    left.append(label, meta);
    const sum = document.createElement('div');
    sum.className = 'sw-history__sum';
    sum.textContent = formatMoney(h.earnedUZS, state.currency);
    li.append(left, sum);
    list.appendChild(li);
  });
}

function tickStopwatch(rates) {
  const timeEl = document.getElementById('swTime');
  const earnedEl = document.getElementById('swEarned');
  const equivEl = document.getElementById('swEquiv');

  const elapsedSec = sw.running ? (Date.now() - sw.startMs) / 1000 : sw.lastSec;
  const earnedUZS = rates.perSecond * elapsedSec;

  timeEl.textContent = formatDuration(elapsedSec);
  earnedEl.textContent = formatMoney(earnedUZS, state.currency);
  equivEl.textContent = equivalentsText(earnedUZS);
}

function initStopwatchUi() {
  document.getElementById('btnSwToggle').addEventListener('click', toggleStopwatch);

  document.getElementById('swLabels').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || sw.running) return;
    let label = chip.dataset.label;
    if (label === '__custom') {
      const typed = (prompt('Название события (например, «Созвон»):') || '').trim();
      if (!typed) return;
      label = typed.slice(0, 30);
    }
    sw.label = label;
    syncSwUi();
  });

  document.getElementById('btnSwClear').addEventListener('click', () => {
    if (!state.profile) return;
    if (!confirm('Очистить историю замеров?')) return;
    saveSwHistory([]);
    renderSwHistory();
  });
}

/* ================= инициализация ================= */

function init() {
  // переключение вкладок "Войти" / "Регистрация"
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('loginForm').hidden = !isLogin;
      document.getElementById('registerForm').hidden = isLogin;
    });
  });

  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
  document.getElementById('registerForm').addEventListener('submit', handleRegisterSubmit);

  document.getElementById('btnEditProfile').addEventListener('click', () => setEditMode(!state.editMode));
  document.getElementById('btnSaveProfile').addEventListener('click', saveProfileEdits);
  document.getElementById('profilePhotoInput').addEventListener('change', handleProfilePhotoChange);

  initCurrencySwitch();
  initPeriodSwitch();
  initStopwatchUi();
  initPriceSettings();

  setInterval(() => { if (state.profile) tick(); }, 200);
  setInterval(() => { if (state.profile) fetchRates(); }, 60 * 60 * 1000);

  const savedSession = localStorage.getItem(SESSION_KEY);
  const users = loadUsers();
  if (savedSession && users[savedSession]) {
    enterDashboard(savedSession);
  }
}

document.addEventListener('DOMContentLoaded', init);
