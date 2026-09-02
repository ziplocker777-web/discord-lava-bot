const fs = require("fs");
const { writeJson } = require("./jsonStore");

const FILE = "./purchaseStore.json";

// Each email maps to an ARRAY of purchases (one entry per distinct productId) — a
// buyer who owns more than one product under the same email needs every purchase
// kept, not just the latest overwriting the rest. Old files store a single object
// per email instead of an array; load() normalizes those transparently on read, so
// no separate migration step is needed before deploying this.
function load() {
    if (!fs.existsSync(FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    const normalized = {};
    for (const [email, value] of Object.entries(raw)) {
        normalized[email] = Array.isArray(value) ? value : [value];
    }
    return normalized;
}

function save(data) {
    writeJson(FILE, data);
}

// Adds or updates the entry for this (email, productId) pair — a second call for a
// product already on file (a subscription renewal, re-verifying via /getrole) updates
// it in place instead of appending a duplicate or wiping out other products' entries.
function recordPurchase(email, data = {}) {
    const db = load();
    const key = email.toLowerCase();
    const list = db[key] || [];

    const record = { ...data, email, timestamp: Date.now() };
    const idx = list.findIndex((p) => p.productId === data.productId);
    if (idx >= 0) list[idx] = record;
    else list.push(record);

    db[key] = list;
    save(db);
}

function hasPurchase(email) {
    const list = load()[email.toLowerCase()];
    return Boolean(list && list.length > 0);
}

// Most recent purchase for this email, regardless of product — for callers that just
// need "some" purchase (e.g. a discordId fallback), not a specific product's record.
function getPurchase(email) {
    const list = load()[email.toLowerCase()];
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
}

// Every purchase on file for this email, oldest first.
function getAllPurchases(email) {
    return load()[email.toLowerCase()] || [];
}

function getPurchaseForProduct(email, productId) {
    const list = load()[email.toLowerCase()] || [];
    return list.find((p) => p.productId === productId) || null;
}

/**
 * Note something about a purchase without losing the rest of it.
 *
 * recordPurchase REPLACES the record for a product, which is right for a
 * payment -- the event carries everything -- and wrong for anything that only
 * knows one fact. Marking a subscription cancelled through recordPurchase wiped
 * `tier` along with it, and roles.js reads `tier` to tell Membership from
 * Premium: a Premium subscriber who cancelled came back as Membership, and the
 * wrong role would be granted or taken.
 */
function markStatus(email, productId, patch = {}) {
    const db = load();
    const key = email.toLowerCase();
    const list = db[key] || [];

    const idx = list.findIndex((p) => p.productId === productId);
    if (idx >= 0) list[idx] = { ...list[idx], ...patch };
    else list.push({ email, productId, ...patch, timestamp: Date.now() });

    db[key] = list;
    save(db);
}

module.exports = {
    recordPurchase,
    markStatus,
    hasPurchase,
    getPurchase,
    getAllPurchases,
    getPurchaseForProduct,
};
