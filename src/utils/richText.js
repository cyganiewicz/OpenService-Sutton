const sanitizeHtml = require("sanitize-html");

// Allowlist for admin-authored rich text (vacancy description/qualifications).
// Deliberately narrow: enough for basic formatting, nothing that could carry
// script/style-based XSS. Applied server-side on every save, regardless of
// what the browser-side editor produced — never trust the client.
const RICH_TEXT_OPTIONS = {
  allowedTags: ["p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "a"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
  },
};

function sanitizeRichText(html) {
  if (!html) return html;
  return sanitizeHtml(html, RICH_TEXT_OPTIONS).trim();
}

module.exports = { sanitizeRichText };
