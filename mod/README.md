# GUI event bridge (Minecraft 1.21.11)

A client-only Fabric companion to HMC-Specifics. It has no network listener, authentication code, or gameplay packet modifications. It writes one JSON frame per observed GUI update to process stdout, prefixed `HOPLITE_GUI_EVENT `. Node consumes these frames without printing them in the chat terminal.

`ScreenMixin` observes the end of `MinecraftClient.setScreen`. `InventoryMixin` observes the end of the full inventory packet handler and individual slot-update handler. These callbacks run after vanilla has applied the packet on the client thread. They inspect the current screen, container sync ID, menu items, and full tooltips through HMC-Specifics. Player inventory slots and stale packets for another container are excluded.

A screen-open snapshot is not marked ready. A matching full inventory packet marks that screen generation ready; subsequent slot updates publish fresh snapshots. Node additionally requires the specific nine categories and their relevant lore keys before treating the Battle Royale menu as populated. Changing a screen resets readiness. This is a content check, not a claim that a server can never send another update.

Frames include a protocol version, monotonically increasing sequence number, screen generation, sync ID, readiness, screen title, connection state, buttons, and all named menu items with full lore. The format is local IPC; it is not sent to Hoplite or Discord.

## Build

Run `npm run mc:build` from the project root using JDK 21+. The build uses the already-installed client intermediary JAR, Fabric Loader, Mixin, Minecraft libraries, and HMC-Specifics. It does not download or redistribute Minecraft. The source uses Minecraft's intermediary identifiers directly to match the installed 1.21.11 runtime; comments identify their named equivalents. Mixin remapping and annotation processing are disabled because these sources already target intermediary names.

The output is installed at `.headlessmc/game/mods/hoplite-gui-bridge.jar`. Restart Minecraft to load it. HeadlessMc does not hot-load mods. Fabric Loader 0.19.5 and Minecraft 1.21.11 are the verified build targets; other Minecraft versions require updating the mappings and hooks.

The Mixins are required (`defaultRequire: 1`), so an incompatible method hook fails startup visibly instead of silently returning stale data. The metadata requires HMC-Specifics 3.0.1 or newer.
