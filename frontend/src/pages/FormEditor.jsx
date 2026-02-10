import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'E-Mail' },
  { value: 'phone', label: 'Telefon' },
  { value: 'textarea', label: 'Textfeld' },
  { value: 'number', label: 'Zahl' },
  { value: 'date', label: 'Datum' },
  { value: 'select', label: 'Auswahl (einzeln)' },
  { value: 'multi-select', label: 'Auswahl (mehrfach)' },
  { value: 'yes-no', label: 'Ja / Nein' },
  { value: 'rating', label: 'Bewertung' },
];

export default function FormEditor() {
  const { id } = useParams();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('steps');

  useEffect(() => {
    api.getForm(id).then(d => setForm(d.form));
  }, [id]);

  if (!form) return <div>Laden...</div>;

  async function save(updates = {}) {
    setSaving(true);
    setSaved(false);
    const payload = {
      title: form.title,
      steps: form.steps,
      end_screen: form.end_screen,
      theme: form.theme,
      gtm_id: form.gtm_id,
      published: form.published,
      ...updates,
    };
    const { form: updated } = await api.updateForm(id, payload);
    setForm(updated);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateStep(index, changes) {
    const steps = [...form.steps];
    steps[index] = { ...steps[index], ...changes };
    setForm({ ...form, steps });
  }

  function addStep() {
    const newId = `field_${Date.now()}`;
    const steps = [...form.steps, { id: newId, type: 'text', question: '', label: '', required: false, placeholder: '' }];
    setForm({ ...form, steps });
  }

  function removeStep(index) {
    const steps = form.steps.filter((_, i) => i !== index);
    setForm({ ...form, steps });
  }

  function moveStep(index, dir) {
    const steps = [...form.steps];
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setForm({ ...form, steps });
  }

  const baseUrl = window.location.origin;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Link to="/" style={{ color: '#636E72', textDecoration: 'none', fontSize: 13 }}>&larr; Zurueck</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              style={{ fontSize: 24, fontWeight: 700, border: 'none', background: 'none', padding: 0, outline: 'none', width: 400 }}
            />
            <span className={`badge ${form.published ? 'badge-published' : 'badge-draft'}`}>
              {form.published ? 'Live' : 'Entwurf'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: '#00B894', fontSize: 13 }}>Gespeichert!</span>}
          <button className="btn btn-secondary" onClick={() => save({ published: form.published ? 0 : 1 })}>
            {form.published ? 'Deaktivieren' : 'Veroeffentlichen'}
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={saving}>
            {saving ? 'Speichert...' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        {[{ key: 'steps', label: 'Fragen' }, { key: 'endscreen', label: 'Endbildschirm' }, { key: 'theme', label: 'Design' }, { key: 'embed', label: 'Einbetten' }].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: activeTab === tab.key ? 'var(--primary)' : 'transparent',
              color: activeTab === tab.key ? 'white' : 'var(--text-light)',
              borderRadius: '8px 8px 0 0',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Steps Tab */}
      {activeTab === 'steps' && (
        <div>
          {form.steps.map((step, i) => (
            <div key={step.id} className="card" style={{ position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>Frage {i + 1}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => moveStep(i, -1)} disabled={i === 0} title="Nach oben">&uarr;</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => moveStep(i, 1)} disabled={i === form.steps.length - 1} title="Nach unten">&darr;</button>
                  <button className="btn btn-sm btn-danger" onClick={() => removeStep(i)}>Entfernen</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="input-group">
                  <label>Frage</label>
                  <input className="input" value={step.question} onChange={e => updateStep(i, { question: e.target.value })} placeholder="Ihre Frage..." />
                </div>
                <div className="input-group">
                  <label>Feldtyp</label>
                  <select className="input" value={step.type} onChange={e => updateStep(i, { type: e.target.value })}>
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Label / ID</label>
                  <input className="input" value={step.label || ''} onChange={e => updateStep(i, { label: e.target.value })} placeholder="z.B. Name, E-Mail..." />
                </div>
                <div className="input-group">
                  <label>Platzhalter</label>
                  <input className="input" value={step.placeholder || ''} onChange={e => updateStep(i, { placeholder: e.target.value })} placeholder="Platzhaltertext..." />
                </div>
              </div>

              {step.description !== undefined && (
                <div className="input-group">
                  <label>Beschreibung</label>
                  <input className="input" value={step.description || ''} onChange={e => updateStep(i, { description: e.target.value })} />
                </div>
              )}

              {(step.type === 'select' || step.type === 'multi-select') && (
                <div className="input-group">
                  <label>Optionen (eine pro Zeile)</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={(step.options || []).join('\n')}
                    onChange={e => updateStep(i, { options: e.target.value.split('\n').filter(Boolean) })}
                    placeholder={"Option 1\nOption 2\nOption 3"}
                  />
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 14 }}>
                <input type="checkbox" checked={step.required || false} onChange={e => updateStep(i, { required: e.target.checked })} />
                Pflichtfeld
              </label>
            </div>
          ))}

          <button className="btn btn-secondary" onClick={addStep} style={{ width: '100%', justifyContent: 'center', padding: 16 }}>
            + Frage hinzufuegen
          </button>
        </div>
      )}

      {/* End Screen Tab */}
      {activeTab === 'endscreen' && (
        <div className="card">
          <div className="input-group">
            <label>Titel</label>
            <input className="input" value={form.end_screen?.title || ''} onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, title: e.target.value } })} />
          </div>
          <div className="input-group">
            <label>Nachricht</label>
            <textarea className="input" rows={3} value={form.end_screen?.message || ''} onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, message: e.target.value } })} />
          </div>
          <div className="input-group">
            <label>Weiterleitung URL (optional)</label>
            <input className="input" value={form.end_screen?.redirectUrl || ''} onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, redirectUrl: e.target.value } })} placeholder="https://..." />
          </div>
        </div>
      )}

      {/* Theme Tab */}
      {activeTab === 'theme' && (
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="input-group">
              <label>Primaerfarbe</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="color" value={form.theme?.primaryColor || '#6C5CE7'} onChange={e => setForm({ ...form, theme: { ...form.theme, primaryColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                <input className="input" value={form.theme?.primaryColor || '#6C5CE7'} onChange={e => setForm({ ...form, theme: { ...form.theme, primaryColor: e.target.value } })} />
              </div>
            </div>
            <div className="input-group">
              <label>Hintergrundfarbe</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="color" value={form.theme?.backgroundColor || '#FFFFFF'} onChange={e => setForm({ ...form, theme: { ...form.theme, backgroundColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                <input className="input" value={form.theme?.backgroundColor || '#FFFFFF'} onChange={e => setForm({ ...form, theme: { ...form.theme, backgroundColor: e.target.value } })} />
              </div>
            </div>
            <div className="input-group">
              <label>Textfarbe</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="color" value={form.theme?.textColor || '#2D3436'} onChange={e => setForm({ ...form, theme: { ...form.theme, textColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                <input className="input" value={form.theme?.textColor || '#2D3436'} onChange={e => setForm({ ...form, theme: { ...form.theme, textColor: e.target.value } })} />
              </div>
            </div>
            <div className="input-group">
              <label>GTM Container-ID</label>
              <input className="input" value={form.gtm_id || ''} onChange={e => setForm({ ...form, gtm_id: e.target.value })} placeholder="GTM-XXXXXXX" />
            </div>
          </div>
        </div>
      )}

      {/* Embed Tab */}
      {activeTab === 'embed' && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Formular einbetten</h3>
          <p style={{ color: '#636E72', marginBottom: 24, fontSize: 14 }}>
            Kopieren Sie den Code und fuegen Sie ihn in Ihre Landing Page ein.
          </p>

          <div className="input-group">
            <label>Direkter Link</label>
            <input className="input" readOnly value={`${baseUrl}/f/${form.slug}`} onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
          </div>

          <div className="input-group">
            <label>iFrame Embed Code</label>
            <textarea className="input" readOnly rows={4} value={`<iframe src="${baseUrl}/embed/${form.slug}" width="100%" height="600" frameborder="0" style="border:none;border-radius:12px;"></iframe>`} onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
          </div>

          <div className="input-group">
            <label>iFrame mit Auto-Resize</label>
            <textarea className="input" readOnly rows={8} value={`<iframe id="openflow-${form.slug}" src="${baseUrl}/embed/${form.slug}" width="100%" height="600" frameborder="0" style="border:none;border-radius:12px;"></iframe>
<script>
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'openflow-resize') {
    document.getElementById('openflow-${form.slug}').style.height = e.data.height + 'px';
  }
});
</script>`} onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
          </div>

          {form.published ? (
            <a href={`/f/${form.slug}`} target="_blank" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Vorschau oeffnen
            </a>
          ) : (
            <p style={{ color: '#E67E22', fontSize: 14 }}>Veroeffentlichen Sie das Formular, um es einzubetten.</p>
          )}
        </div>
      )}
    </div>
  );
}
