'use strict'
const { clean } = require('./game-console')
const classNames = ['Miner', 'Warrior', 'Trapper', 'Archer', 'Looter', 'Fisherman']
const numberFields = {
  'Games Played': 'gamesPlayed', Wins: 'wins', Losses: 'losses', Kills: 'kills', Deaths: 'deaths', Assists: 'assists',
  'Current Winstreak': 'winStreak', 'Best Winstreak': 'bestWinStreak', 'Win Streak': 'winStreak', 'Best Win Streak': 'bestWinStreak', 'Voicechat Rank': 'voicechatRank',
  'Custom Crafts Crafted': 'customCrafts', 'Legendary Weapons Crafted': 'legendaryCrafts', 'Legendary Weapon Kills': 'legendaryKills'
}
function duration (value) {
  if (!/^\d+:\d{2}:\d{2}:\d{2}$/.test(value)) return null
  const [days, hours, minutes, seconds] = value.split(':').map(Number)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds
}
function ratio (a, b) {
  if (a == null || b == null) return null
  return b === 0 ? (a === 0 ? 0 : '∞') : a / b
}
function parseNumber (value) {
  const match = value.replaceAll(',', '').match(/^\s*(\d+)(?:\s|$)/)
  return match ? Number(match[1]) : null
}
function parseItem (item) {
  const name = clean(item.name).replace(/^\[(.*)\]$/, '$1').trim()
  if (!/\bstats$/i.test(name)) return null
  const label = name.replace(/\s+stats$/i, '')
  const stats = { name: label, sourceSlot: item.id, kind: classNames.some(name => name.toLowerCase() === label.toLowerCase()) ? 'class' : 'mode' }
  for (const line of clean(item.tooltip).split('\n')) {
    const match = line.trim().match(/^([^:]+):\s*(.*)$/)
    if (!match) continue
    const [, key, value] = match
    if (numberFields[key]) stats[numberFields[key]] = parseNumber(value)
    else if (key === 'Playtime') stats.playtimeSeconds = duration(value)
    else if (key === 'Average Time Survived') stats.averageSurvivalSeconds = duration(value)
    else if (key === 'W/L Ratio' || key === 'K/D Ratio') {
      const parsed = value === '∞' ? '∞' : /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null
      stats[key === 'W/L Ratio' ? 'reportedWinLossRatio' : 'reportedKillDeathRatio'] = parsed
    }
  }
  if (!Object.values(numberFields).some(key => stats[key] != null)) return null
  if (stats.losses == null && stats.gamesPlayed != null && stats.wins != null && stats.gamesPlayed >= stats.wins) {
    stats.losses = stats.gamesPlayed - stats.wins
    stats.lossesDerived = true
  }
  return stats
}
function enrich (stats) {
  if (stats.gamesPlayed == null && stats.wins != null && stats.losses != null) stats.gamesPlayed = stats.wins + stats.losses
  stats.winRate = stats.gamesPlayed == null || stats.wins == null ? null : stats.gamesPlayed === 0 ? 0 : stats.wins / stats.gamesPlayed * 100
  stats.winLossRatio = ratio(stats.wins, stats.losses === 0 ? 1 : stats.losses) ?? stats.reportedWinLossRatio ?? null
  stats.killDeathRatio = ratio(stats.kills, stats.deaths === 0 ? 1 : stats.deaths) ?? stats.reportedKillDeathRatio ?? null
  return stats
}
function parseStats (items) {
  const categories = items.map(parseItem).filter(Boolean)
  const overall = categories.find(item => /^overall$/i.test(item.name)) || null
  const classes = classNames.map(name => categories.find(item => item.kind === 'class' && item.name.toLowerCase() === name.toLowerCase())).filter(Boolean)
  // Mode books omit deaths. Use all six class totals for Overall K/D.
  if (overall && overall.deaths == null && classes.length === classNames.length &&
      classes.every(item => item.deaths != null && item.kills != null)) {
    overall.deaths = classes.reduce((sum, item) => sum + item.deaths, 0)
    overall.deathsSource = 'sum-of-six-classes'
    overall.kdKills = classes.reduce((sum, item) => sum + item.kills, 0)
  }
  const solo = categories.find(item => /^solo$/i.test(item.name))
  const civ = categories.find(item => /^(civilization|civ)$/i.test(item.name))
  // Hoplite Solo: every loss is one death (the user's game-mode rule).
  if (solo && solo.deaths == null && solo.losses != null) {
    solo.deaths = solo.losses
    solo.deathsSource = 'solo-losses'
  }
  // Only subtract mode totals when the books describe the same complete population.
  const modesAddUp = overall && solo && civ && ['gamesPlayed', 'wins', 'kills'].every(key =>
    overall[key] != null && solo[key] != null && civ[key] != null && overall[key] === solo[key] + civ[key])
  if (modesAddUp) {
    if (civ.losses == null && overall.losses != null && solo.losses != null && overall.losses >= solo.losses) {
      civ.losses = overall.losses - solo.losses
      civ.lossesDerived = true
    }
  }
  // Estimated Civ deaths are the remaining deaths after Solo, independently of book game totals.
  if (civ && overall?.deaths != null && solo?.deaths != null && overall.deaths >= solo.deaths) {
    civ.deaths = overall.deaths - solo.deaths
    civ.deathsSource = 'overall-minus-solo'
  }
  categories.forEach(enrich)
  if (overall?.kdKills != null) {
    overall.killDeathRatio = ratio(overall.kdKills, overall.deaths === 0 ? 1 : overall.deaths)
    overall.killDeathRatioSource = 'sum-of-six-classes'
  }
  return { overall, modes: categories.filter(item => item.kind === 'mode' && item !== overall), classes }
}
function parseDuelsStats (items) {
  const summaryNames = new Map([['Kit', 'Overall'], ['Competitive', 'Competitive'], ['Custom Kit', 'Custom'], ['Private', 'Private']])
  const parsed = items.map(parseItem).filter(Boolean).map(enrich)
  const overall = ['Kit', 'Competitive', 'Custom Kit', 'Private'].map(name => {
    const entry = parsed.find(item => item.name === name)
    return entry ? { ...entry, name: summaryNames.get(name), kind: 'mode' } : null
  }).filter(Boolean)
  const kits = parsed.filter(item => !summaryNames.has(item.name)).map(item => ({ ...item, name: item.name === 'NetherPot' ? 'Nethpot' : item.name, kind: 'kit' }))
  return { overall, kits }
}

function itemsFromText (text) {
  return clean(text).split(/\n(?=\[Slot \d+\])/).flatMap(block => {
    const match = block.match(/^\[Slot (\d+)\] ([^\n]+)\n([\s\S]*)$/)
    return match ? [{ id: Number(match[1]), name: match[2], tooltip: match[3].trim() }] : []
  })
}
function time (seconds) {
  if (seconds == null) return '—'
  const units = seconds >= 86400
    ? [[86400, 'd'], [3600, 'h'], [60, 'm']]
    : [[3600, 'h'], [60, 'm'], [1, 's']]
  const parts = []
  for (const [unit, suffix] of units) {
    const count = Math.floor(seconds / unit)
    seconds %= unit
    if (count) parts.push(`${count}${suffix}`)
  }
  return parts.join(' ') || '0m'
}
function clock (seconds) {
  if (seconds == null) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds / 3600) % 24
  const minutes = Math.floor(seconds / 60) % 60
  return [days, hours, minutes, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
}
module.exports = { parseDuelsStats, parseStats, itemsFromText, duration, ratio, time, clock }
