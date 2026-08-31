const WEEK_STORAGE_KEY = 'timesheet-selected-week';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return toIsoDate(monday);
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addWeeks(weekStart, delta) {
  const date = parseIsoDate(weekStart);
  date.setDate(date.getDate() + delta * 7);
  return toIsoDate(date);
}

function formatWeekLabel(weekStart) {
  const mon = parseIsoDate(weekStart);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);

  const monStr = `${mon.getDate()} ${MONTHS_SHORT[mon.getMonth()]}`;
  const friStr = `${fri.getDate()} ${MONTHS_SHORT[fri.getMonth()]} ${fri.getFullYear()}`;
  return `${monStr} – ${friStr}`;
}

function isCurrentWeek(weekStart) {
  return weekStart === getCurrentWeekStart();
}

function getStoredWeek() {
  try {
    const stored = localStorage.getItem(WEEK_STORAGE_KEY);
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  } catch (_) {}
  return getCurrentWeekStart();
}

function storeWeek(weekStart) {
  try {
    localStorage.setItem(WEEK_STORAGE_KEY, weekStart);
  } catch (_) {}
}

function buildWeekOptions(selectedWeek, availableWeeks = []) {
  const weeks = new Set();
  const current = getCurrentWeekStart();

  for (let i = -8; i <= 8; i += 1) {
    weeks.add(addWeeks(current, i));
  }

  availableWeeks.forEach((item) => {
    if (item.week_start) weeks.add(item.week_start);
  });

  weeks.add(selectedWeek);

  return [...weeks].sort((a, b) => b.localeCompare(a));
}

function initWeekPicker({ selectEl, labelEl, prevBtn, nextBtn, onChange }) {
  let selectedWeek = getStoredWeek();
  let availableWeeks = [];

  function updateSelect() {
    const options = buildWeekOptions(selectedWeek, availableWeeks);
    selectEl.replaceChildren();

    options.forEach((week) => {
      const option = document.createElement('option');
      option.value = week;
      const suffix = isCurrentWeek(week) ? ' (текущая)' : '';
      const countItem = availableWeeks.find((w) => w.week_start === week);
      const countSuffix = countItem ? ` · ${countItem.task_count} задач` : '';
      option.textContent = `${formatWeekLabel(week)}${suffix}${countSuffix}`;
      if (week === selectedWeek) option.selected = true;
      selectEl.appendChild(option);
    });

    if (labelEl) {
      labelEl.textContent = formatWeekLabel(selectedWeek);
    }
  }

  async function refreshWeeksList() {
    try {
      availableWeeks = await api('/api/weeks');
    } catch (_) {
      availableWeeks = [];
    }
    updateSelect();
  }

  function setWeek(weekStart, reload = true) {
    selectedWeek = weekStart;
    storeWeek(selectedWeek);
    updateSelect();
    if (reload && onChange) onChange(selectedWeek);
  }

  selectEl.addEventListener('change', () => {
    setWeek(selectEl.value);
  });

  prevBtn.addEventListener('click', () => {
    setWeek(addWeeks(selectedWeek, -1));
  });

  nextBtn.addEventListener('click', () => {
    setWeek(addWeeks(selectedWeek, 1));
  });

  refreshWeeksList();

  return {
    getWeek: () => selectedWeek,
    setWeek: (week, reload = true) => setWeek(week, reload),
    refreshWeeksList,
  };
}
