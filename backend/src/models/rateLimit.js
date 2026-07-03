// Simple in-memory rate limiting (no Redis needed)
const buckets = new Map();

// Clean up expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now > entry.expiresAt) {
      buckets.delete(key);
    }
  }
}, 60_000);

function checkRateLimit(key, maxRequests, windowSeconds) {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.expiresAt) {
    buckets.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return true;
  }

  entry.count++;
  return entry.count <= maxRequests;
}

// Read-only: reports whether the bucket is already over the limit without
// consuming a request. Used to gate an action before it happens (e.g. reject
// a login attempt outright) without penalizing successful requests.
function isRateLimited(key, maxRequests) {
  const entry = buckets.get(key);
  if (!entry || Date.now() > entry.expiresAt) return false;
  return entry.count >= maxRequests;
}

module.exports = { checkRateLimit, isRateLimited };
