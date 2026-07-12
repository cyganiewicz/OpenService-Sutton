const express = require("express");
const prisma = require("../db");
const router = express.Router();

// Temporary, self-contained diagnostic page — isolates whether an external
// CSS custom property resolves at all through this app's exact serving
// pipeline (Express static + Helmet CSP + Railway edge), independent of the
// full site's markup/JS. Bypasses the EJS layout entirely (raw res.send) so
// there is nothing else in play. Answer shows directly on the page, no
// DevTools needed. Safe to delete once the styling issue is resolved.
router.get("/css-test", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>CSS diagnostic</title>
<link rel="stylesheet" href="/css/test.css?v=${req.app.locals.buildId}">
</head>
<body>
  <h1>CSS diagnostic page</h1>
  <p>This page loads only a 3-line external stylesheet through the exact same server pipeline as the real site (Express static + Helmet CSP + Railway edge) — nothing else.</p>
  <div class="test-box">This box should have a dark green background if the stylesheet applied.</div>
  <p id="result" class="result-box">Loading result…</p>
  <script src="/js/css-test.js?v=${req.app.locals.buildId}" defer></script>
</body>
</html>`);
});

// Same trivial test, but rendered through the real EJS layout + express-ejs-layouts
// pipeline that every actual page on the site uses (the /css-test route above
// deliberately bypasses that with a raw res.send). If this version breaks where
// the raw one didn't, the layout/hoisting pipeline is the culprit, not the CSS.
router.get("/css-test2", (req, res) => {
  res.render("css-test", { title: "CSS Test (via layout)" });
});

router.get("/", async (req, res, next) => {
  try {
    const [openVacancyCount, boardCount, recentVacancies] = await Promise.all([
      prisma.jobVacancy.count({ where: { status: "OPEN" } }),
      prisma.boardCommission.count(),
      prisma.jobVacancy.findMany({
        where: { status: "OPEN" },
        orderBy: { postedDate: "desc" },
        take: 4,
      }),
    ]);
    res.render("home", { title: "OpenService", openVacancyCount, boardCount, recentVacancies });
  } catch (err) {
    next(err);
  }
});

router.get("/vacancies", async (req, res, next) => {
  try {
    const category = ["BOARD_COMMISSION", "TOWN_DEPARTMENT"].includes(req.query.category)
      ? req.query.category
      : null;

    const vacancies = await prisma.jobVacancy.findMany({
      where: { status: "OPEN", ...(category ? { category } : {}) },
      orderBy: [{ category: "asc" }, { postedDate: "desc" }],
    });

    res.render("vacancies", { title: "Current Vacancies", vacancies, category });
  } catch (err) {
    next(err);
  }
});

router.get("/board-members", async (req, res, next) => {
  try {
    const boards = await prisma.boardCommission.findMany({
      orderBy: { name: "asc" },
      include: { seats: { orderBy: [{ vacant: "desc" }, { termExpires: "asc" }] } },
    });
    res.render("board-members", { title: "Boards & Commissions", boards });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
