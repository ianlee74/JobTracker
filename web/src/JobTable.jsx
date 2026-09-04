import React, { useEffect, useRef, useState } from 'react';
import { STATUSES, STATUS_COLORS, LEVELS, REJECTION_REASONS, formatSalaryRange, jobHref, parseSkills } from './constants.js';
import { documentUrl } from './api.js';
import SkillsPicker from './SkillsPicker.jsx';

// Autosaving textarea bound to one of a job's note fields: `note` (the
// admin's) or `user_note` (the candidate's own).
function NoteInput({ job, field = 'note', placeholder = 'Add a note...', onUpdate }) {
  const [value, setValue] = useState(job[field] || '');
  const timer = useRef(null);
  const latest = useRef(value);
  const box = useRef(null);

  // Sync external note changes (edit modal, MCP refresh) — but never while the
  // user is typing here, so in-flight keystrokes aren't clobbered.
  useEffect(() => {
    if (document.activeElement !== box.current) {
      setValue(job[field] || '');
      latest.current = job[field] || '';
    }
  }, [job.id, job[field]]);

  const save = (text) => {
    if (text === job[field]) return;
    onUpdate(job.id, { [field]: text });
  };

  const handleChange = (e) => {
    const text = e.target.value;
    setValue(text);
    latest.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(latest.current), 800);
  };

  const handleBlur = () => {
    clearTimeout(timer.current);
    save(latest.current);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <textarea
      ref={box}
      className="note-input"
      placeholder={placeholder}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}

// The other party's note, shown but not editable (empty renders a dash).
function ReadOnlyNote({ text }) {
  return text
    ? <div className="note-readonly">{text}</div>
    : <div className="note-readonly note-empty">—</div>;
}

// Autosaving, comma-delimited list of the skills a "Not Qualified" job wanted
// that the candidate lacks; previously entered skills can be ticked from a
// multi-select menu. Typed text saves after a pause, picks save at once.
function MissingSkillsInput({ job, knownSkills, onUpdate, onDone }) {
  const stored = job.missing_skills || '';
  const [text, setText] = useState(stored);
  const timer = useRef(null);
  const latest = useRef(stored);
  const editing = useRef(false); // true between the first change and the commit

  // Sync external changes (edit modal, MCP refresh) — but never mid-edit, so
  // in-flight keystrokes aren't clobbered.
  useEffect(() => {
    if (!editing.current) {
      setText(stored);
      latest.current = stored;
    }
  }, [job.id, stored]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const save = (value) => {
    const skills = parseSkills(value).join(', ');
    if (skills !== (job.missing_skills || '')) onUpdate(job.id, { missing_skills: skills });
  };

  return (
    <SkillsPicker
      value={text}
      knownSkills={knownSkills}
      inputClassName="reason-input"
      placeholder="Missing skills, comma separated"
      title="Skills this job asked for that you don't have (comma separated)"
      onChange={(value, source) => {
        editing.current = true;
        setText(value);
        latest.current = value;
        clearTimeout(timer.current);
        if (source === 'pick') save(value);
        else timer.current = setTimeout(() => save(value), 800);
      }}
      onCommit={() => {
        clearTimeout(timer.current);
        save(latest.current);
        editing.current = false;
        onDone(job.id);
      }}
    />
  );
}

// Reason for "Not Moving Forward". Custom text is stored directly in
// rejection_reason; the select shows it as "Other" with the text box filled in.
// "Not Qualified" adds a third prompt for the missing skills. onDone fires
// once a reason is fully chosen (preset picked, or the custom text / missing
// skills committed) so a filtered view can stop holding the row on screen.
function RejectionReason({ job, knownSkills, onUpdate, onDone }) {
  const stored = job.rejection_reason || '';
  const isPreset = stored !== 'Other' && REJECTION_REASONS.includes(stored);
  const selectValue = !stored ? '' : isPreset ? stored : 'Other';
  const [text, setText] = useState(selectValue === 'Other' && stored !== 'Other' ? stored : '');
  const timer = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    if (document.activeElement !== box.current) {
      setText(stored && stored !== 'Other' && !REJECTION_REASONS.includes(stored) ? stored : '');
    }
  }, [job.id, stored]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const saveText = (value) => {
    const reason = value.trim() || 'Other';
    if (reason !== stored) onUpdate(job.id, { rejection_reason: reason });
  };

  const handleTextChange = (e) => {
    const value = e.target.value;
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveText(value), 800);
  };

  return (
    <div className="reason-wrap">
      <select
        className="reason-select"
        value={selectValue}
        onChange={e => {
          setText('');
          const value = e.target.value;
          onUpdate(job.id, { rejection_reason: value });
          if (value && value !== 'Other' && value !== 'Not Qualified') onDone(job.id);
        }}
        title="Why you're not moving forward"
      >
        <option value="">Why not?</option>
        {REJECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      {selectValue === 'Other' && (
        <input
          ref={box}
          className="reason-input"
          placeholder="Enter a reason..."
          value={text}
          onChange={handleTextChange}
          onBlur={() => {
            clearTimeout(timer.current);
            saveText(text);
            if (text.trim()) onDone(job.id);
          }}
        />
      )}
      {selectValue === 'Not Qualified' && (
        <MissingSkillsInput job={job} knownSkills={knownSkills} onUpdate={onUpdate} onDone={onDone} />
      )}
    </div>
  );
}

const DOC_LABELS = { resume: 'Resume', cover_letter: 'Cover letter' };

// One document's control: clicking the name opens a small menu with Open,
// Download, Upload replacement, and Delete. Delete removes just this
// document, freeing ✨ to regenerate it.
function DocMenu({ job, kind, onUpload, onDelete }) {
  // null = closed; when open, the fixed-position coordinates of the menu.
  // Fixed positioning escapes the table wrapper's scroll clipping, which
  // would otherwise cut the menu off on the last rows.
  const [menuPos, setMenuPos] = useState(null);
  const open = menuPos !== null;
  const wrapRef = useRef(null);
  const fileInput = useRef(null);
  const label = DOC_LABELS[kind] || kind;

  const toggle = () => {
    if (open) return setMenuPos(null);
    const r = wrapRef.current.getBoundingClientRect();
    // Open upward when there's no room below the button.
    const flip = r.bottom + 150 > window.innerHeight;
    setMenuPos({ left: r.left, ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setMenuPos(null);
    };
    const closeNow = () => setMenuPos(null);
    document.addEventListener('mousedown', close);
    // A fixed-position menu doesn't follow its button — close on any scroll
    // (capture catches the table wrapper's own scrolling) or resize.
    window.addEventListener('scroll', closeNow, true);
    window.addEventListener('resize', closeNow);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeNow, true);
      window.removeEventListener('resize', closeNow);
    };
  }, [open]);

  const closeMenu = () => setMenuPos(null);

  return (
    <span className="doc-menu-wrap" ref={wrapRef}>
      <button type="button" className="doc-menu-btn" onClick={toggle}>
        {label} <span className="multi-select-caret">▾</span>
      </button>
      {open && (
        <div className="doc-menu" style={menuPos}>
          <a
            className="doc-menu-item"
            href={documentUrl(job.id, kind)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
          >
            Open
          </a>
          <a className="doc-menu-item" href={documentUrl(job.id, kind, true)} onClick={closeMenu}>
            Download
          </a>
          <button
            type="button"
            className="doc-menu-item"
            onClick={() => {
              closeMenu();
              fileInput.current.value = ''; // re-selecting the same file still fires change
              fileInput.current.click();
            }}
          >
            Upload replacement…
          </button>
          <button
            type="button"
            className="doc-menu-item doc-menu-danger"
            onClick={() => {
              closeMenu();
              if (window.confirm(`Delete the ${label.toLowerCase()} for "${job.title}" at ${job.company}?\n\nYou can then generate a fresh one with ✨.`)) {
                onDelete(job, kind);
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".docx,.pdf,.md,.txt,.html"
        onChange={e => {
          const file = e.target.files[0];
          if (file) onUpload(job, kind, file);
        }}
      />
    </span>
  );
}

// A menu per generated document once any exist for a job.
function DocLinks({ job, onUpload, onDelete }) {
  const ORDER = ['resume', 'cover_letter'];
  const kinds = (job.doc_kinds || '').split(',').filter(Boolean)
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (!kinds.length) return null;
  return (
    <div className="doc-links">
      {kinds.map(kind => (
        <DocMenu key={kind} job={job} kind={kind} onUpload={onUpload} onDelete={onDelete} />
      ))}
    </div>
  );
}

// On wide screens each job renders as two rows: the note gets a full-width
// cell below Company → Status (Found/Title/Actions span both rows), so it has
// room to breathe. Narrow screens keep the single-row layout with a Note column.
function useWideLayout() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_LAYOUT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_LAYOUT_QUERY);
    const onChange = e => setWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

const WIDE_LAYOUT_QUERY = '(min-width: 1100px)';

function JobRow({ job, wide, isAdmin, knownSkills, onUpdate, onReasonDone, onDelete, onEdit, onOpenCompany, onGenerate, onUploadDocument, onDeleteDocuments, generating, companyNotInterested, companyFavorite }) {
  const color = STATUS_COLORS[job.status] || '#6b7280';
  const salaryFlagged = job.salary_confidence === 'flag';
  const salaryRange = formatSalaryRange(job);
  const span = wide ? 2 : undefined;
  const docKinds = (job.doc_kinds || '').split(',').filter(Boolean);
  const missingDocs = ['resume', 'cover_letter'].filter(k => !docKinds.includes(k));

  const mainRow = (
    <tr className={wide ? 'main-row' : undefined}>
      <td className="cell-date" rowSpan={span}>{job.date_found}</td>
      <td className="cell-title" rowSpan={span}>
        <a href={jobHref(job.url)} target="_blank" rel="noopener noreferrer">{job.title}</a>
        {job.fit && <div className="fit">{job.fit}</div>}
        <DocLinks job={job} onUpload={onUploadDocument} onDelete={onDeleteDocuments} />
      </td>
      <td>
        <button className="company-link" onClick={() => onOpenCompany(job.company)} title="Open company page">
          {job.company}
        </button>
        {companyFavorite && <span className="fav-badge" title="Favorite company — its jobs are listed first">★</span>}
        {companyNotInterested && <span className="ni-badge" title="Company marked Not Interested">🚫</span>}
      </td>
      <td>{job.category}</td>
      <td>
        {isAdmin ? (
          <select
            className="level-select"
            value={job.level || ''}
            onChange={e => onUpdate(job.id, { level: e.target.value })}
            title="Seniority level (auto-classified from the title; change if wrong)"
          >
            {job.level && !LEVELS.includes(job.level) && <option value={job.level}>{job.level}</option>}
            {!job.level && <option value="">—</option>}
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        ) : (job.level || '—')}
      </td>
      <td>
        <span title={salaryRange && job.salary && job.salary !== salaryRange ? `As listed: ${job.salary}` : undefined}>
          {salaryRange ?? job.salary}
        </span>
        {salaryFlagged && <span className="flag-badge" title="Salary not disclosed / inferred">?</span>}
      </td>
      <td>
        <select
          className="status-select"
          style={{ borderColor: color, color }}
          value={job.status}
          onChange={e => onUpdate(job.id, { status: e.target.value })}
        >
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {job.status === 'Not Moving Forward' && <RejectionReason job={job} knownSkills={knownSkills} onUpdate={onUpdate} onDone={onReasonDone} />}
      </td>
      {!wide && (
        <td>
          <NoteInput
            job={job}
            field={isAdmin ? 'note' : 'user_note'}
            placeholder={isAdmin ? 'Add a note...' : 'Add your note...'}
            onUpdate={onUpdate}
          />
        </td>
      )}
      <td className="cell-actions" rowSpan={span}>
        <button
          className={`edit-btn gen-btn ${generating ? 'busy' : ''}`}
          title={generating
            ? 'Generating documents… (this takes a few minutes)'
            : missingDocs.length === 0
              ? "This job already has both documents — delete one from its menu to regenerate it"
              : missingDocs.length === 2
                ? 'Generate a tailored resume & cover letter with Claude'
                : `Generate the missing ${DOC_LABELS[missingDocs[0]].toLowerCase()} with Claude`}
          disabled={generating || missingDocs.length === 0}
          onClick={() => onGenerate(job)}
        >
          {generating ? '⏳' : '✨'}
        </button>
        {isAdmin && (
          <button
            className="edit-btn"
            title="Edit this job"
            onClick={() => onEdit(job)}
          >
            ✎
          </button>
        )}
        {isAdmin && (
          <button
            className="delete-btn"
            title="Delete this job"
            onClick={() => {
              if (window.confirm(`Delete "${job.title}" at ${job.company}?`)) onDelete(job.id);
            }}
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );

  if (!wide) return mainRow;

  return (
    <React.Fragment>
      {mainRow}
      <tr className="note-row">
        <td colSpan={5}>
          <div className="note-pair">
            <div className="note-block">
              <div className="note-label">{isAdmin ? 'Notes' : 'Admin notes'}</div>
              {isAdmin
                ? <NoteInput job={job} field="note" onUpdate={onUpdate} />
                : <ReadOnlyNote text={job.note} />}
            </div>
            <div className="note-block">
              <div className="note-label">{isAdmin ? 'Candidate notes' : 'My notes'}</div>
              {isAdmin
                ? <ReadOnlyNote text={job.user_note} />
                : <NoteInput job={job} field="user_note" placeholder="Add your note..." onUpdate={onUpdate} />}
            </div>
          </div>
        </td>
      </tr>
    </React.Fragment>
  );
}

function SortableHeader({ label, sortKey, sort, onSort, width }) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th style={{ width }} className="sortable" onClick={() => onSort(sortKey)} title={`Sort by ${label}`}>
      {label}{arrow}
    </th>
  );
}

export default function JobTable({ jobs, sort, onSort, knownSkills = [], onUpdate, onReasonDone, onDelete, onEdit, onOpenCompany, onGenerate, onUploadDocument, onDeleteDocuments, generatingIds, flaggedCompanies, favoriteCompanies, isAdmin = true }) {
  const wide = useWideLayout();
  if (!jobs.length) {
    return <div className="empty-state">No jobs match the current filters.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableHeader label="Found" sortKey="date_found" sort={sort} onSort={onSort} width="8%" />
            <SortableHeader label="Title" sortKey="title" sort={sort} onSort={onSort} width={wide ? '26%' : '23%'} />
            <SortableHeader label="Company" sortKey="company" sort={sort} onSort={onSort} width={wide ? '13%' : '11%'} />
            <SortableHeader label="Category" sortKey="category" sort={sort} onSort={onSort} width={wide ? '12%' : '11%'} />
            <SortableHeader label="Level" sortKey="level" sort={sort} onSort={onSort} width="9%" />
            <SortableHeader label="Salary" sortKey="salary" sort={sort} onSort={onSort} width={wide ? '12%' : '11%'} />
            <SortableHeader label="Status" sortKey="status" sort={sort} onSort={onSort} width={wide ? '13%' : '10%'} />
            {!wide && <th style={{ width: '10%' }}>Note</th>}
            <th style={{ width: '7%' }}></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              wide={wide}
              isAdmin={isAdmin}
              knownSkills={knownSkills}
              onUpdate={onUpdate}
              onReasonDone={onReasonDone}
              onDelete={onDelete}
              onEdit={onEdit}
              onOpenCompany={onOpenCompany}
              onGenerate={onGenerate}
              onUploadDocument={onUploadDocument}
              onDeleteDocuments={onDeleteDocuments}
              generating={generatingIds.has(job.id)}
              companyNotInterested={flaggedCompanies.has(job.company)}
              companyFavorite={favoriteCompanies.has(job.company)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
