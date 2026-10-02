import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/** 浏览器半模块 id：必须用包名（client-modules 以 package.json name 注册 __ModuleLoader__ 行） */
const CLIENT_ID = 'dsh-model-fix'

/** `@` → src 目录（tsdown 不读 tsconfig paths，必须在此显式声明；test 构建见 tsdown.test.config.ts） */
const SRC_ALIAS = { '@': fileURLToPath(new URL('./src', import.meta.url)) }

/**
 * 宿主浏览器共享模块表基线（外部包只能 require 这些 specifier，其余一律 inline）。
 * 与 harness 的 packages/client/web/src/platform.ts PLATFORM_MODULES 对齐，漂移即运行期 require 未命中。
 */
const PLATFORM_MODULES = [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
]
const isBaseline = (specifier: string): boolean =>
    (PLATFORM_MODULES as readonly string[]).includes(specifier)

/**
 * 版本号的唯一来源 = package.json。浏览器半运行在浏览器里、读不到磁盘，且构建纯度门禁禁止相对导入
 * （package.json 无法作为值导入），故在构建期读入、由 define 内联成字符串字面量 ⇒ 运行期零成本、
 * 零漂移：升版照常只改 package.json 一处，测试构建不涉及本标识（测试图只引 @/client/model 与 @/client/effort）。
 */
const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig([
    // ---------- Node 半：宿主侧插件本体 ----------
    {
        name: 'node',
        entry: ['src/index.ts'],
        outDir: 'lib',
        format: ['esm'],
        platform: 'node',
        target: 'es2024',
        fixedExtension: false,
        dts: false,
        clean: true,
        // 将 public 目录原样复制
        copy: 'public',
        alias: SRC_ALIAS,
        plugins: [
            {
                // 跨半纯度门禁（对称自守）：Node 半不得值依赖浏览器半（src/client）。
                // 全部源码导入必须以 `@/` 开头（相对导入一律拒绝）；跨半共享须放 src/shared（双方都可依赖）；
                // type-only 导入在解析前已被擦除，不受限，但 src/client 无 Node 半需消费的类型面，故 @/client 一律禁。
                name: 'dsh-node-bundle-purity',
                resolveId(source: string) {
                    if (source === '@/client' || source.startsWith('@/client/')) {
                        throw new Error(
                            `node bundle purity: "${source}" 跨半依赖浏览器半（src/client）被禁止；跨半共享须放 src/shared`,
                        )
                    }
                    if (source.startsWith('./') || source.startsWith('../')) {
                        throw new Error(
                            `node bundle purity: "${source}" 相对导入被禁止；src 内一律使用 "@/" 别名导入（tsconfig paths 与 tsdown alias 已同步配置）`,
                        )
                    }
                    return null
                },
            },
        ],
    },
    // ---------- 浏览器半：web-ui 卡片（lazy-CJS 工厂产物，格式复刻 harness clientBundle 预设） ----------
    {
        name: `${CLIENT_ID}/client`,
        entry: { client: 'src/client/index.tsx' },
        outDir: 'lib',
        // 与 node 半同目录：clean 必须关闭（node 半已负责清理），entryFileNames 钉死 lib/client.js
        clean: false,
        format: 'cjs',
        platform: 'browser',
        target: 'es2024',
        fixedExtension: false,
        dts: false,
        // 与 node 半一致：不开 sourcemap（浏览器半 map 会内嵌 sourcesContent 全源码，随包发布只增体积）
        sourcemap: false,
        define: {
            // 被 inline 的依赖可能读取 node 惯用环境变量，CJS 产物中必须替换掉
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
            'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
            'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
            // 卡片末尾的版本标记（声明见 src/client/card.tsx 的 __PLUGIN_VERSION__）
            __PLUGIN_VERSION__: JSON.stringify(PKG.version),
        },
        deps: {
            // 基线 specifier 走宿主模块表（require），其余（react 之外的一切）一律打进包内
            neverBundle: isBaseline,
            alwaysBundle: (specifier: string) => !isBaseline(specifier),
        },
        alias: SRC_ALIAS,
        plugins: [
            {
                // 跨插件纯度门禁（自守，同 harness 规则）：非基线的 @deepseek-ai/* 与越界值导入直接构建失败；
                // type-only 导入在解析前已被擦除，不受影响。
                // @/ 值导入只放行 @/shared/*（跨半共享层，零 Node 依赖）与 @/client/*（本半内部）；
                // 相对导入一律拒绝（全部源码导入必须以 @/ 开头，防拖入 node:path 等 Node 依赖）。
                // 别名键锚定 `@`（段边界匹配），不会吞掉 @deepseek-ai/* 等基线 specifier。
                name: 'dsh-client-bundle-purity',
                resolveId(source: string) {
                    if (source.startsWith('@/')) {
                        const intraClient = source === '@/client' || source.startsWith('@/client/')
                        const crossShared = source === '@/shared' || source.startsWith('@/shared/')
                        if (intraClient || crossShared) return null
                        throw new Error(
                            `client bundle purity: "${source}" 越界值导入 Node 半专属源码；`
                            + '浏览器半 @/ 值导入只允许 @/shared/*（跨半共享模块）与 @/client/*（本半内部），其余跨半协作须以字面量/契约复制维护',
                        )
                    }
                    if (source.startsWith('./') || source.startsWith('../')) {
                        throw new Error(
                            `client bundle purity: "${source}" 相对导入被禁止；浏览器半一律使用 "@/" 别名导入（tsconfig paths 与 tsdown alias 已同步配置）`,
                        )
                    }
                    if (!source.startsWith('@deepseek-ai/') || isBaseline(source)) return null
                    throw new Error(
                        `client bundle purity: "${source}" 不在宿主模块表基线内；`
                        + '跨插件只能经 cordis 服务协作（type-only 导入会被擦除、不受此限），或将其加入基线（须确认宿主 platform.ts 提供）',
                    )
                },
            },
        ],
        outputOptions: {
            entryFileNames: 'client.js',
            // 宿主 __ModuleLoader__ 的闭包工厂契约（banner/intro/footer 三段缺一不可）
            banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
            intro: 'var module = { exports: {} }; var exports = module.exports;',
            footer: 'return module.exports; } });',
        },
    },
])
