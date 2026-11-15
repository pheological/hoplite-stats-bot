'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const destination = path.join(root, 'assets/minecraft')
const entries = {
  'font.json': 'assets/minecraft/font/include/default.json',
  'ascii.png': 'assets/minecraft/textures/font/ascii.png',
  'nonlatin_european.png': 'assets/minecraft/textures/font/nonlatin_european.png',
  'accented.png': 'assets/minecraft/textures/font/accented.png',
  'steve.png': 'assets/minecraft/textures/entity/player/wide/steve.png',
  'miner.png': 'assets/minecraft/textures/item/iron_pickaxe.png',
  'warrior.png': 'assets/minecraft/textures/item/iron_sword.png',
  'trapper.png': 'assets/minecraft/textures/item/string.png',
  'archer.png': 'assets/minecraft/textures/item/bow.png',
  'looter.png': 'assets/minecraft/textures/item/chest_minecart.png',
  'fisherman.png': 'assets/minecraft/textures/item/fishing_rod.png',
  'diamond.png': 'assets/minecraft/textures/item/diamond.png'
}
function prepareCardAssets () {
  if (Object.keys(entries).every(name => fs.existsSync(path.join(destination, name)))) return destination
  const dir = path.join(root, '.headlessmc/game/.fabric/remappedJars')
  const version = fs.existsSync(dir) ? fs.readdirSync(dir).find(name => name.startsWith('minecraft-1.21.11-')) : null
  const jar = version && path.join(dir, version, 'client-intermediary.jar')
  if (!jar || !fs.existsSync(jar)) throw new Error('Minecraft card assets are missing. Launch the installed Fabric 1.21.11 client once, then run npm run cards:assets.')
  fs.mkdirSync(destination, { recursive: true })
  for (const [name, entry] of Object.entries(entries)) {
    const result = spawnSync('unzip', ['-p', jar, entry], { maxBuffer: 4 * 1024 * 1024 })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Could not read Minecraft asset ${entry}: ${result.stderr}`)
    fs.writeFileSync(path.join(destination, name), result.stdout)
  }
  return destination
}
module.exports = { prepareCardAssets }
if (require.main === module) console.log('Prepared Minecraft bitmap font and item textures:', prepareCardAssets())
