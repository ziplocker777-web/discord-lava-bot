require("./env.js").loadEnv();

/**
 * The path a buyer's money actually pays for: key, download link, file.
 *
 * Roles and invoices have been checked to death; this is the one that matters
 * most and had never been tested. If it breaks, somebody pays and receives
 * nothing, and the only way anyone finds out is a ticket.
 *
 * Every step is exercised for real -- a watermark is created, the token is
 * looked up, the licence key resolves back to its owner, the file the download
 * would stream is opened -- and then the test's own record is deleted, so the
 * store is left exactly as it was found.
 *
 * Read-only as far as customers are concerned. Nothing is sent to anybody.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const store = require("./watermarkStore");
const { readJson, writeJson } = require("./jsonStore");

const STORE_FILE = path.join(__dirname, "watermarkStore.json");
// load() is not exported, and the file is the truth anyway.
const all = () => readJson(STORE_FILE, {});
const { deliverPurchase, buildDownloadUrl, buildDeliveryMessage } = require("./delivery");
const KNOWN = require("./products");

const TEST_EMAIL = "delivery-check@example.invalid";
const PRODUCT = "Muzzle Core FX";

let failures = 0;
const ok = (what, detail = "") => console.log(`  ok     ${what}${detail ? "  " + detail : ""}`);
const bad = (what, detail = "") => { failures += 1; console.log(`  ЖАЛОБА ${what}${detail ? "  " + detail : ""}`); };

function head(url) {
    return new Promise((resolve) => {
        const lib = url.startsWith("https:") ? https : http;
        const req = lib.request(url, { method: "GET", timeout: 15000 }, (res) => {
            res.destroy();
            resolve(res.statusCode);
        });
        req.on("error", (e) => resolve("ошибка: " + e.message));
        req.on("timeout", () => { req.destroy(); resolve("таймаут"); });
        req.end();
    });
}

(async () => {
    console.log("=== 1. настройки доставки ===\n");

    const productId = KNOWN[PRODUCT];
    productId ? ok(`${PRODUCT} известен`, productId) : bad(`${PRODUCT} нет в products.js`);

    for (const key of ["PUBLIC_BASE_URL", "DOWNLOAD_BASE_URL", "BASE_URL"]) {
        if (process.env[key]) ok(`${key}`, process.env[key]);
    }

    console.log("\n=== 2. выдача ключа и ссылки ===\n");

    const before = Object.keys(all()).length;
    let result;
    try {
        result = deliverPurchase({
            email: TEST_EMAIL,
            discordId: "0",
            productId,
            productTitle: PRODUCT,
        });
        ok("выдача отработала");
    } catch (err) {
        bad("выдача упала", err.message);
        process.exit(1);
    }

    const { licenseKey, downloadUrl } = result || {};
    // deliverPurchase hands back the finished URL, not the token inside it.
    const token = String(downloadUrl || "").split("/").pop().split("?")[0];
    licenseKey ? ok("ключ выдан", licenseKey) : bad("ключа нет", JSON.stringify(result).slice(0, 120));
    downloadUrl ? ok("ссылка собрана", downloadUrl) : bad("ссылки нет");

    console.log("\n=== 3. ключ и токен находятся обратно ===\n");

    const byKey = licenseKey ? store.getPurchaseByLicenseKey(licenseKey) : null;
    byKey ? ok("ключ находит владельца", byKey.email) : bad("ключ не находит владельца");

    if (token) {
        store.isValidToken(token) ? ok("токен принимается") : bad("токен не принимается");
        const w = store.getWatermark(token);
        w && w.email === TEST_EMAIL ? ok("вотермарка на месте") : bad("вотермарки нет");
    }

    console.log("\n=== 4. отзыв и восстановление ключа ===\n");

    if (licenseKey) {
        store.setRevoked(licenseKey, true);
        const revoked = store.getPurchaseByLicenseKey(licenseKey);
        revoked?.revoked ? ok("отзыв записывается") : bad("отзыв не записался");

        store.setRevoked(licenseKey, false);
        const back = store.getPurchaseByLicenseKey(licenseKey);
        back && !back.revoked ? ok("восстановление работает") : bad("восстановление не работает");
    }

    console.log("\n=== 5. сообщение покупателю ===\n");

    const message = buildDeliveryMessage({
        productId,
        productTitle: PRODUCT,
        downloadUrl,
        licenseKey,
        greeting: "Thanks for your purchase!",
    });
    const text = typeof message === "string" ? message : JSON.stringify(message);

    text.includes(licenseKey) ? ok("ключ есть в сообщении") : bad("ключа НЕТ в сообщении");
    text.includes(downloadUrl) ? ok("ссылка есть в сообщении") : bad("ссылки НЕТ в сообщении");

    console.log("\n=== 6. ссылка реально отвечает ===\n");

    if (downloadUrl && /^https?:/.test(downloadUrl)) {
        const code = await head(downloadUrl);
        if (code === 200) ok("сервер отдаёт файл", "200");
        else bad("сервер не отдаёт файл", String(code));
    } else {
        bad("ссылка не похожа на URL", String(downloadUrl));
    }

    console.log("\n=== 7. уборка ===\n");

    const db = all();
    if (token && db[token]) {
        delete db[token];
        writeJson(STORE_FILE, db);
        ok("тестовая запись удалена");
    } else {
        console.log("  ?      тестовую запись убрать не удалось — проверь watermarkStore.json на " + TEST_EMAIL);
    }

    const after = Object.keys(all()).length;
    after === before ? ok("хранилище как было", `${after} записей`) : bad("в хранилище лишнее", `${before} -> ${after}`);

    console.log(`\n${failures ? "ЖАЛОБ: " + failures : "вся цепочка выдачи работает"}`);
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("сломалось:", e.message); process.exit(1); });
