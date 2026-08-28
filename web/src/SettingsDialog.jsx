import React, { useEffect, useState } from 'react';
import { fetchSettings, saveSettings, uploadResumeFile } from './api.js';
import { supportsFilePicker, saveResumeLink, getResumeLink, clearResumeLink, syncResumeFromLink } from './resumeLink.js';

// Settings store plain paths, not file:// URLs; strip the scheme if one was
// pasted (Node handles forward or back slashes either way).
const cleanPath = (s) => {
  const p = s.trim().replace(/^file:\/\/\//, '');
  try { return decodeURI(p); } catch { return p; }
};

const SYNC_MESSAGES = {
  synced: '✓ Snapshot refreshed from the original.',
  unchanged: '✓ Already up to date.',
  'no-link': 'No linked original — choose or drop the file again to link it.',
  'not-in-use': 'The configured resume is not the linked snapshot, so nothing was refreshed.',
  permission: 'The browser needs permission to re-read the original — click Refresh again and allow access.',
  unreadable: 'The original file could not be read (moved or deleted?).'
};

// Document-generation settings: the standard resume (the source of truth for
// tailored documents) and where per-job document folders are created. The
// Anthropic API key is deliberately not managed here — the server reads it
// from its environment.
//
// Choosing/dropping the resume uploads a snapshot the server can read, and —
// in browsers with the File System Access API — also stores a handle to the
// ORIGINAL file so the snapshot can be refreshed automatically before each
// generation instead of the user re-providing the file after every edit.
// Settings belong to one person (the one selected in the header); personName
// is shown so it's obvious whose resume is being configured.
export default function SettingsDialog({ personId, personName, onClose, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [name, setName] = useState(personName || '');
  const [resumePath, setResumePath] = useState('');
  const [documentsDir, setDocumentsDir] = useState('');
  const [link, setLink] = useState(null);
  const [syncMsg, setSyncMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSettings(personId)
      .then(s => {
        setSettings(s);
        setName(s.person_name);
        setResumePath(s.resume_path);
        setDocumentsDir(s.documents_dir);
      })
      .catch(err => setError(err.message));
    getResumeLink(personId).then(l => setLink(l || null));
  }, [personId]);

  const applyUpload = async (result, handle) => {
    setSettings(result);
    setResumePath(result.path);
    if (handle) {
      await saveResumeLink(personId, handle, result.path);
      setLink(await getResumeLink(personId));
    } else {
      await clearResumeLink(personId);
      setLink(null);
    }
  };

  // Native OS file dialog; keeps a handle to the original when possible.
  const handleChooseFile = async () => {
    setError(null);
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'Resume',
          accept: {
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/pdf': ['.pdf'],
            'text/markdown': ['.md'],
            'text/plain': ['.txt']
          }
        }]
      });
      setBusy(true);
      await applyUpload(await uploadResumeFile(personId, await handle.getFile()), handle);
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (item, file) => {
    setError(null);
    setBusy(true);
    try {
      // Must be requested synchronously inside the drop event; may be
      // unsupported (then we still get the file's content, just no link).
      let handle = null;
      try {
        if (item?.getAsFileSystemHandle) handle = await item.getAsFileSystemHandle();
      } catch { /* no handle — content-only drop */ }
      if (handle && handle.kind !== 'file') return;
      const f = handle ? await handle.getFile() : file;
      if (!f) return;
      await applyUpload(await uploadResumeFile(personId, f), handle);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setError(null);
    setSyncMsg(null);
    setBusy(true);
    try {
      const result = await syncResumeFromLink({ personId, interactive: true });
      setSyncMsg(SYNC_MESSAGES[result] || result);
      setSettings(await fetchSettings(personId));
      setLink(await getResumeLink(personId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const path = cleanPath(resumePath);
      await saveSettings(personId, { name, resume_path: path, documents_dir: cleanPath(documentsDir) });
      // A manually entered path replaces the managed snapshot — the stored
      // handle no longer describes what generation reads, so drop it.
      if (link && path !== link.managedPath) {
        await clearResumeLink(personId);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const dropProps = {
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      handleDrop(e.dataTransfer.items?.[0], e.dataTransfer.files?.[0]);
    }
  };

  const linkInUse = link && settings && settings.resume_path === link.managedPath;

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form className="add-job-form settings-form" onSubmit={handleSave}>
        <div className="form-title">Settings — {settings?.person_name ?? personName}</div>
        {error && <div className="error-banner">{error}</div>}
        {!settings && !error && <div className="picker-empty">Loading…</div>}
        {settings && (
          <div className="form-grid">
            <label className="span-2">
              Person name
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Who these jobs and this resume belong to"
              />
              <span className="settings-hint">
                The resume and documents folder below apply only to this person; every person has their own.
              </span>
            </label>
            <label className="span-2">
              Standard resume (PDF, Word, Markdown, or plain text)
              <div className="url-row" {...dropProps}>
                <input
                  value={resumePath}
                  onChange={e => setResumePath(e.target.value)}
                  placeholder="Choose your resume file, or drop it here"
                />
                {supportsFilePicker() && (
                  <button type="button" className="clear-btn browse-btn" onClick={handleChooseFile} disabled={busy} title="Pick the resume with the Windows file dialog">
                    {busy ? 'Working…' : 'Choose file…'}
                  </button>
                )}
              </div>
              <span className="settings-hint">
                The source of truth for generated documents — tailored resumes and cover letters never claim anything that isn't in it.
                With a Word (.docx) resume, generated documents are .docx files that mirror its formatting; other formats produce Markdown.
                {settings.resume_path && !settings.resume_exists && (
                  <span className="settings-warn"> ⚠ The saved path doesn't exist on the server machine.</span>
                )}
                {linkInUse && (
                  <span className="settings-ok"> ✓ Linked to your original “{link.name}” — the snapshot refreshes from it automatically before each generation.</span>
                )}
                {settings.resume_is_managed && !linkInUse && resumePath === settings.resume_path && (
                  <span className="settings-warn"> ⚠ This snapshot has no link to your original in this browser — edits to the original won't be picked up until you choose or drop the file again.</span>
                )}
                {settings.resume_is_snapshot && resumePath === settings.resume_path && (
                  <span className="settings-warn"> ⚠ This is a frozen copy stored by an old-style drop — choose or drop the file again so it can stay in sync with your original.</span>
                )}
                {syncMsg && <span className="settings-ok"> {syncMsg}</span>}
              </span>
              {linkInUse && (
                <button type="button" className="clear-btn refresh-btn" onClick={handleRefresh} disabled={busy}>
                  {busy ? 'Refreshing…' : '⟳ Refresh from original now'}
                </button>
              )}
            </label>
            <label className="span-2">
              Documents folder
              <input
                value={documentsDir}
                onChange={e => setDocumentsDir(e.target.value)}
                placeholder={settings.documents_dir_effective}
              />
              <span className="settings-hint">
                Each job gets its own subfolder here for its generated files. Leave blank for the default: {settings.documents_dir_effective}
              </span>
            </label>
            <div className="span-2 settings-hint">
              Anthropic API credentials: {settings.api_credentials_found
                ? '✓ found in the server environment.'
                : <span className="settings-warn">⚠ not found — set ANTHROPIC_API_KEY in the server's environment and restart it before generating documents.</span>}
            </div>
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="primary-btn" disabled={saving || !settings}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" className="clear-btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
