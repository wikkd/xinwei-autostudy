// ==================== 测试 harness（源码直加载）====================
// 替代旧的「从 dist 文本抠函数」：用 node:vm 把 src 模块拼成 IIFE 在沙箱运行，
// 暴露内部符号供断言。函数签名变化会立刻报错（旧方式会静默失效）。
// 用法：
//   const { loadSlice, makeSandbox } = require('./harness');
//   const { fn } = loadSlice(['utils.js'], ['routeHasQuestions']);

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

// 读取并拼接指定模块（保持 build.js 的同款拼接顺序语义：调用方自己排好序）
function readModules(files) {
    return files.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
}

// 加载切片：沙箱内跑 [files...]，用 __expose 取需要的顶层函数/常量。
// 只跑需要的模块，避免 ui.js/autoplay.js 的 DOM 依赖。
function loadSlice(files, expose, extraGlobals) {
    const src = readModules(files);
    const names = expose.slice();
    const exposeLines = names.map(n => `__expose[${JSON.stringify(n)}] = typeof ${n} !== 'undefined' ? ${n} : undefined;`).join('\n');
    const script = src + '\n' + exposeLines;
    const sandbox = Object.assign({
        __expose: {},
        console: console,
        module: { exports: {} },
        // 浏览器/DOM 最小桩：模块顶层不应触碰 DOM，触碰即报错（测试暴露耦合）
        window: {},
        document: { querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ set innerHTML(v) {}, get textContent() { return ''; } }), addEventListener: () => {} },
    }, extraGlobals || {});
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox, { filename: files.join('+') });
    const out = sandbox.__expose;
    const missing = names.filter(n => out[n] === undefined);
    if (missing.length) throw new Error('harness: 无法暴露 ' + missing.join(', ') + '（名称不存在或加载顺序不对）');
    return out;
}

// 自由沙箱：调用方给完整代码与全局桩（tiku 上传测试等重场景用）
function makeSandbox(code, globals) {
    const sandbox = Object.assign({ console: console }, globals || {});
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'sandbox' });
    return sandbox;
}

// 编译器断言：模块必须能被解析（构建前的快速语法门）
function parseCheck(files) {
    const src = readModules(files);
    new vm.Script('(function(){ "use strict";\n' + src + '\n})();', { filename: files.join('+') });
}

module.exports = { readModules, loadSlice, makeSandbox, parseCheck, SRC };
