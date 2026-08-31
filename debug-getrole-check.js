require("dotenv").config();
const { findCompletedSaleByEmail } = require("./lavaClient");
const { getPurchase } = require("./purchaseStore");

const EMAIL = process.argv[2];

if (!EMAIL) {
    console.error("Использование: node debug-getrole-check.js email@example.com");
    process.exit(1);
}

(async () => {
    const email = EMAIL.trim().toLowerCase();

    console.log(`\n=== Проверка email: ${email} ===\n`);

    // 1. Локальная запись (purchaseStore.json)
    const local = getPurchase(email);
    console.log("1. Локальная запись в purchaseStore.json:");
    console.log(local ? JSON.stringify(local, null, 2) : "  — не найдена");

    // 2. Поиск через lava.top API (тот же код, что использует /getrole)
    console.log("\n2. Поиск через lava.top API (findCompletedSaleByEmail):");
    try {
        const sale = await findCompletedSaleByEmail(email);
        console.log(sale ? JSON.stringify(sale, null, 2) : "  — не найдено ни в одном продукте");
    } catch (err) {
        console.error("  ОШИБКА:", err.message);
    }
})();
