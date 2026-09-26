// ==UserScript==
// @name         芯位网课辅助 (Xinwei AutoStudy)
// @namespace    https://github.com/wikkd/xinwei-autostudy
// @version      1.0.0
// @description  基于大语言模型的网课学习辅助：自动刷课 + AI 答题（含检索增强）。以 MIT 协议开源。
// @author       wikkd
// @homepage     https://github.com/wikkd/xinwei-autostudy
// @supportURL   https://github.com/wikkd/xinwei-autostudy/issues
// @match        https://www.beeline-ai.com/*
// @match        https://beeline-ai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @connect      api.deepseek.com
// @connect      api.siliconflow.cn
// @connect      api.openai.com
// @connect      html.duckduckgo.com
// @connect      api.tavily.com
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
// ==================== 全局配置 ====================

// 运行期开关：是否静音视频
let muteEnabled = true;

const CFG = {
    PPT_DWELL: 5,           // 静态/PPT 课件停留多少秒即视为已观看并跳转（打开即算播放）
    MIN_WATCH: 30,          // 启动后最少观看秒数（防过早跳章）
    COOLDOWN: 15,           // 跳章后冷却秒数
    INTERVAL: 3,            // 主循环 / 题目扫描间隔（秒）

    DEFAULT_API_BASE: 'https://api.deepseek.com',
    DEFAULT_MODEL: 'deepseek-chat',

    DEFAULT_SEARCH_PROVIDER: 'duckduckgo', // duckduckgo(免密钥) / tavily(需Key)
    DEFAULT_SEARCH_MODE: 'auto',           // off / auto / always
    SEARCH_MAX_CHARS: 3000,
};

// 持久化配置键（GM_setValue / GM_getValue）
const STORAGE_KEYS = {
    apiKey: 'xa_apikey',
    apiBase: 'xa_apibase',
    model: 'xa_model',
    autoAnswer: 'xa_autoanswer',
    autoPlay: 'xa_autoplay',
    searchProvider: 'xa_search_provider',
    searchApiKey: 'xa_search_key',
    searchMode: 'xa_search_mode',
};

let conf = {};

function loadCfg() {
    const get = (key, def) => GM_getValue(key, def);
    conf = {
        apiKey: get(STORAGE_KEYS.apiKey, ''),
        apiBase: get(STORAGE_KEYS.apiBase, CFG.DEFAULT_API_BASE),
        model: get(STORAGE_KEYS.model, CFG.DEFAULT_MODEL),
        autoAnswer: get(STORAGE_KEYS.autoAnswer, false) === true || get(STORAGE_KEYS.autoAnswer, false) === 'true',
        autoPlay: get(STORAGE_KEYS.autoPlay, false) === true || get(STORAGE_KEYS.autoPlay, false) === 'true',
        searchProvider: get(STORAGE_KEYS.searchProvider, CFG.DEFAULT_SEARCH_PROVIDER),
        searchApiKey: get(STORAGE_KEYS.searchApiKey, ''),
        searchMode: get(STORAGE_KEYS.searchMode, CFG.DEFAULT_SEARCH_MODE),
    };
}

// ==================== 工具函数 ====================

// 元素是否真实可见（尺寸非零 + 未被隐藏）
function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
}

// 静音所有视频（仅当 muteEnabled 开启）
function muteAll() {
    document.querySelectorAll('video').forEach(v => { if (muteEnabled && !v.muted) v.muted = true; });
}

// 反挂机检测规避：伪造可见/聚焦状态 + 合成随机用户行为
function keepPlay() {
    document.querySelectorAll('video, audio').forEach(v => {
        if (v.paused && !v.ended && v.readyState >= 2) {
            try { v.play().catch(() => {}); } catch (e) {}
        }
    });

    try { Object.defineProperty(document, 'hidden', { get: () => false }); } catch (e) {}
    try { Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }); } catch (e) {}
    try { document.hasFocus = function () { return true; }; } catch (e) {}

    const rx = () => Math.random();
    const randInt = (a, b) => Math.floor(rx() * (b - a) + a);
    const x = randInt(50, window.innerWidth - 50 || 200);
    const y = randInt(50, window.innerHeight - 50 || 200);

    try {
        document.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, cancelable: true, view: window,
            clientX: x, clientY: y,
            movementX: randInt(-5, 5), movementY: randInt(-5, 5),
        }));
    } catch (e) {}

    if (rx() > 0.75) {
        try {
            const t = document.elementFromPoint(x, y) || document.body;
            t.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, view: window,
                clientX: x, clientY: y, button: 0,
            }));
        } catch (e) {}
    }
    if (rx() > 0.88) {
        try {
            const key = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp'][randInt(0, 6)];
            document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        } catch (e) {}
    }
    if (rx() > 0.65) {
        try { window.scrollBy({ top: randInt(-15, 15), left: randInt(-8, 8), behavior: 'instant' }); } catch (e) {}
    }
}

// 将元素滚动进视口，并尽量滚动其所有祖先容器
function ensureVisible(el) {
    if (!el) return;
    try {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    } catch (e) {
        try { el.scrollIntoView(); } catch (e2) {}
    }
    let p = el.parentElement, steps = 0;
    while (p && steps < 6) {
        if (p.scrollHeight > p.clientHeight) {
            try { p.scrollTop = el.offsetTop - p.clientHeight / 2; } catch (e) {}
        }
        p = p.parentElement;
        steps++;
    }
}

// 在课程侧边栏中，从当前高亮节点往后找下一个可点击的章节节点
function findNextMenuItem(activeNode) {
    let cur = activeNode;
    const LIMIT = 80;
    for (let i = 0; i < LIMIT; i++) {
        let sib = cur.nextElementSibling;
        if (!sib && cur.parentElement) {
            let p = cur.parentElement;
            while (p && !p.nextElementSibling) p = p.parentElement;
            if (p) sib = p.nextElementSibling;
        }
        if (!sib) break;
        if (sib.matches && sib.matches('.el-sub-menu__title, .el-menu-item-group__title')) {
            cur = sib;
            continue;
        }
        const items = sib.querySelectorAll ? sib.querySelectorAll('li.el-menu-item') : [];
        if (items.length > 0) {
            let target = null;
            for (const it of items) {
                const txt = (it.textContent || '').trim();
                if (txt.length === 0) continue;
                const hasTime = /[\d:：]/.test(txt) || it.querySelector('.time, .duration, [class*="time"]');
                if (!hasTime) continue;
                if (it.offsetHeight > 0 && it.offsetWidth > 0) { target = it; break; }
            }
            if (target) return target;
        } else if (sib.matches && sib.matches('li.el-menu-item')) {
            return sib;
        }
        cur = sib;
    }
    return null;
}

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
    let roots = Array.prototype.slice.call(document.querySelectorAll(XIA_QROOT))
        .filter(el => visible(el) && el.offsetHeight > 8);

    // 兜底：.question-tag-score 是各题型组件共有的作用域标记，取其容器作为题目块
    if (roots.length === 0) {
        const seen = [];
        document.querySelectorAll('.question-tag-score').forEach(tag => {
            const box = tag.closest('.question-box') || tag.parentElement;
            if (!box) return;
            if (!box.querySelector('.topic-title, .subject-title, .el-radio, .el-checkbox, input')) return;
            if (visible(box) && box.offsetHeight > 8 && seen.indexOf(box) < 0) seen.push(box);
        });
        roots = seen;
    }
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

    // 诊断：把当前页面的真实题目 DOM 结构 dump 出来（用于按真机结构修选择器）
    diagnose() {
        const out = [];
        const push = (s) => { out.push(s); XIA_AI.log(s, 'ai'); };
        push('🩺 诊断 ' + location.href.slice(0, 70));
        const roots = Array.prototype.slice.call(document.querySelectorAll(XIA_QROOT));
        push('① .homework-*根=' + roots.length + (roots.length ? '' : ' →走兜底'));
        roots.slice(0, 5).forEach((r, i) => {
            push('  [' + i + '] class="' + (r.className || '').slice(0, 60) + '" h=' + r.offsetHeight + ' 类型=' + xiaQuestionType(r));
        });
        const tags = document.querySelectorAll('.question-tag-score');
        push('② .question-tag-score=' + tags.length);
        if (tags.length) {
            const p = tags[0].closest('.question-box') || tags[0].parentElement;
            if (p) push('  兜底容器 class="' + (p.className || '').slice(0, 60) + '" 含题干=' + !!p.querySelector('.topic-title, .subject-title'));
        }
        push('③ div.question=' + document.querySelectorAll('div.question').length + '（旧结构，应为0）');
        push('④ iframe=' + document.querySelectorAll('iframe').length + ' radio=' + document.querySelectorAll('.el-radio').length + ' checkbox=' + document.querySelectorAll('.el-checkbox').length);
        const root = xiaQuestionRoot();
        if (!root) { push('❌ 未定位到题目容器'); console.log('[XIA-diagnose]\n' + out.join('\n')); return; }
        push('⑤ 选中容器 class="' + (root.className || '').slice(0, 60) + '" 类型=' + xiaQuestionType(root) + ' 已答=' + xiaIsAnswered(root));
        const t = xiaQuestionTitle(root);
        push('⑥ 题干=' + (t ? t.slice(0, 90) : '(空)'));
        const opts = xiaExtractOptions(root);
        push('⑦ 选项=' + opts.length);
        opts.slice(0, 8).forEach(o => push('  ' + o.letter + ': ' + o.text.slice(0, 45)));
        console.log('[XIA-diagnose]\n' + out.join('\n'));
    },
};

// ==================== 悬浮控制面板 UI ====================

const PANEL_CSS = `
#xa-panel{position:fixed;top:16px;left:16px;width:300px;background:#fff;border-radius:14px;
  box-shadow:0 10px 32px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);z-index:99999;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;transition:opacity .25s,transform .25s;}
#xa-panel.xa-hidden{opacity:0;transform:scale(.85);pointer-events:none;}
.xa-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:15px;font-weight:700;letter-spacing:.5px;cursor:move;user-select:none;}
.xa-min-btn{width:22px;height:22px;border-radius:6px;border:none;background:rgba(255,255,255,.2);
  color:#fff;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;}
.xa-min-btn:hover{background:rgba(255,255,255,.35);}
.xa-tabs{display:flex;background:#f9fafb;border-bottom:1px solid #e5e7eb;}
.xa-tab{flex:1;padding:9px 4px;font-size:12px;font-weight:600;color:#6b7280;text-align:center;cursor:pointer;transition:all .15s;border-bottom:2px solid transparent;}
.xa-tab:hover{color:#3b82f6;}
.xa-tab.active{color:#3b82f6;border-bottom-color:#3b82f6;background:#fff;}
.xa-body{padding:14px;display:flex;flex-direction:column;gap:10px;max-height:520px;overflow-y:auto;}
.xa-tab-pane{display:none;flex-direction:column;gap:10px;}
.xa-tab-pane.active{display:flex;}
.xa-status{font-size:12px;color:#6b7280;text-align:center;padding:6px 8px;border-radius:6px;background:#f3f4f6;transition:color .2s,background .2s;}
.xa-status.running{color:#059669;background:#d1fae5;}
.xa-status.paused{color:#d97706;background:#fef3c7;}
.xa-btn{width:100%;padding:9px 0;border:none;border-radius:10px;font-size:13px;font-weight:600;
  cursor:pointer;transition:all .2s;letter-spacing:.3px;color:#fff;}
.xa-start{background:linear-gradient(135deg,#3b82f6,#2563eb);}
.xa-start:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xa-start:active{transform:scale(.97);}
.xa-once{background:linear-gradient(135deg,#0ea5e9,#06b6d4);}
.xa-once:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xa-once:active{transform:scale(.97);}
.xa-input:disabled{background:#f3f4f6;color:#9ca3af;cursor:not-allowed;}
.xa-ai-inputs{display:flex;flex-direction:column;gap:10px;}
.xa-about{font-size:12px;color:#374151;line-height:1.8;max-height:350px;overflow-y:auto;
  padding-right:4px;word-break:break-word;}
.xa-about h4{font-size:14px;color:#1e40af;margin:0 0 6px;}
.xa-about p{margin:0 0 8px;}
.xa-stop{background:#f3f4f6;color:#374151;}
.xa-stop:hover{background:#e5e7eb;}
.xa-mute{background:#f3f4f6;color:#374151;}
.xa-mute:hover{background:#e5e7eb;}
.xa-mute.muted{background:#fee2e2;color:#dc2626;}
.xa-label{font-size:11px;color:#6b7280;font-weight:600;letter-spacing:.3px;margin-bottom:-4px;}
.xa-input{width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;
  font-family:inherit;outline:none;transition:border-color .2s;box-sizing:border-box;}
.xa-input:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.12);}
.xa-row{display:flex;align-items:center;gap:8px;}
.xa-switch{position:relative;width:42px;height:22px;border-radius:11px;background:#d1d5db;cursor:pointer;transition:background .2s;flex-shrink:0;}
.xa-switch.on{background:linear-gradient(135deg,#10b981,#059669);}
.xa-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .2s;}
.xa-switch.on::after{transform:translateX(20px);}
.xa-led{display:inline-block;width:8px;height:8px;border-radius:50%;background:#9ca3af;margin-right:6px;vertical-align:middle;}
.xa-led.ok{background:#10b981;box-shadow:0 0 6px rgba(16,185,129,.6);}
.xa-led.err{background:#dc2626;}
.xa-ai-log{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px;font-size:11px;
  font-family:'SF Mono','Menlo','Consolas',monospace;height:150px;overflow-y:auto;line-height:1.5;}
.xa-ai-log::-webkit-scrollbar{width:4px;}
.xa-ai-log::-webkit-scrollbar-thumb{background:#475569;border-radius:2px;}
#xa-mini{position:fixed;top:16px;left:16px;width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:18px;font-weight:700;
  display:none;align-items:center;justify-content:center;cursor:move;z-index:99999;
  box-shadow:0 4px 16px rgba(59,130,246,.35);transition:transform .2s;user-select:none;}
#xa-mini:hover{transform:scale(1.1);}
#xa-mini.show{display:flex;}
`;

let panel = null;
let mini = null;
let statusEl = null;
let aiLed = null;
let aiStatusText = null;

function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'xa-status' + (cls ? ' ' + cls : '');
}

function setAIStatus(type, text) {
    if (!aiLed || !aiStatusText) return;
    if (type === true) aiLed.className = 'xa-led ok';
    else if (type === false) aiLed.className = 'xa-led err';
    else aiLed.className = 'xa-led';
    aiStatusText.textContent = text || '';
}

function buildPanel() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'xa-panel';
    panel.innerHTML = `
<div class="xa-header"><span>Xinwei AutoStudy v1.0</span><button class="xa-min-btn" title="最小化">−</button></div>
<div class="xa-tabs">
  <div class="xa-tab active" data-tab="cfg">⚙ 挂机配置</div>
  <div class="xa-tab" data-tab="ai">🤖 AI 答题调试</div>
  <div class="xa-tab" data-tab="about">ℹ 关于</div>
</div>
<div class="xa-body">
  <!-- Tab 1: 挂机配置 -->
  <div class="xa-tab-pane active" data-pane="cfg">
    <div class="xa-status" id="xa-status">状态：就绪</div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">全自动刷课</span>
      <div class="xa-switch" id="xa-autoplay-switch" title="开启自动刷课"></div>
    </div>
    <button class="xa-btn xa-mute">🔇 关闭静音</button>
  </div>
  <!-- Tab 2: AI 答题调试 -->
  <div class="xa-tab-pane" data-pane="ai">
    <div class="xa-status" id="xa-ai-status"><span class="xa-led" id="xa-ai-led"></span><span id="xa-ai-status-text">等待配置 Key</span></div>
    <div class="xa-ai-inputs" id="xa-ai-inputs">
      <div class="xa-label" id="xa-label-apikey">API Key（密钥）</div>
      <input class="xa-input" id="xa-apikey" type="password" placeholder="sk-xxxxxxxxxxxxxxxx" />
      <div class="xa-label" id="xa-label-apibase">API Base URL</div>
      <input class="xa-input" id="xa-apibase" type="text" placeholder="https://api.deepseek.com" />
      <div class="xa-label" id="xa-label-model">模型名称</div>
      <input class="xa-input" id="xa-model" type="text" placeholder="deepseek-chat / gpt-4o-mini" />
      <div class="xa-label">检索增强（答题前先搜资料）</div>
      <select class="xa-input" id="xa-search-mode">
        <option value="off">关闭（不检索）</option>
        <option value="auto">自动（事实/时事题才搜）</option>
        <option value="always">总是（每题都搜）</option>
      </select>
      <select class="xa-input" id="xa-search-provider">
        <option value="duckduckgo">DuckDuckGo（免密钥）</option>
        <option value="tavily">Tavily（需Key，更准）</option>
      </select>
      <input class="xa-input" id="xa-search-key" type="password" placeholder="Tavily API Key（DDG 可留空）" />
    </div>
    <button class="xa-btn xa-once" id="xa-answer-once">🎯 回答当前题目</button>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autoanswer-switch" title="开启自动答题"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">自动答题+跳题</span>
    </div>
    <button class="xa-btn xa-start" id="xa-test-grab">🧪 一键抓取当前题目测试</button>
    <button class="xa-btn" id="xa-diagnose">🩺 诊断当前页面结构</button>
  </div>
  <!-- Tab 3: 关于 -->
  <div class="xa-tab-pane" data-pane="about">
    <div class="xa-about">
      <h4>👋 关于本脚本</h4>
      <p>本脚本以 <strong>MIT 协议</strong>开源发布，源码与构建流程完全公开，详见仓库 LICENSE 与 README。</p>
      <h4>1. 为什么没有内置 AI？</h4>
      <p>为了避免密钥泄露风险并长期维护，脚本采用<strong>【单机自填版】</strong>：你需要在面板里填写自己的大模型 API Key（如 DeepSeek、SiliconFlow 等）。脚本不会上报任何数据。</p>
      <h4>2. 推荐的白嫖方案</h4>
      <p>新用户可在 <strong>硅基流动 (SiliconFlow)</strong>、<strong>DeepSeek 官方</strong> 等平台注册，通常会获赠大量免费 Token，足够完成课程学习。</p>
      <h4>3. 友情提示</h4>
      <p>本脚本仅供计算机自动化技术交流与学习，请在遵守平台规则与当地法律的前提下使用。AI 不保证 100% 正确率，刷完课建议自行复习一遍，使用风险请自行承担。</p>
      <h4>4. 反馈与更新</h4>
      <p>代码由社区协作维护。遇到 bug 可在 GitHub Issues 反馈。网课平台经常改版，若某天失效我会跟进修复。</p>
    </div>
  </div>
  <!-- 共享日志框 -->
  <div class="xa-ai-log" id="xa-ai-log"><div style="color:#94a3b8;">等待操作...</div></div>
</div>`;
    document.body.appendChild(panel);

    mini = document.createElement('div');
    mini.id = 'xa-mini';
    mini.textContent = '夏';
    document.body.appendChild(mini);
}

function makeDraggable(dragEl, handleEl) {
    let dragging = false, startX, startY, origLeft, origTop;
    handleEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, .xa-min-btn, .xa-switch, input, .xa-btn')) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origLeft = parseInt(dragEl.style.left) || dragEl.getBoundingClientRect().left;
        origTop = parseInt(dragEl.style.top) || dragEl.getBoundingClientRect().top;
        dragEl.style.transition = 'none';
        dragEl.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const maxX = window.innerWidth - dragEl.offsetWidth;
        const maxY = window.innerHeight - dragEl.offsetHeight;
        dragEl.style.left = Math.max(0, Math.min(origLeft + dx, maxX)) + 'px';
        dragEl.style.top = Math.max(0, Math.min(origTop + dy, maxY)) + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        dragEl.style.cursor = '';
        dragEl.style.transition = '';
    });
}

function bindUI() {
    let aiScanTimer = null;
    function startAIScan() {
        if (aiScanTimer) return;
        setTimeout(() => { XIA_AI.scan(); }, 500);
        aiScanTimer = setInterval(() => { XIA_AI.scan(); }, 3000);
    }
    function stopAIScan() {
        if (aiScanTimer) { clearInterval(aiScanTimer); aiScanTimer = null; }
    }

    const $ = s => panel.querySelector(s);
    statusEl = $('#xa-status');
    aiLed = $('#xa-ai-led');
    aiStatusText = $('#xa-ai-status-text');
    const apikeyInput = $('#xa-apikey');
    const apibaseInput = $('#xa-apibase');
    const modelInput = $('#xa-model');
    const searchModeInput = $('#xa-search-mode');
    const searchProviderInput = $('#xa-search-provider');
    const searchApiKeyInput = $('#xa-search-key');
    const autoSwitch = $('#xa-autoanswer-switch');
    const playSwitch = $('#xa-autoplay-switch');

    // Tab 切换
    document.querySelectorAll('.xa-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.xa-tab, .xa-tab-pane').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            const pane = document.querySelector('[data-pane="' + tab.dataset.tab + '"]');
            if (pane) pane.classList.add('active');
        });
    });

    // 最小化
    $('.xa-min-btn').addEventListener('click', () => {
        panel.classList.add('xa-hidden');
        mini.classList.add('show');
    });
    mini.addEventListener('click', () => {
        panel.classList.remove('xa-hidden');
        mini.classList.remove('show');
    });

    // API 配置实时保存
    const saveInput = (key, el) => {
        el.addEventListener('change', () => { conf[key] = el.value.trim(); GM_setValue(STORAGE_KEYS[key], conf[key]); XIA_AI.log('已保存: ' + key); });
        el.addEventListener('blur', () => { conf[key] = el.value.trim(); GM_setValue(STORAGE_KEYS[key], conf[key]); });
    };
    saveInput('apiKey', apikeyInput);
    saveInput('apiBase', apibaseInput);
    saveInput('model', modelInput);
    saveInput('searchMode', searchModeInput);
    saveInput('searchProvider', searchProviderInput);
    saveInput('searchApiKey', searchApiKeyInput);

    // API Key 输入时实时更新状态
    apikeyInput.addEventListener('input', () => {
        conf.apiKey = apikeyInput.value.trim();
        setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');
    });

    // 配置回填 + 初始化 UI
    apikeyInput.value = conf.apiKey;
    apibaseInput.value = conf.apiBase;
    modelInput.value = conf.model;
    searchModeInput.value = conf.searchMode;
    searchProviderInput.value = conf.searchProvider;
    searchApiKeyInput.value = conf.searchApiKey;
    setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');

    // 自动答题开关
    autoSwitch.addEventListener('click', () => {
        conf.autoAnswer = !conf.autoAnswer;
        GM_setValue(STORAGE_KEYS.autoAnswer, conf.autoAnswer);
        refreshAISwitch();
    });
    function refreshAISwitch() {
        if (conf.autoAnswer) {
            autoSwitch.classList.add('on');
            XIA_AI.log('自动答题已开启（每 3s 扫描页面）', 'ok');
            startAIScan();
        } else {
            autoSwitch.classList.remove('on');
            stopAIScan();
            XIA_AI.log('自动答题已关闭', 'info');
        }
    }

    // 挂机开关：独立控制主循环
    function refreshPlaySwitch() {
        if (conf.autoPlay) {
            playSwitch.classList.add('on');
            startAuto();
        } else {
            playSwitch.classList.remove('on');
            stopAuto();
        }
    }
    playSwitch.addEventListener('click', () => {
        conf.autoPlay = !conf.autoPlay;
        GM_setValue(STORAGE_KEYS.autoPlay, conf.autoPlay);
        refreshPlaySwitch();
    });

    // 单次答题按钮
    $('#xa-answer-once').addEventListener('click', () => { XIA_AI.answerOnce(); });

    // 测试按钮
    $('#xa-test-grab').addEventListener('click', () => { XIA_AI.testGrab(); });

    // 诊断按钮（dump 页面真实题目 DOM，便于按真机结构修选择器）
    $('#xa-diagnose').addEventListener('click', () => { XIA_AI.diagnose(); });

    // 静音按钮
    const muteBtn = $('.xa-mute');
    muteBtn.addEventListener('click', () => {
        muteEnabled = !muteEnabled;
        if (muteEnabled) { muteAll(); muteBtn.classList.remove('muted'); muteBtn.textContent = '🔇 关闭静音'; }
        else { document.querySelectorAll('video').forEach(v => { if (v.muted) v.muted = false; }); muteBtn.classList.add('muted'); muteBtn.textContent = '🔊 开启声音'; }
    });

    refreshPlaySwitch();
    refreshAISwitch();
}

// ==================== 自动刷课 ====================

let scriptStart = Date.now();
let cooldownUntil = 0;
let pptSince = 0;
let tick = 0;
let consecutiveJumps = 0;
let mainLoopId = null;

// 当前是否处于「静态/PPT 课件」章节：打开即视为已观看，短暂停留后由目录跳下一节。
// 判定：主内容区没有可见的 <video>（否则交给视频完成逻辑），且存在 PPT/文档类 iframe。
// 注：iframe 的 src 同源/跨域都可读，无需进入内容文档。
function isStaticOrPptSection() {
    for (const v of document.querySelectorAll('video')) {
        if (visible(v)) return false; // 有可见视频 => 不是静态课件
    }
    for (const f of document.querySelectorAll('iframe')) {
        const src = (f.src || '').toLowerCase();
        if (src && /powerpointframe|ppt|slide|preview|doc|courseware|resource|office|viewer/.test(src)) return true;
    }
    return false;
}

function openSidebarSwitch() {
    const btn = document.querySelector('.course-sidebar-switch');
    if (btn && visible(btn)) { btn.click(); return true; }
    return false;
}

function isSectionComplete() {
    const now = Date.now();
    if (now < cooldownUntil) return false;

    const active = document.querySelector('li.el-menu-item.is-active');
    if (active) {
        if (active.querySelector('.inProgress-icon, .unStart-icon')) return false;
        const done = active.querySelector('.done-icon, .icon-done, .el-icon-check, .el-icon-circle-check, .el-icon-check-circle, .is-done');
        if (done && visible(done)) { console.log('[芯位] done-icon → 完成'); return true; }
    }

    // 静态/PPT 课件：打开即算已观看，停留 PPT_DWELL 秒后跳转（不受 MIN_WATCH 最少观看限制）
    if (isStaticOrPptSection()) {
        if (pptSince === 0) pptSince = now;
        if (now - pptSince > CFG.PPT_DWELL * 1000) { console.log('[芯位] PPT/静态课件停留' + CFG.PPT_DWELL + 's → 完成'); return true; }
        return false;
    }
    pptSince = 0;

    // 视频完成判定（需满足最少观看时长，防止过早跳章）
    if (now - scriptStart < CFG.MIN_WATCH * 1000) return false;
    for (const v of document.querySelectorAll('video')) {
        if (!visible(v)) continue;
        if (v.duration > 0 && (v.ended || v.currentTime >= v.duration - 0.5)) { console.log('[芯位] 视频播放完毕 → 完成'); return true; }
    }
    return false;
}

function clickNextChapter() {
    const rights = document.querySelectorAll('.right, div.right');
    for (const r of rights) {
        if (!visible(r)) continue;
        if ((r.textContent || '').includes('观看下一章节')) {
            setTimeout(() => {
                const target = r.closest('button, a, [role="button"], [class*="btn"], [class*="Btn"]') || r;
                target.click();
            }, 800 + Math.random() * 1000);
            console.log('[芯位] 点击 "观看下一章节" 按钮');
            cooldownUntil = Date.now() + CFG.COOLDOWN * 1000;
            pptSince = 0; consecutiveJumps++;
            return true;
        }
    }
    return false;
}

function navigateToNextSection() {
    openSidebarSwitch();
    const active = document.querySelector('li.el-menu-item.is-active');
    if (!active) { console.log('[芯位] 无高亮节点'); return false; }
    const next = findNextMenuItem(active);
    if (!next) { console.log('[芯位] 已是最后一节'); return false; }
    const cur = (active.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    const nxt = (next.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    console.log('[芯位] 穿透搜索: "' + cur + '" → "' + nxt + '"');
    ensureVisible(next);
    setTimeout(() => {
        if (!visible(next)) ensureVisible(next);
        next.click();
        cooldownUntil = Date.now() + CFG.COOLDOWN * 1000;
        pptSince = 0; consecutiveJumps++;
        console.log('[芯位] 点击完成');
    }, 400);
    return true;
}

function mainTick() {
    tick++;
    muteAll();
    keepPlay();
    if (tick % 10 === 0) {
        const active = document.querySelector('li.el-menu-item.is-active');
        const cur = active ? (active.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20) : '(无)';
        const cd = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        console.log('[芯位] #' + tick + ' | 当前: "' + cur + '" | cd=' + cd + 's | 连跳=' + consecutiveJumps);
    }
    try { XIA_AI.scan(); } catch (e) { console.error('[XIA] 扫描异常:', e); }
    if (!isSectionComplete()) { consecutiveJumps = 0; return; }
    if (Date.now() < cooldownUntil) return;
    if (consecutiveJumps >= 3) { console.log('[芯位] 连续跳转' + consecutiveJumps + '次，暂停50s'); cooldownUntil = Date.now() + 50000; consecutiveJumps = 0; return; }
    console.log('[芯位] 触发跳转');
    if (clickNextChapter()) return;
    setTimeout(() => { if (!clickNextChapter()) navigateToNextSection(); }, 5000);
}

function startAuto() {
    if (mainLoopId) return;
    mainLoopId = setInterval(mainTick, CFG.INTERVAL * 1000);
    setStatus('正在运行', 'running');
    console.log('[芯位] 自动刷课已启动');
    XIA_AI.log('🚀 自动挂机已启动，每 ' + CFG.INTERVAL + ' 秒扫描一次页面', 'ok');
}

function stopAuto() {
    if (mainLoopId) { clearInterval(mainLoopId); mainLoopId = null; }
    setStatus('已暂停', 'paused');
    console.log('[芯位] 自动刷课已停止');
    XIA_AI.log('⏸ 挂机已停止', 'info');
}

// ==================== 学习状态异常弹窗自动刷新 ====================
// 平台弹出"系统检测到你的学习状态异常，请刷新后继续学习"时脚本无法操作，
// 检测到后自动刷新页面恢复；刷新后脚本按面板开关状态自动续跑。

function initPopupAutoReload() {
    const RELOAD_COOLDOWN = 20000; // 20s 冷却，防止刷新死循环
    setInterval(() => {
        const last = Number(GM_getValue('xa_last_reload_at', 0));
        if (Date.now() - last < RELOAD_COOLDOWN) return;
        const text = (document.body && document.body.innerText) || '';
        if (text.indexOf('学习状态异常') !== -1 || text.indexOf('请刷新后继续学习') !== -1) {
            GM_setValue('xa_last_reload_at', Date.now());
            console.log('[芯位] 检测到学习状态异常弹窗，3秒后自动刷新页面');
            setTimeout(() => { location.reload(); }, 3000);
        }
    }, 3000);
}

// ==================== 入口 ====================
// 防重复注入（同一页面脚本可能被加载多次）
if (window.xaScriptLoaded) return;
window.xaScriptLoaded = true;

// 不在 iframe/子框架内运行（PPT 播放器等子框架也会命中 @match，避免重复注入与空扫描）
if (window.self !== window.top) return;

loadCfg();

// 构建并挂载 UI
buildPanel();
makeDraggable(panel, panel.querySelector('.xa-header'));
makeDraggable(mini, mini);
bindUI();

muteAll();

// MIT 一句话提示（替代原拦截式免责弹窗）
XIA_AI.log('本脚本以 MIT 协议开源发布，详见仓库 LICENSE。请遵守平台规则与当地法律使用。', 'info');

// 启动「学习状态异常」弹窗自动刷新
initPopupAutoReload();

console.log('[XinweiAutoStudy] 已加载');

})();
