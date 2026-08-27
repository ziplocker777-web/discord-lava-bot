require("./env.js").loadEnv();

/**
 * Finds which channel each message ID lives in, and prints the start of each
 * message.
 *
 * Built for one job: assembling the mod directory. A Discord message link needs
 * the channel ID as well as the message ID, and a list of message IDs on its own
 * cannot produce one.
 *
 *   node find-messages.js
 *
 * Uses the REST API directly rather than logging in as a bot. A gateway login
 * would put a second live instance of the bot on the network beside the one
 * running on the server, and both would answer every message for as long as this
 * script ran.
 */

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD = process.env.GUILD_ID;
const API = "https://discord.com/api/v10";

// The directory this is being built for, in the order it should be read.
const WANTED = [
    ["1541752975792414760", "Basic subscription"],
    ["1541752993656082464", "Membership subscription"],
    ["1541753021656997919", "Premium subscription"],
    ["1535641351646089287", "Muzzle Core FX + Flash Collection"],
    ["1540807574151237644", "Tracer Tool"],
    ["1541204213005156372", "Immersive Combat 1.9 + MCC compatibility"],
    ["1540113301307133972", "Graphics Pack V3"],
    ["1531750315135733761", "Ziplocker's Graphics Pack V2"],
    ["1529301370363056159", "Ziplocker's Graphics V2"],
    ["1526697193392705620", "Ziplocker Graphics Pack V1"],
    ["1524047674943475763", "Ziplocker Summer Visuals"],
    ["1531750438435553483", "Ziplocker's Blood FX"],
    ["1533767147627745301", "Complete Audio Overhaul"],
    ["1536204925560823878", "Realism Guns Sound Pack"],
];

// Connections to Discord from this machine drop often enough that a single
// attempt is not worth making.
async function get(path, attempts = 4) {
    let lastErr = null;
    for (let i = 1; i <= attempts; i += 1) {
        try {
            const r = await fetch(API + path, {
                headers: { Authorization: `Bot ${TOKEN}` },
                signal: AbortSignal.timeout(15000),
            });
            if (r.status === 429) {
                const wait = Number(r.headers.get("retry-after") || 2) * 1000;
                await new Promise((res) => setTimeout(res, wait));
                continue;
            }
            if (!r.ok) return { error: r.status };
            return { data: await r.json() };
        } catch (err) {
            lastErr = err;
            await new Promise((res) => setTimeout(res, 700 * i));
        }
    }
    return { error: lastErr ? lastErr.message : "unreachable" };
}

// Written after every hit, and read back on start. Connections from this machine
// drop often enough that a run which loses everything on the last channel is not
// a tool, it is a lottery ticket.
const CACHE = "message-index.json";

function loadCache() {
    try {
        return JSON.parse(require("fs").readFileSync(CACHE, "utf-8"));
    } catch {
        return {};
    }
}

function saveCache(c) {
    require("fs").writeFileSync(CACHE, JSON.stringify(c, null, 2));
}

(async () => {
    if (!TOKEN || !GUILD) {
        console.error("DISCORD_TOKEN or GUILD_ID missing from .env");
        process.exit(1);
    }

    const channels = await get(`/guilds/${GUILD}/channels`);
    if (channels.error) {
        console.error("could not list channels:", channels.error);
        process.exit(1);
    }

    // 0 = text, 5 = announcement. Both hold posts worth linking to; nothing else
    // can be fetched this way.
    const text = channels.data.filter((c) => c.type === 0 || c.type === 5);
    console.log(`searching ${text.length} channels\n`);

    const cache = loadCache();

    // Channels that already produced a hit get tried first: these posts cluster
    // in a handful of channels, so after the first few the rest are usually one
    // request away instead of thirty.
    const hot = new Set(Object.values(cache).map((v) => v.channelId));
    const order = [...text].sort((a, b) => (hot.has(b.id) ? 1 : 0) - (hot.has(a.id) ? 1 : 0));

    for (const [id, label] of WANTED) {
        let found = null;

        if (cache[id]) {
            const c = cache[id];
            console.log("=".repeat(70));
            console.log(`${label}`);
            console.log(`  id      ${id}`);
            console.log(`  channel #${c.channelName}  (${c.channelId})   [cached]`);
            console.log(`  link    ${c.link}`);
            if (c.text) for (const line of c.text.split("\n").slice(0, 20)) console.log("    | " + line.slice(0, 150));
            continue;
        }

        for (const ch of order) {
            const r = await get(`/channels/${ch.id}/messages/${id}`, 2);
            if (r.data) {
                found = { channel: ch, message: r.data };
                break;
            }
        }

        console.log("=".repeat(70));
        console.log(`${label}`);
        console.log(`  id      ${id}`);

        if (!found) {
            console.log("  NOT FOUND in any readable channel");
            continue;
        }

        const m = found.message;
        const link = `https://discord.com/channels/${GUILD}/${found.channel.id}/${id}`;
        console.log(`  channel #${found.channel.name}  (${found.channel.id})`);
        console.log(`  link    ${link}`);

        const blob = [
            (m.content || "").trim(),
            ...(m.embeds || []).map((e) =>
                [e.title || "", e.description || "",
                 ...(e.fields || []).map((f) => `${f.name}: ${f.value}`)].join("\n")),
        ].filter(Boolean).join("\n");

        cache[id] = { label, channelId: found.channel.id, channelName: found.channel.name, link, text: blob };
        saveCache(cache);

        const body = (m.content || "").trim();
        if (body) {
            console.log("  content:");
            for (const line of body.split("\n").slice(0, 14)) {
                console.log("    | " + line.slice(0, 150));
            }
        }

        // Most of these posts are panels, so the real text is in the embed.
        for (const e of m.embeds || []) {
            console.log("  embed:");
            if (e.title) console.log("    title: " + e.title);
            if (e.description) {
                for (const line of e.description.split("\n").slice(0, 20)) {
                    console.log("    | " + line.slice(0, 150));
                }
            }
            for (const f of e.fields || []) {
                console.log(`    field: ${f.name} = ${String(f.value).slice(0, 120)}`);
            }
        }
    }
})();
