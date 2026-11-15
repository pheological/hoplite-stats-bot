'use strict'
const { randomBytes } = require('node:crypto')
const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js')
const { renderStatsCard } = require('./stat-card')
const views = [{ label: 'Overall · Total / Solo / Civ', value: 'overall' }, { label: 'Kit stats', value: 'kits' }]
class StatsUI {
  constructor ({ render = renderStatsCard, now = () => Date.now(), ttl = 300000, limit = 10 } = {}) {
    this.sessions = new Map(); this.render = render; this.now = now; this.ttl = ttl; this.limit = limit
  }
  prune () {
    for (const [id, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(id)
  }
  create (data, { playerName, playerUuid, rawText, preview = false }) {
    this.prune()
    while (this.sessions.size >= this.limit) this.sessions.delete(this.sessions.keys().next().value)
    const id = randomBytes(8).toString('hex')
    this.sessions.set(id, { data, playerName, playerUuid, rawText, preview, timestamp: new Date(this.now()), expires: this.now() + this.ttl, images: new Map(), revision: 0 })
    return id
  }
  get (id) {
    this.prune()
    const session = this.sessions.get(id)
    if (!session) throw new Error('This stats view expired. Run /stats again to fetch a fresh snapshot.')
    return session
  }
  isCurrent (id, revision) { return this.sessions.get(id)?.revision === revision }
  image (session, view) {
    if (!session.images.has(view)) {
      const kit = view.startsWith('kit-') ? session.data.kits?.[Number(view.slice(4))] : null
      const renderData = kit ? { ...session.data, rankingKits: session.data.kits, kits: [kit], singleKit: true } : session.data
      const image = Promise.resolve().then(() => this.render(renderData, {
        playerName: session.playerName, playerUuid: session.playerUuid,
        timestamp: session.timestamp, view: kit ? 'kits' : view, preview: session.preview, format: 'png'
      }))
      session.images.set(view, image)
      image.catch(() => session.images.delete(view))
    }
    return session.images.get(view)
  }
  prefetch (id, view) {
    const session = this.sessions.get(id)
    if (session && session.expires > this.now()) return this.image(session, view).catch(() => {})
  }
  async reply (id, view = 'overall') {
    const session = this.get(id)
    if (session.data.game === 'duels' && view === 'kits') view = 'kit-0'
    const kitIndex = /^kit-(\d+)$/.exec(view)?.[1]
    if (!views.some(option => option.value === view) && !(session.data.game === 'duels' && kitIndex != null && session.data.kits[Number(kitIndex)])) throw new Error('Unknown stats view.')
    const revision = ++session.revision
    const { buffer } = await this.image(session, view)
    const filename = `hoplite-${view.startsWith('kit-') ? 'kits' : view}.png`
    const target = view === 'overall' ? 'kits' : 'overall'
    const button = new ButtonBuilder().setCustomId(`stats-view:${id}:${target}`)
      .setLabel(view === 'overall' ? 'Show kit stats' : 'Show overall stats').setStyle(ButtonStyle.Secondary)
    const payload = {
      embeds: [],
      components: [new ActionRowBuilder().addComponents(button)],
      files: [new AttachmentBuilder(buffer, { name: filename })],
      allowedMentions: { parse: [] }
    }
    if (session.data.game === 'duels') {
      const tabs = [{ label: 'Overall', value: 'overall' }, ...session.data.kits.map((kit, index) => ({ label: kit.name, value: `kit-${index}` }))]
      payload.components = [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`stats-view:${id}:select`).setPlaceholder('Choose a stats page')
          .addOptions(tabs.map(tab => ({ label: tab.label, value: tab.value, default: tab.value === view }))))]

    }
    return { payload, revision }
  }
  async preview (view = 'both') {
    if (!['both', 'overall', 'kits'].includes(view)) throw new Error('Choose Overall or Kit stats.')
    let session
    try { session = this.previewId && this.get(this.previewId) } catch {}
    if (!session) {
      const fs = require('node:fs'), path = require('node:path')
      const { parseDuelsStats } = require('./stats')
      const sample = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/preview-duels.json'), 'utf8'))
      const data = { ...parseDuelsStats(sample.items), game: 'duels' }
      this.previewId = this.create(data, { playerName: 'VALPORATE', rawText: sample.text, preview: true })
    }
    const pages = view === 'both' ? ['overall', 'kits'] : [view]
    const replies = await Promise.all(pages.map(page => this.reply(this.previewId, page)))
    return {
      content: 'Preview · sample stats, no Minecraft connection required.',
      embeds: [],
      files: replies.map(reply => reply.payload.files[0]),
      components: replies.at(-1).payload.components,
      allowedMentions: { parse: [] }
    }
  }

}
module.exports = { StatsUI, views }
