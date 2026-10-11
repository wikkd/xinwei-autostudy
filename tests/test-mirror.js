// 镜像逻辑回归测试：xaApiMirrorTopic 用真机校准数据验证 hash 与答案映射
// 运行：node tests/test-mirror.js（harness 直加载 src，DOM 用最小桩）
const { loadSlice } = require('./harness');

// xaApiMirrorTopic 依赖 xaApiPlain（document.createElement + innerHTML/textContent）→ 桩进沙箱
const domStub = {
    document: {
        createElement: () => ({
            _v: '',
            set innerHTML(v) { this._v = v; },
            get textContent() { return String(this._v).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '); },
        }),
    },
};
const { xaApiMirrorTopic, questionHash } = loadSlice(
    ['utils.js', 'sites.js'], ['xaApiMirrorTopic', 'questionHash'], domStub);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) { pass++; }
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};

// ===== 真机校准数据（2026-10-10 真机双端验证 11/11 的同源样例） =====

// ① 单选（数据可视化 箱线图题，DOM hash 已验证一致）
const t1 = {
    topicType: 'danxuan',
    topicTitle: '下面的概念与箱线图的绘制无关的是（     ）',
    topicQuestionCoreDtoList: [
        { index: 'A', content: '均值', isAnswer: false },
        { index: 'B', content: '方差', isAnswer: false },
        { index: 'C', content: '分位数', isAnswer: true },
        { index: 'D', content: '众数', isAnswer: false },
    ],
    topicRightAnswerList: ['C'],
    topicScore: '16', topicThisQuestionScore: '16',
};
const m1 = xaApiMirrorTopic(t1);
eq('danxuan type', m1 && m1.q.type, 'single');
eq('danxuan answer', m1 && m1.answer, 'C');
eq('danxuan hash', questionHash(m1.q), ' 下面的概念与箱线图的绘制无关的是（ ）|AA.均值,BB.方差,CC.分位数,DD.众数');

// ② 多选（艺术修养 艺术起源五学说）
const m2 = xaApiMirrorTopic({
    topicType: 'duoxuan',
    topicTitle: '3-1下列属于艺术起源五种学说的是',
    topicQuestionCoreDtoList: [
        { index: 'A', content: '模仿说' }, { index: 'B', content: '巫术说' }, { index: 'C', content: '游戏说' },
        { index: 'D', content: '表现说' }, { index: 'E', content: '劳动说' },
    ],
    topicRightAnswerList: ['A', 'B', 'C', 'D', 'E'],
});
eq('duoxuan type', m2 && m2.q.type, 'multi');
eq('duoxuan answer', m2 && m2.answer, 'ABCDE');
eq('duoxuan hash', questionHash(m2.q), ' 3-1下列属于艺术起源五种学说的是|AA.模仿说,BB.巫术说,CC.游戏说,DD.表现说,EE.劳动说');

// ③ 判断（T→A / F→B；DOM 端字母按位置 A/B）
const m3a = xaApiMirrorTopic({
    topicType: 'panduan',
    topicTitle: 'K线图的series中的type值为sankey。',
    topicQuestionCoreDtoList: [{ index: 'T', content: '对' }, { index: 'F', content: '错' }],
    topicRightAnswerList: ['F'],
});
eq('panduan-F answer', m3a && m3a.answer, 'B');
eq('panduan hash', questionHash(m3a.q), ' K线图的series中的type值为sankey。|AT.对,BF.错');
const m3b = xaApiMirrorTopic({
    topicType: 'panduan',
    topicTitle: '单层的旭日图其实类似于圆环图。',
    topicQuestionCoreDtoList: [{ index: 'T', content: '对' }, { index: 'F', content: '错' }],
    topicRightAnswerList: ['T'],
});
eq('panduan-T answer', m3b && m3b.answer, 'A');

// ④ 填空（题干取 topicContent 去下划线，答案 join '|'；hash 选项段 = cloze 占位）
const m4 = xaApiMirrorTopic({
    topicType: 'tiankong',
    topicTitle: 'Python中用于检查变量类型的函数是_________。',
    topicContent: 'Python中用于检查变量类型的函数是_________。',
    topicRightAnswerList: ['isinstance()'],
});
eq('tiankong type', m4 && m4.q.type, 'cloze');
eq('tiankong answer', m4 && m4.answer, 'isinstance()');
eq('tiankong hash tail', questionHash(m4.q).endsWith('|cloze'), true);
eq('tiankong no underscore', /_/.test(m4.q.question), false);

// ⑤ 多空填空（right: ['not,or'] → 'not|or'）
const m4b = xaApiMirrorTopic({
    topicType: 'tiankong',
    topicTitle: '在Python中，_________运算符的优先级最高。',
    topicContent: '在Python中，_________运算符的优先级最高。',
    topicRightAnswerList: ['not,or'],
});
eq('tiankong multi answer', m4b && m4b.answer, 'not|or');

// ⑥ 主观（wenda：答案取平台参考答案，type=subjective，hash 占位 subj）
const m5 = xaApiMirrorTopic({
    topicType: 'wenda',
    topicTitle: '谈谈中国式现代化为何是走和平发展道路的现代化？',
    topicRightAnswerList: ['<p>中国式现代化走和平发展道路。</p>'],
});
eq('wenda type', m5 && m5.q.type, 'subjective');
eq('wenda answer', m5 && m5.answer, '中国式现代化走和平发展道路。');
eq('wenda hash tail', questionHash(m5.q).endsWith('|subj'), true);

// ⑦ 无答案不采
eq('no answer → null', xaApiMirrorTopic({ topicType: 'danxuan', topicTitle: '测试题', topicQuestionCoreDtoList: [{ index: 'A', content: 'x' }], topicRightAnswerList: [] }), null);

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' mirror tests passed'));
process.exit(fail ? 1 : 0);
