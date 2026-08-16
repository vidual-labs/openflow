// Reads free/busy slots from a self-hosted calon instance
// (https://github.com/vidual-labs/calon). Used by the `date-timeslot` field
// type to show real availability instead of a static list of times.
//
// calon's `GET /api/v1/availability` is public and unauthenticated by
// design (see calon's docs/self-hosting.md) — it discloses free/busy times
// only, never a requester or booking content — so this needs no credential,
// only the operator-supplied base URL and resource slug.

const { assertSafeUrl } = require('../utils/ssrf');

async function fetchCalonAvailability({ baseUrl, resourceSlug, from, to, durationMin }) {
  let url;
  try {
    url = new URL('/api/v1/availability', baseUrl);
  } catch {
    throw new Error('Invalid calon URL');
  }
  url.searchParams.set('resource_slug', resourceSlug || 'default');
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  if (durationMin) url.searchParams.set('duration_min', String(durationMin));

  // Same SSRF guard as every other operator-supplied URL this server fetches
  // (webhooks, Apps Script) — a calon base URL is just as capable of pointing
  // at an internal address.
  await assertSafeUrl(url.toString());

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(8000),
    // Don't auto-follow redirects: a validated URL could redirect to an
    // internal address, bypassing the assertSafeUrl check above.
    redirect: 'manual',
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error('calon responded with a redirect, which is not followed for security reasons');
  }
  if (!res.ok) {
    throw new Error(`calon returned ${res.status}`);
  }

  const body = await res.json();
  if (!Array.isArray(body.slots)) {
    throw new Error('Unexpected response from calon');
  }
  return { timezone: body.timezone, slots: body.slots };
}

module.exports = { fetchCalonAvailability };
