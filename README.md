# Discord-controlled headless Minecraft

Runs Minecraft Java **1.21.11** through **HeadlessMc 3.0.0-RC8**, Fabric, HMC-Specifics 3.0.1, and a small local GUI event bridge. The server is `hoplite.gg`.

## Run

The launcher, Minecraft instance, and both mods are installed in this workspace. Java 25+ runs HeadlessMc; Node.js 22+ runs the Discord bot. Minecraft uses a separately downloaded Java 21 runtime.

1. Run `npm run mc:login` and complete Microsoft sign-in if you haven't already.
2. Fill in `.env` with the bot token, Discord server ID, and your Discord user ID. `.env.example` shows the required names.
3. Install your Discord application into your server with the `bot` and `applications.commands` scopes. No privileged intents or Administrator permission are needed.
4. Run `npm start`, then `/mc start` in Discord.
5. Use `/stats` after connecting. It can accept Hoplite's required resource-pack prompt if that is still open.

Only the configured Discord owner can control Minecraft. Stats are available through personal and server installs, and stats replies are public. Keep the terminal running. Microsoft sign-in prompts and server chat remain local.

After a JavaScript change, restart `npm start`. After a mod change, run `npm run mc:build` and restart Minecraft too. The GUI bridge for this change is already compiled and installed.

## Commands

| Discord command | Action |
| --- | --- |
| `/mc start` | Launch 1.21.11 and join Hoplite |
| `/mc stop` | Quit Minecraft |
| `/mc status` | Show launcher process status |
| `/mc connect` | Connect to Hoplite |
| `/mc disconnect` | Leave Hoplite, keeping Minecraft running |
| `/mc chat text:hello` | Send Minecraft chat |
| `/mc command text:help` | Send a server command |
| `/stats` or `/mc stats` | Show Overall or kit image cards with raw lore attached |

`npm run mc:start` launches Minecraft directly without Discord. `npm run mc:shell` opens the HeadlessMc launcher shell. The HMC-Specifics game console supports `. hello`, `/help`, `gui`, `disconnect`, and `quit`.

## Event-based stats flow

The companion mod publishes structured screen and inventory updates after vanilla Minecraft applies them. Node listens to those events instead of polling the `gui` command.

Each stats request:

1. Closes an existing menu and waits for the screen-close event.
2. Sends `/stats` and waits for a populated menu containing Battle Royale Stats.
3. Clicks that named item and waits for all nine expected stat categories and their lore fields.
4. Renders the snapshot as an Overall card (Overall, Solo, Civ) or a Kit stats card, sent as a PNG attachment.

There are no fixed sleeps, repeated GUI queries, tooltip commands, or per-item waits in the stats path. Timers are failure deadlines only. Server latency, Minecraft startup, authentication, and resource-pack loading still take time.

The companion mod observes local state; it does not send extra server packets to read lore. HMC-Specifics still performs chat commands, menu close, and the normal menu click. The stats menu remains open after a successful read and is closed on the next request.

## Stats calculations

Winrate and ratios use two decimals; durations use DD:HH:MM:SS. Mode losses are calculated as games minus wins if omitted. Overall deaths are summed from all six classes only when every class is available and their kills agree with the Overall book. Solo deaths are inferred from Solo losses. Civ deaths are total deaths minus Solo deaths when both death counts are available and subtraction is nonnegative; Civ K/D is kills divided by those estimated deaths. Unavailable or inconsistent totals remain unavailable. ∞ indicates a positive count divided by zero; 0/0 follows Hoplite's displayed zero convention.

`output/hoplite-stats.json` contains sample structured data. The raw dump is `output/hoplite-battle-royale-stats.txt`. Run `npm run cards:preview` for sample PNGs of Overall and All Kits in `output/cards/`.

## Build and verify

```sh
npm run mc:build
npm run check
npm test
```

The mod sources and build notes are in [mod/README.md](mod/README.md). Build with JDK 21 or newer. JavaScript event-flow tests cover partial contents, stale events, menu closing, resource-pack acceptance, failures, and the full stats workflow.

## Local files

`.headlessmc/` contains the isolated game, mods, logs, and authentication data. `.env`, `.headlessmc/`, `.auth/`, `mod/build/`, `output/`, and downloaded JARs are ignored by version control. Old Mineflayer tokens in `.auth/` are unused. The normal Minecraft installation is not used.

For a fresh installation, run `npm ci`, download [HeadlessMc](https://github.com/headlesshq/headlessmc/releases/download/3.0.0-RC8/headlessmc.jar) to `tools/headlessmc.jar`, and [HMC-Specifics 1.21.11](https://github.com/headlesshq/hmc-specifics/releases/download/1.21.11-3.0.1/hmc-specifics-1.21.11-fabric-3.0.1.jar) to `tools/hmc-specifics-1.21.11.jar`. Run `node src/headless.js install fabric 1.21.11`, copy the specifics JAR to `.headlessmc/game/mods/`, and launch the Fabric instance once to produce its intermediary JAR. Then run `npm run mc:build`. The first launch before building the companion is only for installation; Discord stats requires the bridge.

Set these game options for headless operation:

```text
pauseOnLostFocus:false
onboardAccessibility:false
narrator:0
```

Upstream: [HeadlessMc launching](https://headlesshq.github.io/headlessmc/launch/), [HMC-Specifics controls](https://headlesshq.github.io/headlessmc/specifics/).

## Minecraft heap limit

Both `/mc start` and `npm run mc:start` now pass `-Xms256M -Xmx1G` to the Minecraft JVM. This sets a 256MiB initial heap and a 1GiB maximum heap. Total process memory is higher because threads, native buffers, and other JVM memory are outside the heap; HeadlessMc, Node, and the operating system also need memory. Explicit `--jvm` arguments to the wrapper override these defaults. Restart Minecraft after loading this change.

## Minecraft-style image views

`/stats` shows Overall (Overall / Solo / Civilization). `/stats view:kits` shows all six kits on one page. `/mc stats` has the same view option. The Show kit stats / Show overall stats button switches between the two pages, using the fetched snapshot without additional Minecraft actions.

`/preview` shows both pages from bundled sample data. It works with Minecraft stopped. `/preview view:overall` and `/preview view:kits` show a single page. All previews are marked as sample data and retain the configured owner restriction.

Cards use Minecraft's real bitmap font, pixel shadows, player/item textures, the Minecraft color palette, and translucent stat grids over the full supplied background. Both crops preserve the house and tree. Both pages render at 1440×1032 with identical headers. Discord receives one lossless PNG attachment per stats page, without a raw slot-data attachment. This follows the visual treatment in [Statsify's example](https://github.com/Statsify/statsify/blob/main/examples/skywars.png).

`npm run cards:assets` extracts the needed textures and font metadata from the locally installed game. Missing assets are prepared automatically; a running game is not required. `npm run cards:preview` writes the two sample PNGs to `output/cards/overall.png` and `output/cards/kits.png`.

Rendering uses `@napi-rs/canvas`, local Minecraft assets, and an upper-body skin render from `skins.mcstats.com/bust/<uuid>`. The mod supplies the authenticated player UUID. Skin images are cached for one hour in `.headlessmc/skin-cache`, with shared requests across both pages. If the service fails, a cached skin or local Steve upper body is used; requests time out after 2.5 seconds. Snapshots expire after five minutes and at most ten are cached. `npm ci` installs the native renderer for the machine where the bot runs. Restart the Node bot to register `/preview` and the updated view options; run `npm run mc:build` and restart Minecraft to load the player UUID bridge update.

Use `/stats player:veshel` (or `/mc stats player:veshel`) to query another player through Hoplite’s `/stats <player>` menu. Omit `player` for the connected account. The selected player’s public Mojang profile supplies their UUID for MCStats skin rendering; lookups are cached and failures use the local skin fallback. Anyone with the app installed personally or in their server can use stats, previews, and page buttons. Minecraft controls remain owner-only. Playtime values with days omit seconds.


To enable personal and server installs, open the Discord Developer Portal application’s Installation page and enable both **User Install** and **Guild Install**. Select **Discord Provided Link**. Set User Install scopes to `applications.commands`; set Guild Install scopes to `applications.commands` and `bot`. Enable Public Bot on the Bot page so other people can add it to servers. Share the installation link from that page. Commands register globally on bot startup for servers, bot DMs, and private channels. Discord channel permissions still apply. `DISCORD_GUILD_ID` is optional and only used to remove the previous server’s legacy commands.

## Current startup and commands

`npm start` now launches Minecraft and connects to Hoplite automatically. Stop the old bot and its Minecraft client before restarting. Discord exposes `/stats` (Battle Royale), `/battle royale`, `/duels`, and `/preview`; the `view` option and `/mc` commands have been removed. Existing global `/mc` commands are deleted during registration. Page selection remains inside stats replies. Stop the terminal process with Ctrl+C to shut down both the bot and Minecraft.
