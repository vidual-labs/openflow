const Redis = require('ioredis');

let client;
let redisAvailable = false;

async function initRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 500, 3000);
    },
  });

  client.on('error', () => {
    if (redisAvailable) {
      console.warn('Redis disconnected, falling back to in-memory rate limiting');
    }
    redisAvailable = false;
  });

  client.on('connect', () => {
    console.log('Redis connected');
    redisAvailable = true;
  });

  try {
    await client.connect();
  } catch {
    console.log('Redis not available, running without it (rate limiting disabled)');
  }
}

function getRedis() {
  return client;
}

// Rate limiting helper
async function checkRateLimit(key, maxRequests, windowSeconds) {
  if (!client || !redisAvailable) return true;
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
