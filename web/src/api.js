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

export const fetchJobs = (personId) =>
  request('/api/jobs' + (personId ? `?person=${personId}` : ''));
export const fetchStats = (personId) =>
  request('/api/stats' + (personId ? `?person=${personId}` : ''));
export const fetchPeople = () => request('/api/people');
export const addPerson = (name) =>
  request('/api/people', { method: 'POST', body: JSON.stringify({ name }) });
export const addJob = (job) =>
  request('/api/jobs', { method: 'POST', body: JSON.stringify(job) });
export const updateJob = (id, fields) =>
  request(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteJob = (id) =>
  request(`/api/jobs/${id}`, { method: 'DELETE' });
export const fetchCompanies = () => request('/api/companies');
export const updateCompany = (name, fields) =>
  request(`/api/company?name=${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(fields) });
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
// Document-generation settings are per person.
export const fetchSettings = (personId) => request(`/api/settings?person=${personId}`);
// Stores/overwrites the server's managed snapshot of the person's standard
// resume and points their resume_path setting at it; resolves to
// { path, ...settings }.
export const uploadResumeFile = (personId, file) =>
  request(`/api/settings/resume-file?person=${personId}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
export const saveSettings = (personId, fields) =>
  request(`/api/settings?person=${personId}`, { method: 'PATCH', body: JSON.stringify(fields) });
// Generates the tailored resume + cover letter for one job. Slow (minutes) —
// two model calls happen server-side before this resolves.
export const generateDocuments = (id, opts = {}) =>
  request(`/api/jobs/${id}/generate`, { method: 'POST', body: JSON.stringify(opts) });
export const documentUrl = (id, kind, download) =>
  `/api/document?job=${id}&kind=${kind}${download ? '&download=1' : ''}`;
