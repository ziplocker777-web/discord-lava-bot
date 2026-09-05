const path = require("path");
const { readJson } = require("./jsonStore");

/**
 * The shop owner's own addresses and accounts, which are not customers.
 *
 * Needed because his testing lands in the same tables the reports read. The
 * payment check raises a real invoice for every product to prove the buy
 * buttons still work; those invoices are never paid, so they sat in "Lost
 * sales" as twenty abandoned checkouts worth $203 that no customer ever
 * abandoned.
 *
 * Plus-tags count as the same person: ziplocker777+paycheck@gmail.com is
 * ziplocker777@gmail.com with a label on it, and the check deliberately uses one
 * because lava.top will not sell to the seller's bare address.
 *
 * The list itself lives in ownAccounts.json so it can be edited without a
 * deploy.
 */

const FILE = path.join(__dirname, "ownAccounts.json");

/** ziplocker777+anything@gmail.com -> ziplocker777@gmail.com */
function bare(email) {
    return String(email || "").toLowerCase().trim().replace(/\+[^@]*(?=@)/, "");
}

function lists() {
    const raw = readJson(FILE, {});
    return {
        emails: new Set((raw.emails || []).map(bare)),
        ids: new Set((raw.discordIds || []).map(String)),
    };
}

/**
 * @param {string} [email]
 * @param {string} [discordId]
 * @returns {boolean} whether this is the owner rather than a customer
 */
function isOwn(email, discordId) {
    const { emails, ids } = lists();
    if (email && emails.has(bare(email))) return true;
    if (discordId && ids.has(String(discordId))) return true;
    return false;
}

/**
 * A Discord id that could actually belong to somebody.
 *
 * The payment check passes "0" as the buyer's id, and "0" is a truthy string --
 * enough to get an invoice past a `if (!discordId)` guard and into a sweep that
 * would try to send it a message.
 */
function isRealDiscordId(id) {
    return /^\d{17,20}$/.test(String(id || ""));
}

module.exports = { isOwn, isRealDiscordId, bare };
