import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, Alert, EmptyState, Loading } from '../components/AdminUI';

export default function Dashboard() {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cloningId, setCloningId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.getForms()
      .then(d => setForms(d.forms))
      .catch(err => setError(err.message || 'Failed to load forms'))
      .finally(() => setLoading(false));
  }, []);

  async function createForm() {
    try {
      const { form } = await api.createForm({
        title: 'New Form',
        steps: [
          { id: 'name', type: 'text', question: 'What is your name?', label: 'Name', required: true, placeholder: 'First and last name' },
          { id: 'email', type: 'email', question: 'What is your email address?', label: 'Email', required: true },
          { id: 'interest', type: 'select', question: 'What are you interested in?', label: 'Interest', required: true, options: ['Product A', 'Product B', 'Consulting', 'Other'] },
        ],
        end_screen: { title: 'Thank you!', message: 'We will get back to you shortly.' },
      });
      navigate(`/forms/${form.id}`);
    } catch (err) {
      setError(err.message || 'Failed to create form');
    }
  }

  async function cloneForm(id) {
    setError('');
    setCloningId(id);
    try {
      const { form } = await api.cloneForm(id);
      setForms(prev => [form, ...prev]);
    } catch (err) {
      setError(err.message || 'Failed to clone form');
    } finally {
      setCloningId(null);
    }
  }

  async function deleteForm(id) {
    const form = forms.find(f => f.id === id);
    if (!form) return;
    if (form.published) {
      const input = prompt(`This form is live. To delete it, type the form name: "${form.title}"`);
      if (input !== form.title) {
        if (input !== null) alert('Form name did not match. Deletion cancelled.');
        return;
      }
    } else {
      if (!confirm('Are you sure you want to delete this form?')) return;
    }
    try {
      await api.deleteForm(id);
      setForms(forms.filter(f => f.id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete form');
    }
  }

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Forms">
        <button className="btn btn-primary" onClick={createForm}>+ New Form</button>
      </PageHeader>

      <Alert type="error">{error}</Alert>

      {forms.length === 0 ? (
        <EmptyState title="No forms yet" message="Create your first lead generation form.">
          <button className="btn btn-primary" onClick={createForm}>Create Form</button>
        </EmptyState>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Responses</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {forms.map(form => (
                  <tr key={form.id}>
                    <td>
                      <Link to={`/forms/${form.id}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>
                        {form.title}
                      </Link>
                    </td>
                    <td>
                      <span className={`badge ${form.published ? 'badge-published' : 'badge-draft'}`}>
                        {form.published ? 'Live' : 'Draft'}
                      </span>
                    </td>
                    <td>{form.submission_count}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-light)' }}>{new Date(form.created_at).toLocaleDateString('en')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <Link to={`/forms/${form.id}/submissions`} className="btn btn-sm btn-secondary" style={{ textDecoration: 'none' }}>
                          Responses
                        </Link>
                        <button className="btn btn-sm btn-secondary" onClick={() => cloneForm(form.id)} disabled={cloningId === form.id}>
                          {cloningId === form.id ? 'Duplicating…' : 'Duplicate'}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteForm(form.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
