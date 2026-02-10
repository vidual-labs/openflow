const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401 && !path.includes('/auth/')) {
    window.location.href = '/login';
    return;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  getForms: () => request('/forms'),
  getForm: (id) => request(`/forms/${id}`),
  createForm: (data) => request('/forms', { method: 'POST', body: JSON.stringify(data) }),
  updateForm: (id, data) => request(`/forms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteForm: (id) => request(`/forms/${id}`, { method: 'DELETE' }),

  getSubmissions: (formId, page = 1) => request(`/submissions/${formId}?page=${page}`),
  exportSubmissions: (formId) => `${BASE}/submissions/${formId}/export`,

  getPublicForm: (slug) => request(`/public/form/${slug}`),
  submitForm: (slug, data) => request(`/public/form/${slug}/submit`, { method: 'POST', body: JSON.stringify({ data }) }),
};
