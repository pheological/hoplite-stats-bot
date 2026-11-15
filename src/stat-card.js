'use strict'
const path = require('node:path')
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const { clock, time } = require('./stats')
const { loadMinecraftAssets, drawText } = require('./minecraft-font')
const { playerSkins } = require('./player-skin')
const kits = ['Miner', 'Warrior', 'Trapper', 'Archer', 'Looter', 'Fisherman']
const colors = { white: '#ffffff', gray: '#aaaaaa', green: '#55ff55', red: '#ff5555', gold: '#ffaa00', yellow: '#ffff55', aqua: '#55ffff', pink: '#ff55ff' }
const protectedScene = { x: 130 / 2048, y: 400 / 1152, width: 1200 / 2048, height: 560 / 1152 }
let background
function cropScene (sourceWidth, sourceHeight, width, height) {
  const rect = { x: protectedScene.x * sourceWidth, y: protectedScene.y * sourceHeight, width: protectedScene.width * sourceWidth, height: protectedScene.height * sourceHeight }
  const aspect = width / height
  const cropHeight = Math.min(sourceHeight, sourceWidth / aspect)
  const cropWidth = cropHeight * aspect
  if (cropWidth < rect.width || cropHeight < rect.height) throw new Error('Card crop would cut off the house or tree.')
  const x = Math.max(0, Math.min(sourceWidth - cropWidth, rect.x + rect.width / 2 - cropWidth / 2))
  const y = Math.max(0, Math.min(sourceHeight - cropHeight, rect.y + rect.height / 2 - cropHeight / 2))
  return { x, y, width: cropWidth, height: cropHeight }
}
const num = value => value == null ? '—' : value === '∞' ? '∞' : Number(value).toLocaleString('en-US')
const ratio = value => value == null ? '—' : value === '∞' ? '∞' : value.toFixed(2)
const percent = value => value == null ? '—' : value.toFixed(2) + '%'
function pane (ctx, x, y, width, height, alpha = 0.24) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, width - 2, height - 2)
}
function avatar (ctx, image, x, y, scale) {
  // Local upper-body fallback when the skin service is unavailable.
  const part = (sx, sy, sw, sh, dx, dy) => ctx.drawImage(image, sx, sy, sw, sh, x + dx * scale, y + dy * scale, sw * scale, sh * scale)
  part(8, 8, 8, 8, 4, 0); part(40, 8, 8, 8, 4, 0)
  part(20, 20, 8, 12, 4, 8); part(44, 20, 4, 12, 0, 8); part(36, 52, 4, 12, 12, 8)
}
function statCell (ctx, font, label, value, x, y, width, height, color) {
  const cx = x + width / 2
  drawText(ctx, font, label, cx, y + 12, 3, color, { align: 'center', maxWidth: width - 14 })
  drawText(ctx, font, value, cx, y + 49, 4, color, { align: 'center', maxWidth: width - 20 })

}
function rowDividers (ctx, x, y, width, rows, rowHeight) {
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  for (let row = 1; row < rows; row++) {
    ctx.fillRect(Math.round(x + 16), Math.round(y + row * rowHeight), Math.round(width - 32), 1)
  }
}
async function base (data, width, height, view, playerName, timestamp, preview, playerUuid) {
  background ||= loadImage(path.resolve(__dirname, '../assets/backgrounds/hoplite-winter.png'))
  const [image, font, bust] = await Promise.all([background, loadMinecraftAssets(), playerSkins.get(playerUuid)])
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d')
  const crop = data.game === 'duels' && view === 'kits'
    ? { x: 0, y: 0, width: image.width, height: image.height }
    : cropScene(image.width, image.height, width, height)
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  pane(ctx, 20, 20, width - 40, 180, 0.44)
  if (bust) {
    const scale = Math.min(150 / bust.width, 160 / bust.height)
    ctx.drawImage(bust, 25 + (150 - bust.width * scale) / 2, 30 + (160 - bust.height * scale) / 2, bust.width * scale, bust.height * scale)
  } else avatar(ctx, font.icons.steve, 44, 35, 7)
  drawText(ctx, font, playerName || 'Connected Player', 180, 64, 4, colors.white, { maxWidth: data.game === 'duels' ? width * 0.52 - 190 : width - 680 })
  drawText(ctx, font, data.game === 'duels' ? 'Duels Stats' : 'Battle Royale Stats', 180, 124, 4, colors.aqua)
  const sidebar = data.game === 'duels' ? [] : [
    ['Games', num(data.overall?.gamesPlayed), colors.aqua],
    ['Custom Crafts', num(data.overall?.customCrafts), colors.green],
    ['Legendary Crafts', num(data.overall?.legendaryCrafts), colors.gold],
    ['Legendary Kills', num(data.overall?.legendaryKills), colors.pink]
  ]
  if (data.game === 'duels') {
    const candidates = [...(data.rankingKits || data.kits || []), ...(data.overall || []).filter(entry => entry.name === 'Competitive')]
    const played = candidates.filter(entry => entry.gamesPlayed > 0 && entry.winLossRatio != null && entry.killDeathRatio != null)
    // Equal-weight geometric mean rewards performance in both ratios.
    const score = entry => Math.sqrt(entry.winLossRatio * entry.killDeathRatio)
    const sorted = [...played].sort((a, b) => score(a) - score(b))
    const timed = candidates.filter(entry => entry.playtimeSeconds != null).sort((a, b) => b.playtimeSeconds - a.playtimeSeconds)
    const best = sorted.at(-1), worst = sorted[0], longest = timed[0]
    const summary = [
      ['Best Kit', best ? best.name : '—', colors.green],
      ['Worst Kit', worst ? worst.name : '—', colors.red],
      ['Most Played', longest ? `${longest.name} (${time(longest.playtimeSeconds)})` : '—', colors.aqua]
    ]
    summary.forEach(([label, value, color], index) => {
      drawText(ctx, font, label, width - 32, 35 + index * 50, 2, colors.white, { align: 'right', maxWidth: width * 0.43 })
      drawText(ctx, font, value, width - 32, 57 + index * 50, 2, color, { align: 'right', maxWidth: width * 0.43 })
    })
  }
  const sx = width - 424
  sidebar.forEach(([label, value, color], i) => {
    drawText(ctx, font, label + ':', sx, 40 + i * 35, 3, colors.white, { maxWidth: 290 })
    drawText(ctx, font, value, width - 45, 40 + i * 35, 3, color, { align: 'right', maxWidth: 95 })
  })
  return { canvas, ctx, font, crop }
}
function modePanel (ctx, font, stats, name, x, y, width, height, accent) {
  pane(ctx, x, y, width, height)
  drawText(ctx, font, name, x + width / 2, y + 17, 4, accent, { align: 'center' })
  const cells = [
    ['Wins', num(stats?.wins), colors.green], ['Losses', num(stats?.losses), colors.red],
    ['Kills', num(stats?.kills), colors.green], [name === 'Civilization' ? 'Est. Deaths' : 'Deaths', num(stats?.deaths), colors.red],
    [name === 'Overall' ? 'K/D' : 'Est. K/D', ratio(stats?.killDeathRatio), colors.gold], ['W/L', ratio(stats?.winLossRatio), colors.gold],
    ['Winrate', percent(stats?.winRate), colors.aqua], ['Assists', num(stats?.assists), colors.pink],
    ['Games', num(stats?.gamesPlayed), colors.green], ['Playtime', time(stats?.playtimeSeconds), colors.aqua],
    ['Winstreak', num(stats?.winStreak), colors.green], ['Best Winstreak', num(stats?.bestWinStreak), colors.gold]
  ]
  cells.forEach(([label, value, color], i) => statCell(ctx, font, label, value, x + i % 2 * width / 2, y + 75 + Math.floor(i / 2) * 88, width / 2, 88, color))
  rowDividers(ctx, x, y + 75, width, 6, 88)
  const notes = [
    `Avg. Survival: ${clock(stats?.averageSurvivalSeconds)}`,
    `Legendary Crafts: ${num(stats?.legendaryCrafts)}`,
    `Legendary Kills: ${num(stats?.legendaryKills)}`
  ]
  notes.forEach((line, i) => drawText(ctx, font, line, x + width / 2, y + 618 + i * 38, 3, colors.white, { align: 'center', maxWidth: width - 20 }))
}
function kitPanel (ctx, font, stats, name, x, y, width, height, accent) {
  pane(ctx, x, y, width, height)
  ctx.drawImage(font.icons[name.toLowerCase()], x + 19, y + 14, 60, 60)
  drawText(ctx, font, name, x + 95, y + 27, 3, accent, { maxWidth: width - 240 })
  drawText(ctx, font, `Games: ${num(stats?.gamesPlayed)}`, x + width - 18, y + 34, 2, colors.gray, { align: 'right', maxWidth: 155 })
  const cells = [
    ['Wins', num(stats?.wins), colors.green], ['Losses', num(stats?.losses), colors.red], ['W/L', ratio(stats?.winLossRatio), colors.gold],
    ['Kills', num(stats?.kills), colors.green], ['Deaths', num(stats?.deaths), colors.red], ['K/D', ratio(stats?.killDeathRatio), colors.gold],
    ['Assists', num(stats?.assists), colors.pink], ['Playtime', time(stats?.playtimeSeconds), colors.aqua], ['Winrate', percent(stats?.winRate), colors.yellow]
  ]
  cells.forEach(([label, value, color], i) => statCell(ctx, font, label, value, x + 8 + i % 3 * (width - 16) / 3, y + 78 + Math.floor(i / 3) * 94, (width - 16) / 3, 94, color))
  rowDividers(ctx, x, y + 78, width, 3, 94)
}
async function renderStatsCard (data, { playerName, playerUuid, view = 'overall', timestamp = new Date(), preview = false } = {}) {
  if (!['overall', 'kits'].includes(view)) throw new Error('Choose the Overall or All Kits page.')
  const width = data.singleKit ? 760 : data.game === 'duels' && view === 'overall' ? 1100 : 1440
  const height = data.singleKit ? 700 : data.game === 'duels' && view === 'kits' ? 2460 : 1032
  const { canvas, ctx, font, crop } = await base(data, width, height, view, playerName, timestamp, preview, playerUuid)
  if (data.game === 'duels') {
    const entries = view === 'overall' ? data.overall : data.kits
    const columns = data.singleKit ? 1 : 2
    const rows = Math.ceil(entries.length / columns)
    const panelWidth = (width - 40 - (columns - 1) * 16) / columns
    const panelHeight = (height - 244 - (rows - 1) * 12) / rows
    entries.forEach((entry, i) => {
      const x = (width - columns * panelWidth - (columns - 1) * 16) / 2 + i % columns * (panelWidth + 16)
      const y = 224 + Math.floor(i / columns) * (panelHeight + 12)
      pane(ctx, x, y, panelWidth, panelHeight)
      const iconName = entry.name === 'Overall' ? 'kits' : entry.name.toLowerCase().replaceAll(' ', '_')
      const icon = font.duels[iconName]
      const accent = { kits: '#55ffff', competitive: '#ff55ff', custom: '#aaaaaa', private: '#aa00aa' }[iconName] || colors.aqua
      if (icon) ctx.drawImage(icon, x + 12, y + 6, 32, 32)
      drawText(ctx, font, entry.name, x + 52, y + 12, 3, accent, { maxWidth: panelWidth - 64 })
      if (view === 'kits') {
        const gap = 4
        const innerX = x + 8, innerWidth = panelWidth - 16
        const top = y + 48
        const rowHeight = 90
        const groups = [
          [['Winstreak', num(entry.winStreak), colors.yellow], ['Best Winstreak', num(entry.bestWinStreak), colors.yellow]],
          [['Wins', num(entry.wins), colors.green], ['Losses', num(entry.losses), colors.red], ['W/L', ratio(entry.winLossRatio), colors.gold]],
          [['Kills', num(entry.kills), colors.green], ['Deaths', num(entry.deaths), colors.red], ['K/D', ratio(entry.killDeathRatio), colors.gold]],
          [['Games', num(entry.gamesPlayed), colors.green], ['Playtime', time(entry.playtimeSeconds), colors.aqua], ['Winrate', percent(entry.winRate), colors.yellow]]
        ]
        groups.forEach((group, row) => {
          if (row > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.16)'
            ctx.fillRect(innerX + 8, top + row * (rowHeight + gap) - gap / 2, innerWidth - 16, 1)
          }
          const cellWidth = (innerWidth - gap * (group.length - 1)) / group.length
          group.forEach(([label, value, color], col) => {
            const cellX = innerX + col * (cellWidth + gap)
            const cellY = top + row * (rowHeight + gap)
            drawText(ctx, font, label, cellX + cellWidth / 2, cellY + 12, 2.5, color, { align: 'center', maxWidth: cellWidth - 12 })
            drawText(ctx, font, value, cellX + cellWidth / 2, cellY + 46, 4, color, { align: 'center', maxWidth: cellWidth - 12 })
          })
        })
        return
      }
      const cells = [
        ['Wins', num(entry.wins), colors.green], ['Losses', num(entry.losses), colors.red], ['W/L', ratio(entry.winLossRatio), colors.gold],
        ['Kills', num(entry.kills), colors.green], ['Deaths', num(entry.deaths), colors.red], ['K/D', ratio(entry.killDeathRatio), colors.gold],
        ['Games', num(entry.gamesPlayed), colors.green], ['Playtime', time(entry.playtimeSeconds), colors.aqua], ['Winrate', percent(entry.winRate), colors.yellow],
        ['Streak', num(entry.winStreak), colors.green], ['Best Streak', num(entry.bestWinStreak), colors.gold]
      ]
      const cellColumns = 3
      const rowHeight = view === 'overall' ? 82 : 94
      cells.forEach(([label, value, color], index) => {
        const cx = x + (index % cellColumns + 0.5) * panelWidth / cellColumns
        const cy = y + 42 + Math.floor(index / cellColumns) * rowHeight
        drawText(ctx, font, label, cx, cy, 2.5, color, { align: 'center', maxWidth: panelWidth / cellColumns - 8 })
        drawText(ctx, font, value, cx, cy + 32, 4, color, { align: 'center', maxWidth: panelWidth / cellColumns - 8 })
      })
      const statRows = Math.ceil(cells.length / cellColumns)
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      for (let row = 1; row < statRows; row++) {
        const dividerY = y + 42 + row * rowHeight - 10
        ctx.fillRect(x + 16, dividerY, panelWidth - 32, 1)
      }
    })
  } else if (view === 'overall') {
    const modes = [data.overall, data.modes.find(mode => /^solo$/i.test(mode.name)), data.modes.find(mode => /^(civilization|civ)$/i.test(mode.name))]
    const names = ['Overall', 'Solo', 'Civilization'], accents = [colors.gold, colors.aqua, colors.pink]
    const panelWidth = (width - 72) / 3
    modes.forEach((mode, i) => modePanel(ctx, font, mode, names[i], 20 + i * (panelWidth + 16), 224, panelWidth, height - 244, accents[i]))
  } else {
    const panelWidth = (width - 72) / 3
    kits.forEach((name, i) => kitPanel(ctx, font, data.classes.find(kit => kit.name.toLowerCase() === name.toLowerCase()), name,
      20 + i % 3 * (panelWidth + 16), 224 + Math.floor(i / 3) * 402, panelWidth, 386,
      [colors.aqua, colors.red, colors.pink, colors.green, colors.gold, colors.aqua][i]))
  }
  return { buffer: await canvas.encode('png'), width, height, crop }
}
module.exports = { renderStatsCard, cropScene, protectedScene, kits }
