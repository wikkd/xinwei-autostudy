// parseAnswer/matchByText 回归测试：harness 直加载 src（qa.js + 依赖）
// 运行：node tests/test-parse.js
const { loadSlice } = require('./harness');

// qa.js 顶层需要 utils.js（qsa/qtext 等）。sites.js 提供解析函数（qa.js 无 DOM 引用需求）
const { XIA_AI } = loadSlice(['utils.js', 'sites.js', 'qa.js'], ['XIA_AI']);
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

// ===== 填空/主观不受影响 =====
eq('cloze single', parseAnswer('isinstance()', 'cloze'), 'isinstance()');
eq('cloze numbered', parseAnswer('1. 甲\n2. 乙', 'cloze'), '甲|乙');
eq('subjective passthrough', parseAnswer('论述正文……', 'subjective').slice(0, 4), '论述正文');

// ===== buildPrompt：判断题识别（选项带字母前缀 T.对/F.错 也得识别） =====
const buildPrompt = XIA_AI.buildPrompt.bind(XIA_AI);
const bpBool = buildPrompt('K线图的type值为sankey', [{ letter: 'A', text: 'T.对' }, { letter: 'B', text: 'F.错' }], 'single', '', 0, 0);
eq('prompt bool detected', /判断题/.test(bpBool) && /输出 A/.test(bpBool), true);
eq('prompt bool no options echoed', bpBool.indexOf('选项：') < 0, true);
const bpSingle = buildPrompt('下面的概念与箱线图无关的是', opts4, 'single', '', 0, 0);
eq('prompt single negative hint', /否定式提问/.test(bpSingle), true);
const bpMulti = buildPrompt('属于学说的是', opts4, 'multi', '', 0, 0);
eq('prompt multi certainty hint', /错选不得分/.test(bpMulti), true);

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' parse tests passed'));
process.exit(fail ? 1 : 0);
