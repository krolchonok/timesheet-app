const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKLY_HOURS_NORM = 40;

const TASK_STATUSES = [
  { value: 'new', label: 'Новая' },
  { value: 'editing', label: 'Редактируется' },
  { value: 'transferred', label: 'Перенесено' },
];

function autoGrowTextarea(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  // Collapse first so scrollHeight reflects the real content height even
  // after value was set programmatically (import / re-render).
  el.style.height = '0px';
  const next = Math.max(el.scrollHeight, 40);
  el.style.height = `${next}px`;
}

function refreshTextareaHeights(root = document) {
  const run = () => {
    root.querySelectorAll('textarea.cell-input').forEach(autoGrowTextarea);
  };
  run();
  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
}

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
  const report = formatHours(progress.report_hours ?? 0);

  if (label) {
    label.textContent = progress.project_hours != null
      ? `Проект ${project} · задачи ${report} · ${filled} / ${norm} ч`
      : `${filled} / ${norm} ч`;
  }
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.classList.toggle('fill-indicator__bar--complete', progress.hours_complete);
  }
  if (wrap) {
    wrap.setAttribute('aria-valuenow', String(percent));
    wrap.title = progress.project_hours != null
      ? `Проект ${project} ч + задачи ${report} ч = ${filled} из ${norm} (${percent}%)`
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

const PROJECT_TYPE_VALUE = '__project__';

function populateTaskTypeSelect(select, adminCategoryName) {
  if (!select) return;
  select.replaceChildren();

  const projectOption = document.createElement('option');
  projectOption.value = PROJECT_TYPE_VALUE;
  projectOption.textContent = 'Проектная задача';
  select.appendChild(projectOption);

  const adminOption = document.createElement('option');
  adminOption.value = adminCategoryName;
  adminOption.textContent = 'Административная';
  select.appendChild(adminOption);
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

function preferredAdminCategory(currentCategory, categoryList, fallbackName) {
  const names = (categoryList || []).map((item) => item.name);
  const current = String(currentCategory || '').trim();
  if (current && names.includes(current)) return current;
  if (fallbackName && names.includes(fallbackName)) return fallbackName;
  return names[0] || current || fallbackName || '';
}

function buildTypeConversionPayload(row, toProject, categoryList, adminCategoryName) {
  const payload = taskPayload(row);
  payload.is_project = Boolean(toProject);
  if (toProject) {
    // category field becomes project name — keep whatever was there for editing
    payload.category = String(row.category || '').trim();
  } else {
    payload.category = preferredAdminCategory(row.category, categoryList, adminCategoryName);
  }
  return payload;
}

function normHoursBreakdown(rows) {
  let project = 0;
  let report = 0;
  rows.forEach((row) => {
    const hours = rowTotal(row);
    if (isProjectRow(row)) project += hours;
    else report += hours;
  });
  return { project_hours: project, report_hours: report, total_hours: project + report };
}

function buildProgressFromRows(rows) {
  const breakdown = normHoursBreakdown(rows);
  return {
    ...buildProgress(breakdown.total_hours),
    project_hours: breakdown.project_hours,
    report_hours: breakdown.report_hours,
  };
}
function normHoursFromRows(rows) {
  return normHoursBreakdown(rows).total_hours;
}

async function requireAdminAuth() {
  try {
    const user = await api('/api/me');
    if (user.role !== 'admin') {
      window.location.href = '/';
      return null;
    }
    return user;
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

// Debounced per key, so editing one row can't clobber (or fire a save
// after deleting) another row's pending save.
function debounceByKey(fn, ms = 400) {
  const timers = new Map();
  const wrapped = (key, ...args) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      fn(key, ...args);
    }, ms));
  };
  wrapped.cancel = (key) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  return wrapped;
}

// ── Arrow-key cell navigation ──
// ArrowLeft/ArrowRight move focus between adjacent editable cells in the
// same table row (wrapping to the next/previous row within the same
// <tbody> at the row's edge). For text fields (task/comment/etc.) this
// only kicks in once the caret is already at the start/end of the text,
// so normal left/right editing inside a cell is untouched; hour inputs
// and <select> cells (no text caret) switch immediately.
function isAtFieldBoundary(el, direction) {
  let start;
  let end;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch (_) {
    return true; // selection API unsupported (e.g. number input) — treat as boundary
  }
  if (typeof start !== 'number' || typeof end !== 'number') return true; // e.g. <select>
  if (start !== end) return false; // an active text selection — let arrows collapse it first
  return direction === 'left' ? start === 0 : start === String(el.value ?? '').length;
}

function focusCell(el, direction) {
  el.focus();
  try {
    const pos = direction === 'left' ? String(el.value ?? '').length : 0;
    el.setSelectionRange(pos, pos);
  } catch (_) {
    /* selection API unsupported — focus alone is enough */
  }
}

function rowNavCells(tr) {
  return Array.from(tr.querySelectorAll('.cell-input, .cell-select')).filter(
    (el) => !el.disabled && el.offsetParent !== null
  );
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

  const el = e.target;
  if (!el || !el.matches || !el.matches('.cell-input, .cell-select')) return;

  const direction = e.key === 'ArrowLeft' ? 'left' : 'right';
  if (!isAtFieldBoundary(el, direction)) return;

  const tr = el.closest('tr');
  if (!tr) return;
  const cells = rowNavCells(tr);
  const idx = cells.indexOf(el);
  if (idx === -1) return;

  let target = cells[direction === 'right' ? idx + 1 : idx - 1];

  if (!target) {
    let sibling = direction === 'right' ? tr.nextElementSibling : tr.previousElementSibling;
    while (sibling && !target) {
      const siblingCells = rowNavCells(sibling);
      if (siblingCells.length) {
        target = direction === 'right' ? siblingCells[0] : siblingCells[siblingCells.length - 1];
      } else {
        sibling = direction === 'right' ? sibling.nextElementSibling : sibling.previousElementSibling;
      }
    }
  }

  if (!target) return;
  e.preventDefault();
  focusCell(target, direction);
});

// ── UI appearance: default (soft) / grid (cell borders) ──
const THEME_STORAGE_KEY = 'timesheet-theme';
const THEMES = ['default', 'grid'];

function getTheme() {
  const value = document.documentElement.getAttribute('data-theme') || 'default';
  return THEMES.includes(value) ? value : 'default';
}

function setTheme(theme) {
  const value = THEMES.includes(theme) ? theme : 'default';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch (_) {
    /* ignore */
  }
  if (value === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', value);
  }
}

function initThemeToggle(button) {
  if (!button) return;
  const render = () => {
    const active = getTheme() === 'grid';
    button.textContent = active ? 'Оформление: с обводкой' : 'Оформление: обычное';
    button.setAttribute('aria-pressed', String(active));
    button.title = 'Обычное — мягкие границы; с обводкой — сетка ячеек таблицы';
  };
  render();
  button.addEventListener('click', () => {
    setTheme(getTheme() === 'grid' ? 'default' : 'grid');
    render();
    refreshTextareaHeights();
  });
}

// ── Row drag reorder (pointer-driven) ──
function fillRowDragAndNum(tr, index) {
  if (!tr) return;
  const numCell = tr.querySelector('.col-num');
  if (!numCell) return;

  numCell.replaceChildren();

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'row-drag-handle';
  handle.title = 'Перетащить';
  handle.setAttribute('aria-label', 'Перетащить строку');
  handle.innerHTML = '<span></span><span></span>';

  const num = document.createElement('span');
  num.className = 'row-num';
  num.textContent = String(index + 1);

  numCell.append(handle, num);
}

function renumberTaskRows(tbody) {
  if (!tbody) return;
  [...tbody.querySelectorAll('tr[data-id]')].forEach((tr, index) => {
    const num = tr.querySelector('.row-num');
    if (num) num.textContent = String(index + 1);
  });
}

function rowDragLabel(tr) {
  const taskInput = tr.querySelector('.cell-input[data-field="task"]');
  if (taskInput?.value?.trim()) return taskInput.value.trim();
  const categoryInput = tr.querySelector('.cell-input[data-field="category"]');
  if (categoryInput?.value?.trim()) return categoryInput.value.trim();
  const projectName = tr.querySelector('.project-task-name')?.textContent?.trim();
  if (projectName) return projectName;
  const select = tr.querySelector('select[data-field="category"]');
  if (select?.value) return select.value;
  return 'Задача';
}

function clearRowDragUi(tbody, { keepGhost = false } = {}) {
  document.body.classList.remove('is-row-dragging');
  if (!keepGhost) {
    document.querySelectorAll('.row-drag-ghost').forEach((el) => el.remove());
  }
  document.querySelectorAll('.row-drop-line').forEach((el) => el.remove());
  tbody?.querySelectorAll('.task-row--dragging, .task-row--drop-target').forEach((el) => {
    el.classList.remove('task-row--dragging', 'task-row--drop-target');
  });
}

function placeDropLine(tbody, dragging, beforeEl) {
  let line = document.querySelector('.row-drop-line');
  if (!line) {
    line = document.createElement('div');
    line.className = 'row-drop-line';
    document.body.appendChild(line);
  }

  const table = tbody.closest('table') || tbody;
  const tableRect = table.getBoundingClientRect();
  let y;
  if (beforeEl) {
    y = beforeEl.getBoundingClientRect().top;
  } else {
    const rows = [...tbody.querySelectorAll('tr[data-id]')].filter((row) => row !== dragging);
    const last = rows[rows.length - 1];
    y = last ? last.getBoundingClientRect().bottom : tableRect.bottom;
  }
  line.style.left = `${tableRect.left + 8}px`;
  line.style.width = `${Math.max(80, tableRect.width - 16)}px`;
  line.style.top = `${y - 1}px`;
  line.hidden = false;
}

function moveRowDragGhost(ghost, clientX, clientY) {
  if (!ghost) return;
  ghost.style.transform = `translate(${clientX - ghost._offsetX}px, ${clientY - ghost._offsetY}px)`;
}

function createRowDragGhost(tr, clientX, clientY) {
  const rect = tr.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'row-drag-ghost';
  ghost.innerHTML = `
    <span class="row-drag-ghost__grip" aria-hidden="true"><span></span><span></span><span></span></span>
    <span class="row-drag-ghost__text"></span>
    <span class="row-drag-ghost__hint">Отпустите, чтобы поставить</span>
  `;
  ghost.querySelector('.row-drag-ghost__text').textContent = rowDragLabel(tr);
  ghost.style.width = `${Math.min(Math.max(rect.width * 0.55, 220), 420)}px`;
  ghost._offsetX = 28;
  ghost._offsetY = Math.min(24, rect.height / 2);
  document.body.appendChild(ghost);
  moveRowDragGhost(ghost, clientX, clientY);
  requestAnimationFrame(() => ghost.classList.add('row-drag-ghost--visible'));
  return ghost;
}

function bindRowDragReorder(tr, {
  getOrderedIds,
  applyLocalOrder,
  persistOrder,
  canDropOn,
}) {
  const handle = tr.querySelector('.row-drag-handle');
  if (!handle || handle.dataset.dragBound === '1') return;
  handle.dataset.dragBound = '1';

  const DRAG_THRESHOLD = 5;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (handle.disabled) return;
    e.preventDefault();
    e.stopPropagation();

    const tbody = tr.parentElement;
    if (!tbody) return;

    const state = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      ghost: null,
      moved: false,
      originNext: tr.nextSibling,
      originParent: tbody,
    };

    const eligibleTargets = () =>
      [...tbody.querySelectorAll('tr[data-id]')].filter(
        (row) => row !== tr && (!canDropOn || canDropOn(tr, row))
      );

    const updateInsert = (clientY) => {
      const targets = eligibleTargets();
      tbody.querySelectorAll('.task-row--drop-target').forEach((row) => {
        row.classList.remove('task-row--drop-target');
      });
      if (targets.length === 0) {
        placeDropLine(tbody, tr, null);
        return;
      }

      let before = null;
      for (const row of targets) {
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          before = row;
          break;
        }
      }

      const last = targets[targets.length - 1];
      if (before) {
        if (tr.nextSibling !== before) tbody.insertBefore(tr, before);
      } else if (last.nextSibling !== tr) {
        if (last.nextSibling) tbody.insertBefore(tr, last.nextSibling);
        else tbody.appendChild(tr);
      }

      placeDropLine(tbody, tr, before);
      renumberTaskRows(tbody);
      const highlight = before || last;
      if (highlight) highlight.classList.add('task-row--drop-target');
    };

    const onMove = (ev) => {
      if (ev.pointerId !== state.pointerId) return;
      const dx = ev.clientX - state.startX;
      const dy = ev.clientY - state.startY;
      if (!state.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        state.active = true;
        state.moved = true;
        document.body.classList.add('is-row-dragging');
        tr.classList.add('task-row--dragging');
        state.ghost = createRowDragGhost(tr, ev.clientX, ev.clientY);
        try {
          handle.setPointerCapture(state.pointerId);
        } catch (_) {
          /* ignore */
        }
      }
      moveRowDragGhost(state.ghost, ev.clientX, ev.clientY);
      updateInsert(ev.clientY);
    };

    const finish = async (ev) => {
      if (ev && ev.pointerId !== state.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);

      const wasActive = state.active;
      const ghost = state.ghost;
      clearRowDragUi(tbody, { keepGhost: Boolean(ghost) });
      if (ghost) {
        ghost.classList.add('row-drag-ghost--exit');
        setTimeout(() => ghost.remove(), 160);
      }

      if (!wasActive) return;

      tr.classList.add('task-row--dropped');
      setTimeout(() => tr.classList.remove('task-row--dropped'), 420);
      renumberTaskRows(tbody);

      const orderedIds = getOrderedIds
        ? getOrderedIds(tbody, tr)
        : [...tbody.querySelectorAll('tr[data-id]')].map((row) => Number(row.dataset.id));
      applyLocalOrder?.(orderedIds);
      try {
        await persistOrder?.(orderedIds);
      } catch (error) {
        alert(`Ошибка сохранения порядка: ${error.message}`);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
}

async function persistTaskOrder(orderedIds) {
  if (!orderedIds || orderedIds.length === 0) return;
  await api('/api/tasks/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ordered_ids: orderedIds }),
  });
}
