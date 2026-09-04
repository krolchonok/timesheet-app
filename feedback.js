(function () {
  const SHORTCUT_HINT = 'Ctrl+Shift+M';

  let overlay = null;
  let lastPointerEl = null;
  let pendingElement = null;

  function cssEscape(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return `#${cssEscape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.classList?.length) {
        part += `.${[...node.classList].slice(0, 2).map(cssEscape).join('.')}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function describeElement(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.closest?.('.problem-modal-overlay, .tour-overlay')) return null;

    const tag = el.tagName.toLowerCase();
    const id = el.id || '';
    const classes = [...(el.classList || [])].slice(0, 6).join(' ');
    const field = el.dataset?.field || '';
    const name = el.getAttribute?.('name') || '';
    const role = el.getAttribute?.('role') || '';
    const text = String(el.innerText || el.value || el.getAttribute?.('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    const selector = buildSelector(el);
    const labelParts = [
      tag,
      id ? `#${id}` : '',
      field ? `[${field}]` : '',
      text ? `«${text}»` : '',
    ].filter(Boolean);

    return {
      tag,
      id,
      classes,
      field,
      name,
      role,
      text,
      selector,
      label: labelParts.join(' '),
    };
  }

  function captureTargetElement() {
    const selection = window.getSelection?.();
    if (selection && selection.rangeCount && !selection.isCollapsed) {
      const node = selection.anchorNode;
      const fromSelection = node?.nodeType === 1 ? node : node?.parentElement;
      const described = describeElement(fromSelection);
      if (described) return described;
    }

    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) {
      const described = describeElement(active);
      if (described) return described;
    }

    if (lastPointerEl && document.contains(lastPointerEl)) {
      return describeElement(lastPointerEl);
    }
    return null;
  }

  function currentContext() {
    const person = document.getElementById('person-select')?.value?.trim() || '';
    const week = document.getElementById('week-select')?.value?.trim() || '';
    return {
      fio: person,
      week_start: week,
      page_url: location.href,
      user_agent: navigator.userAgent,
    };
  }

  function ensureModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay problem-modal-overlay hidden';
    overlay.innerHTML = `
      <div class="modal problem-modal" role="dialog" aria-modal="true" aria-labelledby="problem-modal-title">
        <h3 class="modal__title" id="problem-modal-title">Сообщить о проблеме</h3>
        <p class="problem-modal__hint">Кратко опишите, что не так. Шорткат ${SHORTCUT_HINT} передаёт выделенный или активный элемент вместе с комментарием.</p>
        <div class="problem-modal__element hidden" id="problem-element-preview"></div>
        <label class="modal__field">
          <span>Комментарий</span>
          <textarea id="problem-comment" rows="4" placeholder="Что произошло?" required></textarea>
        </label>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost btn--small" id="problem-cancel">Отмена</button>
          <button type="button" class="btn btn--primary btn--small" id="problem-submit">Отправить</button>
        </div>
        <p class="problem-modal__status hidden" id="problem-status"></p>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector('#problem-cancel').addEventListener('click', closeModal);
    overlay.querySelector('#problem-submit').addEventListener('click', submitReport);
    overlay.querySelector('#problem-comment').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitReport();
      }
    });
    return overlay;
  }

  function renderElementPreview(element) {
    const box = overlay.querySelector('#problem-element-preview');
    if (!element) {
      box.classList.add('hidden');
      box.textContent = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `<strong>Элемент:</strong> <code></code>`;
    box.querySelector('code').textContent = element.label || element.selector || '—';
  }

  function openModal(options = {}) {
    ensureModal();
    pendingElement = options.element === undefined ? null : options.element;
    if (options.capture) {
      pendingElement = captureTargetElement();
    }
    renderElementPreview(pendingElement);
    const status = overlay.querySelector('#problem-status');
    status.classList.add('hidden');
    status.textContent = '';
    const comment = overlay.querySelector('#problem-comment');
    comment.value = options.comment || '';
    overlay.classList.remove('hidden');
    setTimeout(() => comment.focus(), 0);
  }

  function closeModal() {
    if (!overlay) return;
    overlay.classList.add('hidden');
    pendingElement = null;
  }

  async function submitReport() {
    const commentEl = overlay.querySelector('#problem-comment');
    const submitBtn = overlay.querySelector('#problem-submit');
    const status = overlay.querySelector('#problem-status');
    const comment = commentEl.value.trim();
    if (!comment) {
      status.classList.remove('hidden');
      status.textContent = 'Введите комментарий';
      commentEl.focus();
      return;
    }

    submitBtn.disabled = true;
    status.classList.add('hidden');
    try {
      await api('/api/problem-reports', {
        method: 'POST',
        body: JSON.stringify({
          comment,
          element: pendingElement,
          ...currentContext(),
        }),
      });
      closeModal();
      if (typeof alert === 'function') alert('Сообщение отправлено. Спасибо!');
    } catch (error) {
      status.classList.remove('hidden');
      status.textContent = error.message || 'Не удалось отправить';
    } finally {
      submitBtn.disabled = false;
    }
  }

  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.problem-modal-overlay')) return;
      lastPointerEl = target.closest('button, a, input, select, textarea, td, th, tr, .btn, [data-field], [role="menuitem"]') || target;
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
      closeModal();
      return;
    }
    const key = e.key?.toLowerCase();
    if (key === 'm' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const tag = e.target?.tagName?.toLowerCase();
      if ((tag === 'input' || tag === 'textarea' || tag === 'select') && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      openModal({ capture: true });
    }
  });

  const menuBtn = document.getElementById('btn-report-problem');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => openModal({ capture: false }));
    menuBtn.title = `Открыть форму (${SHORTCUT_HINT} — с выделенным элементом)`;
  }

  window.TimesheetFeedback = { open: openModal, capture: captureTargetElement };
})();
