import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function Backup() {
  const [info, setInfo] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    loadInfo();
  }, []);

  async function loadInfo() {
    try {
      setInfo(await api.getBackupInfo());
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownload() {
    setError('');
    setNotice('');
    setDownloading(true);
    try {
      const { blob, filename } = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice('Backup downloaded.');
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(e) {
    setError('');
    setNotice('');
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so picking the same file again re-triggers the change event.
    e.target.value = '';

    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      setError('That file is not valid JSON.');
      return;
    }

    const totals = countRows(backup);
    const confirmed = window.confirm(
      `Restore from "${file.name}"?\n\n` +
      'This REPLACES all current data (forms, submissions, users, settings) ' +
      `with the contents of the backup${totals != null ? ` (${totals} rows)` : ''}.\n\n` +
      'This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    setRestoring(true);
    try {
      const result = await api.restoreBackup(backup);
      setNotice(`Restore complete — ${result.rows} rows across ${result.tables} tables restored. Reloading…`);
      await loadInfo();
      // Reload so the app picks up the restored session/data cleanly.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(false);
    }
  }

  function countRows(backup) {
    if (!backup || typeof backup.tables !== 'object') return null;
    return Object.values(backup.tables).reduce(
      (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2>Backup &amp; Restore</h2>
        <p style={{ color: 'var(--text-light)', fontSize: 14, margin: '4px 0 0' }}>
          Download a full snapshot of your database, or restore from a previous backup.
          Restoring also migrates older backups to the current format automatically.
        </p>
      </div>

      {error && <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid var(--danger)', color: 'var(--danger)' }}>{error}</div>}
      {notice && <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid var(--success, #00b894)', color: 'var(--success, #00b894)' }}>{notice}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>💾</span>
          <div>
            <h3 style={{ margin: 0 }}>Download Backup</h3>
            <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>
              Exports every form, submission, integration, user and setting as a single JSON file.
            </p>
          </div>
        </div>

        {info && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {Object.entries(info.counts).map(([table, n]) => (
              <span key={table} className="badge badge-draft" style={{ fontSize: 12 }}>
                {table}: {n}
              </span>
            ))}
          </div>
        )}

        <button className="btn btn-primary" onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Preparing…' : 'Download Backup'}
        </button>
      </div>

      <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>♻️</span>
          <div>
            <h3 style={{ margin: 0 }}>Restore from Backup</h3>
            <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>
              Replaces <strong>all</strong> current data with the contents of the uploaded file. This cannot be undone.
            </p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button
          className="btn btn-danger"
          onClick={() => fileRef.current?.click()}
          disabled={restoring}
        >
          {restoring ? 'Restoring…' : 'Choose Backup File…'}
        </button>
      </div>
    </div>
  );
}
