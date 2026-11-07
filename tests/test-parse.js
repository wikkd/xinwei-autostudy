// parseAnswer/matchByText 回归测试：harness 直加载 src（qa.js + 依赖）
// 运行：node tests/test-parse.js
const { loadSlice } = require('./harness');

// qa.js 顶层需要 utils.js（qsa/qtext 等）。sites.js 提供解析函数（qa.js 无 DOM 引用需求）。
// tools.js 提供 XA_TOOLS：buildPrompt 主观题分支引用 needsWriteCode/needsCalcTool 判定
const { XIA_AI, XA_TOOLS, xaFmtTok } = loadSlice(['utils.js', 'sites.js', 'tools.js', 'qa.js'], ['XIA_AI', 'XA_TOOLS', 'xaFmtTok']);
const parseAnswer = XIA_AI.parseAnswer.bind(XIA_AI); // bind 保 this（内部调 this.matchByText）
const matchByText = XIA_AI.matchByText.bind(XIA_AI);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};

// ===== 单选：原有四级阶梯不受影响 =====
eq('single bare', parseAnswer('B', 'single'), 'B');
eq('single guided', parseAnswer('正确答案是 C。', 'single'), 'C');
eq('single leading', parseAnswer('D. 选项', 'single'), 'D');
eq('single filler', parseAnswer('The answer is A', 'single'), 'A');
eq('single none', parseAnswer('我觉得选「分位数」', 'single'), null); // 无合法集时维持旧行为

// ===== 单选：幻觉字母越界校验 =====
eq('single overflow E', parseAnswer('E', 'single', 'ABCD'), null); // 越界 → strict 重试
eq('single overflow guided', parseAnswer('答案是 E', 'single', 'ABCD'), null);
eq('single valid A', parseAnswer('A', 'single', 'AB'), 'A');

// ===== 单选：选项文本反查（模型直接回文本） =====
const opts4 = [
    { letter: 'A', text: '均值' }, { letter: 'B', text: '方差' },
    { letter: 'C', text: '分位数' }, { letter: 'D', text: '众数' },
];
eq('single bytext', parseAnswer('我觉得应该是「分位数」', 'single', 'ABCD', opts4), 'C');
eq('single bytext bool', parseAnswer('这个说法是正确的。', 'single', 'AB', [{ letter: 'A', text: '对' }, { letter: 'B', text: '错' }]), null); // 「正确」≠「对」2字门槛防误判
eq('matchByText longest', matchByText('先说均值与方差，关键是分位数', 'ABCD', opts4), 'C'); // 多选项命中取最长
eq('matchByText none', matchByText('无法确定', 'ABCD', opts4), '');

// ===== 多选：分级提取，防英文污染；结果统一排序去重（与题库入库格式一致） =====
eq('multi bare', parseAnswer('ABC', 'multi'), 'ABC');
eq('multi bare spaces', parseAnswer('A、B、C', 'multi'), 'ABC');
eq('multi bare reorder', parseAnswer('CAB', 'multi'), 'ABC'); // 排序规范化
eq('multi guided', parseAnswer('正确答案：ABD', 'multi'), 'ABD');
eq('multi guided long', parseAnswer('正确答案为 A、C、D。', 'multi'), 'ACD');
eq('multi guided conj', parseAnswer('应选 A 与 C', 'multi', 'ABCDE'), 'AC'); // 「与」分隔不截断
eq('multi filler no-poison', parseAnswer('Based on 分析，正确答案是 BD', 'multi', 'ABCDE'), 'BD'); // 前两级命中，不全文抓
eq('multi fulltext letters', parseAnswer('A 和 C', 'multi'), 'AC'); // 兜底全文抓（「和」在 bare 分隔符内直接命中）
eq('multi dedupe', parseAnswer('AAC', 'multi'), 'AC');
eq('multi overflow', parseAnswer('ABF', 'multi', 'ABCDE'), null); // F 越界，仍需 strict 重试
// 末行层：多选新 prompt 要求「逐项判断后最后一行给答案」，末行命中须先于全文抓（防分析行字母污染）
eq('multi lastline after guided', parseAnswer('A：正确，理由略\nB：错误，理由略\nC：正确，理由略\n答案：AC', 'multi', 'ABCD'), 'AC');
eq('multi lastline plain', parseAnswer('A：正确\nB：错误\nC：正确\nD：错误\nAC', 'multi', 'ABCD'), 'AC');
eq('multi lastline single', parseAnswer('A：错\nB：错\nC：对\nD：错\nC', 'multi', 'ABCD'), 'C');
eq('multi lastline punct tail', parseAnswer('A：对\nB：对\nAB。', 'multi', 'ABCD'), 'AB');
eq('multi lastline analysis-not-answer', parseAnswer('A：正确\nB：错误\nC：错误\nD：错误', 'multi', 'ABCD'), 'ABCD'); // 无最终答案行退回全文抓（旧行为兜底）
eq('multi lastline overflow null', parseAnswer('E：对\nF：错', 'multi', 'ABCD'), null); // 越界 → strict 重试

// ===== 填空/主观不受影响 =====
eq('cloze single', parseAnswer('isinstance()', 'cloze'), 'isinstance()');
eq('cloze numbered', parseAnswer('1. 甲\n2. 乙', 'cloze'), '甲|乙');
eq('subjective passthrough', parseAnswer('论述正文……', 'subjective').slice(0, 4), '论述正文');

// ===== 主观题代码围栏剥壳（代码题模型常无视「不要围栏」把整段答案包进 ```lang…```） =====
eq('subjective fence strip matlab', parseAnswer('```matlab\nn = 1;\nwhile n <= 50\n```', 'subjective'), 'n = 1;\nwhile n <= 50');
eq('subjective fence strip plain', parseAnswer('```\nx = 1\n```', 'subjective'), 'x = 1');
eq('subjective fence strip crlf', parseAnswer('```python\r\nprint(1)\r\n```', 'subjective'), 'print(1)');
eq('subjective fence unclosed keep', parseAnswer('```matlab\nn = 1', 'subjective').indexOf('```') >= 0, true); // 未闭合不动
eq('subjective fence inline keep', parseAnswer('前文\n```py\nx=1\n```\n后文', 'subjective').indexOf('前文') >= 0, true); // 正文内嵌围栏不剥

// ===== buildPrompt：判断题识别（选项带字母前缀 T.对/F.错 也得识别） =====
const buildPrompt = XIA_AI.buildPrompt.bind(XIA_AI);
const bpBool = buildPrompt('K线图的type值为sankey', [{ letter: 'A', text: 'T.对' }, { letter: 'B', text: 'F.错' }], 'single', '', 0, 0);
eq('prompt bool detected', /判断题/.test(bpBool) && /输出 A/.test(bpBool), true);
eq('prompt bool no options echoed', bpBool.indexOf('选项：') < 0, true);
eq('prompt bool counterexample gate', /反例/.test(bpBool) && /绝对化/.test(bpBool), true); // 先找反例再下结论（77分复盘：判断题丢分主因）
eq('prompt bool textbook-strict gate', /严格定义/.test(bpBool) && /范围被扩大或缩小/.test(bpBool), true); // 防 Q29 式术语泛化（子代/子元素）
const bpSingle = buildPrompt('下面的概念与箱线图无关的是', opts4, 'single', '', 0, 0);
eq('prompt single negative hint', /否定式提问/.test(bpSingle), true);
eq('prompt single no-first-bias', /不要默认选第一个选项/.test(bpSingle), true); // 防 A 选项偏置（日志实证 7 判断题 6 次答 A）
eq('prompt single fake-api guard', /编造的 API/.test(bpSingle) && /getFirstElementByClass/.test(bpSingle), true); // 防 D3/MATLAB 编造 API（过往错题）
const bpMulti = buildPrompt('属于学说的是', opts4, 'multi', '', 0, 0);
eq('prompt multi anti-conservative', /漏选与错选都不得分/.test(bpMulti) && /不要保守漏选/.test(bpMulti), true); // 防 Q16 式漏选（旧「拿不准宁可不选」已删）
eq('prompt multi single-letter guard', /很少只有 1 个/.test(bpMulti) && /重新核查/.test(bpMulti), true); // 防 Q9/Q10/Q12 式只答单字母
eq('prompt multi fake-term guard', /编造术语/.test(bpMulti) && /单峰式命名/.test(bpMulti), true); // 防 Q15 式误信编造词

// ===== buildPrompt：主观题代码编写题走代码模板，论述题保持论述模板 =====
const bpCode = buildPrompt('请用 MATLAB 编写脚本，使用 while 循环计算 1 到 50 之间所有偶数的和，并将结果输出到命令窗口。', [], 'subjective', '', 5, 0);
eq('prompt subjective code template', /完整代码/.test(bpCode) && /不要用 Markdown 代码块围栏/.test(bpCode), true);
eq('prompt subjective code no essay', /自然段/.test(bpCode), false);
eq('prompt subjective essay kept', /自然段/.test(buildPrompt('谈谈大数据对社会治理的影响', [], 'subjective', '', 5, 0)), true);

// ===== buildPrompt：课程背景注入（第 7 参，未传/空串保持旧行为） =====
const bpCourse = buildPrompt('下列排序算法中平均时间复杂度最低的是', opts4, 'single', '', 0, 0, '数据结构 · 第二章 排序');
eq('prompt course injected', /课程背景/.test(bpCourse) && bpCourse.indexOf('数据结构 · 第二章 排序') >= 0, true);
eq('prompt course absent', /课程背景/.test(buildPrompt('题干示例', opts4, 'single', '', 0, 0)), false);

// ===== 课程语言记忆（记住这门课学什么语言，≥2 次注入 prompt） =====
XIA_AI.log = () => {}; // 阈值提示走面板日志，node 无 DOM 先静音
XIA_AI.courseLangReset();
eq('语言记忆：学习前无注入', XIA_AI.courseLangLine('数据可视化技术 · 期中'), '');
XIA_AI.rememberCourseLang('数据可视化技术 · 期中', '使用MATLAB编写脚本计算1到50之间所有偶数的和');
eq('语言记忆：仅 1 次不注入', XIA_AI.courseLangLine('数据可视化技术 · 期中'), '');
XIA_AI.rememberCourseLang('数据可视化技术 · 实验', 'MATLAB中判断变量A是否为空的函数是');
const langLine = XIA_AI.courseLangLine('数据可视化技术 · 任意作业名');
eq('语言记忆：2 次后注入', /MATLAB/.test(langLine) && /isempty/.test(langLine), true);
eq('语言记忆：按课程名首段为键（作业名不同也命中）', langLine !== '', true);
eq('语言记忆：其他课程不串味', XIA_AI.courseLangLine('高等数学 · 期末'), '');
XIA_AI.rememberCourseLang('数据可视化技术 · 实验', '在D3中如何选择页面上的第一个匹配元素');
XIA_AI.rememberCourseLang('数据可视化技术 · 实验', '在D3中如何沿曲线路径添加文字标签');
const langLine2 = XIA_AI.courseLangLine('数据可视化技术 · 实验');
eq('语言记忆：多语言按次数排序', /^【课程语言记忆】本课程题目主要涉及 MATLAB、D3/.test(langLine2), true);
eq('语言记忆：变体归一（js→JavaScript）', (() => {
    XIA_AI.rememberCourseLang('前端课 · 一', '用JavaScript实现数组去重');
    XIA_AI.rememberCourseLang('前端课 · 二', 'js中let与var的区别');
    return /JavaScript/.test(XIA_AI.courseLangLine('前端课 · 三'));
})(), true);
eq('语言记忆：空课程不记', (() => {
    XIA_AI.rememberCourseLang('', 'MATLAB题干');
    XIA_AI.rememberCourseLang('   ', 'MATLAB题干');
    return XIA_AI.courseLangLine('') === '' && XIA_AI.courseLangKey('   ') === '';
})(), true);
XIA_AI.courseLangReset();

// ===== buildPrompt：主观题按分值要点化（平台按要点给分，每段首句踩分点） =====
const bpPts = buildPrompt('谈谈大数据对社会治理的影响', [], 'subjective', '', 10, 0);
eq('prompt subjective points', /要点/.test(bpPts) && /踩分点/.test(bpPts), true);
eq('prompt multi final-line format', /答案：/.test(buildPrompt('属于学说的是', opts4, 'multi', '', 0, 0)), true);

// ===== needsCalcTool：纯计算题走沙箱验证（代码题仍归 needsCodeTool，检索型问句排除） =====
const calc = q => XA_TOOLS.needsCalcTool(q);
eq('calc probability', calc('袋中有5个红球3个白球，任意取出2个，计算取到2个红球的概率是多少'), true);
eq('calc arithmetic', calc('计算 17*23+45/9 的结果是多少'), true);
eq('calc derivative', calc('求 y=x²+2x 在 x=3 处的导数'), true);
eq('calc big multiply', calc('请计算 38291 乘以 4712 等于多少'), true);
eq('calc year fact', calc('新中国成立在哪一年'), false);
eq('calc concept essay', calc('谈谈你对函数概念的理解'), false);
eq('calc code stays code', calc('```python\nprint(1)\n```'), false);

// ===== xaFmtTok：面板 token 统计缩写 =====
eq('fmtTok under 1k', xaFmtTok(940), '940');
eq('fmtTok exact 1k', xaFmtTok(1000), '1k');
eq('fmtTok 1.2k', xaFmtTok(1234), '1.2k');
eq('fmtTok 15.3k', xaFmtTok(15300), '15.3k');
eq('fmtTok zero', xaFmtTok(0), '0');
eq('fmtTok NaN', xaFmtTok(undefined), '0');

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' parse tests passed'));
process.exit(fail ? 1 : 0);
