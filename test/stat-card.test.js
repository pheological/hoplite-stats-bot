'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadImage } = require('@napi-rs/canvas')
const { parseStats, itemsFromText } = require('../src/stats')
const { renderStatsCard, protectedScene } = require('../src/stat-card')
const { StatsUI } = require('../src/stats-ui')
const raw = fs.readFileSync(path.join(__dirname, 'fixtures/hoplite-stats.txt'), 'utf8')
const data = parseStats(itemsFromText(raw))

test('overall and compact all-kits page are valid PNGs and both crops contain the house and tree', async () => {
  const source = { width: 3840, height: 2160 }
  const protectedRect = { x: protectedScene.x * source.width, y: protectedScene.y * source.height,
    width: protectedScene.width * source.width, height: protectedScene.height * source.height }
  let overallWidth, overallHeight
  for (const view of ['overall', 'kits']) {
    const card = await renderStatsCard(data, { playerName: 'Longest_Name_123', view, timestamp: new Date('2026-10-23T03:20:00Z') })
    assert.equal(card.buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    const image = await loadImage(card.buffer)
    assert.equal(image.width, card.width)
    assert.equal(image.height, card.height)
    assert.ok(card.buffer.length < 1000000)
    assert.ok(card.crop.x <= protectedRect.x)
    assert.ok(card.crop.y <= protectedRect.y)
    assert.ok(card.crop.x + card.crop.width >= protectedRect.x + protectedRect.width)
    assert.ok(card.crop.y + card.crop.height >= protectedRect.y + protectedRect.height)
    if (view === 'overall') { overallWidth = card.width; overallHeight = card.height }
    else { assert.equal(card.width, overallWidth); assert.equal(card.height, overallHeight) }
  }
})

test('button switches use one snapshot and cache each rendered view', async () => {
  let calls = 0
  const ui = new StatsUI({ render: async () => { calls++; return { buffer: Buffer.from('png') } } })
  const id = ui.create(data, { playerName: 'TestPlayer', rawText: raw })
  const first = await ui.reply(id)
  const kit = await ui.reply(id, 'kits')
  await ui.reply(id, 'kits')
  assert.equal(calls, 2)
  assert.equal(first.payload.components[0].toJSON().components[0].label, 'Show kit stats')
  assert.equal(kit.payload.components[0].toJSON().components[0].label, 'Show overall stats')
  assert.equal(kit.payload.files[0].name, 'hoplite-kits.png')
  assert.equal(kit.payload.files.length, 1)
  assert.equal(ui.get(id).data, data)
})

test('expired snapshots and bounded history release cached images', async () => {
  let now = 0
  const ui = new StatsUI({ now: () => now, ttl: 10, limit: 1 })
  const first = ui.create(data, { rawText: raw })
  const second = ui.create(data, { rawText: raw })
  assert.throws(() => ui.get(first), /expired/)
  assert.equal(ui.sessions.size, 1)
  now = 11
  assert.throws(() => ui.get(second), /expired/)
  assert.equal(ui.sessions.size, 0)
})

test('slow earlier renders cannot overwrite the latest selected view', async () => {
  let resolveOverall
  const ui = new StatsUI({ render: async (_, { view }) => view === 'overall'
    ? new Promise(resolve => { resolveOverall = resolve }) : { buffer: Buffer.from('kit') } })
  const id = ui.create(data, { rawText: raw })
  const slow = ui.reply(id, 'overall')
  const fast = await ui.reply(id, 'kits')
  resolveOverall({ buffer: Buffer.from('overall') })
  const old = await slow
  assert.equal(ui.isCurrent(id, fast.revision), true)
  assert.equal(ui.isCurrent(id, old.revision), false)
})


test('/preview returns both sample pages without a Minecraft client', async () => {
  const calls = []
  const ui = new StatsUI({ render: async (_, options) => { calls.push(options); return { buffer: Buffer.from('png') } } })
  const payload = await ui.preview()
  assert.equal(payload.embeds.length, 0)
  assert.equal(payload.files.length, 2)
  assert.deepEqual(calls.map(call => call.view), ['overall', 'kits'])
  assert.ok(calls.every(call => call.preview))
  const kits = await ui.preview('kits')
  assert.equal(kits.embeds.length, 0)
  assert.equal(kits.files[0].name, 'hoplite-kits.png')
  assert.equal(calls.length, 2)
})

test('rendering uses genuine bitmap glyphs for lowercase text, digits, and infinity', async () => {
  const { loadMinecraftAssets, measure } = require('../src/minecraft-font')
  const font = await loadMinecraftAssets()
  for (const char of 'Winrate0123456789∞') assert.ok(font.glyphs.has(char))
  assert.ok(measure(font, '111', 3) > 0)
  assert.equal(font.icons.warrior.width, 16)
})

test('prefetch prepares the other page without changing the visible revision', async () => {
  const calls = []
  const ui = new StatsUI({ render: async (_, { view }) => { calls.push(view); return { buffer: Buffer.from(view) } } })
  const id = ui.create(data, { rawText: raw })
  const overall = await ui.reply(id)
  await ui.prefetch(id, 'kits')
  assert.equal(ui.isCurrent(id, overall.revision), true)
  await ui.reply(id, 'kits')
  assert.deepEqual(calls, ['overall', 'kits'])
})

