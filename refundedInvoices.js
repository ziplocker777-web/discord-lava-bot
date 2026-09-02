const fs = require("fs");
const path = require("path");
const { writeJson } = require("./jsonStore");

/**
 * Refunds recorded against one payment rather than one buyer.
 *
 * refundedEmails.json blocks a whole address. That is right for a chargeback --
 * somebody who took the money back should not keep the goods -- and wrong for a
 * customer who returned one thing and kept two others. David Williams returned a
 * $5 add-on and still owns Muzzle Core FX and the Audio Overhaul; blocking his
 * address to make the takings add up would have taken away what he paid for.
 *
 * This list exists because lava.top leaves a refunded sale reading COMPLETED for
 * ever, and offers no way to ask: /refunds, /payouts, /transactions and
 * /chargebacks are all 404, the invoice carries no refund field, and /feed is
 * the product catalogue. The gateway will not tell us, so we write it down.
 *
 * Read from disk every time. The first version of this required the JSON, which
 * node caches for the life of the process -- anything recorded while the bot was
 * running would have been invisible until the next restart.
 */

const FILE = path.join(__dirname, "refundedInvoices.json");

function all() {
    try {
        const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function save(list) {
    writeJson(FILE, list);
}

/**
 * @param {object} entry
 * @param {string} [entry.id]      the lava.top invoice id, when it is known
 * @param {string} entry.email
 * @param {string} [entry.what]    product name, used to match when there is no id
 * @param {number} [entry.amount]
 * @param {string} entry.why       "refund" or "chargeback"
 * @returns {boolean} whether it was new
 */
function addRefundedInvoice(entry) {
    const list = all();

    const already = list.some((r) =>
        (entry.id && r.id === entry.id)
        || (!entry.id && !r.id && r.email === entry.email && r.what === entry.what));
    if (already) return false;

    list.push({ ...entry, on: new Date().toISOString().slice(0, 10) });
    save(list);
    return true;
}

/** Undo, for when a refund is reversed or was recorded by mistake. */
function removeRefundedInvoice({ id, email, what }) {
    const list = all();
    const keep = list.filter((r) => !(
        (id && r.id === id)
        || (!id && email && r.email === email && (!what || r.what === what))));

    if (keep.length === list.length) return false;
    save(keep);
    return true;
}

/**
 * Was this invoice handed back?
 *
 * Matched on id where one was recorded. Where one was not -- a chargeback
 * notification that never named the invoice -- it falls back to buyer and
 * product, which can catch both of somebody's two purchases of the same thing.
 * That errs towards reporting less money than arrived, which is the safe
 * direction for a number that has to match a bank statement.
 */
function isRefundedInvoice(invoice) {
    const email = String(invoice?.buyer?.email || "").toLowerCase();
    const product = invoice?.product?.name;

    return all().some((r) => {
        if (r.id) return r.id === invoice?.id;
        return r.email === email && (!r.what || r.what === product);
    });
}

module.exports = { all, addRefundedInvoice, removeRefundedInvoice, isRefundedInvoice };
