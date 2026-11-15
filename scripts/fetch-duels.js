'use strict'
const fs = require('node:fs/promises')
const { parseDuelsStats } = require('../src/stats')
const { start } = require('../src/headless')
const { GameConsole, readDuelsStats } = require('../src/game-console')
async function main () {
  const child = start(['launch', '--headless', '--server=hoplite.gg', 'fabric', '1.21.11'], ['pipe', 'pipe', 'pipe'])
  const game = new GameConsole(child)
  const log = require('node:fs').createWriteStream('output/duels-fetch.log', { mode: 0o600 })
  game.on('output', line => log.write(line + '\n'))
  try {
    const result = await readDuelsStats(game)
    result.groups = parseDuelsStats(result.items)
    await fs.mkdir('output', { recursive: true })
    await fs.writeFile('output/hoplite-duels-stats.json', JSON.stringify(result, null, 2) + '\n')
    await fs.writeFile('output/hoplite-duels-stats.txt', result.text + '\n')
    console.log(result.text)
  } finally {
    if (!game.closed) game.send('quit')
    setTimeout(() => child.kill('SIGTERM'), 5000).unref()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
