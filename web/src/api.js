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
export const addJob = (job) =>
  request('/api/jobs', { method: 'POST', body: JSON.stringify(job) });
export const updateJob = (id, fields) =>
  request(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteJob = (id) =>
  request(`/api/jobs/${id}`, { method: 'DELETE' });
// Stores a copy of a dropped File on the server machine (local-only app);
// resolves to { path, url } of the stored copy.
export const uploadPosting = (file) =>
  request(`/api/upload-posting?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
// Directory listing from the server machine for the in-app file picker;
// no dir means the server's home directory.
export const browseDir = (dir) =>
  request('/api/browse' + (dir ? `?dir=${encodeURIComponent(dir)}` : ''));
