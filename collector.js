require("./env.js").loadEnv();

const { getAllPurchases } = require("./purchaseStore");

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

/** How many different products this email owns. Renewals are not products. */
function productCount(email) {
    // purchaseStore already keeps one record per product per email -- a second
    // payment for the same thing replaces the first rather than adding a row --
    // so the length of the list IS the number of different products.
    return getAllPurchases(String(email || "").toLowerCase()).length;
}

function qualifies(email) {
    return productCount(email) >= MIN_PRODUCTS;
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
    if (!qualifies(email)) return false;

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

    console.log(`[collector] granted to ${discordId} (${productCount(email)} products)`);

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
