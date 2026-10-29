// tools.js 纯函数回归测试：代码题判定 / run 块提取与剥离 / 运行结果格式化
// runJs 依赖真实 Worker（jsdom 无），由 test-qa.js 以桩替身覆盖循环编排。
// 运行：node tests/test-tools.js（harness 直加载 src）
const { loadSlice } = require('./harness');

const { XA_TOOLS } = loadSlice(['tools.js'], ['XA_TOOLS']);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};

// ===== needsCodeTool（判定偏宽无害：协议要求模型确有验证价值才运行）=====
eq('判定：Python 输出题', XA_TOOLS.needsCodeTool('以下 Python 代码的输出是什么？print(sum(range(4)))'), true);
eq('判定：带代码围栏', XA_TOOLS.needsCodeTool('```python\nfor i in range(3): print(i)\n``` 上述程序的运行结果为？'), true);
eq('判定：补全代码', XA_TOOLS.needsCodeTool('阅读程序，补全横线处的代码'), true);
eq('判定：Java 返回值', XA_TOOLS.needsCodeTool('Java 中 public static void main 方法的返回值是什么？'), true);
eq('判定：JS 函数片段', XA_TOOLS.needsCodeTool('函数 function f(n){ return n<2?1:n*f(n-1) } 执行 f(5) 的结果是'), true);
eq('判定：常识题不误报', XA_TOOLS.needsCodeTool('中国的首都是哪里？'), false);
eq('判定：时事题不误报', XA_TOOLS.needsCodeTool('2026 年世界杯在哪国举办？'), false);
eq('判定：纯算术不误报', XA_TOOLS.needsCodeTool('计算 123+456 的结果是多少？'), false);
eq('判定：普通主观题不误报', XA_TOOLS.needsCodeTool('简述新文化运动的历史意义'), false);
eq('判定：空串安全', XA_TOOLS.needsCodeTool(''), false);

// ===== needsWriteCode（主观题代码编写题：决定答题风格，与 needsCodeTool 互补）=====
eq('写码：MATLAB while 脚本（真机截图题）', XA_TOOLS.needsWriteCode('请用 MATLAB 编写脚本，使用 while 循环计算 1 到 50 之间所有偶数的和，并将结果输出到命令窗口。'), true);
eq('写码：Python 函数', XA_TOOLS.needsWriteCode('请编写 Python 函数判断一个数是否为素数'), true);
eq('写码：C 语言程序', XA_TOOLS.needsWriteCode('用 C 语言编写程序求 1-100 之间所有素数之和'), true);
eq('写码：实现排序算法', XA_TOOLS.needsWriteCode('用 Python 实现快速排序'), true);
eq('写码：SQL 语句', XA_TOOLS.needsWriteCode('编写 SQL 语句查询成绩最高的学生姓名'), true);
eq('写码：题干带代码围栏', XA_TOOLS.needsWriteCode('```python\nfor i in range(3):\n``` 补全上述代码'), true);
eq('写码：理解类不误报（论述否决）', XA_TOOLS.needsWriteCode('谈谈你对面向对象程序设计的理解'), false);
eq('写码：简述算法特征不误报', XA_TOOLS.needsWriteCode('简述算法的五个重要特征'), false);
eq('写码：写出区别不误报', XA_TOOLS.needsWriteCode('请写出 TCP 与 UDP 的主要区别'), false);
eq('写码：论述发展历史不误报', XA_TOOLS.needsWriteCode('论述计算机操作系统的发展历史'), false);
eq('写码：空串安全', XA_TOOLS.needsWriteCode(''), false);

// ===== extractRunBlock / stripRunBlocks =====
eq('提取：标准 run 块', XA_TOOLS.extractRunBlock('分析如下：\n```run\nconsole.log(1+1)\n```\n最终答案 A'), 'console.log(1+1)\n');
eq('提取：无换行紧贴代码', XA_TOOLS.extractRunBlock('```run var a=1; a*2```'), 'var a=1; a*2');
eq('提取：多个块取第一个', XA_TOOLS.extractRunBlock('```run\nfirst()\n```\n中间文本\n```run\nsecond()\n```'), 'first()\n');
eq('提取：无块返回 null', XA_TOOLS.extractRunBlock('答案：B'), null);
eq('提取：普通围栏不算 run', XA_TOOLS.extractRunBlock('```python\nprint(1)\n```'), null);
eq('剥离：去掉全部 run 块保留正文', XA_TOOLS.stripRunBlocks('```run\nvar x=1\n```\n运行正确。\n```run\nvar y=2\n```\n答案：A'), '运行正确。\n\n答案：A');
eq('剥离：无块原样（trim）', XA_TOOLS.stripRunBlocks('  答案：B  '), '答案：B');

// ===== formatRunResult =====
eq('格式化：日志+结果', XA_TOOLS.formatRunResult({ logs: ['6'], result: '6', error: null }).indexOf('日志：\n6') >= 0
    && XA_TOOLS.formatRunResult({ logs: ['6'], result: '6', error: null }).indexOf('表达式结果：6') >= 0, true);
eq('格式化：错误优先展示', XA_TOOLS.formatRunResult({ logs: [], result: null, error: 'x is not defined' }).indexOf('错误：x is not defined') >= 0, true);
eq('格式化：无日志占位', XA_TOOLS.formatRunResult({ logs: [], result: '42', error: null }).indexOf('（无日志输出）') >= 0, true);
eq('格式化：undefined 结果', XA_TOOLS.formatRunResult({ logs: [], result: null, error: null }).indexOf('undefined') >= 0, true);
eq('格式化：超长截断 900', XA_TOOLS.formatRunResult({ logs: [new Array(2000).join('x')], result: '', error: null }).length <= 900, true);
eq('格式化：空对象安全', XA_TOOLS.formatRunResult(null).indexOf('（无日志输出）') >= 0, true);

// ===== runJs 网络软封锁（同步路径可在无 Worker 环境直接断言）=====
{
    let got = null;
    XA_TOOLS.runJs('fetch("https://evil.example")', r => { got = r; });
    eq('软封锁：fetch 拦截并说明原因', !!got && /网络访问被禁用/.test(got.error), true);
    got = null;
    XA_TOOLS.runJs('new WebSocket("wss://x")', r => { got = r; });
    eq('软封锁：WebSocket 拦截', !!got && /网络访问被禁用/.test(got.error), true);
}

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' tools tests passed'));
process.exit(fail ? 1 : 0);
