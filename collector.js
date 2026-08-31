require("./env.js").loadEnv();

const fs = require("fs");
const path = require("path");

const STORE = path.join(__dirname, "purchaseStore.json");

/**
 * The Collector badge: for somebody who owns more than one thing from the shop.
 *
 * Two thirds of the people who ever bought anything bought exactly one product.
 * The eighteen who did not are the shop's own best argument -- a survey said the
 * problem is that people cannot see the value, and eighteen badges in the member
 * list are evidence that the value is there, sitting where every visitor looks.
 *
 * The rule is deliberately one somebody can check for themselves. A stricter
 * "came back on a different day" would have caught eight people rather than
 * eighteen, and, worse, would have been unguessable: two products bought, no
 * badge, and a ticket asking why.
 *
 * Never taken away. Earned once and kept -- a status that can lapse is a lease,
 * and losing one stings more than never having had it. Nothing revokes this:
 * revoke-lapsed only ever removes the specific tier role in its plan, which this
 * can never be.
 *
 * Not for sale and not for reviewing. Both would turn a badge people want into a
 * thing people buy, and the second would poison the ratings it sits next to.
 */

const MIN_PRODUCTS = Number(process.env.COLLECTOR_MIN_PRODUCTS || 2);

/** Read fresh every time: a purchase made a second ago has to count. */
function allPurchases() {
    try { return JSON.parse(fs.readFileSync(STORE, "utf-8")); } catch { return {}; }
}

/**
 * How many different products this person owns, across every address they have
 * ever bought under.
 *
 * Counting a single email missed somebody who bought Muzzle Core FX with one
 * address and a subscription with another and linked both to the same Discord
 * account: two products, two rows, no badge. Found by the audit, in the only two
 * people it currently applies to.
 *
 * Counted as a set of product ids rather than a sum of list lengths, so buying
 * the same thing under two addresses is still one product.
 */
function productCount(email, discordId) {
    const db = allPurchases();
    const owned = new Set();

    const add = (list) => {
        for (const p of list || []) owned.add(p.productId || p.productTitle || JSON.stringify(p));
    };

    add(db[String(email || "").toLowerCase()]);

    if (discordId) {
        for (const list of Object.values(db)) {
            if (Array.isArray(list) && list.some((p) => String(p.discordId) === String(discordId))) add(list);
        }
    }

    return owned.size;
}

function qualifies(email, discordId) {
    return productCount(email, discordId) >= MIN_PRODUCTS;
}

/**
 * Give somebody the badge if their purchases now earn it.
 *
 * Safe to call on every delivery: it checks the member's roles first and does
 * nothing when the badge is already there.
 *
 * @returns {Promise<boolean>} whether it was granted just now
 */
async function checkCollector(client, discordId, email, { announce = true } = {}) {
    const roleId = process.env.COLLECTOR_ROLE_ID;
    if (!roleId || !discordId || !email) return false;
    if (!qualifies(email, discordId)) return false;

    let member;
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        member = await guild.members.fetch({ user: discordId, force: true });
    } catch (err) {
        console.warn(`[collector] ${discordId} is not reachable: ${err.message}`);
        return false;
    }

    if (member.roles.cache.has(roleId)) return false;

    try {
        await member.roles.add(roleId);
    } catch (err) {
        console.warn(`[collector] could not grant to ${discordId}: ${err.message}`);
        return false;
    }

    console.log(`[collector] granted to ${discordId} (${productCount(email, discordId)} products)`);

    // A badge nobody notices does no work. Failing to DM is not a failure of the
    // grant, though -- plenty of people have DMs closed.
    if (announce) {
        try {
            await member.send(
                "**Collector**\n\n"
                + "You own more than one thing from here now, so the badge is on your name.\n\n"
                + "Nothing to do. It's yours for good.");
        } catch {
            console.log(`[collector] ${discordId} has DMs closed`);
        }
    }

    return true;
}

module.exports = { checkCollector, qualifies, productCount, MIN_PRODUCTS };
