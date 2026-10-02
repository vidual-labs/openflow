import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { formatServerDate } from '../utils/dates';
import { PageHeader, Alert } from '../components/AdminUI';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');

  useEffect(() => {
    loadUsers();
    api.me().then(d => setCurrentUser(d.user)).catch(() => {});
  }, []);

  async function loadUsers() {
    try {
      const data = await api.getUsers();
      setUsers(data.users);
    } catch (err) {
      // Not admin - hide page
      setUsers([]);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createUser({ email, password, role });
      setEmail('');
      setPassword('');
      setRole('user');
      setShowForm(false);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this user?')) return;
    try {
      await api.deleteUser(id);
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleRole(user) {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    if (!confirm(`Make "${user.email}" ${newRole === 'admin' ? 'an admin' : 'a regular user'}? They will be logged out of all sessions.`)) return;
    try {
      await api.updateUser(user.id, { role: newRole });
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleResetTwoFactor(user) {
    if (!confirm(`Turn off two-factor login for "${user.email}"? Use this when they have lost access to their mailbox. They will be notified by e-mail.`)) return;
    try {
      await api.updateUser(user.id, { twoFactor: false });
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRevokeSessions(user) {
    if (!confirm(`Log "${user.email}" out of all existing sessions? Their remembered browsers are forgotten too.`)) return;
    try {
      await api.revokeUserSessions(user.id);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <PageHeader title="Users">
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add User'}
        </button>
      </PageHeader>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={handleCreate}>
            <div className="user-create-grid" style={{ display: 'grid', gap: 12, alignItems: 'end' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>Email</label>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" required />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>Password</label>
                <input className="input" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 10 characters" required minLength={10} maxLength={72} autoComplete="new-password" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>Role</label>
                <select className="input" value={role} onChange={e => setRole(e.target.value)}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button className="btn btn-primary" type="submit" style={{ height: 44 }}>Create</button>
            </div>
            <Alert type="error" style={{ marginTop: 8, marginBottom: 0 }}>{error}</Alert>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
        <table className="table table-cards">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>2FA</th>
              <th>Created</th>
              <th style={{ width: 300 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td className="cell-primary">{user.email}</td>
                <td data-label="Role">
                  <span className={`badge ${user.role === 'admin' ? 'badge-published' : 'badge-draft'}`}>
                    {user.role || 'user'}
                  </span>
                </td>
                <td data-label="2FA">
                  <span className={`badge ${user.twoFactorEnabled ? 'badge-published' : 'badge-draft'}`}>
                    {user.twoFactorEnabled ? 'on' : 'off'}
                  </span>
                </td>
                <td data-label="Created" style={{ fontSize: 13, color: 'var(--text-light)' }}>{formatServerDate(user.created_at)}</td>
                <td className="cell-actions">
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => toggleRole(user)} title="Toggle role">
                      {user.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleRevokeSessions(user)} title="Invalidate this user's existing login sessions">
                      Log out everywhere
                    </button>
                    {user.twoFactorEnabled && currentUser?.id !== user.id && (
                      <button className="btn btn-sm btn-secondary" onClick={() => handleResetTwoFactor(user)} title="Turn off this user's two-factor login (lost mailbox)">
                        Reset 2FA
                      </button>
                    )}
                    {currentUser?.id !== user.id && (
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(user.id)}>Delete</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
