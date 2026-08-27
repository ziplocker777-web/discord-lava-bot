// Recall test: for every answer in the FAQ, does the selector still include it
// when asked about it? A miss here is the failure that costs a customer an
// answer — the model is told to use ONLY what it is given, so an entry left out
// becomes "I don't know" about something that is documented.
//
// Two passes, one optimistic and one harsh:
//   heading — the question is the FAQ's own heading, worded as a customer would
//   body    - the question is built from the ANSWER text, with heading words
//             removed, so nothing overlaps the heading the selector scores on

require("dotenv").config({ quiet: true });

const { loadFaq } = require("./aiSupport.js");
const { selectFaq, splitFaq } = require("./faqSelect.js");

const faq = loadFaq();
const entries = splitFaq(faq);

function includes(sel, entry) {
    return sel.full || sel.text.includes("### " + entry.heading);
}

function report(name, questionFor) {
    let hit = 0, missed = [], narrowed = 0;
    for (const e of entries) {
        const q = questionFor(e);
        if (!q || q.split(" ").length < 3) continue;
        const sel = selectFaq(faq, q);
        if (!sel.full) narrowed += 1;
        if (includes(sel, e)) hit += 1;
        else missed.push({ heading: e.heading, q: q.slice(0, 70) });
    }
    const n = hit + missed.length;
    console.log(`\n=== ${name} ===`);
    console.log(`  ${hit}/${n} answers still reachable  (${Math.round(hit / n * 100)}% recall)`);
    console.log(`  ${narrowed}/${n} of those were narrowed rather than sent whole`);
    if (missed.length) {
        console.log("  MISSED:");
        for (const m of missed) console.log(`    "${m.q}"  ->  lost: ${m.heading}`);
    }
    return missed.length;
}

const strip = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

let fails = 0;

fails += report("asked using the FAQ's own heading", (e) => strip(e.heading));

fails += report("asked using the answer text, heading words removed", (e) => {
    const headWords = new Set(strip(e.heading).split(" "));
    const body = strip(e.text.split("\n").slice(1).join(" "));
    const words = body.split(" ").filter((w) => !headWords.has(w) && w.length >= 3);
    return words.slice(0, 14).join(" ");
});

console.log();
process.exit(fails > 0 ? 1 : 0);
