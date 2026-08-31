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

    window.location.href = user.role === 'admin' ? '/admin' : '/';
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove('hidden');
  }
});

(async () => {
  try {
    const user = await api('/api/me');
    window.location.href = user.role === 'admin' ? '/admin' : '/';
  } catch (_) {}
})();
