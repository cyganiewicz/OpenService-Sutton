const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED = ["/admin/account/password", "/admin/logout"];

/**
 * Guards /admin routes. Session-based auth: req.session.adminUser is set
 * on successful login (see routes/admin.js). No JWTs in localStorage —
 * everything rides on an httpOnly, secure, server-side session cookie so
 * it can't be read or exfiltrated via client-side script (XSS-resistant).
 *
 * Also enforces the forced-password-change gate: anyone logging in with a
 * temporary password (mustChangePassword=true — true for every newly
 * created staff account, and for the initial seeded admin) is redirected to
 * the password-change screen until they set their own password.
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminUser) {
    const redirectTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/admin/login?next=${redirectTo}`);
  }
  if (req.session.adminUser.mustChangePassword && !ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.includes(req.path)) {
    return res.redirect("/admin/account/password");
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.session?.adminUser && roles.includes(req.session.adminUser.role)) return next();
    return res.status(403).render("errors/403", { title: "Access Denied" });
  };
}

module.exports = { requireAdmin, requireRole };
