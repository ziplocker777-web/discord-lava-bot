const path = require("path");
const { readJson, writeJson } = require("./jsonStore");

/**
 * Webhook deliveries this bot has already answered.
 *
 * lava.top redelivers. On 5 September the same $9.99 sale arrived twice and the
 * owner got two "Sale" messages for one payment, which reads as two customers
 * until somebody checks the invoice list.
 *
 * The handling itself is already idempotent -- the second delivery re-recorded
 * the same purchase, found the role granted and skipped the download -- so this
 * exists only to stop the same event being ANNOUNCED twice. Nothing about the
 * repair behaviour changes: a redelivery still puts back a role somebody removed
 * by hand.
 *
 * Keyed on the event type as well as the payment, because a contract that has
 * been paid can later be refunded, and those are two pieces of news about the
 * same id.
 */

const FILE = path.join(__dirname, "seenEvents.json");

// A fortnight is far longer than any gateway retries for, and the file stays
// small enough to rewrite on every event without thinking about it.
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * @returns {boolean} true the first time this event is seen, false on a repeat.
 *          An event with no id to key on always counts as new: suppressing news
 *          that might be real is worse than repeating news that is not.
 */
function firstTimeSeen(event) {
    const id = event?.contractId || event?.id || event?.invoiceId;
    if (!id) return true;

    const key = `${String(event.eventType || "?")}:${id}`;
    const seen = readJson(FILE, {});
    const now = Date.now();

    if (seen[key]) return false;

    for (const [k, at] of Object.entries(seen)) {
        if (now - at > KEEP_MS) delete seen[k];
    }

    seen[key] = now;
    writeJson(FILE, seen);
    return true;
}

module.exports = { firstTimeSeen };
