#!/usr/bin/env node

const { semver, error } = require('@vue/cli-shared-utils')
const requiredVersion = require('../package.json').engines.node

// 首先查看node的版本是否满足cli-service项目
if (!semver.satisfies(process.version, requiredVersion)) {
  error(
    `You are using Node ${process.version}, but vue-cli-service ` +
    `requires Node ${requiredVersion}.\nPlease upgrade your Node version.`
  )
  process.exit(1)
}

// 加载Service类
const Service = require('../lib/Service')
// 实例化Service类  参数: node进程的环境变量 VUE_CLI_CONTEXT || 当前执行文件的地址
// const service = new Service(process.env.VUE_CLI_CONTEXT || process.cwd())
// 
const service = new Service('E:\\other\\vue\\vue-cli\\packages\\@vue\\cli\\my-test')

// 获取进程参数,前两个参数为 node执行文件地址,当前被执行文件地址, 命令行中的参数,所以从索引2开始取得是命令行中得参数
const rawArgv = process.argv.slice(2)


// 获取的是单个 参数的选项
const args = require('minimist')(rawArgv, {
  boolean: [
    // build
    'modern',
    'report',
    'report-json',
    'inline-vue',
    'watch',
    // serve
    'open',
    'copy',
    'https',
    // inspect
    'verbose'
  ]
})
// 获取单个参数中的第一个
const command = args._[0]

/**
 *   

 */

// 调用service类的run
service.run(command, args, rawArgv).catch(err => {
  error(err)
  process.exit(1)
})

// service.run('serve', {
//   _: ['serve'],
//   modern: false,
//   report: false,
//   'report-json': false,
//   'inline-vue': false,
//   watch: false,
//   open: false,
//   copy: false,
//   https: false,
//   verbose: false
// }, [ 'serve' ]).catch(err => {
//   error(err)
//   process.exit(1)
// })
