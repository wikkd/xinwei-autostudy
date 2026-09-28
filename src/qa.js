// ==================== AI 答题核心 ====================
// 注：命名 XIA_AI 而非 AI，避免与页面既有 AI 标识符冲突

// 芯位/beeline-ai 题目容器选择器（作业/考试组件根，由线上 DOM 反推）
const XIA_QROOT = '.homework-single-selected, .homework-multiple-selected, .homework-true-or-false, .homework-cloze, .homework-question-editor';

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

// ===== 作业列表巡航：自动逐份完成列表中的作业 =====
// 状态机：提交完成详情页(homeworkDetailPage) → 返回列表 → 打开下一份「做作业」→ 试卷页(homeworkPaperId)交给答题主流程。
// 仅在自动答题开启时由 scan() 驱动；返回 true 表示当前页由巡航接管（列表/详情页）。
function homeworkWalker() {
    const h = location.hash || '';
    const now = Date.now();
    if (h.indexOf('homeworkDetailPage') >= 0) { // 提交完成后的详情/成绩页：停留十几秒再返回，模拟人工节奏
        if (now - XIA_AI._walkerNav < 12000) return true;
        XIA_AI._walkerNav = now;
        const link = exactText('a, button, [role="button"]', '作业考试');
        if (link) {
            XIA_AI.log('✅ 本份作业已提交，返回作业列表', 'ok');
            XIA_AI.progress('✅ 已提交，返回列表中');
            try { link.click(); } catch (e) {}
        }
        return true;
    }
    if (h.indexOf('homeworkPaperId') >= 0) return false;
    if (h.indexOf('/homework') >= 0) { // 作业列表页
        if (now - XIA_AI._walkerNav < 8000) return true;
        XIA_AI._walkerNav = now;
        const btn = exactText('button, [role="button"]', '做作业');
        if (btn) {
            XIA_AI.log('📖 打开下一份未完成作业', 'ok');
            XIA_AI.progress('📖 打开下一份作业…');
            try { btn.click(); } catch (e) {}
        } else if (now - XIA_AI._walkerEmptyLog > 60000) {
            XIA_AI._walkerEmptyLog = now;
            XIA_AI.log('作业列表暂无未完成作业（全部完成或待批改）', 'info');
            XIA_AI.progress('🏠 列表暂无未完成作业');
        }
        return true;
    }
    return false;
}

// 找到可见且文本（去空白后）完全等于 text 的第一个元素
function exactText(selector, text) {
    let hit = null;
    qsa(selector).forEach(el => { if (!hit && visible(el) && qtextAll(el) === text) hit = el; });
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

// 校验目标字母选项是否已真实选中（回填后确认用，防合成事件未生效）
function allSelected(root, letters) {
    if (!root) return false;
    const labels = qsa('.el-radio, .el-checkbox', root);
    return String(letters).toUpperCase().split('').every(ch => {
        const hit = labels.find(l => letterOf(l) === ch);
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

const XIA_AI = {
    lastQuestionHash: '',
    answering: false,
    answeringOnce: false,
    stats: { answered: 0, cached: 0, submitted: 0, failed: 0 },
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
    _bank: null,
    logLines: [],

    log(msg, type) {
        const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        XIA_AI.logLines.push({ text: line, type: type || 'info' });
        if (XIA_AI.logLines.length > 200) XIA_AI.logLines.shift();
        const box = document.getElementById('xa-ai-log');
        if (box) {
            box.innerHTML = XIA_AI.logLines.slice(-60).map(l => {
                const col = l.type === 'error' ? '#dc2626' : l.type === 'ok' ? '#059669' : l.type === 'ai' ? '#7c3aed' : '#374151';
                return '<div style="color:' + col + ';line-height:1.55;">' + l.text.replace(/</g, '&lt;') + '</div>';
            }).join('');
            box.scrollTop = box.scrollHeight;
        }
        console.log('[XIA] ' + msg);
    },

    // 面板进度条：显示当前任务（答题/提交/巡航）
    progress(text) {
        const el = document.getElementById('xa-progress');
        if (el) el.textContent = text;
    },

    // 会话统计（已答/缓存命中/已提交）刷新到面板
    bump(k) {
        if (k) XIA_AI.stats[k]++;
        const el = document.getElementById('xa-stats');
        if (el) {
            const s = XIA_AI.stats;
            el.textContent = '已答 ' + s.answered + ' · 缓存命中 ' + s.cached + ' · 已提交 ' + s.submitted;
        }
    },

    // ===== 答案本：本地缓存 题目hash → 答案，重做/重进同一份试卷不再重复调用 AI =====
    bankGet(key) {
        if (!XIA_AI._bank) {
            try { XIA_AI._bank = JSON.parse(GM_getValue(SK.bank, '{}')) || {}; } catch (e) { XIA_AI._bank = {}; }
        }
        const hit = XIA_AI._bank[key];
        return hit ? hit.a : null;
    },
    bankSet(key, answer) {
        XIA_AI.bankGet(key); // 确保已加载
        XIA_AI._bank[key] = { a: answer, t: Date.now() };
        const keys = Object.keys(XIA_AI._bank);
        if (keys.length > CFG.BANK_MAX) { // 超上限：淘汰最早写入的
            keys.sort((x, y) => XIA_AI._bank[x].t - XIA_AI._bank[y].t);
            keys.slice(0, keys.length - CFG.BANK_MAX).forEach(k => { delete XIA_AI._bank[k]; });
        }
        try { GM_setValue(SK.bank, JSON.stringify(XIA_AI._bank)); } catch (e) {}
    },

    // 抓取当前题目（经站点适配器：beeline=.homework-* 根 / chaoxing=.TiMu 题块）
    grabQuestion() {
        try {
            const root = QA.questionRoot();
            if (!root) return null;
            const type = QA.questionType(root);
            const title = QA.questionTitle(root);
            if (!title || title.length < 3) return null;
            const score = QA.questionScore(root);
            if (type === 'subjective') return { question: title, options: [], node: root, type: type, score: score };
            if (type === 'cloze') {
                const blanks = qsa('input', root).filter(el => visible(el) && !/(radio|checkbox|hidden|file|button|submit)/i.test(el.type)).length;
                if (!blanks) { XIA_AI.log('检测到填空题但未找到输入框', 'error'); return null; }
                return { question: title, options: [], node: root, type: type, blanks: blanks, score: score };
            }
            const options = QA.extractOptions(root);
            if (!options.length) { XIA_AI.log('抓到题目但无选项: ' + title.slice(0, 60), 'error'); return null; }
            return { question: title, options: options, node: root, type: (type === 'bool' ? 'single' : type), score: score };
        } catch (e) {
            XIA_AI.log('grabQuestion异常: ' + (e && e.message ? e.message : e), 'error');
            return null;
        }
    },

    // ==================== 检索增强（答题前先搜资料） ====================
    needsSearch(question) {
        const q = question || '';
        if (/(世界|国际|全球|国外|海外|外国)/.test(q)) return true;
        if (/(19|20)\d{2}\s*年|哪一年|成立于|创立于|发明|发现|首次|第一次|总统|总理|主席|首相|元首|首都|人口|GDP|经济总[量值]|世界杯|奥运|历史|地理|政治|名人|品牌|公司|企业|最新|目前|截至|现任|多少岁|面积|海拔|发明者|作者|画家|科学家/.test(q)) return true;
        if (/\d{3,}/.test(q)) return true;
        return /[A-Za-z]{3,}\s*(公司|大学|奖|协议|法案|组织)/.test(q);
    },

    buildPrompt(question, options, type, ctx, score, blanks) {
        const opt = (options || []).map(o => o.letter + '. ' + o.text).join(' ');
        let base;
        if (type === 'subjective') {
            const words = targetWords(score);
            base = '你是考试答题助手。请回答下面的主观题' + (score > 0 ? '（' + score + '分）' : '') + '。要求：\n'
                + '- 直接输出答案正文，禁止任何开场白、引言或「以下是回答」之类的废话\n'
                + '- 用 3-6 个自然段展开论述：先亮明总观点，再分层论证，最后总结提升\n'
                + '- 篇幅约 ' + words + ' 字，论点要配论据（理论、事实、举措、例子），不要堆空洞套话\n'
                + '- 分点时用「第一/第二/第三」或「首先/其次/再次/最后」衔接，不要用 Markdown 符号和标题\n\n'
                + '题目：' + question;
        } else if (type === 'cloze') {
            base = '你是答题助手。下面是一道填空题，共 ' + blanks + ' 空。请按顺序给出每空的答案：每空一行、只写答案本身，'
                + '不要序号、不要解释、不要重复题干。\n\n题目：' + question;
        } else if (type === 'multi') {
            base = '你是答题助手。请分析以下多选题，输出所有正确选项的字母，多个字母直接拼接（如 ABC），不要有任何废话。\n\n题目：' + question + '\n\n选项：' + opt;
        } else {
            base = '你是答题助手。请分析以下题目和选项，直接输出正确选项的字母（如 A 或 B），只输出一个字母，不要有任何废话、不要解释、不要换行。\n\n题目：' + question + '\n\n选项：' + opt;
        }
        if (ctx) {
            return '以下是检索到的相关资料（可能包含答案，请甄别并优先采信权威可靠来源；若资料与你的知识冲突，以资料为准）：\n' + ctx + '\n\n==========\n\n' + base;
        }
        return base;
    },

    searchWeb(query, cb) {
        const maxChars = CFG.SEARCH_MAX_CHARS;
        const done = ctx => { try { cb(ctx || ''); } catch (e) {} };
        if ((conf.searchProvider || 'duckduckgo') === 'tavily') {
            if (!conf.searchApiKey) { XIA_AI.log('Tavily 需要 API Key，回退为不检索', 'error'); return done(''); }
            GM_xmlhttpRequest({
                method: 'POST', url: 'https://api.tavily.com/search', timeout: 15000,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ api_key: conf.searchApiKey, query: query, max_results: 5, search_depth: 'basic' }),
                onload: r => {
                    try {
                        const j = JSON.parse(r.responseText);
                        done((j.results || []).map(x => (x.title ? '【' + x.title + '】' : '') + (x.content || '')).join('\n').slice(0, maxChars));
                    } catch (e) { XIA_AI.log('检索解析失败: ' + e.message, 'error'); done(''); }
                },
                onerror: () => { XIA_AI.log('检索网络错误', 'error'); done(''); },
                ontimeout: () => { XIA_AI.log('检索超时', 'error'); done(''); },
            });
        } else {
            GM_xmlhttpRequest({
                method: 'GET', timeout: 8000,
                url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                onload: r => {
                    try { // 结果摘要与标题正则合并提取
                        const out = [];
                        const re = /class="result__(?:snippet|a)"[^>]*>([\s\S]*?)<\/a>/g;
                        let m;
                        while ((m = re.exec(r.responseText || '')) !== null) {
                            const t = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                            if (t) out.push(t);
                        }
                        done(out.join('\n').slice(0, maxChars));
                    } catch (e) { XIA_AI.log('检索解析失败: ' + e.message, 'error'); done(''); }
                },
                onerror: () => { XIA_AI.log('检索网络错误（DDG 可能被墙/需代理）', 'error'); done(''); },
                ontimeout: () => { XIA_AI.log('检索超时（8s），已跳过检索直接作答', 'error'); done(''); },
            });
        }
    },

    // 解析 AI 回复：single 四级提取一个字母（防英文套话连带误取），multi 字母集合，cloze 按行切分，subjective 原文
    parseAnswer(content, type) {
        const c = String(content || '').trim();
        if (!c) return null;
        if (type === 'subjective') return c;
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
            const letters = c.match(/[A-H]/g);
            return letters ? letters.filter((ch, i, a) => a.indexOf(ch) === i).join('') : null;
        }
        const m = c.match(/^\s*([A-H])\s*$/i)
            || c.match(/(?:正确答案|参考答案|答案|应选|选|答|answer|option|choice)\s*(?:is|[:：是为])?\s*([A-H])(?![A-Za-z])/i)
            || c.match(/^\s*([A-H])[\s\.\．、:：]/i)
            || c.match(/\b([A-H])\b/i);
        return m ? m[1].toUpperCase() : null;
    },

    // 调用 LLM。q 为 grabQuestion() 结果；onResult(answer|null)。
    // 客观题解析失败自动带强调词重试一次；确定性配置错误（模型名/Key/余额）触发熔断。
    callAI(q, onResult) {
        const type = q.type || 'single';
        const isSubjective = type === 'subjective';
        const apiKey = conf.apiKey;
        if (!apiKey) { XIA_AI.log('未配置 API Key', 'error'); onResult(null); return; }
        const base = (conf.apiBase || CFG.DEFAULT_API_BASE).replace(/\/+$/, '');
        const endpoint = /\/v\d+\/?$/.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions';
        const model = conf.model || CFG.DEFAULT_MODEL;
        // reasoning 类模型（deepseek-reasoner / o1 / qwq 等）思考耗 token，max_tokens 与超时放宽防 content 为空
        const isReasoning = /reasoner|thinking|qwq|r1|o1|o3|o4/i.test(model);
        const maxTokens = isSubjective ? (isReasoning ? 3000 : 2000) : type === 'cloze' ? 300 : (isReasoning ? 1024 : 16);
        const timeout = (isSubjective || isReasoning) ? 60000 : 20000;

        const needSearch = conf.searchMode === 'always'
            || (conf.searchMode === 'auto' && !isSubjective && type !== 'cloze' && XIA_AI.needsSearch(q.question));

        const ask = (ctx, strict) => {
            let prompt = XIA_AI.buildPrompt(q.question, q.options, type, ctx, q.score, q.blanks);
            if (strict) {
                prompt += type === 'cloze'
                    ? '\n\n（重要：上一轮回复格式不符合要求。请严格每空一行、每行只写一个答案，不要任何其他文字。）'
                    : '\n\n（重要：上一轮回复格式不符合要求。只输出选项字母，不要输出任何其他文字。）';
            }
            XIA_AI.log('请求 ' + model + (ctx ? '（含检索资料）' : '') + (strict ? '（格式重试）' : ''), 'ai');
            try {
                GM_xmlhttpRequest({
                    method: 'POST', url: endpoint, timeout: timeout,
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                    data: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: isSubjective ? 0.7 : 0.3,
                        max_tokens: maxTokens,
                    }),
                    onload: res => {
                        const status = res.status || res.statusCode;
                        if (status && status >= 400) {
                            const body = res.responseText || '';
                            XIA_AI.log('AI 响应异常 HTTP ' + status + ' | ' + body.slice(0, 200), 'error');
                            // 确定性配置错误：熔断暂停自动答题，面板里改正配置后自动恢复
                            if (/invalid_request_error/i.test(body) && /model/i.test(body)) {
                                XIA_AI._cfgError = '模型名 "' + model + '" 无效，请修正面板中的模型名称';
                            } else if (status === 401) {
                                XIA_AI._cfgError = 'API Key 无效（401），请检查面板中的 Key';
                            } else if (status === 402) {
                                XIA_AI._cfgError = 'API 余额不足（402），请充值或更换接口';
                            }
                            if (XIA_AI._cfgError) {
                                XIA_AI.log('⛔ ' + XIA_AI._cfgError + '，已暂停自动答题', 'error');
                                XIA_AI.progress('⛔ 配置错误，已暂停');
                            }
                            onResult(null); return;
                        }
                        let content = '';
                        try {
                            const data = JSON.parse(res.responseText);
                            content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
                        } catch (e) { content = ''; }
                        if (!content) { XIA_AI.log('AI 响应无内容: ' + (res.responseText || '').slice(0, 200), 'error'); onResult(null); return; }
                        const answer = XIA_AI.parseAnswer(content, type);
                        if (!answer) {
                            if (!strict && !isSubjective) { ask(ctx, true); return; } // 强调格式重试一次
                            XIA_AI.log('AI 返回无法解析: "' + content.trim().slice(0, 80) + '"', 'error');
                            onResult(null); return;
                        }
                        XIA_AI.log('AI 答案 → ' + (isSubjective ? answer.slice(0, 80) + '…' : answer), 'ok');
                        onResult(answer);
                    },
                    onerror: e => { XIA_AI.log('网络错误(发送失败): ' + (e && e.error ? e.error : ''), 'error'); onResult(null); },
                    ontimeout: () => { XIA_AI.log('请求超时(>' + timeout / 1000 + 's): ' + endpoint, 'error'); onResult(null); },
                });
            } catch (e) {
                XIA_AI.log('LLM 请求异常: ' + e.message, 'error');
                onResult(null);
            }
        };

        if (needSearch) {
            XIA_AI.log('🔍 先检索相关资料…', 'ai');
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
        const labels = qsa('.el-radio, .el-checkbox', qEl).length ? qsa('.el-radio, .el-checkbox', qEl)
            : qsa('ul li', qEl).filter(li => QA.letterOf(li) || /^(对|错|正确|错误)/.test(qtext(li))); // chaoxing: ul>li 选项
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
                } else if (!input) {
                    try { XIA_AI.forceClick(hit); } catch (e) {} // chaoxing li 无内部 input
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

    answerSubjective(answer, onDone) {
        const editor = document.querySelector('[data-slate-editor]')
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

            // 按段落逐段插入，段间派发 insertParagraph（wangEditor 等富文本会响应 beforeinput）
            const paras = String(answer).split(/\n+/).map(s => s.trim()).filter(Boolean);
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
            let ok = false;
            if (q.type === 'cloze') ok = qsa('input', q.node).some(inp => (inp.value || '').trim());
            else ok = QA.allSelected(q.node, answer);
            if (XIA_AI._failHash !== hash) XIA_AI._failCount = 0;
            if (ok) {
                XIA_AI._failHash = '';
                XIA_AI._failCount = 0;
                XIA_AI.bankSet(hash, answer); // 成功回填 → 存入答案本
                XIA_AI.lastQuestionHash = '';
                XIA_AI.bump('answered');
                XIA_AI.progress('✅ 已答 ' + XIA_AI.stats.answered + ' 题');
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
            } else {
                XIA_AI.lastQuestionHash = '';
                XIA_AI.log('回填未生效，下一轮重试 (' + XIA_AI._failCount + '/3)', 'error');
            }
            XIA_AI.answering = false;
        }, 800);
    },

    // 答完自动提交作业：点「提交作业」并自动确认；弹窗提示有未答题时取消并留给人工。
    // 仅精确匹配「提交作业」按钮，绝不触碰考试类的「交卷/提交试卷」。30s 节流，可反复重试。
    tryAutoSubmit() {
        const now = Date.now();
        if (XIA_AI._submitting) return;
        if (XIA_AI._lastSubmitTry && now - XIA_AI._lastSubmitTry < 30000) return;
        XIA_AI._lastSubmitTry = now;
        let btn = null;
        qsa('button, [role="button"]').forEach(el => {
            if (btn || !visible(el)) return;
            if (qtextAll(el) === '提交作业') btn = el;
        });
        if (!btn) return;
        if (btn.disabled || (btn.className || '').indexOf('is-disabled') >= 0) {
            XIA_AI.log('「提交作业」按钮不可用（可能有题目未作答），30s 后重试', 'info');
            return;
        }
        XIA_AI._submitting = true;
        XIA_AI.log('📝 全部答完，自动提交作业...', 'ok');
        XIA_AI.progress('📝 自动提交中…');
        try { btn.click(); } catch (e) {}
        setTimeout(() => {
            // 确认弹窗：beeline 为 element-ui 组件；超星为自绘弹层（按 class 模糊匹配）。
            // 找不到弹层时退化为全页扫「确定/确认/提交」文本按钮。
            const pops = qsa('.el-message-box, .el-dialog, .el-popconfirm, [class*="dialog"], [class*="popup"], [class*="maskdiv"], [class*="mask_"]').filter(visible);
            if (pops.length) {
                const msg = pops.map(d => qtextAll(d)).join(' ');
                if (/未(作答|回答|完成)|尚未(作答|完成)|还有\d*题|请(先)?(答完|完成所有|作答)/.test(msg)) {
                    XIA_AI.log('平台提示有题目未作答，已取消自动提交，请人工补答', 'error');
                    const cancel = pops.map(d => qsa('button, a, [class*="btn"]', d)).flat()
                        .filter(visible).find(b => /^(取消|关闭|继续答题)$/.test(qtextAll(b)));
                    try { if (cancel) cancel.click(); } catch (e) {}
                    XIA_AI._submitting = false;
                    return;
                }
            }
            const scope = pops.length ? pops : [document.body];
            const confirm = scope.map(d => qsa('button, a, [class*="btn"]', d)).flat()
                .filter(visible).find(b => /^(确定|确认|提交)$/.test(qtextAll(b)) && !b.disabled);
            if (confirm) {
                try { confirm.click(); } catch (e) {}
                XIA_AI.log('已点击确认提交', 'ok');
            } else {
                XIA_AI.log('未找到确认按钮，请人工提交', 'error');
                XIA_AI._submitting = false;
                return;
            }
            setTimeout(() => {
                const toast = qsa('.el-message, [class*="toast"], [class*="success"]').map(m => m.textContent || '').join(' ');
                if (/提交成功|成功/.test(toast) || !qtextAll(document.body).includes('提交作业')) {
                    XIA_AI._donePage = location.hash + location.pathname; // 本页已提交完成，交给 walker 接管
                    XIA_AI.bump('submitted');
                    XIA_AI.log('🎉 作业提交成功', 'ok');
                    XIA_AI.progress('🎉 提交成功');
                } else {
                    XIA_AI.log('提交结果未确认（无成功提示），请人工核对', 'info');
                }
                XIA_AI._submitting = false;
            }, 2500);
        }, 1200);
    },

    answerOnce() {
        if (XIA_AI.answeringOnce) { XIA_AI.log('正在执行单次答题，请稍候', 'error'); return; }
        const q = XIA_AI.grabQuestion();
        if (!q || !q.question || (q.type !== 'subjective' && q.type !== 'cloze' && q.options.length === 0)) {
            XIA_AI.log('当前页面未找到可答题目', 'error');
            return;
        }
        XIA_AI.answeringOnce = true;
        XIA_AI.log('🎯 单次答题: ' + q.question.slice(0, 60) + (q.question.length > 60 ? '…' : ''), 'ok');
        XIA_AI.callAI(q, answer => {
            XIA_AI.answeringOnce = false;
            if (!answer) return;
            if (q.type === 'subjective') {
                XIA_AI.answerSubjective(answer, ok => XIA_AI.log(ok ? '单次答题（主观）完成' : '主观题填入失败', ok ? 'ok' : 'error'));
            } else if (q.type === 'cloze') {
                XIA_AI.fillCloze(answer, q.node, ok => XIA_AI.log(ok ? '单次答题（填空）完成' : '填空填入失败', ok ? 'ok' : 'error'));
            } else {
                XIA_AI.fillChoice(answer, q.node, ok => XIA_AI.log(ok ? '单次答题完成' : '回填失败', ok ? 'ok' : 'error'));
            }
        });
    },

    scan() {
        if (!conf.autoAnswer || XIA_AI.answering) return;
        if (XIA_AI._cfgError) { // 配置熔断：暂停扫描，面板改正任一 AI 配置项后自动恢复
            const now = Date.now();
            if (now - XIA_AI._cfgLogAt > 30000) {
                XIA_AI._cfgLogAt = now;
                XIA_AI.log('⏸ 已暂停：' + XIA_AI._cfgError, 'error');
            }
            return;
        }
        try { if (homeworkWalker()) return; } catch (e) { console.log('[XIA-walker] 异常', e); }
        if (XIA_AI._donePage && (location.hash + location.pathname) === XIA_AI._donePage) return; // 本卷刚提交成功，等 walker 接管

        const q = XIA_AI.grabQuestion();
        if (!q || !q.question) return;
        if (q.type !== 'subjective' && q.type !== 'cloze' && q.options.length === 0) return;

        const hash = q.question.slice(0, 100) + '|'
            + (q.options.length ? q.options.map(o => o.letter + o.text.slice(0, 30)).join(',') : (q.type === 'cloze' ? 'cloze' : 'subj'));
        if (hash === XIA_AI.lastQuestionHash) return;

        // 已作答：跳到下一题（questionRoot 优先返回未答题，此处多为最后一题或翻页失败）
        if (QA.isAnswered(q.node)) {
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

        XIA_AI.answering = true;
        XIA_AI.progress('📋 ' + q.question.slice(0, 24));
        XIA_AI.log('📋 抓到题目: ' + q.question.slice(0, 60) + (q.question.length > 60 ? '…' : '')
            + ' [' + q.type + (q.score ? ' ' + q.score + '分' : '') + ']');
        if (q.options.length) XIA_AI.log('选项 ' + q.options.length + ' 个: ' + q.options.map(o => o.letter).join(' '));

        // 答案本命中：客观题直接回填，不再调用 AI / 检索
        const cached = (q.type !== 'subjective' && q.type !== 'cloze') ? XIA_AI.bankGet(hash) : null;
        if (cached) {
            XIA_AI.log('💾 命中答案本，直接回填: ' + cached, 'ok');
            XIA_AI.bump('cached');
            XIA_AI.lastQuestionHash = hash;
            XIA_AI.fillChoice(cached, q.node, () => XIA_AI.verifyAndAdvance(q, hash, cached));
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
            XIA_AI.lastQuestionHash = hash; // 标记已处理，避免同页重复作答
            if (q.type === 'subjective') {
                XIA_AI.answerSubjective(ans, ok => {
                    if (ok) {
                        XIA_AI.bankSet(hash, ans);
                        XIA_AI.bump('answered');
                        XIA_AI.progress('✅ 已答 ' + XIA_AI.stats.answered + ' 题');
                        XIA_AI.log('主观题答案已填入，2s 后跳转下一题', 'ok');
                        setTimeout(() => { clickNextQuestionButton(); XIA_AI.answering = false; }, 2000);
                    } else {
                        // 填入失败/不完整：保留 hash 不再自动重答，留在本题等人工处理
                        XIA_AI.log('主观题未成功填入，已停止自动跳转，请人工处理', 'error');
                        XIA_AI.answering = false;
                    }
                });
            } else if (q.type === 'cloze') {
                XIA_AI.fillCloze(ans, q.node, () => XIA_AI.verifyAndAdvance(q, hash, ans));
            } else {
                XIA_AI.fillChoice(ans, q.node, () => XIA_AI.verifyAndAdvance(q, hash, ans));
            }
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

    // 🩺 诊断：dump 当前页题目 DOM 结构（平台改版后按真机结构修选择器用）
    diagnose() {
        if (XA_SITE === 'chaoxing') { CXQA.diagnose(); return; }
        const out = [];
        const push = s => { out.push(s); XIA_AI.log(s, 'ai'); };
        push('🩺 诊断 ' + location.href.slice(0, 70));
        const roots = qsa(XIA_QROOT);
        push('① .homework-*根=' + roots.length + (roots.length ? '' : ' → 走兜底'));
        roots.slice(0, 5).forEach((r, i) => push('  [' + i + '] class="' + (r.className || '').slice(0, 60) + '" h=' + r.offsetHeight + ' 类型=' + questionType(r)));
        const tags = qsa('.question-tag-score');
        push('② .question-tag-score=' + tags.length);
        if (tags.length) {
            const p = tags[0].closest('.question-box') || tags[0].parentElement;
            if (p) push('  兜底容器 class="' + (p.className || '').slice(0, 60) + '" 含题干=' + !!p.querySelector('.topic-title, .subject-title'));
        }
        push('③ div.question=' + qsa('div.question').length + '（旧结构，应为0）');
        push('④ iframe=' + qsa('iframe').length + ' radio=' + qsa('.el-radio').length + ' checkbox=' + qsa('.el-checkbox').length);
        const root = questionRoot();
        if (!root) { push('❌ 未定位到题目容器'); console.log('[XIA-diagnose]\n' + out.join('\n')); return; }
        push('⑤ 选中容器 class="' + (root.className || '').slice(0, 60) + '" 类型=' + questionType(root) + ' 已答=' + isAnswered(root));
        push('⑥ 题干=' + (questionTitle(root) || '(空)').slice(0, 90));
        const opts = extractOptions(root);
        push('⑦ 选项=' + opts.length);
        opts.slice(0, 8).forEach(o => push('  ' + o.letter + ': ' + o.text.slice(0, 45)));
        console.log('[XIA-diagnose]\n' + out.join('\n'));
    },

    // 🧭 一键作业巡航：从当前课程页打开「作业考试」列表，之后 homeworkWalker 自动逐份完成
    cruise() {
        const link = exactText('a, button, [role="button"], li.el-menu-item, .el-sub-menu__title', '作业考试')
            || qsa('a, button, li.el-menu-item, .el-sub-menu__title').find(el => visible(el) && /作业考试|作业与考试|课程作业/.test(qtext(el)));
        if (link) {
            XIA_AI.log('🧭 已进入作业列表，巡航开始', 'ok');
            XIA_AI.progress('🧭 作业巡航中');
            try { link.click(); } catch (e) {}
            if (!conf.autoAnswer) { // 顺手把自动答题开关打开，巡航才能真正跑起来
                const sw = document.getElementById('xa-autoanswer-switch');
                if (sw) sw.click();
            }
        } else {
            XIA_AI.log('未找到「作业考试」入口，请先在课程菜单里手动展开一次', 'error');
        }
    },
};
