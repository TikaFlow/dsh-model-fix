import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** 构建产物与外部源码副本目录：非本仓源码，一律不检查 */
const IGNORES = ['lib/', 'dist/', '.test-dist/', 'node_modules/', 'public/', '.tmp-dsh/']

export default tseslint.config(
    { ignores: IGNORES },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
    },
    {
        // 浏览器半跑在宿主页面里，除 Node 侧的全局外还需 DOM 全局
        files: ['src/client/**/*.{ts,tsx}'],
        languageOptions: { globals: { ...globals.browser } },
    },
    {
        files: ['src/**/*.{ts,tsx}', 'test/**/*.ts'],
        rules: {
            // 硬约束：src / test 的一切源码导入走 @/ 与 @test/ 别名（tsconfig paths + tsdown alias 双声明）
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['./*', '../*'],
                    message: '源码导入必须以 @/（→ src/）或 @test/（→ test/）开头，禁止相对路径。',
                }],
            }],
            // tsconfig 开 verbatimModuleSyntax：纯类型的导入必须用 import type
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        },
    },
)
