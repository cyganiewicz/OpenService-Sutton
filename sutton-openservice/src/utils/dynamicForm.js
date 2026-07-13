/**
 * Shared logic for reading/validating the responses to an admin-configured
 * form (FormField rows) — used by the public submit routes (src/routes/applications.js)
 * and the admin submission-edit routes (src/routes/admin.js) so both stay in sync.
 */
const prisma = require("../db");

async function loadFormFields(formType) {
  return prisma.formField.findMany({ where: { formType }, orderBy: { order: "asc" } });
}

const MAX_TEXT = 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reads + validates req.body against a list of FormField rows. Returns
// { errors: { [fieldName]: { msg } }, responses: { [fieldName]: value } }.
// `responses` only contains real, non-layout fields (SECTION_HEADER and
// PARAGRAPH are display-only and never collect a value).
function readDynamicResponses(fields, body) {
  const errors = {};
  const responses = {};

  for (const field of fields) {
    if (field.fieldType === "SECTION_HEADER" || field.fieldType === "PARAGRAPH") continue;

    if (field.fieldType === "CHECKBOX_GROUP") {
      const raw = body[field.name];
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (field.required && list.length === 0) {
        errors[field.name] = { msg: `${field.label} is required.` };
      }
      responses[field.name] = list;
      continue;
    }

    if (field.fieldType === "CHECKBOX_SINGLE") {
      const checked = body[field.name] === "on" || body[field.name] === "true" || body[field.name] === true;
      if (field.required && !checked) {
        errors[field.name] = { msg: `${field.label} is required.` };
      }
      responses[field.name] = checked;
      continue;
    }

    let value = typeof body[field.name] === "string" ? body[field.name].trim() : body[field.name] || "";
    value = String(value).slice(0, MAX_TEXT);

    if (field.required && value === "") {
      errors[field.name] = { msg: `${field.label} is required.` };
    } else if (field.fieldType === "EMAIL" && value !== "" && !EMAIL_RE.test(value)) {
      errors[field.name] = { msg: `${field.label} must be a valid email address.` };
    } else if ((field.fieldType === "SELECT" || field.fieldType === "RADIO") && value !== "" && Array.isArray(field.options) && !field.options.includes(value)) {
      errors[field.name] = { msg: `${field.label} must be one of the listed options.` };
    }

    responses[field.name] = value;
  }

  return { errors, responses };
}

module.exports = { loadFormFields, readDynamicResponses };
