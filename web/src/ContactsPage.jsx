import React, { useMemo, useRef, useState } from 'react';

// Where a contact's photo is served; the timestamp makes each version's URL
// unique, so the browser can cache it for good.
export const contactPhotoUrl = (contact) =>
  contact?.photo_updated_at ? `/api/contacts/${contact.id}/photo?v=${encodeURIComponent(contact.photo_updated_at)}` : null;

// A round headshot, or the contact's initials when they have no photo.
export function ContactAvatar({ contact, size = 28 }) {
  const url = contactPhotoUrl(contact);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (url) return <img className="contact-avatar" src={url} alt="" style={style} loading="lazy" />;
  const initials = (contact?.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  return <span className="contact-avatar contact-avatar-initials" style={style} aria-hidden="true">{initials || '?'}</span>;
}

// Photos are scaled down in the browser (a screenshot can be a whole screen)
// and stored as JPEG on a white background — plenty for a headshot.
const PHOTO_MAX_SIDE = 512;

function imageToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read')); };
    img.src = url;
  });
}

const imageFrom = (items) => Array.from(items || []).find(f => f.type?.startsWith('image/')) || null;

// The photo box on the contact form: paste a screenshot (Ctrl+V anywhere in
// the form, or the Paste button), drop an image on it, or choose a file.
// `src` is what to show; onPick gets a data: URL, onRemove clears it.
function PhotoPicker({ src, onPick, onRemove, onError }) {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const take = async (blob) => {
    if (!blob) return onError('No image found — copy a screenshot or image first');
    try { onPick(await imageToDataUrl(blob)); } catch (err) { onError(err.message); }
  };
  const pasteButton = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) return take(await item.getType(type));
      }
      take(null);
    } catch {
      onError('The browser blocked clipboard access — click in the form and press Ctrl+V instead');
    }
  };
  return (
    <div
      className={`contact-photo-picker${dragging ? ' dragging' : ''}`}
      onDragOver={e => { if (Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); take(imageFrom(e.dataTransfer.files)); }}
    >
      {src
        ? <img className="contact-photo-preview" src={src} alt="Contact photo" />
        : <div className="contact-photo-preview contact-photo-empty">No photo</div>}
      <div className="contact-photo-actions">
        <span className="hint">Paste a screenshot (Ctrl+V), drop an image here, or choose a file.</span>
        <div className="contact-photo-buttons">
          {navigator.clipboard?.read && <button type="button" className="clear-btn" onClick={pasteButton}>Paste</button>}
          <button type="button" className="clear-btn" onClick={() => fileRef.current?.click()}>Choose file…</button>
          {src && <button type="button" className="clear-btn" onClick={onRemove}>Remove</button>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => { take(e.target.files?.[0] || null); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}

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
  // undefined: keep the saved photo; null: remove it; a data: URL: replace it.
  const [photo, setPhoto] = useState(undefined);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setFields(f => ({ ...f, [key]: e.target.value }));
  const photoSrc = photo === undefined ? contactPhotoUrl(contact) : photo;

  // Ctrl+V of an image anywhere in the form sets the photo; pasting text into
  // a field works as usual.
  const handlePaste = (e) => {
    const image = imageFrom(e.clipboardData?.files);
    if (!image) return;
    e.preventDefault();
    setError(null);
    imageToDataUrl(image).then(setPhoto, err => setError(err.message));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fields.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(photo === undefined ? fields : { ...fields, photo });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="add-job-form contact-form" onSubmit={handleSubmit} onPaste={handlePaste}>
        <div className="form-title">{contact ? `Edit: ${contact.name}` : 'Add contact'}</div>
        {error && <div className="error-banner">{error}</div>}
        <PhotoPicker
          src={photoSrc}
          onPick={(url) => { setError(null); setPhoto(url); }}
          onRemove={() => setPhoto(null)}
          onError={setError}
        />
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
                <td className="cell-company"><span className="contact-name-cell"><ContactAvatar contact={c} />{c.name}</span></td>
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
