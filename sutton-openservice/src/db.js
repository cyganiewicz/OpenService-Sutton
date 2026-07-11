const { PrismaClient } = require("@prisma/client");

// Single shared Prisma client instance (avoids exhausting DB connections
// via hot-reload / multiple instantiations).
const prisma = global.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

module.exports = prisma;
