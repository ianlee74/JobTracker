import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseSkills } from './constants.js';

// Comma-delimited skills field with a multi-select dropdown of every skill
// previously recorded. Type freely in the box, or open ▾ and tick skills; the
// two stay in sync. The menu is rendered in a portal at fixed viewport
// coordinates so neither the table wrapper's scroll clipping nor the edit
// modal can misplace it. onChange(text, source) tells the caller whether the
// change was typed ("type") or picked from the menu ("pick"); onCommit fires
// when editing ends (focus leaves the control, or the menu closes).
export default function SkillsPicker({ value, onChange, knownSkills = [], inputClassName = '', placeholder, title, onCommit }) {
  // null = closed; when open, the fixed-position style of the menu.
  const [menuPos, setMenuPos] = useState(null);
  const [filter, setFilter] = useState('');
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const open = menuPos !== null;

  const selected = parseSkills(value);
  const selectedKeys = new Set(selected.map(s => s.toLowerCase()));
  const knownKeys = new Set(knownSkills.map(s => s.toLowerCase()));
  // Skills typed into the box that nobody has recorded before still get a
  // (ticked) row, so they can be unticked like any other.
  const listed = [...knownSkills, ...selected.filter(s => !knownKeys.has(s.toLowerCase()))];
  const query = filter.trim();
  const shown = listed.filter(s => s.toLowerCase().includes(query.toLowerCase()));
  const canAdd = query && !listed.some(s => s.toLowerCase() === query.toLowerCase());

  const inside = (node) => Boolean(node && (wrapRef.current?.contains(node) || menuRef.current?.contains(node)));

  const openMenu = () => {
    const r = wrapRef.current.getBoundingClientRect();
    // Open upward when there's no room below the field.
    const flip = r.bottom + 280 > window.innerHeight;
    setFilter('');
    setMenuPos({ left: r.left, minWidth: r.width, ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  };

  // Latest-closure ref so the document listeners below never call a stale onCommit.
  const closeMenu = useRef(null);
  closeMenu.current = () => {
    setMenuPos(null);
    onCommit?.();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!inside(e.target)) closeMenu.current(); };
    // A fixed-position menu doesn't follow its field — close on any scroll
    // outside the menu itself (capture catches the table wrapper's scrolling).
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) closeMenu.current(); };
    const onResize = () => closeMenu.current();
    const onKey = (e) => { if (e.key === 'Escape') closeMenu.current(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (skills) => onChange(skills.join(', '), 'pick');

  const toggle = (skill) => {
    const key = skill.toLowerCase();
    pick(selectedKeys.has(key) ? selected.filter(s => s.toLowerCase() !== key) : [...selected, skill]);
  };

  const addTyped = () => {
    if (!query) return;
    if (!selectedKeys.has(query.toLowerCase())) pick([...selected, query]);
    setFilter('');
  };

  return (
    <div className="skills-picker" ref={wrapRef}>
      <input
        type="text"
        className={inputClassName}
        placeholder={placeholder}
        title={title}
        value={value}
        onChange={e => onChange(e.target.value, 'type')}
        onBlur={e => { if (!open && !inside(e.relatedTarget)) onCommit?.(); }}
      />
      <button
        type="button"
        className="skills-picker-btn"
        title="Pick from previously entered skills"
        aria-label="Pick from previously entered skills"
        aria-expanded={open}
        onClick={() => (open ? closeMenu.current() : openMenu())}
      >
        ▾
      </button>
      {open && createPortal(
        <div className="skills-menu" style={menuPos} ref={menuRef}>
          <input
            autoFocus
            className="skills-menu-filter"
            placeholder={knownSkills.length ? 'Filter or add a skill…' : 'Add a skill…'}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault(); // never submit the surrounding form
                addTyped();
              }
            }}
          />
          <div className="skills-menu-list">
            {shown.map(s => (
              <label key={s} className="multi-select-option">
                <input type="checkbox" checked={selectedKeys.has(s.toLowerCase())} onChange={() => toggle(s)} />
                {s}
              </label>
            ))}
            {canAdd && (
              <button type="button" className="multi-select-option skills-menu-add" onClick={addTyped}>
                + Add "{query}"
              </button>
            )}
            {!shown.length && !canAdd && <div className="skills-menu-empty">No previously entered skills</div>}
          </div>
          <button type="button" className="multi-select-clear" disabled={!selected.length} onClick={() => pick([])}>
            Clear
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
