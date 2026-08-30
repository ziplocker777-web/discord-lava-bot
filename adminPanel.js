/**
 * The admin tools as buttons.
 *
 * Twelve slash commands is more than anyone keeps in their head, and the ones
 * you need in a hurry are the ones you have forgotten the name of. One command
 * puts them all on screen; the panel is ephemeral, so it can be summoned in any
 * channel without anybody else seeing it or the answers.
 *
 * Anything that only reads runs on the click. Anything that needs a name, an
 * email or a key opens a small form -- Discord will not let a button carry typed
 * input, and a form is also a pause for thought in front of the destructive ones.
 */

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require("discord.js");

const { HANDLERS } = require("./adminCommands");

const PREFIX = "admin";

/**
 * What each button does.
 *
 * `fields` empty means it runs straight away. Otherwise those are the boxes the
 * form puts up, and their ids match what the handlers already read.
 */
const ACTIONS = {
    stats: { label: "Sales", emoji: "📊", style: ButtonStyle.Secondary, fields: [] },
    health: { label: "Health", emoji: "🩺", style: ButtonStyle.Secondary, fields: [] },
    pending: { label: "Never activated", emoji: "⏳", style: ButtonStyle.Secondary, fields: [] },
    lapsed: { label: "Subscriptions", emoji: "📉", style: ButtonStyle.Secondary, fields: [] },

    abandoned: { label: "Lost sales", emoji: "🛒", style: ButtonStyle.Secondary, fields: [] },
    top: { label: "Best buyers", emoji: "🏆", style: ButtonStyle.Secondary, fields: [] },
    members: { label: "Members", emoji: "👥", style: ButtonStyle.Secondary, fields: [] },
    winback: { label: "Ask why", emoji: "💬", style: ButtonStyle.Secondary, fields: [] },
    vouch: { label: "Reviews", emoji: "⭐", style: ButtonStyle.Secondary, fields: [] },
    vouchpanel: { label: "Post rating panel", emoji: "📌", style: ButtonStyle.Primary, fields: [] },

    customer: {
        label: "Look up", emoji: "🔍", style: ButtonStyle.Primary,
        title: "Look up a buyer",
        fields: [{ id: "who", label: "Email, Discord id, or licence key", required: true }],
    },
    resend: {
        label: "Resend", emoji: "🔁", style: ButtonStyle.Primary,
        title: "Send their download again",
        fields: [{ id: "who", label: "Email, Discord id, or licence key", required: true }],
    },
    sync: {
        label: "Restore role", emoji: "🔄", style: ButtonStyle.Primary,
        title: "Restore a subscriber's role",
        fields: [{ id: "email", label: "Email used at checkout", required: true }],
    },
    grantrole: {
        label: "Give role", emoji: "➕", style: ButtonStyle.Primary,
        title: "Give somebody a role by hand",
        fields: [
            { id: "user", label: "Discord id", required: true },
            { id: "role", label: "buyer / Basic / Membership / Premium", required: true },
            { id: "email", label: "Email (optional, so it is on record)", required: false },
        ],
    },

    deliver: {
        label: "Give access", emoji: "🎁", style: ButtonStyle.Primary,
        title: "Give somebody a product",
        fields: [
            { id: "user", label: "Discord id", required: true },
            { id: "email", label: "Any email — the record is filed under it", required: true },
            { id: "product", label: "Product name", required: true },
        ],
    },

    revokekey: {
        label: "Kill key", emoji: "🔒", style: ButtonStyle.Danger,
        title: "Revoke a licence key",
        fields: [{ id: "who", label: "Licence key, email, or Discord id", required: true }],
    },
    restorekey: {
        label: "Revive key", emoji: "🔓", style: ButtonStyle.Success,
        title: "Bring a licence key back",
        fields: [{ id: "who", label: "Licence key, email, or Discord id", required: true }],
    },
    refund: {
        label: "Refund", emoji: "💸", style: ButtonStyle.Danger,
        title: "Undo a sale",
        fields: [
            { id: "email", label: "Email used at checkout", required: true },
            { id: "product", label: "Product (only if they own several)", required: false },
        ],
    },
    unrefund: {
        label: "Undo refund", emoji: "↩️", style: ButtonStyle.Success,
        title: "Undo a refund",
        fields: [{ id: "email", label: "Email used at checkout", required: true }],
    },
};

// Grouped by what they do to the shop, not alphabetically: looking, helping one
// person, and the ones that take something away. The dangerous row sits last and
// on its own, where a misclick is least likely.
const LAYOUT = [
    ["stats", "members", "top", "abandoned", "pending"],
    // The rating panel sits with the reviews it belongs to, not with the things
    // done to one person. It is a repair button: the panel places itself after
    // every review, so this is only for putting one back.
    ["health", "lapsed", "winback", "vouch", "vouchpanel"],
    ["customer", "resend", "deliver", "grantrole", "sync"],
    ["revokekey", "restorekey", "refund", "unrefund"],
];

function buildPanel() {
    const rows = LAYOUT.map((names) =>
        new ActionRowBuilder().addComponents(
            names.map((name) => {
                const a = ACTIONS[name];
                return new ButtonBuilder()
                    .setCustomId(`${PREFIX}:btn:${name}`)
                    .setLabel(a.label)
                    .setEmoji(a.emoji)
                    .setStyle(a.style);
            })
        )
    );

    // No flags here: the caller has already replied ephemerally and editReply
    // does not accept them.
    return {
        content:
            "**Admin panel**\n" +
            "Grey buttons answer straight away. The rest ask for a name first.\n" +
            "_Only you can see this._",
        components: rows,
    };
}

function buildModal(name) {
    const a = ACTIONS[name];
    const modal = new ModalBuilder()
        .setCustomId(`${PREFIX}:modal:${name}`)
        .setTitle(a.title.slice(0, 45));

    modal.addComponents(
        a.fields.map((f) =>
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(f.id)
                    .setLabel(f.label.slice(0, 45))
                    .setStyle(TextInputStyle.Short)
                    .setRequired(f.required)
            )
        )
    );

    return modal;
}

/**
 * @returns {Promise<boolean>} whether this interaction belonged to the panel
 */
async function handlePanel(interaction, client) {
    const id = interaction.customId || "";
    if (!id.startsWith(`${PREFIX}:`)) return false;

    const [, kind, name] = id.split(":");
    const action = ACTIONS[name];
    if (!action) return false;

    // A modal has to be the first reply to the click, so this one cannot defer.
    if (kind === "btn" && action.fields.length > 0) {
        await interaction.showModal(buildModal(name));
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        await HANDLERS[name](interaction, client);
    } catch (err) {
        console.error(`[panel] ${name} failed:`, err);
        await interaction.editReply(`Something broke: ${err.message}`);
    }
    return true;
}

module.exports = { buildPanel, handlePanel };
