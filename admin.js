const usersListEl = document.getElementById('users-list');
const userSectionTemplate = document.getElementById('user-section-template');
const completionItemTemplate = document.getElementById('completion-item-template');
const managePersonTemplate = document.getElementById('manage-person-template');
const rowViewTemplate = document.getElementById('row-view-template');
const rowProjectViewTemplate = document.getElementById('row-project-view-template');
const adminTitle = document.getElementById('admin-title');
const adminSubtitle = document.getElementById('admin-subtitle');
const panelView = document.getElementById('panel-view');
const panelManage = document.getElementById('panel-manage');
const toolbarView = document.getElementById('toolbar-view');
const emptyHint = document.getElementById('empty-hint');
const userBadge = document.getElementById('user-badge');
const taskCountEl = document.getElementById('task-count');
const searchInput = document.getElementById('search');
const completionListEl = document.getElementById('completion-list');
const completionSummaryEl = document.getElementById('completion-summary');
const managePeopleListEl = document.getElementById('manage-people-list');
const addPersonForm = document.getElementById('add-person-form');
const newPersonNameInput = document.getElementById('new-person-name');
const btnShowAll = document.getElementById('btn-show-all');
const btnHideAll = document.getElementById('btn-hide-all');
const btnExpandAll = document.getElementById('btn-expand-all');
const btnCollapseAll = document.getElementById('btn-collapse-all');
const usersListToolbar = document.getElementById('users-list-toolbar');

let rows = [];
let completion = null;
let weekPicker = null;
let categories = [];
let adminMode = 'view';
let sectionsCollapsed = false;
/** @type {Set<string>} hidden person names — empty set means all visible */
let hiddenPeople = new Set();

const ADMIN_MODE_COPY = {
  view: {
    title: 'Просмотр',
    subtitle: '40 ч = проект + админ. задачи сотрудника. Вы — итоговое наименование и статус',
  },
  manage: {
    title: 'Управление',
    subtitle: 'Сотрудники и категории отчётных задач',
  },
};

function setAdminMode(mode) {
  adminMode = mode;
  document.querySelectorAll('.admin-tabs__btn').forEach((btn) => {
    btn.classList.toggle('admin-tabs__btn--active', btn.dataset.mode === mode);
  });
  panelView.classList.toggle('hidden', mode !== 'view');
  panelManage.classList.toggle('hidden', mode !== 'manage');
  toolbarView.classList.toggle('hidden', mode !== 'view');
  usersListToolbar.classList.toggle('hidden', mode !== 'view');
  usersListEl.classList.toggle('hidden', mode !== 'view');
  emptyHint.classList.toggle('hidden', mode !== 'view' || rows.length > 0 || hiddenPeople.size > 0);
  adminTitle.textContent = ADMIN_MODE_COPY[mode].title;
  adminSubtitle.textContent = ADMIN_MODE_COPY[mode].subtitle;
  if (mode === 'manage') {
    renderManagePeople();
    api('/api/categories').then((cats) => {
      categories = cats;
      renderCategoryList(categories);
    });
  } else {
    renderCompletion();
    render();
  }
}

const saveTaskDebounced = debounce(async (taskId, payload) => {
  try {
    await api(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    weekPicker?.refreshWeeksList();
    if (weekPicker && adminMode === 'view') {
      completion = await api(`/api/completion?week=${encodeURIComponent(weekPicker.getWeek())}`);
      renderCompletion();
      render();
    }
  } catch (error) {
    alert(`Ошибка сохранения: ${error.message}`);
  }
}, 400);

function isPersonVisible(name) {
  return !hiddenPeople.has(name);
}

function showAllPeople() {
  hiddenPeople.clear();
  renderCompletion();
  render();
}

function hideAllPeople() {
  hiddenPeople.clear();
  (completion?.people || []).forEach((person) => hiddenPeople.add(person.name));
  renderCompletion();
  render();
}

function togglePersonVisibility(name) {
  if (hiddenPeople.has(name)) {
    hiddenPeople.delete(name);
  } else {
    hiddenPeople.add(name);
  }
  renderCompletion();
  render();
}

function matchesSearch(row, personName, query) {
  if (!query) return true;
  const haystack = [
    personName,
    row.task,
    row.final_task,
    row.category,
    statusLabel(row.status),
    row.comment,
    row.owner_username,
  ].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function buildGroups() {
  const byFio = new Map();

  (completion?.people || []).forEach((person) => {
    byFio.set(person.name, { person, tasks: [] });
  });

  rows.forEach((row) => {
    const key = byFio.has(row.fio)
      ? row.fio
      : [...byFio.keys()].find((name) => name.startsWith(row.fio) || row.fio.startsWith(name.split(' ')[0]));

    if (key && byFio.has(key)) {
      byFio.get(key).tasks.push(row);
    }
  });

  return [...byFio.values()].sort((a, b) => a.person.name.localeCompare(b.person.name, 'ru'));
}

function visiblePeopleCount() {
  const total = completion?.people?.length || 0;
  const hidden = hiddenPeople.size;
  return Math.max(0, total - hidden);
}

function renderCompletion() {
  completionListEl.replaceChildren();
  if (!completion) return;

  const shown = visiblePeopleCount();
  completionSummaryEl.textContent =
    `Заполнили ${completion.filled_count} из ${completion.total} · не заполнили ${completion.missing_count} · показано ${shown} из ${completion.total}`;

  btnShowAll.disabled = hiddenPeople.size === 0;
  btnHideAll.disabled = hiddenPeople.size === completion.people.length;

  completion.people.forEach((person) => {
    const item = completionItemTemplate.content.cloneNode(true).querySelector('.completion-item');
    const statusEl = item.querySelector('.completion-item__status');
    const nameEl = item.querySelector('.completion-item__name');
    const metaEl = item.querySelector('.completion-item__meta');
    const visible = isPersonVisible(person.name);

    item.classList.toggle('completion-item--filled', person.filled);
    item.classList.toggle('completion-item--missing', !person.filled);
    item.classList.toggle('completion-item--active', visible);
    item.classList.toggle('completion-item--hidden', !visible);
    item.setAttribute('aria-pressed', visible ? 'true' : 'false');

    statusEl.textContent = person.filled ? '✓' : '—';
    nameEl.textContent = person.name;

    const meta = person.filled
      ? `Проект ${formatHours(person.project_hours)} + админ ${formatHours(person.admin_hours)} = ${formatHours(person.total_hours)} / ${person.hours_norm} ч`
      : (person.project_hours > 0 || person.admin_hours > 0)
        ? `Проект ${formatHours(person.project_hours)} + админ ${formatHours(person.admin_hours)} = ${formatHours(person.total_hours)} / ${person.hours_norm} ч`
        : `0 / ${person.hours_norm} ч`;
    metaEl.textContent = visible ? meta : 'Скрыт';

    item.addEventListener('click', () => {
      togglePersonVisibility(person.name);
    });

    completionListEl.appendChild(item);
  });
}

function renderManagePeople() {
  managePeopleListEl.replaceChildren();
  if (!completion?.people?.length) {
    managePeopleListEl.textContent = 'Сотрудники не добавлены';
    return;
  }

  completion.people.forEach((person) => {
    const row = managePersonTemplate.content.cloneNode(true).querySelector('.manage-person');
    row.querySelector('.manage-person__name').textContent = person.name;
    row.querySelector('.manage-person__remove').addEventListener('click', async () => {
      if (!confirm(`Удалить «${person.name}» из списка?`)) return;
      try {
        await api(`/api/people/${person.id}`, { method: 'DELETE' });
        hiddenPeople.delete(person.name);
        await loadData();
        renderManagePeople();
      } catch (error) {
        alert(`Ошибка: ${error.message}`);
      }
    });
    managePeopleListEl.appendChild(row);
  });
}

function bindTaskRowInputs(row, tr) {
  tr.querySelectorAll('.cell-input, .cell-select').forEach((input) => {
    input.addEventListener('input', () => onCellChange(row.id, input, tr));
    input.addEventListener('change', () => onCellChange(row.id, input, tr));
  });
}

function renderProjectRowView(row, index, tbody) {
  const tr = rowProjectViewTemplate.content.cloneNode(true).querySelector('tr');
  tr.dataset.id = row.id;
  tr.querySelector('.row-num').textContent = index + 1;
  tr.querySelector('.project-task-name').textContent = row.task || 'Проектные задачи';

  tr.querySelectorAll('.cell-input[data-field]').forEach((input) => {
    const field = input.dataset.field;
    if (DAYS.includes(field)) {
      input.value = formatHours(parseHours(row[field]));
    }
  });

  tr.querySelector('.row-total').textContent = formatHours(rowTotal(row));
  bindTaskRowInputs(row, tr);
  tbody.appendChild(tr);
}

function renderTaskRowView(row, index, tbody) {
  const tr = rowViewTemplate.content.cloneNode(true).querySelector('tr');
  tr.dataset.id = row.id;
  tr.querySelector('.row-num').textContent = index + 1;
  applyRowStatusClass(tr, row.status || 'new');

  const categoryTd = tr.querySelector('.col-category');
  categoryTd.classList.remove('cell-text');
  const categorySelect = document.createElement('select');
  categorySelect.className = 'cell-select';
  categorySelect.dataset.field = 'category';
  populateCategorySelect(categorySelect, categories, row.category || '');
  categoryTd.replaceChildren(categorySelect);

  tr.querySelector('.col-task.cell-text').textContent = row.task || '—';

  const finalInput = tr.querySelector('[data-field="final_task"]');
  finalInput.value = row.final_task || '';

  const statusSelect = tr.querySelector('[data-field="status"]');
  populateStatusSelect(statusSelect, row.status || 'new');

  tr.querySelectorAll('.cell-input[data-field]').forEach((input) => {
    const field = input.dataset.field;
    if (field === 'final_task') {
      input.value = row.final_task || '';
    } else if (DAYS.includes(field)) {
      input.value = formatHours(parseHours(row[field]));
    }
  });

  tr.querySelector('.row-total').textContent = formatHours(rowTotal(row));
  tr.querySelector('.col-comment.cell-text').textContent = row.comment || '—';

  tr.querySelector('.btn-transfer').addEventListener('click', async () => {
    try {
      const updated = await api(`/api/tasks/${row.id}/transfer`, { method: 'POST' });
      Object.assign(row, updated);
      finalInput.value = row.final_task || '';
      populateStatusSelect(statusSelect, row.status);
      applyRowStatusClass(tr, row.status);
    } catch (error) {
      alert(`Ошибка переноса: ${error.message}`);
    }
  });

  bindTaskRowInputs(row, tr);
  tbody.appendChild(tr);
}

function renderUserSection(group, query) {
  const section = userSectionTemplate.content.cloneNode(true).querySelector('.user-section');
  const visibleTasks = group.tasks.filter((row) => matchesSearch(row, group.person.name, query));
  const projectTasks = visibleTasks.filter(isProjectRow);
  const customTasks = visibleTasks.filter((row) => !isProjectRow(row));
  const reportTasks = customTasks.filter((row) => !isAdminTaskRow(row));
  const reportHours = reportTasks.reduce((sum, row) => sum + rowTotal(row), 0);
  const person = group.person;
  const tableTasks = [...projectTasks, ...customTasks];

  section.dataset.personId = person.id || person.name;
  section.querySelector('.user-section__name').textContent = person.name;

  const normParts = [
    `Проект ${formatHours(person.project_hours || 0)} ч`,
    `админ ${formatHours(person.admin_hours || 0)} ч`,
    `${formatHours(person.total_hours || 0)} / ${person.hours_norm || 40} ч`,
  ];
  const metaParts = [normParts.join(' · '), `${customTasks.length} задач в отчёте`, `${formatHours(reportHours)} ч отчёт`];
  if (person.filled === false) metaParts.push('не заполнено');
  section.querySelector('.user-section__meta').textContent = metaParts.join(' · ');

  const tbody = section.querySelector('.user-task-body');
  const emptyEl = section.querySelector('.user-section__empty');
  const tableWrap = section.querySelector('.table-wrap');

  if (tableTasks.length === 0) {
    tableWrap.classList.add('hidden');
    emptyEl.classList.remove('hidden');
  } else {
    let index = 0;
    projectTasks.forEach((row) => {
      renderProjectRowView(row, index, tbody);
      index += 1;
    });
    customTasks.forEach((row) => {
      renderTaskRowView(row, index, tbody);
      index += 1;
    });
  }

  section.querySelector('.user-section__header').addEventListener('click', () => {
    section.classList.toggle('user-section--collapsed');
  });

  if (sectionsCollapsed) {
    section.classList.add('user-section--collapsed');
  }

  return section;
}

function render() {
  if (adminMode !== 'view') return;

  const query = searchInput.value.trim();
  const groups = buildGroups().filter((group) => {
    if (!isPersonVisible(group.person.name)) return false;

    if (!query) {
      return group.tasks.length > 0 || completion?.people?.some((p) => p.name === group.person.name);
    }

    return matchesSearch({ task: '', comment: '', owner_username: '' }, group.person.name, query)
      || group.tasks.some((row) => matchesSearch(row, group.person.name, query));
  });

  usersListEl.replaceChildren();

  let visibleTasks = 0;
  groups.forEach((group) => {
    const visible = group.tasks.filter((row) => matchesSearch(row, group.person.name, query));
    if (query && visible.length === 0 && !group.person.name.toLowerCase().includes(query.toLowerCase())) return;
    visibleTasks += visible.length;
    usersListEl.appendChild(renderUserSection(group, query));
  });

  emptyHint.classList.toggle('hidden', groups.length > 0);
  emptyHint.textContent = rows.length > 0 || hiddenPeople.size > 0
    ? 'Никого не показано — нажмите «Показать все»'
    : 'Задач пока нет';

  const shownPeople = visiblePeopleCount();
  taskCountEl.textContent = query
    ? `Найдено: ${visibleTasks} задач · ${groups.length} сотрудников`
    : `${rows.length} задач · показано ${shownPeople} из ${completion?.total || 0}`;
}

function onCellChange(taskId, input, tr) {
  const row = rows.find((item) => item.id === taskId);
  if (!row) return;

  const field = input.dataset.field;
  if (DAYS.includes(field)) {
    row[field] = parseHours(input.value);
    input.value = formatHours(row[field]);
    tr.querySelector('.row-total').textContent = formatHours(rowTotal(row));
  } else {
    row[field] = input.value;
  }

  if (field === 'status') {
    applyRowStatusClass(tr, row.status);
  }

  saveTaskDebounced(taskId, taskPayload(row));
}

async function loadData(refreshCompletion = true) {
  const week = weekPicker.getWeek();
  const requests = [
    api(`/api/tasks?week=${encodeURIComponent(week)}`).then(unwrapTasksResponse),
    api(`/api/completion?week=${encodeURIComponent(week)}`),
    api('/api/categories'),
  ];

  const results = await Promise.all(requests);
  rows = results[0].tasks;
  completion = results[1];
  categories = results[2];
  hiddenPeople = new Set(
    [...hiddenPeople].filter((name) => completion.people.some((p) => p.name === name))
  );

  if (refreshCompletion) {
    renderCompletion();
    if (adminMode === 'manage') {
      renderManagePeople();
    }
  }
  render();
}

function renderCategoryList(items) {
  const el = document.getElementById('category-list');
  if (!el) return;
  el.replaceChildren();
  if (!items.length) {
    el.textContent = 'Категории не заданы';
    return;
  }
  items.forEach((item) => {
    const chip = document.createElement('span');
    chip.className = 'project-chip project-chip--category';
    chip.textContent = item.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      if (!confirm(`Удалить категорию «${item.name}»?`)) return;
      await api(`/api/categories/${item.id}`, { method: 'DELETE' });
      categories = await api('/api/categories');
      renderCategoryList(categories);
    });
    chip.appendChild(remove);
    el.appendChild(chip);
  });
}

addPersonForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = newPersonNameInput.value.trim();
  if (!name) return;
  try {
    await api('/api/people', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    newPersonNameInput.value = '';
    await loadData();
    if (adminMode === 'manage') renderManagePeople();
  } catch (error) {
    alert(`Ошибка: ${error.message}`);
  }
});

document.getElementById('add-category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('new-category-name').value.trim();
  if (!name) return;
  try {
    await api('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    document.getElementById('new-category-name').value = '';
    categories = await api('/api/categories');
    renderCategoryList(categories);
  } catch (error) {
    alert(`Ошибка: ${error.message}`);
  }
});

btnShowAll.addEventListener('click', showAllPeople);
btnHideAll.addEventListener('click', hideAllPeople);

btnExpandAll.addEventListener('click', () => {
  sectionsCollapsed = false;
  render();
});

btnCollapseAll.addEventListener('click', () => {
  sectionsCollapsed = true;
  render();
});

document.getElementById('btn-export').addEventListener('click', () => {
  exportCsv(rows.filter((row) => !isProjectRow(row)), 'all-tasks', weekPicker.getWeek());
});
document.getElementById('btn-logout').addEventListener('click', logout);
searchInput.addEventListener('input', render);

document.querySelectorAll('.admin-tabs__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === adminMode) return;
    setAdminMode(mode);
  });
});

(async () => {
  const user = await requireAdminAuth();
  if (!user) return;

  userBadge.textContent = `${user.username} (админ)`;

  weekPicker = initWeekPicker({
    selectEl: document.getElementById('week-select'),
    labelEl: null,
    prevBtn: document.getElementById('week-prev'),
    nextBtn: document.getElementById('week-next'),
    onChange: () => {
      hiddenPeople.clear();
      loadData();
    },
  });

  await loadData();
  setAdminMode('view');
})();
