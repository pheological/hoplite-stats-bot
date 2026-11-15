'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const sdk = require('discord.js')
const stats = require('../src/stats')
const { StatsUI } = require('../src/stats-ui')

test('top-level /stats and /mc stats return image attachments, defer during the read, allow guild stats while restricting Minecraft controls', async () => {
  let discord, reads = 0, now = 10000, requestedPlayer, renderedName
  const owner = '223456789012345678', guild = '123456789012345678'
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures/hoplite-stats.txt'), 'utf8')
  class FakeClient extends EventEmitter {
    constructor () { super(); discord = this }
    login () { return Promise.resolve() }
  }
  const fakeProcess = { env: { DISCORD_TOKEN: 'test', DISCORD_OWNER_ID: owner, DISCORD_GUILD_ID: guild }, on () {}, stdout: new PassThrough(), stderr: new PassThrough(), exit () { throw new Error('Unexpected exit') } }
  const context = {
    require (name) {
      if (name === 'discord.js') return { ...sdk, Client: FakeClient }
      if (name === './player-skin') return { playerSkins: { resolveProfile: async name => ({ id: '0123456789abcdef0123456789abcdef', name: name.toUpperCase() }), get: async () => null } }
      if (name === './stats') return stats
      if (name === './stats-ui') return { StatsUI: class extends StatsUI { constructor () { super({ render: async (data, options) => { renderedName = options.playerName; return { buffer: Buffer.from('test-image') } } }) } } }
      if (name === './headless') return { start: () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }) }
      if (name === './game-console') return {
        readDuelsStats: async () => ({ text: '', items: require('../assets/preview-duels.json').items }),
        autoJoinBattleRoyale () {},
        GameConsole: class extends EventEmitter { constructor () { super(); this.playerName = 'TestPlayer' } },
        readBattleRoyaleStats: async (game, options) => { requestedPlayer = options.player; reads++; return { text: raw, items: stats.itemsFromText(raw) } }
      }
      throw new Error(name)
    },
    Buffer, process: fakeProcess, console: { log () {}, error () {} }, Date: { now: () => now }, setTimeout
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/client.js'), 'utf8'), context)
  async function invoke (name, action, user = owner, view = null, player = null, targetGuild = guild) {
    now += 2000
    const result = { deferred: false, payload: null }
    const interaction = {
      commandName: name, guildId: targetGuild, user: { id: user }, replied: false, deferred: false,
      isChatInputCommand: () => true, options: { getSubcommand: () => action, getString: key => key === 'player' ? player : view },
      reply: async payload => { result.payload = payload },
      deferReply: async () => { result.deferred = true; interaction.deferred = true },
      editReply: async payload => { result.payload = payload }
    }
    await discord.listeners('interactionCreate')[0](interaction)
    return result
  }
  const preview = await invoke('preview', undefined, '323456789012345678')
  assert.equal(preview.payload.embeds.length, 0)
  assert.equal(reads, 0)
  assert.equal(preview.payload.files.length, 1)
  for (const [name, action] of [['battle', 'royale'], ['stats', undefined]]) {
    const result = await invoke(name, action, '323456789012345678')
    assert.equal(result.deferred, true)
    assert.equal(result.payload.embeds.length, 0)
    assert.equal(result.payload.files.length, 1)
    assert.equal(result.payload.files[0].name, 'hoplite-overall.png')
    const menu = result.payload.components[0].toJSON().components[0]
    assert.equal(menu.label, 'Show kit stats')
    let changed
    const selection = {
      isButton: () => true, customId: menu.custom_id,
      guildId: guild, user: { id: owner }, deferred: false,
      deferUpdate: async () => { selection.deferred = true }, editReply: async payload => { changed = payload }
    }
    const before = reads
    let deniedComponent
    await discord.listeners('interactionCreate')[0]({ ...selection, user: { id: '323456789012345678' }, reply: async payload => { deniedComponent = payload } })
    assert.equal(deniedComponent, undefined)
    assert.equal(changed.files[0].name, 'hoplite-kits.png')
    assert.equal(reads, before)
    await discord.listeners('interactionCreate')[0](selection)
    assert.equal(reads, before)
    assert.equal(changed.files[0].name, 'hoplite-kits.png')
    assert.equal(changed.attachments.length, 0)
    const back = changed.components[0].toJSON().components[0]
    assert.equal(back.label, 'Show overall stats')
    await discord.listeners('interactionCreate')[0]({ ...selection, customId: back.custom_id })
    assert.equal(changed.files[0].name, 'hoplite-overall.png')
    assert.equal(reads, before)
  }
  const dmPreview = await invoke('preview', undefined, owner, null, null, null)
  assert.equal(dmPreview.payload.files.length, 1)
  const direct = await invoke('battle', 'royale', owner, 'kits')
  assert.equal(direct.payload.files[0].name, 'hoplite-overall.png')
  assert.equal(reads, 3)
  const other = await invoke('battle', 'royale', owner, null, 'veshel')
  assert.equal(requestedPlayer, 'veshel')
  assert.equal(renderedName, 'VESHEL')
  assert.equal(other.payload.embeds.length, 0)
  const combined = await invoke('stats', undefined, owner, null, 'pheological')
  assert.equal(combined.payload.files.length, 1)
  assert.equal(combined.payload.components.length, 1)
  assert.equal(combined.payload.files[0].name, 'hoplite-overall.png')
  assert.equal(renderedName, 'PHEOLOGICAL')
  const duels = await invoke('duels', undefined, owner)
  assert.equal(duels.payload.files.length, 1)
  assert.ok(duels.payload.components.length > 0)
  const invalid = await invoke('stats', undefined, owner, null, 'bad/name')
  assert.match(invalid.payload.content, /valid Minecraft username/)
  assert.equal(reads, 5)
})
