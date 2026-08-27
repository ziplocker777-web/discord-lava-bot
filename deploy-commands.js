require("dotenv").config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send the purchase panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelvisuals")
    .setDescription("Send the Ziplocker Summer Visuals purchase panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelblood")
    .setDescription("Send the Ziplocker's Blood FX purchase panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelvisuals1")
    .setDescription("Send the Ziplocker Graphics Pack purchase panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelgraphicspackv2")
    .setDescription("Send the Ziplocker's Graphics Pack V2 purchase panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelgraphicsv2")
    .setDescription("Send the Ziplocker's Graphics V2 purchase panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelbasic")
    .setDescription("Send the Basic tier panel ($5.99/mo)")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelmembership")
    .setDescription("Send the Membership tier panel ($9.99/mo)")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelpremium")
    .setDescription("Send the Premium tier panel ($14.99/mo)")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelaudio")
    .setDescription("Send the Complete Audio Overhaul purchase panel")
    .toJSON(),
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
    .toJSON(),
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
