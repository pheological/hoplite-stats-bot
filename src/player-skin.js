'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { loadImage } = require('@napi-rs/canvas')
const normalizeUuid = value => /^[a-f0-9]{32}$/i.test(String(value || '').replaceAll('-', '')) ? String(value).replaceAll('-', '').toLowerCase() : null
class PlayerSkins {
  constructor ({ fetchImage = globalThis.fetch, cacheDir = path.resolve(__dirname, '../.headlessmc/skin-cache'), now = Date.now, ttl = 3600000 } = {}) {
    this.fetchImage = fetchImage; this.cacheDir = cacheDir; this.now = now; this.ttl = ttl; this.entries = new Map(); this.profiles = new Map()
  }
  async resolve (name) { return (await this.resolveProfile(name))?.id || null }
  async resolveProfile (name) {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name || '')) return null
    const key = name.toLowerCase()
    const cached = this.profiles.get(key)
    if (cached && cached.expires > this.now()) return cached.promise
    const entry = { expires: this.now() + this.ttl }
    entry.promise = (async () => {
      for (const endpoint of [
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
        `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`
      ]) {
        try {
          const response = await this.fetchImage(endpoint, { signal: AbortSignal.timeout(8000) })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const profile = await response.json()
          const id = normalizeUuid(profile.id)
          if (!id || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name || '')) throw new Error('Invalid profile response')
          return { id, name: profile.name }
        } catch (error) {
          console.error(`Minecraft profile lookup for ${name}: ${error.message}`)
        }
      }
      entry.expires = this.now() + 30000
      return null
    })()

    this.profiles.set(key, entry)
    while (this.profiles.size > 50) this.profiles.delete(this.profiles.keys().next().value)
    return entry.promise
  }
  async get (uuid) {
    const id = normalizeUuid(uuid)
    if (!id) return null
    const entry = this.entries.get(id)
    if (entry && entry.expires > this.now()) return entry.promise
    const next = { expires: this.now() + this.ttl }
    next.promise = this.load(id).catch(() => { next.expires = this.now() + 30000; return null })
    this.entries.set(id, next)
    while (this.entries.size > 50) this.entries.delete(this.entries.keys().next().value)
    return next.promise
  }
  async load (id) {
    const filename = path.join(this.cacheDir, id + '.png')
    let stale
    try {
      const [bytes, stat] = await Promise.all([fs.readFile(filename), fs.stat(filename)])
      stale = await loadImage(bytes)
      if (this.now() - stat.mtimeMs < this.ttl) return stale
    } catch {}
    try {
      const response = await this.fetchImage(`https://skins.mcstats.com/bust/${id}?scale=2&alwaysSquare=false&overlay=true`, { signal: AbortSignal.timeout(2500) })
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) throw new Error('Skin service did not return a PNG.')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > 2000000 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid skin image.')
      const image = await loadImage(bytes)
      await fs.mkdir(this.cacheDir, { recursive: true })
      await fs.writeFile(filename, bytes).catch(() => {})
      return image
    } catch (error) { if (stale) return stale; throw error }
  }
}
module.exports = { PlayerSkins, playerSkins: new PlayerSkins(), normalizeUuid }
