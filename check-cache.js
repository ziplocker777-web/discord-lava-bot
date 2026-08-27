require("./env.js").loadEnv();

/**
 * Answers one question: does the gateway pass prompt caching through?
 *
 *   node check-cache.js
 *
 * It matters more than it sounds. The FAQ is ~7k tokens and rides along with
 * every single question a customer asks, unchanged. Cached, that prefix costs a
 * tenth as much on every request after the first. Uncached, the bought tokens
 * are gone in roughly a hundred questions.
 *
 * Two identical requests are sent. The first should report cache_creation
 * tokens, the second cache_read. If both stay at zero, the gateway is stripping
 * cache_control and there is nothing to be gained by using it.
 */

const Anthropic = require("@anthropic-ai/sdk").default;
const { loadFaq, buildSystemPrompt, MODEL } = require("./aiSupport.js");

// A 7k-token prefix through a gateway is not fast. Give it room, but not the
// SDK default of ten minutes.
const client = new Anthropic({ timeout: 120000, maxRetries: 0 });

// node check-cache.js --plain  sends the same prompt with no cache_control, to
// separate "the gateway cannot take a prompt this size" from "the gateway does
// not do caching". Those two failures look identical from the outside.
const PLAIN = process.argv.includes("--plain");

function usageLine(label, u) {
    console.log(
        "  " + label.padEnd(10) +
        `in ${String(u.input_tokens).padStart(6)}   ` +
        `created ${String(u.cache_creation_input_tokens ?? 0).padStart(6)}   ` +
        `read ${String(u.cache_read_input_tokens ?? 0).padStart(6)}`
    );
}

(async () => {
    const system = buildSystemPrompt(loadFaq());
    console.log(`\nmodel ${MODEL} via ${process.env.ANTHROPIC_BASE_URL || "api.anthropic.com"}`);
    console.log(`system prompt: ${system.length} chars` + (PLAIN ? "  (no cache_control)" : "  (cache_control on)"));
    console.log();

    // The breakpoint goes on the system prompt because that is the part which is
    // byte-identical on every request. The question itself comes after it and is
    // different every time, which is exactly where a breakpoint must NOT be.
    const request = {
        model: MODEL,
        max_tokens: 16,
        system: PLAIN
            ? system
            : [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
    };

    try {
        const first = await client.messages.create(request);
        usageLine("first", first.usage);

        const second = await client.messages.create(request);
        usageLine("second", second.usage);

        const created = first.usage.cache_creation_input_tokens ?? 0;
        const read = second.usage.cache_read_input_tokens ?? 0;

        console.log();
        if (PLAIN) {
            console.log(`  Baseline only — no cache_control was sent. ${second.usage.input_tokens}`);
            console.log("  input tokens is what every single question costs as things");
            console.log("  stand. Run without --plain to see whether that can be cut.");
        } else if (read > 0) {
            const pct = Math.round((read / (read + second.usage.input_tokens)) * 100);
            console.log(`  Caching works — the second request read ${read} tokens from`);
            console.log(`  cache, ~${pct}% of the prefix, at a tenth of the price. Wire it in.`);
        } else if (created > 0) {
            console.log("  The cache was written but never read back. Either the two");
            console.log("  requests did not hash identically, or the gateway drops the");
            console.log("  cache between calls. Not usable as it stands.");
        } else {
            console.log("  No caching — the gateway ignored cache_control and charged");
            console.log("  full price for the prefix twice.");
        }
        console.log();
    } catch (err) {
        // Measured 2026-08-27 against api.tonwave.dev: this gateway does not
        // reject cache_control, it simply never answers. A timeout here IS the
        // finding, not a network fault — the identical request under --plain
        // comes back in seconds.
        console.log("  request failed — " + err.message);
        if (!PLAIN && /timed out/i.test(err.message)) {
            console.log();
            console.log("  With cache_control the gateway hangs rather than refusing.");
            console.log("  Compare: node check-cache.js --plain returns in seconds.");
            console.log("  Treat prompt caching as unavailable here.");
        }
        console.log();
        process.exit(1);
    }
})();
