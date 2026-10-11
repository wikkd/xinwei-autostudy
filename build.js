#!/usr/bin/env node
'use strict';
/*
 * 构建脚本：把 src/meta.js（用户脚本头）与 src/*.js（共享同一 IIFE 作用域）
 * 拼接为单一用户脚本 dist/xinwei-autostudy.user.js。
 *
 * 用法：
 *   node build.js          构建一次（terser 可用时压缩，约 -42% 体积）
 *   node build.js --no-min 跳过压缩（调试压缩后行为差异用）
 *   node build.js --watch  监听 src 变化并自动重建（需手动刷新浏览器）
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
const OUTPUT = path.join(DIST_DIR, 'xinwei-autostudy.user.js');

// 压缩：UserScript 头必须原样保留（扩展解析依赖它），只对 IIFE 主体跑 terser。
// terser 是可选 devDependency——未安装（如裸 clone 后）自动降级为未压缩构建并提示。
function tryMinify(body, version) {
    let terser = null;
    try { terser = require('terser'); } catch (e) {}
    if (!terser) {
        console.log('ℹ️ 未安装 terser，输出未压缩版本（npm i -D terser 可启用压缩，约 -42%）');
        return body;
    }
    const res = terser.minify_sync(body, {
        compress: { passes: 2, ecma: 2020 },
        mangle: { toplevel: false },   // 无顶层泄漏（全部逻辑在 IIFE 内）；日志文案为字符串不受影响
        format: { comments: false, max_line_len: 300 },
    });
    if (!res || res.error) throw new Error('terser 压缩失败: ' + (res && res.error));
    return res.code;
}

// 版本单一来源：meta.js @version → 注入 bootstrap 的 __XA_VERSION__ 占位符。
// 版本号只需改 src/meta.js 一处，package.json 由 scripts/sync-version.js 校验（CI 强制）
function extractVersion(meta) {
    const m = meta.match(/^\/\/\s*@version\s+(\S+)/m);
    if (!m) throw new Error('meta.js 缺少 @version');
    return m[1];
}

// 拼接顺序：meta 头 -> 各模块（共享同一 IIFE 作用域）
const BODY_ORDER = [
    'config.js',
    'utils.js',
    'sites.js',
    'qa.js',
    'ui.js',
    'autoplay.js',
    'popup.js',
    'deadline.js',
    'bootstrap.js',
];

function read(p) {
    return fs.readFileSync(p, 'utf8');
}

// 发布版瘦身：删除整行 // 注释并折叠空行（模板字符串内容原样保留；src 源码不受影响）
function slim(code) {
    const out = [];
    let inTemplate = false;
    let prevBlank = false;
    for (let line of code.split('\n')) {
        if (!inTemplate) {
            const t = line.trim();
            if (t.startsWith('//')) continue;
            if (t === '') {
                if (prevBlank) continue;
                prevBlank = true;
            } else prevBlank = false;
        }
        const ticks = (line.match(/`/g) || []).length;
        if (ticks % 2 === 1) inTemplate = !inTemplate;
        out.push(line.replace(/\s+$/, ''));
    }
    return out.join('\n');
}

function build() {
    const meta = read(path.join(SRC_DIR, 'meta.js')).trimEnd();
    const version = extractVersion(meta);
    const parts = BODY_ORDER.map(f => slim(read(path.join(SRC_DIR, f))).replace(/__XA_VERSION__/g, version));
    let bundle = [
        meta,
        '',
        '(function () {',
        "    'use strict';",
        ...parts,
        '})();',
        '',
    ].join('\n');

    // 构建期自检：占位符必须全部替换（防新文件漏加替换逻辑）
    if (bundle.includes('__XA_VERSION__')) throw new Error('版本占位符 __XA_VERSION__ 替换失败');

    // 压缩（头注释与 IIFE 主体分开处理；保证头部逐字节不变）
    const noMin = process.argv.includes('--no-min');
    const rawKb = Buffer.byteLength(bundle, 'utf8') / 1024;
    if (!noMin) {
        const headEnd = bundle.indexOf('\n(function () {');
        if (headEnd > 0) {
            const head = bundle.slice(0, headEnd);
            const body = bundle.slice(headEnd + 1);
            bundle = head + '\n' + tryMinify(body, version);
        }
    }

    if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT, bundle, 'utf8');

    const kb = (Buffer.byteLength(bundle, 'utf8') / 1024).toFixed(1);
    const cut = noMin ? '' : '（压缩前 ' + rawKb.toFixed(1) + ' KB，-'
        + (100 - Buffer.byteLength(bundle, 'utf8') / (rawKb * 1024) * 100).toFixed(0) + '%）';
    console.log('✅ 构建完成 v' + version + ' -> ' + OUTPUT + ' (' + kb + ' KB) ' + cut);
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
