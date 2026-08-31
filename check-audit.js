require("./env.js").loadEnv();

/**
 * Reads the guild audit log for member role changes, through the API rather than
 * the Discord client.
 *
 * The client's audit log view is easy to misread: "Role update" there means
 * somebody edited a role's settings, while adding or removing a role from a
 * person is "Member role update" -- a different action type that is filtered
 * separately. Asking the API for action type 25 removes the doubt.
 *
 *   node check-audit.js [userId]
 */

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD = process.env.GUILD_ID;
const API = "https://discord.com/api/v10";

const MEMBER_ROLE_UPDATE = 25;
const who = process.argv[2] || null;

// Role ids this bot hands out, so the output says which tier rather than a number.
const ROLE_NAMES = {
    [process.env.ROLE_ID]: "ROLE_ID (Customer)",
    [process.env.SUBSCRIBE_ROLE_ID]: "SUBSCRIBE_ROLE_ID (Membership)",
    [process.env.BASIC_ROLE_ID]: "BASIC_ROLE_ID",
    [process.env.PREMIUM_ROLE_ID]: "PREMIUM_ROLE_ID",
};

async function get(path, attempts = 4) {
    let lastErr = null;
    for (let i = 1; i <= attempts; i += 1) {
        try {
            const r = await fetch(API + path, {
                headers: { Authorization: `Bot ${TOKEN}` },
                signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0, 120)}` };
            return { data: await r.json() };
        } catch (err) {
            lastErr = err;
            await new Promise((res) => setTimeout(res, 700 * i));
        }
    }
    return { error: lastErr ? lastErr.message : "unreachable" };
}

// Discord ids carry their creation time in the top 42 bits.
function whenOf(id) {
    return new Date(Number(BigInt(id) >> 22n) + 1420070400000).toISOString().slice(0, 19);
}

(async () => {
    const r = await get(`/guilds/${GUILD}/audit-logs?action_type=${MEMBER_ROLE_UPDATE}&limit=100`);
    if (r.error) {
        console.error("could not read the audit log:", r.error);
        console.error("the bot needs the View Audit Log permission to read it");
        process.exit(1);
    }

    const users = new Map((r.data.users || []).map((u) => [u.id, u.username]));
    const entries = r.data.audit_log_entries || [];

    console.log(`member role updates returned: ${entries.length}`);
    if (entries.length) {
        console.log(`oldest here: ${whenOf(entries[entries.length - 1].id)}`);
        console.log(`newest here: ${whenOf(entries[0].id)}`);
    }
    console.log();

    let shown = 0;
    for (const e of entries) {
        if (who && e.target_id !== who) continue;
        shown += 1;

        const parts = [];
        for (const c of e.changes || []) {
            const verb = c.key === "$add" ? "+" : c.key === "$remove" ? "-" : c.key;
            for (const role of c.new_value || []) {
                parts.push(`${verb} ${role.name} (${ROLE_NAMES[role.id] || role.id})`);
            }
        }

        console.log(
            `${whenOf(e.id)}  target ${e.target_id} (${users.get(e.target_id) || "?"})  ` +
            `by ${users.get(e.user_id) || e.user_id}`
        );
        for (const p of parts) console.log("    " + p);
    }

    if (who && shown === 0) {
        console.log(`no member role updates for ${who} in the ${entries.length} most recent entries`);
    }
})();
