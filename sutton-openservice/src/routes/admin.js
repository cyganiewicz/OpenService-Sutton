const express = require("express");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const prisma = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { handleValidation } = require("../middleware/validate");
const { loginLimiter } = require("../middleware/security");
const router = express.Router();

/* --------------------------------- Auth ---------------------------------- */

router.get("/admin/login", (req, res) => {
  if (req.session?.adminUser) return res.redirect("/admin");
  res.render("admin/login", { title: "Admin Login", errors: {}, next: req.query.next || "/admin" });
});

router.post(
  "/admin/login",
  loginLimiter,
  [body("email").trim().isEmail().normalizeEmail(), body("password").notEmpty()],
  handleValidation("admin/login", { title: "Admin Login", next: "/admin" }),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const genericError = { general: { msg: "Invalid email or password." } };

      const user = await prisma.adminUser.findUnique({ where: { email } });
      if (!user || !user.active) {
        return res.status(401).render("admin/login", { title: "Admin Login", errors: genericError, next: req.body.next || "/admin" });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return res.status(401).render("admin/login", { title: "Admin Login", errors: genericError, next: req.body.next || "/admin" });
      }

      // Regenerate the session on privilege change to prevent session fixation.
      req.session.regenerate(async (err) => {
        if (err) return next(err);
        req.session.adminUser = { id: user.id, name: user.name, email: user.email, role: user.role };
        await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        const dest = req.body.next && req.body.next.startsWith("/admin") ? req.body.next : "/admin";
        res.redirect(dest);
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/admin/logout", requireAdmin, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.redirect("/admin/login");
  });
});

/* ------------------------------- Dashboard -------------------------------- */

router.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const [openVacancies, boards, newVolunteerApps, newEmploymentApps] = await Promise.all([
      prisma.jobVacancy.count({ where: { status: "OPEN" } }),
      prisma.boardCommission.count(),
      prisma.volunteerApplication.count({ where: { status: "NEW" } }),
      prisma.employmentApplication.count({ where: { status: "NEW" } }),
    ]);
    res.render("admin/dashboard", { title: "Admin Dashboard", openVacancies, boards, newVolunteerApps, newEmploymentApps });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- Vacancies -------------------------------- */

router.get("/admin/vacancies", requireAdmin, async (req, res, next) => {
  try {
    const vacancies = await prisma.jobVacancy.findMany({ orderBy: [{ status: "asc" }, { postedDate: "desc" }] });
    res.render("admin/vacancies", { title: "Manage Vacancies", vacancies });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/vacancies/new", requireAdmin, async (req, res, next) => {
  try {
    const boards = await prisma.boardCommission.findMany({ orderBy: { name: "asc" } });
    res.render("admin/vacancy-form", { title: "New Vacancy", vacancy: null, boards, errors: {} });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/vacancies/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const [vacancy, boards] = await Promise.all([
      prisma.jobVacancy.findUnique({ where: { id: req.params.id } }),
      prisma.boardCommission.findMany({ orderBy: { name: "asc" } }),
    ]);
    if (!vacancy) return res.status(404).render("errors/404", { title: "Not Found" });
    res.render("admin/vacancy-form", { title: "Edit Vacancy", vacancy, boards, errors: {} });
  } catch (err) {
    next(err);
  }
});

const vacancyValidators = [
  body("title").trim().notEmpty().isLength({ max: 200 }).escape(),
  body("category").isIn(["BOARD_COMMISSION", "TOWN_DEPARTMENT"]),
  body("departmentOrBoard").trim().notEmpty().isLength({ max: 200 }).escape(),
  body("employmentType").isIn(["FULL_TIME", "PART_TIME", "SEASONAL", "APPOINTED", "VOLUNTEER"]),
  body("description").trim().notEmpty().isLength({ max: 5000 }),
  body("qualifications").optional({ checkFalsy: true }).isLength({ max: 3000 }),
  body("status").isIn(["OPEN", "CLOSED"]),
];

async function vacancyValidationGate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const boards = await prisma.boardCommission.findMany({ orderBy: { name: "asc" } });
  const vacancy = req.params.id ? { id: req.params.id, ...req.body } : null;
  return res.status(422).render("admin/vacancy-form", {
    title: vacancy ? "Edit Vacancy" : "New Vacancy",
    vacancy,
    boards,
    errors: errors.mapped(),
  });
}

router.post("/admin/vacancies/new", requireAdmin, vacancyValidators, vacancyValidationGate, async (req, res, next) => {
  try {
    const b = req.body;
    await prisma.jobVacancy.create({
      data: {
        title: b.title,
        category: b.category,
        departmentOrBoard: b.departmentOrBoard,
        boardCommissionId: b.boardCommissionId || null,
        employmentType: b.employmentType,
        description: b.description,
        qualifications: b.qualifications || null,
        status: b.status,
        closingDate: b.closingDate ? new Date(b.closingDate) : null,
      },
    });
    res.redirect("/admin/vacancies");
  } catch (err) {
    next(err);
  }
});

router.post("/admin/vacancies/:id/edit", requireAdmin, vacancyValidators, vacancyValidationGate, async (req, res, next) => {
  try {
    const b = req.body;
    await prisma.jobVacancy.update({
      where: { id: req.params.id },
      data: {
        title: b.title,
        category: b.category,
        departmentOrBoard: b.departmentOrBoard,
        boardCommissionId: b.boardCommissionId || null,
        employmentType: b.employmentType,
        description: b.description,
        qualifications: b.qualifications || null,
        status: b.status,
        closingDate: b.closingDate ? new Date(b.closingDate) : null,
      },
    });
    res.redirect("/admin/vacancies");
  } catch (err) {
    next(err);
  }
});

router.post("/admin/vacancies/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await prisma.jobVacancy.delete({ where: { id: req.params.id } });
    res.redirect("/admin/vacancies");
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- Boards & seats ------------------------------ */

router.get("/admin/boards", requireAdmin, async (req, res, next) => {
  try {
    const boards = await prisma.boardCommission.findMany({ orderBy: { name: "asc" }, include: { seats: true } });
    res.render("admin/board-members", { title: "Manage Boards & Commissions", boards });
  } catch (err) {
    next(err);
  }
});

// Lower-risk internal admin actions (board/seat management) redirect back
// on validation failure rather than re-rendering a full form — the source
// forms are also HTML5-required, so this is a defense-in-depth backstop
// against direct/malformed POSTs, not the primary UX path.
function redirectBackOnError(redirectTo) {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.redirect(typeof redirectTo === "function" ? redirectTo(req) : redirectTo);
  };
}

router.post(
  "/admin/boards/new",
  requireAdmin,
  [body("name").trim().notEmpty().isLength({ max: 200 }).escape(), body("totalSeats").isInt({ min: 0, max: 50 })],
  redirectBackOnError("/admin/boards"),
  async (req, res, next) => {
    try {
      await prisma.boardCommission.create({
        data: { name: req.body.name, description: req.body.description || null, totalSeats: Number(req.body.totalSeats) || 0 },
      });
      res.redirect("/admin/boards");
    } catch (err) {
      next(err);
    }
  }
);

router.post("/admin/boards/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await prisma.boardCommission.delete({ where: { id: req.params.id } });
    res.redirect("/admin/boards");
  } catch (err) {
    next(err);
  }
});

router.post(
  "/admin/boards/:id/seats/new",
  requireAdmin,
  [body("seatTitle").trim().notEmpty().isLength({ max: 100 }).escape()],
  redirectBackOnError("/admin/boards"),
  async (req, res, next) => {
    try {
      const b = req.body;
      await prisma.boardSeat.create({
        data: {
          boardCommissionId: req.params.id,
          seatTitle: b.seatTitle,
          memberName: b.memberName || null,
          appointedDate: b.appointedDate ? new Date(b.appointedDate) : null,
          termExpires: b.termExpires ? new Date(b.termExpires) : null,
          vacant: b.vacant === "on" || !b.memberName,
        },
      });
      res.redirect("/admin/boards");
    } catch (err) {
      next(err);
    }
  }
);

router.post("/admin/boards/:boardId/seats/:seatId/edit", requireAdmin, async (req, res, next) => {
  try {
    const b = req.body;
    await prisma.boardSeat.update({
      where: { id: req.params.seatId },
      data: {
        seatTitle: b.seatTitle,
        memberName: b.memberName || null,
        appointedDate: b.appointedDate ? new Date(b.appointedDate) : null,
        termExpires: b.termExpires ? new Date(b.termExpires) : null,
        vacant: b.vacant === "on" || !b.memberName,
      },
    });
    res.redirect("/admin/boards");
  } catch (err) {
    next(err);
  }
});

router.post("/admin/boards/:boardId/seats/:seatId/delete", requireAdmin, async (req, res, next) => {
  try {
    await prisma.boardSeat.delete({ where: { id: req.params.seatId } });
    res.redirect("/admin/boards");
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ Applications ------------------------------- */

router.get("/admin/applications/volunteer", requireAdmin, async (req, res, next) => {
  try {
    const apps = await prisma.volunteerApplication.findMany({ orderBy: { submittedAt: "desc" }, include: { vacancy: true } });
    res.render("admin/applications-volunteer", { title: "Volunteer Applications", apps });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/applications/volunteer/:id", requireAdmin, async (req, res, next) => {
  try {
    const app = await prisma.volunteerApplication.findUnique({ where: { id: req.params.id }, include: { vacancy: true } });
    if (!app) return res.status(404).render("errors/404", { title: "Not Found" });
    res.render("admin/application-volunteer-detail", { title: "Volunteer Application", app });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/applications/volunteer/:id/status", requireAdmin, async (req, res, next) => {
  try {
    await prisma.volunteerApplication.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    res.redirect(`/admin/applications/volunteer/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/applications/employment", requireAdmin, async (req, res, next) => {
  try {
    const apps = await prisma.employmentApplication.findMany({
      orderBy: { submittedAt: "desc" },
      include: { vacancy: true },
    });
    res.render("admin/applications-employment", { title: "Employment Applications", apps });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/applications/employment/:id", requireAdmin, async (req, res, next) => {
  try {
    const app = await prisma.employmentApplication.findUnique({ where: { id: req.params.id }, include: { vacancy: true } });
    if (!app) return res.status(404).render("errors/404", { title: "Not Found" });
    res.render("admin/application-employment-detail", { title: "Employment Application", app });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/applications/employment/:id/status", requireAdmin, async (req, res, next) => {
  try {
    await prisma.employmentApplication.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    res.redirect(`/admin/applications/employment/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Resume download — admin-only, streamed from the DB (never a public URL).
router.get("/admin/applications/employment/:id/resume", requireAdmin, async (req, res, next) => {
  try {
    const app = await prisma.employmentApplication.findUnique({ where: { id: req.params.id } });
    if (!app || !app.resumeFileData) return res.status(404).render("errors/404", { title: "Not Found" });
    res.setHeader("Content-Type", app.resumeFileType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${(app.resumeFileName || "resume").replace(/"/g, "")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(app.resumeFileData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
