'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function files (dir, suffix) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? files(file, suffix) : file.endsWith(suffix) ? [file] : []
  })
}
function run (command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
const minecraft = path.join(root, '.headlessmc/game/.fabric/remappedJars/minecraft-1.21.11-0.19.5/client-intermediary.jar')
if (!fs.existsSync(minecraft)) throw new Error('Launch the installed Fabric 1.21.11 instance once to generate its intermediary JAR before building.')
const classes = path.join(root, 'mod/build/classes')
fs.mkdirSync(classes, { recursive: true })
const classpath = [minecraft, path.join(root, 'tools/hmc-specifics-1.21.11.jar'), ...files(path.join(root, '.headlessmc/minecraft/libraries'), '.jar')].join(path.delimiter)
run(process.env.JAVAC_BIN || 'javac', ['--release', '21', '-proc:none', '-cp', classpath, '-d', classes, ...files(path.join(root, 'mod/src/main/java'), '.java')])
fs.cpSync(path.join(root, 'mod/src/main/resources'), classes, { recursive: true })
const jar = path.join(root, '.headlessmc/game/mods/hoplite-gui-bridge.jar')
run(process.env.JAR_BIN || 'jar', ['--create', '--file', jar, '-C', classes, '.'])
console.log('Built and installed .headlessmc/game/mods/hoplite-gui-bridge.jar')
