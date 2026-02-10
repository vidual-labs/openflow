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
      title: 'Neues Formular',
      steps: [
        { id: 'name', type: 'text', question: 'Wie heissen Sie?', label: 'Name', required: true, placeholder: 'Vor- und Nachname' },
        { id: 'email', type: 'email', question: 'Wie lautet Ihre E-Mail-Adresse?', label: 'E-Mail', required: true },
        { id: 'interest', type: 'select', question: 'Wofuer interessieren Sie sich?', label: 'Interesse', required: true, options: ['Produkt A', 'Produkt B', 'Beratung', 'Sonstiges'] },
      ],
      end_screen: { title: 'Vielen Dank!', message: 'Wir melden uns in Kuerze bei Ihnen.' },
    });
    navigate(`/forms/${form.id}`);
  }

  async function deleteForm(id) {
    if (!confirm('Formular wirklich loeschen?')) return;
    await api.deleteForm(id);
    setForms(forms.filter(f => f.id !== id));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2>Formulare</h2>
        <button className="btn btn-primary" onClick={createForm}>+ Neues Formular</button>
      </div>

      {forms.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <h3 style={{ marginBottom: 8 }}>Noch keine Formulare</h3>
          <p style={{ color: '#636E72', marginBottom: 24 }}>Erstellen Sie Ihr erstes Lead-Gen Formular.</p>
          <button className="btn btn-primary" onClick={createForm}>Formular erstellen</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Titel</th>
                <th>Status</th>
                <th>Antworten</th>
                <th>Erstellt</th>
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
                      {form.published ? 'Live' : 'Entwurf'}
                    </span>
                  </td>
                  <td>{form.submission_count}</td>
                  <td style={{ fontSize: 13, color: '#636E72' }}>{new Date(form.created_at).toLocaleDateString('de')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/forms/${form.id}/submissions`} className="btn btn-sm btn-secondary" style={{ marginRight: 8, textDecoration: 'none' }}>
                      Antworten
                    </Link>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteForm(form.id)}>Loeschen</button>
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
