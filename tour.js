(function () {
  const TOUR_STEPS = [
    {
      selector: '.week-picker',
      title: 'Неделя',
      text: 'Переключайте недели стрелками ← → или выбором из списка. Все данные ниже — за выбранную неделю.',
    },
    {
      selector: '.toolbar__field--person',
      title: 'ФИО',
      text: 'Выберите себя из списка — появятся ваши таблицы задач за эту неделю.',
    },
    {
      selector: '#fill-indicator',
      title: 'Заполненность недели',
      text: 'Показывает, сколько часов из нормы 40 ч уже внесено.',
      fallbackText: 'После выбора ФИО здесь появится индикатор заполненности недели (0–40 ч).',
    },
    {
      selector: '#task-table',
      title: 'Остальные задачи',
      text: 'Здесь вы сами добавляете задачи: категория, название, часы по дням и комментарий.',
      fallbackText: 'После выбора ФИО появится таблица «Остальные задачи», где вы сами добавляете свои задачи.',
    },
    {
      selector: '#task-table thead th.col-final-task, #task-table thead th.col-status',
      title: 'Итоговое название и статус',
      text: 'Итоговое наименование и статус задачи задаёт руководитель — эти поля только для просмотра.',
      fallbackText: 'В таблице задач есть колонки «Итоговое наименование» и «Статус» — их заполняет руководитель, вам они доступны только для просмотра.',
    },
    {
      selector: '#btn-add',
      title: 'Добавить задачу',
      text: 'Выберите тип — категорию или «Проект» — и название (можно взять готовое из подсказок или ввести своё).',
    },
    {
      selector: '#btn-export',
      title: 'Экспорт CSV',
      text: 'Выгружает текущую неделю в CSV-файл.',
    },
    {
      selector: '#task-table thead th.col-task',
      title: 'Изменение ширины колонок',
      text: 'Потяните за правый край заголовка колонки, чтобы изменить её ширину — как в Excel. Текст в ячейках при этом переносится по строкам, а ширина запоминается.',
      fallbackText: 'В таблицах можно тянуть за правый край заголовка колонки, чтобы менять её ширину — как в Excel. Текст переносится по строкам, а ширина запоминается для следующих визитов.',
    },
    {
      selector: '#project-section',
      title: 'Проектные задачи',
      text: 'Здесь появляются ваши проекты — добавляйте их кнопкой «+ Задача» (тип «Проект») и вносите часы по дням.',
      fallbackText: 'Ниже ваших задач — блок «Проектные задачи»: добавляйте их кнопкой «+ Задача» (тип «Проект») и вносите часы.',
    },
    {
      selector: 'a[href="/login"]',
      title: 'Вход для руководителя',
      text: 'Здесь руководитель входит в админ-панель, чтобы проставить итоговые названия и статусы задач.',
    },
  ];

  const btn = document.getElementById('btn-tour');
  if (!btn) return;

  let overlay = null;
  let spotlight = null;
  let tooltip = null;
  let stepIndex = 0;
  let resizeHandler = null;

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !!el.offsetParent;
  }

  function resolveStep(step) {
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

    overlay.querySelector('#tour-skip').addEventListener('click', endTour);
    overlay.querySelector('#tour-prev').addEventListener('click', () => goTo(stepIndex - 1));
    overlay.querySelector('#tour-next').addEventListener('click', () => goTo(stepIndex + 1));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) endTour();
    });
  }

  function positionFor(el, step) {
    if (!el) {
      spotlight.classList.add('tour-spotlight--hidden');
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
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
    const placeBelow = spaceBelow > 200 || spaceBelow > rect.top;
    tooltip.style.transform = 'none';

    let top = placeBelow ? rect.bottom + pad + 12 : rect.top - pad - 12;
    if (!placeBelow) {
      tooltip.style.top = 'auto';
      tooltip.style.bottom = `${window.innerHeight - rect.top + pad + 12}px`;
    } else {
      tooltip.style.bottom = 'auto';
      tooltip.style.top = `${top}px`;
    }

    let left = Math.min(Math.max(rect.left, 16), window.innerWidth - 340);
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

    positionFor(el, step);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function startTour() {
    if (overlay) return;
    buildOverlay();
    stepIndex = 0;
    goTo(0);
    resizeHandler = () => {
      const step = TOUR_STEPS[stepIndex];
      positionFor(resolveStep(step), step);
    };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('scroll', resizeHandler, true);
  }

  function endTour() {
    if (!overlay) return;
    window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('scroll', resizeHandler, true);
    overlay.remove();
    overlay = null;
    spotlight = null;
    tooltip = null;
  }

  btn.addEventListener('click', startTour);
})();
