const path = require("path");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");

const { helmetMiddleware, forceHttps, generalLimiter } = require("./middleware/security");
const { doubleCsrfProtection, exposeCsrfToken } = require("./middleware/csrf");

const publicRoutes = require("./routes/public");
const applicationRoutes = require("./routes/applications");
const adminRoutes = require("./routes/admin");

const app = express();

// Railway (and most PaaS hosts) sit behind a reverse proxy that terminates
// TLS — trusting the proxy lets Express see the real client IP (for rate
// limiting) and correctly detect HTTPS (for secure cookies).
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(forceHttps);
app.use(helmetMiddleware);

// Redact anything that could carry PII out of access logs.
morgan.token("safe-url", (req) => req.originalUrl.split("?")[0]);
app.use(morgan(':remote-addr :method :safe-url :status :res[content-length] - :response-time ms'));

app.use(generalLimiter);
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));

app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1d" }));

// Required by csrf-csrf to read/write the double-submit CSRF cookie.
app.use(cookieParser());

// Sessions are persisted in Postgres (not memory) so admin logins survive
// restarts/redeploys and scale across instances. Cookie is httpOnly + secure
// + SameSite=Lax so it can't be read by page scripts or replayed cross-site.
const sessionStore = process.env.DATABASE_URL
  ? new pgSession({ pool: new Pool({ connectionString: process.env.DATABASE_URL }), tableName: "user_sessions", createTableIfMissing: true })
  : undefined;

app.use(
  session({
    store: sessionStore,
    name: "sutton.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
    },
  })
);

app.use(exposeCsrfToken);
app.use(doubleCsrfProtection);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.adminUser = req.session?.adminUser || null;
  next();
});

app.use(publicRoutes);
app.use(applicationRoutes);
app.use(adminRoutes);

app.use((req, res) => {
  res.status(404).render("errors/404", { title: "Page Not Found" });
});

// Centralized error handler — never leak stack traces or internals to users.
app.use((err, req, res, next) => {
  console.error(err.status === 403 && err.code === "EBADCSRFTOKEN" ? "CSRF validation failed" : err);
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("errors/403", { title: "Form Expired", message: "Your form session expired or the request looked suspicious. Please go back and try again." });
  }
  res.status(err.status || 500).render("errors/500", { title: "Something Went Wrong" });
});

module.exports = app;
