const logger = require('../utils/logger');

// Wraps an async route handler so a rejected promise reaches the error
// handler below instead of becoming an unhandled rejection (which Node
// turns into a process exit — one bad request would take the server down).
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Final error handler: always JSON, never Express's HTML page with a stack
// trace and server paths. body-parser errors (malformed JSON, oversized
// body) carry a status; anything else is a 500 that is logged in full.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) {
    logger.error('unhandled_route_error', { method: req.method, path: req.originalUrl, error: err.message, stack: err.stack });
  }
  let message;
  if (err.type === 'entity.parse.failed') message = 'Invalid JSON body';
  else if (err.type === 'entity.too.large') message = 'Request body too large';
  else if (status < 500) message = err.message || 'Bad request';
  else message = 'Internal server error';
  res.status(status).json({ error: message });
}

module.exports = { asyncHandler, errorHandler };
