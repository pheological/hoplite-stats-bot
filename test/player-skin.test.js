'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createCanvas } = require('@napi-rs/canvas')
const { PlayerSkins } = require('../src/player-skin')
const uuid = 'b2e9349a-e3b9-413a-af0d-84894476a650'
test('MCStats bust requests share one fetch and persist across service instances', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hoplite-skin-'))
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }))
  const png = await createCanvas(16, 16).encode('png')
  let calls = 0
  const fetchImage = async url => {
    calls++
    assert.match(url, /^https:\/\/skins\.mcstats\.com\/bust\/b2e9349ae3b9413aaf0d84894476a650\?/)
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  }
  const skins = new PlayerSkins({ cacheDir, fetchImage })
  const [first, second] = await Promise.all([skins.get(uuid), skins.get(uuid)])
  assert.equal(first, second)
  assert.equal(calls, 1)
  const cached = await new PlayerSkins({ cacheDir, fetchImage }).get(uuid)
  assert.equal(cached.width, 16)
  assert.equal(calls, 1)
})
test('invalid identity skips requests and HTTP/HTML failures fall back without rejecting', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hoplite-skin-fail-'))
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }))
  let calls = 0
  const skins = new PlayerSkins({ cacheDir, fetchImage: async () => { calls++; return new Response('<html>Blocked</html>', { status: 403 }) } })
  assert.equal(await skins.get('username'), null)
  assert.equal(calls, 0)
  assert.equal(await skins.get(uuid), null)
  assert.equal(await skins.get(uuid), null)
  assert.equal(calls, 1)
})
test('player names resolve to their own UUID with cached case-insensitive lookups', async () => {
  let calls = 0
  const skins = new PlayerSkins({ fetchImage: async url => {
    calls++
    assert.equal(url, 'https://api.mojang.com/users/profiles/minecraft/veshel')
    return Response.json({ id: uuid.replaceAll('-', ''), name: 'veshel' })
  } })
  const [first, second] = await Promise.all([skins.resolve('veshel'), skins.resolve('VESHEL')])
  assert.equal(first, uuid.replaceAll('-', ''))
  assert.equal(second, first)
  assert.equal(calls, 1)
  assert.equal(await skins.resolve('bad/name'), null)
})

test('profile lookup preserves canonical case and falls back to Minecraft Services', async () => {
  let calls = 0
  const skins = new PlayerSkins({ fetchImage: async url => {
    calls++
    if (url.includes('api.mojang.com')) return new Response('', { status: 503 })
    assert.match(url, /api.minecraftservices.com\/minecraft\/profile\/lookup\/name\/pheological$/)
    return Response.json({ id: '82821bac329647119471b3f2110b384d', name: 'PHEOLOGICAL' })
  } })
  assert.deepEqual(await skins.resolveProfile('pheological'), { id: '82821bac329647119471b3f2110b384d', name: 'PHEOLOGICAL' })
  assert.equal(await skins.resolve('PHEOLOGICAL'), '82821bac329647119471b3f2110b384d')
  assert.equal(calls, 2)
})
