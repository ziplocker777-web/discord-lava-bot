require("dotenv").config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send the purchase panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelvisuals")
    .setDescription("Send the Ziplocker Summer Visuals purchase panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelblood")
    .setDescription("Send the Ziplocker's Blood FX purchase panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelvisuals1")
    .setDescription("Send the Ziplocker Graphics Pack purchase panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelgraphicspackv2")
    .setDescription("Send the Ziplocker's Graphics Pack V2 purchase panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelgraphicsv2")
    .setDescription("Send the Ziplocker's Graphics V2 purchase panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelbasic")
    .setDescription("Send the Basic tier panel ($5.99/mo)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelmembership")
    .setDescription("Send the Membership tier panel ($9.99/mo)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelpremium")
    .setDescription("Send the Premium tier panel ($14.99/mo)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelaudio")
    .setDescription("Send the Complete Audio Overhaul purchase panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask a question about the mods, installation, or your subscription")
    .addStringOption(option =>
      option
        .setName("question")
        .setDescription("What do you want to know?")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("getrole")
    .setDescription("Send the role verification panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelredownload")
    .setDescription("Send the updated-download / license-key migration panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)    .toJSON(),
  new SlashCommandBuilder()
    .setName("cancelsubscription")
    .setDescription("Cancel a member's lava.top subscription and revoke the Membership role")
    .addStringOption(option =>
      option
        .setName("email")
        .setDescription("Email used at checkout")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("paneldirectory")
    .setDescription("Post the mod directory")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Every admin tool, as buttons")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("unrefund")
    .setDescription("Undo a refund: unblock the email and bring their key back")
    .addStringOption((option) =>
      option
        .setName("email")
        .setDescription("Email used at checkout")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("vouchpanel")
    .setDescription("Post the rating panel in the vouch channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("vouch")
    .setDescription("Who would be asked to rate what they bought, and what has come back")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("winback")
    .setDescription("Who would be asked why they did not finish, and what they would be sent")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("adoptpanels")
    .setDescription("Attach customer ratings to the product panels already in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("abandoned")
    .setDescription("Checkouts started and never finished — with who to ask")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("members")
    .setDescription("Who joined, how many stayed, and how many of them bought")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Who spends the most, and how many come back")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("pending")
    .setDescription("Buyers who paid over a day ago and never activated their key")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Put back a role that a running subscription should have")
    .addStringOption((option) =>
      option
        .setName("email")
        .setDescription("Email used at checkout")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("health")
    .setDescription("Is everything running: bot, lava.top, the nightly sweep, keys")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("grantrole")
    .setDescription("Give somebody a role by hand — for a purchase the bot never saw")
    .addUserOption((option) =>
      option.setName("user").setDescription("Who").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("role")
        .setDescription("Which role")
        .setRequired(true)
        .addChoices(
          { name: "Customer", value: "ROLE_ID" },
          { name: "Collector", value: "COLLECTOR_ROLE_ID" },
          { name: "Basic", value: "BASIC_ROLE_ID" },
          { name: "Membership", value: "SUBSCRIBE_ROLE_ID" },
          { name: "Premium", value: "PREMIUM_ROLE_ID" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("email")
        .setDescription("Optional — records it so the nightly sweep never takes it back")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("refund")
    .setDescription("Undo a sale: role off, key revoked, blocked from claiming it again")
    .addStringOption((option) =>
      option
        .setName("email")
        .setDescription("Email used at checkout")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("product")
        .setDescription("Only needed when they own more than one thing")
        .addChoices(
          ...Object.keys(require("./products")).map((name) => ({
            name: name.slice(0, 100),
            value: name,
          }))
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("deliver")
    .setDescription("Give somebody a product they did not buy — records it, grants the role, sends the key")
    .addStringOption((option) =>
      option.setName("user").setDescription("Discord id").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("email").setDescription("Any email — the record is filed under it").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("product")
        .setDescription("What to give them")
        .setRequired(true)
        .addChoices(
          ...Object.keys(require("./products")).map((name) => ({
            name: name.slice(0, 100),
            value: name,
          }))
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("resend")
    .setDescription("Send a customer their download link and key again")
    .addStringOption((option) =>
      option
        .setName("who")
        .setDescription("Email, Discord id, or licence key")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Sales for the last day and week, and how many subscriptions are running")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("customer")
    .setDescription("Everything known about one customer: purchases, key, activations, roles")
    .addStringOption((option) =>
      option
        .setName("who")
        .setDescription("Email, Discord id, or licence key")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("revokekey")
    .setDescription("Kill a licence key — their app drops back to the key screen")
    .addStringOption((option) =>
      option
        .setName("who")
        .setDescription("Licence key, email, or Discord id")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("restorekey")
    .setDescription("Bring a revoked licence key back")
    .addStringOption((option) =>
      option
        .setName("who")
        .setDescription("Licence key, email, or Discord id")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("lapsed")
    .setDescription("Subscriptions running, and which cancelled ones are still paid up")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("aiusage")
    .setDescription("How many tokens the AI assistant has spent, and how many are left")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Slash commands registered.");
  } catch (error) {
    console.error(error);
  }
})();
