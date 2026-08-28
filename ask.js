require("dotenv").config({ quiet: true });

/**
 * Talks to the support assistant from a terminal, with no Discord involved.
 *
 *   node ask.js "how do i cancel my subscription"
 *   node ask.js                     interactive, one question per line
 *   node ask.js --suite             a fixed set of questions, with the totals
 *
 * This is how a change to faq.md or to the prompt gets checked: real answers,
 * real token counts, and nothing visible to a customer if it goes wrong.
 *
 * The per-answer line shows what the FAQ selector did. `faq full` means the
 * whole document was sent — correct when the question is off-topic, worth a
 * look when it is not.
 */

const readline = require("readline");
const { initAi, handleQuestion, pricesReady } = require("./aiSupport.js");

// A spread of what actually gets asked: both languages, an order-specific
// question that must be deflected to a ticket, and one thing the FAQ does not
// cover so the NO_ANSWER path is exercised too.
const SUITE = [
    "how do i cancel my subscription",
    "does this work on fivem servers",
    "will this hurt my fps",
    "whats the difference between basic and premium",
    "do i need openiv",
    "как отменить подписку",
    "я оплатил но роль не выдалась",
    "где мой лицензионный ключ",
    "do you sell car mods for gta",
];

async function askOne(question, i) {
    const started = Date.now();
    const result = await handleQuestion({
        question,
        discordId: `cli-${i}`,          // a fresh id each time, so the rate limit
        username: "cli",                // never fires during a suite run
        source: "cli",
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    // kind is what picks the embed colour in Discord, so it is worth seeing here:
    // answer / no_answer / notice / error.
    console.log(`\n› ${question}`);
    console.log(`  ${result === null ? "(ignored — too short to be a question)" : result.text}`);
    console.log(`  [${seconds}s${result ? ", " + result.kind : ""}]`);
}

(async () => {
    if (!initAi()) process.exit(1);

    // The bot can answer before prices land; a one-shot CLI should not.
    await pricesReady();

    const args = process.argv.slice(2);

    if (args.includes("--suite")) {
        console.log(`\nRunning ${SUITE.length} questions.\n`);
        for (let i = 0; i < SUITE.length; i += 1) {
            try {
                await askOne(SUITE[i], i);
            } catch (err) {
                console.log(`\n› ${SUITE[i]}`);
                console.log("  FAILED — " + err.message);
            }
        }
        console.log("\nDone. The [ai] lines above carry the token counts.\n");
        return;
    }

    if (args.length > 0) {
        await askOne(args.join(" "), 0);
        return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("\nAsk away. Ctrl+C to stop.\n");
    rl.setPrompt("> ");
    rl.prompt();

    let n = 0;
    rl.on("line", async (line) => {
        const q = line.trim();
        if (!q) return rl.prompt();
        try {
            await askOne(q, n += 1);
        } catch (err) {
            console.log("  FAILED — " + err.message);
        }
        rl.prompt();
    });
})();
