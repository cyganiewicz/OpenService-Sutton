const express = require("express");
const { body, validationResult } = require("express-validator");
const prisma = require("../db");
const { upload, MAX_UPLOAD_MB } = require("../middleware/upload");
const { submissionLimiter } = require("../middleware/security");
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

router.get("/volunteer-application", async (req, res, next) => {
  try {
    const vacancies = await loadOpenVacancies("BOARD_COMMISSION");
    res.render("volunteer-application", { title: "Volunteer Application", vacancies, errors: {}, values: { vacancyId: req.query.vacancy || "" } });
  } catch (err) {
    next(err);
  }
});

const volunteerValidators = [
  body("firstName").trim().notEmpty().withMessage("First name is required.").isLength({ max: 100 }).escape(),
  body("lastName").trim().notEmpty().withMessage("Last name is required.").isLength({ max: 100 }).escape(),
  body("email").trim().isEmail().withMessage("A valid email is required.").normalizeEmail(),
  body("phone").trim().notEmpty().withMessage("Phone number is required.").isLength({ max: 30 }).escape(),
  body("addressStreet").trim().notEmpty().withMessage("Street address is required.").isLength({ max: 200 }).escape(),
  body("addressCity").trim().notEmpty().withMessage("City/Town is required.").isLength({ max: 100 }).escape(),
  body("addressState").trim().notEmpty().isLength({ max: 2 }).escape(),
  body("addressZip").trim().notEmpty().withMessage("ZIP code is required.").isLength({ max: 10 }).escape(),
  body("boardsInterestedIn").trim().notEmpty().withMessage("Please tell us which board(s) or commission(s) interest you.").isLength({ max: 500 }).escape(),
  body("availability").optional({ checkFalsy: true }).isLength({ max: 500 }).escape(),
  body("relevantExperience").optional({ checkFalsy: true }).isLength({ max: 3000 }).escape(),
  body("whyInterested").optional({ checkFalsy: true }).isLength({ max: 3000 }).escape(),
  body("referralSource").optional({ checkFalsy: true }).isLength({ max: 200 }).escape(),
  body("vacancyId").optional({ checkFalsy: true }).isString(),
];

// Re-renders the form with field errors + prior input on validation failure.
// Defined inline (rather than as generic middleware) because the form needs
// a fresh, request-time fetch of open vacancies for its dropdown — that data
// can't be captured statically when the route is registered at startup.
async function volunteerValidationGate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const vacancies = await loadOpenVacancies("BOARD_COMMISSION");
  return res.status(422).render("volunteer-application", {
    title: "Volunteer Application",
    vacancies,
    errors: errors.mapped(),
    values: req.body,
  });
}

router.post(
  "/volunteer-application",
  submissionLimiter,
  volunteerValidators,
  volunteerValidationGate,
  async (req, res, next) => {
    try {
      if (honeypotTripped(req)) {
        // Silently pretend success to bots; don't tip them off.
        return res.render("application-success", { title: "Application Received", kind: "volunteer" });
      }
      const b = req.body;
      await prisma.volunteerApplication.create({
        data: {
          vacancyId: b.vacancyId || null,
          boardsInterestedIn: b.boardsInterestedIn,
          firstName: b.firstName,
          lastName: b.lastName,
          email: b.email,
          phone: b.phone,
          addressStreet: b.addressStreet,
          addressCity: b.addressCity,
          addressState: b.addressState || "MA",
          addressZip: b.addressZip,
          availability: b.availability || null,
          relevantExperience: b.relevantExperience || null,
          whyInterested: b.whyInterested || null,
          referralSource: b.referralSource || null,
          submittedIp: req.ip,
        },
      });
      res.render("application-success", { title: "Application Received", kind: "volunteer" });
    } catch (err) {
      next(err);
    }
  }
);

/* --------------------------- Employment form ----------------------------- */

router.get("/employment-application", async (req, res, next) => {
  try {
    const vacancies = await loadOpenVacancies("TOWN_DEPARTMENT");
    res.render("employment-application", {
      title: "Employment Application",
      vacancies,
      errors: {},
      values: { vacancyId: req.query.vacancy || "" },
      COMPUTER_SKILLS,
      EDUCATION_LEVELS,
      maxUploadMb: MAX_UPLOAD_MB,
    });
  } catch (err) {
    next(err);
  }
});

const employmentValidators = [
  body("lastName").trim().notEmpty().withMessage("Last name is required.").isLength({ max: 100 }).escape(),
  body("firstName").trim().notEmpty().withMessage("First name is required.").isLength({ max: 100 }).escape(),
  body("middleName").optional({ checkFalsy: true }).isLength({ max: 100 }).escape(),
  body("addressStreet").trim().notEmpty().withMessage("Street address is required.").isLength({ max: 200 }).escape(),
  body("addressCity").trim().notEmpty().withMessage("City/Town is required.").isLength({ max: 100 }).escape(),
  body("addressState").trim().notEmpty().isLength({ max: 2 }).escape(),
  body("addressZip").trim().notEmpty().withMessage("ZIP code is required.").isLength({ max: 10 }).escape(),
  body("email").trim().isEmail().withMessage("A valid email is required.").normalizeEmail(),
  body("workEligible").notEmpty().withMessage("Please answer the work-eligibility question."),
  body("ageEighteenOrOlder").notEmpty().withMessage("Please answer the age question."),
  body("workedForTownBefore").notEmpty().withMessage("Please answer whether you've worked for the Town before."),
  body("capableOfDuties").notEmpty().withMessage("Please answer the duties question."),
  body("currentlyEmployed").notEmpty(),
  body("onLayoffRecall").notEmpty(),
  body("signatureTypedName").trim().notEmpty().withMessage("Please type your full name as your signature."),
  body("acknowledged")
    .equals("on")
    .withMessage("You must acknowledge and certify the statements above before submitting."),
];

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

async function employmentValidationGate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const vacancies = await loadOpenVacancies("TOWN_DEPARTMENT");
  return res.status(422).render("employment-application", {
    title: "Employment Application",
    vacancies,
    errors: errors.mapped(),
    values: req.body,
    COMPUTER_SKILLS,
    EDUCATION_LEVELS,
    maxUploadMb: MAX_UPLOAD_MB,
  });
}

router.post(
  "/employment-application",
  submissionLimiter,
  upload.single("resume"),
  employmentValidators,
  employmentValidationGate,
  async (req, res, next) => {
    try {
      if (honeypotTripped(req)) {
        return res.render("application-success", { title: "Application Received", kind: "employment" });
      }
      const b = req.body;

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

      const data = {
        vacancyId: b.vacancyId || null,
        referralSource: b.referralSource || null,
        lastName: b.lastName,
        firstName: b.firstName,
        middleName: b.middleName || null,
        addressStreet: b.addressStreet,
        addressCity: b.addressCity,
        addressState: b.addressState || "MA",
        addressZip: b.addressZip,
        email: b.email,
        phoneHome: b.phoneHome || null,
        phoneCell: b.phoneCell || null,
        workEligible: toBool(b.workEligible),
        ageEighteenOrOlder: toBool(b.ageEighteenOrOlder),
        workedForTownBefore: toBool(b.workedForTownBefore),
        priorEmploymentFrom: b.priorEmploymentFrom || null,
        priorEmploymentTo: b.priorEmploymentTo || null,
        priorDepartment: b.priorDepartment || null,
        capableOfDuties: toBool(b.capableOfDuties),
        incapableDutiesDetail: b.incapableDutiesDetail || null,
        currentlyEmployed: toBool(b.currentlyEmployed),
        onLayoffRecall: toBool(b.onLayoffRecall),
        employmentHistory,
        volunteerWorkHistory: b.volunteerWorkHistory || null,
        education,
        specializedTraining: b.specializedTraining || null,
        additionalInfo: b.additionalInfo || null,
        computerSkills,
        veteran: toBool(b.veteran),
        militaryBranch: b.militaryBranch || null,
        militaryRankDischarged: b.militaryRankDischarged || null,
        militaryDischargeStatus: b.militaryDischargeStatus || null,
        presentMilitaryStatus: b.presentMilitaryStatus || null,
        militaryServiceSchool: b.militaryServiceSchool || null,
        civicActivities: b.civicActivities || null,
        references,
        signatureTypedName: b.signatureTypedName,
        signatureDate: new Date(),
        acknowledged: b.acknowledged === "on",
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
        return res.status(422).render("employment-application", {
          title: "Employment Application",
          vacancies: await loadOpenVacancies("TOWN_DEPARTMENT"),
          errors: { resume: { msg: err.message } },
          values: req.body,
          COMPUTER_SKILLS,
          EDUCATION_LEVELS,
          maxUploadMb: MAX_UPLOAD_MB,
        });
      }
      next(err);
    }
  }
);

module.exports = router;
