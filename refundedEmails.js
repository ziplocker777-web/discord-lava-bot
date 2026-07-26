const fs = require("fs");

const FILE = "./refundedEmails.json";

// Локальный чёрный список email'ов с оформленным рефандом. Существует
// потому что lava.top НЕ отражает рефанды в /sales вообще — запись там
// остаётся "completed" даже после возврата денег (проверено на реальном
// случае: justingilga9@gmail.com, продажа от 2026-07-06, до сих пор
// "completed" в API). Значит ни webhook, ни findCompletedSaleByEmail
// физически не могут сами понять, что покупку вернули — это приходится
// вести руками.
function load() {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

function save(list) {
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function isRefunded(email) {
    return load().includes(email.trim().toLowerCase());
}

// Добавить email в список (используется CLI-скриптом add-refund.js).
function addRefund(email) {
    const list = load();
    const normalized = email.trim().toLowerCase();
    if (!list.includes(normalized)) {
        list.push(normalized);
        save(list);
    }
}

module.exports = { isRefunded, addRefund };
