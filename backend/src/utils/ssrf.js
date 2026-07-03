const dns = require('dns').promises;
const net = require('net');

// Blocks outbound integration requests (webhooks, Apps Script) from reaching
// internal/private network destinations. Without this, any user who can
// configure an integration can make the server fetch cloud metadata
// endpoints (169.254.169.254), localhost services, or other internal-only
// hosts on its behalf (SSRF).

function ipInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - Number(bits)) - 1);
  return (ip2long(ip) & mask) === (ip2long(range) & mask);
}

function ip2long(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const PRIVATE_V4_CIDRS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24',
  '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/4', '240.0.0.0/4',
];

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    return PRIVATE_V4_CIDRS.some(cidr => ipInCidr(ip, cidr));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded v4 address too.
    const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Mapped) return isPrivateIp(v4Mapped[1]);
    return false;
  }
  return true; // unknown format — fail closed
}

/**
 * Throws if `urlString` is not a safe destination for a server-initiated
 * outbound request: must be http(s), and must not resolve to a private,
 * loopback, link-local, or otherwise internal IP address.
 */
async function assertSafeUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  const hostname = url.hostname;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Requests to localhost are not allowed');
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve URL host');
  }
  if (addresses.length === 0 || addresses.some(a => isPrivateIp(a.address))) {
    throw new Error('This URL resolves to a private/internal address and cannot be used');
  }
}

module.exports = { assertSafeUrl, isPrivateIp };
