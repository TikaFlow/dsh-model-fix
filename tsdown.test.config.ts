import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/**
 * 测试构建专用配置（非数组，单对象）。
 *
 * 必须独立于 tsdown.config.ts（数组）：数组配置会把 CLI 参数合并进每一项，
 * 浏览器半的工厂 banner 会污染测试产物——历史上 pnpm test 因此必须带 --no-config；
 * --no-config 下 tsdown 不读任何配置（其本身也不解析 tsconfig paths），
 * 引入 `@/` 别名后测试构建须有 alias 可用，故改为指向本文件（单对象无合并污染问题）。
 */
export default defineConfig({
    name: 'test',
    entry: ['test/index.ts'],
    outDir: '.test-dist',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    // `@` → src、`@test` → test，与 tsdown.config.ts 的 SRC_ALIAS 同源（独立文件，避免从主配置数组导入）
    alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@test': fileURLToPath(new URL('./test', import.meta.url)),
    },
    outputOptions: {
        // 钉死产物名，`pnpm test` 的 node 执行行不随 tsdown 默认扩展名漂移
        entryFileNames: 'index.mjs',
        // 测试产物自清理：bundle 尾行删掉所在目录，测试完 .test-dist 不留盘。
        // helper 的 summary 只设 exitCode、不 process.exit，尾行必执行；失败时同样删除——
        // 用例是纯逻辑断言，FAIL 行自带详情，产物无复跑价值。getBuiltinModule 免顶层
        // import（node >=22.3）；rmSync 直接收 file: URL
        footer: `process.getBuiltinModule('node:fs').rmSync(new URL('.', import.meta.url), { recursive: true, force: true })`,
    },
})
