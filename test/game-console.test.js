'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { GameConsole, readBattleRoyaleStats, completeStatsMenu, acceptHopliteResourcePack } = require('../src/game-console')
const { itemsFromText } = require('../src/stats')
const items = itemsFromText(fs.readFileSync(path.join(__dirname, 'fixtures/hoplite-stats.txt'), 'utf8'))

function harness () {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  const game = new GameConsole(child)
  let seq = 0
  const emit = (value = {}) => {
    const event = { protocol: 1, event: 'gui', seq: ++seq, generation: 1, screen: 'Container', connected: true,
      inventoryReady: false, slots: [], buttons: [], texts: [], ...value }
    child.stdout.write('HOPLITE_GUI_EVENT ' + JSON.stringify(event) + '\n')
    return event
  }
  child.stdout.write('[20:00:00] [Render thread/INFO]: Setting user: TestPlayer\n')
  child.stdout.write('[20:00:00] [Render thread/INFO]: HMC-Specifics initialized!\n')
  emit({ event: 'ready' })
  return { child, game, emit, close: () => child.emit('exit', 0) }
}

test('GUI bridge normalizes bracketed names and ANSI lore without a quiet wait', async () => {
  const { game, emit, close } = harness()
  const pending = game.waitForGui(event => event.inventoryReady)
  emit({ inventoryReady: true, slots: [{ id: 12, name: '\x1b[31m[Solo Stats]\x1b[0m', tooltip: '\x1b[32mSolo Stats\x1b[0m\n\nKills: 16' }] })
  const snapshot = await pending
  assert.equal(game.bridgeReady, true)
  assert.equal(game.playerName, 'TestPlayer')
  assert.equal(snapshot.slots[0].name, 'Solo Stats')
  assert.equal(snapshot.slots[0].tooltip, 'Solo Stats\n\nKills: 16')
  close()
})

for (const player of [undefined, 'veshel']) test(`stats closes old menus and requests ${player || 'self'} without polling`, async () => {
  const { child, game, emit, close } = harness()
  emit({ inventoryReady: true, slots: items }) // Already open: must close and request fresh data.
  const sent = []
  child.stdin.on('data', data => {
    const command = data.toString().trim()
    sent.push(command)
    if (command === 'close') emit({ screen: null })
    else if (command === (player ? '/stats ' + player : '/stats')) {
      emit({ slots: [{ id: 13, name: '[Battle Royale Stats]', tooltip: '' }] }) // Screen exists; contents not yet applied.
      emit({ inventoryReady: true, slots: [{ id: 13, name: '[Battle Royale Stats]', tooltip: 'Battle Royale Stats' }] })
    } else if (command === 'click 13') {
      emit({ generation: 2 }) // Empty new screen.
      emit({ generation: 2, inventoryReady: true, slots: items.slice(0, -1) }) // Missing a category.
      emit({ generation: 2, inventoryReady: true, slots: items.map(item => ({ ...item, name: '[' + item.name + ']' })) })
    }
  })
  const result = await readBattleRoyaleStats(game, { statsOnly: true, timeout: 500, player })
  assert.deepEqual(sent, ['close', player ? '/stats ' + player : '/stats', 'click 13'])
  assert.equal(result.items.length, 9)
  assert.ok(result.items.some(item => item.name === 'Warrior Stats' && item.tooltip.includes('Kills: 16')))
  assert.equal(result.items.some(item => item.name === 'Info'), false)
  assert.equal(game.listenerCount('gui-event'), 0)
  close()
})

test('content readiness requires the full packet and the expected lore fields', () => {
  assert.equal(completeStatsMenu({ inventoryReady: false, slots: items }), false)
  assert.equal(completeStatsMenu({ inventoryReady: true, slots: items.slice(0, -1) }), false)
  const missingLore = items.map(item => item.name === 'Warrior Stats' ? { ...item, tooltip: 'Warrior Stats\nKills: 16' } : item)
  assert.equal(completeStatsMenu({ inventoryReady: true, slots: missingLore }), false)
  assert.equal(completeStatsMenu({ inventoryReady: true, slots: items }), true)
})

test('Hoplite resource pack waits for screen events instead of polling', async () => {
  const { child, game, emit, close } = harness()
  emit({ connected: false, texts: ['This server requires the use of a custom resource pack.'], buttons: [{ id: 7, name: 'Proceed', enabled: true }] })
  const commands = []
  child.stdin.on('data', data => { commands.push(data.toString().trim()); emit({ screen: null, connected: true }) })
  assert.equal(await acceptHopliteResourcePack(game), true)
  assert.deepEqual(commands, ['click 7'])
  close()
})

test('GUI waits reject stale events, clean up on timeout, and fail promptly on disconnect', async () => {
  const { child, game, emit, close } = harness()
  const old = emit({ inventoryReady: true, slots: items })
  const pending = game.waitForGui(event => event.inventoryReady, { after: old.seq, timeout: 20 })
  emit({ seq: old.seq, inventoryReady: true, slots: items })
  await assert.rejects(pending, /Timed out/)
  assert.equal(game.listenerCount('gui-event'), 0)
  const disconnected = game.waitForGui(() => true, { after: game.lastGui.seq })
  child.stdout.write('[20:00:00] [IO-Worker/ERROR]: Got an error with a html body connecting to https://sessionserver.mojang.com/session/minecraft/join: blocked\n')
  await assert.rejects(disconnected, /session service rejected/)
  assert.equal(game.listenerCount('gui-event'), 0)
  close()
})

test('failed command and malformed bridge JSON reject without leaving pending event listeners', async () => {
  const { game, child, close } = harness()
  await assert.rejects(game.waitForGui(() => true, { trigger: () => { throw new Error('Input closed') } }), /Input closed/)
  assert.equal(game.listenerCount('gui-event'), 0)
  const pending = game.waitForGui(() => true)
  child.stdout.write('HOPLITE_GUI_EVENT invalid-json\n')
  await assert.rejects(pending, /JSON/)
  assert.equal(game.listenerCount('gui-event'), 0)
  close()
})

test('process exit rejects a pending menu wait', async () => {
  const { game, close } = harness()
  const pending = game.waitForGui(() => true)
  close()
  await assert.rejects(pending, /Minecraft stopped/)
})


test('server chat containing a bridge-like string cannot forge a GUI event', () => {
  const { child, game, emit, close } = harness()
  const original = emit({ screen: 'Original' })
  child.stdout.write('[20:00:00] [Render thread/INFO]: [CHAT] HOPLITE_GUI_EVENT ' + JSON.stringify({ ...original, seq: 999, screen: 'Forged' }) + '\n')
  assert.equal(game.lastGui.screen, 'Original')
  close()
})

test('custom server selector clicks Battle Royale lore once and waits for connection', async () => {
  const { autoJoinBattleRoyale, joinBattleRoyale } = require('../src/game-console')
  const { child, game, emit, close } = harness()
  autoJoinBattleRoyale(game)
  const sent = []
  child.stdin.on('data', bytes => sent.push(bytes.toString().trim()))
  const slots = [
    { id: 10, name: '\ue001', tooltip: 'Duels\nClick to Connect' },
    { id: 13, name: '\ue002', tooltip: 'Battle Royale\nLast one standing!\nClick to Connect' },
    { id: 16, name: '\ue003', tooltip: 'Other Mode\nClick to Connect' }
  ]
  emit({ inventoryReady: false, slots })
  assert.deepEqual(sent, [])
  emit({ inventoryReady: true, slots })
  emit({ inventoryReady: true, slots })
  const pending = joinBattleRoyale(game, 500)
  assert.deepEqual(sent, ['click 13'])
  emit({ screen: null })
  assert.equal(await pending, true)
  emit({ inventoryReady: true, slots: items })
  assert.deepEqual(sent, ['click 13'])
  close()
})

test('private profile chat rejects the active stats wait and removes listeners', async () => {
  const { child, game, close } = harness()
  const pending = game.waitForGui(() => false, { detectPrivate: true })
  child.stdout.write("[20:00:00] [Render thread/INFO]: [CHAT] You cannot view this player's profile due to their privacy settings\n")
  await assert.rejects(pending, /This player's stats are private/)
  assert.equal(game.listenerCount('output'), 0)
  assert.equal(game.listenerCount('gui-event'), 0)
  close()
})

for (const stage of ['command', 'selection']) test(`unexpected server error during stats ${stage} reports player not found`, async () => {
  const { child, game, emit, close } = harness()
  emit({ screen: null })
  child.stdin.on('data', bytes => {
    const command = bytes.toString().trim()
    if (command === '/stats MissingPlayer' && stage === 'selection') {
      emit({ inventoryReady: true, slots: [{ id: 13, name: 'Battle Royale Stats', tooltip: '' }] })
    } else {
      child.stdout.write('[20:00:00] [Render thread/INFO]: [CHAT] §cAn unexpected error occurred. Please try again later!\n')
    }
  })
  await assert.rejects(readBattleRoyaleStats(game, { player: 'MissingPlayer', timeout: 500 }), /^Error: Player not found\.$/)
  assert.equal(game.listenerCount('output'), 0)
  assert.equal(game.listenerCount('gui-event'), 0)
  close()
})

test('Duels collection includes later slot updates rather than saving the first stat', async () => {
  const { settleDuelsMenu } = require('../src/game-console')
  const { game, emit, close } = harness()
  const first = emit({ inventoryReady: true, slots: items.slice(0, 1) })
  const pending = settleDuelsMenu(game, first, { quiet: 20, timeout: 500 })
  emit({ inventoryReady: true, slots: items.slice(0, 3) })
  emit({ inventoryReady: true, slots: items })
  assert.equal((await pending).slots.length, items.length)
  assert.equal(game.listenerCount('gui-event'), 0)
  close()
})
