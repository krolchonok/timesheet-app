(function () {
  const RESIZABLE_COLS = [
    'fio', 'category', 'task', 'final-task', 'status', 'comment',
  ];
  const FIXED_COLS = ['day', 'total'];
  const ALL_COLS = [...RESIZABLE_COLS, ...FIXED_COLS, 'num'];
  const STORAGE_KEY = 'timesheet-col-widths';
  const MIN_WIDTH = 40;
  const MIN_COL_WIDTH = {
    task: 90,
    category: 80,
    'final-task': 110,
    comment: 80,
    fio: 80,
    status: 80,
  };

  function minColWidth(col) {
    return MIN_COL_WIDTH[col] ?? MIN_WIDTH;
  }

  function reflowColumnTextareas(colName) {
    if (typeof autoGrowTextarea !== 'function') return;
    document.querySelectorAll(`.task-table .col-${colName} textarea.cell-input`).forEach(autoGrowTextarea);
  }

  let reflowFrame = null;
  function scheduleReflow(colName) {
    if (reflowFrame) cancelAnimationFrame(reflowFrame);
    reflowFrame = requestAnimationFrame(() => {
      reflowFrame = null;
      reflowColumnTextareas(colName);
    });
  }

  function isStaticTable(table) {
    return Boolean(
      table?.classList.contains('task-table--project')
      || table?.dataset.noResize === 'true'
      || table?.closest('#project-section, .task-section--project'),
    );
  }

  function mainTables() {
    return document.querySelectorAll('.task-table:not(.task-table--project):not([data-no-resize="true"])');
  }

  function clearFixedColumnOverrides() {
    const targets = [
      document.documentElement,
      ...document.querySelectorAll('.task-table'),
    ];
    FIXED_COLS.forEach((col) => {
      targets.forEach((el) => el.style.removeProperty(`--col-${col}`));
    });
  }

  function clearProjectColumnOverrides() {
    document.querySelectorAll('.task-table--project').forEach((table) => {
      ALL_COLS.forEach((col) => table.style.removeProperty(`--col-${col}`));
    });
  }

  function purgeProjectColumnWidths(saved) {
    let changed = false;
    Object.keys(saved).forEach((key) => {
      if (key.startsWith('project:')) {
        delete saved[key];
        changed = true;
      }
    });
    if (changed) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch (e) {
        /* ignore */
      }
    }
    return saved;
  }
  function purgeFixedColumnWidths(saved) {
    let changed = false;
    Object.keys(saved).forEach((key) => {
      const col = key.includes(':') ? key.split(':')[1] : key;
      if (FIXED_COLS.includes(col)) {
        delete saved[key];
        changed = true;
      }
    });
    if (changed) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch (e) {
        /* ignore */
      }
    }
    return saved;
  }

  function loadWidths() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      saved = {};
    }
    saved = purgeProjectColumnWidths(saved);
    saved = purgeFixedColumnWidths(saved);
    clearProjectColumnOverrides();
    clearFixedColumnOverrides();

    Object.entries(saved).forEach(([key, px]) => {
      if (!Number.isFinite(px) || px < MIN_WIDTH) return;

      let col;
      if (key.includes(':')) {
        const [scope, scopedCol] = key.split(':');
        if (scope !== 'main') return;
        col = scopedCol;
      } else {
        col = key;
      }
      if (!RESIZABLE_COLS.includes(col)) return;

      const width = Math.max(minColWidth(col), px);
      mainTables().forEach((table) => {
        table.style.setProperty(`--col-${col}`, `${width}px`);
      });
    });
  }

  function saveWidth(col, px) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      saved = {};
    }
    saved[`main:${col}`] = px;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (e) {
      /* ignore quota/private-mode errors */
    }
  }

  function colNameOf(th) {
    return [...th.classList]
      .find((cls) => cls.startsWith('col-') && RESIZABLE_COLS.includes(cls.slice(4)))
      ?.slice(4);
  }

  function injectResizers() {
    document.querySelectorAll('.task-table thead th').forEach((th) => {
      const table = th.closest('table');
      const existing = th.querySelector('.col-resizer');
      if (isStaticTable(table)) {
        existing?.remove();
        return;
      }
      const colName = colNameOf(th);
      if (!colName) {
        existing?.remove();
        return;
      }
      if (existing) return;
      const handle = document.createElement('span');
      handle.className = 'col-resizer';
      th.appendChild(handle);
    });
  }

  let active = null;

  document.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.col-resizer');
    if (!handle) return;
    const th = handle.closest('th');
    const table = th.closest('table');
    const colName = colNameOf(th);
    if (!colName || !table || isStaticTable(table)) return;
    active = {
      table,
      colName,
      startX: e.clientX,
      startWidth: th.getBoundingClientRect().width,
    };
    handle.classList.add('is-resizing');
    document.body.classList.add('col-resizing');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!active) return;
    const width = Math.max(
      minColWidth(active.colName),
      Math.round(active.startWidth + (e.clientX - active.startX)),
    );
    mainTables().forEach((table) => {
      table.style.setProperty(`--col-${active.colName}`, `${width}px`);
    });
    scheduleReflow(active.colName);
  });

  document.addEventListener('mouseup', () => {
    if (!active) return;
    const colName = active.colName;
    const value = getComputedStyle(active.table).getPropertyValue(`--col-${colName}`);
    saveWidth(colName, parseInt(value, 10));
    document.querySelectorAll('.col-resizer.is-resizing').forEach((el) => el.classList.remove('is-resizing'));
    document.body.classList.remove('col-resizing');
    active = null;
    reflowColumnTextareas(colName);
  });

  loadWidths();
  injectResizers();
  new MutationObserver(injectResizers).observe(document.body, { childList: true, subtree: true });
})();
