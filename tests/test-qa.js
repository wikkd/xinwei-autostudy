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
const FILES = ['config.js', 'utils.js', 'sites.js', 'qa.js', 'popup.js'];
window.eval(FILES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n') + `
;window.__T = {
    get conf() { return conf; },
    ai: XIA_AI,
    markerTick: markerQuestionTick,
    imageQ: isImageAnswerQuestion,
    resetMarker: () => { _mqKey = ''; _mqState = ''; _mqFails = {}; },
};`);
window.loadCfg(); // 必须在解构前：loadCfg 会整体重赋值 conf，之后 getter 才返回最终对象
const { conf, ai: XIA_AI, markerTick, resetMarker } = window.__T;
const imageQ = window.__T.imageQ;

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
        _lastNav: 0, _imgLogged: '',
    });
    XIA_AI.stats = { answered: 0, submitted: 0, failed: 0 };
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
    eq('失败熔断：恰好重试 3 次', calls, 3);
    eq('失败熔断：标记 hash 跳过', XIA_AI.lastQuestionHash.length > 0, true);
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

    // ⑦ scan 集成：题干要求上传图片 → 不调 AI，记录跳过
    resetAI(false);
    delete store['xa_img_skipped'];
    subjectiveFixture({ editor: true, toolbar: true, stem: '请上传手写图片作为本题答案。' });
    let called = 0, nextClicked = 0;
    XIA_AI.callAI = () => { called++; };
    window.document.querySelector('.toggle-button').addEventListener('click', () => nextClicked++);
    XIA_AI.scan();
    eq('图片回归：真题不调用 AI', called, 0);
    eq('图片回归：真题提示人工并跳过', window.document.getElementById('xa-progress').textContent.indexOf('🖼️'), 0);
    eq('图片回归：真题尝试跳下一题', nextClicked, 1);
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

// ===== ⑨ 检索链路回归（v3.15.1）：DDG 失败必须落到 Bing 且 done 一定被调用 =====
// 旧版在对象方法里裸调用 searchBing → ReferenceError，done 回调永不触发，答题流程整体卡死
{
    resetAI(false);
    conf.searchProvider = 'duckduckgo';
    let calls = [];
    window.GM_xmlhttpRequest = opts => { calls.push(opts); };
    let got = 'HANG';
    XIA_AI.searchWeb('测试检索词', ctx => { got = ctx; });
    // 第一次（DDG）超时 → 自动重试 Bing；第二次（Bing）返回正常结果块
    const bingCtx = '<li class="b_algo" data-a="1"><h2><a>标题一</a></h2><p>V2 是火箭的内容服务正文摘要，足够长起码十个汉字以上。</p></li>'
        + '<li class="b_algo"><h2><a>标题二</a></h2><p>第二条结果的摘要内容。</p></li>';
    if (calls.length !== 1) eq('检索回归：先请求 DDG 仅 1 次', calls.length, 1);
    if (calls.length === 1) {
        eq('检索回归：DDG 地址正确', calls[0].url.indexOf('html.duckduckgo.com'), 8);
        calls[0].ontimeout(); // DDG 超时 → 应触发 Bing 重试而不是卡死
        eq('检索回归：超时后补发 Bing 请求', calls.length, 2);
        eq('检索回归：回退到 cn.bing.com', calls[1].url.indexOf('cn.bing.com/search?q='), 8);
        calls[1].onload({ responseText: bingCtx });
    }
    ok('检索回归：DDG 超时回退 Bing 且不再卡死', typeof got === 'string' && got.indexOf('标题一') >= 0 && got.indexOf('第二条结果') >= 0);
}
{
    // provider=bing 默认链路：直接命中 searchBing，结果解析出标题+摘要
    resetAI(false);
    conf.searchProvider = 'bing';
    let calls = [];
    window.GM_xmlhttpRequest = opts => { calls.push(opts); };
    let got = 'HANG';
    XIA_AI.searchWeb('测试检索词', ctx => { got = ctx; });
    eq('检索回归：bing 直连仅 1 次请求', calls.length, 1);
    eq('检索回归：bing 地址正确', calls[0].url.indexOf('cn.bing.com/search?q='), 8);
    calls[0].onload({ responseText: 'junk-prefix placeholder\n<li class="b_algo" x="y"><div>仅有的十个汉字以上长度的合法结果内容摘要</div></li>' });
    ok('检索回归：bing 解析非空且回调触发', typeof got === 'string' && got.indexOf('合法结果') >= 0);
}

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' qa state-machine tests passed'));
process.exit(fail ? 1 : 0);
