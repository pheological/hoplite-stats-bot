'use strict'
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '..')
const state = path.join(root, '.headlessmc')
function start (args, stdio = 'inherit') {
  fs.mkdirSync(state, { recursive: true, mode: 0o700 })
  const jar = path.join(root, 'tools/headlessmc.jar')
  if (!fs.existsSync(jar)) throw new Error('Missing tools/headlessmc.jar. See README.md.')
  const hasJvmArgs = args.some(arg => /^(?:--jvm|-j)(?:=|$)/.test(arg))
  const launchArgs = args[0] === 'launch' && !hasJvmArgs
    ? [args[0], '--jvm=-Xms256M -Xmx1G', ...args.slice(1)]
    : args
  return spawn(process.env.JAVA_BIN || 'java', [
    `-Dhmc.files.location=${state}`, `-Dhmc.files.mc=${state}/minecraft`,
    `-Dhmc.files.game=${state}/game`, '-Dhmc.files.game-for-each-version=false',
    '-Dhmc.jline.enabled=false', '-jar', jar, ...launchArgs
  ], { cwd: root, stdio })
}
module.exports = { start }
if (require.main === module) {
  const child = start(process.argv.slice(2), ['inherit', 'pipe', 'inherit'])
  const lines = require('node:readline').createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', line => { if (!line.includes('HOPLITE_GUI_EVENT ')) process.stdout.write(line + '\n') })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
