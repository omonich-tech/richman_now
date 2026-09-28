/* ==========================================================
   Простой редактор без GitHub API и токенов.
   Форма собирает данные и печатает готовый JSON для ручной
   вставки в people.json на GitHub (через обычный карандаш-редактор).
   ========================================================== */

let people = [];

function emptyPerson() {
  return { id: `person-${Date.now()}`, name: '', age: '', position: '', photo: '', salaryUZS: '' };
}

function renderForm() {
  const container = document.getElementById('peopleForm');
  container.innerHTML = '';

  people.forEach((person, index) => {
    const block = document.createElement('div');
    block.className = 'person-block';
    block.dataset.index = index;

    block.innerHTML = `
      <button type="button" class="remove-btn" data-action="remove" title="Удалить">✕</button>

      <label class="person-block__full">Имя
        <input type="text" data-field="name" value="${escapeAttr(person.name)}" placeholder="Азиз Каримов">
      </label>

      <label>Должность
        <input type="text" data-field="position" value="${escapeAttr(person.position)}" placeholder="Frontend Developer">
      </label>

      <label>Возраст
        <input type="number" data-field="age" value="${escapeAttr(person.age)}" placeholder="29">
      </label>

      <label class="person-block__full">Оклад в месяц, сум
        <input type="number" data-field="salaryUZS" value="${escapeAttr(person.salaryUZS)}" placeholder="10000000">
      </label>

      <label class="person-block__full">
        Путь к фото (необязательно — без фото подставится аватар с инициалами)
        <input type="text" data-field="photo" value="${escapeAttr(person.photo)}" placeholder="photos/aziz.jpg">
      </label>
    `;

    container.appendChild(block);
  });

  updateOutput();
}

function escapeAttr(v) {
  return String(v ?? '').replace(/"/g, '&quot;');
}

function syncFormToPeople() {
  document.querySelectorAll('.person-block').forEach((block) => {
    const index = Number(block.dataset.index);
    const person = people[index];
    if (!person) return;
    block.querySelectorAll('[data-field]').forEach((input) => {
      const field = input.dataset.field;
      person[field] = field === 'age' || field === 'salaryUZS' ? Number(input.value) || 0 : input.value;
    });
  });
}

function updateOutput() {
  syncFormToPeople();
  const clean = people.map(({ id, name, age, position, photo, salaryUZS }) => ({
    id: id || `person-${Date.now()}`,
    name,
    age: Number(age) || 0,
    position,
    photo: photo || '',
    salaryUZS: Number(salaryUZS) || 0,
  }));
  document.getElementById('output').value = JSON.stringify(clean, null, 2);
}

function addPerson() {
  syncFormToPeople();
  people.push(emptyPerson());
  renderForm();
}

function removePerson(index) {
  syncFormToPeople();
  people.splice(index, 1);
  renderForm();
}

async function copyOutput() {
  const text = document.getElementById('output').value;
  const statusEl = document.getElementById('copyStatus');
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = 'скопировано ✓';
  } catch (err) {
    // резервный способ для старых браузеров
    const ta = document.getElementById('output');
    ta.focus();
    ta.select();
    document.execCommand('copy');
    statusEl.textContent = 'скопировано ✓';
  }
  setTimeout(() => { statusEl.textContent = ''; }, 2500);
}

/* ---------- события ---------- */

document.getElementById('btnAdd').addEventListener('click', addPerson);
document.getElementById('btnCopy').addEventListener('click', copyOutput);

document.getElementById('peopleForm').addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-action="remove"]');
  if (removeBtn) removePerson(Number(removeBtn.closest('.person-block').dataset.index));
});

document.getElementById('peopleForm').addEventListener('input', updateOutput);

/* ---------- при открытии пытаемся подтянуть текущих людей из people.json ---------- */

(async function init() {
  try {
    const res = await fetch('./people.json');
    const data = await res.json();
    people = Array.isArray(data) && data.length ? data : [emptyPerson()];
  } catch (err) {
    people = [emptyPerson()];
  }
  renderForm();
})();
