const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");
const prisma = require("../db");
const { requireAdmin, requireRole } = require("../middleware/auth");
const { handleValidation } = require("../middleware/validate");
const { loginLimiter } = require("../middleware/security");
const { sanitizeRichText } = require("../utils/richText");
const { loadFormFields, readDynamicResponses } = require("../utils/dynamicForm");
const applicationRoutes = require("./applications");
const {
  COMPUTER_SKILLS,
  EDUCATION_LEVELS,
  employmentFixedDataFromBody,
  validateEmploymentFixedFields,
} = applicationRoutes;
const router = express.Router();

function generateTempPassword() {
  // 16 random bytes, base64url-ish, trimmed to a typeable length.
  return crypto.randomBytes(12).toString("base64").replace(/[+/=]/g, "").slice(0, 14);
}

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
        req.session.adminUser = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        };
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

/* ------------------------------ Own account ------------------------------- */
// Note: requireAdmin lets these two routes through even when
// mustChangePassword is set — otherwise nobody could ever clear the flag.

router.get("/admin/account/password", requireAdmin, (req, res) => {
  res.render("admin/change-password", {
    title: "Change Password",
    errors: {},
    forced: Boolean(req.session.adminUser.mustChangePassword),
  });
});

router.post(
  "/admin/account/password",
  requireAdmin,
  [
    body("currentPassword").notEmpty().withMessage("Current password is required."),
    body("newPassword").isLength({ min: 10 }).withMessage("New password must be at least 10 characters."),
    body("confirmPassword").custom((value, { req }) => value === req.body.newPassword).withMessage("Passwords do not match."),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const forced = Boolean(req.session.adminUser.mustChangePassword);
      if (!errors.isEmpty()) {
        return res.status(422).render("admin/change-password", { title: "Change Password", errors: errors.mapped(), forced });
      }
      const user = await prisma.adminUser.findUnique({ where: { id: req.session.adminUser.id } });
      const ok = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
      if (!ok) {
        return res.status(401).render("admin/change-password", {
          title: "Change Password",
          errors: { currentPassword: { msg: "Current password is incorrect." } },
          forced,
        });
      }
      const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
      req.session.adminUser.mustChangePassword = false;
      res.redirect("/admin");
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------ Staff accounts ----------------------------- */
// ADMINISTRATOR-only: create/manage other admin & staff logins. STAFF accounts
// can do everything else in this file (vacancies, boards, applications) but
// cannot reach any /admin/staff route.

router.get("/admin/staff", requireAdmin, requireRole("ADMINISTRATOR"), async (req, res, next) => {
  try {
    const staff = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
    res.render("admin/staff", { title: "Staff Accounts", staff, generatedPassword: null, errors: {} });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/admin/staff/new",
  requireAdmin,
  requireRole("ADMINISTRATOR"),
  [
    body("name").trim().notEmpty().withMessage("Name is required.").isLength({ max: 150 }).escape(),
    body("email").trim().isEmail().withMessage("A valid email is required.").normalizeEmail(),
    body("role").isIn(["ADMINISTRATOR", "STAFF"]),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const staff = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
      if (!errors.isEmpty()) {
        return res.status(422).render("admin/staff", { title: "Staff Accounts", staff, generatedPassword: null, errors: errors.mapped() });
      }
      const existing = await prisma.adminUser.findUnique({ where: { email: req.body.email } });
      if (existing) {
        return res.status(422).render("admin/staff", {
          title: "Staff Accounts",
          staff,
          generatedPassword: null,
          errors: { email: { msg: "An account with that email already exists." } },
        });
      }
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const created = await prisma.adminUser.create({
        data: { name: req.body.name, email: req.body.email, role: req.body.role, passwordHash, mustChangePassword: true },
      });
      const refreshedStaff = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
      // The temp password is shown exactly once, here, and never stored in
      // plaintext or logged — share it with the new staff member out of band.
      res.render("admin/staff", {
        title: "Staff Accounts",
        staff: refreshedStaff,
        generatedPassword: { email: created.email, password: tempPassword },
        errors: {},
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/admin/staff/:id/toggle-active", requireAdmin, requireRole("ADMINISTRATOR"), async (req, res, next) => {
  try {
    if (req.params.id === req.session.adminUser.id) {
      return res.redirect("/admin/staff"); // can't deactivate yourself
    }
    const user = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).render("errors/404", { title: "Not Found" });
    await prisma.adminUser.update({ where: { id: user.id }, data: { active: !user.active } });
    res.redirect("/admin/staff");
  } catch (err) {
    next(err);
  }
});

router.post("/admin/staff/:id/reset-password", requireAdmin, requireRole("ADMINISTRATOR"), async (req, res, next) => {
  try {
    const user = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).render("errors/404", { title: "Not Found" });
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true } });
    const staff = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
    res.render("admin/staff", {
      title: "Staff Accounts",
      staff,
      generatedPassword: { email: user.email, password: tempPassword },
      errors: {},
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ Form builder ------------------------------- */
// Lets admins fully own the question set on the public Volunteer and
// Employment application forms: add, remove, relabel, and reorder fields.
// Employment's repeating sections (work history, education, computer
// skills, references), resume upload, and signature/acknowledgement are
// NOT editable here — see the FormField model comment in schema.prisma.

function requireValidFormType(req, res, next) {
  if (!["VOLUNTEER", "EMPLOYMENT"].includes(req.params.formType)) {
    return res.status(404).render("errors/404", { title: "Not Found" });
  }
  next();
}

const FIELD_TYPES = ["TEXT", "TEXTAREA", "EMAIL", "TEL", "DATE", "NUMBER", "SELECT", "RADIO", "CHECKBOX_GROUP", "CHECKBOX_SINGLE", "SECTION_HEADER", "PARAGRAPH"];
const FIELD_TYPES_WITH_OPTIONS = ["SELECT", "RADIO", "CHECKBOX_GROUP"];

router.get("/admin/forms", requireAdmin, async (req, res, next) => {
  try {
    const [volunteerCount, employmentCount] = await Promise.all([
      prisma.formField.count({ where: { formType: "VOLUNTEER" } }),
      prisma.formField.count({ where: { formType: "EMPLOYMENT" } }),
    ]);
    res.render("admin/forms", { title: "Application Forms", volunteerCount, employmentCount });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/forms/:formType/edit", requireAdmin, requireValidFormType, async (req, res, next) => {
  try {
    const fields = await prisma.formField.findMany({ where: { formType: req.params.formType }, orderBy: { order: "asc" } });
    res.render("admin/form-builder", {
      title: (req.params.formType === "VOLUNTEER" ? "Volunteer" : "Employment") + " Application Form",
      formType: req.params.formType,
      fields,
      fieldTypes: FIELD_TYPES,
      fieldTypesWithOptions: FIELD_TYPES_WITH_OPTIONS,
      editingField: null,
      newFieldValues: null,
      errors: {},
    });
  } catch (err) {
    next(err);
  }
});

function parseOptions(raw) {
  // Textarea, one option per line.
  if (!raw) return null;
  const list = String(raw)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

// mode: "add" reopens the "add a field" panel with the submitted values;
// "edit" reopens the specific field's edit panel (identified by fieldId).
async function renderBuilderWithError(req, res, errors, mode, fieldId) {
  const fields = await prisma.formField.findMany({ where: { formType: req.params.formType }, orderBy: { order: "asc" } });
  return res.status(422).render("admin/form-builder", {
    title: (req.params.formType === "VOLUNTEER" ? "Volunteer" : "Employment") + " Application Form",
    formType: req.params.formType,
    fields,
    fieldTypes: FIELD_TYPES,
    fieldTypesWithOptions: FIELD_TYPES_WITH_OPTIONS,
    editingField: mode === "edit" ? { id: fieldId, ...req.body } : null,
    newFieldValues: mode === "add" ? req.body : null,
    errors,
  });
}

router.post(
  "/admin/forms/:formType/fields",
  requireAdmin,
  requireValidFormType,
  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("A machine name is required.")
      .matches(/^[a-zA-Z][a-zA-Z0-9_]*$/)
      .withMessage("Name must start with a letter and contain only letters, numbers, and underscores."),
    body("label").trim().notEmpty().withMessage("A label is required.").isLength({ max: 300 }),
    body("fieldType").isIn(FIELD_TYPES),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return renderBuilderWithError(req, res, errors.mapped(), "add");
      }
      const existing = await prisma.formField.findUnique({
        where: { formType_name: { formType: req.params.formType, name: req.body.name } },
      });
      if (existing) {
        return renderBuilderWithError(req, res, { name: { msg: "A field with that name already exists on this form." } }, "add");
      }
      const maxOrder = await prisma.formField.aggregate({
        where: { formType: req.params.formType },
        _max: { order: true },
      });
      await prisma.formField.create({
        data: {
          formType: req.params.formType,
          name: req.body.name,
          label: req.body.label,
          fieldType: req.body.fieldType,
          required: req.body.required === "on",
          helpText: req.body.helpText || null,
          options: FIELD_TYPES_WITH_OPTIONS.includes(req.body.fieldType) ? parseOptions(req.body.options) : null,
          order: (maxOrder._max.order ?? -1) + 1,
        },
      });
      res.redirect(`/admin/forms/${req.params.formType}/edit`);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/admin/forms/:formType/fields/:id",
  requireAdmin,
  requireValidFormType,
  [
    body("label").trim().notEmpty().withMessage("A label is required.").isLength({ max: 300 }),
    body("fieldType").isIn(FIELD_TYPES),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return renderBuilderWithError(req, res, errors.mapped(), "edit", req.params.id);
      }
      await prisma.formField.update({
        where: { id: req.params.id },
        data: {
          label: req.body.label,
          fieldType: req.body.fieldType,
          required: req.body.required === "on",
          helpText: req.body.helpText || null,
          options: FIELD_TYPES_WITH_OPTIONS.includes(req.body.fieldType) ? parseOptions(req.body.options) : null,
        },
      });
      res.redirect(`/admin/forms/${req.params.formType}/edit`);
    } catch (err) {
      next(err);
    }
  }
);

router.post("/admin/forms/:formType/fields/:id/delete", requireAdmin, requireValidFormType, async (req, res, next) => {
  try {
    await prisma.formField.delete({ where: { id: req.params.id } });
    res.redirect(`/admin/forms/${req.params.formType}/edit`);
  } catch (err) {
    next(err);
  }
});

// Drag-and-drop reorder — called via fetch() from public/js/form-builder.js
// with a JSON body { _csrf, order: [fieldId, fieldId, ...] }.
router.post("/admin/forms/:formType/reorder", requireAdmin, requireValidFormType, async (req, res, next) => {
  try {
    const order = Array.isArray(req.body.order) ? req.body.order : [];
    await prisma.$transaction(
      order.map((id, index) => prisma.formField.update({ where: { id }, data: { order: index } }))
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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
  // description/qualifications are rich-text HTML from the admin editor —
  // NOT escaped here (that would turn "<" into "&lt;" and break the tags);
  // they're run through sanitize-html at save time instead (see below).
  body("description").trim().notEmpty().isLength({ max: 8000 }),
  body("qualifications").optional({ checkFalsy: true }).isLength({ max: 5000 }),
  body("payType").optional({ checkFalsy: true }).isIn(["HOURLY", "SALARIED", "STIPEND", "UNPAID", "OTHER"]),
  body("payMin").optional({ checkFalsy: true }).isFloat({ min: 0, max: 10000000 }),
  body("payMax").optional({ checkFalsy: true }).isFloat({ min: 0, max: 10000000 }),
  body("payNote").optional({ checkFalsy: true }).trim().isLength({ max: 200 }).escape(),
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

function vacancyDataFromBody(b) {
  return {
    title: b.title,
    category: b.category,
    departmentOrBoard: b.departmentOrBoard,
    boardCommissionId: b.boardCommissionId || null,
    employmentType: b.employmentType,
    description: sanitizeRichText(b.description),
    qualifications: b.qualifications ? sanitizeRichText(b.qualifications) : null,
    payType: b.payType || null,
    payMin: b.payMin ? Number(b.payMin) : null,
    payMax: b.payMax ? Number(b.payMax) : null,
    payNote: b.payNote || null,
    status: b.status,
    closingDate: b.closingDate ? new Date(b.closingDate) : null,
  };
}

router.post("/admin/vacancies/new", requireAdmin, vacancyValidators, vacancyValidationGate, async (req, res, next) => {
  try {
    await prisma.jobVacancy.create({ data: vacancyDataFromBody(req.body) });
    res.redirect("/admin/vacancies");
  } catch (err) {
    next(err);
  }
});

router.post("/admin/vacancies/:id/edit", requireAdmin, vacancyValidators, vacancyValidationGate, async (req, res, next) => {
  try {
    await prisma.jobVacancy.update({ where: { id: req.params.id }, data: vacancyDataFromBody(req.body) });
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
    const fields = await loadFormFields("VOLUNTEER");
    res.render("admin/application-volunteer-detail", { title: "Volunteer Application", app, fields });
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

router.get("/admin/applications/volunteer/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const [app, vacancies, fields] = await Promise.all([
      prisma.volunteerApplication.findUnique({ where: { id: req.params.id } }),
      prisma.jobVacancy.findMany({ where: { category: "BOARD_COMMISSION" }, orderBy: { title: "asc" } }),
      loadFormFields("VOLUNTEER"),
    ]);
    if (!app) return res.status(404).render("errors/404", { title: "Not Found" });
    res.render("admin/application-volunteer-edit", {
      title: "Edit Volunteer Application",
      appId: app.id,
      vacancyId: app.vacancyId || "",
      values: app.responses || {},
      fields,
      vacancies,
      errors: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/applications/volunteer/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.volunteerApplication.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).render("errors/404", { title: "Not Found" });

    const fields = await loadFormFields("VOLUNTEER");
    const { errors, responses } = readDynamicResponses(fields, req.body);

    if (Object.keys(errors).length) {
      const vacancies = await prisma.jobVacancy.findMany({ where: { category: "BOARD_COMMISSION" }, orderBy: { title: "asc" } });
      return res.status(422).render("admin/application-volunteer-edit", {
        title: "Edit Volunteer Application",
        appId: req.params.id,
        vacancyId: req.body.vacancyId || "",
        values: req.body,
        fields,
        vacancies,
        errors,
      });
    }

    await prisma.volunteerApplication.update({
      where: { id: req.params.id },
      data: { vacancyId: req.body.vacancyId || null, responses },
    });
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
    const fields = await loadFormFields("EMPLOYMENT");
    res.render("admin/application-employment-detail", { title: "Employment Application", app, fields });
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

// The employment form's FIXED-section field names are flat (emp_employerName_0,
// edu_school_1, "skill_Word Processing", ref_name_0, ...) because that's what
// the repeating paper-form sections need. The DB stores those sections as
// JSON, so re-editing requires converting DB shape -> flat form-field shape.
// Admin-configurable questions (everything else) are already flat — they
// live in app.responses keyed by FormField.name — so they pass through as-is.
// Doing the fixed-section conversion once here means the GET (load from DB)
// and POST-with-errors (re-render what the admin just typed) paths can share
// one template that only ever reads a flat `values` object, same pattern the
// public form uses.
function employmentAppToFormValues(app) {
  const values = { ...(app.responses || {}) };
  values.volunteerWorkHistory = app.volunteerWorkHistory || "";
  values.specializedTraining = app.specializedTraining || "";
  values.signatureTypedName = app.signatureTypedName || "";

  (app.employmentHistory || []).forEach((row, i) => {
    values[`emp_employerName_${i}`] = row.employerName || "";
    values[`emp_address_${i}`] = row.address || "";
    values[`emp_jobTitle_${i}`] = row.jobTitle || "";
    values[`emp_datesFrom_${i}`] = row.datesFrom || "";
    values[`emp_datesTo_${i}`] = row.datesTo || "";
    values[`emp_workPerformed_${i}`] = row.workPerformed || "";
    values[`emp_supervisor_${i}`] = row.supervisor || "";
    values[`emp_mayContact_${i}`] = row.mayContact || "";
    values[`emp_reasonLeaving_${i}`] = row.reasonLeaving || "";
  });

  (app.education || []).forEach((row) => {
    const i = EDUCATION_LEVELS.indexOf(row.level);
    if (i === -1) return;
    values[`edu_school_${i}`] = row.school || "";
    values[`edu_dates_${i}`] = row.dates || "";
    values[`edu_diploma_${i}`] = row.diploma || "";
    values[`edu_graduated_${i}`] = row.graduated ? "yes" : "no";
  });

  for (const [skill, level] of Object.entries(app.computerSkills || {})) {
    values[`skill_${skill}`] = level;
  }

  (app.references || []).forEach((row, i) => {
    values[`ref_name_${i}`] = row.name || "";
    values[`ref_address_${i}`] = row.address || "";
    values[`ref_phone_${i}`] = row.phone || "";
  });

  return values;
}

router.get("/admin/applications/employment/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const [app, vacancies, fields] = await Promise.all([
      prisma.employmentApplication.findUnique({ where: { id: req.params.id } }),
      prisma.jobVacancy.findMany({ where: { category: "TOWN_DEPARTMENT" }, orderBy: { title: "asc" } }),
      loadFormFields("EMPLOYMENT"),
    ]);
    if (!app) return res.status(404).render("errors/404", { title: "Not Found" });
    res.render("admin/application-employment-edit", {
      title: "Edit Employment Application",
      appId: app.id,
      vacancyId: app.vacancyId || "",
      hasResume: Boolean(app.resumeFileName),
      resumeFileName: app.resumeFileName,
      values: employmentAppToFormValues(app),
      fields,
      vacancies,
      errors: {},
      COMPUTER_SKILLS,
      EDUCATION_LEVELS,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/applications/employment/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.employmentApplication.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).render("errors/404", { title: "Not Found" });

    const fields = await loadFormFields("EMPLOYMENT");
    const { errors, responses } = readDynamicResponses(fields, req.body);

    if (Object.keys(errors).length) {
      const vacancies = await prisma.jobVacancy.findMany({ where: { category: "TOWN_DEPARTMENT" }, orderBy: { title: "asc" } });
      return res.status(422).render("admin/application-employment-edit", {
        title: "Edit Employment Application",
        appId: req.params.id,
        vacancyId: req.body.vacancyId || "",
        hasResume: Boolean(existing.resumeFileName),
        resumeFileName: existing.resumeFileName,
        values: { ...req.body, signatureTypedName: existing.signatureTypedName },
        fields,
        vacancies,
        errors,
        COMPUTER_SKILLS,
        EDUCATION_LEVELS,
      });
    }

    // Editing corrects contact/history details — it does not re-execute the
    // applicant's original legal acknowledgement/signature or touch their
    // uploaded resume, so those are preserved from the existing record and
    // aren't collected on this form at all.
    const fixedData = employmentFixedDataFromBody(req.body);
    delete fixedData.signatureDate;
    delete fixedData.signatureTypedName;
    delete fixedData.acknowledged;

    await prisma.employmentApplication.update({
      where: { id: req.params.id },
      data: {
        vacancyId: req.body.vacancyId || null,
        responses,
        ...fixedData,
      },
    });
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
