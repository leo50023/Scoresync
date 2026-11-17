import crypto from 'crypto';

// Routes that must remain open (no CSRF check)
const CSRF_SKIP_ROUTES = [
  { method: 'POST', pattern: /^\/events\/[^/]+\/vote$/ },
  { method: 'POST', pattern: /^\/events\/[^/]+\/self-register$/ },
  { method: 'POST', pattern: /^\/api\/push\/subscribe$/ },
];

export function csrfMiddleware(req, res, next) {
  if (!req.session._csrf) {
    req.session._csrf = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session._csrf;
  next();
}

export function csrfProtect(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method)) return next();

  // Skip open routes
  for (const rule of CSRF_SKIP_ROUTES) {
    if (rule.method === method && rule.pattern.test(req.path)) return next();
  }

  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session._csrf) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}
