/**
 * Import tasks from MS Project / «обезличенное_расписание.xlsx» style workbook.
 * Expects global XLSX (SheetJS).
 */
(function (global) {
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const DAY_LABELS = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт' };
  const DAY_HEADER_RE = {
    mon: /^Пн(\s|$)/i,
    tue: /^Вт(\s|$)/i,
    wed: /^Ср(\s|$)/i,
    thu: /^Чт(\s|$)/i,
    fri: /^Пт(\s|$)/i,
  };

  function parseHours(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value).trim().replace(/\s+/g, '').replace(/ч$/i, '').replace(',', '.');
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function findDayColumns(headerRow) {
    const map = {};
    (headerRow || []).forEach((cell, index) => {
      const text = String(cell || '').trim();
      if (!text) return;
      for (const day of DAY_KEYS) {
        if (DAY_HEADER_RE[day].test(text)) map[day] = index;
      }
    });
    return map;
  }

  function isProjectHeaderRow(status, taskName) {
    return String(status || '').trim() === 'Снят'
      || /^Название проекта\s*:/i.test(String(taskName || '').trim());
  }

  function isAdminProject(projectName) {
    const name = String(projectName || '').trim();
    return !name || /^Административн/i.test(name);
  }

  function parseScheduleRows(rows) {
    if (!rows || !rows.length) return { tasks: [], weekHint: '', error: 'Пустой файл' };

    const header = rows[0] || [];
    const dayCols = findDayColumns(header);
    if (!Object.keys(dayCols).length) {
      return { tasks: [], weekHint: '', error: 'Не найдены колонки дней (Пн–Пт)' };
    }

    const weekHint = DAY_KEYS
      .filter((d) => dayCols[d] != null)
      .map((d) => String(header[dayCols[d]] || '').trim())
      .filter(Boolean)
      .join(' · ');

    const tasks = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const status = String(row[0] || '').trim();
      const taskName = String(row[1] || '').trim();
      const projectName = String(row[2] || '').trim();
      const note = String(row[4] || '').trim();
      const billing = String(row[5] || '').trim();

      if (status !== 'Установлен') continue;
      if (!taskName) continue;
      if (/^Общие трудозатраты/i.test(projectName) || /^Общие трудозатраты/i.test(taskName)) continue;
      if (isProjectHeaderRow(status, taskName)) continue;

      const hours = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
      let total = 0;
      DAY_KEYS.forEach((day) => {
        const idx = dayCols[day];
        const value = idx == null ? 0 : parseHours(row[idx]);
        hours[day] = value;
        total += value;
      });

      const admin = isAdminProject(projectName);
      tasks.push({
        id: `row-${r}`,
        sourceRow: r + 1,
        task: taskName,
        project: projectName,
        billing,
        note,
        is_project: !admin,
        category: admin ? (billing || 'Административные задачи') : projectName,
        mon: hours.mon,
        tue: hours.tue,
        wed: hours.wed,
        thu: hours.thu,
        fri: hours.fri,
        total,
      });
    }

    return { tasks, weekHint, error: tasks.length ? '' : 'В файле нет строк задач (статус «Установлен»)' };
  }

  function parseArrayBuffer(buffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Библиотека XLSX не загружена');
    }
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { tasks: [], weekHint: '', error: 'В книге нет листов' };
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const parsed = parseScheduleRows(rows);
    parsed.sheetName = sheetName;
    return parsed;
  }

  async function parseFile(file) {
    const buffer = await file.arrayBuffer();
    return parseArrayBuffer(new Uint8Array(buffer));
  }

  function formatHours(value) {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function ensureUi() {
    let overlay = document.getElementById('schedule-import-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'schedule-import-overlay';
    overlay.className = 'modal-overlay schedule-import-overlay hidden';
    overlay.innerHTML = `
      <div class="modal schedule-import-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-import-title">
        <div class="schedule-import-modal__head">
          <div>
            <p class="modal__title" id="schedule-import-title">Импорт из расписания</p>
            <p class="schedule-import-modal__meta" id="schedule-import-meta"></p>
          </div>
          <button type="button" class="btn btn--ghost btn--small" id="schedule-import-close">Закрыть</button>
        </div>
        <div class="schedule-import-modal__toolbar">
          <label class="schedule-import-select-all">
            <input type="checkbox" id="schedule-import-select-all" checked>
            <span>Выбрать все</span>
          </label>
          <span class="schedule-import-modal__hint" id="schedule-import-hint"></span>
        </div>
        <div class="schedule-import-list" id="schedule-import-list"></div>
        <div class="modal__actions schedule-import-modal__actions">
          <button type="button" class="btn btn--ghost" id="schedule-import-cancel">Отмена</button>
          <button type="button" class="btn btn--primary" id="schedule-import-apply">Добавить выбранные</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let dropOverlay = document.getElementById('schedule-drop-overlay');
    if (!dropOverlay) {
      dropOverlay = document.createElement('div');
      dropOverlay.id = 'schedule-drop-overlay';
      dropOverlay.className = 'schedule-drop-overlay hidden';
      dropOverlay.innerHTML = '<div class="schedule-drop-overlay__card">Отпустите Excel (.xlsx), чтобы разобрать расписание</div>';
      document.body.appendChild(dropOverlay);
    }

    return overlay;
  }

  function renderTaskRow(task, checked) {
    const typeLabel = task.is_project ? 'Проект' : 'Админ';
    const days = DAY_KEYS.map((d) => `${DAY_LABELS[d]} ${formatHours(task[d])}`).join(' · ');
    const el = document.createElement('label');
    el.className = 'schedule-import-item';
    el.dataset.id = task.id;
    el.innerHTML = `
      <input type="checkbox" class="schedule-import-item__check" ${checked ? 'checked' : ''} data-id="${task.id}">
      <span class="schedule-import-item__body">
        <span class="schedule-import-item__top">
          <span class="schedule-import-item__name"></span>
          <span class="schedule-import-item__badge"></span>
          <span class="schedule-import-item__total"></span>
        </span>
        <span class="schedule-import-item__sub"></span>
        <span class="schedule-import-item__days"></span>
      </span>
    `;
    el.querySelector('.schedule-import-item__name').textContent = task.task;
    el.querySelector('.schedule-import-item__badge').textContent = typeLabel;
    el.querySelector('.schedule-import-item__total').textContent = `${formatHours(task.total)} ч`;
    el.querySelector('.schedule-import-item__sub').textContent = task.is_project
      ? (task.project || 'Без проекта')
      : (task.category || 'Административные');
    el.querySelector('.schedule-import-item__days').textContent = days;
    return el;
  }

  function openImportModal(parsed, onApply) {
    const overlay = ensureUi();
    const list = overlay.querySelector('#schedule-import-list');
    const meta = overlay.querySelector('#schedule-import-meta');
    const hint = overlay.querySelector('#schedule-import-hint');
    const selectAll = overlay.querySelector('#schedule-import-select-all');
    const applyBtn = overlay.querySelector('#schedule-import-apply');

    const tasks = parsed.tasks || [];
    meta.textContent = [
      parsed.sheetName ? `Лист: ${parsed.sheetName}` : '',
      parsed.weekHint ? `Неделя в файле: ${parsed.weekHint}` : '',
      `${tasks.length} задач`,
    ].filter(Boolean).join(' · ');

    hint.textContent = 'Часы попадут в текущую выбранную неделю по дням Пн–Пт';
    list.replaceChildren();
    tasks.forEach((task) => {
      list.appendChild(renderTaskRow(task, task.total > 0 || tasks.every((t) => t.total === 0)));
    });

    const syncSelectAll = () => {
      const boxes = [...list.querySelectorAll('.schedule-import-item__check')];
      const checkedCount = boxes.filter((b) => b.checked).length;
      selectAll.checked = boxes.length > 0 && checkedCount === boxes.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
      applyBtn.disabled = checkedCount === 0;
    };
    syncSelectAll();

    const close = () => overlay.classList.add('hidden');

    selectAll.onchange = () => {
      list.querySelectorAll('.schedule-import-item__check').forEach((box) => {
        box.checked = selectAll.checked;
      });
      syncSelectAll();
    };
    list.onchange = syncSelectAll;

    overlay.querySelector('#schedule-import-close').onclick = close;
    overlay.querySelector('#schedule-import-cancel').onclick = close;
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    applyBtn.onclick = async () => {
      const selectedIds = new Set(
        [...list.querySelectorAll('.schedule-import-item__check:checked')].map((b) => b.dataset.id)
      );
      const selected = tasks.filter((t) => selectedIds.has(t.id));
      if (!selected.length) return;
      applyBtn.disabled = true;
      applyBtn.textContent = 'Добавление…';
      try {
        await onApply(selected);
        close();
      } catch (error) {
        alert(error.message || String(error));
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Добавить выбранные';
        syncSelectAll();
      }
    };

    overlay.classList.remove('hidden');
  }

  function isExcelFile(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.xlsx') || name.endsWith('.xls')
      || /sheet|excel/i.test(file.type || '');
  }

  function bindDropImport({ onFile, enabled }) {
    ensureUi();
    const dropOverlay = document.getElementById('schedule-drop-overlay');
    let dragDepth = 0;

    const canAccept = () => (typeof enabled === 'function' ? enabled() : true);

    window.addEventListener('dragenter', (e) => {
      if (!canAccept()) return;
      if (![...e.dataTransfer.types].includes('Files')) return;
      dragDepth += 1;
      dropOverlay.classList.remove('hidden');
    });

    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropOverlay.classList.add('hidden');
    });

    window.addEventListener('dragover', (e) => {
      if (!canAccept()) return;
      e.preventDefault();
    });

    window.addEventListener('drop', async (e) => {
      dragDepth = 0;
      dropOverlay.classList.add('hidden');
      if (!canAccept()) return;
      const file = e.dataTransfer?.files?.[0];
      if (!file || !isExcelFile(file)) return;
      e.preventDefault();
      onFile(file);
    });
  }

  function bindFileButton(button, fileInput, onFile) {
    if (!button || !fileInput) return;
    button.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) onFile(file);
    });
  }

  global.ScheduleImport = {
    parseFile,
    parseScheduleRows,
    openImportModal,
    bindDropImport,
    bindFileButton,
    isExcelFile,
    DAY_KEYS,
  };
})(window);
