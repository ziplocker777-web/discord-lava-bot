const fs = require("fs");
const crypto = require("crypto");

const FILE = "./watermarkStore.json";

function load() {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

function save(data) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// 32 hex chars — long enough that it isn't guessable, since this token doubles as
// the buyer's auth credential for the community presets API, not just a forensic marker.
// This one is NEVER shown to the buyer — it only ever rides along hidden inside their
// package. The separate, human-facing credential is the license key below.
function generateToken() {
    return crypto.randomBytes(16).toString("hex");
}

// No 0/O/1/I/L — avoids characters that are easy to misread when a buyer types this
// in by hand. This IS shown to the buyer and typed into the app to unlock it, so a
// leaked/shared key is expected to happen — it's a deterrent, not a lock, which is why
// it's a separate credential from the hidden watermark token above (sharing this key
// doesn't expose the thing that actually traces a leaked build back to a purchase).
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateLicenseKey() {
    const groups = [];
    for (let g = 0; g < 4; g++) {
        let group = "";
        for (let i = 0; i < 4; i++) group += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)];
        groups.push(group);
    }
    return groups.join("-");
}

// One buyer can end up with more than one token if they buy Muzzle Core FX and
// Flash Collection separately — each purchase gets its own token/package, so a
// leak of either points back to exactly which purchase it came from. But a
// SECOND call for the same (discordId, productId) — a subscription renewal, a
// re-verification via /getrole or /panelredownload — reuses the existing
// token/key instead of minting a new one. Without this, a monthly-renewing
// subscription would DM the buyer a brand new key every single month.
function createWatermark({ email, discordId, productId, productTitle }) {
    const db = load();

    for (const [existingToken, record] of Object.entries(db)) {
        if (record.discordId === discordId && record.productId === productId) {
            return { token: existingToken, licenseKey: record.licenseKey, isNew: false };
        }
    }

    const token = generateToken();
    const licenseKey = generateLicenseKey();

    db[token] = {
        email,
        discordId,
        productId,
        productTitle,
        licenseKey,
        createdAt: Date.now(),
        downloaded: false,
        activationCount: 0,
    };

    save(db);
    return { token, licenseKey, isNew: true };
}

function getWatermark(token) {
    const db = load();
    return db[token] || null;
}

function markDownloaded(token) {
    const db = load();
    if (!db[token]) return;
    db[token].downloaded = true;
    db[token].lastDownloadAt = Date.now();
    save(db);
}

// Used to gate the community presets API to verified buyers — any token that was
// ever issued counts, regardless of which of the two products it was issued for.
function isValidToken(token) {
    if (!token) return false;
    const db = load();
    return Boolean(db[token]);
}

// Purchase volume here is low (hundreds, not millions) — a linear scan on activation
// is simpler than maintaining a second index and is in line with the rest of this
// file's plain-JSON-store style.
function getPurchaseByLicenseKey(key) {
    if (!key) return null;
    const db = load();
    const normalized = key.trim().toUpperCase();
    for (const [token, record] of Object.entries(db)) {
        if (record.licenseKey === normalized) return { token, ...record };
    }
    return null;
}

// Not a hard multi-use block — just visibility into how many times/where a key has
// been activated, in case a pattern (same key, many activations) is worth following up on.
function markActivated(token) {
    const db = load();
    if (!db[token]) return;
    db[token].activationCount = (db[token].activationCount || 0) + 1;
    db[token].lastActivatedAt = Date.now();
    save(db);
}

module.exports = {
    createWatermark,
    getWatermark,
    markDownloaded,
    isValidToken,
    getPurchaseByLicenseKey,
    markActivated,
};
