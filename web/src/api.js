async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    // Session gone (expired or signed out elsewhere) — let AuthGate flip the
    // app back to the sign-in screen.
    if (res.status === 401) window.dispatchEvent(new Event('jobtracker:unauthorized'));
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ---- Authentication & user management ----
export const fetchAuthConfig = () => request('/api/auth/config');
export const fetchMe = () => request('/api/me');
export const googleSignIn = (credential) =>
  request('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
export const signOut = () => request('/api/auth/logout', { method: 'POST' });
export const fetchUsers = () => request('/api/users');
export const addUser = (fields) =>
  request('/api/users', { method: 'POST', body: JSON.stringify(fields) });
export const updateUser = (id, fields) =>
  request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteUser = (id) =>
  request(`/api/users/${id}`, { method: 'DELETE' });

export const fetchJobs = (personId) =>
  request('/api/jobs' + (personId ? `?person=${personId}` : ''));
export const fetchStats = (personId) =>
  request('/api/stats' + (personId ? `?person=${personId}` : ''));
export const fetchMissingSkills = () => request('/api/missing-skills');
export const fetchPeople = () => request('/api/people');
export const addPerson = (name) =>
  request('/api/people', { method: 'POST', body: JSON.stringify({ name }) });
export const fetchJob = (id) => request(`/api/jobs/${id}`);
export const addJob = (job) =>
  request('/api/jobs', { method: 'POST', body: JSON.stringify(job) });
export const updateJob = (id, fields) =>
  request(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteJob = (id) =>
  request(`/api/jobs/${id}`, { method: 'DELETE' });
// A company's favorite / not_interested flags are per person, so company
// calls carry the selected person (the server pins a user to their own).
export const fetchCompanies = (personId) =>
  request('/api/companies' + (personId ? `?person=${personId}` : ''));
// Creates a company before any of its jobs are tracked; fields: { name, ...profile }.
export const addCompany = (fields, personId) =>
  request('/api/companies' + (personId ? `?person=${personId}` : ''), { method: 'POST', body: JSON.stringify(fields) });
export const updateCompany = (name, fields, personId) =>
  request(`/api/company?name=${encodeURIComponent(name)}${personId ? `&person=${personId}` : ''}`, { method: 'PATCH', body: JSON.stringify(fields) });
// Has Claude research a company on the web (slow — a minute or two). Resolves
// to proposed field values + a briefing; nothing is saved until the caller
// applies it with updateCompany.
export const researchCompany = (name) =>
  request(`/api/company/research?name=${encodeURIComponent(name)}`, { method: 'POST', body: '{}' });
// Stores a copy of a dropped File on the server machine (local-only app);
// resolves to { path, url } of the stored copy.
export const uploadPosting = (file) =>
  request(`/api/upload-posting?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
// Has Claude read a job posting (a stored file:// URL or an http(s) page) and
// propose the add-job form's fields (slow — tens of seconds). Nothing about
// the job is saved; a company the posting names that isn't tracked yet is
// added and researched in the background (company_status: 'created').
export const researchJob = (url, personId) =>
  request('/api/job/research' + (personId ? `?person=${personId}` : ''), { method: 'POST', body: JSON.stringify({ url }) });
// Whether the server has Anthropic API credentials (for Claude-backed actions).
export const fetchAiStatus = () => request('/api/ai-status');

// ---- Contacts (recruiters, hiring managers, interviewers) ----
export const fetchContacts = (company) =>
  request('/api/contacts' + (company ? `?company=${encodeURIComponent(company)}` : ''));
export const addContact = (fields) =>
  request('/api/contacts', { method: 'POST', body: JSON.stringify(fields) });
export const updateContact = (id, fields) =>
  request(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteContact = (id) =>
  request(`/api/contacts/${id}`, { method: 'DELETE' });

// ---- Interviews (the Interviews page for one job) ----
// The page's data: { job, company, interviews: [{ ..., attendees, questions }], types }.
export const fetchJobInterviews = (jobId) => request(`/api/jobs/${jobId}/interviews`);
export const addInterview = (jobId, fields) =>
  request(`/api/jobs/${jobId}/interviews`, { method: 'POST', body: JSON.stringify(fields) });
export const updateInterview = (id, fields) =>
  request(`/api/interviews/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteInterview = (id) =>
  request(`/api/interviews/${id}`, { method: 'DELETE' });
// Link another of the person's jobs that this interview also covers, or
// unlink one (the last job can't be); both resolve to the updated interview.
export const addInterviewJob = (id, jobId) =>
  request(`/api/interviews/${id}/jobs`, { method: 'POST', body: JSON.stringify({ job_id: jobId }) });
export const removeInterviewJob = (id, jobId) =>
  request(`/api/interviews/${id}/jobs/${jobId}`, { method: 'DELETE' });
// Attach an existing contact ({ contact_id }) or create one and attach it
// ({ contact: { name, ... } }); resolves to the updated interview.
export const addInterviewAttendee = (id, body) =>
  request(`/api/interviews/${id}/attendees`, { method: 'POST', body: JSON.stringify(body) });
export const removeInterviewAttendee = (id, contactId) =>
  request(`/api/interviews/${id}/attendees/${contactId}`, { method: 'DELETE' });
// Appends questions (strings, or { question, answer }); resolves to
// { added, questions } with the full list.
export const addInterviewQuestions = (id, questions, source = 'user') =>
  request(`/api/interviews/${id}/questions`, { method: 'POST', body: JSON.stringify({ questions, source }) });
export const reorderInterviewQuestions = (id, order) =>
  request(`/api/interviews/${id}/questions`, { method: 'PATCH', body: JSON.stringify({ order }) });
export const updateInterviewQuestion = (id, qid, fields) =>
  request(`/api/interviews/${id}/questions/${qid}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteInterviewQuestion = (id, qid) =>
  request(`/api/interviews/${id}/questions/${qid}`, { method: 'DELETE' });
// Has Claude propose questions for the interview (slow — a minute or so).
// Resolves to { questions: [{ question, why, topic }], sources }; nothing is saved.
export const generateInterviewQuestions = (id) =>
  request(`/api/interviews/${id}/generate`, { method: 'POST', body: '{}' });
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
// two model calls happen server-side before this resolves. `instructions` is
// the candidate's optional special guidance for this application.
export const generateDocuments = (id, instructions = '') =>
  request(`/api/jobs/${id}/generate`, { method: 'POST', body: JSON.stringify({ instructions }) });
export const documentUrl = (id, kind, download) =>
  `/api/document?job=${id}&kind=${kind}${download ? '&download=1' : ''}`;
// Deletes a job's documents (files + DB records) — one kind, or both when
// kind is omitted. Required before that document can be generated again.
export const deleteJobDocuments = (id, kind) =>
  request(`/api/jobs/${id}/documents${kind ? `?kind=${kind}` : ''}`, { method: 'DELETE' });
// Replaces a job's generated resume or cover letter with a hand-customized
// file; kind is 'resume' or 'cover_letter'.
export const uploadJobDocument = (id, kind, file) =>
  request(`/api/jobs/${id}/document?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
