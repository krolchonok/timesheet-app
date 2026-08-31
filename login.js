document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');

  errorEl.classList.add('hidden');
  errorEl.textContent = '';

  try {
    const user = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (user.role !== 'admin') {
      await api('/api/logout', { method: 'POST' });
      errorEl.textContent = 'Доступ только для администратора';
      errorEl.classList.remove('hidden');
      return;
    }

    window.location.href = '/admin';
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove('hidden');
  }
});

(async () => {
  try {
    const user = await api('/api/me');
    if (user.role === 'admin') {
      window.location.href = '/admin';
    }
  } catch (_) {}
})();
