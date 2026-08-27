require("dotenv").config({ quiet: true });

/**
 * Shows what faqSelect.js does to a spread of real questions. No network, no
 * tokens spent — this is the cheap half of the check, and the one that catches
 * the failure that matters: a question the FAQ plainly answers being narrowed
 * down to the wrong paragraphs.
 *
 *   node check-faqselect.js
 *
 * Read the FAQ column, not the saving. "full" on a question that is obviously
 * covered means the selector is too timid; a confident pick of the wrong
 * headings means it is too eager, and that one costs an answer.
 */

const { loadFaq, buildSystemPrompt } = require("./aiSupport.js");
const { selectFaq } = require("./faqSelect.js");

// Written the way people actually type in Discord: lowercase, no punctuation,
// misspelled, and about a third of them in Russian.
const QUESTIONS = [
    "how do i cancel my subscription",
    "what payment methods do you accept",
    "does this work on fivem",
    "will this hurt my fps",
    "i paid and nothing happened where is my stuff",
    "whats the difference between basic and premium",
    "do i need openiv",
    "is muzzle core fx in basic",
    "legacy or enhanced which one do i need",
    "does it work with nve",
    "i just want better muzzle flash what should i buy",
    "my role disappeared",
    "can i use this on my server for all players",
    "where is my licence key",
    // Russian — the FAQ is in English, so these should mostly fall back to full.
    "как отменить подписку",
    "это работает на fivem",
    "я оплатил но ничего не пришло",
    // Nothing to do with the FAQ at all.
    "what is the weather like today",
    "can you write me a discord bot",
];

const faq = loadFaq();
const fullPrompt = buildSystemPrompt(faq);

console.log(`\nFAQ ${faq.length} chars, full system prompt ${fullPrompt.length} chars\n`);
console.log("  " + "question".padEnd(46) + "FAQ sent".padEnd(12) + "prompt".padEnd(10) + "saved");
console.log("  " + "-".repeat(86));

let fullCount = 0;
let totalSaved = 0;

for (const q of QUESTIONS) {
    const sel = selectFaq(faq, q);
    const prompt = buildSystemPrompt(sel.text);
    const saved = Math.round((1 - prompt.length / fullPrompt.length) * 100);

    if (sel.full) fullCount += 1;
    totalSaved += saved;

    const label = sel.full ? `full (${sel.reason})` : `${sel.picked} entries`;
    console.log(
        "  " + q.slice(0, 44).padEnd(46) +
        label.padEnd(12) +
        String(prompt.length).padEnd(10) +
        (sel.full ? "-" : saved + "%")
    );
}

console.log();
console.log(`  ${QUESTIONS.length - fullCount} of ${QUESTIONS.length} questions narrowed`);
console.log(`  average prompt saving across all of them: ${Math.round(totalSaved / QUESTIONS.length)}%`);

// The detail view. This is where a wrong pick shows itself — the headings chosen
// for a question either obviously belong to it or obviously do not.
console.log("\n=== what was picked, in detail ===");
for (const q of QUESTIONS) {
    const sel = selectFaq(faq, q);
    if (sel.full) continue;
    const headings = sel.text.split("\n").filter((l) => l.startsWith("### ")).map((l) => l.slice(4));
    console.log(`\n  "${q}"`);
    for (const h of headings) console.log("      " + h);
}
console.log();
