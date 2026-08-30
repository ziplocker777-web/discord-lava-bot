require("./env.js").loadEnv();

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;
const { selectFaq } = require("./faqSelect.js");
const { buildAnswerEmbed, buildAnswerComponents } = require("./aiEmbed.js");
const { fetchAllPrices } = require("./lavaClient.js");

// The answers themselves live in faq.md, not here. That file is also what gets
// posted in the FAQ channel and pasted into Ticket Tool's ticket message, so
// there is exactly one copy of every answer. Editing the FAQ changes what this
// bot says; nothing here needs touching.
const FAQ_PATH = path.join(__dirname, "faq.md");
const LOG_PATH = path.join(__dirname, "supportLog.json");

const MODEL = "claude-sonnet-5";

// Prompt caching is only used when talking to Anthropic itself. Measured
// 2026-08-27: the tonwave gateway does not reject cache_control, it stops
// responding entirely — a question would hang until the request timed out
// rather than fail loudly. So the presence of a custom base URL turns it off.
// If this ever points back at Anthropic, caching comes back on by itself.
const CACHING = !process.env.ANTHROPIC_BASE_URL;

// Somebody is watching a "typing..." indicator while this runs. The SDK default
// is ten minutes, which for a chat message is the same as never.
const REQUEST_TIMEOUT_MS = 45000;

// Support answers are short by design. A cap this low is a deliberate choice, not
// an oversight: nobody reads a wall of text in a Discord channel, and a long
// answer usually means the model is padding rather than answering.
const MAX_TOKENS = 1024;

// Questions shorter than this are "hi", "?", "anyone here" — nothing to answer.
// Longer than the max is someone pasting a log, which belongs in a ticket.
const MIN_QUESTION_CHARS = 8;
const MAX_QUESTION_CHARS = 1500;

// Per-person throttle. Generous enough that a real conversation never hits it,
// tight enough that nobody can burn tokens for entertainment.
const RATE_LIMIT_COUNT = 6;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// The model prefixes every reply with one of these, and the prefix is stripped
// before the customer sees it. It exists so the log can tell "answered" from
// "sent to a ticket" without guessing at the wording — and the list of things it
// could NOT answer is the whole point of the log.
const MARK_ANSWERED = "ANSWERED:";
const MARK_NO_ANSWER = "NO_ANSWER:";

// How the reply looks in Discord. Gathered here because this is the part that
// gets reworded most often, and none of it should mean hunting through the
// request logic to find a string. Colours are the ones already used elsewhere in
// the bot: green for a straight answer, purple for "go to a ticket", amber for a
// notice that is not an answer at all, red for a failure.


/**
 * Strips the things customers paste into a public channel without thinking, before
 * the question leaves this machine.
 *
 * The model is told never to repeat them back, but an instruction is not a control:
 * whatever is in the question has already been sent by the time the model reads it.
 * Redacting here means it is never sent at all — which is what actually matters when
 * the request goes to somebody else's server, and stays true whichever provider is
 * on the other end.
 *
 * None of this costs an answer. "Where is my key ABCD-EFGH-JKMN-PQRS" and "where is
 * my key [licence key removed]" get the same reply, because the reply is "open a
 * ticket, I can't look up orders" either way.
 */
function redact(text) {
    return (text || "")
        // Any URL first — a download link carries the token inside it.
        .replace(/https?:\/\/\S+/gi, "[link removed]")
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
        // Licence keys: four groups of four, from an alphabet with no 0/O/1/I/L.
        .replace(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}\b/gi, "[licence key removed]")
        // Download tokens: 32 hex characters.
        .replace(/\b[0-9a-f]{32}\b/gi, "[token removed]")
        .trim();
}

/** Everything between <!-- --> is internal notes for Danil, never for customers. */
function loadFaq() {
    const raw = fs.readFileSync(FAQ_PATH, "utf-8");
    return raw.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function buildSystemPrompt(faq) {
    return `You are the support assistant for Ziplocker's Workshop, a shop selling visual and audio mods for GTA V (Story Mode and FiveM).

You answer customer questions in a Discord channel, using ONLY the FAQ reproduced at the end of this message.

## The one rule that matters

If the FAQ does not contain the answer, you do not know the answer. Say so and send them to a ticket. Never fill a gap with what sounds plausible — these are game files, and a confident wrong instruction can break someone's installation.

This applies especially to: prices, what a tier includes, refund decisions, file paths, folder names, command names, version numbers, and anything about a specific person's order.

## Anything about one specific order goes to a ticket

You cannot look anything up. You have no access to purchases, payments, keys, roles or accounts. If someone asks about THEIR order — "where is my key", "did my payment go through", "why was I charged", "can I have a refund" — give the general answer from the FAQ if there is one, then tell them to open a ticket for their own case.

## Never repeat personal data

People paste licence keys, emails and payment details into public channels. Never quote any of it back. If someone posts a licence key, tell them to delete the message.

## Format of your reply

Start every reply with exactly one of these markers, then a space, then your answer:

${MARK_ANSWERED} — the FAQ answers this, and your reply is that answer.
${MARK_NO_ANSWER} — the FAQ does not cover this; your reply says so and points them to a ticket.

The marker is stripped before the customer sees it. Never mention it, never explain it.

## How to write

- Reply in the same language the question was asked in.
- Short. Two or three sentences for most things. This is a chat message, not a manual.
- Discord formatting only: **bold**, \`code\`, - bullets. No markdown headers.
- Give the answer first. No greeting, no "great question", no sign-off.
- If a fix has steps, number them and keep each to one line.
- Never say "the FAQ says" or "according to the documentation". Just answer.
- Never mention that you are an AI, a model, or that you were given a file.
- If the question is vague, ask one specific clarifying question rather than guessing — that still counts as ${MARK_ANSWERED}.

## When you don't know

Say plainly that you don't have the answer and that a ticket is the way to get it. Do not apologise at length, do not speculate, do not offer a "you could try" that isn't in the FAQ.

---

# Channels

${channelBlock() ? `When you send someone somewhere, use the mention exactly as
written here — Discord turns it into a link they can click. Never write a channel
name as plain text when it is in this list.

${channelBlock()}` : "You have no channel ids. Refer to channels by name."}

---

# Prices

${priceBlock ? `These are live from the shop, and are the only prices to quote.
Currencies other than USD are converted at checkout.

${priceBlock}` : `You do not have prices right now. If someone asks what something
costs, say the panel in the shop channel shows it, and do not guess a number.`}

---

# FAQ

${faq}`;
}

const rateLimit = new Map(); // discordId -> number[] (timestamps)

function isRateLimited(discordId) {
    const now = Date.now();
    const hits = (rateLimit.get(discordId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (hits.length >= RATE_LIMIT_COUNT) {
        rateLimit.set(discordId, hits);
        return true;
    }
    hits.push(now);
    rateLimit.set(discordId, hits);
    return false;
}

/**
 * Appends one line to the log. The interesting half is the unanswered questions:
 * that list is what the FAQ should grow to cover next, drawn from what people
 * actually asked instead of from guesses about what they might ask.
 *
 * Written synchronously and tolerantly — a broken log must never take the bot
 * down, and at this volume the cost of the write is irrelevant.
 */
function logQuestion(entry) {
    // Short, random, and only ever used to find this row again from a button
    // press. Not a secret and not a sequence, so collisions are the only thing
    // that would matter and eight hex characters make those a non-problem at a
    // few hundred questions.
    const id = Math.random().toString(16).slice(2, 10);
    try {
        const existing = fs.existsSync(LOG_PATH)
            ? JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"))
            : [];
        existing.push({ id, at: new Date().toISOString(), ...entry });
        fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2));
    } catch (err) {
        console.error("[ai] could not write supportLog.json:", err.message);
    }
    return id;
}

/**
 * Adds up what the assistant has spent, straight from the log.
 *
 * The gateway sells a fixed pool of tokens and shows the balance only on its own
 * site, so without this there is no way to know from here how close the bot is to
 * going quiet. Running out is not catastrophic — questions start returning the
 * "something went wrong" reply — but it is the kind of thing worth a week's
 * warning rather than a surprise.
 *
 * Budget comes from AI_TOKEN_BUDGET, defaulting to the million that was bought.
 *
 * This is a FLOOR, not the bill. It counts what this process logged, which leaves
 * out three things the gateway still charges for:
 *
 *   - retries and failed calls — the model runs, the gateway counts it, and the
 *     error that comes back carries no usage to record;
 *   - anything run from another machine or another copy of the bot, since each
 *     keeps its own log;
 *   - check-key.js, which lists models and sends a test message every run.
 *
 * Measured 2026-08-27: this said ~15k while the gateway's own dashboard said
 * 139k for the same day. Treat the provider's figure as the real one.
 */
function usageSummary() {
    const budget = Number(process.env.AI_TOKEN_BUDGET) || 1000000;

    let questions = 0, answered = 0, input = 0, output = 0, up = 0, down = 0;

    // The expensive path, and the date the tally actually begins. Both exist
    // because this summary is easy to over-trust: see the note on `priced`.
    let fullFaq = 0;
    let since = null;

    // Counted separately from `questions`: entries logged before tokens were
    // recorded carry no cost, and a gateway hiccup can log one that cost nothing.
    // Averaging over those makes the projection look far rosier than it is.
    let priced = 0;

    try {
        const entries = fs.existsSync(LOG_PATH)
            ? JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"))
            : [];
        for (const e of entries) {
            questions += 1;
            if (e.answered) answered += 1;

            const cost = ((e.tokens && e.tokens.in) || 0) + ((e.tokens && e.tokens.out) || 0);
            if (cost > 0) {
                priced += 1;
                if (!since) since = e.at;
                if (e.fullFaq) fullFaq += 1;
            }
            input += (e.tokens && e.tokens.in) || 0;
            output += (e.tokens && e.tokens.out) || 0;

            for (const f of e.feedback || []) {
                if (f.vote === "up") up += 1;
                else if (f.vote === "down") down += 1;
            }
        }
    } catch (err) {
        console.error("[ai] could not read the log for a usage summary:", err.message);
    }

    const used = input + output;
    const remaining = Math.max(0, budget - used);
    const perQuestion = priced > 0 ? Math.round(used / priced) : 0;

    return {
        questions, answered, priced, up, down, fullFaq, since,
        input, output, used, budget, remaining,
        perQuestion,
        questionsLeft: perQuestion > 0 ? Math.floor(remaining / perQuestion) : null,
        percentUsed: budget > 0 ? (used / budget) * 100 : 0,
    };
}


/**
 * Writes a thumbs up or down against a logged question.
 *
 * The value of this is not the score, it is the pairing: a question, the answer
 * it got, and somebody saying that answer missed. supportLog.json already holds
 * everything the FAQ could not answer; this fills in the other half, the
 * questions it answered badly, which otherwise leave no trace at all.
 *
 * One vote per person per answer, changeable — someone who clicks the wrong one
 * should be able to fix it, and nobody should be able to stack a score.
 */
function recordFeedback({ logId, userId, vote }) {
    try {
        if (!fs.existsSync(LOG_PATH)) return { ok: false, reason: "no log" };
        const entries = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
        const entry = entries.find((e) => e.id === logId);
        if (!entry) return { ok: false, reason: "not found" };

        // Only the person who asked. The button means "this helped me", and a
        // passer-by's opinion of someone else's answer is a different signal
        // that would sit in the same column and be read as the first one.
        if (entry.discordId && String(entry.discordId) !== String(userId)) {
            return { ok: false, reason: "not yours" };
        }

        entry.feedback = (entry.feedback || []).filter((f) => f.by !== userId);
        entry.feedback.push({ by: userId, vote, at: new Date().toISOString() });

        fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2));
        return { ok: true, vote };
    } catch (err) {
        console.error("[ai] could not record feedback:", err.message);
        return { ok: false, reason: err.message };
    }
}

let client = null;
let faqText = null;

/**
 * The Discord client, kept only so the assistant can say when it has stopped
 * working.
 *
 * This is the failure nobody sees: the gateway goes down or the credit runs out,
 * and the assistant keeps answering "something went wrong, open a ticket" to
 * every customer for as long as it takes somebody to notice. It has happened
 * before. Now it says so once, and says so again when it recovers.
 */
let discord = null;
let aiBroken = null;

async function reportAi(broken, detail) {
    if (!discord) return;
    const { notifyOwner, clearThrottle } = require("./ownerNotify");

    if (broken) {
        if (aiBroken === detail) return;
        aiBroken = detail;
        clearThrottle("ai-back");
        await notifyOwner(discord,
            `**The support assistant has stopped answering**\n\n${detail}\n\n` +
            `Customers are being told to open a ticket instead.`,
            { key: "ai-down", cooldownMs: 60 * 60 * 1000 });
        return;
    }

    if (aiBroken) {
        const was = aiBroken;
        aiBroken = null;
        clearThrottle("ai-down");
        await notifyOwner(discord,
            `**The support assistant is answering again**\n\nIt was: ${was}`,
            { key: "ai-back", cooldownMs: 60 * 1000 });
    }
}

/**
 * Prices, read from lava.top rather than written into faq.md.
 *
 * A price in the FAQ is a price that goes stale the first time one changes, and
 * nobody remembers to edit it — the shop's own list is the only copy that stays
 * true. Refreshed on a timer because the app can run for weeks.
 *
 * Empty when the fetch fails. The assistant then simply has no prices to quote,
 * which is the right failure: the alternative is quoting a number nobody checked.
 */
/**
 * Where to send people, built from the ids the bot already runs on.
 *
 * The FAQ says "open a ticket" twenty-three times in words. Rewriting each one
 * as a link would put the same id in twenty-three places and leave it there when
 * a channel moves; the bot already knows every one of these from .env, so the
 * assistant is handed them once and told to use them.
 */
function channelBlock() {
    const rows = [
        ["Tickets, and anything about someone's own order", process.env.TICKET_CHANNEL_ID],
        ["This assistant", process.env.AI_CHANNEL_ID],
        ["Downloads for Basic", process.env.BASIC_CHANNEL_ID],
        ["Downloads for Membership and Premium", process.env.SUBSCRIBER_CHANNEL_ID],
        ["Update announcements", process.env.ANNOUNCEMENTS_CHANNEL_ID],
    ].filter(([, id]) => id);

    if (rows.length === 0) return "";
    return rows.map(([what, id]) => `- ${what}: <#${id}>`).join("\n");
}

let priceBlock = "";
let firstPriceFetch = null;
const PRICE_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Resolves once prices have been tried at least once. For scripts that ask
 *  immediately and would otherwise quote the no-prices fallback. */
function pricesReady() {
    return firstPriceFetch || Promise.resolve();
}

async function refreshPrices() {
    const products = await fetchAllPrices();
    if (!products) return;

    const lines = [];
    for (const product of products) {
        // One offer named after its own product is just the product; several
        // means tiers or variants, and those want naming.
        const single = product.offers.length === 1;
        for (const offer of product.offers) {
            // "Subscription ziplocker" is the raw shop name for the tiers and is
            // never shown to a buyer; the tier is what they call it.
            const label = single
                ? product.title
                : product.title.toLowerCase().includes("subscription")
                    ? `${offer.name} subscription`
                    : `${product.title} — ${offer.name}`;
            lines.push(`- ${label}: $${offer.usd}`);
        }
    }

    priceBlock = lines.join("\n");
    console.log(`[prices] ${lines.length} price(s) loaded for the assistant`);
}

/**
 * Splits the marker off the model's reply. Separated out so it can be tested
 * without a network call, and because the failure it guards against is silent:
 * a marker left in place is shown to a customer as "ANSWERED: ...".
 */
function parseReply(text) {
    const trimmed = (text || "").trim();
    const answered = !trimmed.startsWith(MARK_NO_ANSWER);
    let reply = trimmed;
    for (const marker of [MARK_ANSWERED, MARK_NO_ANSWER]) {
        if (reply.startsWith(marker)) reply = reply.slice(marker.length);
    }
    return { reply: reply.trim(), answered };
}

/** Asks Claude, returns { reply, answered }. Throws only on API failure. */
async function ask(question) {
    // Only the part of the FAQ this question is about. Falls back to the whole
    // document whenever the match is not convincing, so a cheaper request is
    // never a worse answer — see faqSelect.js.
    const selection = selectFaq(faqText, question);
    const systemPrompt = buildSystemPrompt(selection.text);

    const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Thinking stays on (adaptive is the only on-mode here) but at low effort:
        // finding an answer inside a document that is already in front of it does
        // not need deep reasoning, and this is a chat message someone is waiting on.
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        // With caching on, the prompt must be a block so the breakpoint has
        // something to attach to; without it, a plain string is the same request
        // with less to go wrong. Note that the cached path is now the one that is
        // NOT exercised in production — see CACHING above.
        system: CACHING
            ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
            : systemPrompt,
        messages: [{ role: "user", content: question }],
    });

    const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

    // Seen from the tonwave gateway: a 200 with no content blocks and zero usage.
    // Left alone it becomes an embed with an empty description, which Discord
    // rejects outright — so the customer gets silence rather than a reply. Better
    // to fail here and let the caller send its "something went wrong" answer.
    if (!text) {
        throw new Error("the gateway returned an empty response");
    }

    const { reply, answered } = parseReply(text);

    // The FAQ column is the one to watch. If "full" shows up on questions that are
    // plainly covered by the FAQ, the selector is matching too weakly and the
    // saving is not happening.
    const usage = response.usage || {};
    console.log(
        `[ai] ${answered ? "answered" : "NO ANSWER"} | ` +
        `faq ${selection.full ? "full" : `${selection.picked} of ${selection.reason}`} | ` +
        `in ${usage.input_tokens ?? "?"} cached ${usage.cache_read_input_tokens ?? 0} ` +
        `out ${usage.output_tokens ?? "?"}`
    );

    return { reply, answered, usage, selection };
}

/**
 * Handles one question from a person, wherever it arrived from. Returns the text
 * to send back, or null when the message should be ignored entirely.
 */
async function handleQuestion({ question, discordId, username, source }) {
    const started = Date.now();
    const trimmed = (question || "").trim();

    if (trimmed.length < MIN_QUESTION_CHARS) return null;
    if (trimmed.length > MAX_QUESTION_CHARS) {
        return {
            kind: "notice",
            text: "That's a lot to read through here — open a ticket and paste it there, so someone can actually go through it with you.",
        };
    }
    if (isRateLimited(discordId)) {
        return {
            kind: "notice",
            text: "You've asked a few questions in a row — give it a few minutes, or open a ticket if it's urgent.",
        };
    }

    // Redacted before the API call and before the log, so neither the provider nor
    // supportLog.json ever holds a customer's key or email.
    const safe = redact(trimmed);

    try {
        const { reply, answered, usage, selection } = await ask(safe);
        // Cost is recorded against the question that incurred it. Keeping it here
        // rather than in a separate counter means the tally cannot drift from the
        // log, and an expensive question can always be traced back to its text.
        const logId = logQuestion({
            discordId, username, source, question: safe, answered,
            tokens: {
                in: usage.input_tokens || 0,
                out: usage.output_tokens || 0,
            },
            // Whether the selector gave up and sent the whole document. These are
            // the expensive answers — roughly seven times the cost of a narrowed
            // one — so knowing how many there were is knowing where the budget
            // actually goes.
            fullFaq: !!(selection && selection.full),
        });
        // The redacted question goes back out, never the raw one: whatever the
        // customer pasted has already been stripped, and the title must not put
        // a licence key back on screen.
        await reportAi(false);

        return {
            kind: answered ? "answer" : "no_answer",
            text: reply,
            question: safe,
            ms: Date.now() - started,
            logId,
        };
    } catch (err) {
        // Typed first, so a rate limit reads differently from a broken key.
        if (err instanceof Anthropic.RateLimitError) {
            console.error("[ai] rate limited by the API");
            return "I'm getting a lot of questions at once — try again in a minute, or open a ticket.";
        }
        if (err instanceof Anthropic.AuthenticationError) {
            console.error("[ai] ANTHROPIC_API_KEY is missing or invalid");
            // Out of credit looks exactly like this on a gateway, and that is
            // the likelier of the two: the key worked yesterday.
            await reportAi(true, "The API key was rejected — most likely the credit has run out.");
        } else if (err instanceof Anthropic.APIError && err.status >= 500) {
            // The gateway is down, not the bot. Worth saying plainly: "something
            // went wrong on my end" sends people to a ticket believing their
            // order broke, when the answer is simply to ask again later.
            console.error(`[ai] gateway is down (${err.status}) — answering is off until it returns`);
            await reportAi(true, `The provider is returning ${err.status}. Nothing wrong on our side.`);
            logQuestion({ discordId, username, source, question: safe, answered: false, error: `gateway ${err.status}` });
            return {
                kind: "error",
                text: "The assistant is offline for a moment — that's on the provider, not your order. Try again shortly, or open a ticket if it's urgent.",
            };
        } else if (err instanceof Anthropic.APIError) {
            console.error(`[ai] API error ${err.status}:`, err.message);
        } else {
            console.error("[ai] unexpected failure:", err.message);
        }
        logQuestion({ discordId, username, source, question: safe, answered: false, error: err.message });
        return {
            kind: "error",
            text: "Something went wrong on my end. Open a ticket and someone will pick it up.",
        };
    }
}

/**
 * Wires the assistant into the Discord client. Answers in one dedicated channel,
 * and anywhere it is mentioned by name.
 *
 * Deliberately NOT active in ticket channels: a bot talking over a human mid-ticket
 * is worse than no bot. Deflection happens before the ticket is opened, not inside it.
 */
/**
 * Sends something to Discord, and tries again when the connection drops.
 *
 * Measured 2026-08-27 on this machine: roughly four in ten replies failed with a
 * connect timeout to Discord's Cloudflare front (162.159.x.x) while the model
 * itself answered every time. From the customer's side that is indistinguishable
 * from the bot ignoring them %s the question is read, the typing indicator shows,
 * and nothing ever arrives. Retrying costs nothing when the link is healthy.
 */
async function sendWithRetry(send, what, attempts = 3) {
    let lastErr = null;
    for (let i = 1; i <= attempts; i += 1) {
        try {
            return await send();
        } catch (err) {
            lastErr = err;
            console.warn(`[ai] ${what} failed (attempt ${i}/${attempts}): ${err.message}`);
            if (i < attempts) await new Promise((r) => setTimeout(r, 800 * i));
        }
    }
    throw lastErr;
}

/**
 * Brings the assistant up without touching Discord. Split out from
 * registerAiSupport so the thing can be exercised from a terminal — ask.js uses
 * this — which means a change to the prompt or the FAQ can be checked against
 * real answers without putting the bot online in front of customers first.
 *
 * Returns false, having said why, when it is not configured to run.
 */
function initAi() {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.warn("[ai] ANTHROPIC_API_KEY is not set — the support assistant is off.");
        return false;
    }
    if (!fs.existsSync(FAQ_PATH)) {
        console.warn("[ai] faq.md not found — the support assistant is off.");
        return false;
    }

    // Requests do not go to Anthropic. They go through the tonwave gateway, and
    // the SDK picks that up from ANTHROPIC_BASE_URL on its own — nothing here
    // needs to pass it. The one thing worth catching is the trailing /v1: the
    // Anthropic-shaped endpoint is the bare host, and /v1 there fails in a way
    // that looks like a bad key rather than a bad URL.
    const endpoint = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    if (endpoint.replace(/\/+$/, "").endsWith("/v1")) {
        console.warn(
            `[ai] ANTHROPIC_BASE_URL ends in /v1 (${endpoint}) — that is the ` +
            "OpenAI-shaped path. This bot speaks the Anthropic format, so drop the /v1."
        );
    }

    client = new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
    faqText = loadFaq();

    // Not awaited: a slow shop API must not hold up the bot coming online, and
    // until the first fetch lands the assistant just has no prices to quote.
    firstPriceFetch = refreshPrices();
    setInterval(refreshPrices, PRICE_REFRESH_MS).unref?.();

    console.log(
        `[ai] model ${MODEL} via ${endpoint}, caching ${CACHING ? "on" : "off"}, ` +
        `FAQ ${faqText.length} chars`
    );
    return true;
}

function registerAiSupport(discordClient, { Events }) {
    if (!initAi()) return;

    discord = discordClient;

    const channelId = process.env.AI_CHANNEL_ID || null;
    console.log(
        "[ai] support assistant ready" +
        (channelId ? `, channel ${channelId}` : ", mentions only (AI_CHANNEL_ID not set)")
    );

    discordClient.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;
        if (!message.guild) return;

        const mentioned = message.mentions.users.has(discordClient.user.id);
        const inChannel = channelId && message.channel.id === channelId;
        if (!mentioned && !inChannel) return;

        // Strip the mention itself so the model sees the question, not "<@123> ...".
        const question = message.content.replace(/<@!?\d+>/g, " ").trim();

        try {
            // Best effort: a failed typing indicator must not cost the answer that
            // follows it, so it is deliberately not retried and not fatal.
            await message.channel.sendTyping().catch(() => {});

            const result = await handleQuestion({
                question,
                discordId: message.author.id,
                username: message.author.username,
                source: inChannel ? "channel" : "mention",
            });
            if (!result) return;

            const embed = buildAnswerEmbed({
                kind: result.kind,
                text: result.text,
                question: result.question,
                user: message.author,
            });
            const components = buildAnswerComponents({
                kind: result.kind,
                logId: result.logId,
            });
            await sendWithRetry(
                () => message.reply({ embeds: [embed], components }),
                "channel reply"
            );
        } catch (err) {
            console.error("[ai] could not reply in Discord:", err.message);
        }
    });
}

module.exports = {
    registerAiSupport, initAi, handleQuestion, parseReply, redact, loadFaq,
    buildSystemPrompt, selectFaq, sendWithRetry, recordFeedback, usageSummary, pricesReady,
    MODEL, CACHING,
};
