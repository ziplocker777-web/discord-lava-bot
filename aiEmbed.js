/**
 * How an AI support reply looks in Discord.
 *
 * Split out from aiSupport.js because presentation now has its own weight —
 * layout, buttons, wording, colours — and none of it has anything to do with
 * asking the model a question. It also means both entry points, the help channel
 * and /ask, build their reply from exactly the same place: a customer seeing a
 * different-looking answer depending on how they asked is the kind of thing
 * nobody reports and everybody notices.
 *
 * Built as a container rather than an embed, matching the reviews. That is what
 * makes Discord's own separator available — a rule drawn out of characters is a
 * fixed width in a place that is not one, and wraps on a phone — and it lets the
 * asker's avatar sit in the layout instead of being shrunk into the corner of an
 * author line. Headings work inside a container too, so the label can be a
 * heading rather than bold text pretending to be one.
 *
 * All customer-facing text here is English, deliberately. The ANSWER follows the
 * language of the question — that is the model's job, driven by the system
 * prompt — but the frame around it does not wobble between languages.
 */

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ThumbnailBuilder,
} = require("discord.js");

const LOOK = {
    title: "\u{1F4AC} AI Answer",
    colour: {
        // White for anything a customer reads as an answer. The two states that
        // are the bot talking about itself keep a tint, because those are worth
        // spotting at a glance while scrolling a channel.
        answer: 0xFFFFFF,
        no_answer: 0xFFFFFF,
        notice: 0xFAA61A,
        error: 0xED4245,
    },
    // Discord's own caps, minus room for the ellipsis. Answers are capped at
    // MAX_TOKENS long before this, so the guard is for the day someone raises
    // MAX_TOKENS and forgets this exists.
    maxQuestion: 300,
    maxAnswer: 3800,
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
 * The buttons.
 *
 * The two votes are the point: supportLog.json already records what the FAQ
 * could not answer, and this adds the half that is currently invisible —
 * questions it DID answer, badly. Those are the ones nobody complains about and
 * nobody comes back from.
 */
function feedbackRow({ kind, logId }) {
    const answered = kind === "answer" || kind === "no_answer";
    if (!answered || !logId) return null;

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

    return row;
}

/**
 * The whole reply, ready to hand to reply() or editReply().
 *
 * Top to bottom: who asked, that this came from the assistant, what they asked,
 * the line, then the answer. The question sits above the rule as context and the
 * answer below it as the payload — in /ask it is also the only thing saying what
 * was asked at all, since an ephemeral reply arrives with nothing around it.
 */
function buildAnswer({ kind, text, question, user, logId }) {
    const answered = kind === "answer" || kind === "no_answer";
    const container = new ContainerBuilder()
        .setAccentColor(LOOK.colour[kind] ?? LOOK.colour.answer);

    if (answered) {
        const header = new SectionBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**${user?.username || "Someone"}**`),
            new TextDisplayBuilder().setContent(`## ${LOOK.title}`),
        );

        // Plain, not subtext. The question was set in the small grey style as
        // "context, not a competing headline" and went too far: in a channel it
        // was the one line you had to squint at, and in /ask it is the only
        // record of what was asked at all.
        if (question) {
            header.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(clip(question, LOOK.maxQuestion)));
        }

        // The avatar belongs in the layout rather than shrunk into a corner: it
        // is what makes a reply in a busy channel obviously belong to someone.
        const avatar = user?.displayAvatarURL?.({ size: 128 });
        if (avatar) header.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar));

        container
            .addSectionComponents(header)
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
                    .setSpacing(SeparatorSpacingSize.Small));
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(clip(text, LOOK.maxAnswer)));

    // A notice is the bot talking about itself — a rate limit, a wall of text, a
    // failure. It gets no heading and no buttons: there is nothing to rate.
    const row = feedbackRow({ kind, logId });
    if (row) container.addActionRowComponents(row);

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** `ai_fb:up:1a2b3c4d` -> { vote: "up", logId: "1a2b3c4d" }, or null. */
function parseFeedbackId(customId) {
    if (!customId || !customId.startsWith(FEEDBACK_PREFIX + ":")) return null;
    const [, vote, logId] = customId.split(":");
    if ((vote !== "up" && vote !== "down") || !logId) return null;
    return { vote, logId };
}

module.exports = {
    buildAnswer,
    parseFeedbackId,
    ticketUrl,
    LOOK,
    FEEDBACK_PREFIX,
};
