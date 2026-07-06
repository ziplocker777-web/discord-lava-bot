const fs = require("fs");

const FILE = "./purchaseStore.json";

function load() {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

function save(data) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function recordPurchase(email, data = {}) {
    const db = load();
    db[email.toLowerCase()] = {
        ...data,
        email,
        timestamp: Date.now()
    };
    save(db);
}

function hasPurchase(email) {
    const db = load();
    return Boolean(db[email.toLowerCase()]);
}

module.exports = {
    recordPurchase,
    hasPurchase
};