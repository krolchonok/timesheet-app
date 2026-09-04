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
const btnAddDowntime = document.getElementById('btn-add-downtime');
const btnVacation = document.getElementById('btn-vacation');
const vacationPopover = document.getElementById('vacation-popover');
const taskPopover = document.getElementById('task-popover');
const taskTypeSelect = document.getElementById('task-type-select');

const ADMIN_TASK_CATEGORY = 'Административные задачи';
const VACATION_CATEGORY = 'Отпуск';
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

const saveTaskDebounced = debounceByKey(async (taskId, payload) => {
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
  if (btnAddDowntime) btnAddDowntime.disabled = !hasPerson;
  if (btnVacation) btnVacation.disabled = !hasPerson;
  const btnImportSchedule = document.getElementById('btn-import-schedule');
  if (btnImportSchedule) btnImportSchedule.disabled = !hasPerson;
  if (!hasPerson) {
    vacationPopover?.classList.add('hidden');
    taskPopover?.classList.add('hidden');
  }
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
    tr.querySelector('.btn-delete')?.addEventListener('click', async () => {
      if (!confirm('Удалить задачу?')) return;
      saveTaskDebounced.cancel(row.id);
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

  tr.querySelector('.btn-convert-type')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await convertTaskType(row);
  });

  tr.querySelectorAll('.cell-input').forEach((input) => {
    if (input.tagName === 'TEXTAREA') {
      autoGrowTextarea(input);
      input.addEventListener('input', () => autoGrowTextarea(input));
    }
    input.addEventListener('input', () => onCellChange(row.id, input, tr));
    input.addEventListener('change', () => onCellChange(row.id, input, tr));
  });

  tr.querySelectorAll('.cell-select').forEach((select) => {
    select.addEventListener('change', () => onCellChange(row.id, select, tr));
  });
}

function makeConvertTypeButton(row) {
  const toProject = !isProjectRow(row);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-icon btn-convert-type';
  btn.title = toProject ? 'Сделать проектной' : 'Сделать административной';
  btn.setAttribute('aria-label', btn.title);
  btn.textContent = toProject ? 'П' : 'А';
  return btn;
}

async function convertTaskType(row) {
  if (row.is_project && !row.project_editable) {
    alert('Эту проектную строку нельзя менять');
    return;
  }
  const toProject = !isProjectRow(row);
  const label = toProject ? 'проектную' : 'административную';
  if (!confirm(`Перевести задачу в ${label}?`)) return;

  saveTaskDebounced.cancel(row.id);
  const payload = buildTypeConversionPayload(row, toProject, categories, ADMIN_TASK_CATEGORY);
  try {
    const updated = await api(`/api/tasks/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    Object.assign(row, updated);
    progress = buildProgressFromRows(rows);
    render();
    weekPicker?.refreshWeeksList();
  } catch (error) {
    alert(`Ошибка смены типа: ${error.message}`);
  }
}

function applyGroupOrder(orderedIds, isProject) {
  const idSet = new Set(orderedIds);
  const byId = new Map(rows.filter((row) => idSet.has(row.id)).map((row) => [row.id, row]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  reordered.forEach((row, index) => {
    row.sort_order = index;
  });
  const rest = rows.filter((row) => Boolean(row.is_project) !== isProject);
  rows = isProject ? [...reordered, ...rest] : [...rest, ...reordered];
}

function bindTaskRowReorder(tr, isProject) {
  bindRowDragReorder(tr, {
    applyLocalOrder: (orderedIds) => applyGroupOrder(orderedIds, isProject),
    persistOrder: persistTaskOrder,
  });
}

function renderProjectRow(row, index, tbodyEl) {
  const tr = projectRowTemplate.content.cloneNode(true).querySelector('tr');
  tr.dataset.id = row.id;
  fillRowDragAndNum(tr, index);

  const categoryCell = tr.querySelector('.col-category');
  const taskCell = tr.querySelector('.col-task');
  if (row.project_editable) {
    const nameArea = document.createElement('textarea');
    nameArea.className = 'cell-input';
    nameArea.dataset.field = 'category';
    nameArea.rows = 1;
    nameArea.placeholder = 'Название проекта';
    nameArea.value = row.category || '';
    categoryCell.classList.remove('cell-text');
    categoryCell.replaceChildren(nameArea);

    const taskArea = document.createElement('textarea');
    taskArea.className = 'cell-input';
    taskArea.dataset.field = 'task';
    taskArea.rows = 1;
    taskArea.placeholder = 'Название задачи';
    taskArea.value = row.task || '';
    taskCell.replaceChildren(taskArea);
  } else {
    categoryCell.textContent = row.category || '—';
    taskCell.querySelector('.project-task-name').textContent = row.task;
  }

  tr.querySelectorAll('.cell-input[data-field]').forEach((input) => {
    const field = input.dataset.field;
    if (DAYS.includes(field)) {
      input.value = formatHours(parseHours(row[field]));
    }
  });

  if (row.project_editable) {
    const actions = tr.querySelector('.col-actions');
    actions.replaceChildren();
    actions.appendChild(makeConvertTypeButton(row));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-icon btn-delete';
    deleteBtn.title = 'Удалить проект';
    deleteBtn.setAttribute('aria-label', 'Удалить проект');
    deleteBtn.textContent = '×';
    actions.appendChild(deleteBtn);
  }

  bindRowInputs(row, tr, !!row.project_editable);
  bindTaskRowReorder(tr, true);
  tbodyEl.appendChild(tr);
}

function renderCustomRow(row, index, tbodyEl) {
  const tr = rowTemplate.content.cloneNode(true).querySelector('tr');
  tr.dataset.id = row.id;
  fillRowDragAndNum(tr, index);
  applyRowStatusClass(tr, row.status || 'new');

  const categorySelect = tr.querySelector('[data-field="category"]');
  populateCategorySelect(categorySelect, categories, row.category || '');

  const statusBadge = tr.querySelector('.status-badge');
  statusBadge.textContent = statusLabel(row.status || 'new');
  statusBadge.dataset.status = row.status || 'new';

  tr.querySelector('.col-final-task').textContent = row.final_task || '—';

  tr.querySelectorAll('.cell-input').forEach((input) => {
    const field = input.dataset.field;
    if (field === 'task' || field === 'comment') {
      input.value = row[field] || '';
    } else if (DAYS.includes(field)) {
      input.value = formatHours(parseHours(row[field]));
    }
  });

  tbodyEl.appendChild(tr);
  const actions = tr.querySelector('.col-actions');
  const deleteBtn = actions.querySelector('.btn-delete');
  actions.replaceChildren(makeConvertTypeButton(row));
  if (deleteBtn) actions.appendChild(deleteBtn);
  bindRowInputs(row, tr, true);
  bindTaskRowReorder(tr, false);
}

function render() {
  projectBody.replaceChildren();
  tbody.replaceChildren();
  updatePersonUi();

  if (!getSelectedPerson()) return;

  const currentProjectRows = projectRows();
  if (currentProjectRows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'task-row--empty';
    const td = document.createElement('td');
    td.colSpan = 11;
    td.className = 'task-row--empty-cell';
    td.textContent = 'Проектов пока нет — добавьте кнопкой «+ Задача» (тип «Проектная задача»)';
    tr.appendChild(td);
    projectBody.appendChild(tr);
  } else {
    currentProjectRows.forEach((row, index) => renderProjectRow(row, index, projectBody));
  }
  customRows().forEach((row, index) => renderCustomRow(row, index, tbody));

  updateTotals();
  updateFillIndicator(progress, fillElements);
  if (fillPercent) {
    fillPercent.textContent = `${progress.hours_percent}%`;
  }
  refreshTextareaHeights(tasksLayout || document);
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

function sumDayTotals(rowList) {
  const dayTotals = Object.fromEntries(DAYS.map((d) => [d, 0]));
  rowList.forEach((row) => {
    DAYS.forEach((day) => {
      dayTotals[day] += parseHours(row[day]);
    });
  });
  return dayTotals;
}

function applyDayTotals(containerEl, dayTotals, grandTotalEl) {
  if (!containerEl) return;
  DAYS.forEach((day) => {
    const el = containerEl.querySelector(`.day-total[data-day="${day}"]`);
    if (el) el.textContent = formatHours(dayTotals[day]);
  });
  if (grandTotalEl) {
    grandTotalEl.textContent = formatHours(DAYS.reduce((s, d) => s + dayTotals[d], 0));
  }
}

function updateTotals() {
  const adminTotals = sumDayTotals(customRows());
  const projectTotals = sumDayTotals(projectRows());
  const overallTotals = Object.fromEntries(DAYS.map((d) => [d, adminTotals[d] + projectTotals[d]]));

  applyDayTotals(document.getElementById('task-table'), adminTotals, grandTotalEl);
  applyDayTotals(document.getElementById('project-table'), projectTotals, document.getElementById('project-grand-total'));
  applyDayTotals(document.getElementById('summary-section'), overallTotals, document.getElementById('overall-grand-total'));
}

async function addQuickTask(overrides, focusNameField = false) {
  const week = weekPicker.getWeek();
  const fio = getSelectedPerson();
  if (!fio) return;

  const payload = { ...emptyTask(fio, week), ...overrides };
  try {
    const created = await api(`/api/tasks?week=${week}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    rows.push(created);
    progress = buildProgressFromRows(rows);
    render();
    weekPicker.refreshWeeksList();
    if (focusNameField) {
      const container = isProjectRow(created) ? projectBody : tbody;
      const field = isProjectRow(created) ? 'category' : 'task';
      const lastInput = container.querySelector(`tr:last-child .cell-input[data-field="${field}"]`);
      if (lastInput) lastInput.focus();
    }
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

  populateTaskTypeSelect(taskTypeSelect, ADMIN_TASK_CATEGORY);
}

personSelect.addEventListener('change', async () => {
  storePerson(getSelectedPerson());
  await loadTasks();
});

document.getElementById('btn-export').addEventListener('click', () => {
  exportCsv(rows.filter((row) => !isProjectRow(row)), 'tasks', weekPicker.getWeek());
});

btnAddDowntime?.addEventListener('click', () => {
  addQuickTask({ task: 'Простой', category: ADMIN_TASK_CATEGORY, fri: 1 });
});

function closeVacationPopover() {
  vacationPopover?.classList.add('hidden');
  vacationPopover?.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
}

btnVacation?.addEventListener('click', (e) => {
  e.stopPropagation();
  vacationPopover?.classList.toggle('hidden');
});

vacationPopover?.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('btn-vacation-cancel')?.addEventListener('click', closeVacationPopover);

document.getElementById('btn-vacation-apply')?.addEventListener('click', async () => {
  const checked = Array.from(vacationPopover.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
  if (!checked.length) {
    closeVacationPopover();
    return;
  }
  const overrides = { task: 'Отпуск', category: VACATION_CATEGORY };
  DAYS.forEach((day) => {
    overrides[day] = checked.includes(day) ? 8 : 0;
  });
  await addQuickTask(overrides);
  closeVacationPopover();
});

function closeTaskPopover() {
  taskPopover?.classList.add('hidden');
}

document.getElementById('btn-add')?.addEventListener('click', (e) => {
  e.stopPropagation();
  taskPopover?.classList.toggle('hidden');
});

taskPopover?.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('btn-task-cancel')?.addEventListener('click', closeTaskPopover);

async function submitTaskPopover() {
  const type = taskTypeSelect?.value || '';
  const isProject = type === PROJECT_TYPE_VALUE;

  const overrides = isProject
    ? { task: '', category: '', is_project: true }
    : { task: '', category: type };
  await addQuickTask(overrides, true);
  closeTaskPopover();
}

document.getElementById('btn-task-apply')?.addEventListener('click', submitTaskPopover);

document.addEventListener('click', () => {
  vacationPopover?.classList.add('hidden');
  taskPopover?.classList.add('hidden');
});

async function importScheduleFile(file) {
  if (!getSelectedPerson()) {
    alert('Сначала выберите ФИО');
    return;
  }
  if (!weekPicker) {
    alert('Неделя ещё не загружена');
    return;
  }

  let parsed;
  try {
    parsed = await ScheduleImport.parseFile(file);
  } catch (error) {
    alert(`Не удалось прочитать файл: ${error.message}`);
    return;
  }
  if (parsed.error) {
    alert(parsed.error);
    return;
  }

  ScheduleImport.openImportModal(parsed, async (selected) => {
    const week = weekPicker.getWeek();
    const fio = getSelectedPerson();
    const created = [];
    for (const item of selected) {
      const payload = {
        ...emptyTask(fio, week),
        task: item.task,
        category: item.category,
        is_project: item.is_project,
        mon: item.mon,
        tue: item.tue,
        wed: item.wed,
        thu: item.thu,
        fri: item.fri,
        comment: item.note || '',
      };
      const row = await api(`/api/tasks?week=${week}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      created.push(row);
    }
    rows.push(...created);
    progress = buildProgressFromRows(rows);
    render();
    weekPicker.refreshWeeksList();
  });
}

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

  if (typeof ScheduleImport !== 'undefined') {
    const fileInput = document.getElementById('schedule-file-input');
    ScheduleImport.bindFileButton(
      document.getElementById('btn-import-schedule'),
      fileInput,
      importScheduleFile
    );
    ScheduleImport.bindDropImport({
      enabled: () => Boolean(getSelectedPerson()),
      onFile: importScheduleFile,
    });
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => refreshTextareaHeights()).catch(() => {});
  }
  window.addEventListener('resize', () => refreshTextareaHeights());

  if (getSelectedPerson()) {
    await loadTasks();
  } else {
    render();
  }
})();
