/**
 * Guards /admin routes. Session-based auth: req.session.adminUser is set
 * on successful login (see routes/admin.js). No JWTs in localStorage —
 * everything rides on an httpOnly, secure, server-side session cookie so
 * it can't be read or exfiltrated via client-side script (XSS-resistant).
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminUser) return next();
  const redirectTo = encodeURIComponent(req.originalUrl);
  return res.redirect(`/admin/login?next=${redirectTo}`);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.session?.adminUser && roles.includes(req.session.adminUser.role)) return next();
    return res.status(403).render("errors/403", { title: "Access Denied" });
  };
}

module.exports = { requireAdmin, requireRole };
