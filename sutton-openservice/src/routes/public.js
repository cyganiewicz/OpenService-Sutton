const express = require("express");
const prisma = require("../db");
const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const [openVacancyCount, boardCount, recentVacancies] = await Promise.all([
      prisma.jobVacancy.count({ where: { status: "OPEN" } }),
      prisma.boardCommission.count(),
      prisma.jobVacancy.findMany({
        where: { status: "OPEN" },
        orderBy: { postedDate: "desc" },
        take: 4,
      }),
    ]);
    res.render("home", { title: "OpenService", openVacancyCount, boardCount, recentVacancies });
  } catch (err) {
    next(err);
  }
});

router.get("/vacancies", async (req, res, next) => {
  try {
    const category = ["BOARD_COMMISSION", "TOWN_DEPARTMENT"].includes(req.query.category)
      ? req.query.category
      : null;

    const vacancies = await prisma.jobVacancy.findMany({
      where: { status: "OPEN", ...(category ? { category } : {}) },
      orderBy: [{ category: "asc" }, { postedDate: "desc" }],
    });

    res.render("vacancies", { title: "Current Vacancies", vacancies, category });
  } catch (err) {
    next(err);
  }
});

router.get("/vacancies/:id", async (req, res, next) => {
  try {
    const vacancy = await prisma.jobVacancy.findUnique({
      where: { id: req.params.id },
      include: { boardCommission: true },
    });
    if (!vacancy) {
      return res.status(404).render("errors/404", { title: "Vacancy Not Found" });
    }
    res.render("vacancy-detail", { title: vacancy.title, vacancy });
  } catch (err) {
    next(err);
  }
});

router.get("/board-members", async (req, res, next) => {
  try {
    const boards = await prisma.boardCommission.findMany({
      orderBy: { name: "asc" },
      include: { seats: { orderBy: [{ vacant: "desc" }, { termExpires: "asc" }] } },
    });
    res.render("board-members", { title: "Boards & Commissions", boards });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
