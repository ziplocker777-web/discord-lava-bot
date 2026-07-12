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
const PRODUCT_ID_VISUALS = "70c48693-8412-4b5e-871a-9878fe6bfda5"; // Ziplocker Summer Visuals offerId
const PRODUCT_ID_BLOOD = "aa6de8cb-810e-4b81-848c-bc38325ecadc"; // Ziplocker's Blood FX offerId

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
            .setDescription(
`# 💥 Muzzle Core FX

### Modernize every firefight in GTA V with a complete weapon particle overhaul.

Muzzle Core FX replaces outdated weapon effects with cinematic muzzle flashes, realistic gun smoke, enhanced impact effects, shell casings and tracers. Built directly on GTA V's particle system, it delivers a clean, seamless upgrade without modifying weapon stats or relying on outdated \`weapons.meta\` replacements.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 **Features:**

• **Engine-Level Particle Overhaul**
Built directly into GTA V's particle system for maximum compatibility. No \`weapons.meta\` edits, no weapon stat conflicts.

• **Full Weapon Compatibility**
Works seamlessly with vanilla, DLC and supported custom add-on weapons.

• **Story Mode & FiveM**
Includes separate, fully optimized versions for both Singleplayer and FiveM.

• **Tracer & Non-Tracer Options**
Choose between realistic bullet tracers or a clean, tracer-free experience.

• **Cinematic Muzzle Flashes**
Custom flash cores built from real firearm references for a modern, realistic appearance.

• **Volumetric Gun Smoke**
Dense smoke that lingers naturally and reacts to muzzle flashes and lighting.

• **Enhanced Bullet Impacts & Shell Casings**
Reworked impact particles, debris effects and realistic shell casing ejection.

• **Visual Mod Compatible**
Fully compatible with NVE, QuantV and most visual overhauls.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $9.99`
            )
            .setImage("https://cdn.discordapp.com/attachments/1521243996482175147/1521244405049331712/Frame_42.png?ex=6a4cb281&is=6a4b6101&hm=fd414f16a1fc8047cdf19e2583f41adc6740cbc74dd50a8b9cf6d04cc45a615f&")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

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

    // ================= PANEL: ZIPLOCKER SUMMER VISUALS =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelvisuals") {
        const embed = new EmbedBuilder()
            .setColor("#3DDC84")
            .setDescription(
`# 🌴 Ziplocker Summer Visuals

### A complete visual overhaul for GTA V & FiveM.

Bring GTA V a clean, vibrant summer look with a carefully tuned QuantV setup and a custom cinematic ReShade preset. Designed for players who want better visuals without spending hours tweaking dozens of settings.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 **Features:**

• **Carefully Configured QuantV**
Clean and realistic summer atmosphere out of the box.

• **Custom ReShade Preset**
Balanced colors, lighting and contrast.

• **Bright, Vibrant Daytime Visuals**
While preserving realistic nighttime lighting.

• **Performance-Friendly**
Easy installation process, no heavy performance hit.

• **Fully Customizable**
Tune the look to your taste.

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ **One-Key Visual Controls**

Instantly adjust your graphics without opening the ReShade menu. Built-in hotkeys let you enable, disable or tweak:

• Bloom
• Lens Effects
• Tint
• Overlay
• Borders
• Night Mode
• Depth of Field (DOF)
• Saturation

Switch between different looks in seconds depending on the weather, time of day or the cinematic style you want.

━━━━━━━━━━━━━━━━━━━━━━━━━━

💥 **Complete Experience**
Pair it with Muzzle Core FX to upgrade both your graphics and weapon effects.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $6.99`
            )
            .setImage("https://cdn.discordapp.com/attachments/1521243996482175147/1521574982512152687/Frame412_1.png?ex=6a4de661&is=6a4c94e1&hm=5c3a94df86f37a952ed951e1b04040cc4d25f3e73017050fee856dac32568c9f&")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_VISUALS}`)
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

    // ================= PANEL: ZIPLOCKER'S BLOOD FX =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelblood") {
        const embed = new EmbedBuilder()
            .setColor("#3DDC84")
            .setDescription(
`# 🩸 Ziplocker's Blood FX

### Transform every firefight in GTA V with a complete overhaul of the game's blood and gore effects.

Featuring 18 brand-new blood pool textures and 19 all-new blood splatter textures, each meticulously crafted in high resolution and enhanced with detailed normal and specular maps for a richer sense of depth, surface detail, and realistic wetness. Combined with Muzzle Core FX, this mod creates a uniquely cinematic and immersive combat experience.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 **Features:**

• **Reworked Blood Shading & Reflections**
All blood pools, splatters, and soak textures have been redesigned to react naturally to light, delivering a convincing wet, fluid appearance far beyond the vanilla game.

• **Completely New Impact Effects**
Default body-hit particles have been replaced with custom PTFX effects, producing larger, more dramatic blood sprays and more satisfying shot impacts.

• **Weapon-Specific Wounds**
Wound decals and blood soak patterns dynamically vary according to the weapon and ammunition used, giving every caliber its own distinct visual signature.

• **High-Resolution Assets Throughout**
Every texture has been recreated in high definition to ensure exceptional clarity and detail at any distance.

• **Expanded Visual Variety**
A broad library of blood pools, splatters, wounds, and soak textures minimizes repetition and keeps every encounter looking unique.

• **Additional Immersion Enhancements**
Numerous environmental and damage-related textures and effects have also been refined to complement the new gore system and create a cohesive, cinematic atmosphere throughout GTA V.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $8.99`
            )
            .setImage("https://cdn.discordapp.com/attachments/1521243996482175147/1525163948477775992/Frame_671.png?ex=6a55061d&is=6a53b49d&hm=068378d1f2ed688a402dcda139fdad28e58ce8912a31dfb272af6e8037f26d6a&")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_BLOOD}`)
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