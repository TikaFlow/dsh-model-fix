import { defineConfig } from 'tsdown'

/** 浏览器半模块 id：必须用包名（client-modules 以 package.json name 注册 __ModuleLoader__ 行） */
const CLIENT_ID = 'dsh-model-fix'

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
        },
        deps: {
            // 基线 specifier 走宿主模块表（require），其余（react 之外的一切）一律打进包内
            neverBundle: isBaseline,
            alwaysBundle: (specifier: string) => !isBaseline(specifier),
        },
        plugins: [
            {
                // 跨插件纯度门禁（自守，同 harness 规则）：非基线的 @deepseek-ai/* 与跨半相对路径
                // 的值导入直接构建失败；type-only 导入在解析前已被擦除，不受影响
                name: 'dsh-client-bundle-purity',
                resolveId(source: string) {
                    if (source.startsWith('../')) {
                        throw new Error(
                            `client bundle purity: "${source}" 跨半值导入 Node 半源码（会拖入 node:path 等 Node 依赖）；`
                            + '浏览器半只允许 type-only 导入 ../，跨半协作须以字面量/契约复制维护（改动须两侧同步）',
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
