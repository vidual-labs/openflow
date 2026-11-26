import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { formatServerDateTime } from '../utils/dates';

// One response in full: its answers, the tracking data it arrived with (UTMs,
// ad click IDs) and the integration log — where it was sent, with what
// outcome, and every attempt / status check.

const TRACKING_ROWS = [
  ['utm_source', 'Source (utm_source)'],
  ['utm_medium', 'Medium (utm_medium)'],
  ['utm_campaign', 'Campaign (utm_campaign)'],
  ['utm_term', 'Term (utm_term)'],
  ['utm_content', 'Content (utm_content)'],
  ['gclid', 'Google Ads click (gclid)'],
  ['gbraid', 'Google Ads click, iOS app (gbraid)'],
  ['wbraid', 'Google Ads click, iOS web (wbraid)'],
  ['fbc', 'Meta click (fbc)'],
  ['fbp', 'Meta browser ID (fbp)'],
];

const GOOGLE_CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];

export function hasGoogleAdsClick(metadata) {
  return GOOGLE_CLICK_KEYS.some(k => typeof metadata?.[k] === 'string' && metadata[k]);
}

const INTEGRATION_LABELS = {
  webhook: 'Webhook',
  email: 'Email notification',
  google_sheets: 'Google Sheets',
  google_ads_conversion: 'Google Ads (Server-Side Conversion)',
  meta_conversion_api: 'Meta Conversions API',
};

// status → [label, tone]
const STATUS = {
  pending: ['Pending', 'wait'],
  success: ['Uploaded', 'ok'],
  processing: ['Uploaded – awaiting confirmation', 'wait'],
  unconfirmed: ['Uploaded – unconfirmed', 'wait'],
  skipped: ['Skipped', 'skip'],
  retrying: ['Failed – retrying', 'fail'],
  dead: ['Failed', 'fail'],
  failed: ['Failed', 'fail'],
};

function StatusBadge({ status }) {
  const [label, tone] = STATUS[status] || [status, 'skip'];
  return <span className={`badge resp-status resp-status-${tone}`}>{label}</span>;
}

// The safe summary facts the backend keeps per outcome (never payloads).
const FACTS = [
  ['requestId', 'Request ID'],
  ['requestStatus', 'Google status'],
  ['errorReasons', 'Error reasons'],
  ['fieldWarnings', 'Field warnings'],
  ['eventsReceived', 'Events received'],
  ['fbtraceId', 'fbtrace_id'],
  ['testEvent', 'Test event'],
  ['httpStatus', 'HTTP status'],
  ['updatedRange', 'Range'],
  ['smtp', 'SMTP reply'],
];

function Facts({ response }) {
  if (!response) return null;
  const rows = FACTS.filter(([key]) => response[key] !== undefined && response[key] !== null && response[key] !== '');
  if (!rows.length) return null;
  return (
    <dl className="resp-facts">
      {rows.map(([key, label]) => (
        <React.Fragment key={key}>
          <dt>{label}</dt>
          <dd>{Array.isArray(response[key]) ? response[key].join(', ') : String(response[key])}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function DeliveryCard({ delivery }) {
  const message = delivery.response?.message || delivery.last_error || '';
  const waiting = delivery.status === 'processing' || delivery.status === 'retrying';
  return (
    <div className="resp-delivery">
      <div className="resp-delivery-head">
        <strong>{INTEGRATION_LABELS[delivery.type] || delivery.type}</strong>
        <StatusBadge status={delivery.status} />
      </div>
      {message && <p className="resp-delivery-message">{message}</p>}
      <div className="resp-delivery-meta">
        Last update {formatServerDateTime(delivery.updated_at)}
        {waiting && delivery.next_attempt_at && <> · next {delivery.status === 'processing' ? 'check' : 'attempt'} {formatServerDateTime(delivery.next_attempt_at)}</>}
      </div>
      <Facts response={delivery.response} />
      {delivery.log?.length > 0 && (
        <details className="resp-history">
          <summary>History ({delivery.log.length})</summary>
          <ol>
            {delivery.log.map((entry, i) => (
              <li key={i}>
                <span className="resp-history-time">{formatServerDateTime(entry.created_at)}</span>
                <span>{entry.kind === 'status_check' ? 'Status check' : 'Attempt'}</span>
                <StatusBadge status={entry.status} />
                {entry.message && <span className="resp-history-message">{entry.message}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export default function SubmissionDetail({ formId, submission, fields, formatValue, onClose }) {
  const [deliveries, setDeliveries] = useState(null);
  const [logError, setLogError] = useState('');
  const metadata = submission.metadata || {};
  const trackingRows = TRACKING_ROWS.filter(([key]) => metadata[key]);

  useEffect(() => {
    let cancelled = false;
    setDeliveries(null);
    setLogError('');
    api.getSubmissionIntegrations(formId, submission.id)
      .then(d => { if (!cancelled) setDeliveries(d.deliveries); })
      .catch(err => { if (!cancelled) setLogError(err.message || 'Failed to load the integration log'); });
    return () => { cancelled = true; };
  }, [formId, submission.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="resp-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card resp-dialog" role="dialog" aria-modal="true" aria-labelledby="resp-detail-title">
        <div className="resp-dialog-head">
          <div>
            <h3 id="resp-detail-title">Response details</h3>
            <div className="resp-dialog-sub">Submitted {formatServerDateTime(submission.created_at)}</div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={onClose} autoFocus>Close</button>
        </div>

        <section className="resp-section">
          <h4>Answers</h4>
          <dl className="resp-facts">
            {fields.map(f => (
              <React.Fragment key={f.id}>
                <dt>{f.label || f.question || f.id}</dt>
                <dd>{formatValue(submission.data?.[f.id], f)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <section className="resp-section">
          <h4>Tracking</h4>
          {trackingRows.length === 0 ? (
            <p className="resp-muted">
              No UTM parameters or click IDs were captured. They are only captured when the form was opened
              from a link carrying them, and only after cookie consent.
            </p>
          ) : (
            <dl className="resp-facts">
              {trackingRows.map(([key, label]) => (
                <React.Fragment key={key}>
                  <dt>{label}</dt>
                  <dd className="resp-mono">{metadata[key]}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </section>

        <section className="resp-section">
          <h4>Integrations</h4>
          {logError && <p className="resp-muted">{logError}</p>}
          {!logError && deliveries === null && <p className="resp-muted">Loading…</p>}
          {deliveries && deliveries.length === 0 && (
            <p className="resp-muted">No integration ran for this response.</p>
          )}
          {deliveries && deliveries.map(d => <DeliveryCard key={d.id} delivery={d} />)}
        </section>
      </div>
    </div>
  );
}
