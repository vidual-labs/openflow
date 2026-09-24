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

// Book a slot through calon's public booking endpoint (`POST /api/v1/bookings`),
// the same unauthenticated path calon's own booking form uses — so connecting a
// form needs no secret and no config on the calon side. calon judges the request
// against its rules and its (and any connected calendar's) busy time; on
// acceptance it writes the event into the resource's connected calendar itself.
//
// Resolves { accepted: true, bookingId } or { accepted: false, code, message } for
// an answer calon gave; throws when calon couldn't be asked (unreachable, 5xx), so
// the caller can retry later.
async function submitCalonBooking({ baseUrl, booking }) {
  let url;
  try {
    url = new URL('/api/v1/bookings', baseUrl);
  } catch {
    throw new Error('Invalid calon URL');
  }
  await assertSafeUrl(url.toString());

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking),
    signal: AbortSignal.timeout(10000),
    redirect: 'manual',
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error('calon responded with a redirect, which is not followed for security reasons');
  }
  // 201 = accepted and booked, 200 = judged and rejected (calon's documented contract).
  if (res.status === 201 || res.status === 200) {
    const body = await res.json();
    const decision = body.decision || {};
    if (res.status === 201) return { accepted: true, bookingId: body.booking?.id || null, code: decision.code };
    return { accepted: false, code: decision.code || 'REJECTED', message: decision.message || '' };
  }
  // calon refused the request's shape (e.g. an implausible email): asking again
  // won't change the answer, so this is a rejection, not a retryable failure.
  if (res.status === 400 || res.status === 422) {
    return { accepted: false, code: 'INVALID_REQUEST', message: `calon returned ${res.status}` };
  }
  throw new Error(`calon returned ${res.status}`);
}

// The UTC offset, in minutes, that `timeZone` has at the instant `utcMs`.
function zoneOffsetMinutes(timeZone, utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map(x => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs) / 60000);
}

// A wall-clock "2026-09-02" + "09:30" in `timeZone` → "2026-09-02T09:30:00+02:00",
// the offset-carrying instant calon's booking API requires. Throws on malformed
// input or an unknown IANA zone.
function localSlotToIso(date, time, timeZone) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  const t = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!d || !t) throw new Error(`Invalid date/time "${date} ${time}"`);
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  // Two passes: the offset at the wall time read as UTC can differ from the offset
  // at the real instant when a DST change falls in between.
  let offset = zoneOffsetMinutes(timeZone, wall);
  offset = zoneOffsetMinutes(timeZone, wall - offset * 60000);
  const abs = Math.abs(offset);
  const pad = n => String(n).padStart(2, '0');
  return `${date}T${time}:00${offset >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

module.exports = { fetchCalonAvailability, submitCalonBooking, localSlotToIso };
