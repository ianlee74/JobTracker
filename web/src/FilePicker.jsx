import React, { useEffect, useState } from 'react';
import { browseDir } from './api.js';

// In-app file browser backed by the server's /api/browse (the server runs on
// this machine, so it can list the real filesystem — browsers can't).
export default function FilePicker({ onPick, onClose, onDropFile }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onDropFile(file);
    }
  };

  const load = async (dir) => {
    try {
      setListing(await browseDir(dir));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(undefined); }, []);

  return (
    <div
      className="modal-backdrop picker-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="file-picker">
        <div className="picker-header">
          <div className="picker-title">Choose a file</div>
          <button type="button" className="clear-btn" onClick={onClose}>✕</button>
        </div>
        {listing && (
          <>
            <div className="picker-roots">
              {listing.roots.map(r => (
                <button
                  key={r}
                  type="button"
                  className={`picker-root ${listing.dir.toLowerCase().startsWith(r.toLowerCase()) ? 'active' : ''}`}
                  onClick={() => load(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="picker-path" title={listing.dir}>{listing.dir}</div>
          </>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="picker-list">
          {!listing && !error && <div className="picker-empty">Loading…</div>}
          {listing?.parent != null && (
            <button type="button" className="picker-entry" onClick={() => load(listing.parent)}>
              ⬑ ‥ (up)
            </button>
          )}
          {listing?.entries.map(e => (
            <button
              key={e.path}
              type="button"
              className="picker-entry"
              onClick={() => (e.type === 'dir' ? load(e.path) : onPick(e.path))}
            >
              {e.type === 'dir' ? '📁' : '📄'} {e.name}
            </button>
          ))}
          {listing && !listing.entries.length && <div className="picker-empty">Empty folder</div>}
        </div>
        <div className={`picker-drop ${dragOver ? 'drag-over' : ''}`} {...dropProps}>
          …or drag &amp; drop a file here from File Explorer
        </div>
      </div>
    </div>
  );
}
