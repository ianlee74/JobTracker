async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const fetchJobs = () => request('/api/jobs');
export const fetchStats = () => request('/api/stats');
export const updateJob = (id, fields) =>
  request(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteJob = (id) =>
  request(`/api/jobs/${id}`, { method: 'DELETE' });
