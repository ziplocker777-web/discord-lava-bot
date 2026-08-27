require("./env.js").loadEnv();

/**
 * Tells you what is actually behind the ANTHROPIC_API_KEY in your .env.
 *
 * Run it after putting a key in place, especially one you did not create in your
 * own console. A key can look perfectly correct and still belong to somebody
 * else's account, or point at a proxy that serves a different model than the one
 * you asked for. Those two cases are what this checks for.
 *
 *   node check-key.js
 *
 * Nothing is printed that would expose the key itself — only its shape.
 */

const Anthropic = require("@anthropic-ai/sdk").default;

const key = process.env.ANTHROPIC_API_KEY;
const baseURL = process.env.ANTHROPIC_BASE_URL;
const WANT_MODEL = "claude-sonnet-5";

function line(label, value) {
    console.log("  " + label.padEnd(26) + value);
}

(async () => {
    console.log("\n=== the key itself ===");

    if (!key) {
        console.log("  ANTHROPIC_API_KEY is not set in .env — nothing to check.");
        process.exit(1);
    }

    // Never print the key. The prefix and the length are enough to judge its shape,
    // and neither is enough for anyone reading your screen to use it.
    line("length", `${key.length} characters`);
    line("starts with", key.slice(0, 13) + "…");
    line("ends with", "…" + key.slice(-4));

    // Two shapes are expected here: a first-party Anthropic key, and a tonwave
    // gateway key. The gateway is what this bot actually runs on, because buying
    // from Anthropic directly is not available to the owner.
    const shape = key.startsWith("sk-ant-") && key.length > 80
        ? "Anthropic key"
        : key.startsWith("tw-live-")
            ? "tonwave gateway key"
            : "unrecognised — neither sk-ant- nor tw-live-";
    line("shape", shape);

    // The single most common way this setup fails, so it is checked before
    // anything goes over the network.
    if (key.startsWith("tw-live-") && !baseURL) {
        console.log();
        console.log("  A tw-live- key needs ANTHROPIC_BASE_URL=https://api.tonwave.dev");
        console.log("  in .env — WITHOUT /v1. Anthropic itself will reject this key.");
    }

    if (baseURL) {
        console.log();
        line("ANTHROPIC_BASE_URL", baseURL);
        console.log("  ^ requests are NOT going to Anthropic. Everything you send,");
        console.log("    including whatever customers type, passes through that host.");
    }

    // Ten minutes is the SDK default, and against a gateway that never answers
    // that is indistinguishable from a hung script. Twenty seconds is plenty for
    // a yes/no, and one retry rather than two keeps the wait bounded.
    const client = new Anthropic({ timeout: 20000, maxRetries: 1 });

    console.log("\n=== does it work, and whose is it? ===");
    try {
        const models = await client.models.list();
        const ids = models.data.map((m) => m.id);
        line("key works", "yes");
        line("models reachable", String(ids.length));
        const notable = ids.filter((id) => /opus|sonnet|haiku|fable/.test(id)).slice(0, 8);
        console.log("  " + "models".padEnd(26) + (notable.join(", ") || "(none recognisable)"));
        if (!ids.includes(WANT_MODEL)) {
            console.log(`\n  WARNING: ${WANT_MODEL} is not in the list. Either the account`);
            console.log("  cannot reach it, or this is not really the Anthropic API.");
        }
    } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
            line("key works", "NO — rejected as invalid");
            console.log("\nStopping here — the key itself was refused.");
            process.exit(1);
        }
        // Anything else here is only the model *listing* failing. Plenty of
        // gateways never implement /v1/models while serving /v1/messages
        // perfectly well, so this is no reason to stop — the live message
        // below is the test that actually decides.
        if (err instanceof Anthropic.APIError) {
            line("model listing", `unavailable — API error ${err.status}`);
        } else {
            line("model listing", "unavailable — " + err.message);
        }
        console.log("  Not fatal on a gateway. Carrying on to the live test.");
    }

    console.log("\n=== is it serving the model you asked for? ===");
    try {
        const response = await client.messages.create({
            model: WANT_MODEL,
            max_tokens: 64,
            messages: [{ role: "user", content: "Reply with exactly: ok" }],
        });

        const said = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();

        line("asked for", WANT_MODEL);
        line("served by", response.model);
        line("replied", JSON.stringify(said));
        line("input tokens", String(response.usage.input_tokens));
        line("output tokens", String(response.usage.output_tokens));

        // A reseller proxying to something cheaper is the thing worth catching, and
        // this is where it shows: the response says which model actually answered.
        if (response.model !== WANT_MODEL) {
            console.log(`\n  WARNING: you asked for ${WANT_MODEL} and got ${response.model}.`);
            console.log("  Whatever is on the other end is not serving what you requested.");
        } else {
            console.log("\n  The model that answered is the one that was requested.");
        }
    } catch (err) {
        line("test message", "FAILED — " + err.message);
        process.exit(1);
    }

    console.log("\n=== what this cannot tell you ===");
    console.log("  Whether the gateway keeps what you send. Every question that");
    console.log("  reaches this bot passes through their server in the clear, and");
    console.log("  nothing on this side can see what happens to it there. That is");
    console.log("  why redact() in aiSupport.js strips licence keys, emails and");
    console.log("  download links BEFORE the request leaves this machine — the");
    console.log("  gateway never sees them. Keep it that way.\n");
})();
