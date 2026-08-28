# Ziplocker's Workshop — FAQ

<!--
One file, three uses:
  1. the system prompt for the support AI
  2. the FAQ channel in Discord
  3. the top answers pasted into Ticket Tool's "Ticket Message"

Keep it that way. The moment this text is duplicated somewhere, the copies drift
apart and nobody notices until a customer is told two different things.

Questions are written the way a customer would actually say them, not the way the
problem is named internally. "The BUILD button doesn't do anything" is what gets
typed into a ticket; "Assets directory not found" is not.
-->

---

# 1. What is all this?

### What do you sell?

Visual and audio mods for **GTA V**, for both Story Mode and FiveM. Muzzle flash
and weapon effects, blood, graphics overhauls, and a full audio replacement.

The flagship is **Muzzle Core FX** — it doesn't just replace the muzzle flash
with one fixed look, it comes with an app that lets you build your own.

### What's the difference between all the products?

| Product | What it is |
| --- | --- |
| **Muzzle Core FX** | Muzzle flash, sparks, smoke, tracers and bullet impacts — plus the configurator app to tune them yourself |
| **Muzzle Core FX \| Flash Collection** | An add-on: four extra flash styles for the configurator. Not the app |
| **Ziplocker's Blood FX** | Blood and impact effects |
| **Complete Audio Overhaul** | Weapon and ambience audio replacement |
| **Ziplocker's Graphics V2** | Single graphics mod |
| **Ziplocker Summer Visuals** | Seasonal visual preset |
| **Graphics Pack V1 / V2** | Full graphics packages — these include Muzzle Core FX inside them |
| **Tracer Tool** | Free bullet tracer editor. No key, no purchase |

### I just want better muzzle flash. What do I buy?

**Muzzle Core FX.** That's the whole thing — the effects and the app to customise
them. Everything else is optional.

### What's the "configurator"?

The app that comes with Muzzle Core FX. You move sliders, press BUILD, and it
produces the mod file with your settings baked in. Nothing is fixed — flash size,
colour, smoke, sparks, tracers and impacts are all yours to set.

Full details in section 8.

### Do I need to own GTA V?

Yes. These are mods for the game, not standalone programs.

---

# 2. What each mod is

### Which one do I actually want?

- **Weapon effects** you can see — muzzle flash, smoke, sparks, impacts: **Muzzle Core FX**.
- **Weapon sounds**: **Complete Audio Overhaul**, or the free **Realism Guns Sound Pack**.
- **Blood and gore**: **Ziplocker's Blood FX**.
- **The way the whole game looks**: a **Graphics Pack**, or **Summer Visuals** for a summer look.
- **Just the bullet tracers**, free: **Tracer Tool**.

A subscription covers the paid ones. Buying separately makes sense when you only
want one thing.

### Muzzle Core FX

A complete overhaul of the weapon particle effects: muzzle flashes, gun smoke,
impact effects, shell casings and tracers, built on GTA V's own particle system.
It does not touch weapon stats and does not replace `weapons.meta`.

What makes it different from a fixed mod is the **configurator**: every effect is
adjustable in its own app, per weapon, with no CodeWalker and no XML editing. See
the configurator section further down.

Works on **Story Mode and FiveM**. Paid, and included in Membership and Premium.

### Flash Collection

An **add-on to Muzzle Core FX**, not a mod of its own. Muzzle Core FX ships with
flash variants I—III; Flash Collection adds IV—VII. The variants are sold
individually, so owning only one or two is normal.

They drop into the configurator's `Assets\Presets\` folder. Without Muzzle Core
FX there is nothing for them to plug into.

### Ziplocker's Blood FX

A rebuild of the game's blood and gore: 18 new blood pool textures and 19 new
splatter textures, all in high resolution.

- Blood pools, splatters and soak textures redone so they react to light properly.
- The default body-hit particles replaced with custom effects, giving larger and
  more dramatic sprays.
- Wound decals and soak patterns that vary by the weapon and ammunition used.
- A wide library of variations, so repeated hits do not look stamped out.

Works on **Story Mode and FiveM**. Paid, and included in every subscription tier.

### Complete Audio Overhaul

A full replacement for GTA V's weapon and environmental audio, in **three sound
variants** included with one purchase:

- **Variant I** — balanced, clean and realistic at comfortable volume.
- **Variant II** — louder and punchier.
- **Variant III** — the loudest, for maximum impact.

Switch between them whenever you like. Beyond the firing sounds it also redoes
**distant gunshots**, **gunshot echo**, **shell casings** and **bullet impacts**.

Works on **Story Mode and FiveM**. Paid, and included in every subscription tier.

### Realism Guns Sound Pack

A free weapon sound pack. No purchase and no key — it is posted in the server.

It comes as **two `.rpf` files**. Both go into:

  `GTAV > x64 > audio > sfx`

That is the same place every sound pack goes, so a new pack replaces the one
before it rather than stacking with it.

### Ziplocker Graphics Pack V1

The original all-in-one pack: QuantV visuals, the blood overhaul, muzzle flashes
and bullet impacts, a gun sound overhaul, and replaced road and vegetation
textures.

**FiveM only.** Paid, and included in Membership and Premium.

### Ziplocker's Graphics Pack V2

The all-in-one, rebuilt on **CoreFX** instead of QuantV: improved lighting,
reflections, weather and colour, plus blood and ragdoll improvements and Muzzle
Core FX effects.

Ships in **two editions** — **Quality**, with volumetric clouds, and
**Performance**, without them for the FPS, keeping the same look otherwise.

**FiveM only.** Paid, and included in Membership and Premium.

### Ziplocker's Graphics V2

The **visuals only** half of Graphics Pack V2: the same CoreFX configuration,
without the combat mods. For people who want the game to look better and nothing
else.

Same **Quality** and **Performance** editions. **FiveM only.** Paid, and included
in every subscription tier.

**Not the same product as Graphics Pack V2** — the names differ by one word and
the packs differ by everything that is not visual.

### Ziplocker's Graphics Pack V3

The current **free** graphics pack. Posted in the server with separate downloads
for improved textures and for roads.

### Ziplocker Summer Visuals

A summer look for the game: a tuned QuantV setup with a custom cinematic ReShade
preset. Bright, vibrant daytime while keeping nighttime lighting realistic.

Built to be light on performance, and adjustable to taste. **Hotkeys** switch
bloom, lens effects, tint, overlay, borders and night mode without opening the
ReShade menu.

Works on **GTA V and FiveM**. Paid, and included in every subscription tier.

### Tracer Tool

A **free** editor for the bullet tracer — the glowing streak that travels through
the air after a shot. No key, no activation.

Colour (yellow is vanilla, plus blue, red and white), how brightly it glows, size
and speed as ranges so shots vary, and an optional smoke trail. Builds for both
FiveM and Story Mode from one set of settings, and the base files ship with the
tool, so there is nothing to extract from your game.

**If you own Muzzle Core FX you do not need it** — the same tracer controls are
already in the configurator, and the two cannot be installed together.

### Tracer FX

The tracer effects as a ready file rather than an editor. Drop the ptfx files
into your `mods` folder — the exact path is in the FiveM section below.

### Immersive Combat 1.9 + Muzzle Core FX

Immersive Combat is a combat overhaul **by Artupaky01**. It ships with muzzle
effects of its own, and that is why muzzle effect mods stop doing anything once
it is installed — its effects are already sitting where theirs would go.

This build puts the **vanilla effects back on every weapon**, so Muzzle Core FX,
or any other effect replacer, works again. The compatibility patch is
ziplocker's; the mod itself is not.

Weapon handling, damage, recoil, ammo and first-person positions are left
untouched.

**Free.**

### What do I need for Immersive Combat?

- **GTA V, singleplayer.** Not FiveM.
- **OpenIV.**
- **A muzzle effect mod, installed separately.** This package contains no effect
  files of its own — it only clears the way for one. Muzzle Core FX is the
  obvious choice, but any replacer works.

It can be installed **straight over the original Immersive Combat**.

### How do I install Immersive Combat?

Double-click **`Immersive Combat 1.9 + Muzzle Core FX.oiv`** and choose **mods
folder**. OpenIV has to be installed first.

There are also **lower recoil** and **no recoil** packages included, unchanged
from the original. They only touch recoil values and go on top of this.

### What is the "Manual" folder for?

For installing by hand instead of running the `.oiv`.

The folder **mirrors the layout inside `update.rpf`**. Open
`mods\update\update.rpf` in OpenIV with **Edit mode on**, then drag the files
from `Manual\update\update.rpf\...` into the matching folders, replacing what
is there.

Most people should just run the `.oiv` — it does exactly this, without the
chance of dropping a file in the wrong folder.

### How do I uninstall Immersive Combat?

- **If you used the .oiv** — double-click `Immersive Combat 1.9 Uninstaller.oiv`.
- **If you installed by hand** — copy the files from `Manual Uninstaller` back
  into `update.rpf`.

Both restore the **vanilla** files, not the original Immersive Combat. If you
want that back, install it again afterwards.

---

# 3. Before you buy

### Which games are supported?

**Muzzle Core FX**, **Blood FX** and **Complete Audio Overhaul** work with:

- GTA V Story Mode
- FiveM

**Graphics Packs and graphics mods** are built for **FiveM only**. Always check
the product description before buying.

### Legacy or Enhanced? I'm on GTA V Enhanced

**Use Legacy.** Enhanced is not supported.

Some of it does load on Enhanced, but it behaves incorrectly — effects come out
buggy, and it is not something to play with. Everything here is built and tested
against **GTA V Legacy**, and that's the version to install on.

If you only have Enhanced, don't buy expecting it to work. This isn't a bug that's
about to be fixed — Enhanced packages the game differently, and support for it
would be a separate build.

### Can I use this in GTA Online?

No. These are for **Story Mode** and **FiveM**, and nothing here is meant for
GTA Online.

Rockstar bans accounts for modified game files in Online, and that risk is
entirely yours — it is not something a refund covers. If you play both, install
to a `mods` folder rather than over your real game files, so Online still loads
clean originals.

FiveM is a separate thing from GTA Online and is not affected by this.

### Does this work on alt:V, RAGE MP, or other multiplayer clients?

**No — the supported clients are FiveM and Story Mode.** There is no build for
anything else.

Can it be made to work? Possibly, with effort that's yours rather than mine —
RAGE MP, for instance, needs an archive fix before it will load files like these
at all. Nothing here is tested on those clients, and if you go that route you're
on your own with it.

Buy for FiveM or Story Mode. If you get it running elsewhere afterwards, good —
just don't buy it *expecting* that.

### Will this work on any FiveM server?

No — and this is the single most common reason a mod "doesn't work".

Servers running **Pure Mode** or strict vanilla enforcement block modified game
files on purpose. Nothing here will load on them, and there is no way around it.
That's the server's rule, not a fault in the mod.

If you're not sure, ask the server's staff whether client-side graphics and
effects mods are allowed.

### Can I use this on the server I run, for all my players?

No — there's no server-wide licence at the moment.

A purchase covers **your own game**. Everyone who wants the mod needs their own
copy. These are client-side mods anyway: each player installs their own, and what
you install doesn't reach anyone else on the server.

If you run a server and want something built for that, open a ticket and say so.
It doesn't exist today, but it's worth knowing people are asking.

### Does it matter whether I bought the game on Steam, Epic or Rockstar?

No. The mods work the same on all three — installation paths differ slightly, but
that's all. If you can't find your game folder, your launcher will show you where
it installed.

### Are these compatible with graphics mods like NVE, QuantV, and so on?

Yes. Muzzle Core FX and Blood FX work alongside **any** graphics mod.

The look changes slightly depending on which one you use — flash glow can read a
little stronger or weaker against different lighting. The default values are
balanced to look right across the widest range of setups, and if you don't like
how it sits with yours, that's exactly what the configurator is for.

### Do Muzzle Core FX and Blood FX work together?

Yes, on both platforms. What makes it work is leaving one file out:

- **FiveM** — don't install `ziplocker's spray.rpf`.
- **Story Mode** — don't install `Ziplocker's_Blood_Body-hit_effects`.

Those are the parts that overlap with Muzzle Core FX. Everything else from Blood
FX installs as normal.

Then put the `blood` folder, texture and all, into the configurator's `Assets`
folder — that's what makes the blood side work properly.

### Does the muzzle flash work on FiveM too?

Yes. The configurator builds for both from one set of sliders — **BUILD FOR
FIVEM** gives you a `MuzzleCoreFX.rpf` for your FiveM `mods` folder, **BUILD FOR
SINGLEPLAYER** gives you an `.oiv` for Story Mode. You can build both.

What FiveM adds is the server. A server running Pure Mode blocks client mods
outright, and a couple of servers override parts of the shooting effects
themselves — see the troubleshooting section.

### Does Muzzle Core FX work with every weapon?

It covers **every weapon that uses GTA V's default muzzle flash effects**,
including DLC weapons.

What it can't do is replace effects a server has swapped out entirely. If a FiveM
server forces a rifle to use minigun particles, that rifle is no longer using the
effect Muzzle Core FX modifies, and nothing will change for it.

### Will this hurt my FPS?

**Muzzle Core FX, Blood FX, Audio** — small impact. It scales with how many
effects are on screen at once, so a heavy firefight costs more than walking
around.

**Graphics Packs** — moderate impact. They change lighting, shaders and
post-processing, so they affect every frame, not just the effects.

If you're already at the edge of your hardware, the graphics packs are the ones
to be careful with.

### Do I need OpenIV?

Only for **Story Mode**. FiveM installation doesn't touch it.

OpenIV is free, from **openiv.com**.

### Are these one-time purchases or a subscription?

Both are available. Every product can be bought on its own, once; or you can
subscribe and get a whole set of them for less than buying them separately.

See section 4.

---

# 4. Buying

### How do I buy?

Everything is bought through the panels in this Discord. There is no separate
website, and no account to create anywhere.

1. Open the panel for what you want. **Subscribe** for a monthly tier, **Buy**
   for a one-off product.
2. Choose **Card** or **PayPal**.
3. Enter the email the order should be tied to.
4. A payment page opens on **lava.top**. Pay there.
5. Come back to Discord. Your role and your files arrive on their own.

You don't need to tell anyone you've paid, and you don't need to open a ticket
to collect anything.

### What happens right after I pay?

It depends on what you bought.

**A subscription — any tier.** Your **role** appears within seconds and unlocks
your downloads channel, where the files in your tier are already waiting. You
also get a **DM** with the configurator and your licence key.

**Muzzle Core FX, or a Graphics Pack.** A **DM** with your download link and your
licence key. The key unlocks the configurator app — you paste it in the first
time you open it.

**Anything else bought once.** No DM and no channel. The file is on your lava.top
account, as a download link or an attachment:

https://app.lava.top/my-purchases

**Channels are a subscription thing.** A one-off purchase does not open any
channel, whatever it was — that is not a fault, it is how the two differ.

If a DM you were expecting never arrives, it is almost always because DMs from
server members are switched off on your account. Run **`/getrole`** and the bot
hands you the same link and key right there in the channel, where only you can
see them.

### Am I buying a subscription or a one-off?

Panels marked **Subscribe** are monthly, and keep working for as long as the
subscription is active. Panels marked **Buy** are paid once and are yours to
keep.

If you only want one specific thing, buy it once. If you want the library, the
subscription is what covers it.

### What payment methods work?

**Card** and **PayPal**, both handled by lava.top.

Prices are shown in **USD, EUR or RUB**, and lava.top does the conversion. USD is
what the tiers are actually priced in — the other two are derived from it and
drift a little as exchange rates move.

### Which email should I use?

Whichever you like — but **remember which one**. It's how your purchase is found
later if your role goes missing or you need your files again.

It does **not** have to match your Discord account's email. Nothing is matched
that way.

### Do I need a Discord account?

To buy, no. To receive your files and role automatically, yes — the delivery goes
through Discord.

If you bought without going through the Discord panel, run `/getrole` afterwards
with your checkout email and everything will be linked up.

---

# 5. Subscriptions

### What are the three tiers?

**Basic — $5.99/month**
Everything outside the Muzzle Core FX line:
Complete Audio Overhaul · Blood FX · Graphics V2 · Summer Visuals · every future
release outside that line, added automatically as it ships.

**Membership — $9.99/month**
Everything in Basic, plus:
Muzzle Core FX (full version) · Graphics Pack V1 · Graphics Pack V2 · every future
release · a vote in every poll on what gets built next · sneak peeks.

**Premium — $14.99/month**
Everything in Membership, plus:
beta builds · early access to finished releases · you can suggest your own ideas,
not just vote on the options · your idea goes up as a poll · priority tickets.

### Why isn't Muzzle Core FX in Basic?

It's the flagship, and both Graphics Packs bundle it inside them — so Muzzle Core
FX, Graphics Pack V1 and Graphics Pack V2 all sit at Membership and above.

Basic covers everything else, and gets every future release that isn't part of
that line.

### Is a subscription cheaper than buying things separately?

Yes, substantially — that's the point of it. Buying the Basic contents one by one
comes to around $31; the whole catalogue is around $93.

### I'm on Basic and I want Muzzle Core FX

Subscribe to Membership. Your Basic role is swapped for the Membership one
automatically — you don't need to cancel Basic first or ask anyone to do anything.

### How do I cancel?

Cancel in your **lava.top account** under your subscriptions, or open a ticket and
ask — we'll cancel it for you.

There's no minimum term and no cancellation fee.

### What happens when I cancel?

Your subscription role is removed and you lose access to the tier channels and
future updates.

**Files you already downloaded stay yours and keep working.** Cancelling doesn't
reach into your game and remove anything.

### When am I billed?

Monthly, on the same date you first subscribed. lava.top handles it and emails you
each time.

### My renewal payment failed

lava.top retries a couple of times over the following day or so before giving up.
Your role stays in place during that window — you don't need to do anything unless
all the attempts fail.

If it did fail completely, just subscribe again.

### Where are my downloads?

**On a subscription** — in the downloads channel for your tier. Basic has its own;
Membership and Premium share one. Your role unlocks the right one automatically
the moment it is granted.

**On a one-off purchase** — there is no channel. Muzzle Core FX and the Graphics
Packs arrive by DM with a link and a licence key; everything else sits on your
lava.top account:

https://app.lava.top/my-purchases

That page lists everything you have ever bought, so it is also the place to look
when a link has expired or a DM went missing.

---

# 6. I've paid — where's my stuff?

### I paid and nothing happened

First, check what you were expecting. A one-off purchase that is not Muzzle Core
FX or a Graphics Pack sends **no DM and opens no channel** — the file is on your
lava.top account and nothing else was ever going to arrive:

https://app.lava.top/my-purchases

If you subscribed, or bought Muzzle Core FX or a Graphics Pack, then something
should have arrived. In this order:

1. **Check your DMs are open.** In Discord: **Settings → Privacy & Safety →**
   allow direct messages from server members. The bot cannot message you
   otherwise. **This is by far the most common cause** — the payment went through
   fine, the message just had nowhere to go.
2. **Run `/getrole`** and enter the email you used at checkout. This re-sends
   everything and grants your role.
3. If `/getrole` can't find the purchase, open a ticket with your checkout email
   and roughly when you paid.

### `/getrole` says my email is linked to another Discord account

An email can only be tied to one Discord account — that's deliberate, so a single
purchase can't be spread across several people.

If it's genuinely your own second account, open a ticket and say so.

### Where is my licence key?

In the same direct message as your download link. You enter it in the app to
unlock it.

Lost it? Run **`/getrole`** with your checkout email — it re-sends both the link
and the key, as many times as you need.

### I reinstalled Windows, or I'm on a new PC

Enter your licence key again on the new installation. If you no longer have it,
run **`/getrole`** with your checkout email and it re-sends both the key and the
download link.

### Can I use my key on two computers, a second PC or a laptop?

Your key is for **you**, not for a machine. Moving to a new PC, or reinstalling
Windows, is fine — enter the same key again.

What it is not is a licence to share. One key belongs to one buyer, and a key
that turns up in someone else's hands is a leak, not a second seat.

### What happens if a key gets shared?

Every key can be **revoked**, and the app checks its key against the server each
time it starts. A revoked key stops unlocking the app from that point on, on
every machine it was used on.

Every download also carries markers tying it back to the order it was issued to,
so a file that turns up circulating leads back to an account.

### This purchase was refunded — why can't I get my role?

Because it was refunded. `/getrole` checks against the refund list before it
grants anything, and stops there.

If that looks wrong to you — a refund you did not ask for, or a charge you were
told would be reversed and was not — open a ticket with your checkout email and
it gets looked at by a person.

### My role disappeared

If you cancelled or a renewal failed, that's expected — see section 4.

If you didn't, run `/getrole` with your checkout email. If that doesn't restore
it, open a ticket.

### Where are the installation instructions?

Inside the download. Every product ships a **README** with the exact steps for
that product and that version.

This FAQ covers the common ground. The README covers your specific file, and
where the two ever disagree, the README is the one to follow.

### I've got the files — what do I do with them?

It depends on where you play:

- **FiveM** — drop the `.rpf` into your FiveM `mods` folder. Nothing to run.
- **GTA V Story Mode** — double-click the `.oiv` and let OpenIV install it.
- **The configurator app** — unzip it anywhere, run it, paste your licence key.

Full steps for each are further down this FAQ.

### I bought several mods — how do I install them together?

One at a time, reading the README in each download first.

Several of these mods write the same game files. Where two of them overlap, the
README tells you which file to leave out of one of them — the rest installs
normally.

Muzzle Core FX and Blood FX are the pair this comes up with most: skip
`ziplocker's spray.rpf` on FiveM, or `Ziplocker's_Blood_Body-hit_effects` on
Story Mode, and the two run together fine.

### Can I share my download link or key?

No. Both are tied to your order and identify it. Every copy that goes out carries
markers that lead back to the account it was issued to, and files that turn up
circulating are traced.

### I bought before there were licence keys — what do I do?

Use the **redownload panel**, or run **`/getrole`** with your checkout email.
Either one reissues your download as the current build **with a licence key**,
which is what the app now asks for on first run.

You do not buy anything again. The purchase on file is what the reissue is
based on.

### How do I get the latest version?

Run **`/getrole`** with your checkout email, or use the redownload panel. Either
one issues a fresh link to the current build. Your key doesn't change.

You don't have to buy anything again — updates are included.

### How do I install an update?

Reinstall the mod from the same link in your DM. That link always hands you the
current build, so there's nothing new to fetch and nothing to buy.

There's no uninstall step first — the new files replace the old ones where they
sit. Your licence key stays the same, and your saved presets keep working.

### Do my presets still work after an update?

Yes. A `.zwp` preset saved by an older version opens in a newer one — a preset
made in 2.1 loads in 2.2 and applies exactly as it did.

---

# 7. Installing on FiveM

### Where do the files go?

Drop the `.rpf` into your FiveM **`mods`** folder.

If a file with the same name is already there, replace it.

That's the entire process — no OpenIV, no installer, nothing to run.

### Tracer FX: where exactly do the ptfx files go?

Into your `mods` folder, at this path:

  `update\update.rpf\x64\patch\data\effects`

Three files come with it — `ptfx.rpf`, `ptfx_hi.rpf` and `ptfx_lo.rpf`. All
three go in the same place.

### I don't have a `mods` folder

Create one, in your FiveM application directory, named exactly `mods`. FiveM reads
it automatically.

### Do I need to restart?

Restart FiveM. A full game restart, not just rejoining the server.

### Is this client-side or server-side?

Client-side. It changes what **you** see. Other players on the server see their
own setup.

### I installed it and nothing changed

Almost always one of these:

- The server enforces **Pure Mode** — see section 2.
- The file went somewhere other than `mods`.
- FiveM wasn't fully restarted.
- Another effects mod is overwriting it — see section 11.

---

# 8. Installing on GTA V Story Mode

### How do I install?

Double-click the `.oiv` file and let the **OpenIV Package Installer** do the rest.
It walks you through it.

### Where do I get OpenIV?

**openiv.com** — it's free.

### Should I back up my game first?

**Yes.** OpenIV offers to make a backup during installation. Take it.

It costs you thirty seconds and it's the difference between undoing a mod in one
click and reinstalling the game. See section 10 for why this matters more than it
sounds.

### OpenIV asks whether to install to `mods` or the game folder

Choose the **`mods` folder** if you have one — that's the safer option and it's
what OpenIV recommends. It keeps your original game files untouched.

### The .oiv won't open / Windows asks what to open it with

OpenIV isn't installed, or isn't associated with `.oiv` files. Install OpenIV
first, then double-click the file again.

You can also open OpenIV and use **Tools → Package Installer** and pick the file
manually.

---

# 9. The configurator app

### What does it actually do?

Muzzle flash, sparks, smoke, tracers and bullet impacts, each on its own slider.
You set them how you want, press BUILD, and the app produces the mod file with
your settings inside it.

Two BUILD buttons: one makes an `.oiv` for **Story Mode**, the other makes an
`.rpf` for **FiveM**. Same settings, either output — you can build both.

### How do I actually use it?

1. Pick a weapon tab at the top — **Pistol / SMG / Rifle / Shotgun & Sniper**.
   Each weapon keeps its own settings, independently of the others.
2. The global settings — **Tracer colour, Barrel, Distortion, Eject Smoke and
   Blood** — apply to every weapon at once.
3. Hover a flash variant to preview it before committing to it.
4. Move whatever sliders you like. Every value starts at exactly the vanilla
   look, so anything you don't touch stays as the game has it.
5. Press **BUILD FOR FIVEM** for a `MuzzleCoreFX.rpf`, or **BUILD FOR
   SINGLEPLAYER** for an `.oiv`. Same settings either way, and you can build
   both.

**RESET** throws away every change and starts over. **SAVE** stores your current
settings as a `.zwp` preset file — that writes the preset only and never touches
your game. **LOAD** reopens a preset you saved earlier.

### Story Mode: which `.oiv` do I install?

For the configurator, the one **it builds for you**. There is no ready-made
`.oiv` in the archive — you set your sliders, press **BUILD FOR SINGLEPLAYER**,
choose where to save, and double-click the file it produces.

Products that aren't the configurator do ship a finished `.oiv`. For those,
extract the archive and run it as it comes.

### What does each setting do?

Every control in the app has a tooltip — hover it and you get this, plus the
vanilla value it started from. This is the same information in one place.

**How the sliders work.** Most values are a **range**, not a single number. Drag
either end to spread the two apart and the game picks a value between them for
each shot, so no two shots look identical. Drag the middle to move both ends at
once. Every slider starts at exactly the vanilla value, so anything you don't
touch stays as the game shipped it.

**Global — applies to every weapon at once**

- **Flash Variant** — the shared flash look, texture and tint. Hover a variant
  to preview it before committing. **OFF** disables the muzzle flash and its
  dynamic light entirely.
- **Emissive** — how intensely the flash glows and lights its surroundings.
  Vanilla is 1.
- **Distortion** — the heat-haze at the muzzle. Its size always follows Flash
  Size for the current weapon, so there is no separate size control. On in
  vanilla.
- **Smoking Barrel** — smoke rising from the barrel, with its own size and
  speed.
- **Eject Smoke** — smoke off the ejected shell. On in vanilla.
- **Sparks Emissive** — how bright individual sparks look. This is a shared
  particle rule, so it cannot be set per weapon. Vanilla is 30.
- **Smoke Density** — how much muzzle smoke is spawned. Unlike smoke size and
  opacity, this one is global.

**Tracer — the streak the bullet leaves in the air**

One effect for every weapon, so all of it is global.

- **Colour** — yellow is vanilla, which means no tint at all.
- **Emissive** — how brightly it glows. Vanilla is 100.
- **Size** and **Speed** — ranges, as above.
- **Smoke Trail** — a trail of smoke behind the tracer, with its own size. Off
  in vanilla.

**Per weapon — Pistol / SMG / Rifle / Shotgun & Sniper**

Each tab is independent, and first-person view is synced automatically. Rifle
covers the assault rifle including its alternate flash. Shotgun and Sniper share
one tab.

- **Flash Size** and **Flash Speed** — size of that weapon's flash, and how
  fast its particles travel.
- **Sparks** — on or off for this weapon alone, plus size, speed and how many
  are spawned per shot.
- **Muzzle Smoke** — on or off for this weapon alone, plus size, speed and
  opacity.

Smoke opacity is **relative** to that weapon's own vanilla opacity, because every
weapon starts from a different one. `1.00×` keeps it exactly as it was. On
weapons that already ship near-opaque — the Shotgun is at 100% — values above
`1.00×` can look identical, since alpha cannot go past fully opaque.

**COPY TO** pushes one weapon's settings onto another category, or onto all of
them at once. Global settings are left alone.

**Blood**

- The custom blood-splash texture swaps in automatically whenever it is present.
- Size, speed and count always apply.
- The texture on its own does nothing in-game. It needs the separate **Blood FX**
  mod to trigger it.

**Bullet impacts — per surface**

Brick, concrete, tarmac, car metal and glass each have their own on/off switch
and their own dust-cloud size.

- **Dust** — speed and opacity are adjustable. Density is **shared** across
  brick, car metal, concrete and tarmac, because the vanilla file has no
  per-surface control for it.
- **Debris** — chunk size, how fast they fly, how much is spawned.
- **Metal sparks** — size, speed and count. Car metal covers car bodywork as
  well as plain metal surfaces.
- **Glass** — plume size, speed, opacity and density. Shotgun glass is a
  separate card with its own emitter, because pellets shatter glass differently
  from regular weapons.

### Do I have to use it? Can't I just install the mod?

You can build once with the defaults and never touch a slider. The defaults are
tuned to look good as they are.

The app exists so you're not stuck with someone else's taste.

### Can I save my settings?

Yes — **Save** and **Load** keep your settings as a file, and **Reset** puts
everything back to default.

There are also **community presets** built into the app if you'd rather start from
someone else's look than from scratch.

### Can I share a preset with other people?

Yes. **Community Presets** in the app lets you browse what other owners have
made, and share your own current settings with everyone who owns the tool.

A preset you shared carries a delete button that only you can see — it's yours
to pull back down.

### Windows says the app is unsafe / SmartScreen blocks it

Click **More info**, then **Run anyway**.

The warning is about **signing, not content**. The app isn't signed with a paid
code-signing certificate, and SmartScreen shows this warning for any unsigned
program that hasn't yet been downloaded by a very large number of people. Nothing
was detected in it.

### My antivirus flagged it

Same cause. An unsigned executable that packs and writes archive files looks
unusual to heuristic scanners.

If your antivirus quarantined it, restore it and add an exception for the folder.

### The BUILD button doesn't do anything

**You're running the app from inside the .zip.**

When you double-click an `.exe` inside a zip, Windows extracts that one file to a
temporary folder and nothing else. The `Assets` folder stays behind in the
archive, the app can't find the files it builds from, and the BUILD buttons stay
switched off.

**Fix:** extract the **whole** archive to a normal folder first — your Desktop is
fine — then run the `.exe` from there.

Recent versions say this in red at the bottom of the window when it happens.

### The app says a file is missing from Assets

Same cause as above: the archive wasn't fully extracted, or the `Assets` folder
was moved or deleted afterwards.

Extract the whole archive again into a fresh folder and start the app from there.
Don't move the `.exe` out on its own — it needs that folder sitting next to it.

### I own Blood FX — how do I get it into the configurator?

Put the `blood` folder, with its texture inside, into the configurator's
`Assets` folder. Restart the app afterwards.

The app swaps in a custom blood-splash texture automatically whenever one is
present. The Blood FX mod itself is what triggers it in-game — the texture on
its own does nothing without it.

### Muzzle Core FX isn't behaving properly

The usual cause is a Blood FX file that overlaps with it. Which one depends on
where you play:

- **FiveM** — `ziplocker's spray.rpf` in your `mods` folder. Delete it.
- **Story Mode** — `Ziplocker's_Blood_Body-hit_effects`. Remove it if you
  installed it.

Muzzle Core FX will not work correctly while either is present. This catches
people who installed one earlier and forgot it was there.

### How do I unlock the Flash Collection variants I bought?

For each variant you bought you'll be sent a `v4`, `v5`, `v6` or `v7` folder.
Drop the whole folder into:

  `Assets\Presets\`

Nothing to unpack and nothing to rename — it slots in beside the `v1`, `v2` and
`v3` folders already there. Restart the app afterwards and the PAID badge and
lock icon disappear for that variant on their own.

Variants are sold individually, so owning only one or two is normal. Install the
ones you actually bought.

### Where does the built file go?

Wherever you choose — the app asks you before it starts. When it's finished
there's a **Show in folder** button that takes you straight there.

### How long does a build take?

Roughly half a minute. The progress bar shows which stage it's on.

You can stop a build while it runs — the half-written output file is deleted, so
nothing broken is left behind.

### I bought Flash Collection and it isn't the app

Flash Collection is an **add-on**, not the app. It's four extra flash styles that
go into the `Assets\Presets\` folder of a configurator you already have.

Muzzle Core FX ships with flash variants I–III; Flash Collection adds IV–VII.

If you don't own Muzzle Core FX, Flash Collection has nothing to plug into. Open
a ticket if you bought it by mistake.

---

# 10. Tracer Tool

### What is it?

A free editor for GTA V's bullet tracer — the glowing streak that travels through
the air after a shot. Sliders for colour, glow, size, speed and smoke trail;
builds for both FiveM and Story Mode from the same settings.

### What does it cost?

Nothing. No key, no purchase, no account.

### Where do I get it?

In this Discord, and on **GTA5-Mods**.

### Does it need a licence key?

No. It's free — it runs as soon as you extract it.

### Does it conflict with Muzzle Core FX?

**If you own Muzzle Core FX you don't need the Tracer Tool.** The same tracer
controls — colour, glow, size, speed, smoke trail — are already in the
configurator.

The two **cannot be installed together**: they write the same game files, so
whichever went in last is the one that survives. Build your tracers in the
configurator instead.

### Does it change tracers for every weapon?

Yes. The tracer is one global effect, so a change applies to all weapons at once.
Vehicle and special-weapon tracers are left alone.

### The BUILD button doesn't work / SmartScreen blocks it

Exactly the same causes and fixes as the main configurator — see section 8.

---

# 11. Uninstalling

### FiveM

Delete the file from the `mods` folder. Restart FiveM. Done.

### Story Mode — the easy way

Most Story Mode products ship with an **.oiv uninstaller**. Run it through OpenIV
the same way you ran the installer.

If you made a backup during installation, restoring it also works and is the
cleanest option.

### Story Mode — by hand

If there's no uninstaller and no backup: in OpenIV, open

```
...\Grand Theft Auto V\update\update.rpf\x64\patch\data\effects\
```

and delete `ptfx.rpf`, `ptfx_hi.rpf` and `ptfx_lo.rpf`.

If you installed the game somewhere other than the default location, look there
instead.

### ⚠️ Read this before deleting those files by hand

Those three files are **shared by every effects mod**.

Deleting them removes **any other effects mod you have installed**, not just this
one. If you're running others, restore your backup instead, or be ready to
reinstall them afterwards.

This is the reason the backup step in section 7 is worth taking.

---

# 12. It's not working

### Work through these first

1. **Is the server allowing mods?** Pure Mode blocks everything here. This is the
   most common answer by a wide margin.
2. **Did the files land in the right place?** FiveM needs the `mods` folder;
   Story Mode needs the `.oiv` to have run all the way to completion.
3. **Did you fully restart the game?** Not just rejoin the server.
4. **Did you use a mod manager or auto-installer** — ModsHub or similar? These
   regularly put files in the wrong place or skip them silently. Verify the files
   are actually where they should be before reporting a bug.
5. **Do you have another effects mod installed?** See below.
6. **Are you on Windy Shooting or YBN Shooting?** Those two are known to run
   the mod only partially — their own shooting system overrides part of the
   effect. No other servers have been identified.

### It's not working on FiveM

Three things to check, in this order:

1. **Pure Mode.** A server running it blocks every client mod. Nothing you do
   locally changes that.
2. **The server itself.** **Windy Shooting** and **YBN Shooting** are known to
   run the mod only partially — they have their own shooting system that
   overrides part of the effect. Your files are fine. No other servers have been
   identified doing this, so if you're on a different one and only some of the
   effect appears, name the server when you open a ticket — that's how the list
   grows.
3. **Another mod.** Remove your other effects mods **one at a time**, testing
   after each, until the effect comes back. Whichever removal fixes it is the
   file that was fighting yours.

If none of that does it, open a ticket.

### I have another effects mod and now one of them doesn't work

Effects mods write the same `ptfx` files. Two of them can't both be installed
normally — whichever was installed last wins and the other is simply gone.

Muzzle Core FX and Blood FX are the exception — they coexist as long as you
leave one file out: skip `ziplocker's spray.rpf` on FiveM, or
`Ziplocker's_Blood_Body-hit_effects` on Story Mode.

For anything else, open a ticket and say which mods you're running.

### The effects look wrong / too bright / too dim

That's what the configurator is for — adjust the sliders and rebuild. Emissive
controls glow, and the size and colour controls do what they say.

If it looks wrong in a way that seems broken rather than just not to your taste,
open a ticket with a screenshot.

### My game crashes

Remove the mod and see whether the crash still happens. If it stops, open a
ticket with:

- which product and which version
- FiveM or Story Mode
- what else you have installed
- what you were doing when it crashed

If it crashes without the mod too, it isn't the mod.

### It worked before and stopped after a game update

GTA V updates can replace the files a mod writes to. Reinstall the mod.

For Story Mode, you may need to reinstall to the updated `update.rpf`.

---

# 13. Refunds and billing

### Can I get a refund?

Ask, and it'll be looked at properly.

Refunds are given where there's a **genuine problem** — the mod doesn't work, it
doesn't do what the description said, something is broken and we can't fix it for
you. In those cases you get your money back.

They're not given for **"I changed my mind"** or "I didn't end up using it".
These are digital files that can't be handed back once they're delivered.

Before asking for a refund, open a ticket and describe what's wrong. Most things
people want refunds for turn out to be one of the answers in this FAQ, and take a
couple of minutes to fix.

### I bought the wrong product

Open a ticket and say what you meant to buy. That's a genuine mistake and it gets
sorted out.

### How do I stop being charged?

Cancel in your **lava.top account**, or open a ticket and ask. See section 4.

Cancelling is not a refund — it stops future charges. If you also want the last
charge back, say so and it'll be looked at.

---

# 14. Support

### How do I get help?

Open a ticket. Read the section above that covers your problem first — most
tickets are answered by something already written here, and you'll get moving
faster reading it than waiting for a reply.

### What should I put in a ticket?

The more of this you include, the faster it's done:

- **Which product**, and Story Mode or FiveM
- **The email you used at checkout** (for anything about access, keys or roles)
- **What you did**, step by step
- **What happened**, versus what you expected
- **A screenshot** — of the error, or of what the game looks like

"It doesn't work" needs three rounds of questions before anyone can help. The list
above usually needs none.

### I'm on Premium — do I get faster support?

Yes. Premium has its own ticket queue and is answered ahead of the rest.

### How long until I get an answer?

Usually quickly — within a day at the latest.

Premium tickets are answered ahead of the rest.

You'll get there faster still by including everything in the list above, so the
first reply is the answer rather than a question back.

---

<!--
NOTES FOR DANIL — remove this whole block before publishing.

Two answers are now written in and are promises the text makes on your behalf:

  - Section 2: no server licence. A purchase is one person's.
  - Section 13: an answer within a day, Premium first. That includes weekends,
    because the text doesn't carve them out. If a quiet weekend ever makes that
    awkward, change it to "within a day on weekdays" rather than quietly missing
    it — a stated time you keep is worth more than a shorter one you don't.

Enhanced: the answer is written as a plain "use Legacy, Enhanced is not
supported" rather than "partially works". "Partially works" reads as "works" to
someone who wants it to, and then it's a refund conversation. As written, a
customer who buys anyway did so against a clear warning — which is the difference
between a refund you owe and one you don't.

On chargebacks: I left them out entirely, as you asked. That's a normal thing to
leave out — it's the bank's process, not yours, and nobody advertises it. Two
things worth keeping in mind: if a customer asks you directly whether they can go
through their bank, don't tell them they can't, just say refunds go through you
first. And a chargeback costs you more than a refund does — the payment processor
usually charges a fee on top of the reversed amount — so when a refund is
borderline, granting it is often the cheaper outcome.

Corrections to the old FAQ, applied above:

  - "Every Story Mode product includes an .oiv Uninstaller" wasn't true of Tracer
    Tool, which is removed by hand. Softened to "most", with the manual route
    written out.

  - The shared-ptfx warning is new. Deleting those three files removes other
    people's effects mods too, and the old FAQ never mentioned it.

  - "Drag and drop the files into the correct folder" now names the folder.

Product naming: the old FAQ said "Blood Mod", the store says "Ziplocker's Blood
FX". I used "Blood FX" throughout. Pick one and make the store match, or people
searching for one won't find the other.

Things I wrote from what I know of the products — worth a skim to confirm I got
them right:
  - Flash Collection = variants IV–VII, base product = I–III
  - Failed renewals retry over ~24h before the role is removed
  - Tracer Tool and Muzzle Core FX overwrite each other (both write ptfx)
  - A build takes about half a minute
-->
