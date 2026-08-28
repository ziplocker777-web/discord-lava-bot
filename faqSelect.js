/**
 * Picks the part of the FAQ that a question is actually about.
 *
 * Why this exists: the whole FAQ is ~5900 tokens, it rides along with every
 * question unchanged, and the gateway this bot runs on does not do prompt
 * caching — so that prefix is paid for in full, every time. A bought million
 * tokens is about 170 questions at that rate.
 *
 * The design rule here is that saving money must never cost an answer. So the
 * fallback is the whole FAQ: when the question does not clearly match anything,
 * or matches too much, the model gets everything exactly as before. The cheap
 * path is an optimisation, not a gate — worst case is today's cost, never a
 * worse answer.
 */

// Words that appear everywhere and mean nothing for matching. English because
// the FAQ is in English, Russian because half the customers ask in Russian.
const STOPWORDS = new Set([
    "the", "and", "for", "are", "you", "your", "can", "not", "but", "with", "how",
    "what", "why", "when", "does", "did", "was", "were", "this", "that", "there",
    "from", "have", "has", "had", "will", "would", "should", "could", "about",
    "into", "onto", "out", "any", "all", "get", "got", "one", "two", "its", "it's",
    "use", "using", "used", "need", "want", "just", "some", "than", "then", "them",
    "they", "which", "who", "whom", "been", "being", "here", "very", "much", "more",
    "как", "что", "это", "для", "или", "если", "мне", "меня", "мой", "моя", "мои",
    "где", "когда", "почему", "надо", "нужно", "можно", "быть", "есть", "нет",
    "так", "там", "тут", "уже", "ещё", "еще", "все", "всё", "его", "ему", "она",
    "они", "вот", "чем", "чтобы", "после", "перед", "без", "при", "над", "под",
]);

/**
 * The FAQ is written in English; a good share of the questions are not. Without
 * this, every Russian question falls back to the full document and the saving
 * never happens for the people who most often ask.
 *
 * Deliberately a plain table rather than anything cleverer: it is inspectable,
 * it cannot invent a match, and a word that is missing from it costs nothing
 * worse than the fallback that would have happened anyway. Keys are matched as
 * stems — "подпис" covers подписка, подписки, подписку, подписаться.
 */
const RU_STEMS = [
    ["подпис", "subscription subscribe tier"],
    ["отмен", "cancel"],
    ["оплат", "payment paid pay"],
    ["плат", "payment pay billed"],
    ["куп", "buy purchase"],
    ["покуп", "buy purchase"],
    ["цен", "price cost"],
    ["стоим", "price cost"],
    ["верн", "refund"],
    ["возврат", "refund"],
    ["деньг", "refund payment money"],
    ["ключ", "key licence"],
    ["лиценз", "licence key"],
    ["роль", "role"],
    ["рол", "role"],
    ["скач", "download"],
    ["загруз", "download"],
    ["устан", "install"],
    ["игр", "game"],
    ["работа", "work not working"],
    ["не работа", "not working broken"],
    ["пахает", "not working"],
    ["сервер", "server fivem"],
    ["пришл", "delivered nothing happened"],
    ["получ", "receive delivered"],
    ["почт", "email"],
    ["email", "email"],
    ["аккаунт", "account discord"],
    ["дискорд", "discord account"],
    ["фпс", "fps performance"],
    ["лаг", "fps performance"],
    ["произв", "fps performance"],
    ["краш", "crash"],
    ["вылет", "crash"],
    ["ошибк", "error"],
    ["поддерж", "support supported"],
    ["совмест", "compatible"],
    ["вспышк", "muzzle flash"],
    ["ствол", "muzzle"],
    ["кров", "blood"],
    ["звук", "sound audio"],
    ["трасс", "tracer"],
    ["продлен", "renewal billed"],
    ["списал", "billed charged"],
    ["тариф", "tier subscription"],
    ["разниц", "difference"],
    ["отлич", "difference"],
];

/**
 * People do not ask using the words a document is written in. The FAQ says
 * "install"; customers say "set up". It says "buy"; they say "get" or "order".
 *
 * Same shape and same reasoning as RU_STEMS: a plain table, matched as stems, and
 * a miss costs nothing worse than the fallback to the whole FAQ that would have
 * happened anyway.
 */
const EN_STEMS = [
    ["set up", "install installation"],
    ["setup", "install installation"],
    ["setting up", "install installation"],
    ["configure", "install configurator settings"],
    ["how to install", "install installation openiv oiv"],
    ["install", "install installation files"],
    ["order", "buy purchase"],
    ["purchase", "buy purchase"],
    ["checkout", "buy payment"],
    ["cost", "price"],
    ["how much", "price cost"],
    ["cancel", "cancel subscription"],
    ["broken", "not working crash"],
    ["doesn't work", "not working"],
    ["does not work", "not working"],
    ["not working", "not working crash"],
    ["missing", "not working delivered"],
    ["where is", "where delivered"],
    ["stopped working", "update crash"],
];

/**
 * Scores an entry against a question's terms.
 *
 * A hit in the heading counts triple: FAQ headings are written as the questions
 * customers ask, so matching one is a much stronger signal than the same word
 * turning up somewhere in a paragraph.
 *
 * On top of that, a term that appears in only one or two entries is worth more
 * than one sprinkled through the whole document. "openiv" names exactly one
 * answer; "muzzle" names a dozen. Without this, a single decisive keyword loses
 * to two vague ones.
 */
function weightFor(df) {
    if (df <= 2) return 2;
    if (df <= 5) return 1.5;
    if (df <= 10) return 1;
    // Words like "mods" or "buy" turn up in a fifth of the document. They say
    // almost nothing about which answer is wanted, and left at full weight they
    // let a question match whatever happens to mention them most.
    return 0.5;
}

/**
 * Splits the FAQ into one entry per `###` question, each carrying the `#` section
 * it sits under. The section title is kept because it is often the only place a
 * word like "subscription" or "refund" appears.
 */
function splitFaq(faq) {
    const lines = faq.split(/\r?\n/);
    const entries = [];
    let section = "";
    let current = null;

    for (const line of lines) {
        const h1 = /^#\s+(.*)$/.exec(line);
        const h3 = /^###\s+(.*)$/.exec(line);

        if (h1) {
            if (current) entries.push(current);
            current = null;
            section = h1[1].trim();
            continue;
        }
        if (h3) {
            if (current) entries.push(current);
            current = { section, heading: h3[1].trim(), body: [] };
            continue;
        }
        if (current) current.body.push(line);
    }
    if (current) entries.push(current);

    return entries.map((e) => ({
        section: e.section,
        heading: e.heading,
        text: `### ${e.heading}\n${e.body.join("\n").trim()}`,
        haystack: (e.section + " " + e.heading + " " + e.body.join(" ")).toLowerCase(),
        // The entry's OWN heading, with the section kept separate. Folding the two
        // together was a real bug: the section "2. Before you buy" handed a
        // heading-strength match on "buy" to all eleven questions underneath it,
        // so "Which games are supported?" outranked "How do I buy?" on a question
        // about buying. A section says roughly what an answer is near; only the
        // heading says what it IS.
        headingHay: e.heading.toLowerCase(),
        sectionHay: (e.section || "").toLowerCase(),
    }));
}

/**
 * Question -> the words worth matching on, with Russian mapped across to the
 * English the FAQ is written in. The original words are kept too: product names,
 * commands and version numbers survive untranslated in any language.
 */
function terms(question) {
    const lowered = (question || "").toLowerCase();

    const own = lowered
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(" ")
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

    const mapped = [];
    for (const [stem, english] of RU_STEMS) {
        if (lowered.includes(stem)) mapped.push(...english.split(" "));
    }
    for (const [stem, english] of EN_STEMS) {
        if (lowered.includes(stem)) mapped.push(...english.split(" "));
    }

    return [...new Set([...own, ...mapped])];
}

function score(entry, ts, dfs, headingDfs) {
    let total = 0;
    let matched = 0;
    let decisive = false;

    for (const t of ts) {
        // Each term counts once, at the strongest place it appears. Before this,
        // a word in both the heading and the body scored twice, which quietly
        // rewarded long answers for being long.
        let place;
        if (entry.headingHay.includes(t)) place = 4;
        else if (entry.sectionHay.includes(t)) place = 1.5;
        else if (entry.haystack.includes(t)) place = 1;
        else continue;

        matched += 1;
        total += place * weightFor(dfs.get(t) || 99);

        // One word is enough on its own when it titles only a handful of answers.
        // This is the "do i need openiv" case: a single term, but it can only mean
        // one thing. What makes a term decisive is naming few ANSWERS, not being
        // rare in the prose.
        if (place === 4 && (headingDfs.get(t) || 99) <= 4) decisive = true;

        // And a word that appears in only one or two answers out of ninety
        // identifies those answers wherever it sits. "emissive" and "distortion"
        // are named in the settings reference and nowhere else — without this
        // they fall back to the whole FAQ, which since the reference was added
        // is an expensive way to answer a one-word question.
        if ((dfs.get(t) || 99) <= 2) decisive = true;
    }

    return { total, matched, decisive };
}

/**
 * Returns the FAQ text to put in front of the model.
 *
 * `full: true` means the caller is getting everything — either because nothing
 * matched well enough to trust, or because the FAQ is small enough that picking
 * is pointless.
 */
function selectFaq(faq, question, options = {}) {
    const {
        budgetChars = 6000,   // ~1500 tokens of FAQ, against ~5900 for all of it
        // Eight rather than six: measured across all 78 FAQ answers, six reaches
        // 77 of them and eight reaches all 78, for two percentage points of
        // saving. A missed answer costs a customer a reply; two points do not.
        maxEntries = 8,
        minTerms = 2,         // fewer real matches than this and we do not trust it
        minScore = 4,
    } = options;

    const entries = splitFaq(faq);
    const ts = terms(question);

    // Nothing to pick from, or nothing to pick with.
    if (entries.length < 4 || ts.length === 0) {
        return { text: faq, full: true, picked: entries.length, reason: "no basis to narrow" };
    }

    // Two different frequencies, because they answer different questions.
    // dfs = how common the word is overall, which discounts filler.
    // headingDfs = how many answers it titles, which is what makes it decisive.
    const dfs = new Map();
    const headingDfs = new Map();
    for (const t of ts) {
        dfs.set(t, entries.reduce((n, e) => n + (e.haystack.includes(t) ? 1 : 0), 0));
        headingDfs.set(t, entries.reduce((n, e) => n + (e.headingHay.includes(t) ? 1 : 0), 0));
    }

    const ranked = entries
        .map((e) => ({ entry: e, ...score(e, ts, dfs, headingDfs) }))
        .filter((r) => r.matched > 0)
        .sort((a, b) => b.total - a.total || b.matched - a.matched);

    const best = ranked[0];

    // The question is about something the FAQ never mentions, or it is worded so
    // vaguely that any pick would be a guess. Guessing here is how a customer gets
    // told "I don't know" about something that is documented.
    // Either several terms agree, or one term names the answer outright. The
    // score floor still guards the first branch, so a lone common word turning up
    // in one heading cannot drag the whole thing along.
    const trusted = best && ((best.total >= minScore && best.matched >= minTerms) || best.decisive);
    if (!trusted) {
        return { text: faq, full: true, picked: 0, reason: "weak match" };
    }

    // Words that say what the person is trying to DO, as opposed to what they are
    // talking about. A question naming two products and asking how to install
    // them is dominated by the product names on raw scoring, and the install
    // answer never makes the cut -- so if an intent word titles an answer, that
    // answer is in, whatever it scored.
    //
    // Collected from both directions. Observed 2026-08-28: "how do i install the
    // muzzle flash" was answered NO ANSWER because only the mapped side was
    // consulted -- "how to install" is in the table but "how do i install" is
    // not, so nothing mapped, and the guarantee never fired for a question with
    // the word "install" right there in it. Every value in the tables is an
    // intent word by construction, so a literal one counts the same.
    const lowered = (question || "").toLowerCase();
    const intent = new Set();

    for (const [stem, english] of [...RU_STEMS, ...EN_STEMS]) {
        if (!lowered.includes(stem)) continue;
        for (const w of english.split(" ")) intent.add(w);
    }

    const intentVocabulary = new Set(
        [...RU_STEMS, ...EN_STEMS].flatMap(([, english]) => english.split(" "))
    );
    for (const t of ts) {
        if (intentVocabulary.has(t)) intent.add(t);
    }
    const guaranteed = [];
    for (const w of intent) {
        // Ranked by how much the heading is ABOUT this word, not by the overall
        // score. Sorting by score puts the loudest match first, and the loudest
        // match is decided by the same common words the guarantee exists to
        // outvote: "how do i install the muzzle flash" chose "I bought several
        // mods - how do I install them together?" over "How do I install?".
        // A short heading carrying the word is the one that answers it.
        const hits = ranked
            .filter((r) => r.entry.headingHay.includes(w))
            .sort((a, b) => a.entry.headingHay.length - b.entry.headingHay.length)
            .slice(0, 2);
        for (const hit of hits) if (!guaranteed.includes(hit)) guaranteed.push(hit);
    }

    const picked = [];
    let used = 0;
    for (const r of [...guaranteed, ...ranked]) {
        if (picked.includes(r.entry)) continue;
        if (picked.length >= maxEntries) break;
        if (used + r.entry.text.length > budgetChars && picked.length > 0) break;
        picked.push(r.entry);
        used += r.entry.text.length;
    }

    // If the "narrowed" set is most of the FAQ anyway, the narrowing bought
    // nothing and cost the risk of having dropped the one relevant paragraph.
    if (used > faq.length * 0.6) {
        return { text: faq, full: true, picked: entries.length, reason: "subset too large" };
    }

    // Grouped under their section headings so the model sees the same structure
    // it would have seen in the full document.
    const bySection = new Map();
    for (const e of picked) {
        if (!bySection.has(e.section)) bySection.set(e.section, []);
        bySection.get(e.section).push(e.text);
    }
    const text = [...bySection.entries()]
        .map(([sec, items]) => (sec ? `# ${sec}\n\n` : "") + items.join("\n\n"))
        .join("\n\n");

    return { text, full: false, picked: picked.length, reason: "matched", score: best.total };
}

module.exports = { selectFaq, splitFaq, terms, score, weightFor, RU_STEMS, EN_STEMS };
