const Redis = require('ioredis');

let client;

async function initRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  client.on('error', (err) => {
    console.warn('Redis connection error (falling back to in-memory):', err.message);
  });

  client.on('connect', () => {
    console.log('Redis connected');
  });
}

function getRedis() {
  return client;
}

// Rate limiting helper
async function checkRateLimit(key, maxRequests, windowSeconds) {
  if (!client) return true;
  try {
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, windowSeconds);
    }
    return current <= maxRequests;
  } catch {
    return true; // allow if Redis is down
  }
}

module.exports = { initRedis, getRedis, checkRateLimit };
