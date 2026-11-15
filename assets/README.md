# Card assets

`backgrounds/hoplite-winter.png` is the full-resolution 3840×2160 background supplied by the user. Both layouts use it across the entire page and preserve the normalized house-and-tree focal rectangle.

The renderer uses Minecraft's actual bitmap font, character texture, and item textures from the locally installed Minecraft 1.21.11 client JAR. `npm run cards:assets` prepares the small local asset subset in `assets/minecraft/`; it is ignored by version control. If missing, the renderer prepares it automatically. These assets require the existing Minecraft installation but no running game or server connection.

`preview-stats.txt` is the supplied sample lore, used by `/preview`. Preview cards are marked as sample data.

The Statsify example at https://github.com/Statsify/statsify/blob/main/examples/skywars.png is the layout reference: bitmap text with pixel shadows, Minecraft stat colors, translucent backgrounds, and gridded metrics. Statsify source code is not bundled.
