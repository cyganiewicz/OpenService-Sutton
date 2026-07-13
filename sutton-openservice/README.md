# OpenService — Town of Sutton, MA

A public volunteer & employment application portal for the Town of Sutton, built as a
companion to **OpenBook** (finance.suttonma.gov/openbook). It provides:

- A **Volunteer Application** form for Town boards/commissions
- An **Employment Application** form (digitized from the Town's existing paper/PDF
  "Employment Application FT-PT-Clerical" form — all sections and fields preserved), with the
  question set on both forms fully editable by admins via a drag-and-drop form builder
- A public **Vacancies** page listing open board/commission seats and Town department jobs,
  each with its own detail page for the full description and qualifications
- A public **Boards & Commissions** page showing current members and term expiration dates
- A password-protected **Admin panel** for Town staff to manage vacancies, board seats, the
  application forms themselves, and review submitted applications (including downloading
  uploaded resumes)

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

Updated from screenshots of the live OpenBook site you shared. The palette in
`public/css/style.css` now uses OpenBook's actual colors — deep forest green for the
header/hero/footer (not the navy blue this started with), a warm cream page background
(not cool gray), a muted tan-gold accent, and bold sans-serif headlines (not serif — OpenBook's
headlines are a chunky geometric sans). The CSS variables are still named `--navy-*`/
`--maroon-*` for historical reasons from before I had real reference images; only the
underlying hex values changed, so nothing in the templates needed touching. The
`openbook-link` cross-link was removed from the nav per your note. I don't have a way to
render an actual pixel screenshot of the result in this environment to show you side-by-side —
this is my best-effort visual match by eye from your screenshots, not a verified pixel diff, so
it's worth a look once deployed and a quick round of feedback if anything's off.

**Town seal:** the higher-resolution seal you shared still didn't come through as a file I can
read — it renders inline in our chat, but nothing landed in the uploads folder my tools can
access, in either attempt. The site is still using the lower-resolution version extracted from
the Town's PDF employment application (`public/img/town-seal.jpg`). This looks like a
limitation of how inline-pasted images reach me in this environment rather than something
you're doing wrong — if there's a distinct "attach file" control (paperclip icon or similar,
separate from pasting into the message box) that's worth trying, but otherwise the most
reliable path is having someone drop the seal file into a folder you share with me directly.

"OpenService" was chosen as the name to fit OpenBook's "Open___" naming pattern and cover both
volunteer *and* employment applications — let me know if you'd rather call it something else;
it's a quick find/replace across `views/partials/header.ejs`, `views/partials/footer.ejs`, and
this README.

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
3. **Add a PostgreSQL plugin** to the Railway project (+ New → Database → Add PostgreSQL).
   Railway generates a `DATABASE_URL` for it automatically.
4. **Set environment variables** on your *web service* (not the Postgres plugin) — Settings →
   Variables:
   - `NODE_ENV=production`
   - `DATABASE_URL` → click "Add Reference" and point it at the Postgres plugin (it'll look
     like `${{Postgres.DATABASE_URL}}`). This step is easy to miss since it's on a different
     service than the one you're deploying — if you skip it, the app crashes immediately with
     `Missing required environment variable: DATABASE_URL`.
   - `SESSION_SECRET`, `CSRF_SECRET` → real random values, e.g. `openssl rand -base64 48` run
     twice locally (never reuse the placeholder text — the app refuses to start in production
     if you do)
   - `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_NAME` (for the one-time seed)
   - `BASE_URL` → your Railway domain or custom domain
5. **Create the database tables — this is the step that's easy to miss.** The app boots fine
   once `DATABASE_URL` exists, but every page will 500 ("Something Went Wrong") until the
   tables actually exist in Postgres. Do this via Railway's **Pre-Deploy Command**, which runs
   automatically before every deploy, inside Railway's private network (so it can reach the
   database — running Prisma commands from your own laptop via `railway run` will *not* work,
   because Railway's internal `DATABASE_URL` hostname isn't reachable from outside Railway):
   - Go to your web service → **Settings → Deploy → Pre-Deploy Command**
   - Set it to: `npx prisma db push && node prisma/seed.js`
     (`db push` syncs the schema directly — no migration files required, which matters since
     none exist in this repo yet. `seed.js` is safe to run on every deploy: it checks for an
     existing admin/board records before creating anything.)
   - Redeploy. Check **Deploy Logs** for this service — you should see Prisma report the
     tables were created, then the seed script log "Created initial admin account."
   - Once you have local access to a Postgres instance (see section 3 below) and want proper
     migration history for future schema changes, switch to `npx prisma migrate deploy` here
     instead, after generating an initial migration locally with `npx prisma migrate dev --name init`.
6. **Point your domain** (e.g. `openservice.suttonma.gov`) at the Railway service, and enable
   Railway's automatic HTTPS.
7. Log in at `/admin/login` with your bootstrap admin credentials and **change the password
   immediately** by creating a new admin flow or rotating `ADMIN_BOOTSTRAP_PASSWORD` and
   re-seeding (there's no self-service password-change screen yet — see "Known limitations" below).

Every push to your main branch auto-redeploys on Railway, re-running the Pre-Deploy Command
each time (harmless — `db push` and the seed script are both safe to re-run).

**Note:** `prisma` (the CLI) must live in `package.json`'s `dependencies`, not
`devDependencies` — Railway's production build skips devDependencies, which silently breaks
both `prisma generate` (in `postinstall`) and any `prisma` command in the Pre-Deploy step.
This repo already has it in the right place.

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
- **No TOTP-based 2FA.** Multiple staff accounts with password-based login are now supported
  (see below), including forced password changes on first login — but there's no second
  factor. Worth adding before granting many accounts, especially ADMINISTRATOR-level ones.
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

- **Vacancies** — create postings for both boards/commissions and Town department jobs, and
  **edit them in place** afterward (`/admin/vacancies/:id/edit` — no need to repost). The
  description and qualifications fields use a self-hosted rich-text editor (bold/italic/
  underline, bulleted/numbered lists, links) — formatting is sanitized server-side before
  saving, so pasted or malicious HTML can't inject scripts. Town department jobs can also
  specify a pay type (hourly/salaried/stipend/unpaid/other) and a min/max range, which shows
  on the public vacancy listing. Each posting also has its own public detail page
  (`/vacancies/:id`) with the full description/qualifications — the listing page only shows a
  summary card that links into it.
- **Boards & Members** — add boards/commissions, add/edit/delete individual seats (title,
  current member, appointed date, term-expiration date, vacant flag). This directly powers
  the public `/board-members` page.
- **Application Forms** (`/admin/forms`) — a drag-and-drop builder for the *questions* on the
  public Volunteer and Employment application forms, separate from reviewing submissions (see
  below). Add, relabel, retype, mark required, or delete a question, and reorder the whole list
  by dragging field cards — changes take effect on the live public forms immediately. Field
  types include text, paragraph, email, phone, date, number, dropdown, multiple choice,
  checkboxes, a single checkbox, plus section headers and instructional text for organizing a
  long form. Employment's repeating sections (work history, education, computer skills,
  references), the resume upload, and the signature/acknowledgement block are fixed parts of
  the form and aren't editable here, since they don't fit a single-value question model.
- **Volunteer / Employment Applications** — view every *submission*, update its review status
  (New / Under Review / Interviewing / Closed), **edit the submitted data** if a correction is
  needed (a typo'd phone number, updated address, etc.), and for employment applications,
  download the applicant's resume if one was attached. Editing preserves the applicant's
  original signature and acknowledgement date — it doesn't let staff alter what the applicant
  legally certified, only the contact/history details around it. This is distinct from
  **Application Forms** above: this section edits what an applicant already sent in, not the
  questions asked of future applicants.
- **Staff Accounts** (ADMINISTRATOR role only) — add new staff or administrator logins. Creating
  an account generates a one-time temporary password, shown once on screen — share it with the
  new person out of band (not by plain email, ideally). Every new account, and every password
  reset, is flagged to require a password change on next login, so temp passwords can't linger.
  STAFF-role accounts can manage vacancies, boards, and applications, but can't reach this page
  or create other accounts — that's reserved for ADMINISTRATOR accounts.
- **Change Password** — every logged-in admin/staff account can change their own password from
  the sidebar at any time, not just when forced to.

---

## 7. Project structure

```
prisma/schema.prisma          Database schema (vacancies, boards, seats, applications, admin
                                users, and FormField — the admin-configurable question rows)
prisma/seed.js                 One-time bootstrap: first admin account + sample data + default
                                form fields (only seeds a form's fields if it has none yet)
prisma/defaultFormFields.js    The starting question set for each form, read only at seed time
src/app.js                     Express app assembly (middleware order matters — see comments)
src/server.js                  Entry point; fails fast if prod secrets are missing
src/db.js                      Shared Prisma client
src/middleware/                security.js, auth.js, csrf.js, upload.js, validate.js
src/utils/richText.js          sanitize-html wrapper for the vacancy rich-text fields
src/utils/dynamicForm.js       Loads FormField rows and reads/validates a submission's
                                responses against them — shared by the public forms and the
                                admin submission-edit screens so they never drift out of sync
src/routes/public.js           Home, vacancies, vacancy detail, board-members (public pages)
src/routes/applications.js     Volunteer + employment form GET/POST, rendered dynamically from
                                FormField rows; exports shared field lists/builders reused by
                                admin.js's submission-edit screens
src/routes/admin.js            Login, password change, staff management, the form builder
                                (/admin/forms), and all admin CRUD (vacancies, boards/seats,
                                submission review + editing)
views/                         EJS templates (layout.ejs wraps every page)
views/partials/dynamic-field.ejs  Renders one FormField as an <input>/<select>/etc., shared by
                                every place a dynamic question needs to appear
public/css/style.css           Design system — CSS variables at the top for easy re-theming
public/js/rich-editor.js       Self-hosted rich-text toolbar (no CDN — keeps CSP strict)
public/js/form-builder.js      Self-hosted drag-and-drop reordering for /admin/forms (no CDN)
```

---

## 8. What's next / handoff notes

- Palette now matches OpenBook (forest green/cream/tan-gold, bold sans headlines) based on
  your screenshots — take a look after deploying and flag anything that's off. Still need the
  higher-resolution town seal as an actual file (see section 2).
- Decide on a records-retention policy for applications and encode it as a scheduled cleanup
  job if needed.
- Consider adding hCaptcha before public launch if spam becomes an issue.
- Staff/admin accounts are now self-service via `/admin/staff` (ADMINISTRATOR role) — no more
  editing `prisma/seed.js` needed for additional accounts.
