// Minimal structured logger: one JSON object per line, so operators can
// pipe stdout/stderr into any standard log aggregator (or just `| jq`)
// instead of grepping free-form console text. Deliberately dependency-free
// rather than pulling in pino/winston for this.
function write(level, msg, meta) {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  debug: (msg, meta = {}) => write('debug', msg, meta),
  info: (msg, meta = {}) => write('info', msg, meta),
  warn: (msg, meta = {}) => write('warn', msg, meta),
  error: (msg, meta = {}) => write('error', msg, meta),
};
