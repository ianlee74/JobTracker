import React, { useEffect, useState } from 'react';
import { fetchUsers, addUser, updateUser, deleteUser } from './api.js';
import { useUser } from './AuthGate.jsx';

// Admin-only management of who can sign in: invite an email, set its role,
// and link 'user' accounts to the person whose jobs they see.
export default function UsersDialog({ people, onClose }) {
  const me = useUser();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [personId, setPersonId] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    try {
      setUsers(await fetchUsers());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addUser({
        email: email.trim(),
        role,
        person_id: role === 'user' && personId ? Number(personId) : null
      });
      setEmail('');
      setPersonId('');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleChange = async (id, fields) => {
    setError(null);
    try {
      await updateUser(id, fields);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Remove access for ${user.email}?`)) return;
    setError(null);
    try {
      await deleteUser(user.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="add-job-form users-dialog">
        <div className="form-title">Users</div>
        {error && <div className="error-banner">{error}</div>}

        {users === null ? 'Loading…' : (
          <table className="users-table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Sees jobs of</th><th>Last sign-in</th><th></th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    {u.picture && <img className="user-pic" src={u.picture} alt="" referrerPolicy="no-referrer" />}
                    {u.email}{u.id === me.id ? ' (you)' : ''}
                  </td>
                  <td>
                    <select
                      value={u.role}
                      disabled={u.id === me.id}
                      onChange={e => handleChange(u.id, { role: e.target.value })}
                    >
                      <option value="admin">admin</option>
                      <option value="user">user</option>
                    </select>
                  </td>
                  <td>
                    {u.role === 'admin' ? <span className="hint">everyone</span> : (
                      <select
                        value={u.person_id ?? ''}
                        onChange={e => handleChange(u.id, { person_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">— not linked —</option>
                        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="hint">{u.last_login_at ? u.last_login_at.slice(0, 10) : 'never'}</td>
                  <td>
                    {u.id !== me.id && (
                      <button className="delete-btn" title={`Remove access for ${u.email}`} onClick={() => handleDelete(u)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="hint">No users yet — invite the first one below.</td></tr>
              )}
            </tbody>
          </table>
        )}

        <form className="invite-row" onSubmit={handleInvite}>
          <input
            type="email"
            required
            placeholder="email@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          {role === 'user' && (
            <select value={personId} onChange={e => setPersonId(e.target.value)}>
              <option value="">Link to person…</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button type="submit" className="primary-btn" disabled={saving || !email.trim()}>
            {saving ? 'Inviting…' : 'Invite'}
          </button>
        </form>
        <div className="settings-hint">
          Invited people sign in with Google using this email. A <em>user</em> sees only the linked person's jobs; an <em>admin</em> sees and manages everything.
        </div>

        <div className="form-actions">
          <button type="button" className="clear-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
