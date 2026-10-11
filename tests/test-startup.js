// dist 启动冒烟测试（jsdom）：压缩产物在真实 DOM 环境下能否完整启动
// 运行：node tests/test-startup.js
// 目的：terser mangle 后仅语法检查不够——这里让 dist 在 jsdom 页面里真正执行一遍，
// 验证 bootstrap 全链路（面板构建/事件绑定/静音安装/扫描恢复）不抛异常、面板 DOM 真的出现。
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
    console.log('ℹ️ 未安装 jsdom，跳过启动冒烟（npm i -D jsdom 启用）');
    process.exit(0);
}

const dist = fs.readFileSync(path.join(__dirname, '..', 'dist', 'xinwei-autostudy.user.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
    if (cond) pass++;
    else { fail++; console.log('FAIL ' + label + (extra ? ' — ' + extra : '')); }
};

// jsdom 环境：模拟 beeline 学习页（hash 路由 + 基础 DOM）
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    url: 'https://www.beeline-ai.com/student/#/courseInfo/1/courseWare/1/video/1',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
});
const { window } = dom;
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message || e)));

// 浏览器缺失 API 补桩（jsdom 不实现的：GM_* / matchMedia / AudioContext 等）
const store = {};
window.GM_getValue = (k, d) => (k in store ? store[k] : d);
window.GM_setValue = (k, v) => { store[k] = String(v); };
window.GM_xmlhttpRequest = () => {};   // 不发起真实请求
window.GM_info = { script: { version: '0.0.0-test' } };

// UserScript 头不是 JS——剥离头部只跑 IIFE 主体
const bodyStart = dist.indexOf('\n(function () {');
const body = bodyStart > 0 ? dist.slice(bodyStart + 1) : dist;

try {
    window.eval(body);
    ok('dist 在 jsdom 中执行无抛错', true);
} catch (e) {
    ok('dist 在 jsdom 中执行无抛错', false, e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join(' / '));
}

// 面板构建验证：bootstrap 的 buildPanel 应插入控制面板
const panel = window.document.getElementById('xa-panel') || window.document.querySelector('[id^="xa-"]');
ok('控制面板已挂载', !!panel, 'document.body 子节点数=' + window.document.body.children.length);
if (panel) {
    ok('面板含开关元素', (window.document.querySelectorAll('input, [class*="switch"], button').length > 0));
}
ok('window.xaScriptLoaded 防重标记', window.xaScriptLoaded === true || window.xaScriptLoaded === undefined); // undefined = 脚本提前 return
ok('页面无运行时错误事件', errors.length === 0, errors.slice(0, 2).join(' | '));

// 关键全局未污染（IIFE 设计目标）
ok('未泄漏 XIA_AI 到 window', typeof window.XIA_AI === 'undefined');
ok('未泄漏 CFG 到 window', typeof window.CFG === 'undefined');

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' startup tests passed'));
process.exit(fail ? 1 : 0);
