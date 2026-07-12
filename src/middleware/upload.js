const multer = require("multer");

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);

// Memory storage: the file never touches disk on the server. We validate,
// then persist the bytes directly into Postgres (Railway's filesystem is
// ephemeral, so storing on disk would lose resumes on every redeploy).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Only PDF or Word (.doc/.docx) resumes are accepted."));
    }
    cb(null, true);
  },
});

module.exports = { upload, MAX_UPLOAD_MB };
