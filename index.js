require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

const { startWebhookServer } = require("./webhookServer.js");
const { hasPurchase } = require("./purchaseStore.js");
const { createInvoice } = require("./lavaClient.js");

const PRODUCT_ID = "04c91dde-254e-45ce-becb-5ab22a86cfca"; // Muzzle Core FX offerId

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, () => {
    console.log(`${client.user.tag} is online.`);
    startWebhookServer(client); // клиенту нужен доступ к guild/member для выдачи роли
});

client.on(Events.InteractionCreate, async (interaction) => {

    // ================= PANEL =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
        const embed = new EmbedBuilder()
            .setColor("#3DDC84")
            .setTitle("Muzzle Core FX💥")
            .setDescription(
`Engine-Level Weapon VFX for GTA V & FiveM

✓ Compatible with all vanilla & add-on weapons
✓ No weapons.meta edits
✓ Engine-level framework
✓ Realistic muzzle flashes
✓ Physics-based smoke
✓ Shell casings & impacts
✓ FiveM & Singleplayer`
            )
            .setImage("https://cdn.discordapp.com/attachments/1521243996482175147/1521244405049331712/Frame_42.png")
            .setFooter({ text: "Official Ziplocker Store" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID}`)
                .setStyle(ButtonStyle.Success)
                .setLabel("Buy Now")
                .setEmoji("💳")
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });

        return interaction.reply({
            content: "✅ Panel created.",
            ephemeral: true,
        });
    }

    // ================= GET ROLE PANEL (manual fallback) =================
    if (interaction.isChatInputCommand() && interaction.commandName === "getrole") {
        const embed = new EmbedBuilder()
            .setColor("#3DDC84")
            .setTitle("Get Role")
            .setDescription(
`Already purchased but didn't get the role automatically?

Click the button below and enter the email you used at checkout.`
            )
            .setFooter({ text: "Official Ziplocker Store" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("get_role")
                .setStyle(ButtonStyle.Secondary)
                .setLabel("Get Role")
                .setEmoji("✅")
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });

        return interaction.reply({
            content: "✅ Panel created.",
            ephemeral: true,
        });
    }

    // ================= BUY BUTTON: choose payment method =================
    if (interaction.isButton() && interaction.customId.startsWith("buy_")) {
        const productId = interaction.customId.replace("buy_", "");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`paymethod_card_${productId}`)
                .setStyle(ButtonStyle.Success)
                .setLabel("Card")
                .setEmoji("💳"),
            new ButtonBuilder()
                .setCustomId(`paymethod_paypal_${productId}`)
                .setStyle(ButtonStyle.Primary)
                .setLabel("PayPal")
                .setEmoji("🅿️")
        );

        return interaction.reply({
            content: "Choose a payment method:",
            components: [row],
            ephemeral: true,
        });
    }

    // ================= PAYMENT METHOD CHOSEN: show email modal =================
    if (interaction.isButton() && interaction.customId.startsWith("paymethod_")) {
        const rest = interaction.customId.replace("paymethod_", ""); // "card_<offerId>" or "paypal_<offerId>"
        const separatorIndex = rest.indexOf("_");
        const method = rest.slice(0, separatorIndex);       // "card" | "paypal"
        const productId = rest.slice(separatorIndex + 1);   // offerId

        const modal = new ModalBuilder()
            .setCustomId(`buy_modal_${method}_${productId}`)
            .setTitle("Purchase");

        const emailInput = new TextInputBuilder()
            .setCustomId("email")
            .setLabel("Email for the receipt and purchase")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("example@mail.com")
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(emailInput)
        );

        return interaction.showModal(modal);
    }

    // ================= BUY MODAL SUBMIT =================
    if (interaction.isModalSubmit() && interaction.customId.startsWith("buy_modal_")) {
        await interaction.deferReply({ ephemeral: true });

        const rest = interaction.customId.replace("buy_modal_", ""); // "card_<offerId>" or "paypal_<offerId>"
        const separatorIndex = rest.indexOf("_");
        const method = rest.slice(0, separatorIndex);       // "card" | "paypal"
        const productId = rest.slice(separatorIndex + 1);   // offerId

        const paymentProvider = method === "paypal" ? "PAYPAL" : undefined; // "card" -> default (UNLIMINT)

        const email = interaction.fields.getTextInputValue("email").trim().toLowerCase();

        try {
            const invoice = await createInvoice({
                email,
                offerId: productId,
                discordId: interaction.user.id,
                paymentProvider,
            });

            if (!invoice?.paymentUrl) {
                console.error("createInvoice returned no paymentUrl:", invoice);
                return interaction.editReply({
                    content: "⚠️ Couldn't create the invoice. Please try again in a moment.",
                });
            }

            const payEmbed = new EmbedBuilder()
                .setColor("#3DDC84")
                .setDescription(`[💳 Click here to pay](${invoice.paymentUrl})`);

            return interaction.editReply({
                content: "Invoice created. Your role will be granted automatically after payment.",
                embeds: [payEmbed],
            });

        } catch (err) {
            console.error("createInvoice failed:", err.response?.data || err.message);
            return interaction.editReply({
                content: "⚠️ Couldn't create the invoice. Please try again in a moment.",
            });
        }
    }

    // ================= GET ROLE BUTTON (ручной фоллбек) =================
    if (interaction.isButton() && interaction.customId === "get_role") {
        const modal = new ModalBuilder()
            .setCustomId("verify_modal")
            .setTitle("Verify Purchase");

        const emailInput = new TextInputBuilder()
            .setCustomId("email")
            .setLabel("Email used at checkout")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("example@mail.com")
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(emailInput)
        );

        return interaction.showModal(modal);
    }

    // ================= VERIFY (ручной фоллбек) =================
    if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
        await interaction.deferReply({ ephemeral: true });

        const email = interaction.fields.getTextInputValue("email").trim().toLowerCase();

        const isPurchased = hasPurchase(email);

        if (!isPurchased) {
            return interaction.editReply({
                content: "❌ No purchase found for this email.",
            });
        }

        try {
            const roleId = process.env.ROLE_ID;
            const member = interaction.member;

            if (member.roles.cache.has(roleId)) {
                return interaction.editReply({
                    content: "✅ You already have the role.",
                });
            }

            await member.roles.add(roleId);

            return interaction.editReply({
                content: "✅ Verified! Role has been granted.",
            });

        } catch (err) {
            console.error(err);
            return interaction.editReply({
                content: "⚠️ Role assignment failed. Check bot permissions.",
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
