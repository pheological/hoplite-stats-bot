'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { parseStats, itemsFromText } = require('../src/stats')
const { renderStatsCard, kits } = require('../src/stat-card')
async function main () {
  const root = path.resolve(__dirname, '..')
  const data = parseStats(itemsFromText(fs.readFileSync(path.join(root, 'assets/preview-stats.txt'), 'utf8')))
  const dir = path.join(root, 'output/cards')
  fs.mkdirSync(dir, { recursive: true })
  for (const name of kits) {
    const old = path.join(dir, name.toLowerCase() + '.png')
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }
  for (const view of ['overall', 'kits']) {
    const result = await renderStatsCard(data, { playerName: 'VALPORATE', playerUuid: require('../assets/preview-profile.json').id, view, preview: true, timestamp: new Date('2026-10-23T03:20:00Z') })
    fs.writeFileSync(path.join(dir, `${view}.png`), result.buffer)
    console.log(`${view}: ${result.width} × ${result.height}, ${Math.round(result.buffer.length / 1024)} KiB`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
