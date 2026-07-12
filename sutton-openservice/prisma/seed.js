/**
 * Seeds an initial admin account and a small set of example boards/commissions
 * and vacancies so the site is populated on first deploy. Town staff should
 * edit/replace this sample data from the Admin panel.
 *
 * Run with: npm run seed
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const name = process.env.ADMIN_BOOTSTRAP_NAME || "Town Administrator";

  if (!email || !password) {
    console.log("ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD not set — skipping admin bootstrap.");
  } else {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.adminUser.create({
        data: { email, passwordHash, name, role: "ADMINISTRATOR" },
      });
      console.log(`Created initial admin account: ${email}`);
      console.log("IMPORTANT: log in and change this password immediately.");
    } else {
      console.log(`Admin account ${email} already exists — skipping.`);
    }
  }

  const planning = await prisma.boardCommission.upsert({
    where: { name: "Planning Board" },
    update: {},
    create: {
      name: "Planning Board",
      description: "Oversees land use planning, subdivision control, and zoning bylaw recommendations.",
      totalSeats: 5,
      seats: {
        create: [
          { seatTitle: "Chair", memberName: "Sample Member A", appointedDate: new Date("2023-06-01"), termExpires: new Date("2026-06-01") },
          { seatTitle: "Member", memberName: "Sample Member B", appointedDate: new Date("2022-06-01"), termExpires: new Date("2025-06-01") },
          { seatTitle: "Member", vacant: true },
        ],
      },
    },
  });

  const conservation = await prisma.boardCommission.upsert({
    where: { name: "Conservation Commission" },
    update: {},
    create: {
      name: "Conservation Commission",
      description: "Administers the Wetlands Protection Act and local wetlands bylaw.",
      totalSeats: 7,
      seats: {
        create: [
          { seatTitle: "Chair", memberName: "Sample Member C", appointedDate: new Date("2024-01-01"), termExpires: new Date("2027-01-01") },
          { seatTitle: "Alternate", vacant: true },
        ],
      },
    },
  });

  await prisma.jobVacancy.upsert({
    where: { id: "seed-vacancy-planning-alt" },
    update: {},
    create: {
      id: "seed-vacancy-planning-alt",
      category: "BOARD_COMMISSION",
      title: "Planning Board — Member",
      departmentOrBoard: "Planning Board",
      boardCommissionId: planning.id,
      employmentType: "APPOINTED",
      description: "The Planning Board seeks a resident volunteer to fill a vacant seat. Meets twice monthly.",
      qualifications: "Sutton resident; interest in land use and community planning preferred.",
      status: "OPEN",
    },
  });

  await prisma.jobVacancy.upsert({
    where: { id: "seed-vacancy-clerk" },
    update: {},
    create: {
      id: "seed-vacancy-clerk",
      category: "TOWN_DEPARTMENT",
      title: "Administrative Clerk",
      departmentOrBoard: "Town Clerk's Office",
      employmentType: "PART_TIME",
      description: "Provides administrative and clerical support to the Town Clerk's Office, including records management and front-counter resident services.",
      qualifications: "High school diploma required; municipal experience a plus.",
      payType: "HOURLY",
      payMin: 18.5,
      payMax: 22.0,
      status: "OPEN",
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
