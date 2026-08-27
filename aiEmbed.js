/**
 * How an AI support reply looks in Discord.
 *
 * Split out from aiSupport.js because presentation now has its own weight —
 * embed, buttons, wording, colours — and none of it has anything to do with
 * asking the model a question. It also means both entry points, the help channel
 * and /ask, build their reply from exactly the same place: a customer seeing a
 * different-looking answer depending on how they asked is the kind of thing
 * nobody reports and everybody notices.
 *
 * All customer-facing text here is English, deliberately. The ANSWER follows the
 * language of the question — that is the model's job, driven by the system
 * prompt — but the frame around it does not wobble between languages.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");

const LOOK = {
    title: "\u{1F916} AI Answer",
    colour: {
        // White for anything a customer reads as an answer. The two states that
        // are the bot talking about itself keep a tint, because those are worth
        // spotting at a glance while scrolling a channel.
        answer: "#FFFFFF",
        no_answer: "#FFFFFF",
        notice: "#FAA61A",
        error: "#ED4245",
    },
    // Discord's own caps, minus room for the ellipsis. Answers are capped at
    // MAX_TOKENS long before the description limit, so that guard is for the day
    // someone raises MAX_TOKENS and forgets this exists.
    maxQuestion: 300,
    maxDescription: 4000,
    labels: {
        helpful: "\u{1F44D} Helpful",
        notHelpful: "\u{1F44E} Not helpful",
        ticket: "Open a ticket",
    },
};

// Buttons carry which log entry they belong to, so a vote can be written back
// against the question that earned it. Colon-separated because Discord allows
// 100 characters here and an id is eight.
const FEEDBACK_PREFIX = "ai_fb";

function clip(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * Where the ticket button points. Built from ids rather than an invite link so
 * it survives the server being renamed, and returns null when either id is
 * missing — a button with no destination is worse than no button.
 */
function ticketUrl() {
    const guild = process.env.GUILD_ID;
    const channel = process.env.TICKET_CHANNEL_ID;
    if (!guild || !channel) return null;
    return `https://discord.com/channels/${guild}/${channel}`;
}

/**
 * The reply itself.
 *
 * Layout, top to bottom: who asked (avatar and name), that this came from the
 * assistant, the question, then the answer. The question sits in Discord's
 * subtext style — it is context for the answer, not a competing headline, and in
 * /ask it is the only thing telling you what was asked at all, since an
 * ephemeral reply arrives with nothing around it.
 */
function buildAnswerEmbed({ kind, text, question, user }) {
    const answered = kind === "answer" || kind === "no_answer";

    const body = answered && question
        ? `-# ${clip(question, LOOK.maxQuestion)}\n\n${text}`
        : text;

    const embed = new EmbedBuilder()
        .setColor(LOOK.colour[kind] || LOOK.colour.answer)
        .setDescription(clip(body, LOOK.maxDescription))
        .setTimestamp();

    // The asker's avatar and name. This is the only place in an embed where a
    // face fits without competing with the answer, and it is what makes a reply
    // in a busy channel obviously belong to someone.
    if (user) {
        embed.setAuthor({
            name: user.username,
            iconURL: user.displayAvatarURL ? user.displayAvatarURL() : undefined,
        });
    }

    // A notice is the bot talking about itself — a rate limit, a wall of text, a
    // failure. Titling that "AI Answer" would be claiming it answered something.
    if (answered) embed.setTitle(LOOK.title);

    return embed;
}

/**
 * Buttons under the reply.
 *
 * The two votes are the point: supportLog.json already records what the FAQ
 * could not answer, and this adds the half that is currently invisible —
 * questions it DID answer, badly. Those are the ones nobody complains about and
 * nobody comes back from.
 *
 * Returns an empty array when there is nothing worth offering, which Discord
 * treats as "no components" without complaint.
 */
function buildAnswerComponents({ kind, logId }) {
    const answered = kind === "answer" || kind === "no_answer";
    if (!answered || !logId) return [];

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${FEEDBACK_PREFIX}:up:${logId}`)
            .setLabel(LOOK.labels.helpful)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${FEEDBACK_PREFIX}:down:${logId}`)
            .setLabel(LOOK.labels.notHelpful)
            .setStyle(ButtonStyle.Secondary),
    );

    // Only when the assistant has admitted it cannot help. On an answer this
    // would be an invitation to open a ticket that did not need opening, which
    // is the opposite of what the assistant is for.
    const url = ticketUrl();
    if (kind === "no_answer" && url) {
        row.addComponents(
            new ButtonBuilder()
                .setLabel(LOOK.labels.ticket)
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );
    }

    return [row];
}

/** `ai_fb:up:1a2b3c4d` -> { vote: "up", logId: "1a2b3c4d" }, or null. */
function parseFeedbackId(customId) {
    if (!customId || !customId.startsWith(FEEDBACK_PREFIX + ":")) return null;
    const [, vote, logId] = customId.split(":");
    if ((vote !== "up" && vote !== "down") || !logId) return null;
    return { vote, logId };
}

module.exports = {
    buildAnswerEmbed,
    buildAnswerComponents,
    parseFeedbackId,
    ticketUrl,
    LOOK,
    FEEDBACK_PREFIX,
};
