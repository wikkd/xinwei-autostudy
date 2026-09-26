#!/usr/bin/env node
'use strict';
/*
 * 构建脚本：把 src/meta.js（用户脚本头）与 src/*.js（共享同一 IIFE 作用域）
 * 拼接为单一用户脚本 dist/xinwei-autostudy.user.js。
 *
 * 用法：
 *   node build.js          构建一次
 *   node build.js --watch  监听 src 变化并自动重建（需手动刷新浏览器）
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
const OUTPUT = path.join(DIST_DIR, 'xinwei-autostudy.user.js');

// 拼接顺序：meta 头 -> 各模块（共享同一 IIFE 作用域）
const BODY_ORDER = [
    'config.js',
    'utils.js',
    'qa.js',
    'ui.js',
    'autoplay.js',
    'popup.js',
    'bootstrap.js',
];

function read(p) {
    return fs.readFileSync(p, 'utf8');
}

function build() {
    const meta = read(path.join(SRC_DIR, 'meta.js')).trimEnd();
    const parts = BODY_ORDER.map(f => read(path.join(SRC_DIR, f)));
    const bundle = [
        meta,
        '',
        '(function () {',
        "    'use strict';",
        ...parts,
        '})();',
        '',
    ].join('\n');

    if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT, bundle, 'utf8');

    const kb = (Buffer.byteLength(bundle, 'utf8') / 1024).toFixed(1);
    console.log('✅ 构建完成 -> ' + OUTPUT + ' (' + kb + ' KB)');
    return bundle;
}

build();

if (process.argv.includes('--watch')) {
    console.log('👀 watch 模式已开启，修改 src/ 将自动重建（无额外依赖，使用 fs.watch）');
    const watched = BODY_ORDER.concat(['meta.js']).map(f => path.join(SRC_DIR, f));
    watched.forEach(f => {
        fs.watch(f, () => {
            try { build(); } catch (e) { console.error('构建失败:', e.message); }
        });
    });
}
