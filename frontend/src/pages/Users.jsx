import React, { useState, useEffect } from 'react';
import { api } from '../api';
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
    await api.updateUser(user.id, { role: newRole });
    loadUsers();
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, alignItems: 'end' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>Email</label>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" required />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label>Password</label>
                <input className="input" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} />
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

      <div className="card">
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.email}</td>
                <td>
                  <span className={`badge ${user.role === 'admin' ? 'badge-published' : 'badge-draft'}`}>
                    {user.role || 'user'}
                  </span>
                </td>
                <td style={{ fontSize: 13, color: 'var(--text-light)' }}>{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => toggleRole(user)} title="Toggle role">
                      {user.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
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
