// ==================== AI 答题核心 ====================
// 注：命名 XIA_AI 而非 AI，避免与页面既有 AI 标识符冲突。
// 职责：答题状态机 / LLM 调用与解析 / 回填与校验 / 图片作答。作业巡航三件套
// （列表推进/自动提交/一键巡航）在 cruise.js——状态字段仍挂本对象，方法为薄委托。
// 平台 DOM 解析见 sites.js；视频挂机见 autoplay.js。

// 图片题判定器版本（imgSkipped 记录格式）；升级判定逻辑时递增以作废旧记录
const IMG_SKIP_VER = 2;

// 图片跳过记录的 30s 内存缓存：图片题在场时 scan 每 3s 查询一次，避免每轮 JSON.parse；
// 保留 TTL 是因为 GM 存储跨标签页共享——另一页新写入的跳过记录最迟 30s 在本页生效
let _imgSkipCache = null, _imgSkipCacheAt = 0;
function imgSkipList() {
    const now = Date.now();
    if (_imgSkipCache && now - _imgSkipCacheAt < 30000) return _imgSkipCache;
    _imgSkipCacheAt = now;
    try { _imgSkipCache = JSON.parse(GM_getValue(SK.imgSkipped, '[]')) || []; } catch (e) { _imgSkipCache = []; }
    return _imgSkipCache;
}

// ==================== 课程语言记忆 ====================
// 记住每门课的题目主要涉及哪些语言/工具（如「数据可视化技术」→ MATLAB、D3），
// 累计 ≥2 次后注入 buildPrompt 课程背景，让模型用该语言的真实标准库作答
// （防 isempty/empty 式跨语言 API 混淆）。存储：GM_setValue 持久化，不可用时退化为
// 会话内存（node 测试环境同样走内存分支，行为可测）。
const _xaLangStore = (function () {
    try {
        if (typeof GM_setValue === 'function' && typeof GM_getValue === 'function') {
            return { get: k => GM_getValue(k), set: (k, v) => { GM_setValue(k, v); } };
        }
    } catch (e) {}
    const mem = {};
    return {
        get: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : undefined),
        set: (k, v) => { mem[k] = v; },
    };
})();
const XA_LANG_SK = 'xa_course_lang'; // { [课程名]: { lang: {MATLAB: n, ...}, at: 时间戳 } }
// 语言/工具特征词（长名在前防 Java 截胡 JavaScript、Node.js 截胡裸 js）；canon 表把大小写变体归一
const XA_LANG_RE = /MATLAB|Python3?|JavaScript|TypeScript|Java\b|C\+\+|C语言|CSS3?|HTML5?|SQL|D3|numpy|pandas|matplotlib|ECharts|Vue|React|Node\.?js|\bjs\b|R语言/gi;
const XA_LANG_CANON = {
    matlab: 'MATLAB', python: 'Python', python3: 'Python', javascript: 'JavaScript',
    typescript: 'TypeScript', java: 'Java', 'c++': 'C++', 'c语言': 'C语言',
    css: 'CSS', css3: 'CSS3', html: 'HTML', html5: 'HTML5', sql: 'SQL', d3: 'D3',
    numpy: 'numpy', pandas: 'pandas', matplotlib: 'matplotlib', echarts: 'ECharts',
    vue: 'Vue', react: 'React', node: 'Node.js', 'node.js': 'Node.js', nodejs: 'Node.js',
    js: 'JavaScript', 'r语言': 'R语言',
};

const XIA_AI = {
    lastQuestionHash: '',
    answering: false,
    answeringOnce: false,
    stats: { answered: 0, submitted: 0, failed: 0, tokensIn: 0, tokensOut: 0 }, // token 累计自 LLM usage 字段（网关不带则恒 0）
    _lastNav: 0,
    _navErrAt: 0,
    _failHash: '',
    _failCount: 0,
    _skipHash: '',
    _skipCount: 0,
    _submitting: false,
    _lastSubmitTry: 0,
    _donePage: '',
    _walkerNav: 0,
    _walkerEmptyLog: 0,
    _cfgError: null,
    _cfgLogAt: 0,
    _nextAnswerAt: 0,   // 答题间隔：该时间戳之前不抓答新题
    _imgLogged: '',
    _answerMemo: {}, // 会话内同题答案缓存（hash → 答案；内存级，刷新即清，见 _memoRemember）
    logLines: [],

    log(msg, type) {
        const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        XIA_AI.logLines.push({ text: line, type: type || 'info' });
        if (XIA_AI.logLines.length > 200) XIA_AI.logLines.shift();
        const box = document.getElementById('xa-ai-log');
        if (box) {
            // 增量渲染：只 append 新行并裁剪 60 行窗口（巡航答题时每题数条日志，
            // 全量 innerHTML 重建是纯浪费）。清空/面板重建后 _xaLive 失位则重建一次。
            // textContent 赋值自动转义 &/<，无需手工 escape。
            if (!box._xaLive) {
                box.innerHTML = '';
                box._xaLive = true;
            } else {
                while (box.children.length >= 60) box.removeChild(box.firstChild);
            }
            const div = document.createElement('div');
            div.style.color = type === 'error' ? '#dc2626' : type === 'ok' ? '#059669' : type === 'ai' ? '#7c3aed' : '#374151';
            div.style.lineHeight = '1.55';
            div.textContent = line;
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
        }
        console.log('[XIA] ' + msg);
    },

    // 面板进度条：显示当前任务（答题/提交/巡航）
    progress(text) {
        const el = document.getElementById('xa-progress');
        if (el) el.textContent = text;
    },

    // 会话统计（已答/已提交/token 用量）刷新到面板
    bump(k) {
        if (k) XIA_AI.stats[k]++;
        const el = document.getElementById('xa-stats');
        if (el) {
            const s = XIA_AI.stats;
            el.textContent = '已答 ' + s.answered + ' · 已提交 ' + s.submitted
                + ((s.tokensIn || s.tokensOut) ? ' ·  ' + xaFmtTok(s.tokensIn) + '→' + xaFmtTok(s.tokensOut) : '');
        }
    },

    // 答题间隔结算：本题完成后按面板设置延迟下一题（0=不等待），并刷新面板进度。
    // （原 scanAI/verifyAndAdvance 各写一份，收敛为一个出口防止间隔逻辑漂移）
    _answerGap() {
        const delay = Math.max(0, parseInt(conf.answerDelay, 10) || 0);
        if (delay) XIA_AI._nextAnswerAt = Date.now() + delay * 1000;
        XIA_AI.progress('已答 ' + XIA_AI.stats.answered + ' 题');
    },

    // 会话内同题答案缓存：重做/重进同一份作业、重进视频遇同一弹题时免二次 LLM 调用
    // （reasoner 单价高，省的是真金白银）。刻意只存内存不落 GM——v3.12 移除的持久答案本
    // （跨会话错答复用风险）不回潮，刷新页面即清空。
    _memoRemember(hash, ans) {
        const keys = Object.keys(XIA_AI._answerMemo);
        if (keys.length >= 300) delete XIA_AI._answerMemo[keys[0]]; // 长会话上限，先进先出
        XIA_AI._answerMemo[hash] = ans;
    },

    // ===== 图片作答题跳过记录（GM 持久化）：巡航重进同一份作业时直接跳过不再尝试 =====
    // 记录带判定器版本：v3.14.1 之前会把所有主观题误判成图片题并写入本表，
    // 旧记录（无 v 或 v!==2）一律作废，否则修好检测后仍会被历史记录继续跳过。
    imgSkippedHas(hash) {
        return imgSkipList().some(x => x && x.h === hash && x.v === IMG_SKIP_VER);
    },
    imgSkipRemember(hash, title) {
        let arr = imgSkipList().filter(x => x && x.v === IMG_SKIP_VER); // 顺手清掉旧版误判记录
        if (!arr.some(x => x.h === hash)) {
            arr.push({ h: hash, q: String(title || '').slice(0, 80), t: Date.now(), v: IMG_SKIP_VER });
        }
        if (arr.length > 100) arr = arr.slice(-100);
        try { GM_setValue(SK.imgSkipped, JSON.stringify(arr)); } catch (e) {}
        _imgSkipCache = arr; // 写穿缓存：本页后续查询立即命中新记录
        _imgSkipCacheAt = Date.now();
    },

    // 图片作答题：不调用 AI，记录并提示人工；尝试跳下一题（单次），跳不动则停在本题等人工
    handleImageSkip(q, hash) {
        XIA_AI.lastQuestionHash = hash; // 阻断同题重复扫描
        if (XIA_AI._imgLogged !== hash) {
            XIA_AI._imgLogged = hash;
            XIA_AI.imgSkipRemember(hash, q.question);
            XIA_AI.log(' 该题需要图片作答，已跳过，请人工上传图片: ' + (q.question || '').slice(0, 60), 'error');
            XIA_AI.progress('待人工处理：图片题已跳过');
            xaNotify('manual', '题目待人工处理', '图片作答题已跳过，请人工上传图片: ' + (q.question || '').slice(0, 60));
        }
        const now = Date.now();
        if (XIA_AI._lastNav && now - XIA_AI._lastNav < 2500) return;
        XIA_AI._lastNav = now;
        clickNextQuestionButton();
    },

    // 图片作答题自动作答：题干要求「拍照/上传图片」，LLM 产出不了图片文件，但可以把
    // 文本答案渲染成 PNG 走平台上传控件（utils.xaRenderTextPng + xaUploadAnswerPng）。
    // 任一步失败回退 handleImageSkip 人工路径（GM 记录持久，跨刷新不再重试）；
    // 上传派发后平台是否真正收件无法确证——按上传回显检测，检不到时日志明示请人工核对。
    answerImageQuestion(q, hash) {
        XIA_AI.lastQuestionHash = hash; // 处理中先占坑，防同题重复扫描
        XIA_AI.answering = true; // 占住答题态：扫描暂停、mainTick 不覆盖  进度行（所有出口复位）
        if (XIA_AI._imgBusyHash === hash) return;
        XIA_AI._imgBusyHash = hash;
        XIA_AI.log(' 图片作答题：生成文本答案并渲染成图片自动上传', 'ai');
        XIA_AI.callAI({ question: q.question, options: [], type: 'subjective', score: q.score, node: q.node }, ans => {
            if (!ans) {
                XIA_AI._imgBusyHash = '';
                XIA_AI.answering = false;
                XIA_AI.handleImageSkip(q, hash);
                return;
            }
            xaRenderTextPng(ans, png => {
                if (!png || !xaUploadAnswerPng(q.node, png)) {
                    XIA_AI._imgBusyHash = '';
                    XIA_AI.answering = false;
                    XIA_AI.log('答案图片渲染/上传失败（环境受限或无上传控件），留人工上传', 'error');
                    XIA_AI.handleImageSkip(q, hash);
                    return;
                }
                XIA_AI.log(' 答案图片已提交上传控件，3s 后校验上传回显', 'ok');
                setTimeout(() => {
                    XIA_AI._imgBusyHash = '';
                    const box = (q.node.closest && q.node.closest('.question-box')) || q.node;
                    if (!qsa('.el-upload-list__item, [class*="upload"] img', box).length) {
                        XIA_AI.log('未检测到上传回显，请人工确认该题图片是否已交', 'warn');
                    }
                    XIA_AI.bump('answered');
                    if (conf.confirmAnswer) { // 确认模式：上传后停，人工核对再翻题
                        XIA_AI.progress('待人工确认：图片题已上传');
                        XIA_AI.answering = false;
                        return;
                    }
                    clickNextQuestionButton();
                    XIA_AI.answering = false;
                }, 3000);
            });
        });
    },

    // 抓取当前题目（.homework-* 题块）
    grabQuestion() {
        try {
            const root = QA.questionRoot();
            if (!root) return null;
            const q = parseQuestionRoot(root);
            if (!q) { XIA_AI.log('抓到题目但解析失败（无标题/无选项/无输入框）', 'error'); return null; }
            return q;
        } catch (e) {
            XIA_AI.log('grabQuestion异常: ' + (e && e.message ? e.message : e), 'error');
            return null;
        }
    },

    // ==================== 检索增强（答题前先搜资料） ====================
    // 触发判定 needsSearch 已收敛至 XA_TOOLS（题目分类器统一维护）

    buildPrompt(question, options, type, ctx, score, blanks, course) {
        const opt = (options || []).map(o => o.letter + '. ' + o.text).join(' ');
        // 判断题在 parseQuestionRoot 已转为 single（选项 T.对/F.错 → A/B），
        // 但选项恰为「对/错」时按判断题出题，模型才稳定回字母而非中文。
        // 选项文本带字母前缀（真机 "T.对"/"F.错"），先剥前缀再匹配
        const stripOpt = t => String(t || '').replace(/^[A-Za-z][\.\．、:：]\s*/, '').trim();
        const isBool = options && options.length === 2
            && /^(对|正确|√)\s*$/.test(stripOpt(options[0].text))
            && /^(错|不正确|错误|×)\s*$/.test(stripOpt(options[1].text));
        // 课程背景（pageCourseContext 取自页面头部/描述表，可能为空）：注入学科领域，
        // 让模型按本课程的语境理解术语符号；零隐私成本（同源页面文本，不走外部服务）。
        // 课程语言记忆：本课程历史题目累计的语言词（≥2 次）随背景一并注入
        const langLine = course ? XIA_AI.courseLangLine(course) : '';
        const courseLine = course
            ? '【课程背景】本题出自「' + course + '」。请按该课程学科领域理解题目中的术语与符号。'
                + (langLine ? '\n' + langLine : '') + '\n\n'
            : '';
        let base;
        if (type === 'subjective') {
            // 代码编写题：答案应为完整代码而非论述文（否则模型把「编写脚本」答成议论文）
            if (XA_TOOLS.needsWriteCode(question)) {
                base = '你是编程助手。下面的题目要求编写代码，请直接给出完整代码作为答案。要求：\n'
                    + '- 用题目指定的语言（如 MATLAB/Python/C/Java）写出完整代码，包含初始化、循环、输出等题目要求的全部部分，可直接运行\n'
                    + '- 只输出代码本身，可在代码内加少量必要注释；禁止任何解释性文字、思路分析或开场白\n'
                    + '- 不要用 Markdown 代码块围栏（```）包裹，直接输出代码文本，保持正常换行与缩进\n\n'
                    + '题目：' + question;
                return courseLine + (ctx
                    ? '以下是检索到的相关资料（若与代码题无关可忽略）：\n' + ctx + '\n\n==========\n\n' + base
                    : base);
            }
            const words = targetWords(score);
            // 平台主观题按要点给分：按分值定要点数，每段首句必须是踩分点句，而非议论文式起承转合
            const pts = !score || score <= 0 ? 3 : score <= 5 ? 3 : score <= 10 ? 4 : score <= 20 ? 5 : 6;
            base = '你是考试答题助手。请回答下面的主观题' + (score > 0 ? '（' + score + '分）' : '') + '。平台按要点给分，要求：\n'
                + '- 直接输出答案正文，禁止任何开场白、引言或「以下是回答」之类的废话\n'
                + '- 围绕题目所问给出 ' + pts + ' 个左右要点，每个要点一个自然段：段落第一句必须是含学科关键词的踩分点句，其后 2-3 句展开论证或举例\n'
                + '- 要点覆盖题目所问的各个角度：宁可每点精炼而覆盖全面，不要单点长篇大论\n'
                + '- 整体篇幅约 ' + words + ' 字；分点用「第一/第二/第三」衔接，不要用 Markdown 符号、数字列表和标题\n\n'
                + '题目：' + question;
        } else if (type === 'cloze') {
            base = '你是答题助手。下面是一道填空题，共 ' + blanks + ' 空。请按顺序给出每空的答案：每空一行、只写答案本身，'
                + '不要序号、不要解释、不要重复题干。\n\n题目：' + question;
        } else if (type === 'multi') {
            // 多选丢分复盘（77/100：多选 5/10 错）：「拿不准宁可不选」在满分制下是毒药——
            // 漏选=错选=0 分，保守漏选（Q12/Q16）与只答单字母（Q9/Q10）同错；编造术语须警惕
            base = '你是答题助手。下面是一道多选题，请逐项独立判断每个选项的正误，再汇总作答。\n'
                + '- 先逐项简要判断（每个选项一行，如「A：正确，理由…」，每行不超过 20 字）\n'
                + '- 最后单独一行输出「答案：字母组合」，按字母顺序拼接（如 答案：ABC）\n'
                + '- 多选题通常有 2-4 个正确选项，很少只有 1 个；若只判断出 1 个正确，回头重新核查其余选项，确认没有漏判\n'
                + '- 漏选与错选都不得分：判断为「正确」的选项必须全部选上，不要保守漏选；只有确认「错误」才排除\n'
                + '- 警惕编造术语：选项里出现你没见过的术语组合（如「单峰式命名」），除非能确认它真实存在，否则视为干扰项不选\n'
                + '- 注意否定式提问（如「不正确/不属于/错误的是」），选出不符合题意的那些选项\n\n'
                + '题目：' + question + '\n\n选项：' + opt;
        } else if (isBool) {
            // 判断题易错点实测（2026-11 考试 77/100 复盘）：模型对绝对化表述倾向答「对」，
            // 对 HTML/技术概念细节不假思索直接出字母。要求先找反例再下结论，并给出
            // 常见陷阱清单，强制逐概念核对而非模式匹配
            base = '你是答题助手。下面是一道判断题，请判断题干说法是否正确。\n'
                + '- 先在心里找出反例或核对每个技术细节，再下结论；表述绝对化（「都/全部/一定/必须/并列」）时重点找反例\n'
                + '- 概念定义类表述以教材的严格定义核对：术语指代的范围被扩大或缩小（如把「直接子元素」泛化为「子元素」、把「并列」与「包含」混用）通常判错\n'
                + '- 说法正确输出 A，说法错误输出 B；只输出一个字母，不要解释\n'
                + '- 常见陷阱：看似合理但遗漏关键条件、概念关系表述错误（如并列/包含/嵌套搞反）、属性名或语法细节有误、把其他语言的函数名搬进本题语言（MATLAB 判空是 isempty 不是 empty）\n\n'
                + '题目：' + question;
        } else {
            base = '你是答题助手。请分析以下题目和选项，选出正确选项，直接输出该选项的字母（如 A），只输出一个字母，不要解释、不要换行。\n'
                + '- 注意否定式提问（如「不正确/不属于/与…无关的是」），选出不符合的一项\n'
                + '- 若多个选项看似都对，选最准确、最符合题意的一个\n'
                + '- 不要默认选第一个选项；先独立推断出答案，再匹配对应选项字母\n'
                + '- 警惕编造的 API/函数名：名字贴合题意但在该语言中不存在即干扰项（如 D3 无 getFirstElementByClass，d3.select 才是选第一个匹配；MATLAB 判空用 isempty 不是 empty），先用题目语言的真实标准库核对\n\n'
                + '题目：' + question + '\n\n选项：' + opt;
        }
        if (ctx) {
            return courseLine + '以下是检索到的相关资料（可能包含答案，请甄别并优先采信权威可靠来源；若资料与你的知识冲突，以资料为准）：\n' + ctx + '\n\n==========\n\n' + base;
        }
        return courseLine + base;
    },

    // ===== 课程语言记忆：以课程名（course 上下文首段）为键累计语言词，≥2 次注入 prompt =====
    courseLangLoad() {
        try {
            const v = _xaLangStore.get(XA_LANG_SK);
            return v && typeof v === 'object' ? v : {};
        } catch (e) { return {}; }
    },
    courseLangSave(prof) {
        try { _xaLangStore.set(XA_LANG_SK, prof); } catch (e) {}
    },
    courseLangKey(course) {
        const s = String(course || '').split('·')[0].trim();
        return s.length >= 2 && s.length <= 40 ? s : '';
    },
    rememberCourseLang(course, question) {
        const key = this.courseLangKey(course);
        if (!key) return;
        const found = String(question || '').match(XA_LANG_RE);
        if (!found) return;
        const langs = {}; // 同一题内去重：一题只记一次
        for (const raw of found) {
            const canon = XA_LANG_CANON[raw.toLowerCase()] || raw.toUpperCase();
            langs[canon] = 1;
        }
        const names = Object.keys(langs);
        if (!names.length) return;
        const prof = this.courseLangLoad();
        const rec = prof[key] || (prof[key] = { lang: {}, at: 0 });
        let crossed = false; // 本次有语言达到注入阈值时提示一次
        for (const n of names) {
            const was = rec.lang[n] || 0;
            if (was === 1) crossed = true; // 1 → 2 恰好过线
            rec.lang[n] = Math.min(was + 1, 999);
        }
        rec.at = Date.now();
        // 修剪：最多 20 门课（LRU），每门课最多保留 6 种语言（按次数取头部）
        const ckeys = Object.keys(prof);
        if (ckeys.length > 20) {
            ckeys.sort((a, b) => (prof[a].at || 0) - (prof[b].at || 0));
            while (Object.keys(prof).length > 20) delete prof[ckeys.shift()];
        }
        for (const k of Object.keys(prof)) {
            const L = Object.keys(prof[k].lang || {});
            if (L.length > 6) {
                L.sort((a, b) => prof[k].lang[b] - prof[k].lang[a]);
                const keep = {};
                for (const n of L.slice(0, 6)) keep[n] = prof[k].lang[n];
                prof[k].lang = keep;
            }
        }
        this.courseLangSave(prof);
        if (crossed) XIA_AI.log(' 课程语言记忆：已记住「' + key + '」主要涉及 ' + names.join('、') + '，后续题目将按此作答', 'ok');
    },
    courseLangLine(course) {
        const key = this.courseLangKey(course);
        if (!key) return '';
        const rec = this.courseLangLoad()[key];
        if (!rec || !rec.lang) return '';
        const names = Object.keys(rec.lang).filter(n => rec.lang[n] >= 2)
            .sort((a, b) => rec.lang[b] - rec.lang[a]).slice(0, 3);
        if (!names.length) return '';
        return '【课程语言记忆】本课程题目主要涉及 ' + names.join('、')
            + '——请始终使用对应语言的真实标准库与 API 作答，不要混入其他语言的相似函数名（如 MATLAB 判空用 isempty 而非 empty）。';
    },
    courseLangReset() {
        try { _xaLangStore.set(XA_LANG_SK, {}); } catch (e) {}
    },

    // 检索：cn.bing.com 国内直连，b_algo 结果块整块剥标签提取（标题+摘要兼顾）。
    // 原 Tavily（需付费 Key，从未配置）与 DDG（可能被墙，且失败兜底永远是 Bing）通道已移除——
    // 检索源唯一后，v3.15.1 修的「降级链卡死」问题类别不复存在；超时/网络错误一律跳过检索直接作答。
    searchWeb(query, cb) {
        const maxChars = CFG.SEARCH_MAX_CHARS;
        const done = ctx => { try { cb(ctx || ''); } catch (e) {} };
        GM_xmlhttpRequest({
            method: 'GET', timeout: 8000,
            url: 'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&mkt=zh-CN',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            onload: r => {
                try {
                    const out = [];
                    (r.responseText || '').split('class="b_algo"').slice(1).forEach(b => {
                        const t = b.replace(/^[^<]+/, '') // 去掉 li 开始标签残留属性（data-id 等）
                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<[^>]+>/g, ' ') // 先剥标签后截断，防切在标签中间留残骸
                            .replace(/\s+/g, ' ').trim().slice(0, 400);
                        if (t.length >= 10) out.push(t);
                    });
                    if (out.length) return done(out.join('\n').slice(0, maxChars));
                    XIA_AI.log('检索解析失败（Bing 返回无结果块），已跳过检索直接作答', 'error');
                    done('');
                } catch (e) { XIA_AI.log('检索解析失败: ' + e.message, 'error'); done(''); }
            },
            onerror: () => { XIA_AI.log('检索网络错误（Bing），已跳过检索直接作答', 'error'); done(''); },
            ontimeout: () => { XIA_AI.log('检索超时（8s），已跳过检索直接作答', 'error'); done(''); },
        });
    },

    // 解析 AI 回复：single 四级提取一个字母（防英文套话连带误取），multi 字母集合，cloze 按行切分，subjective 原文
    // validLetters：可选，本次题目的合法字母集（由调用方按实际选项数生成）。
    //   - 解析出的字母越界（幻觉出的选项）→ 视为解析失败走 strict 重试，防回填空转
    //   - 字母解析落空 → 按选项文本反查一次（模型常无视指令直接回选项内容）
    parseAnswer(content, type, validLetters, options) {
        // 先剥内嵌思考段：DeepSeek 官方把思考放独立字段（content 干净），但部分网关/本地部署
        // （Ollama、Qwen 网关）会把 <think>…</think> 内嵌进 content 返回，思考文本会污染字母
        // 提取。未闭合的 <think>（输出被截断）剥后为空 → 走解析失败 strict 重试。
        const c = String(content || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
        if (!c) return null;
        if (type === 'subjective') {
            // 代码题模型常无视「不要围栏」要求把整段答案包进 ```lang…```；整条回复恰为一个
            // 围栏块时剥壳留代码本体（论述文极少整体带围栏，误剥风险可忽略；未闭合/围栏内嵌
            // 正文的回复不动，宁可留原样也不误吞内容）
            const fence = c.match(/^```[a-zA-Z0-9_+#.-]*[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```$/);
            return fence ? fence[1].trim() : c;
        }
        if (type === 'cloze') {
            const lines = c.split(/\n+/).map(s => s.trim()).filter(Boolean);
            // 仅当多行且每行都带 1-2 位序号（1. / 2）/ （3、）），且剥后仍有非数字内容时才剥序号，
            // 防止误伤 "1949.10" 这类日期/数字答案
            const NUM_RE = /^\s*[（(]?\d{1,2}\s*[\.、\)．:：）]\s*/;
            const numbered = lines.length > 1 && lines.every(s => {
                if (!NUM_RE.test(s)) return false;
                const rest = s.replace(NUM_RE, '');
                return rest.length > 0 && /[^\d\s\.．、。:：]/.test(rest);
            });
            const clean = lines
                .map(s => (numbered ? s.replace(NUM_RE, '') : s).replace(/[\.．、。]\s*$/, '').trim())
                .filter(Boolean);
            return clean.length ? clean.join('|') : null;
        }
        if (type === 'multi') {
            // 分级提取：裸字母串 > 引导词后跟字母串 > 全文字母，统一排序去重。
            // 全文抓 [A-H] 会被回复正文里的英文单词（Based/Both）与缩写（GDP）污染，
            // 只有前两级落空时才兜底。分隔符类含「与/和」防「应选 A 与 C」截断丢字母
            const pick = s => String(s).toUpperCase().replace(/[^A-H]/g, '').split('').filter((ch, i, a) => a.indexOf(ch) === i).sort().join('');
            const bad = ls => validLetters && ls.split('').some(ch => validLetters.indexOf(ch) < 0); // 越界字母 → strict 重试
            const bare = c.match(/^[^A-Za-z]*([A-H][A-H\s\.．、,，与和]+)[^A-Za-z]*$/);
            if (bare && pick(bare[1]) && !bad(pick(bare[1]))) return pick(bare[1]);
            const guided = c.match(/(?:正确答案|应选|选|答案)[:：是为]?\s*([A-H][A-H\s\.．、,，与和]{0,})/);
            if (guided && pick(guided[1]) && !bad(pick(guided[1]))) return pick(guided[1]);
            // 末行层：多选 prompt 要求「逐项判断后最后一行给答案」，全文抓字母会被分析行里的
            // 选项字母（A：… B：…）污染——先试最后一行的纯字母组合（尾部只许标点，出现
            // 「错误/正确」等 CJK 判定词说明是分析行不是答案行，不命中）
            const lines = c.split(/\n+/).map(s => s.trim()).filter(Boolean);
            if (lines.length >= 2) {
                const lastM = lines[lines.length - 1].match(/^[^A-Za-z]*([A-H](?:[\s\.．、,，与和]*[A-H])*)[。\.]?\s*$/);
                if (lastM && pick(lastM[1]) && !bad(pick(lastM[1]))) return pick(lastM[1]);
            }
            const letters = c.toUpperCase().match(/[A-H]/g);
            const all = letters && letters.length ? letters.filter((ch, i, a) => a.indexOf(ch) === i).sort().join('') : '';
            return all && !bad(all) ? all : null;
        }
        const m = c.match(/^\s*([A-H])\s*$/i)
            || c.match(/(?:正确答案|参考答案|答案|应选|选|答|answer|option|choice)\s*(?:is|[:：是为])?\s*([A-H])(?![A-Za-z])/i)
            || c.match(/^\s*([A-H])[\s\.\．、:：]/i)
            || c.match(/\b([A-H])\b/i);
        let letter = m ? m[1].toUpperCase() : null;
        if (letter && validLetters && validLetters.indexOf(letter) < 0) return null; // 幻觉字母越界 → strict 重试
        if (!letter && validLetters) {
            // 字母提取落空：模型可能直接回了选项文本（「分位数」「正确」），按文本反查
            return this.matchByText(c, validLetters, options) || null;
        }
        return letter;
    },

    // 选项文本反查：AI 回复中完整包含某选项文本（≥2字，防单字误命中）→ 返回最长命中的选项字母
    matchByText(content, validLetters, options) {
        const c = String(content || '');
        let best = '';
        for (const o of (options || [])) {
            const t = String(o.text || '').trim();
            if (t.length >= 2 && c.indexOf(t) >= 0 && t.length > best.length) best = o.letter;
        }
        return best && (!validLetters || validLetters.indexOf(best) >= 0) ? best : '';
    },

    // 低层 LLM 传输：messages → onContent(content|null)。统一承载配置熔断（模型名/Key/余额）、
    // 瞬时故障降级链、token 用量累计、空内容与网络/超时错误处理；
    // 单发路径（ask）与代码题工具循环共用同一出口。
    //
    // 降级链（借鉴 OCS 类助手的模型容错思路，实现为本库自己的两发结构）：
    //   第 1 发 = 面板配置模型；瞬时故障（网络错误/超时/5xx/429/响应体解析失败/空内容）
    //   时发第 2 发——DeepSeek 官方端点或官方命名时降级 deepseek-chat（reasoner 偶发把
    //   max_tokens 全花在思考上导致 content 为空、或服务端限流，chat 模型能真正吐出内容），
    //   其他端点不猜第三方模型名，同模型重试一次。第 2 发再失败才如实 onContent(null)。
    //   确定性配置错误（401/402/模型名无效）走熔断，不进降级链——重试一个坏配置没有意义。
    _llmChat(messages, opts, onContent) {
        const apiKey = conf.apiKey;
        if (!apiKey) { XIA_AI.log('未配置 API Key', 'error'); onContent(null); return; }
        const base = (conf.apiBase || CFG.DEFAULT_API_BASE).replace(/\/+$/, '');
        const endpoint = /\/v\d+\/?$/.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions';
        // opts.model：调用方指定模型（视觉题走视觉模型）；opts.noFallback：不进降级链——
        // 降级目标是纯文本模型，接不住带图消息，硬降等于把图片题答瞎
        const model = opts.model || conf.model || CFG.DEFAULT_MODEL;
        const officialDs = /api\.deepseek\.com/i.test(base) || /^deepseek-(chat|reasoner)$/.test(model);
        const retryModel = opts.noFallback ? model : (officialDs && model !== 'deepseek-chat' ? 'deepseek-chat' : model);
        const retry = (attempt, why) => {
            if (attempt > 0) { onContent(null); return; }
            XIA_AI.log(' ' + why + '，' + (retryModel === model ? '同模型重试' : '降级重试 ' + retryModel), 'warn');
            send(retryModel, 1);
        };
        const send = (mdl, attempt) => {
            try {
                GM_xmlhttpRequest({
                    method: 'POST', url: endpoint, timeout: opts.timeout,
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                    data: JSON.stringify({
                        model: mdl,
                        messages: messages,
                        temperature: opts.temperature != null ? opts.temperature : 0.3,
                        max_tokens: opts.maxTokens,
                    }),
                    onload: res => {
                        const status = res.status || res.statusCode;
                        if (status && status >= 400) {
                            const body = res.responseText || '';
                            XIA_AI.log('AI 响应异常 HTTP ' + status + ' | ' + body.slice(0, 200), 'error');
                            // 确定性配置错误：熔断暂停自动答题，面板里改正配置后自动恢复
                            if (/invalid_request_error/i.test(body) && /model/i.test(body)) {
                                XIA_AI._cfgError = '模型名 "' + mdl + '" 无效，请修正面板中的模型名称';
                            } else if (status === 401) {
                                XIA_AI._cfgError = 'API Key 无效（401），请检查面板中的 Key';
                            } else if (status === 402) {
                                XIA_AI._cfgError = 'API 余额不足（402），请充值或更换接口';
                            }
                            if (XIA_AI._cfgError) {
                                XIA_AI.log(' ' + XIA_AI._cfgError + '，已暂停自动答题', 'error');
                                XIA_AI.progress('配置错误，已暂停');
                                xaNotify('cfg', '自动答题已暂停', XIA_AI._cfgError);
                                onContent(null); return;
                            }
                            // 5xx/429 = 服务端瞬时故障 → 降级链；其余 4xx 是确定性错误，重试无意义
                            if (status >= 500 || status === 429) retry(attempt, 'HTTP ' + status);
                            else onContent(null);
                            return;
                        }
                        let content = '', usage = null;
                        try {
                            const data = JSON.parse(res.responseText);
                            content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
                            usage = data.usage || null;
                        } catch (e) {}
                        if (usage) { // token 用量累计（面板统计展示；网关不带 usage 字段则恒 0 不展示）
                            XIA_AI.stats.tokensIn += Number(usage.prompt_tokens) || 0;
                            XIA_AI.stats.tokensOut += Number(usage.completion_tokens) || 0;
                            XIA_AI.bump();
                        }
                        if (!content) { XIA_AI.log('AI 响应无内容: ' + (res.responseText || '').slice(0, 200), 'error'); retry(attempt, '响应无内容'); return; }
                        onContent(content);
                    },
                    onerror: e => { XIA_AI.log('网络错误(发送失败): ' + (e && e.error ? e.error : ''), 'error'); retry(attempt, '网络错误'); },
                    ontimeout: () => { XIA_AI.log('请求超时(>' + opts.timeout / 1000 + 's): ' + endpoint, 'error'); retry(attempt, '请求超时'); },
                });
            } catch (e) {
                XIA_AI.log('LLM 请求异常: ' + e.message, 'error');
                onContent(null);
            }
        };
        send(model, 0);
    },

    // 连接健康检查：发一条最小请求（max_tokens 8）测 Key / 模型名 / 端点连通性与延迟。
    // 不走降级链、不触发熔断——检查结果只做展示，改不改由用户看着办。
    // HTTP 200 即算通过（reasoner 小 max_tokens 下 content 可能为空，那是已知特性不是故障）。
    // onDone(ok, info)；info = { ms, why, content }，UI 层负责把结果映到状态灯。
    healthCheck(onDone) {
        const apiKey = conf.apiKey;
        if (!apiKey) { XIA_AI.log('未配置 API Key，无法测试连接', 'error'); if (onDone) onDone(false, { why: '未配置 Key' }); return; }
        const base = (conf.apiBase || CFG.DEFAULT_API_BASE).replace(/\/+$/, '');
        const endpoint = /\/v\d+\/?$/.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions';
        const model = conf.model || CFG.DEFAULT_MODEL;
        XIA_AI.log(' 测试连接 ' + endpoint + '（模型 ' + model + '）…', 'ai');
        const t0 = Date.now();
        try {
            GM_xmlhttpRequest({
                method: 'POST', url: endpoint, timeout: 20000,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                data: JSON.stringify({ model: model, messages: [{ role: 'user', content: '回复OK' }], max_tokens: 8, temperature: 0 }),
                onload: res => {
                    const status = res.status || res.statusCode;
                    const ms = Date.now() - t0;
                    const body = res.responseText || '';
                    if (status >= 400) {
                        // 错误归类与 _llmChat 熔断同源，但这里只报不改状态
                        let why = 'HTTP ' + status;
                        if (status === 401) why = 'API Key 无效（401）';
                        else if (status === 402) why = '余额不足（402）';
                        else if (status === 429) why = '限流（429，Key 有效但被限流）';
                        else if (/invalid_request_error/i.test(body) && /model/i.test(body)) why = '模型名无效';
                        XIA_AI.log(' 测试失败：' + why + ' | ' + body.slice(0, 160), 'error');
                        if (onDone) onDone(false, { ms: ms, why: why });
                        return;
                    }
                    let content = '';
                    try {
                        const d = JSON.parse(body);
                        content = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
                    } catch (e) {}
                    XIA_AI.log(' 测试通过（' + ms + 'ms）' + (content ? '：模型回复 "' + content.trim().slice(0, 20) + '"' : ''), 'ok');
                    if (onDone) onDone(true, { ms: ms, content: content });
                },
                onerror: () => { XIA_AI.log(' 测试失败：网络错误（端点不可达或被墙）', 'error'); if (onDone) onDone(false, { why: '网络错误' }); },
                ontimeout: () => { XIA_AI.log(' 测试失败：连接超时（>20s）', 'error'); if (onDone) onDone(false, { why: '连接超时' }); },
            });
        } catch (e) {
            XIA_AI.log(' 测试请求异常: ' + e.message, 'error');
            if (onDone) onDone(false, { why: '请求异常' });
        }
    },

    // 调用 LLM。q 为 grabQuestion() 结果；onResult(answer|null)。
    // 客观题解析失败自动带强调词重试一次；确定性配置错误（模型名/Key/余额）触发熔断。
    // 代码题（XA_TOOLS.needsCodeTool 判定）走本机沙箱工具循环：模型可要求在本机 Worker
    // 里实际运行 JavaScript 验证推理，结果回灌迭代（≤3 轮）后再给最终答案。
    callAI(q, onResult) {
        const type = q.type || 'single';
        const isSubjective = type === 'subjective';
        const apiKey = conf.apiKey;
        if (!apiKey) { XIA_AI.log('未配置 API Key', 'error'); onResult(null); return; }
        const model = conf.model || CFG.DEFAULT_MODEL;
        // reasoning 类模型（deepseek-reasoner / o1 / qwq 等）思考耗 token，max_tokens 与超时放宽防 content 为空
        const isReasoning = /reasoner|thinking|qwq|r1|o1|o3|o4/i.test(model);
        const maxTokens = isSubjective ? (isReasoning ? 3000 : 2000)
            : type === 'cloze' ? 300
            : type === 'multi' ? (isReasoning ? 1024 : 512) // 多选逐项判断后单独一行给答案：16 必截断，512 防 8 选项判断行截掉末行答案（截断会让兜底全文抓字母误并判断行）
            : (isReasoning ? 1024 : 16);
        const timeout = (isSubjective || isReasoning) ? 60000 : 20000;

        const needSearch = conf.searchMode === 'always'
            || (conf.searchMode === 'auto' && !isSubjective && type !== 'cloze' && XA_TOOLS.needsSearch(q.question));
        const course = QA.pageCourseContext ? QA.pageCourseContext() : ''; // 课程上下文短串，可能为空
        // 课程语言记忆：记录本题语言特征（去重计数、GM 持久化），累计 ≥2 次后注入后续题目
        try { XIA_AI.rememberCourseLang(course, q.question); } catch (e) {}

        // 合法字母集（按实际选项数）：解析出越界字母视为失败，strict 重试而不是回填空转
        const optCount = (q.options || []).length;
        const validLetters = (type === 'single' || type === 'multi') && optCount > 0
            ? Array.from({ length: Math.min(optCount, 8) }, (_, i) => String.fromCharCode(65 + i)).join('')
            : '';

        // ===== 视觉模型看图作答：题块内带图且面板配了视觉模型时改走该模型 =====
        // DeepSeek 系是纯文本模型看不了图；视觉模型（Qwen2.5-VL / GLM-4V / gpt-4o 等）
        // 与主模型共用同一端点与 Key，仅模型名不同。图片先拉成本地 dataURL——
        // 平台 CDN 直链让服务端去拉多半被防盗链挡掉，带 Cookie 的本地拉取才过得去。
        // 未配视觉模型时照旧纯文本作答（题干里的「如图」文本模型只能瞎猜，维持原行为）。
        const visionModel = conf.visionModel || '';
        if (visionModel && q.images && q.images.length) {
            const vMax = isSubjective ? 2000 : type === 'multi' ? 1024 : type === 'cloze' ? 300 : 512;
            const vAsk = (strict, imgs) => {
                const prompt = XIA_AI.buildPrompt(q.question, q.options, type, '', q.score, q.blanks, course)
                    + '\n\n题目附有 ' + imgs.length + ' 张图片（随本消息一并提供），题干提及的图形/图表/公式细节以图片为准。'
                    + (strict ? '\n\n（重要：上一轮回复格式不符合要求。请严格按约定格式只输出答案本身，不要输出任何其他文字。）' : '');
                const content = [{ type: 'text', text: prompt }]
                    .concat(imgs.map(u => ({ type: 'image_url', image_url: { url: u } })));
                XIA_AI.log(' 请求视觉模型 ' + visionModel + '（' + imgs.length + ' 张图' + (strict ? '，格式重试' : '') + '）', 'ai');
                XIA_AI._llmChat([{ role: 'user', content: content }],
                    { model: visionModel, noFallback: true, maxTokens: vMax, timeout: 60000, temperature: 0.3 }, resp => {
                        const answer = XIA_AI.parseAnswer(resp, type, validLetters, q.options);
                        if (!answer) {
                            if (!strict && !isSubjective) { vAsk(true, imgs); return; } // 客观题强调格式重试一次
                            XIA_AI.log('视觉模型返回无法解析: "' + String(resp || '').trim().slice(0, 80) + '"', 'error');
                            onResult(null);
                            return;
                        }
                        XIA_AI.log('AI 答案（视觉） → ' + (isSubjective ? answer.slice(0, 80) + '…' : answer), 'ok');
                        onResult(answer);
                    });
            };
            let left = q.images.length;
            const got = [];
            XIA_AI.log(' 题干带 ' + q.images.length + ' 张图，拉取后走视觉模型 ' + visionModel, 'ai');
            q.images.forEach(src => {
                xaFetchImageDataURL(src, d => {
                    if (d) got.push(d);
                    if (--left > 0) return;
                    if (!got.length) { // 全部拉取失败：带图题纯文本必瞎答，如实失败交回（重试耗尽后留人工）
                        XIA_AI.log('题干图片全部拉取失败，本轮放弃作答', 'error');
                        onResult(null);
                        return;
                    }
                    if (got.length < q.images.length) XIA_AI.log('有 ' + (q.images.length - got.length) + ' 张图片拉取失败，按剩余图片作答', 'warn');
                    vAsk(false, got);
                });
            });
            return;
        }

        // ===== 工具题本机沙箱循环（tools.js 的 runJs；检索增强在此模式不叠加——
        // 代码题的事实检索价值低、计算题靠沙箱而非检索，多一路外部依赖只增加延迟与噪声）=====
        const wantCode = isSubjective && XA_TOOLS.needsWriteCode(q.question); // 主观题代码编写题：最终答案给代码
        if (XA_TOOLS.needsCodeTool(q.question) || XA_TOOLS.needsCalcTool(q.question)) {
            const mt = Math.max(maxTokens, 1200);           // 循环回复含代码与推理，客观题 16 token 上限不适用
            const tt = Math.max(timeout, 60000);            // 多轮工具轮次放宽超时
            const finalFmt = type === 'subjective'
                ? (wantCode
                    ? '直接用题目要求的语言给出完整代码作为最终答案（不要用 JavaScript 替代、不要用代码块围栏包裹、不要输出任何解释性文字）'
                    : '直接给出最终答案正文（纯文本，不要用代码块包裹）')
                : '在最后单独一行按「' + (type === 'multi' ? '字母组合如 ABC' : type === 'cloze' ? '每空一行、只写答案' : '单个字母如 A') + '」格式给出最终答案';
            const proto = '\n\n==========\n你还可以使用「本机沙箱运行」工具验证推理（非 JS 代码先翻译成等价 JavaScript）：\n'
                + '- 需要运行时，输出一个代码块，语言标记必须为 run：\n'
                + '```run\n// 纯 JavaScript 计算；用 console.log 打印中间结果；最后一个表达式作为返回值\n'
                + '// 沙箱无网络、无 DOM，只做纯计算\n```\n'
                + '- 我会把运行日志与表达式结果回给你，最多可运行 3 次\n'
                + '- 得出结论后停止输出代码块，' + finalFmt + '\n'
                + '- 仅在确有验证价值时才运行（如验证输出、模拟循环、核算数值），不要为运行而运行';
            let messages = [{ role: 'user', content: XIA_AI.buildPrompt(q.question, q.options, type, '', q.score, q.blanks, course) + proto }];
            let nudged = false; // 格式纠正只做一次
            XIA_AI.log(' ' + (XA_TOOLS.needsCodeTool(q.question) ? '代码题' : '计算题') + '：启用本机沙箱执行辅助（≤3 轮）', 'ai');
            const finish = content => {
                const answer = XIA_AI.parseAnswer(XA_TOOLS.stripRunBlocks(content), type, validLetters, q.options);
                if (answer) {
                    XIA_AI.log('AI 答案 → ' + (isSubjective ? answer.slice(0, 80) + '…' : answer), 'ok');
                    onResult(answer);
                    return true;
                }
                return false;
            };
            const step = left => {
                XIA_AI.log('请求 ' + model + '（代码题工具轮，剩 ' + left + ' 次运行额度）', 'ai');
                XIA_AI._llmChat(messages, { maxTokens: mt, timeout: tt, temperature: wantCode ? 0.2 : (isSubjective ? 0.7 : 0.2) }, content => {
                    if (!content) { onResult(null); return; }
                    const code = XA_TOOLS.extractRunBlock(content);
                    if (code && left > 0) {
                        XIA_AI.log(' 沙箱运行模型代码（' + (3 - left + 1) + '/3）…', 'ai');
                        XA_TOOLS.runJs(code, r => {
                            XIA_AI.log(' 运行结果: ' + XA_TOOLS.formatRunResult(r).replace(/\n/g, ' ').slice(0, 90), 'ai');
                            messages = messages.concat([
                                { role: 'assistant', content: content },
                                { role: 'user', content: '运行结果：\n' + XA_TOOLS.formatRunResult(r) + '\n\n请继续分析；若已有结论，直接给最终答案，不要再输出 run 代码块。' },
                            ]);
                            step(left - 1);
                        });
                        return;
                    }
                    if (finish(content)) return;
                    if (!nudged) {
                        nudged = true;
                        messages = messages.concat([
                            { role: 'assistant', content: content },
                            { role: 'user', content: '以上回复不符合答案格式要求' + (code ? '，且运行次数已用完不能再执行代码' : '')
                                + '。请直接按约定格式给出最终答案，不要输出任何代码块。' },
                        ]);
                        XIA_AI._llmChat(messages, { maxTokens: mt, timeout: tt, temperature: 0.2 }, c2 => {
                            if (c2 && finish(c2)) return;
                            XIA_AI.log('AI 返回无法解析: "' + XA_TOOLS.stripRunBlocks(c2 || content).slice(0, 80) + '"', 'error');
                            onResult(null);
                        });
                        return;
                    }
                    XIA_AI.log('AI 返回无法解析: "' + XA_TOOLS.stripRunBlocks(content).slice(0, 80) + '"', 'error');
                    onResult(null);
                });
            };
            step(3);
            return;
        }

        const ask = (ctx, strict) => {
            let prompt = XIA_AI.buildPrompt(q.question, q.options, type, ctx, q.score, q.blanks, course);
            if (strict) {
                prompt += type === 'cloze'
                    ? '\n\n（重要：上一轮回复格式不符合要求。请严格每空一行、每行只写一个答案，不要任何其他文字。）'
                    : '\n\n（重要：上一轮回复格式不符合要求。只输出选项字母，不要输出任何其他文字。'
                        + (validLetters ? '本题只有 ' + validLetters.length + ' 个选项，只能从 ' + validLetters.split('').join('/') + ' 中选择。' : '')
                        + '）';
            }
            XIA_AI.log('请求 ' + model + (ctx ? '（含检索资料）' : '') + (strict ? '（格式重试）' : ''), 'ai');
            XIA_AI._llmChat([{ role: 'user', content: prompt }], { maxTokens: maxTokens, timeout: timeout, temperature: isSubjective ? (wantCode ? 0.2 : 0.7) : 0.3 }, content => {
                const answer = XIA_AI.parseAnswer(content, type, validLetters, q.options);
                if (!answer) {
                    if (!strict && !isSubjective) { ask(ctx, true); return; } // 强调格式重试一次
                    XIA_AI.log('AI 返回无法解析: "' + content.trim().slice(0, 80) + '"', 'error');
                    onResult(null); return;
                }
                XIA_AI.log('AI 答案 → ' + (isSubjective ? answer.slice(0, 80) + '…' : answer), 'ok');
                onResult(answer);
            });
        };

        if (needSearch) {
            XIA_AI.log(' 先检索相关资料…', 'ai');
            XIA_AI.searchWeb(q.question, ctx => ask(ctx || '', false));
        } else {
            ask('', false);
        }
    },

    // 强制点击：原生 click + 合成事件 + 内部 input（单选回填用）
    forceClick(el) {
        if (!el) return;
        try { el.click(); } catch (e) {}
        try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        const input = el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
        if (input) {
            try { input.checked = true; } catch (e) {}
            try { input.click(); } catch (e) {}
            try { input.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {}
            try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
            const group = el.closest && el.closest('.el-radio-group, .el-checkbox-group, [role="radiogroup"], [role="group"]');
            if (group) {
                try { group.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
                try { group.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
            }
        }
    },

    // 按字母逐个点击选项（单选/多选统一入口）：字母定位失败按位置兜底；
    // 多选只点未选中的防误取消；全部点完回调 onDone
    fillChoice(letters, root, onDone) {
        const qEl = root || QA.questionRoot();
        if (!qEl) { XIA_AI.log('页面已无题目容器，无法点击', 'error'); if (onDone) onDone(false); return; }
        const isMulti = QA.questionType(qEl) === 'multi';
        const labels = qsa('.el-radio, .el-checkbox', qEl);
        const arr = String(letters).toUpperCase().replace(/[^A-H]/g, '').split('');
        let i = 0;
        const step = () => {
            if (i >= arr.length) { if (onDone) onDone(true); return; }
            const ch = arr[i++];
            let hit = null;
            for (const l of labels) if (QA.letterOf(l) === ch) { hit = l; break; }
            if (!hit) hit = labels[ch.charCodeAt(0) - 65]; // 位置兜底：第 i 个选项 = 字母 A+i
            if (!hit) { XIA_AI.log('找不到选项 ' + ch + ' 的节点', 'error'); step(); return; }
            if (isMulti) {
                // 原生 click 驱动（浏览器真实派发 change，Vue v-model 才会更新）；已选中则跳过防误取消
                const input = hit.querySelector('input[type="radio"], input[type="checkbox"]');
                if (input && !input.checked) {
                    try { input.click(); } catch (e) { try { XIA_AI.forceClick(hit); } catch (e2) {} }
                }
            } else {
                const inner = hit.querySelector('.el-radio__inner, .el-checkbox__inner');
                if (inner) XIA_AI.forceClick(inner);
                XIA_AI.forceClick(hit);
            }
            XIA_AI.log('点击选项 ' + ch, 'ok');
            setTimeout(step, isMulti ? 350 : 150);
        };
        step();
    },

    // 填空题：答案形如 "a|b|c"，逐个填入题干下的输入框
    // （原型 setter 绕过 Vue 对 value 的劫持 + input/change 事件驱动 v-model）
    fillCloze(answer, root, onDone) {
        const inputs = qsa('input', root).filter(el => visible(el) && !el.disabled && !el.readOnly && !/(radio|checkbox|hidden|file|button|submit)/i.test(el.type));
        const parts = String(answer).split('|');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        let ok = 0;
        inputs.slice(0, parts.length).forEach((input, i) => {
            const v = parts[i];
            try { setter.set.call(input, v); } catch (e) { try { input.value = v; } catch (e2) {} }
            try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
            try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
            if ((input.value || '') === v) ok++;
        });
        if (ok > 0) XIA_AI.log('填空题已填 ' + ok + '/' + inputs.length + ' 空', 'ok');
        else XIA_AI.log('填空题填入失败（输入框未接受内容）', 'error');
        if (onDone) onDone(ok > 0);
    },

    // root（可选）：当前题目容器。优先在题块内找编辑器——答题卡全览等场景可能同屏多个
    // 编辑器，全页选择器会填错题；题块内找不到再回退全页（root 缺失/DOM 重建间隙兜底）。
    answerSubjective(answer, root, onDone) {
        const scope = (root && root.querySelectorAll) ? root : document;
        const editor = scope.querySelector('[data-slate-editor]')
            || scope.querySelector('div.w-e-text-container [contenteditable="true"]')
            || scope.querySelector('[contenteditable="true"]')
            || document.querySelector('[data-slate-editor]')
            || document.querySelector('div.w-e-text-container [contenteditable="true"]')
            || document.querySelector('[contenteditable="true"]');
        if (!editor) {
            XIA_AI.log('未找到主观题编辑器', 'error');
            if (onDone) onDone(false);
            return;
        }
        try { editor.focus(); } catch (e) {}
        try { editor.click(); } catch (e) {}
        try { editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
        try { editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
        try { editor.dispatchEvent(new FocusEvent('focus', { bubbles: true })); } catch (e) {}
        setTimeout(() => {
            // 全选现有内容：首段插入会替换占位/旧内容
            const sel = window.getSelection();
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(editor);
            sel.addRange(range);

            // 按段落逐段插入，段间派发 insertParagraph（wangEditor 等富文本会响应 beforeinput）。
            // 只去行尾空白、保留行首缩进：代码编写题的缩进是答案可读性的一部分
            const paras = String(answer).split(/\n+/).map(s => s.replace(/\s+$/, '')).filter(Boolean);
            const normLen = () => (editor.textContent || '').replace(/\s+/g, '').length;
            const expected = paras.join('').replace(/\s+/g, '').length;
            const bi = (inputType, data) => {
                try {
                    editor.dispatchEvent(new InputEvent('beforeinput', {
                        bubbles: true, cancelable: true, inputType: inputType, data: data,
                    }));
                } catch (e) {}
            };
            let len = normLen();
            for (let i = 0; i < paras.length; i++) {
                if (i > 0) bi('insertParagraph', null);
                bi('insertText', paras[i]);
                if (normLen() === len) {
                    // 编辑器未响应合成 beforeinput（dispatchEvent 不抛错，只能靠长度回读判断），降级 execCommand
                    try { if (i > 0) document.execCommand('insertParagraph', false); } catch (e) {}
                    try { document.execCommand('insertText', false, paras[i]); } catch (e) {}
                }
                len = normLen();
            }
            try { editor.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}

            const after = normLen();
            let ok = false;
            if (after > 0 && after >= expected * 0.6) {
                XIA_AI.log('主观题答案已填入（约' + after + '字）: ' + paras[0].slice(0, 50) + (paras[0].length > 50 ? '…' : ''), 'ok');
                ok = true;
            } else if (after > 0) {
                XIA_AI.log('主观题填入不完整（目标约' + expected + '字，实际' + after + '字），请人工检查补全', 'info');
            } else {
                XIA_AI.log('主观题填入失败（编辑器未响应合成输入），请手动作答', 'error');
            }
            if (onDone) onDone(ok);
        }, 200);
    },

    // 回填后校验是否真实生效；未生效重置 hash 重试（≤3 次），超限标记跳过本题防死循环
    verifyAndAdvance(q, hash, answer) {
        setTimeout(() => {
            let ok;
            if (q.type === 'cloze') ok = qsa('input', q.node).some(inp => (inp.value || '').trim());
            else ok = QA.allSelected(q.node, answer);
            if (XIA_AI._failHash !== hash) XIA_AI._failCount = 0;
            if (ok) {
                XIA_AI._failHash = '';
                XIA_AI._failCount = 0;
                XIA_AI.bump('answered');
                XIA_AI._answerGap();
                if (conf.confirmAnswer) { // 确认模式：填完即停，人工核对后自行翻题/提交（保留 hash 防重答）
                    XIA_AI.log(' 确认模式：答案已填入，请人工核对后自行点击下一题或提交', 'info');
                    XIA_AI.progress('待人工确认：答案已填入');
                    XIA_AI.answering = false;
                    return;
                }
                XIA_AI.lastQuestionHash = '';
                XIA_AI.log('回填已生效，跳转下一题', 'ok');
                clickNextQuestionButton();
                XIA_AI.answering = false;
                return;
            }
            XIA_AI._failHash = hash;
            XIA_AI._failCount++;
            if (XIA_AI._failCount >= 3) {
                XIA_AI._failHash = '';
                XIA_AI._failCount = 0;
                XIA_AI.lastQuestionHash = hash; // 标记为已处理，避免同题无限重答
                XIA_AI.log('回填连续 3 次未生效，跳过本题（可手动作答）', 'error');
                xaNotify('manual', '题目待人工处理', 'AI 答案回填连续 3 次未生效，已跳过本题，请人工作答');
            } else {
                XIA_AI.lastQuestionHash = '';
                XIA_AI.log('回填未生效，下一轮重试 (' + XIA_AI._failCount + '/3)', 'error');
            }
            XIA_AI.answering = false;
        }, 800);
    },

    // 答完自动提交作业：点「提交作业」并自动确认；弹窗提示有未答题时取消并留给人工。
    // 仅精确匹配「提交作业」按钮，绝不触碰考试类的「交卷/提交试卷」；确认模式下整体停用。
    // 实现委托 cruise.js 的 runAutoSubmit（同 IIFE 作用域运行期解析，兼容测试部分加载）。
    tryAutoSubmit() { return runAutoSubmit(); },
    answerOnce() {
        if (XIA_AI.answeringOnce) { XIA_AI.log('正在执行单次答题，请稍候', 'error'); return; }
        const q = XIA_AI.grabQuestion();
        if (!q || !q.question || (q.type !== 'subjective' && q.type !== 'cloze' && q.options.length === 0)) {
            XIA_AI.log('当前页面未找到可答题目', 'error');
            return;
        }
        if (isImageAnswerQuestion(q.node)) {
            XIA_AI.log(' 该题需要图片作答，请人工上传图片', 'error');
            return;
        }
        XIA_AI.answeringOnce = true;
        XIA_AI.log(' 单次答题: ' + q.question.slice(0, 60) + (q.question.length > 60 ? '…' : ''), 'ok');
        XIA_AI.callAI(q, answer => {
            XIA_AI.answeringOnce = false;
            if (!answer) return;
            if (q.type === 'subjective') {
                XIA_AI.answerSubjective(answer, q.node, ok => XIA_AI.log(ok ? '单次答题（主观）完成' : '主观题填入失败', ok ? 'ok' : 'error'));
            } else if (q.type === 'cloze') {
                XIA_AI.fillCloze(answer, q.node, ok => XIA_AI.log(ok ? '单次答题（填空）完成' : '填空填入失败', ok ? 'ok' : 'error'));
            } else {
                XIA_AI.fillChoice(answer, q.node, ok => XIA_AI.log(ok ? '单次答题完成' : '回填失败', ok ? 'ok' : 'error'));
            }
        });
    },

    scan() {
        if (!conf.autoAnswer || XIA_AI.answering) return;
        // 运行时段闸：时段外自动答题暂停（边界跨越由闸门打日志），手动操作不受限
        if (!xaScheduleGate()) return;
        // 路由短路：视频/课程/首页等无题目路由直接返回，挂机刷课时不再每 3s 全量扫 DOM。
        // 卷面页（homeworkPaperId）/作业列表/考试页均含 homework|exam 字样，放行
        if (!routeHasQuestions(location.hash)) return;
        if (XIA_AI._cfgError) { // 配置熔断：暂停扫描，面板改正任一 AI 配置项后自动恢复
            const now = Date.now();
            if (now - XIA_AI._cfgLogAt > 30000) {
                XIA_AI._cfgLogAt = now;
                XIA_AI.log(' 已暂停：' + XIA_AI._cfgError, 'error');
            }
            return;
        }
        try { if (homeworkWalker()) return; } catch (e) { console.log('[XIA-walker] 异常', e); }
        if (XIA_AI._donePage && (location.hash + location.pathname) === XIA_AI._donePage) return; // 本卷刚提交成功，等 walker 接管

        // 答题间隔：答完一题后等待 N 秒再答下一题（面板可配，0=不等待）
        if (XIA_AI._nextAnswerAt && Date.now() < XIA_AI._nextAnswerAt) {
            XIA_AI.progress('等待答题间隔 ' + Math.ceil((XIA_AI._nextAnswerAt - Date.now()) / 1000) + 's');
            return;
        }

        const q = XIA_AI.grabQuestion();
        if (!q || !q.question) return;
        if (q.type !== 'subjective' && q.type !== 'cloze' && q.options.length === 0) return;

        const hash = questionHash(q);
        if (hash === XIA_AI.lastQuestionHash) return;

        // 已作答：跳到下一题（questionRoot 优先返回未答题，此处多为最后一题或翻页失败）
        if (QA.isAnswered(q.node)) {
            if (conf.confirmAnswer) return; // 确认模式：翻题/提交权留给人工，脚本不代跳
            const now = Date.now();
            if (XIA_AI._lastNav && now - XIA_AI._lastNav < 2500) return;
            if (XIA_AI._skipHash === hash) XIA_AI._skipCount++;
            else { XIA_AI._skipHash = hash; XIA_AI._skipCount = 0; }
            if (XIA_AI._skipCount >= 2) {
                if (XIA_AI._skipCount === 2) XIA_AI.log('已是最后一题或无法翻页，停止自动跳题', 'info');
                if (conf.autoSubmit) XIA_AI.tryAutoSubmit(); // 卡在最后一题：触发自动提交（30s 节流重试）
                return;
            }
            XIA_AI._lastNav = now;
            XIA_AI.lastQuestionHash = '';
            XIA_AI.log('题目已作答，跳到下一题', 'info');
            clickNextQuestionButton();
            return;
        }

        // 图片作答题：先尝试「文本答案→渲染成 PNG→上传控件交图」（仅首遇一次）；
        // 已有跳过记录的题不再重复尝试（imgSkipped GM 持久，跨刷新生效）
        if (XIA_AI.imgSkippedHas(hash)) {
            XIA_AI.handleImageSkip(q, hash);
            return;
        }
        if (isImageAnswerQuestion(q.node)) {
            XIA_AI.answerImageQuestion(q, hash);
            return;
        }

        XIA_AI.scanAI(q, hash);
    },

    // 答题主流程：会话缓存 → 检索 → LLM（原 scan 主体后段）
    scanAI(q, hash) {
        XIA_AI.answering = true;
        XIA_AI.progress(q.question.slice(0, 24));
        XIA_AI.log(' 抓到题目: ' + q.question.slice(0, 60) + (q.question.length > 60 ? '…' : '')
            + ' [' + q.type + (q.score ? ' ' + q.score + '分' : '') + ']');
        if (q.options.length) XIA_AI.log('选项 ' + q.options.length + ' 个: ' + q.options.map(o => o.letter).join(' '));

        // 回填出口：AI 应答与会话内答案复用走同一出口（回填失败重试由 verifyAndAdvance 驱动，不重打 LLM）
        const apply = ans => {
            XIA_AI.lastQuestionHash = hash; // 标记已处理，避免同页重复作答
            if (q.type === 'subjective') {
                XIA_AI.answerSubjective(ans, q.node, ok => {
                    if (ok) {
                        XIA_AI.bump('answered');
                        XIA_AI._answerGap();
                        if (conf.confirmAnswer) { // 确认模式：主观题人工核对修改，不代跳
                            XIA_AI.log(' 确认模式：主观题答案已填入，请人工核对修改', 'info');
                            XIA_AI.progress('待人工确认：答案已填入');
                            XIA_AI.answering = false;
                            return;
                        }
                        XIA_AI.log('主观题答案已填入，2s 后跳转下一题', 'ok');
                        setTimeout(() => { clickNextQuestionButton(); XIA_AI.answering = false; }, 2000);
                    } else {
                        // 填入失败/不完整：保留 hash 不再自动重答，留在本题等人工处理
                        XIA_AI.log('主观题未成功填入，已停止自动跳转，请人工处理', 'error');
                        xaNotify('manual', '题目待人工处理', '主观题答案未能自动填入，已停在该题，请人工补答');
                        XIA_AI.answering = false;
                    }
                });
            } else if (q.type === 'cloze') {
                XIA_AI.fillCloze(ans, q.node, () => XIA_AI.verifyAndAdvance(q, hash, ans));
            } else {
                XIA_AI.fillChoice(ans, q.node, () => XIA_AI.verifyAndAdvance(q, hash, ans));
            }
        };

        const memo = XIA_AI._answerMemo[hash];
        if (memo !== undefined) {
            XIA_AI.log(' 本会话已答过同题，直接复用答案（免 LLM 请求）', 'ok');
            apply(memo);
            return;
        }

        XIA_AI.callAI(q, ans => {
            if (!ans) {
                XIA_AI.lastQuestionHash = ''; // 未答出：重置 hash 下一轮重试
                XIA_AI.bump('failed');
                XIA_AI.log('AI 未返回答案，下一轮将重试本题', 'error');
                XIA_AI.answering = false;
                return;
            }
            XIA_AI._memoRemember(hash, ans);
            apply(ans);
        });
    },



    testGrab() {
        const q = XIA_AI.grabQuestion();
        if (!q || !q.question) { XIA_AI.log('[测试] 未抓到题目（grabQuestion=null）', 'error'); return; }
        XIA_AI.log('[测试] 题目 [' + q.type + (q.score ? ' ' + q.score + '分' : '') + ']: ' + q.question.slice(0, 150), 'ai');
        if (q.options.length) q.options.forEach(o => XIA_AI.log('[测试] 选项 ' + o.letter + ': ' + o.text.slice(0, 60), 'ai'));
        else if (q.type === 'cloze') XIA_AI.log('[测试] 填空 ' + q.blanks + ' 空', 'ai');
        else XIA_AI.log('[测试] 无选项（主观题属正常）', 'ai');
    },

    //  诊断：dump 当前页题目 DOM 结构（平台改版后按真机结构修选择器用）
    diagnose() {
        const out = [];
        const push = s => { out.push(s); XIA_AI.log(s, 'ai'); };
        push(' 诊断 ' + location.href.slice(0, 70));
        const roots = qsa(XIA_QROOT);
        push(' .homework-*根=' + roots.length + (roots.length ? '' : ' → 走兜底'));
        roots.slice(0, 5).forEach((r, i) => push('  [' + i + '] class="' + (r.className || '').slice(0, 60) + '" h=' + r.offsetHeight + ' 类型=' + questionType(r)));
        const tags = qsa('.question-tag-score');
        push(' .question-tag-score=' + tags.length);
        if (tags.length) {
            const p = tags[0].closest('.question-box') || tags[0].parentElement;
            if (p) push('  兜底容器 class="' + (p.className || '').slice(0, 60) + '" 含题干=' + !!p.querySelector('.topic-title, .subject-title'));
        }
        push(' div.question=' + qsa('div.question').length + '（旧结构，应为0）');
        push(' iframe=' + qsa('iframe').length + ' radio=' + qsa('.el-radio').length + ' checkbox=' + qsa('.el-checkbox').length);
        const root = questionRoot();
        if (!root) { push(' 未定位到题目容器'); console.log('[XIA-diagnose]\n' + out.join('\n')); return; }
        push(' 选中容器 class="' + (root.className || '').slice(0, 60) + '" 类型=' + questionType(root) + ' 已答=' + isAnswered(root));
        push(' 题干=' + (questionTitle(root) || '(空)').slice(0, 90));
        const opts = extractOptions(root);
        push(' 选项=' + opts.length);
        opts.slice(0, 8).forEach(o => push('  ' + o.letter + ': ' + o.text.slice(0, 45)));
        console.log('[XIA-diagnose]\n' + out.join('\n'));
    },

    //  一键作业巡航：从当前课程页打开「作业考试」列表。实现委托 cruise.js 的 runCruise。
    cruise() { return runCruise(); },
};
