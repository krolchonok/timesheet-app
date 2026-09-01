const PERSON_STORAGE_KEY = 'timesheet-selected-person';

const projectBody = document.getElementById('project-body');
const tbody = document.getElementById('task-body');
const projectRowTemplate = document.getElementById('project-row-template');
const rowTemplate = document.getElementById('row-template');
const emptyHint = document.getElementById('empty-hint');
const tasksLayout = document.getElementById('tasks-layout');
const personSelect = document.getElementById('person-select');
const personHint = document.getElementById('person-hint');
const grandTotalEl = document.getElementById('grand-total');
const userBadge = document.getElementById('user-badge');
const btnAdd = document.getElementById('btn-add');
const btnExport = document.getElementById('btn-export');
const fillIndicator = document.getElementById('fill-indicator');
const fillLabel = document.getElementById('fill-label');
const fillBar = document.getElementById('fill-bar');
const fillPercent = document.getElementById('fill-percent');

let rows = [];
let progress = buildProgress(0);
let weekPicker = null;
let people = [];
let categories = [];

const fillElements = {
  wrap: fillIndicator,
  bar: fillBar,
  label: fillLabel,
};

const saveTaskDebounced = debounce(async (taskId, payload) => {
  try {
    await api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    weekPicker?.refreshWeeksList();
  } catch (error) {
    alert(`Ошибка сохранения: ${error.message}`);
  }
}, 400);

function getSelectedPerson() {
  return personSelect.value.trim();
}

function storePerson(name) {
  try {
    if (name) localStorage.setItem(PERSON_STORAGE_KEY, name);
    else localStorage.removeItem(PERSON_STORAGE_KEY);
  } catch (_) {}
}

function projectRows() {
  return rows.filter(isProjectRow);
}

function customRows() {
  return rows.filter((row) => !isProjectRow(row));
}

function projectHoursSum() {
  return normHoursFromRows(rows);
}

function updatePersonUi() {
  const selected = getSelectedPerson();
  const hasPerson = Boolean(selected);

  btnAdd.disabled = !hasPerson;
  btnExport.disabled = !hasPerson;
  tasksLayout.classList.toggle('hidden', !hasPerson);
  fillIndicator.classList.toggle('hidden', !hasPerson);
  emptyHint.classList.toggle('hidden', hasPerson);

  if (!hasPerson) {
    emptyHint.textContent = 'Выберите ФИО, чтобы открыть таблицу задач';
    personHint.textContent = 'Сначала выберите ФИО из списка';
    return;
  }

  personHint.textContent = `Задачи для: ${selected}`;
}

function bindRowInputs(row, tr, allowDelete) {
  tr.querySelector('.row-total').textContent = formatHours(rowTotal(row));

  if (allowDelete) {
    tr.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!confirm('Удалить задачу?')) return;
      try {
        await api(`/api/tasks/${row.id}`, { method: 'DELETE' });
        rows = rows.filter((item) => item.id !== row.id);
        render();
        weekPicker?.refreshWeeksList();
      } catch (error) {
        alert(`Ошибка удаления: ${error.message}`);
      }
    });
  }

  tr.querySelectorAll('.cell-input').forEach((input) => {
    input.addEventListener('input', () => onCellChange(row.id, input, tr));
    input.addEventListener('change', () => onCellChange(row.id, input, tr));
  });

  tr.querySelectorAll('.cell-select').forEach((select) => {
    select.addEventListener('change', () => onCellChange(row.id, select, tr));
  });
}

function renderProjectRow(row, index, tbodyEl) {
  const tr = projectRowTemplate.content.cloneNode(true).querySelector('tr');
  tr.dataset.id = row.id;
  tr.querySelector('.row-num').textContent = index + 1;
  tr.querySelector('.project-task-name').textContent = row.task;

  tr.querySelectorAll('.cell-input').forEach((input) => {
    const field = input.dataset.field;
    if (DAYS.includes(field)) {
      input.value = formatHours(parseHours(row[field]));
    }
  });

  bindRowInputs(row, tr, false);
  tbodyEl.appendChild(tr);
}

function renderCustomRow(row, index, tbodyEl) {
  const tr = rowTemplate.content.cloneNode(true).querySelector('tr');
  tr.dataset.id = row.id;
  tr.querySelector('.row-num').textContent = index + 1;
  applyRowStatusClass(tr, row.status || 'new');

  const categorySelect = tr.querySelector('[data-field="category"]');
  populateCategorySelect(categorySelect, categories, row.category || '');

  const statusBadge = tr.querySelector('.status-badge');
  statusBadge.textContent = statusLabel(row.status || 'new');
  statusBadge.dataset.status = row.status || 'new';

  tr.querySelectorAll('.cell-input').forEach((input) => {
    const field = input.dataset.field;
    if (field === 'task' || field === 'comment') {
      input.value = row[field] || '';
    } else if (DAYS.includes(field)) {
      input.value = formatHours(parseHours(row[field]));
    }
  });

  bindRowInputs(row, tr, true);
  tbodyEl.appendChild(tr);
}

function render() {
  projectBody.replaceChildren();
  tbody.replaceChildren();
  updatePersonUi();

  if (!getSelectedPerson()) return;

  projectRows().forEach((row, index) => renderProjectRow(row, index, projectBody));
  customRows().forEach((row, index) => renderCustomRow(row, index, tbody));

  updateTotals();
  updateFillIndicator(progress, fillElements);
  if (fillPercent) {
    fillPercent.textContent = `${progress.hours_percent}%`;
  }
}

function onCellChange(taskId, input, tr) {
  const row = rows.find((item) => item.id === taskId);
  if (!row) return;

  const field = input.dataset.field;
  if (DAYS.includes(field)) {
    row[field] = parseHours(input.value);
    input.value = formatHours(row[field]);
  } else {
    row[field] = input.value;
  }

  tr.querySelector('.row-total').textContent = formatHours(rowTotal(row));

  if (!isProjectRow(row) && (field === 'task' || field === 'category')) {
    if (row.status !== 'transferred') {
      row.status = 'editing';
      const badge = tr.querySelector('.status-badge');
      if (badge) {
        badge.textContent = statusLabel('editing');
        badge.dataset.status = 'editing';
      }
      applyRowStatusClass(tr, 'editing');
    }
  }

  saveTaskDebounced(taskId, taskPayload(row));

  progress = buildProgressFromRows(rows);
  updateTotals();
  updateFillIndicator(progress, fillElements);
  if (fillPercent) {
    fillPercent.textContent = `${progress.hours_percent}%`;
  }
}

function updateTotals() {
  const dayTotals = Object.fromEntries(DAYS.map((d) => [d, 0]));

  rows.forEach((row) => {
    if (isProjectRow(row)) return;
    DAYS.forEach((day) => {
      dayTotals[day] += parseHours(row[day]);
    });
  });

  DAYS.forEach((day) => {
    const el = document.querySelector(`.day-total[data-day="${day}"]`);
    if (el) el.textContent = formatHours(dayTotals[day]);
  });

  grandTotalEl.textContent = formatHours(DAYS.reduce((s, d) => s + dayTotals[d], 0));
}

async function addRow() {
  const week = weekPicker.getWeek();
  const fio = getSelectedPerson();
  if (!fio) return;

  try {
    const created = await api(`/api/tasks?week=${week}`, {
      method: 'POST',
      body: JSON.stringify(emptyTask(fio, week)),
    });
    rows.push(created);
    progress = buildProgressFromRows(rows);
    render();
    weekPicker.refreshWeeksList();
    const lastTaskInput = tbody.querySelector('tr:last-child .cell-input[data-field="task"]');
    if (lastTaskInput) lastTaskInput.focus();
  } catch (error) {
    alert(`Ошибка создания: ${error.message}`);
  }
}

async function loadTasks() {
  const week = weekPicker.getWeek();
  const fio = getSelectedPerson();
  if (!fio) {
    rows = [];
    progress = buildProgress(0);
    render();
    return;
  }

  const data = unwrapTasksResponse(
    await api(`/api/tasks?week=${encodeURIComponent(week)}&fio=${encodeURIComponent(fio)}`)
  );
  rows = data.tasks;
  progress = data.progress;
  render();
}

async function loadPeople() {
  [people, categories] = await Promise.all([
    api('/api/people'),
    api('/api/categories'),
  ]);
  const stored = localStorage.getItem(PERSON_STORAGE_KEY) || '';
  personSelect.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Выберите сотрудника —';
  personSelect.appendChild(placeholder);

  people.forEach((person) => {
    const option = document.createElement('option');
    option.value = person.name;
    option.textContent = person.name;
    if (person.name === stored) option.selected = true;
    personSelect.appendChild(option);
  });
}

personSelect.addEventListener('change', async () => {
  storePerson(getSelectedPerson());
  await loadTasks();
});

document.getElementById('btn-add').addEventListener('click', () => addRow());
document.getElementById('btn-export').addEventListener('click', () => {
  exportCsv(rows.filter((row) => !isProjectRow(row)), 'tasks', weekPicker.getWeek());
});
(async () => {
  initThemeToggle(document.getElementById('theme-toggle'));

  await loadPeople();

  weekPicker = initWeekPicker({
    selectEl: document.getElementById('week-select'),
    labelEl: null,
    prevBtn: document.getElementById('week-prev'),
    nextBtn: document.getElementById('week-next'),
    onChange: loadTasks,
  });

  if (getSelectedPerson()) {
    await loadTasks();
  } else {
    render();
  }
})();
