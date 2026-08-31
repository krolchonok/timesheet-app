const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKLY_HOURS_NORM = 40;

const TASK_STATUSES = [
  { value: 'new', label: 'Новая' },
  { value: 'editing', label: 'Редактируется' },
  { value: 'transferred', label: 'Перенесено' },
];
const ADMIN_TASK_CATEGORY = 'Административные задачи';

function unwrapTasksResponse(data) {
  if (Array.isArray(data)) {
    const total = data.reduce((sum, row) => sum + rowTotal(row), 0);
    return { tasks: data, progress: buildProgress(total) };
  }
  return data;
}

function buildProgress(totalHours) {
  const norm = WEEKLY_HOURS_NORM;
  const percent = norm ? Math.min(100, Math.round((totalHours / norm) * 100)) : 0;
  return {
    total_hours: totalHours,
    hours_norm: norm,
    hours_percent: percent,
    hours_complete: totalHours >= norm,
  };
}

function updateFillIndicator(progress, elements) {
  if (!elements || !progress) return;
  const { bar, label, wrap } = elements;
  const filled = formatHours(progress.total_hours);
  const norm = progress.hours_norm;
  const percent = progress.hours_percent;
  const project = formatHours(progress.project_hours ?? 0);
  const admin = formatHours(progress.admin_hours ?? 0);

  if (label) {
    label.textContent = progress.project_hours != null
      ? `Проект ${project} · админ ${admin} · ${filled} / ${norm} ч`
      : `${filled} / ${norm} ч`;
  }
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.classList.toggle('fill-indicator__bar--complete', progress.hours_complete);
  }
  if (wrap) {
    wrap.setAttribute('aria-valuenow', String(percent));
    wrap.title = progress.project_hours != null
      ? `Проект ${project} ч + админ ${admin} ч = ${filled} из ${norm} (${percent}%)`
      : `Заполнено ${filled} из ${norm} часов (${percent}%)`;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const message = data?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function parseHours(value) {
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function rowTotal(row) {
  return DAYS.reduce((sum, day) => sum + parseHours(row[day]), 0);
}

function formatHours(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function emptyTask(defaultFio = '', weekStart = getCurrentWeekStart()) {
  return {
    fio: defaultFio,
    task: '',
    category: '',
    final_task: '',
    status: 'new',
    mon: 0,
    tue: 0,
    wed: 0,
    thu: 0,
    fri: 0,
    comment: '',
    week_start: weekStart,
  };
}

function statusLabel(value) {
  return TASK_STATUSES.find((item) => item.value === value)?.label || 'Новая';
}

function applyRowStatusClass(tr, status) {
  if (!tr) return;
  tr.classList.toggle('task-row--transferred', status === 'transferred');
  tr.classList.toggle('task-row--editing', status === 'editing');
}

function populateCategorySelect(select, categories, selectedValue = '') {
  if (!select) return;
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— Категория —';
  select.appendChild(empty);
  categories.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = item.name;
    if (item.name === selectedValue) option.selected = true;
    select.appendChild(option);
  });
}

function populateStatusSelect(select, selectedValue = 'new') {
  if (!select) return;
  select.replaceChildren();
  TASK_STATUSES.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    if (item.value === selectedValue) option.selected = true;
    select.appendChild(option);
  });
}

function taskPayload(row) {
  return {
    fio: row.fio || '',
    task: row.task || '',
    category: row.category || '',
    final_task: row.final_task || '',
    status: row.status || 'new',
    mon: parseHours(row.mon),
    tue: parseHours(row.tue),
    wed: parseHours(row.wed),
    thu: parseHours(row.thu),
    fri: parseHours(row.fri),
    comment: row.comment || '',
    week_start: row.week_start || getCurrentWeekStart(),
    is_project: Boolean(row.is_project),
  };
}

function isProjectRow(row) {
  return Boolean(row.is_project);
}

function isAdminTaskRow(row) {
  return !isProjectRow(row) && row.category === ADMIN_TASK_CATEGORY;
}

function normHoursBreakdown(rows) {
  let project = 0;
  let admin = 0;
  rows.forEach((row) => {
    const hours = rowTotal(row);
    if (isProjectRow(row)) project += hours;
    else if (isAdminTaskRow(row)) admin += hours;
  });
  return { project_hours: project, admin_hours: admin, total_hours: project + admin };
}

function buildProgressFromRows(rows) {
  const breakdown = normHoursBreakdown(rows);
  return {
    ...buildProgress(breakdown.total_hours),
    project_hours: breakdown.project_hours,
    admin_hours: breakdown.admin_hours,
  };
}
function normHoursFromRows(rows) {
  return normHoursBreakdown(rows).total_hours;
}

async function requireAuth() {
  try {
    return await api('/api/me');
  } catch (_) {
    window.location.href = '/login';
    return null;
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

function exportCsv(rows, filenamePrefix = 'tasks', weekStart = '') {
  const headers = [
    'Неделя',
    'ФИО',
    'Категория',
    'Название задачи',
    'Итоговое наименование',
    'Статус',
    'Пн',
    'Вт',
    'Ср',
    'Чт',
    'Пт',
    'Итого',
    'Комментарии',
  ];
  const lines = [headers.join(';')];

  rows.forEach((row) => {
    const total = rowTotal(row);
    const cells = [
      row.week_start ? formatWeekLabel(row.week_start) : '',
      row.fio,
      row.category || '',
      row.task,
      row.final_task || '',
      statusLabel(row.status),
      ...DAYS.map((d) => formatHours(parseHours(row[d]))),
      formatHours(total),
      row.comment,
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`);
    lines.push(cells.join(';'));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = weekStart || new Date().toISOString().slice(0, 10);
  a.download = `${filenamePrefix}-${suffix}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function debounce(fn, ms = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
