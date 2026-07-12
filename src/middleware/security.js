const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

/**
 * Helmet: sets a strict set of security headers.
 * - Content-Security-Policy locked to same-origin; no inline scripts.
 * - HSTS forces HTTPS on repeat visits.
 * - Disallows the site being framed (clickjacking protection).
 */
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
});

/**
 * Redirect any plain-HTTP request to HTTPS in production. Railway (and most
 * PaaS hosts) terminate TLS at the edge and forward via x-forwarded-proto,
 * so we check that header rather than req.secure directly.
 */
function forceHttps(req, res, next) {
  if (process.env.NODE_ENV !== "production") return next();
  const proto = req.headers["x-forwarded-proto"];
  if (proto && proto !== "https") {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
}

// General rate limit across the whole site — generous, just anti-abuse.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limit on form submissions to slow down spam/bulk-submission bots.
const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many submissions from this network. Please try again later.",
});

// Strict limit on admin login attempts to blunt credential-stuffing/brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Please wait before trying again.",
});

module.exports = { helmetMiddleware, forceHttps, generalLimiter, submissionLimiter, loginLimiter };
