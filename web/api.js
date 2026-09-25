// Talks to the server's JSON API. Changes carry the x-tayyar-request header
// that the server requires, and a 401 anywhere brings up the sign-in form.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' };
  if (method !== 'GET') headers['x-tayyar-request'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/session') window.dispatchEvent(new CustomEvent('tayyar:signin'));
    throw new ApiError(res.status, data.error || res.statusText);
  }
  return data;
}
