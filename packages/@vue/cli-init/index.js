const execa = require('execa')
const binPath = require.resolve('vue-cli/bin/vue-init')

console.log(process.argv)

// vue init webpack my-project

execa(
  binPath,
  process.argv.slice(process.argv.indexOf('init') + 1),
  { stdio: 'inherit' }
)
