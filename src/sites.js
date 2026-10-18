// ==================== 站点适配层（beeline-ai 平台 DOM）====================
// 芯位/beeline-ai 单平台（超星学习通已拆分至独立项目 chaoxing-autostudy）。
// beeline 为 Vue 3 + Element Plus SPA，题目/作业/视频均在主文档，无需 iframe 注入。
// 本文件承载平台 DOM 知识：题目容器选择器 / 解析 / 选项与答案提取 / 接口题目镜像。

// 芯位/beeline-ai 题目容器选择器（作业/考试组件根，由线上 DOM 反推）
const XIA_QROOT = '.homework-single-selected, .homework-multiple-selected, .homework-true-or-false, .homework-cloze, .homework-question-editor';

// scan 每 3s 由定时器驱动：仅这些路由可能有题目，其余（视频/课程页）直接短路，
// 避免挂机刷课时对整页做无谓的 QROOT 全量扫描
function routeHasQuestions(h) {
    return /homework|exam/i.test(String(h || ''));
}

// 点击「下一题/下一个」按钮：优先专用 toggle 按钮，其次任意按钮文本匹配；错误提示 10s 节流
function clickNextQuestionButton() {
    const hit = el => /下一题|下一个/.test(qtext(el)) && !/上一题|提交|交卷|作业|保存/.test(qtext(el));
    let btn = null;
    for (const t of qsa('.toggle-button')) if (hit(t)) { btn = t; break; }
    if (!btn) for (const t of qsa('button, [role="button"], [class*="next"]')) { if (visible(t) && hit(t)) { btn = t; break; } }
    if (btn) {
        try { btn.click(); } catch (e) {}
        XIA_AI.log('→ 下一题 "' + qtext(btn).slice(0, 12) + '"', 'ok');
    } else if (Date.now() - (XIA_AI._navErrAt || 0) > 10000) {
        XIA_AI._navErrAt = Date.now();
        XIA_AI.log('未找到下一题按钮', 'error');
    }
    return !!btn;
}

// ===== 📡 API 直拉镜像（v3.5.0）：接口题目数据 → 与 DOM 解析同构的题目对象 =====
// 接口契约 2026-10-10 真机校准（线上 chunk 逆向 + 真实账号验证）：
//   getHomeworkList body {status:2, teachingClassId, pageNo, pageSize}（status 2=已完成）
//   getDoneHomeworkPaperDetail/{paperId}/{classId} POST 空 body → homeworkTopicList[]
//   topicType: danxuan/duoxuan/panduan/tiankong/wenda(主观)；topicRightAnswerList=平台标准答案
//   （未通过卷 v2HomeworkAnswerShow=1 也返回答案——比 DOM 只采满分卷覆盖更全）
// 镜像规则与答题页 DOM 解析逐字节对齐（双端 11/11 题验证一致）：
//   - 题干 = plain(topicTitle) 前拼 "N. " 再走 questionTitle 同款序号剥离 → 残留一个前导空格
//     （DOM 端 .topic-title-box 的 "N. " 前缀剥后同样残留空格）
//   - 填空题：题干取 topicContent、去下划线挖空（答题页 input 渲染后 textContent 同形）、前缀无空格
//   - 选项文本 = "字母.内容"（DOM .label 内 index-name + option-content 拼接同形）
//   - 判断题：字母按位置落地 A/B（DOM 无 .index-name 同款兜底），答案 T→A / F→B
function xaApiPlain(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html == null ? '' : html);
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
function xaApiMirrorTopic(t) {
    const rawType = String(t.topicType || '');
    const type = rawType === 'duoxuan' ? 'multi'
        : rawType === 'tiankong' ? 'cloze'
        : (rawType === 'wenda' || rawType === 'zhuguan' || rawType === 'jianda') ? 'subjective'
        : 'single';
    let base = xaApiPlain(type === 'cloze' ? (t.topicContent || t.topicTitle) : (t.topicTitle || t.topicContent));
    if (type === 'cloze') base = base.replace(/_{9,}/g, '');
    const question = ((type === 'cloze' ? '0.' : '0. ') + base)
        .replace(/^\s*\d+[\.\．、]*/, '')
        .replace(/\s*单选|\s*多选|\s*判断|\s*填空|\s*主观题/g, '')
        .replace(/\s*\d+\s*分\s*/g, '')
        .slice(0, 400);
    if (!question || question.length < 3) return null;
    const core = t.topicQuestionCoreDtoList || [];
    const options = (type === 'cloze' || type === 'subjective') ? [] : core.map((o, i) => {
        const idx = String(o.index || '').trim();
        const letter = rawType === 'panduan'
            ? String.fromCharCode(65 + i)
            : ((idx.toUpperCase().match(/[A-H]/) || [])[0] || String.fromCharCode(65 + i));
        return { letter: letter, text: idx.toUpperCase() + '.' + xaApiPlain(o.content) };
    });
    const right = (t.topicRightAnswerList || []).map(x => String(x == null ? '' : x).trim()).filter(Boolean);
    let answer = '';
    if (type === 'subjective') answer = xaApiPlain(right.join(' ')).slice(0, 1500);
    else if (type === 'cloze') answer = right.join(',').split(',').map(s => s.trim()).filter(Boolean).join('|');
    else if (rawType === 'panduan') {
        const s = right.join('').toUpperCase();
        answer = /T/.test(s) ? 'A' : /F/.test(s) ? 'B'
            : (/对/.test(s) && !/错/.test(s) ? 'A' : (/错/.test(s) && !/对/.test(s) ? 'B' : ''));
    } else if (type === 'multi') {
        answer = right.join('').toUpperCase().replace(/[^A-H]/g, '').split('').filter((c, i, a) => a.indexOf(c) === i).sort().join('');
    } else answer = right.join('').toUpperCase().replace(/[^A-H]/g, '').slice(0, 1);
    if (!answer) return null;
    return { q: { question: question, options: options, type: type }, answer: answer };
}

// 图片作答题检测：题干明确要求「上传/拍摄图片」时才判 true（LLM 无法产出图片，需跳过交人工）。
// v3.14.1 修正：旧实现扫整个题块文本与控件，主观题富文本编辑器工具栏自带的「上传图片」按钮
// 被当成作答要求 → 所有主观题被误判成图片题。编辑器支持插图只是作答方式，不是题目要求。
// 现在只认两种证据：
//   ① 题干写明要图片作答（只读标题；无标题元素时读剔除编辑器后的题块文本）；
//   ② 主观题没有可输入的文本编辑器、只有图片上传控件 → 该题只能交图片。
const IMG_REQUIRE_RE = /上传[^。]{0,8}(图片|照片|截图|图像)|(图片|照片|截图|图像)[^。]{0,8}(作答|答题|回答|上传)|拍照上传|拍照作答|以图片形式|手写并?(拍照|上传)/;

// 题干文本：有标题元素就只读标题（选项、编辑器工具栏等一律不参与判定）；
// 没有标题元素时才复制题块并移除编辑器子树（工具栏/占位文案/输入区）后取全文。
function imageRequirementText(root, box) {
    const title = root.querySelector('.topic-title, .subject-title, [class*="topic-title"], [class*="subject-title"]');
    if (title) return qtext(title);
    const clone = box.cloneNode(true);
    qsa('[contenteditable], textarea, input, [class*="toolbar"], [class*="w-e-"], [class*="ql-"], [class*="tox-"], [class*="placeholder"], [data-slate-editor]', clone)
        .forEach(n => { try { if (n.parentNode) n.parentNode.removeChild(n); } catch (e) {} });
    return qtext(clone);
}

function isImageAnswerQuestion(root) {
    if (!root) return false;
    const box = (root.closest && root.closest('.question-box')) || root;
    if (IMG_REQUIRE_RE.test(imageRequirementText(root, box))) return true;
    if (questionType(root) !== 'subjective') return false;
    // 有文本编辑器时，上传/插图只是可选作答方式，AI 照常作答（这正是旧版全量误判的根源）
    if (root.querySelector('[contenteditable="true"], [contenteditable=""], textarea, [data-slate-editor], [class*="w-e-text"], [class*="ql-editor"], [class*="tox-tinymce"]')) return false;
    // 纯图片题：没有任何文本输入位，只看上传控件
    let hit = false;
    qsa('button, .el-button, a, span, div, input[type="file"]', box).forEach(el => {
        if (hit) return;
        if (el.tagName === 'INPUT') { hit = true; return; }
        if (!visible(el)) return;
        if (/^(上传图片|上传照片|图片上传|拍照上传|点击上传|拍照作答)$/.test(qtextAll(el)) && el.offsetHeight < 80) hit = true;
    });
    return hit;
}

// ============ 题目容器定位与解析 ============

function questionRoot() {
    let roots = qsa(XIA_QROOT).filter(el => visible(el) && el.offsetHeight > 8);
    if (!roots.length) { // 兜底：.question-tag-score 是各题型组件共有的作用域标记，取其容器作为题目块
        const seen = [];
        qsa('.question-tag-score').forEach(tag => {
            const box = tag.closest('.question-box') || tag.parentElement;
            if (!box || seen.indexOf(box) >= 0) return;
            if (!box.querySelector('.topic-title, .subject-title, .el-radio, .el-checkbox, input')) return;
            if (visible(box) && box.offsetHeight > 8) seen.push(box);
        });
        roots = seen;
    }
    if (!roots.length) return null;
    for (const r of roots) if (!isAnswered(r)) return r; // 优先返回未作答的（列表页自动顺延到下一题）
    return roots[0];
}

function questionType(root) {
    if (!root) return 'single';
    const cls = root.className || '';
    if (cls.indexOf('homework-multiple-selected') >= 0) return 'multi';
    if (cls.indexOf('homework-true-or-false') >= 0) return 'bool';
    if (cls.indexOf('homework-question-editor') >= 0) return 'subjective';
    if (cls.indexOf('homework-cloze') >= 0) return 'cloze';
    if (cls.indexOf('homework-single-selected') >= 0) return 'single';
    if (root.querySelector('.el-checkbox')) return 'multi';
    return 'single';
}

function isAnswered(root) {
    if (!root) return false;
    const t = questionType(root);
    if (t === 'subjective') {
        const ed = root.querySelector('[contenteditable="true"]');
        return !!(ed && qtextAll(ed).length > 0);
    }
    if (t === 'cloze') return qsa('input', root).some(i => (i.value || '').trim());
    return !!root.querySelector('.is-checked');
}

// 选项字母：优先 .index-name；input.value 仅在单字母 A-H 时采用（防 TRUE/FALSE 提取出假字母 E/F）
function letterOf(label) {
    const m = label.querySelector('.index-name');
    const nameLetter = m ? qtext(m).match(/[A-H]/) : null;
    if (nameLetter) return nameLetter[0];
    const input = label.querySelector('input[type="radio"], input[type="checkbox"]');
    const v = input && input.value ? String(input.value).trim().toUpperCase() : '';
    return /^[A-H]$/.test(v) ? v : null;
}

// 校验目标字母选项是否已真实选中（回填后确认用，防合成事件未生效）。
// 字母匹配失败时按位置兜底（labels[ch-65]）：判断题渲染为 T.对/F.错，无 .index-name 且
// input.value=T/F 不满足 [A-H]，letterOf 恒为 null——没有兜底时 allSelected 必失败，
// 判断题答完会白白重试 3 轮才跳过（fillChoice 点击走的就是同款位置兜底，两端必须一致）
function allSelected(root, letters) {
    if (!root) return false;
    const labels = qsa('.el-radio, .el-checkbox', root);
    return String(letters).toUpperCase().split('').every(ch => {
        let hit = labels.find(l => letterOf(l) === ch);
        if (!hit) hit = labels[ch.charCodeAt(0) - 65];
        if (!hit) return false;
        const input = hit.querySelector('input[type="radio"], input[type="checkbox"]');
        return hit.classList.contains('is-checked') || !!(input && input.checked);
    });
}

// 从题目容器（或其所在 question-box）提取分值，如「主观 30分」→ 30；取不到返回 0
function questionScore(root) {
    const scope = root.querySelector('.question-tag-score') ? root : (root.closest('.question-box') || root.parentElement || root);
    const m = scope.querySelector('.question-tag-score');
    const s = m ? qtext(m).match(/(\d+)\s*分/) : null;
    return s ? parseInt(s[1], 10) : 0;
}

// 主观题按分值定目标字数（30分大题写600字，5分小题写150字）
function targetWords(score) {
    if (!score || score <= 0) return 250;
    if (score >= 20) return 600;
    if (score >= 10) return 400;
    if (score >= 5) return 250;
    return 150;
}

function extractOptions(root) {
    const opts = [];
    qsa('.el-radio, .el-checkbox', root).forEach(label => {
        if (!visible(label)) return;
        const n = label.querySelector('.index-name');
        const m = n ? qtext(n).match(/[A-H]/) : null;
        let letter = m ? m[0] : String.fromCharCode(65 + opts.length);
        const el = label.querySelector('.label, .el-radio__label, .el-checkbox__label');
        const text = el ? qtext(el) : qtext(label).replace(/^[A-H][\.\．、\:：\s]*/, '');
        if (opts.some(o => o.letter === letter)) letter = String.fromCharCode(65 + opts.length); // 字母重复则按顺序补
        opts.push({ letter: letter, text: text.slice(0, 120), node: label });
    });
    return opts;
}

function questionTitle(root) {
    const t = root.querySelector('.topic-title, .subject-title, [class*="topic-title"], [class*="subject-title"]');
    return (t ? qtext(t) : qtext(root))
        .replace(/^\s*\d+[\.\．、]*/, '')
        .replace(/\s*单选|\s*多选|\s*判断|\s*填空|\s*主观题/g, '')
        .replace(/\s*\d+\s*分\s*/g, '')
        .slice(0, 400);
}

// 题目唯一键（答案本 / 题型登记 / 采集共用）：题干前100字 + 「字母+选项文本前30字」
// 无选项题型用类型占位。采集端与答题端必须同源，否则答案本永远错配
function questionHash(q) {
    return q.question.slice(0, 100) + '|'
        + (q.options.length ? q.options.map(o => o.letter + o.text.slice(0, 30)).join(',') : (q.type === 'cloze' ? 'cloze' : 'subj'));
}

// 解析单个题目容器为 grabQuestion 同构对象；解析不出返回 null（静默，日志由调用方负责）
// bool 题在此统一转 single（选项渲染为「T.对/F.错」，字母提取不到时由位置兜底 A/B）
function parseQuestionRoot(root) {
    const type = QA.questionType(root);
    const title = QA.questionTitle(root);
    if (!title || title.length < 3) return null;
    const score = QA.questionScore(root);
    if (type === 'subjective') return { question: title, options: [], node: root, type: type, score: score };
    if (type === 'cloze') {
        const blanks = qsa('input', root).filter(el => visible(el) && !/(radio|checkbox|hidden|file|button|submit)/i.test(el.type)).length;
        if (!blanks) return null;
        return { question: title, options: [], node: root, type: type, blanks: blanks, score: score };
    }
    const options = QA.extractOptions(root);
    if (!options.length) return null;
    return { question: title, options: options, node: root, type: (type === 'bool' ? 'single' : type), score: score };
}


// 题目解析适配器：qa.js 按 QA.xxx 调用；function 声明在同一 IIFE 作用域内提升，
// 此处可直接引用 qa.js 中的全局解析函数（均定义于本文件）。
const QA = {
    questionRoot, questionType, isAnswered, letterOf, allSelected,
    questionScore, extractOptions, questionTitle,
};
