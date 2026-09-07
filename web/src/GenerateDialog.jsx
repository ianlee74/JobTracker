import React, { useEffect, useRef, useState } from 'react';

const DOC_LABELS = { resume: 'resume', cover_letter: 'cover letter' };

// The step between clicking ✨ and generating: asks the candidate for any
// special instructions for this one application (what to emphasize, tone, a
// particular experience to foreground) before the model writes anything. The
// text becomes guidance inside the generation prompt — it steers the
// documents rather than appearing in them — and leaving it blank generates
// with the standard instructions alone.
export default function GenerateDialog({ job, onGenerate, onClose }) {
  const [instructions, setInstructions] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const docKinds = (job.doc_kinds || '').split(',').filter(Boolean);
  const missing = ['resume', 'cover_letter'].filter(k => !docKinds.includes(k));
  const what = missing.length === 2
    ? 'a tailored resume and cover letter'
    : `the missing ${DOC_LABELS[missing[0]] || 'document'}`;

  const handleSubmit = (e) => {
    e.preventDefault();
    onGenerate(instructions.trim());
  };

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form className="add-job-form generate-form" onSubmit={handleSubmit}>
        <div className="form-title">Generate {what}</div>
        <div className="settings-hint generate-job">
          {job.title} at {job.company}
        </div>
        <div className="form-grid">
          <label className="span-2">
            Special instructions for this application (optional)
            <textarea
              ref={textareaRef}
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder={'e.g. Lead with the platform-migration work; play down the management years; the recruiter said they care most about Kubernetes; keep the cover letter warm but brief.'}
              rows={5}
            />
            <span className="settings-hint">
              Anything you want steering these documents: what to emphasize or leave out, tone, a project to foreground, what a recruiter told you. It shapes how the documents are written and is never pasted into them. Leave blank to use the standard instructions alone.
            </span>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-btn">✨ Generate</button>
          <button type="button" className="clear-btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
