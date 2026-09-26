// ==================== AI 答题核心 ====================
// 注：命名 XIA_AI 而非 AI，避免与页面既有 AI 标识符冲突

// 扫描到题目后，定位并点击「下一题 / 下一个」按钮（避免多处重复逻辑）
function clickNextQuestionButton() {
    let btn = null;
    const toggles = document.querySelectorAll('.toggle-button');
    for (const t of toggles) {
        const txt = (t.textContent || '').trim();
        if (/下一题|下一个/.test(txt)) { btn = t; break; }
    }
    if (!btn) {
        const all = document.querySelectorAll('button, [role="button"]');
        for (const t of all) {
            const txt = (t.textContent || '').trim();
            if (/下一题|下一个/.test(txt) && !/上一题|提交|交卷|作业|先保存/.test(txt)) { btn = t; break; }
        }
    }
    if (btn) {
        console.log('[XIA-scan] 点击下一题: ' + ((btn.textContent || '').trim().slice(0, 15) || '??'));
        try { btn.click(); } catch (e) {}
        XIA_AI.log('点击按钮: "' + (btn.textContent || '').trim().slice(0, 15) + '"', 'ok');
    } else {
        console.log('[XIA-scan] 未找到下一题按钮');
        XIA_AI.log('未找到下一页按钮', 'error');
    }
}

// ============ 芯位/beeline-ai 真实题目容器检测 ============
// 平台作业/考试组件根为以下 class（由 _files 分片 CSS 反推得出，静态 HTML 无渲染内容）
const XIA_QROOT = '.homework-single-selected, .homework-multiple-selected, .homework-true-or-false, .homework-cloze, .homework-question-editor';

function xiaQuestionRoot() {
    const roots = Array.prototype.slice.call(document.querySelectorAll(XIA_QROOT))
        .filter(el => visible(el) && el.offsetHeight > 8);
    if (roots.length === 0) return null;
    for (const r of roots) if (!xiaIsAnswered(r)) return r; // 优先返回未作答的（列表页自动顺延到下一题）
    return roots[0];
}

function xiaQuestionType(root) {
    if (!root) return 'single';
    const cls = root.className || '';
    if (cls.indexOf('homework-multiple-selected') >= 0) return 'multi';
    if (cls.indexOf('homework-true-or-false') >= 0) return 'bool';
    if (cls.indexOf('homework-question-editor') >= 0) return 'subjective';
    if (cls.indexOf('homework-cloze') >= 0) return 'cloze';
    if (cls.indexOf('homework-single-selected') >= 0) return 'single';
    if (root.querySelector('.el-checkbox')) return 'multi';
    if (root.querySelector('.el-radio')) return 'single';
    return 'single';
}

function xiaIsAnswered(root) {
    if (!root) return false;
    const t = xiaQuestionType(root);
    if (t === 'subjective') {
        const ed = root.querySelector('.w-e-text-container [contenteditable="true"], [contenteditable="true"]');
        return !!(ed && (ed.textContent || '').trim().length > 0);
    }
    if (t === 'cloze') {
        const ins = root.querySelectorAll('input');
        for (const i of ins) if ((i.value || '').trim()) return true;
        return false;
    }
    return root.querySelector('.el-radio.is-checked, .el-checkbox.is-checked, .is-checked') !== null;
}

function xiaExtractOptions(root) {
    const opts = [];
    const labels = root.querySelectorAll('.el-radio, .el-checkbox');
    let idx = 0;
    labels.forEach(label => {
        if (!visible(label)) return;
        const n = label.querySelector('.index-name');
        const nameLetter = n ? (n.textContent || '').trim().match(/[A-H]/) : null;
        let letter = nameLetter ? nameLetter[0] : String.fromCharCode(65 + idx);
        const labelEl = label.querySelector('.label, .el-radio__label, .el-checkbox__label');
        let text = labelEl ? (labelEl.textContent || '').trim() : (label.textContent || '').replace(/^[A-H][\.\．、\:：\s]*/, '').trim();
        text = text.replace(/\s+/g, ' ').slice(0, 120);
        if (opts.find(o => o.letter === letter)) letter = String.fromCharCode(65 + opts.length); // 字母重复则按顺序补
        opts.push({ letter, text, node: label });
        idx++;
    });
    return opts;
}

function xiaQuestionTitle(root) {
    const t = root.querySelector('.topic-title, .subject-title, .question, [class*="topic-title"], [class*="subject-title"]');
    let txt = t ? (t.textContent || '') : (root.textContent || '');
    txt = (txt || '').replace(/\s+/g, ' ').trim();
    txt = txt.replace(/^\s*\d+[\.\．、]*/, '').replace(/\s*单选|\s*多选|\s*判断|\s*填空|\s*主观题/g, '').replace(/\s*\d+\s*分\s*/g, '').trim();
    return txt.slice(0, 400);
}

const XIA_AI = {
    lastQuestionHash: '',
    answering: false,
    answeringOnce: false,
    _lastNav: 0,
    logLines: [],

    log(msg, type) {
        const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        XIA_AI.logLines.push({ text: line, type: type || 'info' });
        if (XIA_AI.logLines.length > 80) XIA_AI.logLines.shift();
        const box = document.getElementById('xa-ai-log');
        if (box) {
            box.innerHTML = XIA_AI.logLines.slice(-30).map(l => {
                const col = l.type === 'error' ? '#dc2626' : l.type === 'ok' ? '#059669' : l.type === 'ai' ? '#7c3aed' : '#374151';
                return '<div style="color:' + col + ';line-height:1.55;">' + l.text.replace(/</g, '&lt;') + '</div>';
            }).join('');
            box.scrollTop = box.scrollHeight;
        }
        console.log('[XIA] ' + msg);
    },

    // 题目抓取（芯位/beeline-ai 真实组件：.homework-* 根 + .topic-title 标题 + .el-radio/.el-checkbox 选项）
    grabQuestion() {
        try {
            const root = xiaQuestionRoot();
            if (!root) return null;
            const type = xiaQuestionType(root);
            if (type === 'cloze') {
                XIA_AI.log('检测到填空题，当前版本暂不自动作答（需自由填空）', 'info');
                return null;
            }
            const title = xiaQuestionTitle(root);
            if (!title || title.length < 3) {
                console.log('[XIA-grab] 标题过短/为空');
                return null;
            }
            if (type === 'subjective') {
                return { question: title, options: [], node: root, type: 'subjective', raw: title };
            }
            const options = xiaExtractOptions(root);
            if (options.length === 0) {
                XIA_AI.log('抓到题目但无选项: ' + title.slice(0, 60), 'error');
                return null;
            }
            const qType = (type === 'bool') ? 'single' : type;
            return { question: title, options, node: root, type: qType, raw: title };
        } catch (e) {
            XIA_AI.log('grabQuestion异常: ' + (e && e.message ? e.message : e), 'error');
            console.log('[XIA-grab] 异常', e);
            return null;
        }
    },

    // ==================== 检索增强（答题前先搜资料） ====================
    needsSearch(question, type) {
        if (type === 'subjective') return false;
        const q = question || '';
        if (/(世界|国际|全球|国外|海外|外国)/.test(q)) return true;
        if (/(19|20)\d{2}\s*年|哪一年|成立于|创立于|发明|发现|首次|第一次|总统|总理|主席|首相|元首|首都|人口|GDP|经济总[量值]|世界杯|奥运|历史|地理|政治|名人|品牌|公司|企业|最新|目前|截至|现任|多少岁|面积|海拔|发明者|作者|画家|科学家/.test(q)) return true;
        if (/\d{3,}/.test(q)) return true;
        if (/[A-Za-z]{3,}\s*(公司|大学|奖|协议|法案|组织)/.test(q)) return true;
        return false;
    },

    buildPrompt(question, options, type, ctx) {
        const opt = options.map(o => o.letter + '. ' + o.text).join(' ');
        let base;
        if (type === 'subjective') {
            base = '用一句话或100字内直接回答以下主观题，禁止多余废话。\n\n题目：' + question;
        } else if (type === 'multi') {
            base = '你是一个答题助手。请分析以下多选题，输出所有正确选项的字母，多个字母直接拼接（如 ABC），不要有任何废话。\n\n题目：' + question + '\n\n选项：' + opt;
        } else {
            base = '你是一个答题助手。请分析以下题目和选项，直接输出正确选项的字母（如 A 或 B），只输出一个字母，不要有任何废话、不要解释、不要换行。\n\n题目：' + question + '\n\n选项：' + opt;
        }
        if (ctx && ctx.length) {
            return '以下是检索到的相关资料（可能包含答案，请甄别并优先采信权威可靠来源；若资料与你的知识冲突，以资料为准）：\n' + ctx + '\n\n==========\n\n' + base;
        }
        return base;
    },

    searchWeb(query, cb) {
        const provider = conf.searchProvider || 'duckduckgo';
        const key = conf.searchApiKey || '';
        const maxChars = CFG.SEARCH_MAX_CHARS || 3000;
        const done = (ctx) => { try { cb && cb(ctx || ''); } catch (e) {} };
        try {
            if (provider === 'tavily') {
                if (!key) { XIA_AI.log('Tavily 需要 API Key，回退为不检索', 'error'); return done(''); }
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.tavily.com/search',
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ api_key: key, query: query, max_results: 5, search_depth: 'basic' }),
                    timeout: 15000,
                    onload: (r) => {
                        try {
                            const j = JSON.parse(r.responseText);
                            const arr = (j.results || []).map(x => ((x.title ? ('【' + x.title + '】') : '') + (x.content || ''))).filter(Boolean);
                            done(arr.join('\n').slice(0, maxChars));
                        } catch (e) { XIA_AI.log('检索解析失败: ' + e.message, 'error'); done(''); }
                    },
                    onerror: () => { XIA_AI.log('检索网络错误', 'error'); done(''); },
                    ontimeout: () => { XIA_AI.log('检索超时', 'error'); done(''); },
                });
            } else {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    timeout: 8000,
                    onload: (r) => {
                        try {
                            const html = r.responseText || '';
                            const snippets = [];
                            const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
                            let m;
                            while ((m = re.exec(html)) !== null) {
                                const txt = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                                if (txt) snippets.push(txt);
                            }
                            if (snippets.length === 0) {
                                const re2 = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
                                while ((m = re2.exec(html)) !== null) {
                                    const txt = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                                    if (txt) snippets.push(txt);
                                }
                            }
                            done(snippets.join('\n').slice(0, maxChars));
                        } catch (e) { XIA_AI.log('检索解析失败: ' + e.message, 'error'); done(''); }
                    },
                    onerror: (e) => { XIA_AI.log('检索网络错误(DDG可能被墙/需代理): ' + (e && e.error ? e.error : ''), 'error'); done(''); },
                    ontimeout: () => { XIA_AI.log('检索超时(DDG 8s): 已跳过检索直接作答', 'error'); done(''); },
                });
            }
        } catch (e) { XIA_AI.log('检索异常: ' + e.message, 'error'); done(''); }
    },

    // 调用 AI 接口（支持单选/多选/主观）
    callAI(question, options, type, onResult) {
        const apiKey = conf.apiKey;
        if (!apiKey) { XIA_AI.log('未配置 API Key', 'error'); onResult(null); return; }
        const apiBase = conf.apiBase || CFG.DEFAULT_API_BASE;
        const model = conf.model || CFG.DEFAULT_MODEL;
        const isMulti = type === 'multi';
        const isSubjective = type === 'subjective';

        let base = apiBase.replace(/\/+$/, '');
        const endpoint = /\/v\d+\/?$/.test(base) ? (base + '/chat/completions') : (base + '/v1/chat/completions');
        XIA_AI.log('请求 ' + endpoint + ' | model=' + model + ' | 题目长度=' + question.length, 'ai');

        // 检索增强：先搜后答
        const needSearch = conf.searchMode === 'always' || (conf.searchMode === 'auto' && XIA_AI.needsSearch(question, type));
        const doLLM = (ctx) => {
            const prompt = XIA_AI.buildPrompt(question, options, type, ctx);
            XIA_AI.log('Prompt摘要: ' + prompt.slice(0, 80), 'ai');
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: endpoint,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + apiKey,
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.3,
                        max_tokens: isSubjective ? 300 : 16,
                    }),
                    timeout: isSubjective ? 30000 : 20000,
                    onload: (res) => {
                        const status = res.status || res.statusCode;
                        if (status && status >= 400) {
                            XIA_AI.log('AI 响应异常 HTTP ' + status + ' -> ' + endpoint + ' | ' + (res.responseText || '').slice(0, 200), 'error');
                            onResult(null); return;
                        }
                        try {
                            const data = JSON.parse(res.responseText);
                            const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                            if (!content) { XIA_AI.log('AI 响应异常(无答案): ' + endpoint + ' | ' + (res.responseText || '').slice(0, 200), 'error'); onResult(null); return; }
                            let answer;
                            if (isSubjective) {
                                answer = content.trim();
                            } else {
                                const letters = content.trim().match(/[A-H]/g);
                                if (!letters) { XIA_AI.log('AI 返回无法解析: "' + content.trim().slice(0, 80) + '"', 'error'); onResult(null); return; }
                                answer = letters.filter((ch, i, arr) => arr.indexOf(ch) === i).join('');
                            }
                            XIA_AI.log('AI 答案 -> ' + answer.slice(0, 100), 'ok');
                            onResult(answer);
                        } catch (e) {
                            XIA_AI.log('解析失败: 端点=' + endpoint + ' | ' + e.message + ' | 原始: ' + (res.responseText || '').slice(0, 200), 'error');
                            onResult(null);
                        }
                    },
                    onerror: (e) => { XIA_AI.log('网络错误(发送失败): 端点=' + endpoint + ' | 原因=' + (e && e.error ? e.error : JSON.stringify(e)), 'error'); onResult(null); },
                    ontimeout: () => { XIA_AI.log('请求超时(>' + (isSubjective ? 30 : 20) + 's): ' + endpoint, 'error'); onResult(null); },
                });
            } catch (e) {
                XIA_AI.log('LLM 请求异常: ' + e.message, 'error');
                onResult(null);
            }
        };

        if (needSearch) {
            XIA_AI.log('🔍 先检索相关资料...', 'ai');
            XIA_AI.searchWeb(question, (ctx) => doLLM(ctx || ''));
        } else {
            doLLM('');
        }
    },

    // 强制点击元素：click + 合成事件 + 内部 input
    forceClick(el) {
        if (!el) return;
        console.log('[XIA-forceClick] 目标:', el.tagName, (el.className && el.className.slice ? el.className.slice(0, 40) : ''), (el.textContent && el.textContent.slice ? el.textContent.slice(0, 30) : ''));
        try { el.click(); } catch (e) {}
        try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        const innerInput = el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
        if (innerInput) {
            console.log('[XIA-forceClick] 内部input:', innerInput.value);
            try { innerInput.checked = true; } catch (e) {}
            try { innerInput.click(); } catch (e) {}
            try { innerInput.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {}
            try { innerInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        }
        const group = el.closest && el.closest('.el-radio-group, .el-checkbox-group, [role="radiogroup"], [role="group"]');
        if (group && innerInput) {
            try { group.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
            try { group.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        }
    },

    clickAnswer(letters, root) {
        const qEl = root || xiaQuestionRoot();
        if (!qEl) { XIA_AI.log('页面已无题目容器，无法点击', 'error'); return false; }
        const isMulti = xiaQuestionType(qEl) === 'multi';
        console.log('[XIA-clickAnswer] 题目类型:', isMulti ? '多选' : '单选');
        const letterArr = letters.toUpperCase().split('');
        let allOk = true;
        const labels = Array.prototype.slice.call(qEl.querySelectorAll('.el-radio, .el-checkbox'));
        for (const ch of letterArr) {
            let targetLabel = null;
            for (const l of labels) {
                const n = l.querySelector('.index-name');
                const nameLetter = n ? (n.textContent || '').trim().match(/[A-H]/) : null;
                const input = l.querySelector('input[type="radio"], input[type="checkbox"]');
                const inputLetter = input && input.value ? String(input.value).toUpperCase().match(/[A-H]/) : null;
                if ((nameLetter && nameLetter[0] === ch) || (inputLetter && inputLetter[0] === ch)) { targetLabel = l; break; }
            }
            if (!targetLabel) {
                const pos = ch.charCodeAt(0) - 65;
                if (labels[pos]) targetLabel = labels[pos]; // 按位置兜底：第 i 个选项 = 字母 A+i
            }
            if (!targetLabel) { XIA_AI.log('找不到选项 ' + ch + ' 的DOM节点', 'error'); allOk = false; continue; }
            if (isMulti) {
                XIA_AI.log('多选请使用自动答题模式（已跳过此点击）', 'info');
                allOk = false;
                continue;
            }
            const inner = targetLabel.querySelector('.el-radio__inner, .el-checkbox__inner');
            if (inner) XIA_AI.forceClick(inner);
            XIA_AI.forceClick(targetLabel);
            // 驱动 Vue 的 input/change，确保 v-model 更新
            const vue = targetLabel.__vue__;
            if (vue) {
                try { vue.$emit('input', ch); } catch (e) {}
                try { vue.$emit('change', ch); } catch (e) {}
            }
            XIA_AI.log('点击选项 ' + ch, 'ok');
        }
        return allOk;
    },

    clickMultiAnswer(letters, onDone, root) {
        console.log('[XIA-multi] 开始逐项点击:', letters);
        const qEl = root || xiaQuestionRoot();
        if (!qEl) { console.log('[XIA-multi] 无题目容器'); if (onDone) onDone(); return; }
        const letterArr = letters.toUpperCase().split('');
        if (letterArr.length === 0) { if (onDone) onDone(); return; }
        const labels = Array.prototype.slice.call(qEl.querySelectorAll('.el-radio, .el-checkbox'));
        let idx = 0;
        const step = () => {
            if (idx >= letterArr.length) {
                XIA_AI.log('多选全部点击完毕', 'ok');
                if (onDone) onDone();
                return;
            }
            const ch = letterArr[idx++];
            let found = null;
            for (const l of labels) {
                const n = l.querySelector('.index-name');
                const nameLetter = n ? (n.textContent || '').trim().match(/[A-H]/) : null;
                const input = l.querySelector('input[type="radio"], input[type="checkbox"]');
                const inputLetter = input && input.value ? String(input.value).toUpperCase().match(/[A-H]/) : null;
                if ((nameLetter && nameLetter[0] === ch) || (inputLetter && inputLetter[0] === ch)) { found = { label: l, input }; break; }
            }
            if (!found) {
                const pos = ch.charCodeAt(0) - 65;
                if (labels[pos]) { const li = labels[pos]; found = { label: li, input: li.querySelector('input[type="radio"], input[type="checkbox"]') }; }
            }
            if (found) {
                const input = found.input;
                if (input) { try { input.checked = true; } catch (e) {} }
                found.label.classList.add('is-checked');
                const inputWrap = found.label.querySelector('.el-radio__input, .el-checkbox__input');
                if (inputWrap) inputWrap.classList.add('is-checked');
                try { if (input) input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                try {
                    const vue = found.label.__vue__;
                    if (vue) {
                        vue.$emit('input', input && input.type === 'checkbox' ? true : (input && input.value));
                        vue.$emit('change', input && input.type === 'checkbox' ? true : (input && input.value));
                    }
                } catch (e) {}
                XIA_AI.log('多选点击: ' + ch, 'ok');
            } else {
                XIA_AI.log('多选找不到: ' + ch, 'error');
            }
            setTimeout(step, 350);
        };
        step();
    },

    answerSubjective(answer, onDone) {
        const editor = document.querySelector('[data-slate-editor]')
            || document.querySelector('div.w-e-text-container [contenteditable="true"]')
            || document.querySelector('[contenteditable="true"]');
        if (!editor) {
            XIA_AI.log('未找到主观题编辑器', 'error');
            if (onDone) onDone();
            return;
        }
        try { editor.focus(); } catch (e) {}
        try { editor.click(); } catch (e) {}
        try { editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
        try { editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
        try { editor.dispatchEvent(new FocusEvent('focus', { bubbles: true })); } catch (e) {}
        setTimeout(() => {
            const sel = window.getSelection();
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(editor);
            sel.addRange(range);
            try {
                editor.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true, cancelable: true, inputType: 'insertText', data: answer,
                }));
            } catch (e) {
                try { document.execCommand('insertText', false, answer); } catch (e2) {}
            }
            try { editor.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
            XIA_AI.log('主观题答案已填入: ' + answer.slice(0, 60) + (answer.length > 60 ? '...' : ''), 'ok');
            if (onDone) onDone();
        }, 200);
    },

    answerOnce() {
        if (XIA_AI.answeringOnce) { XIA_AI.log('正在执行单次答题，请稍候', 'error'); return; }
        XIA_AI.answeringOnce = true;
        const q = XIA_AI.grabQuestion();
        if (!q || !q.question) {
            XIA_AI.log('当前页面未找到可答题目', 'error');
            XIA_AI.answeringOnce = false;
            return;
        }
        if (q.type !== 'subjective' && q.options.length === 0) {
            XIA_AI.log('当前页面未找到可答题目（无选项）', 'error');
            XIA_AI.answeringOnce = false;
            return;
        }
        XIA_AI.log('🎯 单次答题: ' + q.question.slice(0, 60) + (q.question.length > 60 ? '...' : ''), 'ok');
        XIA_AI.callAI(q.question, q.options, q.type || 'single', (answer) => {
            if (answer) {
                if (q.type === 'subjective') {
                    XIA_AI.answerSubjective(answer, () => {
                        XIA_AI.log('单次答题（主观）完成', 'ok');
                        XIA_AI.answeringOnce = false;
                    });
                    return;
                }
                const t = xiaQuestionType(q.node);
                if (t === 'multi') {
                    XIA_AI.clickMultiAnswer(answer, () => {
                        XIA_AI.log('单次答题（多选）完成', 'ok');
                        XIA_AI.answeringOnce = false;
                    }, q.node);
                    return;
                }
                XIA_AI.clickAnswer(answer, q.node);
            }
            XIA_AI.answeringOnce = false;
        });
    },

    scan() {
        if (!conf.autoAnswer) { console.log('[XIA-scan] autoAnswer=false, 跳过'); return; }
        if (XIA_AI.answering) { console.log('[XIA-scan] answering=true, 跳过'); return; }
        const q = XIA_AI.grabQuestion();
        if (!q) { console.log('[XIA-scan] grabQuestion()=null'); return; }
        if (!q.question) { console.log('[XIA-scan] question为空'); return; }
        if (q.type !== 'subjective' && q.options.length === 0) { console.log('[XIA-scan] 选项为0, question=', q.question.slice(0, 60)); return; }

        const hash = q.question.slice(0, 100) + '|' + (q.options.length > 0 ? q.options.map(o => o.letter + o.text.slice(0, 30)).join(',') : 'subj');
        if (hash === XIA_AI.lastQuestionHash) { console.log('[XIA-scan] hash去重, 跳过'); return; }

        // 已作答（有选中项 / 主观题已填）：跳到下一题（列表页 grabQuestion 会自动落到下一个未答题目）
        if (xiaIsAnswered(q.node)) {
            const now = Date.now();
            if (XIA_AI._lastNav && (now - XIA_AI._lastNav) < 2500) { console.log('[XIA-scan] 跳题冷却中，跳过'); return; }
            XIA_AI._lastNav = now;
            console.log('[XIA-scan] 题目已有选中项，跳过');
            XIA_AI.log('检测到当前题目已被选择，跳过', 'info');
            XIA_AI.lastQuestionHash = '';
            clickNextQuestionButton();
            return;
        }

        XIA_AI.answering = true;
        XIA_AI.log('📋 抓到题目: ' + q.question.slice(0, 60) + (q.question.length > 60 ? '...' : '') + ' [' + (q.type || 'single') + ']');
        if (q.options.length > 0) XIA_AI.log('共 ' + q.options.length + ' 个选项: ' + q.options.map(o => o.letter).join(' '));

        XIA_AI.callAI(q.question, q.options, q.type || 'single', (answer) => {
            if (answer) {
                XIA_AI.lastQuestionHash = hash; // 标记已作答，避免同页重复作答
                if (q.type === 'subjective') {
                    XIA_AI.answerSubjective(answer, () => {
                        XIA_AI.log('主观题答案已填入，2s 后跳转下一题', 'ok');
                        setTimeout(() => { clickNextQuestionButton(); XIA_AI.answering = false; }, 2000);
                    });
                    return;
                }
                const t = xiaQuestionType(q.node);
                if (t === 'multi') {
                    XIA_AI.clickMultiAnswer(answer, () => {
                        XIA_AI.log('多选题答案 ' + answer + ' 已全部点击，1.5s 后跳转下一题', 'ok');
                        setTimeout(() => { clickNextQuestionButton(); XIA_AI.answering = false; }, 1500);
                    }, q.node);
                    return;
                }
                XIA_AI.clickAnswer(answer, q.node);
                setTimeout(() => { XIA_AI.lastQuestionHash = ''; }, 500);
            } else {
                // AI 未返回答案时重置 hash，允许下一轮重试，避免永久跳过本题
                XIA_AI.lastQuestionHash = '';
                XIA_AI.log('AI 未返回答案，下一轮将重试本题', 'error');
            }
            XIA_AI.answering = false;
        });
    },

    testGrab() {
        const q = XIA_AI.grabQuestion();
        if (!q) { XIA_AI.log('[测试] grabQuestion()=null', 'error'); return; }
        if (!q.question) { XIA_AI.log('[测试] question为空', 'error'); return; }
        XIA_AI.log('[测试] 抓到题目: ' + q.question.slice(0, 150), 'ai');
        if (q.options.length === 0) {
            XIA_AI.log('[测试] 未抓到选项（raw 前120字）: ' + (q.raw || '').slice(0, 120), 'error');
        } else {
            q.options.forEach(o => XIA_AI.log('[测试] 选项 ' + o.letter + ': ' + o.text.slice(0, 60), 'ai'));
        }
        if (conf.apiKey) XIA_AI.log('[测试] 如想让 AI 作答，点击下方"开启自动答题"后重新测试', 'ai');
        else XIA_AI.log('[测试] 未配置 API Key，仅演示抓取', 'error');
    },
};
