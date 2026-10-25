'use strict';
/*
 * ESLint 扁平配置（v3.16 起的回归门禁）。
 *
 * 两个 lint 对象：
 *   1. tmp/lint-bundle.user.js —— src 按 BODY_ORDER 拼接的未压缩用户脚本（scripts/lint-bundle.js
 *      生成，npm run lint 自动完成）。浏览器 + GM_* 环境；跨模块 no-undef 在这里才有意义。
 *   2. 仓库侧 Node 文件（build.js / scripts/ / tests/）—— CommonJS 环境。
 *
 * 规则取向：只开能抓真 bug 的核心规则（no-undef / no-unused-vars / no-dupe-keys 等，
 * 来自 js.configs.recommended），不做风格约束；代码库既有风格为空 catch 静默容错，
 * 故 caughtErrors 关闭。
 */
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'dist/**',        // terser 压缩产物，lint 无意义
            'legacy/**',      // 存档参考代码，不再维护
            // src 模块共享 IIFE 作用域，单文件缺跨模块符号与浏览器全局，直接 lint 全是误报；
            // 统一经 scripts/lint-bundle.js 按 BODY_ORDER 拼接后在 tmp/lint-bundle.user.js 上 lint
            'src/**',
            // tmp 其余内容（逆向样本/历史调试脚本）不 lint；显式枚举而非 tmp/** + 负向放行——
            // 扁平配置的 ignore 负向模式对直接指定路径的场景不可靠，bundle 必须稳稳落在 lint 范围内
            'tmp/research/**',
            'tmp/debug-case7.js',
            'tmp/test-imgregex.js',
            'tmp/test-tiku.js',
            '.workbuddy/**',
        ],
    },
    js.configs.recommended,
    {
        files: ['tmp/lint-bundle.user.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                GM_getValue: 'readonly',
                GM_setValue: 'readonly',
                GM_xmlhttpRequest: 'readonly',
                GM_info: 'readonly',
            },
        },
        rules: {
            'no-empty': ['error', { allowEmptyCatch: true }],   // 空 catch 是本库既定容错风格
            'no-unused-vars': ['error', { caughtErrors: 'none' }],
            // 字符类里的 [\.\．、] 是本库刻意的可读性转义（混排全半角标点时的统一写法），非错误
            'no-useless-escape': 'off',
        },
    },
    {
        files: ['build.js', 'eslint.config.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-unused-vars': ['error', { caughtErrors: 'none' }],
        },
    },
];
