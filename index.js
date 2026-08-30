require("./env.js").loadEnv();

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
    AttachmentBuilder,
} = require("discord.js");

const path = require("path");

// The embroidered tier patches, shipped in the repo and attached to each panel.
// Resolved from __dirname so the panels keep working whatever directory pm2
// happens to start the bot from.
const tierBannerPath = (file) => path.join(__dirname, "assets", "tiers", file);

const { startWebhookServer, revokeRole, WATERMARKED_PRODUCT_IDS } = require("./webhookServer.js");
const { getAllPurchases, getPurchaseForProduct, recordPurchase } = require("./purchaseStore.js");
const { isRefunded } = require("./refundedEmails.js");
const { handleAdminCommand } = require("./adminCommands.js");
const { handlePanel } = require("./adminPanel.js");
const {
    registerAiSupport, handleQuestion, sendWithRetry, recordFeedback, usageSummary,
} = require("./aiSupport.js");
const {
    buildAnswerEmbed, buildAnswerComponents, parseFeedbackId,
} = require("./aiEmbed.js");
const { buildDirectoryEmbeds } = require("./modDirectory.js");
const { createInvoice, cancelSubscription, findCompletedSaleByEmail, fetchOfferPrices } = require("./lavaClient.js");
const {
    getRolesForPurchase,
    resolveTierWithLegacyFallback,
    tierDownloadsChannelId,
    applyLivePrices,
    SUBSCRIPTION_PRODUCT_ID,
} = require("./roles.js");
const { deliverPurchase, buildDeliveryMessage } = require("./delivery.js");

const PRODUCT_ID = "04c91dde-254e-45ce-becb-5ab22a86cfca"; // Muzzle Core FX offerId
const PRODUCT_ID_VISUALS = "70c48693-8412-4b5e-871a-9878fe6bfda5"; // Ziplocker Summer Visuals offerId
const PRODUCT_ID_BLOOD = "aa6de8cb-810e-4b81-848c-bc38325ecadc"; // Ziplocker's Blood FX offerId
const PRODUCT_ID_GRAPHICSPACK = "90159b55-e860-4860-803d-c9f49d73fff4"; // Ziplocker Graphics Pack offerId
const PRODUCT_ID_GRAPHICSPACK_V2 = "98960219-f5e3-4330-a7c1-b86cf318c8db"; // Ziplocker's Graphics Pack V2 offerId
const PRODUCT_ID_GRAPHICS_V2 = "f4eadbcb-0353-4cb8-a759-e6d471c35c36"; // Ziplocker's Graphics V2 offerId
const PRODUCT_ID_SUBSCRIBE = "fd9076bc-1285-4fa5-a55d-86657ad32ab5"; // Membership (Subscription ziplocker) offerId
const PRODUCT_ID_FLASHCOLLECTION = "c993d7c1-fe58-4ea6-9cdb-6b9f0128edc2"; // Muzzle Core FX | Flash Collection offerId (тот же продукт, что раньше был Variant III)
const PRODUCT_ID_AUDIO = "783191f9-2802-4cf7-93ea-1caf75b28403"; // Complete Audio Overhaul offerId
const PRODUCT_ID_BASIC = "82093c36-a7fd-42f6-9ede-6ac29adcbc34"; // Basic offerId — $5.99/mo
const PRODUCT_ID_PREMIUM = "d1fa96bf-b9c3-42db-ab5d-53749b4f0f07"; // Premium offerId — $14.99/mo

const client = new Client({
    // Discord is fronted by Cloudflare, and reaching it from here is not always
    // reliable: connect timeouts to 162.159.x.x were losing about four replies in
    // ten. discord.js gives up quickly by default, which turns a slow connection
    // into a message that silently never arrives.
    rest: {
        timeout: 30000,
        retries: 5,
    },
    intents: [
        GatewayIntentBits.Guilds,
        // Needed by the support assistant, which reads what people type in the
        // help channel. MessageContent is a privileged intent: it also has to be
        // switched on in the Discord Developer Portal, or the bot logs in fine
        // and then sees every message as empty.
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Shared by both the "Get Role" panel (role recovery) and the "Redownload" panel
// (fresh download + license key for buyers migrating to the license-key version) —
// same underlying purchase verification, just triggered from two different entry
// points with different framing for the customer. Acts on EVERY purchase on file for
// this email, not just one — a buyer who owns two different products under the same
// email gets both roles granted and both eligible downloads delivered in one pass.
async function verifyPurchaseAndDeliver(interaction, email) {
    if (isRefunded(email)) {
        console.warn(`verify: blocked ${email} — listed in refundedEmails.json`);
        return interaction.editReply({
            content: "❌ This purchase was refunded. If you believe this is a mistake, please open a ticket in #ticket.",
        });
    }

    let purchases = getAllPurchases(email);
    let usedFallback = false;

    if (purchases.length === 0) {
        // Локальной записи нет — возможно, оплата прошла напрямую на
        // сайте lava.top в обход бота, и webhook либо не пришёл, либо
        // не содержал discordId. Спрашиваем lava.top API напрямую —
        // фоллбек находит только ОДНУ продажу, не все покупки email'а.
        try {
            const sale = await findCompletedSaleByEmail(email);
            if (sale) {
                const purchase = {
                    productId: sale.productId,
                    productTitle: sale.productTitle,
                    contractId: sale.contractId,
                    discordId: interaction.user.id,
                    email,
                };
                recordPurchase(email, purchase);
                purchases = [purchase];
                usedFallback = true;
            }
        } catch (err) {
            console.error("findCompletedSaleByEmail failed inside verify:", err.message);
        }
    }

    if (purchases.length === 0) {
        return interaction.editReply({
            content: "❌ No purchase found for this email.\n\nIf you paid directly on the lava.top website (not through a button here in Discord), our system can't verify it automatically — please open a ticket in #ticket with your email and a payment screenshot, and we'll grant the role manually.",
        });
    }

    // Защита: если хотя бы одна покупка на этот email уже привязана к
    // другому Discord-аккаунту, не даём выдать роли текущему пользователю —
    // иначе один email сможет раздать роли всем, кто его узнает.
    const claimedBy = purchases.find((p) => p.discordId && p.discordId !== interaction.user.id);
    if (claimedBy) {
        console.warn(
            `verify: email ${email} already claimed by discordId ${claimedBy.discordId}, ` +
            `but was attempted by a different user (${interaction.user.id}) — blocked.`
        );
        return interaction.editReply({
            content: "❌ This email is already linked to a different Discord account. If this is a mistake, please contact an admin.",
        });
    }

    // Закрепляем email за текущим пользователем на всех покупках, где
    // discordId ещё не привязан (например, webhook пришёл без clientUtm).
    purchases = purchases.map((p) => {
        if (p.discordId) return p;
        const bound = { ...p, discordId: interaction.user.id };
        recordPurchase(email, bound);
        return bound;
    });

    try {
        // interaction.member isn't reliably registered in the client's guild-member
        // cache, and User#send() checks that cache to decide whether a "mutual guild"
        // exists before attempting a DM — without this fetch, delivery can fail with
        // "no mutual guilds" even though the member is right here, roles and all.
        const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
        const grantedRoles = new Set();
        const deliveredTitles = [];
        const inlineDeliveries = [];
        const failedTitles = [];
        let anyRolesConfigured = false;

        for (const purchase of purchases) {
            const roleIds = getRolesForPurchase(purchase);
            if (roleIds.length > 0) anyRolesConfigured = true;

            for (const roleId of roleIds) {
                if (!member.roles.cache.has(roleId)) {
                    await member.roles.add(roleId);
                    grantedRoles.add(roleId);
                }
            }

            // Muzzle Core FX / Flash Collection / Graphics Pack / подписка получают
            // свежую вотермарк-ссылку + ключ при каждом прогоне — не только когда
            // роль отсутствовала. Это и есть способ, которым уже верифицированные
            // покупатели сами переходят на новую версию или восстанавливают ключ.
            // Same tier gate as the webhook: the subscription product covers three
            // tiers and only the ones that include Muzzle Core FX may be re-issued the
            // configurator here. Without this, a Basic member could pull the
            // app they didn't pay for just by running /getrole.
            const tier = resolveTierWithLegacyFallback(purchase);
            const mayDeliverConfigurator =
                WATERMARKED_PRODUCT_IDS.has(purchase.productId) &&
                (purchase.productId !== SUBSCRIPTION_PRODUCT_ID || Boolean(tier?.includesConfigurator));

            if (mayDeliverConfigurator) {
                try {
                    const { downloadUrl, licenseKey } = deliverPurchase({
                        email,
                        discordId: interaction.user.id,
                        productId: purchase.productId,
                        productTitle: purchase.productTitle,
                    });

                    try {
                        await interaction.user.send(buildDeliveryMessage({
                            productId: purchase.productId,
                            productTitle: purchase.productTitle,
                            downloadUrl,
                            licenseKey,
                            tierLabel: tier?.label,
                            downloadsChannelId: tierDownloadsChannelId(tier),
                            greeting: "Here's a fresh copy of your download!",
                        }));
                        deliveredTitles.push(purchase.productTitle || purchase.productId);
                    } catch (dmErr) {
                        // The token/key are already generated even though the DM
                        // failed (commonly: buyer has DMs from server members off) —
                        // fall back to showing them right here, in the ephemeral
                        // reply only they can see, instead of stranding the buyer.
                        console.error("DM delivery failed, falling back to inline reply:", dmErr.message);
                        inlineDeliveries.push({ title: purchase.productTitle || purchase.productId, downloadUrl, licenseKey });
                    }
                } catch (err) {
                    console.error("Re-delivery via verify failed:", err.message);
                    failedTitles.push(purchase.productTitle || purchase.productId);
                }
            }
        }

        if (!anyRolesConfigured) {
            return interaction.editReply({
                content: "⚠️ No roles are configured for any of the products on this email. Contact an admin.",
            });
        }

        // Если хотя бы одна покупка нашлась через фоллбек, а не через webhook,
        // у неё может не быть contractId — предупредим, что для подписки
        // отмена может потребовать ручного вмешательства администратора.
        const contractNote = usedFallback && purchases.some((p) => !p.contractId)
            ? "\n⚠️ This purchase was verified directly with lava.top (no webhook was received for it). If it's a subscription, cancellation may need admin help since we don't have a contractId on file yet."
            : "";

        const roleNote = grantedRoles.size === 0 ? "You already have the role(s)." : "Role(s) have been granted.";

        let deliveryNote = "";
        if (deliveredTitles.length > 0) {
            deliveryNote = `\n📦 Check your DMs — a fresh download link and license key for ${deliveredTitles.join(", ")} ${deliveredTitles.length > 1 ? "are" : "is"} on the way.`;
        }
        for (const d of inlineDeliveries) {
            // DMs are off for this account — this reply is ephemeral (only you can
            // see it), so the link and key go here instead of getting lost.
            deliveryNote += `\n\n⚠️ Couldn't DM you for **${d.title}** (you may have DMs from server members off) — here it is instead:\n${d.downloadUrl}\nLicense key: \`${d.licenseKey}\``;
        }
        if (failedTitles.length > 0) {
            deliveryNote += `\n⚠️ Couldn't send the download for ${failedTitles.join(", ")} automatically — open a ticket in #ticket and we'll sort it out.`;
        }

        return interaction.editReply({
            content: `✅ Verified! ${roleNote}${contractNote}${deliveryNote}`,
        });

    } catch (err) {
        console.error(err);
        return interaction.editReply({
            content: "⚠️ Role assignment failed. Check bot permissions.",
        });
    }
}

client.once(Events.ClientReady, () => {
    console.log(`${client.user.tag} is online.`);
    startWebhookServer(client); // клиенту нужен доступ к guild/member для выдачи роли
    refreshTierPrices();
    registerAiSupport(client, { Events });
});

// The subscription webhook carries no offer id, so which tier was paid for has to be
// worked out from the amount — which means the amounts we compare against have to be
// current. USD is fixed, but lava.top re-derives the RUB and EUR prices as the rate
// moves, so the table compiled into roles.js drifts away from what buyers are charged.
// Pulling the live prices once at startup removes that drift; if the call fails the
// compiled table stays in use, which is why this never throws.
async function refreshTierPrices() {
    try {
        const prices = await fetchOfferPrices(SUBSCRIPTION_PRODUCT_ID);
        const updated = applyLivePrices(prices);
        console.log(updated > 0
            ? `[tiers] live prices loaded for ${updated} subscription tier(s).`
            : "[tiers] no live prices returned — using the prices compiled into roles.js.");
    } catch (err) {
        console.warn(`[tiers] live price lookup failed (${err.message}) — using the prices compiled into roles.js.`);
    }
}

client.on(Events.InteractionCreate, async (interaction) => {

    // ================= PANEL =================
    // The admin tools live in their own file: index.js is long enough, and
    // every one of these prints somebody's email, so they answer ephemerally.
    if (interaction.isChatInputCommand() && await handleAdminCommand(interaction, client)) {
        return;
    }

    // Its buttons and forms. Checked before everything else because the panel
    // owns its own custom ids and nothing further down should see them.
    if ((interaction.isButton() || interaction.isModalSubmit())
        && await handlePanel(interaction, client)) {
        return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
        const embed = new EmbedBuilder()
            .setColor("#ED4245")
            .setDescription(
`# 💥 Muzzle Core FX

### Modernize every firefight in GTA V with a complete weapon particle overhaul — now with a full visual configurator.

Muzzle Core FX replaces outdated weapon effects with cinematic muzzle flashes, realistic gun smoke, enhanced impact effects, shell casings and tracers. Built directly on GTA V's particle system, it delivers a clean, seamless upgrade without modifying weapon stats or relying on outdated \`weapons.meta\` replacements.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🛠️ **Muzzle Core Configurator**

Every effect is now fully adjustable through its own standalone app — no CodeWalker, no manual XML editing. Pick a weapon category, drag a few sliders, hit BUILD, done.

• **Per-Weapon Tuning**
Independent controls for Pistol, SMG, Rifle, and Shotgun & Sniper, plus global tracer/barrel/distortion/smoke/blood settings.

• **Live Preview**
Hover any flash variant before picking it.

• **Vanilla-Safe Defaults**
Every slider starts at the original look; change only what you want.

• **Presets**
Save your setup and keep editing later, or reset instantly.

• **One-Click Build**
Rebuilds your MuzzleCoreFX.rpf, ready to drop into your stream folder.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 **Features:**

• **Fully Customizable**
Adjust every flash, spark, smoke and tracer parameter yourself with the included configurator.

• **Engine-Level Particle Overhaul**
Built directly into GTA V's particle system for maximum compatibility. No \`weapons.meta\` edits, no weapon stat conflicts.

• **Full Weapon Compatibility**
Works seamlessly with vanilla, DLC and supported custom add-on weapons.

• **Story Mode & FiveM**
Includes separate, fully optimized versions for both Singleplayer and FiveM.

• **Tracer & Non-Tracer Options**
Choose between realistic bullet tracers or a clean, tracer-free experience — or tune it yourself.

• **Cinematic Muzzle Flashes**
Custom flash cores built from real firearm references, with multiple variants to choose from.

• **Volumetric Gun Smoke**
Dense smoke that lingers naturally and reacts to muzzle flashes and lighting.

• **Enhanced Bullet Impacts & Shell Casings**
Reworked impact particles, debris effects and realistic shell casing ejection.

• **Visual Mod Compatible**
Fully compatible with NVE, QuantV and most visual overhauls.

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ **Optional add-on: Flash Collection — $5.00**

Already own Muzzle Core FX? Expand it with 4 more cinematic muzzle flash textures, fully integrated into the same configurator for instant preview and one-click selection. Requires the base tool above — buy that first if you don't have it yet.

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
                .setEmoji("💳"),
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_FLASHCOLLECTION}`)
                .setStyle(ButtonStyle.Secondary)
                .setLabel("Flash Collection — $5")
                .setEmoji("⚡")
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

    // ================= PANEL: COMPLETE AUDIO OVERHAUL =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelaudio") {
        const embed = new EmbedBuilder()
            .setColor("#FFFFFF")
            .setDescription(
`# 🔊 Complete Audio Overhaul

Redefine the way GTA V sounds with a complete overhaul of weapon and environmental audio - featuring three unique sound variants included in one package.

Complete Audio Overhaul replaces GTA V's outdated audio with powerful, immersive weapon sounds while also enhancing the sounds of the world around you. Every firefight feels heavier, every vehicle sounds more alive, and every shot carries realistic distance and echo.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🎧 **Included Sound Variants**
Your purchase includes three complete sound packs:

• **Variant I**
A balanced mix designed for everyone. Clean, realistic audio with comfortable volume levels.

• **Variant II**
A louder, punchier mix for players who enjoy more aggressive weapon sounds.

• **Variant III**
The loudest and most powerful version, made for players who want maximum impact and intensity.

Switch between them anytime and choose the one that fits your preference.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 **Features**

• **Completely Reworked Weapon Audio**
Brand-new firing sounds for pistols and carbines, carefully balanced for a satisfying and realistic experience.

• **Redesigned Distant Gunshots**
Completely new long-distance weapon sounds that make firefights feel much more immersive.

• **Enhanced Gunshot Echo**
Improved environmental echoes for a larger, more realistic sound without becoming overwhelming.

• **New Shell Casing Sounds**
Redesigned shell casing audio with proper volume balance.

• **Improved Bullet Impact Sounds**
New hit sounds for bullets striking different surfaces.

• **Vehicle Audio Improvements**
Updated engine start sounds, tire audio, sirens, and various vehicle-related effects.

• **Immersive World Audio**
Numerous environmental sounds have been reworked to create a more cohesive and realistic atmosphere.

• **Story Mode & FiveM Compatible**
Works in both Singleplayer and FiveM.

━━━━━━━━━━━━━━━━━━━━━━━━━━

💿 **Includes**

• Variant I
• Variant II
• Variant III

All three sound packs are included with a single purchase.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $6.99`
            )
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_AUDIO}`)
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

# 💰 Price: $6.99`
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

# 💰 Price: $21.99`
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

# 💰 Price: $24.99`
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

    // ================= TIER PANELS (Basic / Membership / Premium) =================
    // Meant to be posted together, cheapest first, so the ladder reads top to bottom.
    // Premium exists as much to anchor the price as to sell: next to $14.99, Membership
    // reads as the sensible middle rather than the expensive option.
    //
    // The names match the offer names on lava.top exactly. They have to: the checkout
    // page shows the offer name, so a buyer who clicked "Basic" here must not arrive at
    // a page calling it something else.
    //
    // Each panel carries its embroidered patch as a real file attachment rather than a
    // link. Discord's own CDN urls are signed and expire, so an embed pointing at one
    // would quietly turn into a broken image on a message meant to stay up for months.
    // An attachment is part of the message and lasts as long as it does.

    if (interaction.isChatInputCommand() && interaction.commandName === "panelbasic") {
        const banner = new AttachmentBuilder(tierBannerPath("basic.png"));

        const embed = new EmbedBuilder()
            .setColor("#FFFFFF")
            .setDescription(
`# 🎒 Basic

### Everything outside the Muzzle Core FX line.

Audio, blood and graphics in one subscription — and every new release outside the Muzzle Core FX line is added to it automatically as it ships.

━━━━━━━━━━━━━━━━━━━━━━━━━━

**Included:**

🔊 Complete Audio Overhaul

🩸 Ziplocker's Blood FX

🎨 Ziplocker's Graphics V2

☀️ Ziplocker Summer Visuals

🔄 Future releases outside the Muzzle Core FX line

━━━━━━━━━━━━━━━━━━━━━━━━━━

**Not included:** Muzzle Core FX, Graphics Pack V1 and Graphics Pack V2 — both packs bundle Muzzle Core FX inside them. All three come with **Membership**.

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $5.99 / month`
            )
            .setImage("attachment://basic.png")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_BASIC}`)
                .setStyle(ButtonStyle.Secondary)
                .setLabel("Subscribe")
                .setEmoji("💳")
        );

        await interaction.channel.send({ embeds: [embed], files: [banner], components: [row] });

        return interaction.reply({
            content: "✅ Panel created.",
            ephemeral: true,
        });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "panelmembership") {
        const banner = new AttachmentBuilder(tierBannerPath("membership.png"));

        const embed = new EmbedBuilder()
            // Not #000000: Discord reads a colour of exactly zero as "no colour set" and
            // falls back to its default grey bar, so the black tier would be the only one
            // without a stripe. One step off zero looks black and still counts as a colour.
            .setColor("#010101")
            .setDescription(
`# 💎 Membership

### Everything in the workshop. Now, and whatever comes next.

Muzzle Core FX, both graphics packs, and every release that follows. Nothing is held back and nothing costs extra.

━━━━━━━━━━━━━━━━━━━━━━━━━━

**Included:**

🎒 Everything in Basic

🔥 Muzzle Core FX — full version

🎨 Graphics Pack V1

🎨 Graphics Pack V2

🔄 Every future release — packs, mods and updates, the day they ship

🗳️ A vote in every poll on what gets built next

👀 Exclusive sneak peeks

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $9.99 / month`
            )
            .setImage("attachment://membership.png")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_SUBSCRIBE}`)
                .setStyle(ButtonStyle.Success)
                .setLabel("Subscribe")
                .setEmoji("💳")
        );

        await interaction.channel.send({ embeds: [embed], files: [banner], components: [row] });

        return interaction.reply({
            content: "✅ Panel created.",
            ephemeral: true,
        });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "panelpremium") {
        const banner = new AttachmentBuilder(tierBannerPath("premium.png"));

        const embed = new EmbedBuilder()
            .setColor("#8B5CF6")
            .setDescription(
`# 👑 Premium

### Everything Membership gives you, plus a hand on the wheel.

Membership gets you everything that exists. Premium decides what exists next — and puts it in your hands before anyone else.

━━━━━━━━━━━━━━━━━━━━━━━━━━

**Included:**

💎 Everything in Membership

📦 Beta builds — try new work while it's still being made

⚡ Early access — finished releases reach you before anyone else

💡 Suggest your own ideas — not just vote on the options

🗳️ Your idea goes up as a poll for everyone to vote on

🎫 Priority tickets — your own queue, answered ahead of the rest

━━━━━━━━━━━━━━━━━━━━━━━━━━

# 💰 Price: $14.99 / month`
            )
            .setImage("attachment://premium.png")
            .setFooter({ text: "Official Ziplocker Store • Secure payment via Lava" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${PRODUCT_ID_PREMIUM}`)
                .setStyle(ButtonStyle.Primary)
                .setLabel("Subscribe")
                .setEmoji("💳")
        );

        await interaction.channel.send({ embeds: [embed], files: [banner], components: [row] });

        return interaction.reply({
            content: "✅ Panel created.",
            ephemeral: true,
        });
    }

    // ================= /aiusage =================
    // The gateway shows its balance only on its own site, so this is the only
    // place the spend is visible from Discord. Admin-only and ephemeral: it is
    // an operational number, not something a customer needs to see.
    if (interaction.isChatInputCommand() && interaction.commandName === "aiusage") {
        const u = usageSummary();

        const pct = u.percentUsed.toFixed(1);
        const bars = Math.min(20, Math.round(u.percentUsed / 5));
        const meter = "\u2588".repeat(bars) + "\u2591".repeat(20 - bars);

        const embed = new EmbedBuilder()
            .setColor(u.percentUsed >= 90 ? "#ED4245" : u.percentUsed >= 75 ? "#FAA61A" : "#FFFFFF")
            .setTitle("AI assistant usage")
            .setDescription(
                `\`${meter}\`  **at least ${pct}%** of the token budget\n` +
                `-# counted from answers logged here` +
                (u.since ? ` since ${u.since.slice(0, 10)}` : "") +
                ` \u2014 the real figure is on tonwave.dev`
            )
            .addFields(
                {
                    name: "Tokens",
                    value:
                        `used **${u.used.toLocaleString("en-US")}** of ` +
                        `${u.budget.toLocaleString("en-US")}\n` +
                        `left **${u.remaining.toLocaleString("en-US")}**`,
                    inline: true,
                },
                {
                    name: "Questions",
                    value:
                        `**${u.questions}** asked, ${u.answered} answered\n` +
                        `~**${u.perQuestion.toLocaleString("en-US")}** tokens each` +
                        (u.fullFaq
                            ? `\n**${u.fullFaq}** sent the whole FAQ`
                            : ""),
                    inline: true,
                },
                {
                    name: "Feedback",
                    value: `\u{1F44D} ${u.up}   \u{1F44E} ${u.down}`,
                    inline: true,
                },
            )
            .setTimestamp();

        if (u.questionsLeft !== null) {
            embed.addFields({
                name: "At this rate",
                value:
                    `at most **${u.questionsLeft.toLocaleString("en-US")}** more questions\n` +
                    `-# an upper bound: retries and failed calls are billed but never logged`,
            });
        }

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ================= /paneldirectory =================
    // Posted by the bot so the links render as names. Pasted by hand they would
    // be fourteen raw URLs, which is why this command exists at all.
    if (interaction.isChatInputCommand() && interaction.commandName === "paneldirectory") {
        await interaction.reply({ content: "Posting the directory…", ephemeral: true });
        await interaction.channel.send({ embeds: buildDirectoryEmbeds() });
        return interaction.editReply({ content: "Posted." });
    }

    // ================= AI ANSWER FEEDBACK =================
    // The two buttons under every AI reply. Answered quietly and ephemerally:
    // this is a signal for the log, not a conversation, and a public "thanks for
    // your feedback" under every answer would be noise.
    if (interaction.isButton()) {
        const parsed = parseFeedbackId(interaction.customId);
        if (parsed) {
            const result = recordFeedback({
                logId: parsed.logId,
                userId: interaction.user.id,
                vote: parsed.vote,
            });

            const reply = result.reason === "not yours"
                ? "That one isn't yours to rate — the buttons are for whoever asked."
                : !result.ok
                    ? "Couldn't record that — the answer is too old to vote on."
                    : parsed.vote === "up"
                        ? "Noted, thanks."
                        : "Noted — this one will get looked at.";

            return interaction.reply({ content: reply, ephemeral: true });
        }
    }

    // ================= /ask =================
    // The same assistant as the help channel, reachable from anywhere. Worth having
    // as well as the channel: it works in front of the ticket panel, where someone
    // is already halfway to opening a ticket, and the reply is ephemeral so it
    // doesn't clutter a channel that isn't meant for chat.
    if (interaction.isChatInputCommand() && interaction.commandName === "ask") {
        const question = interaction.options.getString("question");
        await interaction.deferReply({ ephemeral: true });

        const result = await handleQuestion({
            question,
            discordId: interaction.user.id,
            username: interaction.user.username,
            source: "slash",
        });

        if (!result) {
            return interaction.editReply({
                content: "Ask me an actual question and I'll try to answer it.",
            });
        }

        // Same embed as the help channel, so /ask and the channel look identical.
        const embed = buildAnswerEmbed({
            kind: result.kind,
            text: result.text,
            question: result.question,
            user: interaction.user,
        });
        const components = buildAnswerComponents({
            kind: result.kind,
            logId: result.logId,
        });

        return sendWithRetry(
            () => interaction.editReply({ embeds: [embed], components }),
            "/ask reply"
        );
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

        // Specifically the subscription purchase — an email can now own several
        // different products, and cancelling has to target the right one.
        const purchase = getPurchaseForProduct(email, SUBSCRIPTION_PRODUCT_ID);

        if (!purchase) {
            return interaction.editReply({
                content: `❌ No subscription purchase found for \`${email}\`.`,
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

    // ================= VERIFY (ручной фоллбек — панель Get Role) =================
    if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
        await interaction.deferReply({ ephemeral: true });
        const email = interaction.fields.getTextInputValue("email").trim().toLowerCase();
        return verifyPurchaseAndDeliver(interaction, email);
    }

    // ================= REDOWNLOAD (панель для рассылки — новая версия с ключами) =================
    if (interaction.isChatInputCommand() && interaction.commandName === "panelredownload") {
        const embed = new EmbedBuilder()
            .setColor("#3DDC84")
            .setTitle("Get Your Updated Download")
            .setDescription(
`Muzzle Core FX now uses a license key to unlock the app.

If you bought it before this change, click the button below and enter
the email you used at checkout — you'll get a fresh download link and
your license key by DM.`
            )
            .setFooter({ text: "Official Ziplocker Store" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("redownload")
                .setStyle(ButtonStyle.Primary)
                .setLabel("Get Updated Download")
                .setEmoji("📦")
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });

        return interaction.reply({
            content: "✅ Panel created.",
            ephemeral: true,
        });
    }

    if (interaction.isButton() && interaction.customId === "redownload") {
        const modal = new ModalBuilder()
            .setCustomId("redownload_modal")
            .setTitle("Get Your Updated Download");

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

    if (interaction.isModalSubmit() && interaction.customId === "redownload_modal") {
        await interaction.deferReply({ ephemeral: true });
        const email = interaction.fields.getTextInputValue("email").trim().toLowerCase();
        return verifyPurchaseAndDeliver(interaction, email);
    }
});

// A dropped connection deep inside discord.js must not take the whole bot with
// it. Node's default for an unhandled rejection is to exit the process, which on
// this network turns a momentary blip into an outage lasting until somebody
// notices the bot is gone. Logged loudly, but survivable.
process.on("unhandledRejection", (err) => {
    console.error("[unhandled rejection]", (err && err.message) || err);
});

/**
 * Logging in is the one call that has to succeed before anything else works, and
 * it goes to the same Cloudflare front that drops connections here often enough
 * to matter — a ten-second connect timeout at the wrong moment used to kill the
 * process outright, before the bot had done a single thing.
 */
async function login(attempts = 5) {
    for (let i = 1; i <= attempts; i += 1) {
        try {
            await client.login(process.env.DISCORD_TOKEN);
            return;
        } catch (err) {
            console.error(`[startup] login failed (attempt ${i}/${attempts}): ${err.message}`);
            if (i === attempts) throw err;
            const wait = Math.min(30000, 2000 * i);
            console.error(`[startup] retrying in ${wait / 1000}s`);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
}

login().catch((err) => {
    console.error("[startup] could not log in to Discord:", err.message);
    process.exit(1);
});