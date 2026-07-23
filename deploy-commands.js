require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

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
    .setName("panelsubscribe")
    .setDescription("Send the Membership subscription purchase panel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("getrole")
    .setDescription("Send the role verification panel")
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