'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const { prepareCardAssets } = require('../scripts/prepare-card-assets')
let fontPromise
async function loadMinecraftAssets () {
  if (fontPromise) return fontPromise
  fontPromise = (async () => {
    const dir = prepareCardAssets()
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'font.json'), 'utf8'))
    const glyphs = new Map()
    for (const provider of metadata.providers.filter(provider => provider.type === 'bitmap')) {
      const image = await loadImage(path.join(dir, path.basename(provider.file)))
      const columns = Array.from(provider.chars[0]).length
      const cellW = image.width / columns, cellH = image.height / provider.chars.length
      const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data
      const ratio = 8 / cellH
      provider.chars.forEach((row, rowIndex) => Array.from(row).forEach((char, col) => {
        if (char === '\0' || glyphs.has(char)) return
        const points = []
        let maxX = -1
        for (let y = 0; y < cellH; y++) for (let x = 0; x < cellW; x++) {
          if (pixels[((rowIndex * cellH + y) * image.width + col * cellW + x) * 4 + 3] > 127) {
            points.push([x * ratio, y * ratio, ratio]); maxX = Math.max(maxX, x)
          }
        }
        glyphs.set(char, { points, advance: (maxX + 1) * ratio + 1 })
      }))
    }
    glyphs.set(' ', { points: [], advance: 4 })
    const icons = {}
    for (const name of ['miner', 'warrior', 'trapper', 'archer', 'looter', 'fisherman', 'diamond', 'steve']) icons[name] = await loadImage(path.join(['diamond', 'steve'].includes(name) ? dir : path.resolve(__dirname, '../assets/kits'), name + '.png'))
    const duels = {}
    for (const name of ['parkour', 'battle_royale', 'kits', 'competitive', 'custom', 'private', 'sword', 'axe', 'crystal', 'nethpot', 'mace', 'uhc', 'bridge', 'sumo']) {
      duels[name] = await loadImage(path.resolve(__dirname, '../assets/duels', name + '.png'))
    }
    return { glyphs, icons, duels }
  })()
  return fontPromise
}
function measure (font, value, scale) {
  return Array.from(String(value)).reduce((sum, char) => sum + (font.glyphs.get(char) || font.glyphs.get('?')).advance * scale, 0) - scale
}
function drawText (ctx, font, value, x, y, scale, color = '#ffffff', { align = 'left', maxWidth = Infinity, shadow = true } = {}) {
  value = String(value)
  while (measure(font, value, scale) > maxWidth && scale > 1) scale--
  const width = measure(font, value, scale)
  x = Math.round(x - (align === 'center' ? width / 2 : align === 'right' ? width : 0)); y = Math.round(y)
  const paint = (color, dx, dy) => {
    ctx.fillStyle = color
    let cursor = x + dx
    for (const char of value) {
      const glyph = font.glyphs.get(char) || font.glyphs.get('?')
      for (const [px, py, size] of glyph.points) ctx.fillRect(Math.round(cursor + px * scale), Math.round(y + dy + py * scale), Math.ceil(size * scale), Math.ceil(size * scale))
      cursor += glyph.advance * scale
    }
  }
  if (shadow) paint('#101018', scale, scale)
  paint(color, 0, 0)
  return width
}
module.exports = { loadMinecraftAssets, drawText, measure }
