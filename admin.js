/* ==========================================================
   Админка: читает и пишет people.json (и фото) напрямую в GitHub
   репозиторий через официальный REST API, без какого-либо бэкенда.
   Токен хранится только в localStorage этого браузера.
   ========================================================== */

const LS_KEY = 'zarplataLiveAdminConfig';

let cfg = { owner: '', repo: '', branch: 'main', token: '' };
let peopleData = [];
let currentSha = null; // sha текущей версии people.json — нужен GitHub API для обновления файла

/* ---------- utf-8-safe base64 (важно из-за кириллицы) ---------- */

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/* ---------- localStorage конфиг (без токена — токен вводится каждый раз для безопасности) ---------- */

function loadSavedConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    document.getElementById('cfgOwner').value = saved.owner || '';
    document.getElementById('cfgRepo').value = saved.repo || '';
    document.getElementById('cfgBranch').value = saved.branch || 'main';
  } catch (e) { /* ничего страшного, просто пустая форма */ }
}

function saveConfigToStorage() {
  localStorage.setItem(LS_KEY, JSON.stringify({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch }));
}

/* ---------- статусы ---------- */

function setStatus(elId, text, kind) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = 'admin-status' + (kind ? ` is-${kind}` : '');
}

/* ---------- GitHub API helpers ---------- */

function apiHeaders() {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubGetFile(path) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: apiHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw await describeError(res);
  return res.json();
}

async function githubPutFile(path, base64Content, message, sha) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const body = {
    message,
    content: base64Content,
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await describeError(res);
  return res.json();
}

async function describeError(res) {
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch (e) { /* noop */ }
  const map = {
    401: 'токен неверный или истёк',
    403: 'нет прав — проверьте, что у токена включено Contents: Read and write для этого репозитория',
    404: 'репозиторий/ветка/файл не найдены — проверьте логин, название репозитория и ветку',
    409: 'конфликт версий файла — кто-то изменил его параллельно, нажмите «Подключиться» ещё раз, чтобы перечитать актуальную версию',
  };
  return new Error(map[res.status] || `ошибка GitHub API (${res.status}): ${detail}`);
}

/* ---------- загрузка people.json ---------- */

async function connectAndLoad() {
  cfg.owner = document.getElementById('cfgOwner').value.trim();
  cfg.repo = document.getElementById('cfgRepo').value.trim();
  cfg.branch = document.getElementById('cfgBranch').value.trim() || 'main';
  cfg.token = document.getElementById('cfgToken').value.trim();

  if (!cfg.owner || !cfg.repo || !cfg.token) {
    setStatus('connectStatus', 'заполните логин, репозиторий и токен', 'error');
    return;
  }

  setStatus('connectStatus', 'загрузка…', null);

  try {
    const file = await githubGetFile('people.json');
    if (!file) {
      // файла ещё нет — начнём с пустого списка, он создастся при первом сохранении
      peopleData = [];
      currentSha = null;
    } else {
      peopleData = JSON.parse(base64ToUtf8(file.content));
      currentSha = file.sha;
    }

    saveConfigToStorage();
    setStatus('connectStatus', `подключено ✓ (${peopleData.length} чел.)`, 'ok');
    document.getElementById('editPanel').hidden = false;
    renderPeopleList();
  } catch (err) {
    setStatus('connectStatus', err.message, 'error');
  }
}

/* ---------- рендер формы редактирования ---------- */

function initialsAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || '?')}&background=1f4a38&color=eae7dd&size=128&bold=true`;
}

function renderPeopleList() {
  const list = document.getElementById('peopleList');
  list.innerHTML = '';

  peopleData.forEach((person, index) => {
    const row = document.createElement('div');
    row.className = 'admin-person';
    row.dataset.index = index;

    const photoSrc = person.photo || initialsAvatarUrl(person.name);

    row.innerHTML = `
      <button type="button" class="admin-person__remove" title="Удалить" data-action="remove">✕</button>

      <div class="admin-person__photo-col">
        <img class="admin-person__preview" src="${photoSrc}"
             onerror="this.onerror=null; this.src='${initialsAvatarUrl(person.name)}';">
        <label class="admin-person__upload">
          загрузить фото
          <input type="file" accept="image/*" data-role="photo-file">
        </label>
      </div>

      <div class="admin-person__fields">
        <label class="admin-field admin-field--full">Имя
          <input type="text" data-field="name" value="${escapeAttr(person.name || '')}">
        </label>
        <label class="admin-field">Должность
          <input type="text" data-field="position" value="${escapeAttr(person.position || '')}">
        </label>
        <label class="admin-field">Возраст
          <input type="number" data-field="age" value="${person.age ?? ''}">
        </label>
        <label class="admin-field admin-field--full">Оклад в месяц, UZS
          <input type="number" data-field="salaryUZS" value="${person.salaryUZS ?? ''}">
        </label>
        <label class="admin-field admin-field--full">Путь к фото (заполняется автоматически при загрузке)
          <input type="text" data-field="photo" value="${escapeAttr(person.photo || '')}">
        </label>
      </div>
    `;

    list.appendChild(row);
  });
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

/* ---------- синхронизация значений формы -> peopleData ---------- */

function syncFormToData() {
  document.querySelectorAll('.admin-person').forEach((row) => {
    const index = Number(row.dataset.index);
    const person = peopleData[index];
    if (!person) return;
    row.querySelectorAll('[data-field]').forEach((input) => {
      const field = input.dataset.field;
      if (field === 'age' || field === 'salaryUZS') {
        person[field] = Number(input.value) || 0;
      } else {
        person[field] = input.value;
      }
    });
  });
}

/* ---------- добавление / удаление ---------- */

function addPerson() {
  syncFormToData();
  peopleData.push({ id: `person-${Date.now()}`, name: '', age: 0, position: '', photo: '', salaryUZS: 0 });
  renderPeopleList();
}

function removePerson(index) {
  syncFormToData();
  peopleData.splice(index, 1);
  renderPeopleList();
}

/* ---------- загрузка фото в репозиторий ---------- */

async function uploadPhoto(index, file) {
  syncFormToData();
  setStatus('saveStatus', 'загрузка фото…', null);

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const base64Content = dataUrl.split(',')[1];
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `photos/${Date.now()}-${safeName}`;

    await githubPutFile(path, base64Content, `Загрузка фото: ${safeName}`, null);

    peopleData[index].photo = path;
    renderPeopleList();
    setStatus('saveStatus', 'фото загружено ✓ — не забудьте нажать «Сохранить на GitHub»', 'ok');
  } catch (err) {
    setStatus('saveStatus', `не удалось загрузить фото: ${err.message}`, 'error');
  }
}

/* ---------- сохранение people.json ---------- */

async function saveToGithub() {
  syncFormToData();
  setStatus('saveStatus', 'сохранение…', null);

  const json = JSON.stringify(peopleData, null, 2);
  const base64Content = utf8ToBase64(json);

  try {
    const result = await githubPutFile('people.json', base64Content, 'Обновление данных через админ-панель', currentSha);
    currentSha = result.content.sha;
    setStatus('saveStatus', 'сохранено ✓ — сайт обновится за 30–60 секунд', 'ok');
  } catch (err) {
    setStatus('saveStatus', err.message, 'error');
  }
}

/* ---------- события ---------- */

document.getElementById('btnConnect').addEventListener('click', connectAndLoad);
document.getElementById('btnAddPerson').addEventListener('click', addPerson);
document.getElementById('btnSave').addEventListener('click', saveToGithub);

document.getElementById('peopleList').addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-action="remove"]');
  if (removeBtn) {
    const row = removeBtn.closest('.admin-person');
    removePerson(Number(row.dataset.index));
  }
});

document.getElementById('peopleList').addEventListener('change', (e) => {
  if (e.target.matches('[data-role="photo-file"]')) {
    const row = e.target.closest('.admin-person');
    const index = Number(row.dataset.index);
    if (e.target.files[0]) uploadPhoto(index, e.target.files[0]);
  }
});

loadSavedConfig();
