'use strict'
const { start } = require('./headless')
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js')

const { parseStats, parseDuelsStats } = require('./stats')
const { StatsUI } = require('./stats-ui')
const statsUI = new StatsUI()
const { playerSkins } = require('./player-skin')
const playerOption = option => option.setName('player').setDescription('Minecraft username; leave blank for the connected account').setMinLength(1).setMaxLength(16)
const { GameConsole, readDuelsStats, readBattleRoyaleStats, autoJoinBattleRoyale } = require('./game-console')

const required = ['DISCORD_TOKEN', 'DISCORD_OWNER_ID']
for (const name of required) {
  if (!process.env[name] || process.env[name].includes('REPLACE_')) {
    console.error(`Set ${name} in .env first. See README.md.`)
    process.exit(1)
  }
}
const guildId = process.env.DISCORD_GUILD_ID
const ownerId = process.env.DISCORD_OWNER_ID
for (const value of [ownerId]) {
  if (!/^\d{17,20}$/.test(value)) throw new Error('Discord owner ID must be a numeric Discord ID.')
}
const server = 'hoplite.gg'
let game = null
let gameConsole = null
let statsBusy = false
let gameState = 'stopped'
let stopping = false
let lastAction = 0

function send (command) {
  if (!game || game.stdin.destroyed || !game.stdin.writable) throw new Error('Start Minecraft first with /mc start.')
  if (/[\r\n\0]/.test(command)) throw new Error('Only one line is allowed.')
  if (!game.stdin.write(command + '\n')) console.log('Minecraft input is buffered.')
}
function launch () {
  if (game) throw new Error('Minecraft is already running.')
  gameState = 'starting'
  const child = start(['launch', '--headless', `--server=${server}`, 'fabric', '1.21.11'], ['pipe', 'pipe', 'pipe'])
  game = child
  gameConsole = new GameConsole(child)
  autoJoinBattleRoyale(gameConsole)
  // Keep authentication URLs and game output local, rather than relaying logs to Discord.
  gameConsole.on('output', line => process.stdout.write(line + '\n'))
  child.stdin.on('error', error => console.error('Minecraft input:', error.message))
  child.on('spawn', () => { gameState = 'running (connection not yet verified)' })
  child.on('error', error => {
    console.error('HeadlessMc:', error.message)
    if (game === child) { game = null; gameConsole = null; gameState = 'failed to start' }
  })
  child.on('exit', (code, signal) => {
    console.log(`HeadlessMc exited: ${code ?? signal}`)
    if (game === child) { game = null; gameConsole = null; gameState = `stopped (${code ?? signal})` }
  })
}
function stopGame () {
  if (!game) return
  send('quit')
}
const statsCommand = new SlashCommandBuilder().setName('stats').setDescription('Show Battle Royale stats').addStringOption(playerOption)
const previewCommand = new SlashCommandBuilder().setName('preview').setDescription('Preview both Minecraft-style stats pages without joining Minecraft')
const battleCommand = new SlashCommandBuilder().setName('battle').setDescription('Battle Royale stats')
  .addSubcommand(sub => sub.setName('royale').setDescription('Show Battle Royale stats').addStringOption(playerOption))
const duelsCommand = new SlashCommandBuilder().setName('duels').setDescription('Show Duels stats').addStringOption(playerOption)
const discord = new Client({ intents: [GatewayIntentBits.Guilds] })
discord.once('clientReady', async ready => {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)
    for (const builder of [statsCommand, previewCommand, battleCommand, duelsCommand]) {
      await rest.post(Routes.applicationCommands(ready.user.id), {
        body: { ...builder.toJSON(), integration_types: [0, 1], contexts: [0, 1, 2] }
      })
    }
    const globalCommands = await rest.get(Routes.applicationCommands(ready.user.id))
    for (const item of globalCommands) {
      if (item.name === 'mc') await rest.delete(Routes.applicationCommand(ready.user.id, item.id))
    }
    // Remove old guild commands so they do not shadow the global commands.
    if (guildId) {
      const legacy = await rest.get(Routes.applicationGuildCommands(ready.user.id, guildId))
      for (const item of legacy) {
        if (['mc', 'stats', 'preview', 'battle', 'duels'].includes(item.name)) await rest.delete(Routes.applicationGuildCommand(ready.user.id, guildId, item.id))
      }
    }
    console.log(`Discord ready as ${ready.user.tag}. User and server installs supported.`)
  } catch (error) { console.error('Could not register commands:', error.message); shutdown(1) }
})
discord.on('interactionCreate', async interaction => {
  const isStatsView = (interaction.isButton?.() || interaction.isStringSelectMenu?.()) && interaction.customId.startsWith('stats-view:')
  if (!isStatsView && (!interaction.isChatInputCommand() || !['stats', 'preview', 'battle', 'duels'].includes(interaction.commandName))) return
  const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
  try {
    if (isStatsView) {
      const [, id, buttonView] = interaction.customId.split(':')
      const view = interaction.isStringSelectMenu?.() ? interaction.values[0] : buttonView
      statsUI.get(id)
      await interaction.deferUpdate()
      const { payload, revision } = await statsUI.reply(id, view)
      if (statsUI.isCurrent(id, revision)) await interaction.editReply({ ...payload, attachments: [] })
      return
    }
    if (interaction.commandName === 'preview') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      const payload = await statsUI.preview('overall')
      await interaction.editReply(payload)
      return
    }
    const action = 'stats'
    if (statsBusy) { await reply('A stats read is in progress. Wait until it finishes.'); return }
    if (Date.now() - lastAction < 1500) { await reply('Wait a moment before sending another action.'); return }
    lastAction = Date.now()
    if (action === 'stats') {
      if (!gameConsole) throw new Error('Minecraft is not connected. The bot operator needs to restart the bot.')
      const player = interaction.options.getString('player')?.trim() || undefined
      if (player && !/^[A-Za-z0-9_]{1,16}$/.test(player)) throw new Error('Enter a valid Minecraft username (letters, numbers, and underscores).')
      statsBusy = true
      try {
        await interaction.deferReply()
        const profile = (player || gameConsole.playerName)
          ? playerSkins.resolveProfile(player || gameConsole.playerName)
          : Promise.resolve(null)
        void profile.then(identity => playerSkins.get(identity?.id || (!player ? gameConsole.playerUuid : null))).catch(() => {})
        const mode = interaction.commandName === 'duels' ? 'duels' : 'battle'
        const br = mode !== 'duels' ? await readBattleRoyaleStats(gameConsole, { statsOnly: true, player }) : null
        const duels = mode !== 'battle' ? await readDuelsStats(gameConsole, { player }) : null
        const identity = await profile
        const metadata = { playerName: identity?.name || player || gameConsole.playerName, playerUuid: identity?.id || (!player ? gameConsole.playerUuid : undefined) }
        const brId = br && statsUI.create(parseStats(br.items), { ...metadata, rawText: br.text })
        const duelsId = duels && statsUI.create({ ...parseDuelsStats(duels.items), game: 'duels' }, { ...metadata, rawText: duels.text })
        if (mode === 'combined') {
          const pages = await Promise.all([statsUI.reply(brId, 'overall'), statsUI.reply(duelsId, 'overall')])
          // Distinct attachment names allow both overall pages in one reply.
          pages[0].payload.files[0].setName('battle-royale-overall.png')
          pages[1].payload.files[0].setName('duels-overall.png')
          await interaction.editReply({ files: pages.flatMap(page => page.payload.files), components: [], allowedMentions: { parse: [] } })
        } else {
          const view = 'overall'
          const { payload } = await statsUI.reply(brId || duelsId, view)
          await interaction.editReply(payload)
        }
      } finally { statsBusy = false }
      return
    }

  } catch (error) {
    console.error('Discord action:', error.message)
    if (interaction.deferred) await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } }).catch(() => {})
    else if (!interaction.replied) await reply(error.message).catch(() => {})
  }
})
function shutdown (code = 0) {
  if (stopping) return
  stopping = true
  discord.destroy()
  try { stopGame() } catch {}
  if (!game) process.exit(code)
  const child = game
  child.once('exit', () => process.exit(code))
  setTimeout(() => child.kill('SIGTERM'), 5000).unref()
  setTimeout(() => process.exit(code), 8000).unref()
}
process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
discord.on('error', error => console.error('Discord:', error.message))
launch()
discord.login(process.env.DISCORD_TOKEN).catch(error => { console.error('Discord login:', error.message); shutdown(1) })
