const express = require("express");
const prisma = require("../db");
const { upload, MAX_UPLOAD_MB } = require("../middleware/upload");
const { submissionLimiter } = require("../middleware/security");
const { loadFormFields, readDynamicResponses } = require("../utils/dynamicForm");
const router = express.Router();

const COMPUTER_SKILLS = [
  "Word Processing",
  "Spreadsheets",
  "Databases",
  "Graphics",
  "Web Design",
  "Technology/Network",
  "Bookkeeping",
  "Accounting Systems",
  "Typing/Keyboard",
];

const EDUCATION_LEVELS = ["High School", "Vocational, Technical or Correspondence", "College/University", "Graduate/Professional"];

// Honeypot check shared by both forms: a hidden field named "company_website"
// that only a bot would fill in. Real applicants never see or complete it.
function honeypotTripped(req) {
  return Boolean(req.body.company_website && req.body.company_website.trim() !== "");
}

async function loadOpenVacancies(category) {
  return prisma.jobVacancy.findMany({ where: { status: "OPEN", category }, orderBy: { title: "asc" } });
}

/* ---------------------------- Volunteer form ---------------------------- */
// Every question on this form is admin-configurable (src/routes/admin.js
// "/admin/forms" builder) — the fields rendered here always come straight
// from the FormField table (formType: VOLUNTEER), not from a hardcoded list.

router.get("/volunteer-application", async (req, res, next) => {
  try {
    const [vacancies, fields] = await Promise.all([loadOpenVacancies("BOARD_COMMISSION"), loadFormFields("VOLUNTEER")]);
    res.render("volunteer-application", {
      title: "Volunteer Application",
      vacancies,
      fields,
      errors: {},
      values: {},
      vacancyId: req.query.vacancy || "",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/volunteer-application", submissionLimiter, async (req, res, next) => {
  try {
    const fields = await loadFormFields("VOLUNTEER");
    const { errors, responses } = readDynamicResponses(fields, req.body);

    if (Object.keys(errors).length) {
      const vacancies = await loadOpenVacancies("BOARD_COMMISSION");
      return res.status(422).render("volunteer-application", {
        title: "Volunteer Application",
        vacancies,
        fields,
        errors,
        values: responses,
        vacancyId: req.body.vacancyId || "",
      });
    }

    if (honeypotTripped(req)) {
      // Silently pretend success to bots; don't tip them off.
      return res.render("application-success", { title: "Application Received", kind: "volunteer" });
    }

    await prisma.volunteerApplication.create({
      data: {
        vacancyId: req.body.vacancyId || null,
        responses,
        submittedIp: req.ip,
      },
    });
    res.render("application-success", { title: "Application Received", kind: "volunteer" });
  } catch (err) {
    next(err);
  }
});

/* --------------------------- Employment form ----------------------------- */
// The front-matter questions (name, address, eligibility questions, referral
// source, military history, etc.) are admin-configurable the same way as the
// volunteer form. Employment history, education, computer skills, references,
// the resume upload, and the signature/acknowledgement block are fixed —
// they mirror the Town's official paper form and don't fit a single-value
// field model (repeating rows, file bytes, a server-set signature date). See
// the FormField model comment in schema.prisma.

router.get("/employment-application", async (req, res, next) => {
  try {
    const [vacancies, fields] = await Promise.all([loadOpenVacancies("TOWN_DEPARTMENT"), loadFormFields("EMPLOYMENT")]);
    res.render("employment-application", {
      title: "Employment Application",
      vacancies,
      fields,
      errors: {},
      values: {},
      vacancyId: req.query.vacancy || "",
      COMPUTER_SKILLS,
      EDUCATION_LEVELS,
      maxUploadMb: MAX_UPLOAD_MB,
    });
  } catch (err) {
    next(err);
  }
});

function toBool(v) {
  return v === "yes" || v === "on" || v === "true";
}

function collectRows(body, prefix, keys, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = {};
    let hasContent = false;
    for (const key of keys) {
      const fieldName = `${prefix}_${key}_${i}`;
      const val = body[fieldName];
      row[key] = val || "";
      if (val && String(val).trim() !== "") hasContent = true;
    }
    if (hasContent) rows.push(row);
  }
  return rows;
}

// Builds the Prisma `data` object for EmploymentApplication's FIXED sections
// only (everything that isn't a FormField-driven response) — employment
// history, education, computer skills, references, and the signature block.
// Shared between the public submit handler and the admin edit screen
// (src/routes/admin.js) so the two never drift out of sync.
function employmentFixedDataFromBody(b) {
  const employmentHistory = collectRows(
    b,
    "emp",
    ["employerName", "address", "jobTitle", "datesFrom", "datesTo", "workPerformed", "supervisor", "mayContact", "reasonLeaving"],
    3
  );

  const education = EDUCATION_LEVELS.map((level, i) => ({
    level,
    school: b[`edu_school_${i}`] || "",
    dates: b[`edu_dates_${i}`] || "",
    diploma: b[`edu_diploma_${i}`] || "",
    graduated: b[`edu_graduated_${i}`] === "yes",
  })).filter((row) => row.school || row.dates || row.diploma);

  const computerSkills = {};
  for (const skill of COMPUTER_SKILLS) {
    const level = b[`skill_${skill}`];
    if (level) computerSkills[skill] = level;
  }

  const references = collectRows(b, "ref", ["name", "address", "phone"], 3);

  return {
    employmentHistory,
    volunteerWorkHistory: b.volunteerWorkHistory || null,
    education,
    specializedTraining: b.specializedTraining || null,
    computerSkills,
    references,
    signatureTypedName: b.signatureTypedName,
    signatureDate: new Date(),
    acknowledged: b.acknowledged === "on",
  };
}

function validateEmploymentFixedFields(b) {
  const errors = {};
  if (!b.signatureTypedName || !String(b.signatureTypedName).trim()) {
    errors.signatureTypedName = { msg: "Please type your full name as your signature." };
  }
  if (b.acknowledged !== "on") {
    errors.acknowledged = { msg: "You must acknowledge and certify the statements above before submitting." };
  }
  return errors;
}

router.post("/employment-application", submissionLimiter, upload.single("resume"), async (req, res, next) => {
  const rerenderWithErrors = async (errors) => {
    const vacancies = await loadOpenVacancies("TOWN_DEPARTMENT");
    const fields = await loadFormFields("EMPLOYMENT");
    return res.status(422).render("employment-application", {
      title: "Employment Application",
      vacancies,
      fields,
      errors,
      values: req.body,
      vacancyId: req.body.vacancyId || "",
      COMPUTER_SKILLS,
      EDUCATION_LEVELS,
      maxUploadMb: MAX_UPLOAD_MB,
    });
  };

  try {
    const fields = await loadFormFields("EMPLOYMENT");
    const { errors: dynamicErrors, responses } = readDynamicResponses(fields, req.body);
    const fixedErrors = validateEmploymentFixedFields(req.body);
    const errors = { ...dynamicErrors, ...fixedErrors };

    if (Object.keys(errors).length) {
      return rerenderWithErrors(errors);
    }

    if (honeypotTripped(req)) {
      return res.render("application-success", { title: "Application Received", kind: "employment" });
    }

    const data = {
      vacancyId: req.body.vacancyId || null,
      responses,
      ...employmentFixedDataFromBody(req.body),
      submittedIp: req.ip,
    };

    if (req.file) {
      data.resumeFileName = req.file.originalname.slice(0, 200);
      data.resumeFileType = req.file.mimetype;
      data.resumeFileData = req.file.buffer;
    }

    await prisma.employmentApplication.create({ data });
    res.render("application-success", { title: "Application Received", kind: "employment" });
  } catch (err) {
    if (err.message && err.message.includes("resumes are accepted")) {
      return rerenderWithErrors({ resume: { msg: err.message } });
    }
    next(err);
  }
});

// Shared with src/routes/admin.js (submission-editing screens) so the field
// list, JSON-row parsing, and fixed-section logic live in exactly one place.
// `router` is a function, so it can carry these as properties without
// changing how app.js consumes this module (`app.use(applicationRoutes)`).
router.COMPUTER_SKILLS = COMPUTER_SKILLS;
router.EDUCATION_LEVELS = EDUCATION_LEVELS;
router.toBool = toBool;
router.collectRows = collectRows;
router.employmentFixedDataFromBody = employmentFixedDataFromBody;
router.validateEmploymentFixedFields = validateEmploymentFixedFields;

module.exports = router;
