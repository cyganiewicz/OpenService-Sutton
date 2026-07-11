const { doubleCsrf } = require("csrf-csrf");

/**
 * Double-submit-cookie CSRF protection. A signed token is set in an
 * httpOnly-false cookie (so a small piece of JS-free hidden form field can
 * carry it) while a server-side HMAC verifies the pair matches on submit.
 * This blocks cross-site form submissions from other origins.
 */
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  cookieName: process.env.NODE_ENV === "production" ? "__Host-psifi.x-csrf-token" : "x-csrf-token",
  cookieOptions: {
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  size: 64,
  getTokenFromRequest: (req) => req.body._csrf,
});

// Makes a fresh token available to every view as `csrfToken` for hidden
// form fields, without forcing every route handler to remember to pass it.
function exposeCsrfToken(req, res, next) {
  res.locals.csrfToken = generateToken(req, res);
  next();
}

module.exports = { doubleCsrfProtection, exposeCsrfToken };
