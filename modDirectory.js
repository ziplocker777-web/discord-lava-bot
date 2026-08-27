require("./env.js").loadEnv();

const { EmbedBuilder } = require("discord.js");

/**
 * The mod directory: one line per product, each linking to the post that sells
 * or hosts it.
 *
 * Posted by the bot rather than pasted by hand for one reason: `[name](url)`
 * renders as a proper link in an embed, and as literal text in a message someone
 * types. Fourteen raw Discord URLs in a channel is not a directory, it is a wall.
 *
 * Everything editable lives in SECTIONS below. Links are built from ids at run
 * time, so the guild id is never written down twice.
 */

// Channel ids the posts live in. Named so an entry below reads as a sentence.
const CH = {
    subscribe: "1529852453737205841",
    muzzle: "1510735965931573298",
    graphics: "1521573309530116227",
    blood: "1525264950749036706",
    sound: "1533766958762299572",
};

// White, matching the assistant. A directory is a reference, not an alert.
const COLOUR = "#FFFFFF";

const SECTIONS = [
    {
        title: "\u{1F4DA} Mod directory",
        intro: "Everything in the workshop, one line each. Click a name to open its post.",
        heading: "\u{1F4B3} Subscriptions",
        items: [
            {
                name: "\u{1F392} Basic",
                tag: "$5.99/mo",
                text: "Audio, blood and graphics — everything outside the Muzzle Core FX line.",
                ch: CH.subscribe, msg: "1541752975792414760",
            },
            {
                name: "\u{1F48E} Membership",
                tag: "$9.99/mo",
                text: "All of Basic, plus Muzzle Core FX and both Graphics Packs.",
                ch: CH.subscribe, msg: "1541752993656082464",
            },
            {
                name: "\u{1F451} Premium",
                tag: "$14.99/mo",
                text: "All of Membership, plus beta builds, early access and a say in what gets built next.",
                ch: CH.subscribe, msg: "1541753021656997919",
            },
        ],
    },
    {
        heading: "\u{1F52B} Weapons & combat",
        items: [
            {
                name: "\u{1F4A5} Muzzle Core FX + Flash Collection",
                tag: "paid",
                text: "Full weapon particle overhaul — flashes, smoke, sparks, impacts — with its own configurator app. Flash Collection adds four more flash styles.",
                ch: CH.muzzle, msg: "1535641351646089287",
            },
            {
                name: "✨ Tracer Tool",
                tag: "free, no key",
                text: "Edit the bullet tracer: colour, glow, size, speed, smoke trail. Builds for FiveM and Story Mode.",
                ch: CH.muzzle, msg: "1540807574151237644",
            },
            {
                name: "⚔️ Immersive Combat 1.9 + compatibility",
                tag: "free",
                text: "Combat overhaul, patched to run alongside Muzzle Core FX. **Needs Muzzle Core FX installed.**",
                ch: CH.muzzle, msg: "1541204213005156372",
            },
            {
                name: "\u{1FA78} Ziplocker's Blood FX",
                tag: "paid",
                text: "18 blood pool and 19 splatter textures in HD, weapon-specific wounds, new impact particles.",
                ch: CH.blood, msg: "1531750438435553483",
            },
        ],
    },
    {
        heading: "\u{1F307} Graphics",
        items: [
            {
                name: "\u{1F3AC} Graphics Pack V3",
                tag: "free",
                text: "The current free pack. Separate downloads for improved textures and roads.",
                ch: CH.graphics, msg: "1540113301307133972",
            },
            {
                name: "\u{1F31F} Graphics Pack V2",
                tag: "paid",
                text: "All-in-one: CoreFX visuals, blood and ragdoll, Muzzle Core FX. Quality or Performance edition.",
                ch: CH.graphics, msg: "1531750315135733761",
            },
            {
                name: "\u{1F320} Graphics V2",
                tag: "paid",
                // Named almost identically to the pack above and easy to buy by
                // mistake, so the difference is the whole description.
                text: "Visuals only — the same CoreFX setup, without the combat mods. Quality or Performance edition.",
                ch: CH.graphics, msg: "1529301370363056159",
            },
            {
                name: "\u{1F4AB} Graphics Pack V1",
                tag: "paid",
                text: "The original all-in-one: QuantV visuals, blood, muzzle effects, gun sounds, road and vegetation textures.",
                ch: CH.graphics, msg: "1526697193392705620",
            },
            {
                name: "\u{1F334} Summer Visuals",
                tag: "paid",
                text: "Bright summer look — tuned QuantV plus a custom ReShade preset. GTA V and FiveM.",
                ch: CH.graphics, msg: "1524047674943475763",
            },
        ],
    },
    {
        heading: "\u{1F50A} Audio",
        items: [
            {
                name: "\u{1F3A7} Complete Audio Overhaul",
                tag: "paid",
                text: "Weapon and environmental audio rebuilt, in three variants from balanced to loudest. Switch any time.",
                ch: CH.sound, msg: "1533767147627745301",
            },
            {
                name: "\u{1F3AF} Realism Guns Sound Pack",
                tag: "free",
                text: "Realistic weapon sounds, no purchase needed.",
                ch: CH.sound, msg: "1536204925560823878",
            },
        ],
    },
];

const FOOTER =
    "Prices and what each tier includes are in the FAQ. " +
    "Questions about any of these — just ask the assistant.";

function linkTo(item) {
    const guild = process.env.GUILD_ID;
    return `https://discord.com/channels/${guild}/${item.ch}/${item.msg}`;
}

/**
 * Returns the embeds to post. One per section, which is what gives the directory
 * its shape on screen -- a single embed would run as one unbroken column.
 */
function buildDirectoryEmbeds() {
    return SECTIONS.map((section, i) => {
        const lines = [];

        if (section.title) lines.push(`# ${section.title}`, "", section.intro, "");
        lines.push(`## ${section.heading}`, "");

        for (const item of section.items) {
            lines.push(`**[${item.name}](${linkTo(item)})** · ${item.tag}`);
            lines.push(`-# ${item.text}`);
            lines.push("");
        }

        const embed = new EmbedBuilder()
            .setColor(COLOUR)
            .setDescription(lines.join("\n").trim());

        // Only the last one carries the footer, so it reads as a closing line for
        // the whole directory rather than a repeated caption.
        if (i === SECTIONS.length - 1) embed.setFooter({ text: FOOTER });

        return embed;
    });
}

module.exports = { buildDirectoryEmbeds, SECTIONS };
