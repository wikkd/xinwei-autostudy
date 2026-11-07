// qa.js 答题状态机回归测试（jsdom + 源码直加载）：scan→callAI→回填→verify→跳题 决策树
// 覆盖：正常答完跳题 / 确认模式暂停 / 回填失败 3 次熔断 / 自动提交与确认模式互斥 / 视频弹题作答
// 运行：node tests/test-qa.js
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
    console.log('ℹ️ 未安装 jsdom，跳过 qa 状态机测试（npm i -D jsdom 启用）');
    process.exit(0);
}

const SRC = path.join(__dirname, '..', 'src');

// jsdom 环境：作业卷面路由（routeHasQuestions 放行）；runScripts 使 eval 作用域内可见 window 自引用
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.beeline-ai.com/student/#/courseInfo/1/homeworkPaperId?homeworkPaperId=9',
    runScripts: 'outside-only',
});
const { window } = dom;

// ---- 环境补桩（jsdom 无布局引擎，visible()/questionRoot 依赖几何值）----
window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0 };
};
for (const proto of [window.HTMLElement.prototype, window.Element.prototype]) {
    for (const prop of ['offsetWidth', 'offsetHeight']) {
        try { Object.defineProperty(proto, prop, { get: () => 100, configurable: true }); } catch (e) {}
    }
}
// setTimeout 同步化：fillChoice 步进/verifyAndAdvance 延迟在测试内立即结算（决策树同步可断言）
window.setTimeout = fn => { try { fn(); } catch (e) { console.log('[t] timer err', e.message); } return 0; };
window.setInterval = () => 0;
window.clearInterval = () => {};

// GM 桩 + 模块加载（保持 build.js 拼接顺序语义）。
// 注意：jsdom 各次 eval 不共享词法绑定——模块与暴露块必须同一次 eval；
// conf 是 let 绑定（loadCfg 会整体重赋值），必须用 getter 惰性取当前值。
const store = {};
window.GM_getValue = (k, d) => (k in store ? store[k] : d);
window.GM_setValue = (k, v) => { store[k] = String(v); };
window.GM_xmlhttpRequest = () => {};
// 文件清单从 build.js 的 BODY_ORDER 派生（单一来源，src 新增/删减自动跟上）；
// ui/autoplay/deadline/bootstrap 依赖真实播放器与常驻定时器，不在本测试范围
const { BODY_ORDER } = require('../build');
const QA_TEST_SKIP = ['ui.js', 'autoplay.js', 'deadline.js', 'bootstrap.js'];
const FILES = BODY_ORDER.filter(f => QA_TEST_SKIP.indexOf(f) < 0);
window.eval(FILES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n') + `
;window.__T = {
    get conf() { return conf; },
    ai: XIA_AI,
    tools: XA_TOOLS,
    markerTick: markerQuestionTick,
    imageQ: isImageAnswerQuestion,
    resetMarker: () => { _mqKey = ''; _mqState = ''; _mqFails = {}; },
    notify: xaNotify,
    notifyReset: () => { for (const k in _xaNotifyAt) delete _xaNotifyAt[k]; },
    setBg: v => { xaPageInBackground = v; },
    realBg: xaPageInBackground, // 先捕获原生判定，测试后还原
    courseCtx: pageCourseContext,
    schedParse: xaParseScheduleRange,
    schedActive: nowMin => xaScheduleActive(nowMin),
    schedGate: nowMin => xaScheduleGate(nowMin),
    schedGateReset: () => { _xaScheduleWasActive = true; },
    qImages: questionImages,
};`);
window.loadCfg(); // 必须在解构前：loadCfg 会整体重赋值 conf，之后 getter 才返回最终对象
const { conf, ai: XIA_AI, tools: XA_TOOLS, markerTick, resetMarker } = window.__T;
const imageQ = window.__T.imageQ;
const _realCallAI = XIA_AI.callAI; // 真实引用：部分用例会以 stub 覆盖 callAI，resetAI 统一恢复

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};
const ok = (label, cond) => eq(label, !!cond, true);

// ---- 夹具：单选题（index-name 字母 + 原生 input，与平台 el-radio 同构）----
function singleChoice(id) {
    window.document.body.innerHTML = `
<div class="homework-single-selected" id="${id}">
  <div class="question-tag-score">单选 10 分</div>
  <div class="topic-title">1. 中国的首都是哪里？</div>
  <label class="el-radio"><span class="index-name">A.</span><span class="label"><span class="index-name">A.</span><span class="option-content">北京</span></span><input type="radio" value="A"></label>
  <label class="el-radio"><span class="index-name">B.</span><span class="label"><span class="index-name">B.</span><span class="option-content">上海</span></span><input type="radio" value="B"></label>
</div>
<button class="toggle-button">下一题</button>
<div id="xa-progress"></div><div id="xa-stats"></div><div id="xa-ai-log"></div>`;
    const radios = window.document.querySelectorAll('#' + id + ' input[type="radio"]');
    return { inputs: radios, nextBtn: window.document.querySelector('.toggle-button') };
}

// 公共：每个用例重置答题状态机（夹具重挂后 lastQuestionHash 等不能串场）
function resetAI(confirmMode) {
    Object.assign(XIA_AI, {
        lastQuestionHash: '', answering: false, answeringOnce: false,
        _failHash: '', _failCount: 0, _skipHash: '', _skipCount: 0,
        _submitting: false, _lastSubmitTry: 0, _donePage: '', _nextAnswerAt: 0, _cfgError: null,
        _lastNav: 0, _imgLogged: '', _imgBusyHash: '', _answerMemo: {},
    });
    XIA_AI.callAI = _realCallAI;
    XIA_AI.stats = { answered: 0, submitted: 0, failed: 0, tokensIn: 0, tokensOut: 0 };
    resetMarker(); // 弹题状态机（popup.js 模块级 let，须经闭包复位）
    conf.autoAnswer = true;
    conf.autoSubmit = false;
    conf.answerDelay = '0';
    conf.confirmAnswer = !!confirmMode;
}

// ===== ① 正常流程：AI 答案 → 回填生效 → 自动跳题 =====
{
    resetAI(false);
    const fx = singleChoice('q1');
    let nextClicked = 0;
    fx.nextBtn.addEventListener('click', () => nextClicked++);
    const asked = [];
    XIA_AI.callAI = (q, cb) => { asked.push(q.question); cb('A'); };
    XIA_AI.scan();
    eq('正常流程：callAI 被调用', asked.length, 1);
    eq('正常流程：选项 A 已选中', fx.inputs[0].checked, true);
    eq('正常流程：自动跳下一题', nextClicked, 1);
    eq('正常流程：统计已答', XIA_AI.stats.answered, 1);
    eq('正常流程：hash 已清（可继续答下一题）', XIA_AI.lastQuestionHash, '');
    eq('正常流程：answering 复位', XIA_AI.answering, false);
}

// ===== ② 确认模式：填完暂停，不跳题不重答 =====
{
    resetAI(true);
    const fx = singleChoice('q2');
    let nextClicked = 0;
    fx.nextBtn.addEventListener('click', () => nextClicked++);
    XIA_AI.callAI = (q, cb) => cb('B');
    XIA_AI.scan();
    eq('确认模式：选项已填', fx.inputs[1].checked, true);
    eq('确认模式：不自动跳题', nextClicked, 0);
    eq('确认模式：统计已答', XIA_AI.stats.answered, 1);
    const progress = window.document.getElementById('xa-progress').textContent;
    eq('确认模式：进度提示待人工确认', progress.indexOf('⏸') === 0, true);
    eq('确认模式：hash 保留（防同题重答）', typeof XIA_AI.lastQuestionHash, 'string');
    // 再扫一轮：同题不重答（hash 幂等），人工未操作前状态稳定
    const before = XIA_AI.stats.answered;
    XIA_AI.scan();
    eq('确认模式：重复扫描不重答', XIA_AI.stats.answered, before);
    eq('确认模式：仍未跳题', nextClicked, 0);
}

// ===== ③ 回填失败熔断：连续 3 次未生效 → 标记跳过 =====
{
    resetAI(false);
    // 夹具：选项无 input 节点 → 点击无法产生选中态（模拟合成事件未生效）
    window.document.body.innerHTML = `
<div class="homework-single-selected" id="q3">
  <div class="question-tag-score">单选 10 分</div>
  <div class="topic-title">1. 回填永远失败的题？</div>
  <label class="el-radio"><span class="index-name">A.</span><span class="label"><span class="index-name">A.</span><span class="option-content">北京</span></span></label>
  <label class="el-radio"><span class="index-name">B.</span><span class="label"><span class="index-name">B.</span><span class="option-content">上海</span></span></label>
</div>
<button class="toggle-button">下一题</button>
<div id="xa-progress"></div><div id="xa-stats"></div><div id="xa-ai-log"></div>`;
    let calls = 0;
    XIA_AI.callAI = (q, cb) => { calls++; cb('A'); };
    XIA_AI.scan(); XIA_AI.scan(); XIA_AI.scan();
    // v3.16 起，回填失败重试复用会话内答案：3 轮重试只打 1 次 LLM，熔断语义不变
    eq('失败熔断：重试轮次内 LLM 仅调用一次（会话复用）', calls, 1);
    eq('失败熔断：3 轮重试后标记 hash 跳过', XIA_AI.lastQuestionHash.length > 0, true);
    eq('失败熔断：不误计已答', XIA_AI.stats.answered, 0);
    const c4 = calls;
    XIA_AI.scan();
    eq('失败熔断：跳过后不再重答', calls, c4);
}

// ===== ④ tryAutoSubmit：确认模式停用；正常模式完整提交链 =====
{
    resetAI(true);
    conf.autoSubmit = true;
    window.document.body.innerHTML = `
<button id="submit-btn">提交作业</button>
<div class="el-message-box"><div>确认提交作业？</div><button id="confirm-btn">确定</button></div>
<div class="el-message">提交成功</div>
<div id="xa-progress"></div><div id="xa-stats"></div><div id="xa-ai-log"></div>`;
    let submitted = 0, confirmed = 0;
    window.document.getElementById('submit-btn').addEventListener('click', () => submitted++);
    window.document.getElementById('confirm-btn').addEventListener('click', () => confirmed++);
    XIA_AI.tryAutoSubmit();
    eq('确认模式：自动提交整体停用', submitted, 0);

    resetAI(false);
    conf.autoSubmit = true;
    XIA_AI.tryAutoSubmit();
    eq('正常模式：点击提交作业', submitted, 1);
    eq('正常模式：自动点确认', confirmed, 1);
    eq('正常模式：统计已提交', XIA_AI.stats.submitted, 1);
    eq('正常模式：记录 donePage 交给巡航', XIA_AI._donePage.length > 0, true);
}

// ===== ⑤ 视频弹题：解析→作答→代提交→关闭续播 =====
function markerFixture(multi) {
    const tag = multi ? 'el-checkbox-group' : 'el-radio-group';
    const itype = multi ? 'checkbox' : 'radio';
    const opt = (l, t) => `<label class="${itype === 'radio' ? 'el-radio' : 'el-checkbox'} option-item"><span class="option-content">${l}.${t}</span><input type="${itype}" value="${l}"></label>`;
    window.document.body.innerHTML = `
<div class="el-dialog popup-topic-dialog" style="">
  <div><span class="question-type single-choice">单选题</span><p>视频里提到的核心概念是？</p></div>
  <div class="${tag} question-option-box">${opt('A', '概念一')}${opt('B', '概念二')}${multi ? opt('C', '概念三') : ''}</div>
  <div class="el-dialog__footer"><button class="el-button el-button--primary">提交</button></div>
</div>
<div id="xa-progress"></div><div id="xa-stats"></div><div id="xa-ai-log"></div>`;
    return {
        inputs: window.document.querySelectorAll('.option-item input'),
        submitBtn: window.document.querySelector('.el-dialog__footer .el-button'),
        dialog: window.document.querySelector('.popup-topic-dialog'),
    };
}

{
    resetAI(false);
    const fx = markerFixture(false);
    let submitClicked = 0;
    fx.submitBtn.addEventListener('click', () => submitClicked++);
    const asked = [];
    XIA_AI.callAI = (q, cb) => { asked.push(q.question + '|' + q.type); cb('B'); };
    markerTick();
    eq('弹题：解析题目并调用 AI', asked.length, 1);
    eq('弹题：题型识别为单选', asked[0].indexOf('single') > 0, true);
    eq('弹题：选项 B 已选', fx.inputs[1].checked, true);
    eq('弹题：代点提交', submitClicked, 1);
    // 下一 tick：userAnswer 尚未回填（提交按钮仍在、无关闭按钮）→ 不得重复提交
    markerTick();
    eq('弹题：等待回填期间不重复提交', submitClicked, 1);
    // 平台回填答案后 header 出现关闭按钮 → 点关闭恢复播放
    const close = window.document.createElement('span');
    close.className = 'icon-close';
    fx.dialog.querySelector('div').appendChild(close);
    let closed = 0;
    close.addEventListener('click', () => closed++);
    markerTick();
    eq('弹题：提交后自动关闭续播', closed, 1);
    // 平台关闭浮层（display:none）→ 状态机复位，不再有任何动作
    fx.dialog.style.display = 'none';
    markerTick();
    eq('弹题：弹窗消失后无动作', closed, 1);
}

// ===== ⑥ 弹题确认模式：只填不交 =====
{
    resetAI(true);
    const fx = markerFixture(false);
    let submitClicked = 0;
    fx.submitBtn.addEventListener('click', () => submitClicked++);
    XIA_AI.callAI = (q, cb) => cb('A');
    markerTick();
    eq('弹题确认：已填选项', fx.inputs[0].checked, true);
    eq('弹题确认：不代点提交', submitClicked, 0);
    markerTick();
    eq('弹题确认：重复扫描不重复填/交', submitClicked, 0);
    eq('弹题确认：状态停在已填待确认', XIA_AI.stats.answered, 0);
}

// ===== ⑦ 弹题多选：字母组合回填 =====
{
    resetAI(false);
    const fx = markerFixture(true);
    let submitClicked = 0;
    fx.submitBtn.addEventListener('click', () => submitClicked++);
    XIA_AI.callAI = (q, cb) => cb('A,C');
    markerTick();
    eq('弹题多选：A 已选', fx.inputs[0].checked, true);
    eq('弹题多选：C 已选', fx.inputs[2].checked, true);
    eq('弹题多选：B 未误选', fx.inputs[1].checked, false);
    eq('弹题多选：代点提交', submitClicked, 1);
}

// ===== ⑧ 图片作答题判定（v3.14.1 回归）：编辑器工具栏不得把主观题误判成图片题 =====
// 线上主观题使用富文本编辑器，工具栏自带「上传图片」按钮；旧实现扫题块全文/控件，
// 导致所有主观题命中图片题分支（不调 AI、直接跳过）。
function subjectiveFixture(opts) {
    const o = opts || {};
    window.document.body.innerHTML = `
<div class="question-box">
  <div class="question-area">
    <div class="homework-question-editor">
      <div class="question-tag-score">主观 10 分</div>
      <div class="topic-title">1. ${o.stem || '简述新文化运动的历史意义。'}</div>
      ${o.editor ? `
      <div class="w-e-text-container">
        ${o.toolbar ? '<div class="w-e-toolbar"><button title="上传图片">上传图片</button></div>' : ''}
        <div class="w-e-text" contenteditable="true"></div>
      </div>` : ''}
      ${o.upload ? '<div class="answer-upload"><button class="el-button">上传图片</button></div>' : ''}
      ${o.file ? '<input type="file">' : ''}
    </div>
  </div>
</div>
<button class="toggle-button">下一题</button>
<div id="xa-progress"></div><div id="xa-stats"></div><div id="xa-ai-log"></div>`;
    if (o.upload) {
        // 测试桩把所有元素 offsetHeight 设为 100；真实上传按钮是小控件（<80），控件判定依赖这一点
        const btn = window.document.querySelector('.answer-upload button');
        Object.defineProperty(btn, 'offsetHeight', { get: () => 30, configurable: true });
    }
    return window.document.querySelector('.homework-question-editor');
}

{
    resetAI(false);
    // ① 普通主观题 + 富文本工具栏（含「上传图片」）→ 不是图片题
    let root = subjectiveFixture({ editor: true, toolbar: true });
    eq('图片判定：编辑器工具栏「上传图片」不误判', imageQ(root), false);

    // ② 题干明确要求上传图片 → 图片题
    root = subjectiveFixture({ editor: true, toolbar: true, stem: '请上传手写图片作为本题答案。' });
    eq('图片判定：题干要求上传图片 → 跳过', imageQ(root), true);

    // ③ 无文本编辑器、只有上传控件 → 图片题（含隐藏 file input 的纯上传题）
    root = subjectiveFixture({ upload: true });
    eq('图片判定：无编辑器只有上传按钮 → 图片题', imageQ(root), true);
    root = subjectiveFixture({ file: true });
    eq('图片判定：无编辑器只有 file input → 图片题', imageQ(root), true);

    // ④ 无编辑器也无上传控件 → 不是图片题（交给后续失败提示，不能静默跳过）
    root = subjectiveFixture({});
    eq('图片判定：无编辑器无上传控件不误判', imageQ(root), false);

    // ⑤ 有文本编辑器时，题块内的上传入口只是可选作答方式 → 不误判
    root = subjectiveFixture({ editor: true, upload: true });
    eq('图片判定：编辑器旁的上传入口不误判', imageQ(root), false);

    // ⑤ 选择题选项里出现「上传照片」字样不影响判定（只看题干）
    window.document.body.innerHTML = `
<div class="homework-single-selected">
  <div class="question-tag-score">单选 10 分</div>
  <div class="topic-title">1. 下列哪项是正确的？</div>
  <label class="el-radio"><span class="index-name">A.</span><span class="label"><span class="index-name">A.</span><span class="option-content">上传照片的操作步骤</span></span><input type="radio" value="A"></label>
  <label class="el-radio"><span class="index-name">B.</span><span class="label"><span class="index-name">B.</span><span class="option-content">图片下载</span></span><input type="radio" value="B"></label>
</div>
<div id="xa-progress"></div><div id="xa-stats"></div><div id="xa-ai-log"></div>`;
    eq('图片判定：选项文本不参与判定', imageQ(window.document.querySelector('.homework-single-selected')), false);
}

{
    // ⑥ scan 集成：普通主观题必须进入 AI 作答（旧版在这里直接跳过）
    resetAI(false);
    subjectiveFixture({ editor: true, toolbar: true });
    let asked = 0;
    XIA_AI.callAI = () => { asked++; };
    XIA_AI.scan();
    eq('图片回归：普通主观题进入 AI 作答', asked, 1);

    // ⑦ scan 集成：题干要求上传图片 → 首遇尝试「AI 文本答案→渲染成图→自动上传」（callAI 被调用）
    resetAI(false);
    delete store['xa_img_skipped'];
    subjectiveFixture({ editor: true, toolbar: true, stem: '请上传手写图片作为本题答案。' });
    let called = 0, nextClicked = 0;
    XIA_AI.callAI = () => { called++; }; // 桩不回调：流程停在 AI 阶段（渲染/上传不在本测内）
    window.document.querySelector('.toggle-button').addEventListener('click', () => nextClicked++);
    XIA_AI.scan();
    eq('图片回归：真题首遇尝试 AI 自动作答', called, 1);
    eq('图片回归：首遇不直接跳过', nextClicked, 0);

    // ⑧ AI 无答案 → 回退人工跳过并落 GM 记录；同题重扫不再调 AI（记录命中直达跳过路径）
    resetAI(false);
    delete store['xa_img_skipped'];
    subjectiveFixture({ editor: true, toolbar: true, stem: '请上传手写图片作为本题答案。' });
    called = 0; nextClicked = 0;
    XIA_AI.callAI = (q, cb) => { called++; cb(null); };
    window.document.querySelector('.toggle-button').addEventListener('click', () => nextClicked++);
    XIA_AI.scan();
    eq('图片回归：AI 失败回退跳过记录', called, 1);
    eq('图片回归：回退时提示人工', window.document.getElementById('xa-progress').textContent.indexOf('🖼️'), 0);
    eq('图片回归：回退时尝试跳下一题', nextClicked, 1);
    XIA_AI.lastQuestionHash = ''; // 人工未处理，模拟下一轮重扫（跳过记录已落 GM）
    XIA_AI.callAI = () => { called++; };
    XIA_AI.scan();
    eq('图片回归：已跳过的真题不再调 AI', called, 1);
    eq('图片回归：已跳过的真题仍提示人工', window.document.getElementById('xa-progress').textContent.indexOf('🖼️'), 0);
    eq('图片回归：已跳过的真题不重复跳题（2.5s 节流）', nextClicked, 1);
}

{
    // ⑧ 旧版误判记录作废：修复前所有主观题 hash 都被写进跳过表，不能继续拦截
    delete store['xa_img_skipped'];
    window.GM_setValue('xa_img_skipped', JSON.stringify([{ h: 'old-hash', q: '旧误判', t: 1 }]));
    eq('图片记录：旧版记录不再命中', XIA_AI.imgSkippedHas('old-hash'), false);
    XIA_AI.imgSkipRemember('old-hash', '旧误判');
    eq('图片记录：新版记录可命中', XIA_AI.imgSkippedHas('old-hash'), true);
    const saved = JSON.parse(window.GM_getValue('xa_img_skipped', '[]'));
    eq('图片记录：带判定器版本', saved.length > 0 && saved.every(x => x.v === 2), true);
    eq('图片记录：旧记录被清理', saved.some(x => !x.v), false);
}

// ===== ⑨ 检索链路回归（v3.15.1 起步；检索源收敛单 Bing 后简化）：done 必须被调用不卡死 =====
// 旧版曾在对象方法里裸调用 searchBing → ReferenceError，done 永不触发，答题流程整体卡死
// （Tavily/DDG 通道已移除，原「DDG 超时回退 Bing」用例随之失去对象）
{
    resetAI(false);
    let calls = [];
    window.GM_xmlhttpRequest = opts => { calls.push(opts); };
    let got = 'HANG';
    XIA_AI.searchWeb('测试检索词', ctx => { got = ctx; });
    eq('检索回归：仅 1 次请求', calls.length, 1);
    eq('检索回归：cn.bing.com 直连', calls[0].url.indexOf('cn.bing.com/search?q='), 8);
    calls[0].onload({ responseText: 'junk-prefix placeholder\n<li class="b_algo" x="y"><div>仅有的十个汉字以上长度的合法结果内容摘要</div></li>' });
    ok('检索回归：解析非空且回调触发', typeof got === 'string' && got.indexOf('合法结果') >= 0);
    // 失败路径也必须回调空串（跳过检索直接作答），不允许挂起
    got = 'HANG'; calls = [];
    XIA_AI.searchWeb('第二题', ctx => { got = ctx; });
    calls[0].ontimeout();
    ok('检索回归：超时回调空串不卡死', got === '');
    got = 'HANG'; calls = [];
    XIA_AI.searchWeb('第三题', ctx => { got = ctx; });
    calls[0].onerror();
    ok('检索回归：网络错误回调空串不卡死', got === '');
}

// ===== ⑩ 会话内同题缓存（v3.16）：重进同题免二次 LLM 请求，直接复用答案 =====
{
    resetAI(false);
    const fx = singleChoice('q10');
    let calls = 0;
    XIA_AI.callAI = (q, cb) => { calls++; cb('A'); };
    XIA_AI.scan();
    eq('会话缓存：首次作答调用 AI', calls, 1);
    eq('会话缓存：答案已回填', fx.inputs[0].checked, true);
    eq('会话缓存：答案已入缓存', Object.keys(XIA_AI._answerMemo).length, 1);
    // 模拟重进同一份作业：题目重新渲染为未作答（isAnswered 复位 + hash 闸门复位）
    fx.inputs[0].checked = false;
    XIA_AI.lastQuestionHash = '';
    XIA_AI.answering = false;
    XIA_AI.scan();
    eq('会话缓存：同题二次作答免请求', calls, 1);
    eq('会话缓存：缓存答案直接回填', fx.inputs[0].checked, true);
    eq('会话缓存：计入已答统计', XIA_AI.stats.answered, 2);
}

// ===== ⑪ <think> 内嵌剥离（v3.16）：网关把思考段拼进 content 时不得污染答案解析 =====
{
    eq('think剥离：单选取思考段之后的字母', XIA_AI.parseAnswer('<think>嗯，A 不太对，正确的是 B</think>\nB', 'single', 'AB'), 'B');
    eq('think剥离：思考内提过 A 不误取', XIA_AI.parseAnswer('<think>先排除 A</think>答案：B', 'single', 'AB'), 'B');
    eq('think剥离：未闭合 think 判解析失败', XIA_AI.parseAnswer('<think>我还在思考', 'single', 'AB'), null);
    eq('think剥离：多选组合', XIA_AI.parseAnswer('<think>逐项分析…AC 正确</think>AC', 'multi', 'ABC'), 'AC');
    ok('think剥离：主观题剥后取正文', XIA_AI.parseAnswer('<think>构思中</think>这是答案正文。', 'subjective') === '这是答案正文。');
}

// ===== ⑫ 代码题沙箱工具循环（mock runJs + mock 传输）：先运行验证再作答，观察消息正确回灌 =====
function codeChoiceFixture(id) {
    window.document.body.innerHTML = `
<div class="homework-single-selected" id="${id}">
  <div class="question-tag-score">单选 10 分</div>
  <div class="topic-title">1. 以下 Python 代码的输出是什么？ print(sum(range(4)))</div>
  <label class="el-radio"><span class="index-name">A.</span><span class="label"><span class="index-name">A.</span><span class="option-content">6</span></span><input type="radio" value="A"></label>
  <label class="el-radio"><span class="index-name">B.</span><span class="label"><span class="index-name">B.</span><span class="option-content">10</span></span><input type="radio" value="B"></label>
</div>
<button class="toggle-button">下一题</button>
<div id="xa-progress"></div><div id="xa-stats"></div><div id="xa-ai-log"></div>`;
    return { inputs: window.document.querySelectorAll('#' + id + ' input[type="radio"]') };
}
{
    resetAI(false);
    conf.apiKey = 'sk-test'; // 工具循环走真实 callAI/_llmChat，需通过密钥检查（mock 只接管传输层）
    const fx = codeChoiceFixture('q12');
    const runs = [];
    XA_TOOLS.runJs = (code, cb) => { runs.push(code); cb({ logs: ['6'], result: '6', error: null }); };
    const reqs = [];
    window.GM_xmlhttpRequest = opts => {
        reqs.push(opts);
        const content = reqs.length === 1
            ? '先验证一下。\n```run\nconsole.log([0,1,2,3].reduce((a,b)=>a+b,0))\n```'
            : '运行结果证实是 6。\n答案：A';
        opts.onload({ responseText: JSON.stringify({ choices: [{ message: { content: content } }] }) });
    };
    XIA_AI.scan();
    eq('代码题：模型请求了沙箱运行', runs.length, 1);
    ok('代码题：传给沙箱的是 run 块内容', /reduce/.test(runs[0]));
    eq('代码题：观察消息回灌（3 条消息）', JSON.parse(reqs[1].data).messages.length, 3);
    ok('代码题：观察消息含运行结果', JSON.parse(reqs[1].data).messages[2].content.indexOf('表达式结果：6') >= 0);
    eq('代码题：最终按字母作答 A', fx.inputs[0].checked, true);
    eq('代码题：计入已答统计', XIA_AI.stats.answered, 1);
}

// ===== ⑬ 代码题运行额度耗尽：3 次上限后强制模型给最终答案，不失控 =====
{
    resetAI(false);
    conf.apiKey = 'sk-test';
    const fx = codeChoiceFixture('q13');
    const runs = [];
    XA_TOOLS.runJs = (code, cb) => { runs.push(code); cb({ logs: ['x'], result: 'x', error: null }); };
    const reqs = [];
    window.GM_xmlhttpRequest = opts => {
        reqs.push(opts);
        const content = reqs.length <= 4 ? '```run\nconsole.log(' + reqs.length + ')\n```' : '答案：B';
        opts.onload({ responseText: JSON.stringify({ choices: [{ message: { content: content } }] }) });
    };
    XIA_AI.scan();
    eq('代码题上限：沙箱只运行 3 次', runs.length, 3);
    eq('代码题上限：第 4 次请求被格式纠正收尾', reqs.length, 5);
    eq('代码题上限：最终答案仍正常回填', fx.inputs[1].checked, true);
}

// ===== ⑭ LLM 传输降级链：5xx/空内容 → 第二发（官方命名降 deepseek-chat）；401 熔断不降级；usage 累计 =====
{
    resetAI(false);
    conf.apiKey = 'sk-test'; conf.model = 'deepseek-reasoner'; conf.apiBase = 'https://api.deepseek.com';
    const calls = [];
    window.GM_xmlhttpRequest = opts => { calls.push(opts); };
    let got = 'unset';
    XIA_AI._llmChat([{ role: 'user', content: 'q' }], { maxTokens: 100, timeout: 1000 }, c => { got = c; });
    eq('降级链：第 1 发用配置模型', JSON.parse(calls[0].data).model, 'deepseek-reasoner');
    calls[0].onload({ status: 500, responseText: 'upstream error' });
    eq('降级链：5xx 触发第 2 发', calls.length, 2);
    eq('降级链：官方端点降级 deepseek-chat', JSON.parse(calls[1].data).model, 'deepseek-chat');
    calls[1].onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: 'A' } }], usage: { prompt_tokens: 1234, completion_tokens: 940 } }) });
    eq('降级链：降级后拿到内容', got, 'A');
    eq('token 统计：输入累计', XIA_AI.stats.tokensIn, 1234);
    eq('token 统计：输出累计', XIA_AI.stats.tokensOut, 940);

    // 空内容也走降级（reasoner 思考吃光 max_tokens 的典型场景，chat 模型能真正出 content）
    resetAI(false);
    conf.apiKey = 'sk-test'; conf.model = 'deepseek-reasoner'; conf.apiBase = 'https://api.deepseek.com';
    const calls2 = [];
    window.GM_xmlhttpRequest = opts => calls2.push(opts);
    XIA_AI._llmChat([{ role: 'user', content: 'q' }], { maxTokens: 100, timeout: 1000 }, () => {});
    calls2[0].onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '' } }] }) });
    eq('降级链：空内容触发降级', calls2.length, 2);

    // 自定义网关（非官方命名）不猜第三方模型名：同模型重试一次
    resetAI(false);
    conf.apiKey = 'sk-test'; conf.model = 'deepseek-ai/DeepSeek-R1'; conf.apiBase = 'https://api.siliconflow.cn';
    const calls3 = [];
    window.GM_xmlhttpRequest = opts => calls3.push(opts);
    XIA_AI._llmChat([{ role: 'user', content: 'q' }], { maxTokens: 100, timeout: 1000 }, () => {});
    calls3[0].onload({ status: 503, responseText: '' });
    eq('降级链：自定义网关同模型重试', JSON.parse(calls3[1].data).model, 'deepseek-ai/DeepSeek-R1');

    // 401 配置错误：熔断且不降级（重试坏配置无意义）
    resetAI(false);
    conf.apiKey = 'sk-bad'; conf.model = 'deepseek-reasoner'; conf.apiBase = 'https://api.deepseek.com';
    const calls4 = [];
    window.GM_xmlhttpRequest = opts => calls4.push(opts);
    let nulled = false;
    XIA_AI._llmChat([{ role: 'user', content: 'q' }], { maxTokens: 100, timeout: 1000 }, c => { nulled = c === null; });
    calls4[0].onload({ status: 401, responseText: '{"error":"auth"}' });
    eq('降级链：401 不降级', calls4.length, 1);
    ok('降级链：401 熔断置位', !!XIA_AI._cfgError);
    ok('降级链：401 回调 null', nulled);

    // token 统计展示（#xa-stats 缩写）
    XIA_AI.stats.tokensIn = 1234; XIA_AI.stats.tokensOut = 940;
    XIA_AI.bump();
    const statTxt = (window.document.getElementById('xa-stats') || {}).textContent || '';
    ok('token 统计：面板含 1.2k 缩写', statTxt.indexOf('1.2k') >= 0);
    ok('token 统计：面板含 940 原值', statTxt.indexOf('940') >= 0);
    window.GM_xmlhttpRequest = () => {}; // 还原全局桩，避免影响后续用例
}

// ===== ⑮ 桌面通知：后台才弹、同类节流、异类互不干扰、前台不打扰、面板开关 =====
{
    resetAI(false);
    const notes = [];
    window.GM_notification = d => notes.push(d);
    window.__T.notifyReset();
    window.__T.setBg(() => true); // 强制后台（jsdom 页面默认「可见」）
    conf.notify = true;
    window.__T.notify('t1', '标题A', '正文');
    eq('通知：后台首次弹出', notes.length, 1);
    ok('通知：标题带前缀', notes[0].title.indexOf('芯位') >= 0 && notes[0].title.indexOf('标题A') >= 0);
    window.__T.notify('t1', '标题A', '正文');
    eq('通知：同类默认 10 分钟节流', notes.length, 1);
    window.__T.notify('t2', '标题B', '正文');
    eq('通知：异类不互斥', notes.length, 2);
    // 前台（可见）：面板/日志已可见，永不打扰
    window.__T.notifyReset();
    window.__T.setBg(() => false);
    window.__T.notify('t3', '标题C', '正文');
    eq('通知：前台不弹', notes.length, 2);
    // 面板开关关闭：后台也不弹
    window.__T.setBg(() => true);
    conf.notify = false;
    window.__T.notify('t4', '标题D', '正文');
    eq('通知：开关关闭不弹', notes.length, 2);
    // 还原环境
    conf.notify = true;
    window.__T.setBg(window.__T.realBg);
    window.__T.notifyReset();
}

// ===== ⑯ 标题栏进度后缀：SPA 改写标题安全（先剥旧后缀再拼新，不叠加） =====
{
    window.document.title = '课程学习';
    window.eval('xaTitleSuffix(" · 3/20节");');
    eq('标题：附加后缀', window.document.title, '课程学习 · 3/20节');
    window.eval('document.title = "新路由标题"; xaTitleSuffix(" · 4/20节");');
    eq('标题：SPA 改写后重建不叠加', window.document.title, '新路由标题 · 4/20节');
    window.eval('xaTitleSuffix("");');
    eq('标题：空后缀还原原标题', window.document.title, '新路由标题');
}

// ===== ⑰ xaPageInBackground 防伪装契约：keepPlay 式实例劫持骗不过原型读取（通知功能根基） =====
{
    const protoDesc = Object.getOwnPropertyDescriptor(window.Document.prototype, 'hidden');
    ok('背景判定：Document.prototype 存在 hidden getter', !!(protoDesc && protoDesc.get));
    const envDefault = protoDesc.get.call(window.document); // 本 jsdom 的默认可见性（版本差异 visible/prerender）
    // 判别实验：原型与实例各给一个相反值——实现必须读原型（keepPlay 的 defineProperty 只遮实例）
    const spoofed = !envDefault;
    try { Object.defineProperty(window.document, 'hidden', { get: () => envDefault, configurable: true }); } catch (e) {}
    try { Object.defineProperty(window.Document.prototype, 'hidden', { get: () => spoofed, configurable: true }); } catch (e) {}
    eq('背景判定：实例伪装不遮蔽原型真值', window.__T.realBg(), spoofed);
    // 还原原型描述符与实例属性；还原失败时 realBg 仍是 spoofed（≠envDefault）必被抓住
    try { Object.defineProperty(window.Document.prototype, 'hidden', protoDesc); } catch (e) {}
    try { delete window.document.hidden; } catch (e) {}
    eq('背景判定：还原后回到环境默认可见性', window.__T.realBg(), envDefault);
}

// ===== ⑱ pageCourseContext：四路上下文提取（课程名/作业名/描述表/高亮节剥时长）与导航词排除 =====
{
    window.document.body.innerHTML = `
<header class="el-header"><div class="course-name">高等数学</div></header>
<div class="title-class">第二章测验</div>
<div class="homework-describe">课程名称：高等数学（上） 关联章节：第二章 导数与微分</div>
<ul><li class="el-menu-item is-active">2.1 导数概念 12:34</li></ul>`;
    eq('课程上下文：四路齐全按序拼接', window.__T.courseCtx(),
        '高等数学 · 第二章测验 · 高等数学（上） · 第二章 · 2.1 导数概念');
    window.document.body.innerHTML = `
<header class="el-header"><div class="course-name">高等数学</div></header>
<ul><li class="el-menu-item is-active">作业考试</li></ul>`;
    eq('课程上下文：通用导航词排除', window.__T.courseCtx(), '高等数学');
    window.document.body.innerHTML = '<div></div>';
    eq('课程上下文：无来源返回空串（prompt 不注入背景）', window.__T.courseCtx(), '');
}

// ===== ⑲ 运行时段表：解析 / 区间边界 / 非法值放行 / 跨零点 =====
{
    eq('时段解析：标准 HH:MM', JSON.stringify(window.__T.schedParse('23:00-07:00')), JSON.stringify([1380, 420]));
    eq('时段解析：单位数小时 + ~ 分隔', JSON.stringify(window.__T.schedParse('9:30~11:45')), JSON.stringify([570, 705]));
    eq('时段解析：小时超界判 null', window.__T.schedParse('24:00-01:00'), null);
    eq('时段解析：分钟超界判 null', window.__T.schedParse('01:60-02:00'), null);
    eq('时段解析：乱串判 null', window.__T.schedParse('23点-7点'), null);

    window.__T.conf.schedule = '23:00-07:00'; // 跨零点：22:59 窗外，23:00 起点含，凌晨窗内
    eq('时段闸：跨零点起点含', window.__T.schedActive(1380), true);
    eq('时段闸：跨零点凌晨窗内', window.__T.schedActive(300), true);
    eq('时段闸：跨零点正午窗外', window.__T.schedActive(720), false);
    window.__T.conf.schedule = '09:00-11:00';
    eq('时段闸：普通区间起点含', window.__T.schedActive(540), true);
    eq('时段闸：普通区间终点不含', window.__T.schedActive(660), false);
    window.__T.conf.schedule = '';
    eq('时段闸：空配置=全天', window.__T.schedActive(720), true);
    window.__T.conf.schedule = '25:00-26:00';
    eq('时段闸：非法配置=全天放行（配错不锁死自动化）', window.__T.schedActive(720), true);

    // 闸门函数：进入窗外打暂停标记并返回 false；恢复空配置后闸门回 true（nowMin 注入免随真实时钟漂移）
    window.__T.conf.schedule = '23:00-07:00';
    window.__T.schedGateReset();
    eq('时段闸：正午调用返回 false', window.__T.schedGate(720), false);
    eq('时段闸：凌晨调用恢复 true', window.__T.schedGate(300), true);
    window.__T.conf.schedule = '';
    eq('时段闸：清空配置后恒放行', window.__T.schedGate(720), true);
    window.__T.schedGateReset();
}

// ===== ⑳ 题干图片提取：大图收集 / 去重 / 非法 src / 小图标剔除 / 上限 3 张 =====
{
    window.document.body.innerHTML = `
<div class="homework-single-selected" id="q-imgs">
  <div class="topic-title">1. 如图求阴影面积 <img src="https://cdn.beeline-ai.com/q1.png"><img src="https://cdn.beeline-ai.com/q1.png"><img src="ftp://x/q2.png"></div>
  <img id="icon" src="https://cdn.beeline-ai.com/icon.png">
  <img src="https://cdn.beeline-ai.com/a.png"><img src="https://cdn.beeline-ai.com/b.png"><img src="https://cdn.beeline-ai.com/c.png"><img src="https://cdn.beeline-ai.com/d.png">
</div>`;
    const icon = window.document.getElementById('icon');
    Object.defineProperty(icon, 'offsetWidth', { value: 10, configurable: true }); // 覆盖原型 100 桩
    Object.defineProperty(icon, 'offsetHeight', { value: 10, configurable: true });
    const imgs = window.__T.qImages(window.document.querySelector('#q-imgs'));
    eq('图片提取：大图收集+去重+非 http 协议剔除+上限 3',
        JSON.stringify(imgs), JSON.stringify(['https://cdn.beeline-ai.com/q1.png', 'https://cdn.beeline-ai.com/a.png', 'https://cdn.beeline-ai.com/b.png']));
    eq('图片提取：短边<30 图标剔除', imgs.indexOf('https://cdn.beeline-ai.com/icon.png'), -1);
}

// ===== ㉑ 视觉模型答题链路：题干带图 → 图片拉 dataURL → vision 请求（模型覆盖 + 不降级） =====
{
    // jsdom FileReader 异步回调会把链路打散——换同步桩（转换正确性由浏览器保证，这里只验链路）
    window.FileReader = class {
        readAsDataURL() {
            this.result = 'data:image/png;base64,iVBORw0KGgo=';
            if (this.onload) this.onload({});
        }
    };
    window.__T.conf.visionModel = 'Qwen/Qwen2.5-VL-72B-Instruct';
    window.__T.conf.apiKey = 'sk-test';
    singleChoice('q-vision');
    window.document.querySelector('#q-vision .topic-title')
        .insertAdjacentHTML('afterend', '<img src="https://cdn.beeline-ai.com/fig1.png">');
    let imgFetches = 0, llmCaps = [];
    window.GM_xmlhttpRequest = opts => {
        if (opts.responseType === 'arraybuffer') { // xaFetchImageDataURL 的图片拉取分支
            imgFetches++;
            opts.onload({ response: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer }); // PNG 魔数
            return;
        }
        llmCaps.push(opts);
        opts.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: 'A' } }] }) });
    };
    let got = 'NONE';
    XIA_AI.callAI(XIA_AI.grabQuestion(), a => { got = a; });
    eq('视觉：题干图片拉取 1 次', imgFetches, 1);
    eq('视觉：走视觉模型且答案回传', got, 'A');
    eq('视觉：请求体 model 字段为视觉模型', JSON.parse(llmCaps[0].data).model, 'Qwen/Qwen2.5-VL-72B-Instruct');
    const vmsg = JSON.parse(llmCaps[0].data).messages[0].content;
    ok('视觉：消息为多模态数组（1 文本 + 1 图）', Array.isArray(vmsg) && vmsg.length === 2
        && vmsg[0].type === 'text' && vmsg[1].type === 'image_url');
    ok('视觉：图片以 PNG dataURL 附带', /^data:image\/png;base64,/.test(vmsg[1].image_url.url));

    // 空内容重试：降级链被 noFallback 关闭——重试仍是视觉模型（deepseek-chat 接不住带图消息）
    llmCaps = [];
    window.GM_xmlhttpRequest = opts => {
        if (opts.responseType === 'arraybuffer') { opts.onload({ response: new Uint8Array([0x89, 0x50]).buffer }); return; }
        llmCaps.push(opts);
        opts.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '' } }] }) });
    };
    got = 'NONE';
    XIA_AI.callAI(XIA_AI.grabQuestion(), a => { got = a; });
    ok('视觉：空内容重试共 4 发（首轮+重试 × strict 一轮）', llmCaps.length === 4);
    eq('视觉：重试不降级到纯文本模型', JSON.parse(llmCaps[1].data).model, 'Qwen/Qwen2.5-VL-72B-Instruct');
    eq('视觉：两轮全失败如实回调 null', got, null);

    // 图片全部拉取失败：不瞎答，直接 onResult(null) 交回重试/人工
    llmCaps = [];
    window.GM_xmlhttpRequest = opts => {
        if (opts.responseType === 'arraybuffer') { opts.onload({ response: new ArrayBuffer(0) }); return; }
        llmCaps.push(opts);
    };
    got = 'NONE';
    XIA_AI.callAI(XIA_AI.grabQuestion(), a => { got = a; });
    eq('视觉：图片全拉取失败不发 LLM 请求', llmCaps.length, 0);
    eq('视觉：图片全拉取失败回调 null', got, null);

    // 未配视觉模型：维持旧行为（纯文本请求主模型）
    window.__T.conf.visionModel = '';
    llmCaps = [];
    window.GM_xmlhttpRequest = opts => {
        if (opts.responseType === 'arraybuffer') { opts.onload({ response: new ArrayBuffer(0) }); return; }
        llmCaps.push(opts);
        opts.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: 'B' } }] }) });
    };
    got = 'NONE';
    XIA_AI.callAI(XIA_AI.grabQuestion(), a => { got = a; });
    eq('视觉：未配视觉模型走主模型纯文本', got, 'B');
    ok('视觉：纯文本请求 content 是字符串', typeof JSON.parse(llmCaps[0].data).messages[0].content === 'string');

    window.__T.conf.apiKey = '';
    window.GM_xmlhttpRequest = () => {};
}

// ===== ㉒ 连接健康检查：最小请求成功带延迟；错误归类；不触发熔断 =====
{
    window.__T.conf.apiKey = 'sk-test';
    window.__T.conf.model = 'deepseek-reasoner';
    let reqs = [];
    window.GM_xmlhttpRequest = opts => {
        reqs.push(opts);
        opts.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
    };
    let res = null;
    XIA_AI.healthCheck((okk, info) => { res = { ok: okk, info: info }; });
    eq('健康检查：请求 max_tokens 收敛为 8', JSON.parse(reqs[0].data).max_tokens, 8);
    eq('健康检查：200 回调成功', res.ok, true);
    ok('健康检查：带耗时统计', typeof res.info.ms === 'number' && res.info.ms >= 0);

    const classify = (status, body) => {
        window.GM_xmlhttpRequest = opts => { opts.onload({ status: status, responseText: body }); };
        res = null;
        XIA_AI.healthCheck((okk, info) => { res = { ok: okk, info: info }; });
        return res.info.why;
    };
    eq('健康检查：401 归类 Key 无效', classify(401, '{"error":"auth"}'), 'API Key 无效（401）');
    eq('健康检查：402 归类余额不足', classify(402, '{}'), '余额不足（402）');
    eq('健康检查：模型名错误归类', classify(400, '{"error":{"type":"invalid_request_error","param":"model"}}'),
        '模型名无效');
    eq('健康检查：检查失败不触发配置熔断', XIA_AI._cfgError, null);

    window.__T.conf.apiKey = '';
    window.GM_xmlhttpRequest = () => {};
}

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' qa state-machine tests passed'));
process.exit(fail ? 1 : 0);
