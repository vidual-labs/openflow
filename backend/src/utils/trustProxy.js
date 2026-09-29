// Resolves Express's `trust proxy` setting from the environment.
//
// Behind a reverse proxy, req.ip is only the real client address when Express
// is told to trust the proxy's X-Forwarded-For hop. Without it every visitor
// shares the proxy's IP — one rate-limit bucket for the whole internet (10
// submits/min for *all* respondents), and the proxy's address stored as
// `metadata.ip` and sent to Meta's Conversions API.
//
// TRUST_PROXY accepts what Express accepts:
//   - a hop count ("1" = the one proxy directly in front, the usual case)
//   - "true" / "false"
//   - a comma-separated list of addresses, CIDRs or the presets
//     "loopback", "linklocal", "uniquelocal"
// Unset, it falls back to 1 hop when OPENFLOW_PRIMARY_HOST is set (subdomain
// routing always runs behind the bundled Caddy proxy), and to off otherwise —
// trusting X-Forwarded-For with no proxy in front would let any client pick
// its own IP.
function resolveTrustProxy(env = process.env) {
  const raw = (env.TRUST_PROXY || '').trim();
  if (raw) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return env.OPENFLOW_PRIMARY_HOST ? 1 : false;
}

// Logs once when requests carry X-Forwarded-For but the proxy isn't trusted —
// the tell-tale sign of an unconfigured reverse proxy.
function createProxyMisconfigWarning(logger, trustProxy) {
  let warned = false;
  return (req, res, next) => {
    if (!warned && trustProxy === false && req.headers['x-forwarded-for']) {
      warned = true;
      logger.warn('trust_proxy_not_configured', {
        hint: 'Requests arrive with X-Forwarded-For but TRUST_PROXY is unset, so every visitor shares the proxy\'s IP (one rate-limit bucket, wrong metadata.ip). Set TRUST_PROXY=1 when OpenFlow runs behind exactly one reverse proxy.',
      });
    }
    next();
  };
}

module.exports = { resolveTrustProxy, createProxyMisconfigWarning };
