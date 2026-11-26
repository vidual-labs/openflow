// Run with `npm test` (node --test). The capture helpers take the query
// string as an argument, so no browser is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureTracking, captureUtms, captureClickIds, UTM_KEYS } from '../src/clickIds.js';

test('captures the five UTM parameters', () => {
  const search = '?utm_source=google&utm_medium=cpc&utm_campaign=test&utm_term=red%20shoes&utm_content=ad-1';
  assert.deepEqual(captureUtms(search), {
    utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test', utm_term: 'red shoes', utm_content: 'ad-1',
  });
  assert.deepEqual(UTM_KEYS, ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
});

test('ignores empty and unknown parameters', () => {
  assert.deepEqual(captureUtms('?utm_source=&utm_id=5&utm_medium=%20%20&email=a%40b.de'), {});
});

test('trims, strips control characters and caps the length', () => {
  const long = 'x'.repeat(300);
  const out = captureUtms(`?utm_source=%20news%0Aletter%20&utm_campaign=${long}`);
  assert.equal(out.utm_source, 'newsletter');
  assert.equal(out.utm_campaign.length, 200);
});

test('combines click ids and UTMs (acceptance URL)', () => {
  const out = captureTracking('?gclid=TEST123&utm_source=google&utm_medium=cpc&utm_campaign=test');
  assert.deepEqual(out, { gclid: 'TEST123', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test' });
});

test('keeps the existing click-id capture unchanged', () => {
  const ids = captureClickIds('?gbraid=gb&wbraid=wb&fbclid=abc');
  assert.equal(ids.gbraid, 'gb');
  assert.equal(ids.wbraid, 'wb');
  assert.match(ids.fbc, /^fb\.1\.\d{13}\.abc$/);
  assert.ok(!('utm_source' in ids));
});
