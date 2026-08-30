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
//
// The count on its own says very little: the four-activation record in this store
// turned out to be one person fighting an install for twenty-four minutes, while a
// three-activation one was spread over five days. What separates a shared key from
// a reinstall is WHERE, and how far apart -- so a short history is kept rather than
// just a number.
//
// Eight entries, because this is a hint for a human to look at and not evidence.
const ACTIVATION_HISTORY = 8;

/** @returns {{count: number, ips: string[]}|null} the state AFTER this activation */
function markActivated(token, ip) {
    const db = load();
    if (!db[token]) return null;

    const record = db[token];
    record.activationCount = (record.activationCount || 0) + 1;
    record.lastActivatedAt = Date.now();

    const history = Array.isArray(record.activations) ? record.activations : [];
    history.push({ at: record.lastActivatedAt, ip: ip || null });
    record.activations = history.slice(-ACTIVATION_HISTORY);

    save(db);

    return {
        count: record.activationCount,
        ips: [...new Set(record.activations.map((a) => a.ip).filter(Boolean))],
    };
}

// Kills a key that's already been activated on someone's machine. The app checks this
// with a short-timeout, best-effort request on startup — if the server's unreachable
// it just proceeds as normal (offline use stays possible), but if it IS reachable and
// says revoked, the app drops back to the license-key screen.
function setRevoked(licenseKey, revoked) {
    const db = load();
    const normalized = licenseKey.trim().toUpperCase();
    const entry = Object.values(db).find((r) => r.licenseKey === normalized);
    if (!entry) return false;
    entry.revoked = revoked;
    save(db);
    return true;
}

/** The key issued to one person for one product, or null. */
function findByOwner(discordId, productId) {
    const db = load();
    for (const [token, record] of Object.entries(db)) {
        if (String(record.discordId) === String(discordId) && record.productId === productId) {
            return { token, ...record };
        }
    }
    return null;
}

/**
 * Puts a revoked key back into service.
 *
 * Needed because createWatermark hands back the SAME key when someone buys
 * again, and never clears the flag. Without this, a lapsed subscriber who
 * resubscribes gets their old key returned still dead, and their app stays
 * locked -- a support ticket manufactured out of someone who just paid again.
 *
 * Deliberately keyed on the payment itself rather than on delivery: /getrole
 * will happily re-deliver to someone whose original purchase completed months
 * ago, so clearing the flag there would undo the revocation for free.
 */
function clearRevoked(discordId, productId) {
    const db = load();
    for (const record of Object.values(db)) {
        if (String(record.discordId) !== String(discordId)) continue;
        if (record.productId !== productId) continue;
        if (!record.revoked) return null;
        record.revoked = false;
        save(db);
        return record.licenseKey;
    }
    return null;
}

module.exports = {
    createWatermark,
    getWatermark,
    markDownloaded,
    isValidToken,
    getPurchaseByLicenseKey,
    markActivated,
    setRevoked,
    findByOwner,
    clearRevoked,
};
