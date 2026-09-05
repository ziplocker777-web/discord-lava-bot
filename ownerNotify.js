/**
 * One way to reach the owner, used by everything that has something to say.
 *
 * Always their DMs, never one of the channels this bot knows about: all of those
 * are readable by customers and these messages carry other customers' email
 * addresses, download links and licence keys. REVOKE_NOTIFY_CHANNEL_ID points it
 * at a private staff channel instead, and there is deliberately no fallback to a
 * public one -- a misconfigured id should go nowhere rather than somewhere bad.
 */

const lastSent = new Map();

/**
 * @param {object} client   a logged-in discord.js client
 * @param {string} text     the message
 * @param {object} [opts]
 * @param {string} [opts.key]        throttle bucket; repeats inside the cooldown
 *                                   are dropped. Use for anything that can fire
 *                                   on every request, like an API being down.
 * @param {number} [opts.cooldownMs] how long that bucket stays quiet, default 1h
 * @returns {Promise<boolean>} whether it was actually sent
 */
async function notifyOwner(client, text, opts = {}) {
    const { key, cooldownMs = 60 * 60 * 1000 } = opts;

    if (key) {
        const previous = lastSent.get(key) || 0;
        if (Date.now() - previous < cooldownMs) return false;
        lastSent.set(key, Date.now());
    }

    try {
        const channelId = process.env.REVOKE_NOTIFY_CHANNEL_ID;
        if (channelId) {
            const channel = await client.channels.fetch(channelId);
            await channel.send(text.slice(0, 1990));
            return true;
        }

        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const owner = await guild.fetchOwner();
        await owner.send(text.slice(0, 1990));
        return true;
    } catch (err) {
        // Never let a failed notification take down whatever it was reporting on.
        // The thing itself already happened and is already in the log.
        console.warn(`[notify] could not reach the owner (${err.message}).`);
        // Не считать неудачную отправку за "уже сообщили": иначе первая же
        // ошибка связи глушит оповещения на целый час.
        if (key) lastSent.delete(key);
        return false;
    }
}

/** Let a recovery message through even though the failure just used the bucket. */
function clearThrottle(key) {
    lastSent.delete(key);
}

/**
 * "username · <@id>", or the bare mention when the account cannot be read.
 *
 * A mention on its own renders as "unknown user" in a DM whenever the reading
 * client has never come across that account -- a DM has no shared channel to
 * resolve it from, which is why the same kind of notification sometimes shows a
 * name and sometimes does not.
 *
 * The name goes in as plain text so the line is legible either way, and the
 * mention stays so it is still clickable when Discord does resolve it.
 */
async function named(client, discordId) {
    if (!discordId) return null;
    try {
        const user = await client.users.fetch(String(discordId));
        return `${user.username} · <@${discordId}>`;
    } catch {
        return `<@${discordId}>`;
    }
}

module.exports = { notifyOwner, clearThrottle, named };
