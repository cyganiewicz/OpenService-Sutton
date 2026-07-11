require("dotenv").config();

// Fail fast in production if critical secrets are missing/default —
// better a crash-on-boot than a site quietly running unprotected.
function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production") {
  ["DATABASE_URL", "SESSION_SECRET", "CSRF_SECRET"].forEach(requireEnv);
  if (process.env.SESSION_SECRET.includes("replace-with")) {
    console.error("SESSION_SECRET is still set to the placeholder value. Refusing to start.");
    process.exit(1);
  }
}

const app = require("./app");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`OpenService running on port ${PORT} (${process.env.NODE_ENV || "development"})`);
});
