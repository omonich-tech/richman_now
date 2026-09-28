/* ==========================================================
   Табло заработка — рендер карточек + live-тикер + курсы валют
   Все данные людей берутся из people.json — можно редактировать
   без единой строчки кода.
   ========================================================== */

const AVG_DAYS_PER_MONTH = 30.44; // усреднённая длина месяца (365/12 округлённо)
const CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB'];
const CURRENCY_SYMBOL = { UZS: 'сум', USD: '$', EUR: '€', RUB: '₽' };

let state = {
  people: [],
  rates: { UZS: 1 },        // сколько UZS стоит 1 единица валюты
  rateSource: null,          // 'cbu' | 'fallback'
  rateDate: null,
  currency: 'UZS',
};

/* ---------- расчёт ставок заработка из месячного оклада ---------- */

function buildRatesUZS(salaryMonthlyUZS) {
  const perMonth = salaryMonthlyUZS;
  const perYear = salaryMonthlyUZS * 12;
  const perDay = salaryMonthlyUZS / AVG_DAYS_PER_MONTH;
  const perWeek = perDay * 7;
  const perHour = perDay / 24;
  const perMinute = perHour / 60;
  const perSecond = perMinute / 60;
  return { perSecond, perMinute, perHour, perDay, perWeek, perMonth, perYear };
}

/* ---------- сколько секунд прошло с полуночи (по местному времени браузера) ---------- */

function secondsSinceMidnight(date) {
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  return (date.getTime() - midnight.getTime()) / 1000;
}

/* ---------- конвертация и форматирование ---------- */

function convert(amountUZS, currency) {
  const rate = state.rates[currency];
  if (!rate) return null;
  return amountUZS / rate;
}

function formatNumber(value, currency) {
  if (currency === 'UZS') {
    return Math.round(value).toLocaleString('ru-RU');
  }
  // для валют подбираем точность так, чтобы маленькие суммы (за секунду) не превращались в "0.00"
  let decimals = 2;
  if (Math.abs(value) < 1) decimals = 4;
  else if (Math.abs(value) < 10) decimals = 3;
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMoney(amountUZS, currency) {
  const converted = convert(amountUZS, currency);
  if (converted === null) return '—';
  const symbol = CURRENCY_SYMBOL[currency];
  return currency === 'UZS'
    ? `${formatNumber(converted, currency)} ${symbol}`
    : `${symbol} ${formatNumber(converted, currency)}`;
}

/* ---------- курсы валют: сначала ЦБ РУз, если недоступен — резервный источник ---------- */

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
    if (!rates.USD) throw new Error('CBU response missing USD');

    state.rates = rates;
    state.rateSource = 'cbu';
    state.rateDate = dateStr;
    statusEl.textContent = `курс ЦБ РУз на ${dateStr || 'сегодня'}`;
    statusEl.className = 'rate-status is-live';
    return;
  } catch (err) {
    // CBU может быть недоступен из браузера (CORS) — переходим на резерв
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/UZS');
    if (!res.ok) throw new Error('fallback non-200');
    const data = await res.json();
    if (data.result !== 'success') throw new Error('fallback bad payload');

    const rates = { UZS: 1 };
    for (const code of ['USD', 'EUR', 'RUB']) {
      const perUzs = data.rates[code]; // сколько code-валюты в 1 UZS
      if (perUzs) rates[code] = 1 / perUzs; // переводим в "сколько UZS за 1 code"
    }

    state.rates = rates;
    state.rateSource = 'fallback';
    state.rateDate = data.time_last_update_utc;
    statusEl.textContent = 'курс: резервный источник (ЦБ недоступен из браузера)';
    statusEl.className = 'rate-status is-fallback';
  } catch (err) {
    statusEl.textContent = 'курс валют недоступен — показаны только суммы в UZS';
    statusEl.className = 'rate-status is-fallback';
  }
}

/* ---------- рендер карточек ---------- */

function initialsAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1f4a38&color=eae7dd&size=128&bold=true`;
}

function renderCards() {
  const grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';

  for (const person of state.people) {
    const rates = buildRatesUZS(person.salaryUZS);

    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.personId = person.id;

    card.innerHTML = `
      <div class="card__person">
        <img class="card__photo" src="${person.photo}" alt="${person.name}"
             onerror="this.onerror=null; this.src='${initialsAvatarUrl(person.name)}';">
        <div>
          <p class="card__name">${person.name}</p>
          <p class="card__meta">${person.age} лет · ${person.position}</p>
        </div>
      </div>

      <div class="card__today">
        <div class="card__today-label">ЗАРАБОТАНО СЕГОДНЯ</div>
        <div class="card__today-value" data-role="today-value">—</div>
        <div class="card__progress"><div class="card__progress-bar" data-role="progress"></div></div>
      </div>

      <div class="card__rates">
        <div class="rate-row"><span class="rate-row__label">за секунду</span><span class="rate-row__value" data-role="rate-second"></span></div>
        <div class="rate-row"><span class="rate-row__label">за минуту</span><span class="rate-row__value" data-role="rate-minute"></span></div>
        <div class="rate-row"><span class="rate-row__label">за час</span><span class="rate-row__value" data-role="rate-hour"></span></div>
        <div class="rate-row"><span class="rate-row__label">за день</span><span class="rate-row__value" data-role="rate-day"></span></div>
        <div class="rate-row"><span class="rate-row__label">за неделю</span><span class="rate-row__value" data-role="rate-week"></span></div>
        <div class="rate-row"><span class="rate-row__label">за месяц</span><span class="rate-row__value" data-role="rate-month"></span></div>
        <div class="rate-row"><span class="rate-row__label">за год</span><span class="rate-row__value" data-role="rate-year"></span></div>
      </div>
    `;

    grid.appendChild(card);
    card._rates = rates; // сохраняем расчитанные ставки прямо на DOM-узле карточки
  }

  updateAllValues();
}

/* ---------- обновление чисел (вызывается каждый тик) ---------- */

function updateAllValues() {
  const now = new Date();
  const secToday = secondsSinceMidnight(now);
  const dayProgressPct = (secToday / 86400) * 100;

  document.querySelectorAll('.card').forEach((card) => {
    const r = card._rates;
    if (!r) return;

    const earnedToday = r.perSecond * secToday;

    card.querySelector('[data-role="today-value"]').textContent = formatMoney(earnedToday, state.currency);
    card.querySelector('[data-role="progress"]').style.width = `${dayProgressPct.toFixed(2)}%`;

    card.querySelector('[data-role="rate-second"]').textContent = formatMoney(r.perSecond, state.currency);
    card.querySelector('[data-role="rate-minute"]').textContent = formatMoney(r.perMinute, state.currency);
    card.querySelector('[data-role="rate-hour"]').textContent = formatMoney(r.perHour, state.currency);
    card.querySelector('[data-role="rate-day"]').textContent = formatMoney(r.perDay, state.currency);
    card.querySelector('[data-role="rate-week"]').textContent = formatMoney(r.perWeek, state.currency);
    card.querySelector('[data-role="rate-month"]').textContent = formatMoney(r.perMonth, state.currency);
    card.querySelector('[data-role="rate-year"]').textContent = formatMoney(r.perYear, state.currency);
  });
}

/* ---------- переключатель валюты ---------- */

function initCurrencySwitch() {
  document.querySelectorAll('.currency-switch__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.currency-switch__btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.currency = btn.dataset.currency;
      updateAllValues();
    });
  });
}

/* ---------- инициализация ---------- */

async function init() {
  initCurrencySwitch();

  try {
    const res = await fetch('./people.json');
    state.people = await res.json();
  } catch (err) {
    document.getElementById('cardsGrid').innerHTML =
      '<p style="color:#e8543f">Не удалось загрузить people.json. Если вы открыли index.html напрямую как файл — запустите локальный сервер (см. README) или разместите проект на GitHub Pages.</p>';
    return;
  }

  renderCards();
  fetchRates().then(updateAllValues);

  // тикаем каждые 200мс — достаточно плавно для счётчика заработка,
  // не грузит браузер лишними перерисовками
  setInterval(updateAllValues, 200);

  // курсы валют переспрашиваем раз в час
  setInterval(fetchRates, 60 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
