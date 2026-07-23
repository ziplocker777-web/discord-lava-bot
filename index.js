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

const { startWebhookServer, revokeRole } = require("./webhookServer.js");
const { getPurchase, recordPurchase } = require("./purchaseStore.js");
const { createInvoice, cancelSubscription } = require("./lavaClient.js");
const { getRolesForProduct } = require("./roles.js");

const PRODUCT_ID = "04c91dde-254e-45ce-becb-5ab22a86cfca"; // Muzzle Core FX offerId
const PRODUCT_ID_VISUALS = "70c48693-8412-4b5e-871a-9878fe6bfda5"; // Ziplocker Summer Visuals offerId
const PRODUCT_ID_BLOOD = "aa6de8cb-810e-4b81-848c-bc38325ecadc"; // Ziplocker's Blood FX offerId
const PRODUCT_ID_GRAPHICSPACK = "90159b55-e860-4860-803d-c9f49d73fff4"; // Ziplocker Graphics Pack offerId
const PRODUCT_ID_GRAPHICSPACK_V2 = "98960219-f5e3-4330-a7c1-b86cf318c8db"; // Ziplocker's Graphics Pack V2 offerId
const PRODUCT_ID_GRAPHICS_V2 = "f4eadbcb-0353-4cb8-a759-e6d471c35c36"; // Ziplocker's Graphics V2 offerId
const PRODUCT_ID_SUBSCRIBE = "fd9076bc-1285-4fa5-a55d-86657ad32ab5"; // Membership (Subscription ziplocker) offerId

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

# 💰 Price: $14.99`
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

    // ================= PANEL: ZIPLOCKER GRAPHICS PACK =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelvisuals1") {
        const embed = new EmbedBuilder()
            .setColor("#3DDC84")
            .setDescription(
`# 💫 Ziplocker Graphics Pack

### The complete FiveM enhancement pack.

Transform your game with improved visuals, immersive weapon effects, realistic sounds, enhanced blood physics, and upgraded environmental textures. Everything is carefully put together to create a more cinematic and immersive experience while remaining easy to install.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 **Includes:**

• **Blood Overhaul (Ziplockers Blood FX) & Ragdoll**
Completely reworked blood effects with improved decals, particles, and more satisfying ragdoll reactions.

• **Muzzle Flashes & Bullet Impacts (Muzzle Core FX)**
High-quality muzzle flashes, tracers, shell effects, smoke, sparks, and realistic bullet impacts for every weapon, including DLC weapons.

• **Gun Sound Overhaul**
More powerful and immersive weapon sounds that make every shot feel impactful.

• **Replaced Road & Vegetation Textures**
Higher-quality road and vegetation textures for a cleaner and more detailed world.

• **Custom Visual Overhaul (QuantV)**
Carefully configured QuantV visuals with vibrant colors, improved lighting, and a balanced cinematic look.

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ **Designed for an Immersive Experience**

Every component has been selected to work together seamlessly, giving GTA V a fresh, modern look while improving combat, atmosphere, and overall immersion.

• Better graphics
• More realistic weapon effects
• Improved blood & ragdoll physics
• Enhanced weapon audio
• Higher-quality environmental textures

━━━━━━━━━━━━━━━━━━━━━━━━━━

💥 **Easy Installation**
The pack includes everything you need, along with installation instructions to get up and running in just a few minutes.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $29.99`
            )
            .setImage("https://cdn.discordapp.com/attachments/1521243996482175147/1526690275051831367/Frame_1.png?ex=6a57f09e&is=6a569f1e&hm=3b80d25bace53a137c3122c7fe1eea0417f388fea1c6ccbe254c4349e513446c&")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_GRAPHICSPACK}`)
                .setStyle(ButtonStyle.Success)
                .setLabel("Buy Now")
                .setEmoji("💳"),
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Watch Preview")
                .setEmoji("▶️")
                .setURL("https://www.youtube.com/watch?v=HHMTXwCt5wY")
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });

        return interaction.reply({
            content: "✅ Panel created.",
            ephemeral: true,
        });
    }

    // ================= PANEL: ZIPLOCKER'S GRAPHICS PACK V2 =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelgraphicspackv2") {
        const embed = new EmbedBuilder()
            .setColor("#000000")
            .setDescription(
`# 🌟 Ziplocker's Graphics Pack V2

### The ultimate all-in-one enhancement package for FiveM.

Upgrade your entire GTA V experience with a complete collection of visual improvements, immersive combat effects, realistic audio, and environmental upgrades. Every component has been carefully selected and optimized to work together, creating a polished cinematic experience.

━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ **What's Included**

• **CoreFX Visual Overhaul**
A custom-built CoreFX configuration with improved lighting, enhanced reflections, realistic weather, vibrant colors, and cinematic post-processing.

• **Two CoreFX Versions**
Choose the version that fits your hardware:
- **Quality Edition** – includes volumetric clouds for the highest visual quality and the most immersive atmosphere.
- **Performance Edition** – removes volumetric clouds to improve FPS while keeping the same visual style.

• **Blood FX & Ragdoll**
Improved blood effects, enhanced decals, particles, and more realistic ragdoll reactions during combat.

• **Muzzle Core FX**
High-quality muzzle flashes, smoke, sparks, shell effects, bullet impacts, and optional tracers for a more realistic combat experience.

• **3 Different Gun Sound Packs**
Includes three unique weapon sound packs, allowing you to choose the style that fits your gameplay experience.

• **HD Environment Textures**
A complete texture overhaul replacing most of the game's environmental assets. Includes improved textures for Buildings, Rocks, Vegetation, Beach sand, Dirt, License plates, and various world elements such as Miscellaneous, Nature Props, Railways, Seaside, and Vehicles.

• **Two Road Texture Options**
Includes two different road variations:
- **LA Roads**
- **Vanilla Improved Roads**

━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 **Why Choose This Pack**

Everything you need to transform FiveM into a more immersive and cinematic experience.

• Premium graphics
• Realistic weapon effects
• Enhanced combat visuals
• Multiple weapon sound options
• Improved environmental textures
• Customizable visual and performance options

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️ **Easy Installation**
The pack includes everything required, together with simple installation instructions to get you started within minutes.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $33.99`
            )
            .setImage("https://cdn.discordapp.com/attachments/1521243996482175147/1529294199764291614/Frame_6.png?ex=6a6169b6&is=6a601836&hm=2735760ba33560ccdfa4d191723b37d2b83aed2a3648e6eaf75be3bd9ac3a483&")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_GRAPHICSPACK_V2}`)
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

    // ================= PANEL: ZIPLOCKER'S GRAPHICS V2 =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelgraphicsv2") {
        const embed = new EmbedBuilder()
            .setColor("#FFFFFF")
            .setDescription(
`# 🌠 Ziplocker's Graphics V2

### A premium visual overhaul created for players who want a cleaner and more immersive FiveM experience.

Graphics V2 focuses entirely on improving the game's visuals through a carefully configured CoreFX setup, bringing better lighting, realistic weather, richer colors, and a cinematic atmosphere without changing gameplay.

━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ **Features**

• **CoreFX Visual Overhaul**
A custom CoreFX configuration featuring improved lighting, enhanced reflections, realistic weather, vibrant colors, and cinematic post-processing.

• **Two CoreFX Versions**
Choose the version that matches your PC:
- **Quality Edition** – includes volumetric clouds for maximum visual quality and a more immersive atmosphere.
- **Performance Edition** – disables volumetric clouds for better FPS while maintaining the same visual style.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 **Designed for Visual Quality**

Graphics V2 is made for players who only want to improve the look of their game.

• Cinematic visuals
• Better lighting
• Enhanced weather
• Richer colors
• Improved atmosphere
• Optimized performance
• Two visual options for different hardware

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️ **Easy Installation**
Includes everything needed, along with a simple installation guide to get started quickly.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $9.99`
            )
            .setImage("https://cdn.discordapp.com/attachments/1521243996482175147/1529294193187360848/Frame_7.png?ex=6a6169b4&is=6a601834&hm=4a7e2ccd75b7fc705eac2dd85bc6570cb9784bde2eb1430f16dc636d5e265266&")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_GRAPHICS_V2}`)
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

    // ================= PANEL: MEMBERSHIP (SUBSCRIPTION) =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelsubscribe") {
        const embed = new EmbedBuilder()
            .setColor("#95ff00")
            .setDescription(
`# 💎 Membership

### Unlimited access to the complete graphics library.

One membership. Every visual upgrade.

━━━━━━━━━━━━━━━━━━━━━━━━━━

**Included:**

🎨 All Graphics Packs

🔥 Muzzle Core FX

🩸 Blood Mod

🖼️ Future Graphics Packs

🔄 Future Updates

📦 Beta Builds

💡 Suggest Features & Vote on Future Updates

👀 Exclusive Sneak Peeks

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $14.99 / month`
            )
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_SUBSCRIBE}`)
                .setStyle(ButtonStyle.Success)
                .setLabel("Subscribe")
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

    // ================= CANCEL SUBSCRIPTION (admin only) =================
    if (interaction.isChatInputCommand() && interaction.commandName === "cancelsubscription") {
        await interaction.deferReply({ ephemeral: true });

        const email = interaction.options.getString("email").trim().toLowerCase();

        const purchase = getPurchase(email);

        if (!purchase) {
            return interaction.editReply({
                content: `❌ No purchase found for \`${email}\`.`,
            });
        }

        if (!purchase.contractId) {
            return interaction.editReply({
                content: `⚠️ No contractId stored for \`${email}\` — can't cancel via API. Check purchaseStore.json.`,
            });
        }

        try {
            // 1. Отменяем подписку на стороне lava.top.
            // purchase.contractId, сохранённый с первого payment.success
            // вебхука, и есть parentContractId, которого хочет lava.top.
            await cancelSubscription({
                contractId: purchase.contractId,
                email: purchase.email,
            });

            // 2. Помечаем в локальном хранилище.
            recordPurchase(email, {
                ...purchase,
                status: "cancelled",
            });

            // 3. Снимаем роль Membership сразу, не дожидаясь вебхука.
            let roleNote = "";
            if (purchase.discordId) {
                try {
                    await revokeRole(client, purchase.discordId);
                } catch (err) {
                    console.error("Role revoke failed:", err.message);
                    roleNote = "\n⚠️ Subscription cancelled on lava.top, but Discord role removal failed — check bot permissions.";
                }
            } else {
                roleNote = "\n⚠️ No discordId stored for this purchase — role wasn't removed automatically.";
            }

            return interaction.editReply({
                content: `✅ Subscription for \`${email}\` cancelled on lava.top.${roleNote}`,
            });

        } catch (err) {
            console.error("cancelSubscription failed:", err.response?.data || err.message);
            return interaction.editReply({
                content: `⚠️ Couldn't cancel the subscription on lava.top: ${err.response?.data?.message || err.message}`,
            });
        }
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

        const purchase = getPurchase(email);

        if (!purchase) {
            return interaction.editReply({
                content: "❌ No purchase found for this email.",
            });
        }

        try {
            const member = interaction.member;
            const roleIds = getRolesForProduct(purchase.productId);

            if (roleIds.length === 0) {
                return interaction.editReply({
                    content: "⚠️ No roles are configured for this product. Contact an admin.",
                });
            }

            const granted = [];
            for (const roleId of roleIds) {
                if (!member.roles.cache.has(roleId)) {
                    await member.roles.add(roleId);
                    granted.push(roleId);
                }
            }

            if (granted.length === 0) {
                return interaction.editReply({
                    content: "✅ You already have the role(s).",
                });
            }

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