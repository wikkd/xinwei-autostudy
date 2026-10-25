// ==================== 本机沙箱代码执行（代码题工具）====================
// 给 LLM 的「本机工具」：判定为代码题时，模型可在本机 Worker 沙箱里实际运行自己写的
// JavaScript（非 JS 代码翻译成等价 JS 验证），日志/结果/错误回灌给模型多轮迭代，
// 得出验证过的最终答案。用于「程序输出 / 补全代码 / 复杂计算」类题目。
//
// 沙箱安全模型（选择 Worker 而非 sandbox iframe 的原因）：
// - Worker 独立线程：5s 超时 terminate() 可真正杀掉同步死循环；iframe 与页面同进程，
//   同步死循环会冻结整个标签页（连本脚本的风控/卡死看门狗都救不了）。
// - Worker 无 DOM；但与页面同源，理论上能带凭据访问芯位接口——故执行前静态拦截常见
//   网络 API（fetch/XMLHttpRequest/WebSocket/importScripts/sendBeacon），模型收到明确
//   报错后通常改用纯计算。该封锁是软性的：对抗性构造（拼接字符串再 eval）可绕过；
//   代码来源是用户自配的 LLM 服务，风险敞口与「模型本身可信」一致，如实记录于此。
// - 执行轮数与时长由 qa.js 的工具循环约束（≤3 轮 / 每轮 5s）。

const XA_TOOLS = {
    // 代码题判定（保守启发式）：代码围栏 / 编程语言痕迹 × 程序语义词。
    // 判定偏宽无害——工具协议要求模型「确有验证价值才运行」；判定偏窄才会漏掉能受益的题。
    needsCodeTool(question) {
        const q = String(question || '');
        if (/```/.test(q)) return true;
        const codeish = /python|javascript|\bjs\b|java\b|c\+\+|#include|代码|程序|函数|伪代码|脚本/i.test(q)
            || /def\s+\w+\s*\(|print\s*\(|console\.log|System\.out|cout\s*<<|int\s+main|public\s+(static\s+)?(void|class)|function\s+\w+\s*\(|=>|var\s+\w+\s*=|let\s+\w+\s*=|const\s+\w+\s*=/.test(q);
        if (!codeish) return false;
        return /(输出|打印|结果|返回值|运行|执行|计算|补全|填空|横线|空白处|错误|bug|调试|等于|是什么|什么)/.test(q);
    },

    // 提取响应中的 ```run 代码块（取第一个；协议约定一次只请求运行一块）
    extractRunBlock(text) {
        const m = String(text || '').match(/```run\s*([\s\S]*?)```/i);
        return m ? m[1] : null;
    },

    // 剥除全部 run 块后的文本（最终答案解析用，防止代码内容污染字母提取）
    stripRunBlocks(text) {
        return String(text || '').replace(/```run[\s\S]*?```/gi, '').trim();
    },

    // 运行结果 → 回灌给模型的紧凑文本（截断防超长日志撑爆上下文）
    formatRunResult(r) {
        const logs = (r && r.logs) || [];
        const head = logs.length ? '日志：\n' + logs.join('\n') : '（无日志输出）';
        const tail = (r && r.error) ? '错误：' + r.error
            : '表达式结果：' + ((r && r.result) == null ? 'undefined' : r.result);
        return (head + '\n' + tail).slice(0, 900);
    },

    // 沙箱执行：Worker 内劫持 console 收集日志，间接 eval 取代码完成值（最后一个表达式的值）。
    // cb({logs:[], result:'...', error:null|string})；5s 超时 terminate（独立线程，杀得死）。
    runJs(code, cb) {
        // 网络出口软封锁（见文件头安全注释）：拦截常见网络 API，报错信息引导模型改纯计算
        if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|importScripts|sendBeacon|navigator\.serviceWorker/i.test(String(code || ''))) {
            cb({ logs: [], error: '网络访问被禁用：沙箱只能做纯 JS 计算，请不要访问网络' });
            return;
        }
        let done = false;
        let w = null;
        let url = null;
        let timer = null;
        const finish = r => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (w) { try { w.terminate(); } catch (e) {} }
            if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
            cb(r);
        };
        timer = setTimeout(() => finish({ logs: [], error: '执行超时（5s，疑似死循环），沙箱已终止' }), 5000);
        const workerSrc = 'self.onmessage = function (ev) {'
            + 'var logs = [];'
            + 'var fmt = function (v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch (e) { return String(v); } };'
            + 'var real = self.console;'
            + 'self.console = {'
            + '  log: function () { logs.push(Array.prototype.map.call(arguments, fmt).join(" ")); },'
            + '  info: function () { logs.push(Array.prototype.map.call(arguments, fmt).join(" ")); },'
            + '  warn: function () { logs.push("[warn] " + Array.prototype.map.call(arguments, fmt).join(" ")); },'
            + '  error: function () { logs.push("[error] " + Array.prototype.map.call(arguments, fmt).join(" ")); }'
            + '};'
            + 'var res = { logs: logs, result: null, error: null };'
            + 'try { res.result = fmt((0, eval)(ev.data)); }'
            + 'catch (err) { res.error = String(err && err.message ? err.message : err); }'
            + 'finally { self.console = real; }'
            + 'self.postMessage(res);'
            + '};';
        try {
            url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
            w = new Worker(url);
            w.onmessage = e => finish(e.data);
            w.onerror = e => finish({ logs: [], error: '沙箱错误: ' + (e && e.message ? e.message : 'unknown') });
            w.postMessage(String(code || ''));
        } catch (e) {
            // Worker 创建失败（页面 CSP 拦截 blob: worker 等）：如实回报，模型转纯推理作答
            finish({ logs: [], error: '沙箱创建失败（可能被页面 CSP 拦截）: ' + (e && e.message ? e.message : e) });
        }
    },
};
