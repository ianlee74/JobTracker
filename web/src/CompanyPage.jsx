import React, { useEffect, useRef, useState } from 'react';
import { COMPANY_TYPES, EMPLOYEE_COUNTS, STATUS_COLORS, formatSalaryRange, jobHref, parseNames } from './constants.js';
import { researchCompany } from './api.js';

// One proposed field in the research preview: the researched value next to
// what is saved now, so the change is visible before it is applied.
function ProposedField({ label, proposed, current }) {
  const changed = Boolean(proposed) && proposed !== (current || '');
  return (
    <div className="research-field">
      <span className="research-field-label">{label}</span>
      <span className={changed ? 'research-field-new' : ''}>{proposed || <em>not found</em>}</span>
      {changed && current && <span className="research-field-old">was: {current}</span>}
    </div>
  );
}

// The result of "Research with Claude": proposed website / type / employee
// count, the briefing that would be appended to the notes, and its sources.
// Nothing is saved until Apply.
function ResearchPreview({ research, onApply, onDiscard }) {
  return (
    <div className="research-preview">
      <div className="research-preview-title">
        ✨ Claude's research
        {research.confidence !== 'high' && (
          <span className="research-confidence" title="How sure Claude is that it found the right company">
            {research.confidence} confidence
          </span>
        )}
      </div>
      <div className="research-fields">
        <ProposedField label="Website" proposed={research.website} current={research.current.website} />
        <ProposedField label="Company Type" proposed={research.company_type} current={research.current.company_type} />
        <ProposedField label="Employee Count" proposed={research.employee_count} current={research.current.employee_count} />
        {research.headquarters && <ProposedField label="Headquarters" proposed={research.headquarters} />}
        {research.founded && <ProposedField label="Founded" proposed={research.founded} />}
      </div>
      <div className="research-summary">{research.summary}</div>
      {research.sources.length > 0 && (
        <div className="research-sources">
          Sources:{' '}
          {research.sources.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">[{i + 1}]</a>
          ))}
        </div>
      )}
      <div className="research-actions">
        <button className="primary-btn" onClick={onApply}>Apply to fields</button>
        <button className="clear-btn" onClick={onDiscard}>Discard</button>
        <span className="hint">Apply sets the fields above and appends the briefing to Notes.</span>
      </div>
    </div>
  );
}

// Preset dropdown that still displays a custom stored value (e.g. free text
// saved through the MCP server) by listing it as an extra option.
function PresetSelect({ value, options, placeholder, onChange }) {
  const opts = value && !options.includes(value) ? [...options, value] : options;
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Info page for one company: website, free-form notes, referrals (who has
// referred the candidate to its jobs), the favorite star, the "Not Interested"
// flag, and the company's tracked jobs. Changes save automatically.
export default function CompanyPage({ company, jobs, onBack, onSave, isAdmin = true }) {
  const [website, setWebsite] = useState(company.website || '');
  const [note, setNote] = useState(company.note || '');
  const [referrals, setReferrals] = useState(company.referrals || '');
  const noteTimer = useRef(null);
  const [researching, setResearching] = useState(false);
  const [research, setResearch] = useState(null); // proposal awaiting Apply / Discard
  const [researchError, setResearchError] = useState(null);

  useEffect(() => {
    setWebsite(company.website || '');
    setNote(company.note || '');
    setReferrals(company.referrals || '');
    setResearch(null);
    setResearchError(null);
  }, [company.name]);

  // Ask Claude to research the company; the answer is shown as a proposal.
  const handleResearch = async () => {
    setResearching(true);
    setResearchError(null);
    setResearch(null);
    try {
      setResearch(await researchCompany(company.name));
    } catch (err) {
      setResearchError(err.message);
    } finally {
      setResearching(false);
    }
  };

  // Apply the proposal: researched values replace website / type / count
  // (blank ones leave the field alone) and the briefing is appended to the
  // notes — one save, with the local field state updated to match.
  const applyResearch = () => {
    const fields = {};
    for (const key of ['website', 'company_type', 'employee_count']) {
      if (research[key]) fields[key] = research[key];
    }
    clearTimeout(noteTimer.current);
    fields.note = note ? `${note}\n\n${research.note_section}` : research.note_section;
    if (fields.website) setWebsite(fields.website);
    setNote(fields.note);
    setResearch(null);
    onSave(fields);
  };

  // Referrals are also added automatically when a job's Referred-by is set;
  // pick those up unless the field is being edited right now.
  useEffect(() => {
    if (document.activeElement?.name !== 'referrals') setReferrals(company.referrals || '');
  }, [company.referrals]);

  const saveReferrals = () => {
    const tidy = parseNames(referrals).join(', ');
    setReferrals(tidy);
    if (tidy !== (company.referrals || '')) onSave({ referrals: tidy });
  };

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const saveNote = (text) => {
    if (text !== (company.note || '')) onSave({ note: text });
  };

  const handleNoteChange = (e) => {
    const text = e.target.value;
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => saveNote(text), 800);
  };

  const companyJobs = [...jobs].sort((a, b) => b.date_found.localeCompare(a.date_found));

  return (
    <div className="company-page">
      <button className="clear-btn back-btn" onClick={onBack}>← Back to jobs</button>

      <div className="company-card">
        <div className="company-header">
          <h2>
            <button
              className={`fav-toggle${company.favorite ? ' is-favorite' : ''}`}
              onClick={() => onSave({ favorite: !company.favorite })}
              title={company.favorite ? 'Remove from favorites' : 'Mark as favorite — its jobs are listed first'}
              aria-label={company.favorite ? 'Remove from favorites' : 'Mark as favorite'}
            >
              {company.favorite ? '★' : '☆'}
            </button>
            {company.name}
          </h2>
          {isAdmin && (
            <div className="company-header-actions">
              <button
                className="clear-btn research-btn"
                onClick={handleResearch}
                disabled={researching}
                title="Have Claude search the web for this company and propose values for the fields below"
              >
                {researching ? '⏳ Researching…' : '✨ Research with Claude'}
              </button>
              <label className="checkbox-label ni-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(company.not_interested)}
                  onChange={e => onSave({ not_interested: e.target.checked })}
                />
                Not Interested
              </label>
            </div>
          )}
        </div>
        {Boolean(company.not_interested) && (
          <div className="ni-notice">Jobs from this company are hidden from the job list by default.</div>
        )}
        {researching && (
          <div className="research-progress">Claude is searching the web for {company.name} — this usually takes a minute or two.</div>
        )}
        {researchError && <div className="error-banner research-error">{researchError}</div>}
        {research && (
          <ResearchPreview research={research} onApply={applyResearch} onDiscard={() => setResearch(null)} />
        )}
        {isAdmin ? (
          <div className="company-fields">
            <div className="company-fields-row">
              <label>
                Company Type
                <PresetSelect
                  value={company.company_type || ''}
                  options={COMPANY_TYPES}
                  placeholder="Unknown"
                  onChange={company_type => onSave({ company_type })}
                />
              </label>
              <label>
                Employee Count
                <PresetSelect
                  value={company.employee_count || ''}
                  options={EMPLOYEE_COUNTS}
                  placeholder="Unknown"
                  onChange={employee_count => onSave({ employee_count })}
                />
              </label>
            </div>
            <label>
              Website
              <input
                value={website}
                onChange={e => setWebsite(e.target.value)}
                onBlur={() => { if (website !== (company.website || '')) onSave({ website }); }}
                placeholder="https://..."
              />
            </label>
            <label>
              Referrals
              <input
                name="referrals"
                value={referrals}
                onChange={e => setReferrals(e.target.value)}
                onBlur={saveReferrals}
                placeholder="People who have referred you to this company's jobs — comma separated"
                title="Offered as a drop-down for Referred by on this company's jobs. A new Referred-by name is added here automatically."
              />
            </label>
            <label>
              Notes
              <textarea
                value={note}
                onChange={handleNoteChange}
                onBlur={() => { clearTimeout(noteTimer.current); saveNote(note); }}
                placeholder="Anything worth remembering about this company — culture, contacts, interview history..."
              />
            </label>
          </div>
        ) : (
          // Read-only company info for non-admins (they can still favorite it).
          <div className="company-fields company-fields-readonly">
            {(company.company_type || company.employee_count) && (
              <div className="company-fields-row">
                {company.company_type && <div><strong>Type:</strong> {company.company_type}</div>}
                {company.employee_count && <div><strong>Employees:</strong> {company.employee_count}</div>}
              </div>
            )}
            {company.website && (
              <div><strong>Website:</strong> <a href={company.website} target="_blank" rel="noopener noreferrer">{company.website}</a></div>
            )}
            {company.referrals && <div><strong>Referrals:</strong> {company.referrals}</div>}
            {company.note && <div className="note-readonly">{company.note}</div>}
          </div>
        )}
      </div>

      <div className="company-jobs">
        <div className="company-jobs-title">
          {companyJobs.length} tracked job{companyJobs.length === 1 ? '' : 's'}
        </div>
        {companyJobs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '12%' }}>Found</th>
                  <th style={{ width: '36%' }}>Title</th>
                  <th style={{ width: '12%' }}>Level</th>
                  <th style={{ width: '14%' }}>Salary</th>
                  <th style={{ width: '13%' }}>Status</th>
                  <th style={{ width: '13%' }}>Referred by</th>
                </tr>
              </thead>
              <tbody>
                {companyJobs.map(job => (
                  <tr key={job.id}>
                    <td className="cell-date">{job.date_found}</td>
                    <td className="cell-title">
                      <a href={jobHref(job.url)} target="_blank" rel="noopener noreferrer">{job.title}</a>
                    </td>
                    <td>{job.level}</td>
                    <td>{formatSalaryRange(job) ?? job.salary}</td>
                    <td style={{ color: STATUS_COLORS[job.status] || 'inherit', fontWeight: 600 }}>{job.status}</td>
                    <td>{job.referred_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
