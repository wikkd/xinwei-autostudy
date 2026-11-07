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

    // 代码编写题判定（主观题要求「写代码/脚本/程序/函数」）：决定主观题答题风格——
    // 答案应为可直接运行的完整代码而非论述文。与 needsCodeTool 互补：后者决定是否启用
    // 沙箱工具循环，本判定只改写提示词。偏窄的代价是代码题被写成议论文（用户一眼可见
    // 的错误），偏宽的代价是论述题误要求出代码——故带论述类动词否决兜底。
    needsWriteCode(question) {
        const q = String(question || '');
        if (!q) return false;
        if (/```/.test(q)) return true; // 题干带代码围栏：补全/续写类，答案必是代码
        const langHit = /MATLAB|Python(?:\s*3)?|JavaScript|\bJava\b|C\+\+|C语言|C#|SQL|PHP|Go语言|Rust|Ruby|Swift|Kotlin|Scala|Perl|R语言|VBA|Fortran|汇编|伪代码|易语言/i.test(q);
        const artifactHit = /代码|脚本|程序|函数|语句|算法|伪代码|命令窗口/.test(q);
        const verbHit = /编写|写出|实现|设计|完成|给出|编制|生成/.test(q);
        if (!(langHit && (artifactHit || verbHit)) && !(artifactHit && verbHit)) return false;
        // 论述类动词否决（无具体语言名时）：「谈谈你对面向对象程序设计的理解」仍按议论文作答
        if (!langHit && /谈谈|简述|论述|评述|赏析|的看法|的理解|心得|体会|认识/.test(q)) return false;
        return true;
    },

    // 计算题判定（无代码痕迹的数值计算类）：让算术/概率/统计/导数等题也走沙箱工具循环——
    // 沙箱算术比模型心算可靠（进位/大数/多步运算 reasoner 也会翻车）。与 needsCodeTool
    // 互补：后者管代码题（代码围栏/语言痕迹），这里管「纯计算」题。判定偏宽无害——工具
    // 协议要求模型「确有验证价值才运行」，误判只多花一两轮 token；偏窄的代价是心算答错。
    needsCalcTool(question) {
        const q = String(question || '');
        if (!q || XA_TOOLS.needsCodeTool(q)) return false; // 代码题已由 needsCodeTool 接管
        // 必须有明确计算指令（防「世界上有多少个国家」「新中国成立在哪一年」这类检索型问句误入）
        if (!/计算|求解|求出|求.{0,20}(值|导数|积分|极限|概率|期望|方差|面积|体积|根|解|和|积|差|余数|最小值|最大值)|运算|化简|换算|等于多少|结果是多少|值是多少|之(和|积|差|比)|一共多少|总共多少/.test(q)) return false;
        // 数学语义三路任一即认定：学科名词 / 运算符密度 / 数字个数
        const noun = /概率|期望|方差|标准差|均值|平均数|中位数|众数|排列|组合|阶乘|方程|不等式|积分|导数|微分|极限|矩阵|行列式|向量|数列|公比|公差|复利|利率|利息|增长率|百分(比|数)|浓度|速度|路程|加速度|面积|体积|周长|弧度|进制|余数|取模|最大公约数|最小公倍数|交集|并集|正态分布|二项分布|样本/.test(q);
        const ops = (q.match(/[+\-×÷*/^±√π≤≥]/g) || []).length;
        const nums = (q.match(/\d+(?:\.\d+)?/g) || []).length;
        return noun || ops >= 2 || nums >= 2;
    },

    // 检索增强触发判定（RAG 门控，qa.callAI 调用）：事实/时事类题目先搜资料再作答。
    // 与上面三个 needsXxx 同属「题目分类器」，收敛到 XA_TOOLS 统一维护与单测。
    // 只做「要不要搜」的粗判：命中即搜（searchMode=auto 且非主观/填空时），
    // 漏判的代价只是少一层资料佐证，误判的代价是一次外部检索（风险项默认 off）。
    needsSearch(question) {
        const q = question || '';
        if (/(世界|国际|全球|国外|海外|外国)/.test(q)) return true;
        if (/(19|20)\d{2}\s*年|哪一年|成立于|创立于|发明|发现|首次|第一次|总统|总理|主席|首相|元首|首都|人口|GDP|经济总[量值]|世界杯|奥运|历史|地理|政治|名人|品牌|公司|企业|最新|目前|截至|现任|多少岁|面积|海拔|发明者|作者|画家|科学家/.test(q)) return true;
        if (/\d{3,}/.test(q)) return true;
        // 技术概念判断/选择题：Web 前端等课程的判断题大量考「属性/标签/语法细节」，
        // 模型裸答易错（77分复盘：<body>/<head> 关系判断题丢分），检索文档级佐证成本低；
        // 过往错题补充：D3/MATLAB 等课程工具词与可视化类（D3 select 题、MATLAB isempty 题裸答丢分）
        if (/(HTML|CSS|JavaScript|JS|DOM|HTTP|HTTPS|URL|URI|JSON|XML|SQL|Python|Java|Vue|React|Node|W3C|ES6|D3|MATLAB|numpy|pandas|matplotlib|ECharts)\b|标签|选择器|属性值?|伪类|伪元素|盒模型|布局|浏览器|可视化/i.test(q)) return true;
        // 思政/国家安全教育课：答案在教材课件里，搜索引擎常有原题（过往错题：国土安全途径、生态安全因素）
        if (/国土安全|国家安全|生态安全|军事安全|经济安全|网络安全|文化安全|社会安全|科技安全/.test(q)) return true;
        return /[A-Za-z]{3,}\s*(公司|大学|奖|协议|法案|组织)/.test(q);
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
