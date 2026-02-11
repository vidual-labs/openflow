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

module.exports = { checkRateLimit };
