import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [forms, setForms] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.getForms().then(d => setForms(d.forms));
  }, []);

  async function createForm() {
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
  }

  async function deleteForm(id) {
    if (!confirm('Are you sure you want to delete this form?')) return;
    await api.deleteForm(id);
    setForms(forms.filter(f => f.id !== id));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2>Forms</h2>
        <button className="btn btn-primary" onClick={createForm}>+ New Form</button>
      </div>

      {forms.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <h3 style={{ marginBottom: 8 }}>No forms yet</h3>
          <p style={{ color: '#636E72', marginBottom: 24 }}>Create your first lead generation form.</p>
          <button className="btn btn-primary" onClick={createForm}>Create Form</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
                  <td style={{ fontSize: 13, color: '#636E72' }}>{new Date(form.created_at).toLocaleDateString('en')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/forms/${form.id}/submissions`} className="btn btn-sm btn-secondary" style={{ marginRight: 8, textDecoration: 'none' }}>
                      Responses
                    </Link>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteForm(form.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
