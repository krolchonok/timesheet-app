(function () {
  const TOUR_STEPS = [
    {
      selector: '.week-picker',
      title: 'Неделя',
      text: 'Переключайте недели стрелками ← → или выбором из списка. Все таблицы ниже относятся к выбранной неделе.',
    },
    {
      selector: '.toolbar__field--person',
      title: 'ФИО',
      text: 'Выберите себя из списка — откроются административные и проектные задачи за эту неделю.',
    },
    {
      selector: '#fill-indicator',
      title: 'Заполненность недели',
      text: 'Сколько часов уже внесено из нормы 40 ч: проектные + административные задачи.',
      fallbackText: 'После выбора ФИО здесь появится индикатор: сколько часов из 40 уже заполнено.',
    },
    {
      selector: '#btn-add',
      title: 'Добавить задачу',
      text: 'Кнопка «+ Задача»: выберите тип — «Проектная задача» или «Административная» — и добавьте строку в нужную таблицу.',
    },
    {
      selector: '#btn-vacation',
      title: 'Отпуск',
      text: 'Отметьте дни отпуска на текущей неделе — часы проставятся автоматически.',
    },
    {
      selector: '#task-table',
      title: 'Административные задачи',
      text: 'Категория, название, часы по дням и комментарий. Итоговое наименование и статус заполняет руководитель — вам они только для просмотра.',
      fallbackText: 'После выбора ФИО появится таблица административных задач: категория, название, часы и комментарий.',
    },
    {
      selector: '.row-drag-handle',
      title: 'Порядок строк',
      text: 'Потяните за ручку слева от номера строки, чтобы переставить задачу вверх или вниз. Порядок сохраняется.',
      fallbackText: 'У каждой строки слева от номера есть ручка перетаскивания — ей можно менять порядок задач. Порядок сохраняется на сервере.',
    },
    {
      selector: '.btn-convert-type',
      title: 'Смена типа: П / А',
      text: 'Кнопка «П» делает задачу проектной, «А» — административной. Так можно быстро перенести строку между таблицами.',
      fallbackText: 'В действиях строки есть кнопки «П» и «А»: переводят задачу между проектными и административными.',
    },
    {
      selector: '#task-table thead th.col-task',
      title: 'Ширина колонок',
      text: 'Потяните за правый край заголовка колонки, чтобы изменить ширину. Настройка запоминается.',
      fallbackText: 'Ширину колонок можно менять, потянув за правый край заголовка — как в Excel.',
    },
    {
      selector: '#project-section',
      title: 'Проектные задачи',
      text: 'Отдельная таблица проектов: название проекта, задача и часы по дням. Добавляйте через «+ Задача» → «Проектная задача».',
      fallbackText: 'Ниже — блок «Проектные задачи». Добавляйте проекты кнопкой «+ Задача» (тип «Проектная задача»).',
    },
    {
      selector: '#more-menu-toggle',
      title: 'Меню «Ещё»',
      text: 'Здесь дополнительные действия: экспорт, импорт Excel, простой, инструкция, жалоба и оформление таблицы.',
    },
    {
      selector: '#btn-export',
      title: 'Экспорт CSV',
      text: 'Выгружает задачи текущей недели в CSV-файл.',
      openMoreMenu: true,
      fallbackText: 'В меню «Ещё» есть «Экспорт CSV» — выгрузка недели в файл.',
    },
    {
      selector: '#btn-import-schedule',
      title: 'Импорт Excel',
      text: 'Загрузите расписание из Excel: строки со статусом «Установлен» попадут в текущую неделю. Можно перетащить файл на страницу.',
      openMoreMenu: true,
      fallbackText: 'В меню «Ещё» — «Импорт Excel»: расписание из файла попадёт в текущую неделю. Файл также можно перетащить на страницу.',
    },
    {
      selector: '#btn-add-downtime',
      title: 'Простой',
      text: 'Быстро добавляет административную задачу «Простой» на текущую неделю.',
      openMoreMenu: true,
      fallbackText: 'В меню «Ещё» пункт «+ Простой» добавляет задачу простоя.',
    },
    {
      selector: '#theme-toggle',
      title: 'Оформление',
      text: 'Переключает вид таблицы: обычный или с обводкой ячеек. Выбор сохраняется в браузере.',
      openMoreMenu: true,
      fallbackText: 'В меню «Ещё» — «Оформление»: обычный вид или сетка с обводкой ячеек.',
    },
    {
      selector: '#btn-report-problem',
      title: 'Жалоба',
      text: 'Отправьте жалобу с комментарием. Шорткат Ctrl+M (на русской раскладке — та же клавиша) прикрепляет выделенный или активный элемент к сообщению. Руководитель увидит его в админке → Управление.',
      openMoreMenu: true,
      fallbackText: 'В меню «Ещё» есть «Жалоба…». Также Ctrl+M: открывает форму и прикрепляет выделенный элемент. Сообщения смотрит руководитель в админке.',
    },
    {
      selector: 'a[href="/login"]',
      title: 'Вход для руководителя',
      text: 'Руководитель входит в админ-панель: итоговые названия, статусы, сотрудники и список жалоб.',
      openMoreMenu: true,
      fallbackText: 'В меню «Ещё» ссылка «Админ» — вход в панель руководителя.',
    },
  ];

  const btn = document.getElementById('btn-tour');
  if (!btn) return;

  let overlay = null;
  let spotlight = null;
  let tooltip = null;
  let stepIndex = 0;
  let resizeHandler = null;

  function moreMenuPanel() {
    return document.getElementById('more-menu-panel');
  }

  function moreMenuToggle() {
    return document.getElementById('more-menu-toggle');
  }

  function openMoreMenu() {
    const panel = moreMenuPanel();
    const toggle = moreMenuToggle();
    const wrap = document.getElementById('more-menu');
    if (!panel || !toggle) return;
    wrap?.classList.add('tour-elevated');
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  }

  function closeMoreMenu() {
    const panel = moreMenuPanel();
    const toggle = moreMenuToggle();
    const wrap = document.getElementById('more-menu');
    if (!panel || !toggle) return;
    wrap?.classList.remove('tour-elevated');
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  }

  function resolveStep(step) {
    if (step.openMoreMenu) openMoreMenu();
    else closeMoreMenu();
    const el = document.querySelector(step.selector);
    return isVisible(el) ? el : null;
  }

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'tour-overlay';

    spotlight = document.createElement('div');
    spotlight.className = 'tour-spotlight';

    tooltip = document.createElement('div');
    tooltip.className = 'tour-tooltip';
    tooltip.innerHTML = `
      <div class="tour-tooltip__step" id="tour-step-count"></div>
      <h3 class="tour-tooltip__title" id="tour-step-title"></h3>
      <p class="tour-tooltip__text" id="tour-step-text"></p>
      <div class="tour-tooltip__actions">
        <button type="button" class="btn btn--ghost btn--small" id="tour-skip">Пропустить</button>
        <div class="tour-tooltip__nav">
          <button type="button" class="btn btn--secondary btn--small" id="tour-prev">← Назад</button>
          <button type="button" class="btn btn--primary btn--small" id="tour-next">Далее →</button>
        </div>
      </div>
    `;

    overlay.appendChild(spotlight);
    overlay.appendChild(tooltip);
    document.body.appendChild(overlay);

    overlay.querySelector('#tour-skip').addEventListener('click', (e) => {
      e.stopPropagation();
      endTour();
    });
    overlay.querySelector('#tour-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(stepIndex - 1);
    });
    overlay.querySelector('#tour-next').addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(stepIndex + 1);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) endTour();
    });
  }

  function positionFor(el) {
    if (!el) {
      spotlight.classList.add('tour-spotlight--hidden');
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.bottom = 'auto';
      tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    spotlight.classList.remove('tour-spotlight--hidden');
    const rect = el.getBoundingClientRect();
    const pad = 8;
    spotlight.style.top = `${rect.top - pad}px`;
    spotlight.style.left = `${rect.left - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    const spaceBelow = window.innerHeight - rect.bottom;
    const placeBelow = spaceBelow > 220 || spaceBelow > rect.top;
    tooltip.style.transform = 'none';

    if (!placeBelow) {
      tooltip.style.top = 'auto';
      tooltip.style.bottom = `${window.innerHeight - rect.top + pad + 12}px`;
    } else {
      tooltip.style.bottom = 'auto';
      tooltip.style.top = `${rect.bottom + pad + 12}px`;
    }

    const tipWidth = Math.min(360, window.innerWidth - 32);
    let left = Math.min(Math.max(rect.left, 16), window.innerWidth - tipWidth - 16);
    tooltip.style.left = `${Math.max(left, 16)}px`;
  }

  function goTo(index) {
    if (index < 0) return;
    if (index >= TOUR_STEPS.length) {
      endTour();
      return;
    }
    stepIndex = index;
    const step = TOUR_STEPS[stepIndex];
    const el = resolveStep(step);

    overlay.querySelector('#tour-step-count').textContent = `Шаг ${stepIndex + 1} из ${TOUR_STEPS.length}`;
    overlay.querySelector('#tour-step-title').textContent = step.title;
    overlay.querySelector('#tour-step-text').textContent = el ? step.text : (step.fallbackText || step.text);
    overlay.querySelector('#tour-prev').disabled = stepIndex === 0;
    overlay.querySelector('#tour-next').textContent = stepIndex === TOUR_STEPS.length - 1 ? 'Готово' : 'Далее →';

    positionFor(el);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function startTour() {
    if (overlay) return;
    buildOverlay();
    stepIndex = 0;
    goTo(0);
    resizeHandler = () => {
      const step = TOUR_STEPS[stepIndex];
      positionFor(resolveStep(step));
    };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('scroll', resizeHandler, true);
  }

  function endTour() {
    if (!overlay) return;
    window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('scroll', resizeHandler, true);
    closeMoreMenu();
    overlay.remove();
    overlay = null;
    spotlight = null;
    tooltip = null;
  }

  btn.addEventListener('click', startTour);
})();
