# OpenService — Town of Sutton, MA

A public volunteer & employment application portal for the Town of Sutton, built as a
companion to **OpenBook** (finance.suttonma.gov/openbook). It provides:

- A **Volunteer Application** form for Town boards/commissions
- An **Employment Application** form (digitized from the Town's existing paper/PDF
  "Employment Application FT-PT-Clerical" form — all sections and fields preserved)
- A public **Vacancies** page listing open board/commission seats and Town department jobs
- A public **Boards & Commissions** page showing current members and term expiration dates
- A password-protected **Admin panel** for Town staff to manage vacancies, board seats, and
  review submitted applications (including downloading uploaded resumes)

Built with Node.js/Express, EJS templates, PostgreSQL via Prisma — designed to deploy on
**Railway** (Postgres + hosting) with the repo on **GitHub**, matching what you described.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js + Express | Simple, well-understood, easy for any future contractor/dev to maintain |
| Views | EJS (server-rendered) | No separate frontend build step; good for a small public gov site & SEO |
| Database | PostgreSQL via Prisma ORM | Matches your Railway Postgres plan; Prisma prevents SQL-injection by construction |
| Sessions | `express-session` + `connect-pg-simple` | Admin login sessions persist in Postgres, survive redeploys |
| File uploads | `multer` (memory) → stored as bytes in Postgres | Railway's filesystem is ephemeral — storing resumes on disk would lose them on every redeploy |

---

## 2. Design & naming conventions

The header, footer, color system, and "Open___" naming convention are modeled on OpenBook
(navy/gold civic palette, card-based sections, "Powered by Open___" footer, plain-language
section names). I read OpenBook's live page content to match its structure and tone, but I
could not extract its exact CSS/hex values or logo asset programmatically. **Before launch**,
someone with access to OpenBook's source or brand assets should:

1. Open `public/css/style.css` and adjust the CSS variables at the top (`--navy-900`,
   `--gold-500`, `--maroon-700`, etc.) to match OpenBook's exact colors.
2. Replace the placeholder circular "TOS" text seal in `views/partials/header.ejs` with the
   Town's actual seal image (drop the file in `public/img/` and swap the markup).
3. Confirm "OpenService" is the name you want — it was chosen to fit OpenBook's naming
   pattern and cover both volunteer *and* employment applications. Easy to rename via
   find/replace in `views/partials/header.ejs`, `views/partials/footer.ejs`, and `README.md`.

---

## 3. Local development

```bash
npm install                  # installs dependencies (Prisma downloads its query engine here — needs internet)
cp .env.example .env         # fill in real values (see below)
npx prisma migrate dev --name init   # creates the database schema (requires DATABASE_URL to point at a real Postgres)
npm run seed                 # creates your first admin login + sample vacancies/boards
npm run dev                  # starts the server on http://localhost:3000
```

You need a real Postgres instance to develop against locally — easiest is to spin up a free
Railway Postgres plugin and point your local `.env` at it, or run Postgres in Docker
(`docker run -e POSTGRES_PASSWORD=devpass -p 5432:5432 postgres:16`).

---

## 4. Deploying (GitHub + Railway)

1. **Push this repo to GitHub.** `git init`, commit everything except `.env` (already in
   `.gitignore`), and push to a new repository.
2. **Create a new Railway project** and choose "Deploy from GitHub repo," selecting this repo.
3. **Add a PostgreSQL plugin** to the Railway project. Railway will generate a `DATABASE_URL`
   automatically — reference it in your web service's variables as `${{Postgres.DATABASE_URL}}`.
4. **Set environment variables** on the Railway service (Settings → Variables), using
   `.env.example` as the checklist:
   - `NODE_ENV=production`
   - `DATABASE_URL` → reference the Postgres plugin's URL
   - `SESSION_SECRET`, `CSRF_SECRET` → generate real random values, e.g. run
     `openssl rand -base64 48` twice, locally, and paste the results in (never reuse the
     placeholder values — the app refuses to start in production if you do)
   - `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_NAME` (for the one-time seed)
   - `BASE_URL` → your Railway domain or custom domain
5. **Set the build/start commands** (Railway usually auto-detects Node from `package.json`):
   - Build: `npm install` (this also runs `prisma generate` via `postinstall`)
   - Release/one-off command (run once after first deploy, and again after any future
     schema change): `npx prisma migrate deploy`
   - One-off seed (run once): `npm run seed`
   - Start: `npm start`
6. **Point your domain** (e.g. `openservice.suttonma.gov`) at the Railway service, and enable
   Railway's automatic HTTPS.
7. Log in at `/admin/login` with your bootstrap admin credentials and **change the password
   immediately** by creating a new admin flow or rotating `ADMIN_BOOTSTRAP_PASSWORD` and
   re-seeding (there's no self-service password-change screen yet — see "Known limitations" below).

Every push to your main branch will auto-redeploy on Railway. Run `prisma migrate deploy`
again any time you change `prisma/schema.prisma` and add a new migration.

---

## 5. Security — what's implemented, and what it does *not* guarantee

You asked for the application to be "100% secure." No internet-connected system can honestly
promise that — the goal here is to implement layered, current best practices and be transparent
about what's covered and what still needs attention from you, your IT contact, or a security
reviewer before this handles real resident data in production.

**Implemented:**

- **Transport security** — HTTP → HTTPS redirect in production; HSTS header; Railway provides
  the TLS certificate.
- **Security headers** — `helmet` sets a strict Content-Security-Policy (no inline scripts,
  no framing by other sites), `X-Content-Type-Options`, `Referrer-Policy`, etc.
- **CSRF protection** — every form submission requires a signed, double-submit CSRF token
  (`csrf-csrf`), verified server-side per session/cookie pair.
- **Session security** — admin sessions are httpOnly, secure (HTTPS-only), SameSite=Lax
  cookies backed by a Postgres-stored session table (not client-side JWTs, so nothing sensitive
  is exposed to page scripts). Sessions regenerate on login to prevent session fixation.
- **Password storage** — admin passwords hashed with bcrypt (cost factor 12), never stored
  or logged in plaintext.
- **Input validation & sanitization** — every public form field is validated and HTML-escaped
  server-side (`express-validator`) in addition to Prisma's parameterized queries, which
  eliminate SQL injection by construction.
- **Rate limiting** — general site-wide limiter, a stricter limiter on form submissions, and
  a strict limiter on admin login attempts (to blunt credential-stuffing/brute force).
- **File upload hardening** — resumes are restricted to PDF/Word, capped at 5MB, scanned for
  MIME type, held in memory (never written to disk), and stored as encrypted-at-rest bytes in
  Postgres (Railway encrypts Postgres volumes at rest) rather than a public file path.
- **Spam mitigation** — an invisible honeypot field on both public forms silently discards
  bot submissions without tipping the bot off.
- **Least-exposure logging** — access logs strip query strings and never log form bodies/PII.
- **Fail-fast startup** — the server refuses to start in production if secrets are missing or
  left as placeholder values.

**Known limitations — recommended before/soon after go-live:**

- **No CAPTCHA service.** The honeypot deters simple bots but not sophisticated ones. If spam
  becomes a problem, add hCaptcha or Cloudflare Turnstile to both public forms (a few lines
  in the form templates + a server-side verification call).
- **No self-service admin password reset/2FA.** Only one bootstrap admin is seeded. Add a
  password-change screen and consider TOTP-based 2FA before granting several staff accounts.
- **No automated dependency/vulnerability scanning configured.** Run `npm audit` periodically,
  or turn on GitHub's Dependabot alerts on the repo.
- **No formal data-retention policy encoded in the app.** Volunteer/employment applications
  are retained indefinitely by default. Massachusetts public-records and personnel-record
  retention rules should inform how long to keep this data and when to purge it — that's a
  records-management decision for the Town, not something this code can decide for you.
- **No independent security audit.** For a system handling resident PII, a third-party
  penetration test or code review before public launch is strongly recommended, particularly
  if you later add SSN/background-check collection.
- **Resumes stored in the database.** Fine at small-town scale; if resume volume grows large,
  consider moving to object storage (e.g., an S3-compatible bucket) instead of Postgres bytes.

---

## 6. Using the admin panel

Log in at `/admin/login`. From there:

- **Vacancies** — create/edit/close postings for both boards/commissions and Town department
  jobs; optionally link a board/commission vacancy to an existing board record.
- **Boards & Members** — add boards/commissions, add/edit/delete individual seats (title,
  current member, appointed date, term-expiration date, vacant flag). This directly powers
  the public `/board-members` page.
- **Volunteer / Employment Applications** — view every submission, update its review status
  (New / Under Review / Interviewing / Closed), and for employment applications, download the
  applicant's resume if one was attached.

---

## 7. Project structure

```
prisma/schema.prisma        Database schema (vacancies, boards, seats, applications, admin users)
prisma/seed.js               One-time bootstrap: first admin account + sample data
src/app.js                   Express app assembly (middleware order matters — see comments)
src/server.js                Entry point; fails fast if prod secrets are missing
src/db.js                    Shared Prisma client
src/middleware/              security.js, auth.js, csrf.js, upload.js, validate.js
src/routes/public.js         Home, vacancies, board-members (read-only public pages)
src/routes/applications.js   Volunteer + employment form GET/POST
src/routes/admin.js          Login + all admin CRUD
views/                       EJS templates (layout.ejs wraps every page)
public/css/style.css         Design system — CSS variables at the top for easy re-theming
```

---

## 8. What's next / handoff notes

- Swap in exact OpenBook brand colors + the Town seal image (see section 2).
- Decide on a records-retention policy for applications and encode it as a scheduled cleanup
  job if needed.
- Consider adding hCaptcha before public launch if spam becomes an issue.
- Add a couple more admin accounts (currently requires editing `prisma/seed.js` and
  re-seeding, or inserting directly via `npx prisma studio` — a proper "invite admin" screen
  would be a good next feature).
