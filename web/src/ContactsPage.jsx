import React, { useMemo, useState } from 'react';

// Add / edit form for one contact, in a modal. `contact` is null when adding
// (`initial` then pre-fills fields, e.g. the name typed in an attendee
// picker and the job's company). Errors from onSubmit show in the form.
export function ContactForm({ contact, initial = {}, companies = [], onSubmit, onDelete, onClose, isAdmin = true }) {
  const from = contact || initial;
  const [fields, setFields] = useState({
    name: from.name || '',
    title: from.title || '',
    company: from.company || '',
    email: from.email || '',
    phone: from.phone || '',
    linkedin: from.linkedin || '',
    note: from.note || ''
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setFields(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fields.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(fields);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="add-job-form contact-form" onSubmit={handleSubmit}>
        <div className="form-title">{contact ? `Edit: ${contact.name}` : 'Add contact'}</div>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-grid">
          <label>
            Name
            <input autoFocus value={fields.name} onChange={set('name')} placeholder="Full name" />
          </label>
          <label>
            Title
            <input value={fields.title} onChange={set('title')} placeholder="e.g. Senior Technical Recruiter" />
          </label>
          <label>
            Company
            <input list="contact-companies" value={fields.company} onChange={set('company')} placeholder="Where they work" />
            <datalist id="contact-companies">
              {companies.map(c => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label>
            Email
            <input type="email" value={fields.email} onChange={set('email')} placeholder="name@company.com" />
          </label>
          <label>
            Phone
            <input value={fields.phone} onChange={set('phone')} />
          </label>
          <label>
            LinkedIn
            <input value={fields.linkedin} onChange={set('linkedin')} placeholder="https://www.linkedin.com/in/…" />
          </label>
          <label className="span-2">
            Notes
            <textarea value={fields.note} onChange={set('note')} placeholder="Anything worth remembering — how you met, what they care about, follow-ups owed" />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-btn" disabled={saving || !fields.name.trim()}>
            {saving ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}
          </button>
          <button type="button" className="clear-btn" onClick={onClose}>Cancel</button>
          {contact && isAdmin && onDelete && (
            <button
              type="button"
              className="clear-btn contact-delete-btn"
              onClick={() => {
                if (window.confirm(`Delete ${contact.name}?${contact.interview_count ? `\n\nThey are listed as an attendee of ${contact.interview_count} interview${contact.interview_count === 1 ? '' : 's'}; they will be removed from those.` : ''}`)) onDelete(contact);
              }}
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// The Contacts view: everyone the candidate has met or will meet in their
// search — recruiters, hiring managers, interviewers — with where they work
// and how many interviews they've attended. Contacts are shared (like
// companies). Click a row to edit; company names open the company page.
export default function ContactsPage({ contacts, companies, isAdmin = true, onAdd, onSave, onDelete, onOpenCompany }) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const visible = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c => [c.name, c.title, c.company, c.email, c.note].some(v => (v || '').toLowerCase().includes(q)));
  }, [contacts, text]);

  const companyNames = useMemo(() => companies.map(c => c.name), [companies]);

  return (
    <div className="companies-page contacts-page">
      <div className="controls">
        <input
          type="text"
          placeholder="Filter by name, title, company…"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <span className="hint">
          {text.trim() ? `${visible.length} of ${contacts.length} shown · ` : `${contacts.length} contact${contacts.length === 1 ? '' : 's'} · `}
          Click a contact to edit.
        </span>
        <button className="add-job-btn add-company-btn" onClick={() => setAdding(true)} title="Add a contact">+ Add contact</button>
      </div>

      <div className="table-wrap">
        <table className="companies-table contacts-table">
          <thead>
            <tr>
              <th style={{ width: '20%' }}>Name</th>
              <th style={{ width: '20%' }}>Title</th>
              <th style={{ width: '16%' }}>Company</th>
              <th style={{ width: '18%' }}>Email</th>
              <th style={{ width: '12%' }}>Phone</th>
              <th style={{ width: '8%' }}>LinkedIn</th>
              <th style={{ width: '6%' }} title="Interviews attended">🎤</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td className="companies-empty" colSpan={7}>{contacts.length ? 'No contacts match the filter.' : 'No contacts yet — add the recruiters and interviewers you meet, or add them as attendees on an interview.'}</td></tr>
            )}
            {visible.map(c => (
              <tr key={c.id} className="contact-row" onClick={() => setEditing(c)} title="Edit this contact">
                <td className="cell-company">{c.name}</td>
                <td>{c.title || <span className="muted">—</span>}</td>
                <td>
                  {c.company
                    ? <button className="company-link" onClick={e => { e.stopPropagation(); onOpenCompany(c.company); }} title="Open company page">{c.company}</button>
                    : <span className="muted">—</span>}
                </td>
                <td className="cell-website">{c.email ? <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()}>{c.email}</a> : <span className="muted">—</span>}</td>
                <td>{c.phone || <span className="muted">—</span>}</td>
                <td className="cell-website">
                  {c.linkedin
                    ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={c.linkedin}>Profile ↗</a>
                    : <span className="muted">—</span>}
                </td>
                <td>{c.interview_count || <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <ContactForm
          companies={companyNames}
          onSubmit={async (fields) => { await onAdd(fields); setAdding(false); }}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <ContactForm
          contact={editing}
          companies={companyNames}
          isAdmin={isAdmin}
          onSubmit={async (fields) => { await onSave(editing.id, fields); setEditing(null); }}
          onDelete={async (contact) => { await onDelete(contact.id); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
