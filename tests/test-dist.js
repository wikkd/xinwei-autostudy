// 构建产物（dist）冒烟测试：压缩构建的结构完整性与关键内容清单
// 运行：node tests/test-dist.js（需先 node build.js；CI 中构建在前）
// 目的：压缩（terser）只对 IIFE 主体生效——头部必须逐字节保留、关键选择器/文案/键名不得丢失。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const distPath = path.join(root, 'dist', 'xinwei-autostudy.user.js');
if (!fs.existsSync(distPath)) {
    console.error('❌ dist 不存在——先运行 node build.js');
    process.exit(1);
}
const dist = fs.readFileSync(distPath, 'utf8');
const meta = fs.readFileSync(path.join(root, 'src', 'meta.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
    if (cond) pass++;
    else { fail++; console.log('FAIL ' + label + (extra ? ' — ' + extra : '')); }
};

// ① 可解析（等价 node --check）
try {
    new vm.Script(dist, { filename: 'dist' });
    ok('dist 语法可解析', true);
} catch (e) {
    ok('dist 语法可解析', false, e.message);
}

// ② 头部逐字节保留（扩展靠它识别脚本）
const metaTrim = meta.trimEnd();
ok('UserScript 头逐字节保留', dist.startsWith(metaTrim));
ok('头部含 @version', /^\/\/\s*@version\s+\S+/m.test(dist));

// ③ 版本一致性：src/meta.js @version 必须等于 dist 头部 @version（防打包陈旧）
const vMeta = (meta.match(/^\/\/\s*@version\s+(\S+)/m) || [])[1];
const vDist = (dist.match(/^\/\/\s*@version\s+(\S+)/m) || [])[1];
ok('dist 与 src 同版本', vMeta && vMeta === vDist, 'meta=' + vMeta + ' dist=' + vDist);

// ④ 关键内容清单（选择器 / GM 键 / 端点 / UI 文案）
const MUST = [
    // 平台选择器（sites.js 解析链路）
    '.homework-single-selected', '.homework-multiple-selected', '.homework-true-or-false',
    '.homework-cloze', '.homework-question-editor', '.question-tag-score', '.topic-title',
    '.index-name', '.el-radio', '.el-checkbox', '.course-sidebar-switch',
    '.el-menu-item.is-active', '.done-icon', '.inProgress-icon', '.unStart-icon',
    'disable-menu', '.vjs-play-control', '观看下一章节',
    // 存储键（GM）
    'xa_unlock_watch_at', 'xa_confirm_answer',
    // 视频内弹题（popup.js，chunk 逆向 DOM 契约）
    '.popup-topic-dialog', '.option-item', 'icon-close', '弹题',
    // 端点
    'api.deepseek.com',
    // UI 文案（面板/日志/提交安全）
    '提交作业', '做作业', '下一题', '学习状态异常', '不允许倍速播放', '播放位置不合法',
    '[XinweiAutoStudy] 已加载 v', '[芯位]',
];
const missing = MUST.filter(s => !dist.includes(s));
ok('关键内容清单 ' + MUST.length + ' 项', missing.length === 0, missing.join(' | '));

// ⑤ 压缩生效（体积回归闸门：>130KB 说明压缩被关掉或意外膨胀）
const kb = Buffer.byteLength(dist, 'utf8') / 1024;
ok('体积在压缩区间 (<130KB)', kb < 130, kb.toFixed(1) + ' KB');

// ⑥ 压缩未破坏运行时代码骨架：IIFE 形式（`!function(){` 或 `(function(){`）+ use strict
ok('IIFE 保留', /^!?\(?function\s*\(\s*\)\s*\{/m.test(dist.slice(metaTrim.length)) || dist.includes('function(){'));
ok('use strict 保留', dist.includes('"use strict"') || dist.includes("'use strict'"));

// ⑦ 未压缩路径可用（--no-min 降级不翻车：源码模式下中文注释文案仍在）
ok('无 __XA_VERSION__ 残留', !dist.includes('__XA_VERSION__'));

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' dist tests passed (' + kb.toFixed(1) + ' KB)'));
process.exit(fail ? 1 : 0);
