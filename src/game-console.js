'use strict'
const readline = require('node:readline')
const { EventEmitter } = require('node:events')
const { stripVTControlCharacters } = require('node:util')
const clean = value => stripVTControlCharacters(value).replace(/§[0-9a-fk-orx]/gi, '')

class GameConsole extends EventEmitter {
  constructor (child) {
    super()
    this.child = child
    this.ready = false
    this.closed = false
    this.bridgeReady = false
    this.lastGui = null
    this.readers = [child.stdout, child.stderr].map(stream => {
      const reader = readline.createInterface({ input: stream, crlfDelay: Infinity })
      reader.on('line', line => {
        const prefix = 'HOPLITE_GUI_EVENT '
        if (line.startsWith(prefix)) {
          this.receiveBridgeEvent(line.slice(prefix.length))
          return
        }
        this.emit('output', line)
        const text = clean(line)
        const player = text.match(/Setting user: ([A-Za-z0-9_]+)$/)
        if (player) this.playerName = player[1]
        if (text.includes('Got an error with a html body connecting to https://sessionserver.mojang.com/session/minecraft/join:')) {
          this.connectionError = 'Minecraft’s session service rejected the join request. Wait before reconnecting; check the terminal for details.'
          this.emit('connection-failed', new Error(this.connectionError))
        }
        if (text.includes('Connecting to ')) this.connectionError = null
        if (text.includes('HMC-Specifics initialized!')) { this.ready = true; this.emit('ready') }
        // Game logs carry timestamps; console command results are printed directly.
        if (!/^\[\d\d:\d\d:\d\d\]/.test(text) && !/^\w{3} \d{1,2}, \d{4}/.test(text)) this.emit('line', text)
      })
      return reader
    })
    const close = () => {
      this.closed = true
      this.emit('closed')
      for (const reader of this.readers) reader.close()
    }
    child.once('exit', close)
    child.once('error', close)
  }

  receiveBridgeEvent (json) {
    try {
      const event = JSON.parse(json)
      if (event.protocol !== 1 || !Number.isSafeInteger(event.seq)) throw new Error('Unsupported GUI bridge event.')
      if (event.event === 'ready') { this.bridgeReady = true; this.emit('bridge-ready'); return }
      if (event.event === 'bridge-error') throw new Error(event.message || 'The GUI bridge failed.')
      if (event.event !== 'gui') return
      if (this.lastGui && event.seq <= this.lastGui.seq) return
      if (!Array.isArray(event.slots) || !Array.isArray(event.buttons) || !Array.isArray(event.texts)) throw new Error('Invalid GUI bridge snapshot.')
      const slots = event.slots.map(slot => {
        if (!Number.isSafeInteger(slot.id) || slot.id < 0 || typeof slot.name !== 'string' || typeof slot.tooltip !== 'string') throw new Error('Invalid GUI bridge slot.')
        return { id: slot.id, name: clean(slot.name).trim().replace(/^\[(.*)\]$/, '$1'), tooltip: clean(slot.tooltip) }
      })
      this.lastGui = {
        ...event, slots, screen: event.screen || null,
        texts: event.texts.map(text => clean(String(text))),
        buttons: event.buttons.map(button => ({ ...button, name: clean(String(button.name)) }))
      }
      if (/^[a-f0-9-]{32,36}$/i.test(event.playerUuid || '')) this.playerUuid = event.playerUuid
      this.emit('gui-event', this.lastGui)
    } catch (error) { this.emit('bridge-error', error) }
  }

  async waitForBridge (timeout = 5000) {
    if (this.bridgeReady) return
    if (this.closed) throw new Error('Minecraft has stopped.')
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer)
        this.off('bridge-ready', onReady); this.off('closed', onClosed)
        error ? reject(error) : resolve()
      }
      const onReady = () => finish()
      const onClosed = () => finish(new Error('Minecraft stopped before the GUI bridge became ready.'))
      const timer = setTimeout(() => finish(new Error('GUI event bridge is not loaded. Run npm run mc:build, then restart the Minecraft client.')), timeout)
      this.once('bridge-ready', onReady); this.once('closed', onClosed)
    })
  }

  waitForGui (predicate, { after = 0, timeout = 15000, description = 'the expected menu contents', trigger, detectPrivate = false } = {}) {
    if (this.connectionError) return Promise.reject(new Error(this.connectionError))
    if (this.closed) return Promise.reject(new Error('Minecraft has stopped.'))
    const matches = event => event && event.seq > after && predicate(event)
    if (matches(this.lastGui)) return Promise.resolve(this.lastGui)
    return new Promise((resolve, reject) => {
      const finish = (error, event) => {
        clearTimeout(timer)
        this.off('gui-event', onGui); this.off('closed', onClosed)
        this.off('connection-failed', onError); this.off('bridge-error', onError)
        this.off('output', onOutput)
        error ? reject(error) : resolve(event)
      }
      const onGui = event => { if (matches(event)) finish(null, event) }
      const onClosed = () => finish(new Error('Minecraft stopped while waiting for ' + description + '.'))
      const onOutput = line => {
        if (detectPrivate && clean(line).includes('An unexpected error occurred. Please try again later!')) finish(new Error('Player not found.'))
        if (detectPrivate && clean(line).includes("You cannot view this player's profile due to their privacy settings")) finish(new Error("This player's stats are private."))
      }
      const onError = error => finish(error)
      const timer = setTimeout(() => finish(new Error('Timed out waiting for ' + description + '. Check that the client is in the Hoplite lobby.')), timeout)
      this.on('gui-event', onGui); this.once('closed', onClosed)
      this.once('connection-failed', onError); this.once('bridge-error', onError)
      if (detectPrivate) this.on('output', onOutput)
      try { if (trigger) trigger() } catch (error) { finish(error) }
    })
  }

  send (command) {
    if (this.closed || !this.child.stdin.writable || this.child.stdin.destroyed) throw new Error('Minecraft is not running.')
    if (/[\r\n\0]/.test(command)) throw new Error('Only one console command per line is allowed.')
    this.child.stdin.write(command + '\n')
  }

  async waitUntilReady (timeout = 90000) {
    if (this.ready) return
    if (this.closed) throw new Error('Minecraft has stopped.')
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer)
        this.off('ready', onReady); this.off('closed', onClosed)
        error ? reject(error) : resolve()
      }
      const onReady = () => finish()
      const onClosed = () => finish(new Error('Minecraft stopped before its console became ready.'))
      const timer = setTimeout(() => finish(new Error('Minecraft console did not become ready. Check the terminal.')), timeout)
      this.once('ready', onReady); this.once('closed', onClosed)
    })
  }

}

function formatStats (items) {
  return ['Hoplite Battle Royale Stats', ...items.map(item =>
    `\n[Slot ${item.id}] ${item.name}\n${item.tooltip || '(No tooltip text)'}`)].join('\n')
}

const isResourcePackPrompt = event => event.texts.some(text => text.includes('This server requires the use of a custom resource pack.'))

async function acceptHopliteResourcePack (console) {
  const current = await console.waitForGui(event => event.connected || isResourcePackPrompt(event), { timeout: 60000, description: 'Hoplite to connect or request its resource pack' })
  if (!isResourcePackPrompt(current)) return false
  const proceed = current.buttons.find(button => button.enabled && /^proceed$/i.test(button.name.trim()))
  if (!proceed || !Number.isSafeInteger(proceed.id) || proceed.id < 0) throw new Error('Hoplite requires a resource pack, but its Proceed button was not found.')
  await console.waitForGui(event => event.connected && !event.screen, {
    after: current.seq, timeout: 60000, description: 'the Hoplite resource pack to finish loading',
    trigger: () => console.send(`click ${proceed.id}`)
  })
  return true
}

const selectorTasks = new WeakMap()
function battleRoyaleDestination (event) {
  if (!event?.inventoryReady) return null
  return event.slots.find(slot => /\bbattle royale\b/i.test(slot.name + '\n' + slot.tooltip) &&
    /click to connect/i.test(slot.tooltip))
}
function joinBattleRoyale (console, timeout = 30000) {
  if (selectorTasks.has(console)) return selectorTasks.get(console)
  const slot = battleRoyaleDestination(console.lastGui)
  if (!slot) return Promise.resolve(false)
  const task = console.waitForGui(event => event.connected && !event.screen, {
    after: console.lastGui.seq, timeout, description: 'the Battle Royale selector to finish connecting',
    trigger: () => console.send(`click ${slot.id}`)
  }).then(() => true)
  selectorTasks.set(console, task)
  task.finally(() => selectorTasks.delete(console)).catch(() => {})
  return task
}
function autoJoinBattleRoyale (console) {
  console.on('gui-event', event => {
    if (battleRoyaleDestination(event)) joinBattleRoyale(console).catch(error => console.emit('output', 'Battle Royale connection: ' + error.message))
  })
}

const requiredCategories = ['Solo', 'Civilization', 'Overall', 'Miner', 'Warrior', 'Trapper', 'Archer', 'Looter', 'Fisherman']
function completeStatsMenu (event) {
  if (!event.inventoryReady) return false
  return requiredCategories.every(name => {
    const slot = event.slots.find(slot => slot.name.toLowerCase() === (name + ' Stats').toLowerCase())
    const fields = ['Solo', 'Civilization', 'Overall'].includes(name)
      ? ['Games Played', 'Wins', 'Kills', 'Assists', 'Playtime']
      : ['Wins', 'Losses', 'Kills', 'Deaths', 'Assists', 'Playtime']
    return slot && fields.every(field => slot.tooltip.split('\n').some(line => line.startsWith(field + ':')))
  })
}

async function readBattleRoyaleStats (console, { timeout = 15000, statsOnly = false, player } = {}) {
  if (player != null && !/^[A-Za-z0-9_]{1,16}$/.test(player)) throw new Error('Enter a valid Minecraft username (1–16 letters, numbers, or underscores).')
  await console.waitUntilReady()
  await console.waitForBridge()
  if (console.connectionError) throw new Error(console.connectionError)
  await acceptHopliteResourcePack(console)
  await joinBattleRoyale(console)
  if (console.lastGui.screen) {
    await console.waitForGui(event => !event.screen, {
      after: console.lastGui.seq, timeout, description: 'the previous menu to close', trigger: () => console.send('close')
    })
  }
  const selectionMenu = await console.waitForGui(event => event.inventoryReady && event.slots.some(slot => /^battle royale stats$/i.test(slot.name)),
    { after: console.lastGui.seq, timeout, description: 'the Battle Royale Stats selection item', detectPrivate: true, trigger: () => console.send(player ? `/stats ${player}` : '/stats') })
  const selection = selectionMenu.slots.find(slot => /^battle royale stats$/i.test(slot.name))
  // One immutable JSON snapshot contains all lore, captured on Minecraft's main thread.
  const snapshot = await console.waitForGui(completeStatsMenu, {
    after: selectionMenu.seq, timeout, description: 'all nine Battle Royale stat categories and their lore', detectPrivate: true,
    trigger: () => console.send(`click ${selection.id}`)
  })
  const items = snapshot.slots.filter(item => /\bstats\b/i.test(statsOnly ? item.name : item.name + '\n' + item.tooltip))
  return { items, text: formatStats(items) }
}

function settleDuelsMenu (console, initial, { timeout = 15000, quiet = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    let latest = initial
    let quietTimer
    const finish = error => {
      clearTimeout(quietTimer)
      clearTimeout(deadline)
      console.off('gui-event', onGui)
      console.off('closed', onClosed)
      console.off('bridge-error', finish)
      error ? reject(error) : resolve(latest)
    }
    const reset = () => {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(() => finish(), quiet)
    }
    const onClosed = () => finish(new Error('Minecraft stopped while collecting Duels lore.'))
    const onGui = event => {
      if (event.generation !== initial.generation || !event.screen) {
        finish(new Error('Duels menu changed while collecting lore.'))
        return
      }
      latest = event
      reset()
    }
    const deadline = setTimeout(() => finish(new Error('Duels menu did not finish updating. Try again.')), timeout)
    console.on('gui-event', onGui)
    console.once('closed', onClosed)
    console.once('bridge-error', finish)
    reset()
  })
}

async function readDuelsStats (console, { timeout = 15000, player } = {}) {
  if (player != null && !/^[A-Za-z0-9_]{1,16}$/.test(player)) throw new Error('Enter a valid Minecraft username.')
  await console.waitUntilReady()
  await console.waitForBridge()
  await acceptHopliteResourcePack(console)
  await joinBattleRoyale(console)
  if (console.lastGui.screen) {
    await console.waitForGui(event => !event.screen, {
      after: console.lastGui.seq, timeout, trigger: () => console.send('close')
    })
  }
  const menu = await console.waitForGui(event => event.inventoryReady && event.slots.some(slot => /^duels(?: stats)?$/i.test(slot.name)), {
    after: console.lastGui.seq, timeout, description: 'the Duels selection item', detectPrivate: true,
    trigger: () => console.send(player ? `/stats ${player}` : '/stats')
  })
  const selection = menu.slots.find(slot => /^duels(?: stats)?$/i.test(slot.name))
  let snapshot = await console.waitForGui(event => event.inventoryReady && event.generation !== menu.generation && event.slots.some(slot => /(?:Wins|Games Played|Kills):/.test(slot.tooltip)), {
    after: menu.seq, timeout, description: 'the populated Duels menu', detectPrivate: true,
    trigger: () => console.send(`click ${selection.id}`)
  })
  // Unknown Duels layout: collect updates until the menu has stopped changing.
  // This observes local events only; it sends no additional clicks or queries.
  snapshot = await settleDuelsMenu(console, snapshot, { timeout })
  const items = snapshot.slots.filter(slot => slot.tooltip.trim())
  return { title: snapshot.title, items, text: ['Hoplite Duels Stats', ...items.map(item => `\n[Slot ${item.id}] ${item.name}\n${item.tooltip}`)].join('\n') }
}

module.exports = { settleDuelsMenu, readDuelsStats, GameConsole, clean, readBattleRoyaleStats, formatStats, acceptHopliteResourcePack, completeStatsMenu, autoJoinBattleRoyale, joinBattleRoyale }
