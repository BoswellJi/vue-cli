const fs = require('fs')
const path = require('path')
const debug = require('debug')
const merge = require('webpack-merge')
const Config = require('webpack-chain')
const PluginAPI = require('./PluginAPI')
const dotenv = require('dotenv')
const dotenvExpand = require('dotenv-expand')
const defaultsDeep = require('lodash.defaultsdeep')
const { chalk, warn, error, isPlugin, resolvePluginId, loadModule, resolvePkg } = require('@vue/cli-shared-utils')

const { defaults, validate } = require('./options')

module.exports = class Service {
  /**
   * 
   * @param {*} context 
   * @param {*} param1 
   * @param {} plugins 
   */
  constructor (context, { plugins, pkg, inlineOptions, useBuiltIn } = {}) {
    // 进程实例添加 VUE_CLI_SERVICE 属性,值为 Service 实例
    process.VUE_CLI_SERVICE = this
    // 没有被实例化
    this.initialized = false
    // 当前文件绝对路径
    this.context = context
    // 行内选项参数
    this.inlineOptions = inlineOptions
    // 
    this.webpackChainFns = []
    this.webpackRawConfigFns = []
    this.devServerConfigFns = []
    // Service中的命令
    this.commands = {}

    // 包含目标文件package.json的插件
    // Folder containing the target package.json for plugins
    this.pkgContext = context

    // package.json包含插件
    // package.json containing the plugins
    this.pkg = this.resolvePkg(pkg)
    
    // 如果有内联插件，他们将被用来替换那些在package.json中被找到的插件
    // If there are inline plugins, they will be used instead of those
    // found in package.json.
    // 当...,内置插件不可用，这个主要是为了测试
    // When useBuiltIn === false, built-in plugins are disabled. This is mostly
    // for testing.
    // 解析插件： 内联插件 是否使用内置插件
    this.plugins = this.resolvePlugins(plugins, useBuiltIn)
    
    // run()函数执行期间，pluginsToSkip将被填充
    // pluginsToSkip will be populated during run()
    this.pluginsToSkip = new Set()

    // 解析默认模式给每一个命令使用
    // resolve the default mode to use for each command
    // 将插件作为module.exports.defaultModes被提供
    // this is provided by plugins as module.exports.defaultModes
    // 所以我们没有真实应用插件就能获取到信息
    // so we can get the information without actually applying the plugin.
    this.modes = this.plugins.reduce((modes, { apply: { defaultModes }}) => {
      return Object.assign(modes, defaultModes)
    }, {})
  }

  /**
   * 解析package.json文件
   * @param {*} inlinePkg undefined
   * @param {*} context
   */
  resolvePkg (inlinePkg, context = this.context) {
    if (inlinePkg) {
      return inlinePkg
    }
    const pkg = resolvePkg(context)
    if (pkg.vuePlugins && pkg.vuePlugins.resolveFrom) {
      this.pkgContext = path.resolve(context, pkg.vuePlugins.resolveFrom)
      return this.resolvePkg(null, this.pkgContext)
    }
    return pkg
  }

  /**
   * 根据开发模式初始化构建配置
   * @param {*} mode 开发模式,生产模式
   */
  init (mode = process.env.VUE_CLI_MODE) {
    // 已经被初始化,直接返回
    if (this.initialized) {
      return
    }
    // 标识为已经被初始化
    this.initialized = true
    // 开发模式
    this.mode = mode

    // load mode .env 加载模式下的 .env文件中得配置
    if (mode) {
      this.loadEnv(mode)
    }
    // load base .env 加载基础.env下的配置
    this.loadEnv()

    // load user config 加载用户配置(webpack.config.js的配置)
    const userOptions = this.loadUserOptions()
    // 默认深度复制项目的配置，最终的用户可配置的webpack部分
    this.projectOptions = defaultsDeep(userOptions, defaults())

    debug('vue:project-config')(this.projectOptions)

    // apply plugins. 应用插件
    this.plugins.forEach(({ id, apply }) => {
      // 需要被跳过的插件
      if (this.pluginsToSkip.has(id)) return
      // 插件调用
      apply(new PluginAPI(id, this), this.projectOptions)
    })

    // 从项目的配置文件中应用webpack配置
    // apply webpack configs from project config file
    if (this.projectOptions.chainWebpack) {
      //  的配置
      this.webpackChainFns.push(this.projectOptions.chainWebpack)
    }
    if (this.projectOptions.configureWebpack) {
      // 原始的webpack配置格式
      this.webpackRawConfigFns.push(this.projectOptions.configureWebpack)
    }
  }

  /**
   * 加载不同开发模式下的env文件
   * @param {*} mode
   */
  loadEnv (mode) {
    const logger = debug('vue:env')
    // env.test.local   env.prod.local   env.dev.local
    const basePath = path.resolve(this.context, `.env${mode ? `.${mode}` : ``}`)
    // 本地
    const localPath = `${basePath}.local`

    const load = envPath => {
      try {
        const env = dotenv.config({ path: envPath, debug: process.env.DEBUG })
        dotenvExpand(env)
        logger(envPath, env)
      } catch (err) {
        // only ignore error if file is not found
        if (err.toString().indexOf('ENOENT') < 0) {
          error(err)
        }
      }
    }

    load(localPath)
    load(basePath)

    // 默认, NODE_ENV 合BABEL_ENV被设置成 development 除了模式是 roduction or test,但是 在.env文件中的值将获得最高优先级
    // by default, NODE_ENV and BABEL_ENV are set to "development" unless mode
    // is production or test. However the value in .env files will take higher
    // priority.
    if (mode) {
      // 在测试期间,总是设置 NODE_ENV,因为对于测试来说不互相影响是重要的
      // always set NODE_ENV during tests
      // as that is necessary for tests to not be affected by each other
      // 应该强制设置默认环境变量
      const shouldForceDefaultEnv = (
        process.env.VUE_CLI_TEST &&
        !process.env.VUE_CLI_TEST_TESTING_ENV
      )
      // 判断使用的环境变量
      const defaultNodeEnv = (mode === 'production' || mode === 'test')
        ? mode
        : 'development'
      if (shouldForceDefaultEnv || process.env.NODE_ENV == null) {
        process.env.NODE_ENV = defaultNodeEnv
      }
      if (shouldForceDefaultEnv || process.env.BABEL_ENV == null) {
        process.env.BABEL_ENV = defaultNodeEnv
      }
    }
  }

  /**
   * 设置需要跳过的插件
   * @param {*} args
   */
  setPluginsToSkip (args) {
    const skipPlugins = args['skip-plugins']
    const pluginsToSkip = skipPlugins
    // 返回插件的名称
      ? new Set(skipPlugins.split(',').map(id => resolvePluginId(id)))
      : new Set()

    this.pluginsToSkip = pluginsToSkip
  }

  /**
   * 内置插件
   * npm package 插件 (拓展插件,可以写在这里)
   * 本地插件
   * @param {*} inlinePlugins 命令行中指定的插件名称
   * @param {*} useBuiltIn
   */
  resolvePlugins (inlinePlugins, useBuiltIn) {
    // 内置
    const idToPlugin = id => ({
      id: id.replace(/^.\//, 'built-in:'),
      apply: require(id)
    })

    let plugins

    // 内置插件,webpack config .js 的格式
    const builtInPlugins = [
      './commands/serve',
      './commands/build',
      './commands/inspect',
      './commands/help',
      // 配置插件是顺序敏感的
      // config plugins are order sensitive
      './config/base',
      './config/css',
      './config/prod',
      './config/app'
    ].map(idToPlugin)

    // 这个步骤,可以加入自定义插件
    if (inlinePlugins) {
      // 内置插件不可用，直接替换，否者合并
      plugins = useBuiltIn !== false
        ? builtInPlugins.concat(inlinePlugins)
        : inlinePlugins
    } else {
      // 获取package.json中开发依赖的key， devDependencies dependencies
      const projectPlugins = Object.keys(this.pkg.devDependencies || {})
      // 合并项目依赖
        .concat(Object.keys(this.pkg.dependencies || {}))
        // 过滤是否为插件(根据插件的命名规则)
        .filter(isPlugin)
        .map(id => {
          if (
            this.pkg.optionalDependencies &&
            id in this.pkg.optionalDependencies
          ) {
            let apply = () => {}
            try {
              // 插件的调用方式
              apply = require(id)
            } catch (e) {
              // 加载失败,模块没有被安装
              warn(`Optional dependency ${id} is not installed.`)
            }
            // id 插件名称
            return { id, apply }
          } else {
            return idToPlugin(id)
          }
        })
        // 项目插件与内置插件合并
      plugins = builtInPlugins.concat(projectPlugins)
    }

    // Local plugins 在package.json文件中的vuePlugins属性,等下添加插件信息
    if (this.pkg.vuePlugins && this.pkg.vuePlugins.service) {
      const files = this.pkg.vuePlugins.service
      if (!Array.isArray(files)) {
        throw new Error(`Invalid type for option 'vuePlugins.service', expected 'array' but got ${typeof files}.`)
      }
      
      plugins = plugins.concat(files.map(file => ({
        id: `local:${file}`,
        // 加载插件
        apply: loadModule(`./${file}`, this.pkgContext)
      })))
    }

    return plugins
  }

  /**
   *
   * @param {*} name 命令
   * @param {*} args 格式化后参数
   * @param {*} rawArgv 命令行参数
   */
  async run (name, args = {}, rawArgv = []) {
    // resolve mode
    // prioritize inline --mode
    // fallback to resolved default modes from plugins or development if --watch is defined
    const mode = 'development' || args.mode || (name === 'build' && args.watch ? 'development' : this.modes[name])

    // 初始化期间跳过插件的安装
    // --skip-plugins arg may have plugins that should be skipped during init()
    this.setPluginsToSkip(args)

    // 加载环境变量 加载用户配置 应用插件
    // load env variables, load user config, apply plugins
    this.init(mode)

    // 获取格式化后的参数
    args._ = args._ || []
    // 获取命令信息
    let command = this.commands[name]
    // 没有命令 && 名字存在
    if (!command && name) {
      // 命令不存在
      error(`command "${name}" does not exist.`)
      // 退出进程
      process.exit(1)
    }
    // 没有命令 || 参数有帮助 ||
    if (!command || args.help || args.h) {
      command = this.commands.help
    } else {
      args._.shift() // remove command itself
      rawArgv.shift()
    }
    const { fn } = command
    return fn(args, rawArgv)
  }

  /**
   * 解析可链接的webpack config
   */
  resolveChainableWebpackConfig () {
    // 生成和简化webpack config的链式api
    const chainableConfig = new Config()
    // apply chains 调用函数,添加 配置链, 获取webpackChain 中配置的webpack配置信息
    // this.webpackChainFns 是从过chainWebpack方法添加的webpack配置(值为function)
    // chainableConfig Config对象是这些配置函数的参数
    this.webpackChainFns.forEach(fn => fn(chainableConfig))
    return chainableConfig
  }

  /**
   * 解析webpack config file json
   * @param {*} chainableConfig
   */
  resolveWebpackConfig (chainableConfig = this.resolveChainableWebpackConfig()) {
    if (!this.initialized) {
      throw new Error('Service must call init() before calling resolveWebpackConfig().')
    }
    // get raw config 从配置链获取webpack 配置
    let config = chainableConfig.toConfig()
    const original = config
    // apply raw config fns 计算出配置中的原始webpack 配置信息
    this.webpackRawConfigFns.forEach(fn => {
      if (typeof fn === 'function') {
        // function with optional return value
        const res = fn(config)
        // 进行合并
        if (res) config = merge(config, res)
      } else if (fn) {
        // merge literal values
        config = merge(config, fn)
      }
    })

    // 如果配置被merge-webpack合并, 他废弃了被webpack-chain注入的 规则信息, 释放信息 以至于适应vue调试工作
    // #2206 If config is merged by merge-webpack, it discards the __ruleNames
    // information injected by webpack-chain. Restore the info so that
    // vue inspect works properly.
    // webpackChain 中的配置信息, 与 webpackChain以及webpackConfig中的配置信息的结合不同
    if (config !== original) {
      cloneRuleNames(
        config.module && config.module.rules,
        original.module && original.module.rules
      )
    }

    // 如果用户已经手动维护 公共路径
    // check if the user has manually mutated output.publicPath
    const target = process.env.VUE_CLI_BUILD_TARGET
    if (
      !process.env.VUE_CLI_TEST &&
      (target && target !== 'app') &&
      config.output.publicPath !== this.projectOptions.publicPath
    ) {
      throw new Error(
        `Do not modify webpack output.publicPath directly. ` +
        `Use the "publicPath" option in vue.config.js instead.`
      )
    }

    if (
      !process.env.VUE_CLI_ENTRY_FILES &&
      typeof config.entry !== 'function'
    ) {
      let entryFiles
      // 单一入口
      if (typeof config.entry === 'string') {
        // 规范化成数组
        entryFiles = [config.entry]
        // 本身是数组
      } else if (Array.isArray(config.entry)) {
        entryFiles = config.entry
      } else {
        // 对象
        entryFiles = Object.values(config.entry || []).reduce((allEntries, curr) => {
          return allEntries.concat(curr)
        }, [])
      }

      // 整理入口文件的绝对路径
      entryFiles = entryFiles.map(file => path.resolve(this.context, file))
      // 序列化成进程中的环境变量
      process.env.VUE_CLI_ENTRY_FILES = JSON.stringify(entryFiles)
    }

    // 最终的webpack 配置
    // console.log(JSON.stringify(config))
    return config
  }

  /**
   * 加载用户选项参数
   */
  loadUserOptions () {
    // vue.config.c?js
    let fileConfig, pkgConfig, resolved, resolvedFrom
    const esm = this.pkg.type && this.pkg.type === 'module'

    // 可能的vue-cli配置路径
    const possibleConfigPaths = [
      process.env.VUE_CLI_SERVICE_CONFIG_PATH,
      './vue.config.js',
      './vue.config.cjs'
    ]

    let fileConfigPath
    for (const p of possibleConfigPaths) {
      const resolvedPath = p && path.resolve(this.context, p)
      if (resolvedPath && fs.existsSync(resolvedPath)) {
        fileConfigPath = resolvedPath
        break
      }
    }

    if (fileConfigPath) {
      if (esm && fileConfigPath === './vue.config.js') {
        throw new Error(`Please rename ${chalk.bold('vue.config.js')} to ${chalk.bold('vue.config.cjs')} when ECMAScript modules is enabled`)
      }

      try {
        // 加载配置文件
        fileConfig = loadModule(fileConfigPath, this.context)
        // 配置文件返回function
        if (typeof fileConfig === 'function') {
          // 调用返回值
          fileConfig = fileConfig()
        }

        // 配置文件不存在 || 文件不是对象
        if (!fileConfig || typeof fileConfig !== 'object') {
          // 在这里展示抛出的错误，在第五版中会被修复掉
          // TODO: show throw an Error here, to be fixed in v5
          error(
            `Error loading ${chalk.bold(fileConfigPath)}: should export an object or a function that returns object.`
          )
          fileConfig = null
        }
      } catch (e) {
        error(`Error loading ${chalk.bold(fileConfigPath)}:`)
        throw e
      }
    }

    // package.json 文件中的vue 配置字段
    pkgConfig = this.pkg.vue
    // 存在 && 不是object类型
    if (pkgConfig && typeof pkgConfig !== 'object') {
      error(
        `Error loading vue-cli config in ${chalk.bold(`package.json`)}: ` +
        `the "vue" field should be an object.`
      )
      pkgConfig = null
    }

    /**
     * 1. vue.config.js 文件中的配置
     * 2. package.json 文件中vue 字段的配置
     * 3. 命令行中,每次手动添加的配置
     */

    // 文件配置存在
    if (fileConfig) {
      // package.json 下的配置也存在
      // package.json下的配置会被忽略,出现警告
      if (pkgConfig) {
        warn(
          `"vue" field in package.json ignored ` +
          `due to presence of ${chalk.bold('vue.config.js')}.`
        )
        warn(
          `You should migrate it into ${chalk.bold('vue.config.js')} ` +
          `and remove it from package.json.`
        )
      }
      // 将文件中的配置赋值给resolved
      resolved = fileConfig
      // 配置文件名称
      resolvedFrom = 'vue.config.js'

      // 文件配置不存在, package.json 配置存在
    } else if (pkgConfig) {
      // 赋值操作
      resolved = pkgConfig
      resolvedFrom = '"vue" field in package.json'
    } else {
      // 命令行的参数操作
      resolved = this.inlineOptions || {}
      resolvedFrom = 'inline options'
    }

    // 抹平配置差异

    // css 设置了不同的的模块化内容
    if (resolved.css && typeof resolved.css.modules !== 'undefined') {
      if (typeof resolved.css.requireModuleExtension !== 'undefined') {
        warn(
          `You have set both "css.modules" and "css.requireModuleExtension" in ${chalk.bold('vue.config.js')}, ` +
          `"css.modules" will be ignored in favor of "css.requireModuleExtension".`
        )
      } else {
        warn(
          `"css.modules" option in ${chalk.bold('vue.config.js')} ` +
          `is deprecated now, please use "css.requireModuleExtension" instead.`
        )
        resolved.css.requireModuleExtension = !resolved.css.modules
      }
    }

    // normalize some options 正规化一些选项参数
    ensureSlash(resolved, 'publicPath')
    // 配置的公共路径
    if (typeof resolved.publicPath === 'string') {
      // 开头的 ./ 替换为 ''
      resolved.publicPath = resolved.publicPath.replace(/^\.\//, '')
    }
    // 路径处理中的反斜杠 \ 转换为 / 斜杠
    removeSlash(resolved, 'outputDir')

    // validate options 
    // 验证 webpack options的正确性
    validate(resolved, msg => {
      // 无效选项
      error(
        `Invalid options in ${chalk.bold(resolvedFrom)}: ${msg}`
      )
    })

    // 返回用户的构建配置
    console.log('vue.config.js',resolved);
    return resolved
  }
}
/**
 * 确保最后一个字符是斜杠
 * @param {*} config 
 * @param {*} key 
 */
function ensureSlash (config, key) {
  const val = config[key]
  if (typeof val === 'string') {
    // 将非 / 斜杠的字符转换为在最后一个字符加/
    config[key] = val.replace(/([^/])$/, '$1/')
  }
}

/**
 * 将最后一个是 / 斜杠的字符，删除掉
 * @param {*} config 
 * @param {*} key 
 */
function removeSlash (config, key) {
  if (typeof config[key] === 'string') {
    // 将最的 / 转换为 ''
    config[key] = config[key].replace(/\/$/g, '')
  }
}

function cloneRuleNames (to, from) {
  if (!to || !from) {
    return
  }
  from.forEach((r, i) => {
    if (to[i]) {
      Object.defineProperty(to[i], '__ruleNames', {
        value: r.__ruleNames
      })
      cloneRuleNames(to[i].oneOf, r.oneOf)
    }
  })
}
