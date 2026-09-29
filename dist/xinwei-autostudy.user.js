// ==UserScript==
// @name         芯位网课辅助 (Xinwei AutoStudy)
// @namespace    https://github.com/wikkd/xinwei-autostudy
// @version      2.1.3
// @description  多平台网课学习辅助（芯位 beeline-ai.com / 超星学习通 chaoxing.com）：自动刷课 + AI 答题（单选/多选/判断/填空/主观，检索增强 + 本地答案本）。MIT 开源。
// @author       wikkd
// @homepage     https://github.com/wikkd/xinwei-autostudy
// @supportURL   https://github.com/wikkd/xinwei-autostudy/issues
// @match        https://www.beeline-ai.com/*
// @match        https://beeline-ai.com/*
// @match        *://*.chaoxing.com/*
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

let muteEnabled = true; // 运行期开关：是否静音视频

const CFG = {
    PPT_DWELL: 5,           // 静态/PPT 课件停留秒数（打开即算已观看）
    MIN_WATCH: 30,          // 启动后最少观看秒数（防过早跳章）
    COOLDOWN: 15,           // 跳章后冷却秒数
    INTERVAL: 3,            // 主循环 / 题目扫描间隔（秒）
    BANK_MAX: 400,          // 答案本最大条数（超出淘汰最早的）

    DEFAULT_API_BASE: 'https://api.deepseek.com',
    DEFAULT_MODEL: 'deepseek-chat',
    DEFAULT_SEARCH_PROVIDER: 'duckduckgo', // duckduckgo(免密钥) / tavily(需Key)
    DEFAULT_SEARCH_MODE: 'auto',           // off / auto / always
    SEARCH_MAX_CHARS: 3000,
};

const SK = {
    apiKey: 'xa_apikey', apiBase: 'xa_apibase', model: 'xa_model',
    autoAnswer: 'xa_autoanswer', autoPlay: 'xa_autoplay', autoSubmit: 'xa_autosubmit',
    searchProvider: 'xa_search_provider', searchApiKey: 'xa_search_key', searchMode: 'xa_search_mode',
    cxSpeed: 'xa_cx_speed',     // 超星视频倍速（1/1.25/1.5/2，仅 chaoxing 生效；芯位不变速）
    bank: 'xa_answer_bank',     // 答案本：题目hash -> {a:答案, t:时间}
    panelPos: 'xa_panel_pos',   // 面板/迷你球拖动位置
    minimized: 'xa_minimized',  // 面板是否处于最小化
};

let conf = {};

function loadCfg() {
    const g = (k, d) => GM_getValue(k, d);
    const b = v => v === true || v === 'true';
    conf = {
        apiKey: g(SK.apiKey, ''),
        apiBase: g(SK.apiBase, CFG.DEFAULT_API_BASE),
        model: g(SK.model, CFG.DEFAULT_MODEL),
        autoAnswer: b(g(SK.autoAnswer, false)),
        autoPlay: b(g(SK.autoPlay, false)),
        autoSubmit: b(g(SK.autoSubmit, true)),
        searchProvider: g(SK.searchProvider, CFG.DEFAULT_SEARCH_PROVIDER),
        searchApiKey: g(SK.searchApiKey, ''),
        searchMode: g(SK.searchMode, CFG.DEFAULT_SEARCH_MODE),
        cxSpeed: parseFloat(g(SK.cxSpeed, '2')) || 2, // 默认 2x（平台开放上限）
    };
}


function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
}

function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function qtext(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }        // 压缩空白
function qtextAll(el) { return ((el && el.textContent) || '').replace(/\s+/g, ''); }             // 去全部空白（精确比对用）

function muteAll() {
    document.querySelectorAll('video').forEach(v => { if (muteEnabled && !v.muted) v.muted = true; });
}

function keepPlay() {
    document.querySelectorAll('video, audio').forEach(v => {
        if (v.paused && !v.ended && v.readyState >= 2) {
            try { v.play().catch(() => {}); } catch (e) {}
        }
    });

    try { Object.defineProperty(document, 'hidden', { get: () => false }); } catch (e) {}
    try { Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }); } catch (e) {}
    try { document.hasFocus = function () { return true; }; } catch (e) {}

    const randInt = (a, b) => Math.floor(Math.random() * (b - a) + a);
    const x = randInt(50, window.innerWidth - 50 || 200);
    const y = randInt(50, window.innerHeight - 50 || 200);

    try {
        document.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, cancelable: true, view: window,
            clientX: x, clientY: y,
            movementX: randInt(-5, 5), movementY: randInt(-5, 5),
        }));
    } catch (e) {}

    if (Math.random() > 0.75) {
        try {
            const t = document.elementFromPoint(x, y) || document.body;
            t.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, view: window,
                clientX: x, clientY: y, button: 0,
            }));
        } catch (e) {}
    }
    if (Math.random() > 0.88) {
        try {
            const key = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp'][randInt(0, 6)];
            document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        } catch (e) {}
    }
    if (Math.random() > 0.65) {
        try { window.scrollBy({ top: randInt(-15, 15), left: randInt(-8, 8), behavior: 'instant' }); } catch (e) {}
    }
}

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


const XA_SITE = /(^|\.)chaoxing\.com$/.test(location.hostname) ? 'chaoxing'
    : /(^|\.)beeline-ai\.com$/.test(location.hostname) ? 'beeline' : null;

const CX = {
    isVideoIframe() { return /\/ananas\/modules\/video\//.test(location.pathname); },

    startVideoFrameLoop() {
        loadCfg();
        setInterval(() => { try { CX.videoTick(); } catch (e) {} }, 3000);
        console.log('[XinweiAutoStudy] chaoxing video frame loop 已启动');
    },
    videoTick() {
        const on = GM_getValue(SK.autoPlay, false);
        conf.autoPlay = on === true || on === 'true';
        const speed = parseFloat(GM_getValue(SK.cxSpeed, '2')) || 1;
        for (const v of document.querySelectorAll('video')) {
            if (muteEnabled && !v.muted) v.muted = true;
            if (v.playbackRate !== speed) { try { v.playbackRate = speed; } catch (e) {} }
            if (conf.autoPlay && !v.ended && v.readyState >= 2 && v.paused) {
                try { v.play().catch(() => {}); } catch (e) {}
            }
            if (!v._xaDone && v.duration > 0 && (v.ended || v.currentTime >= v.duration * 0.92)) {
                v._xaDone = true;
                try { window.parent.postMessage({ __xa: 'cx-video-done' }, '*'); } catch (e) {}
            }
        }
        if (conf.autoPlay) {
            try {
                document.dispatchEvent(new MouseEvent('mousemove', {
                    bubbles: true, clientX: 100 + Math.random() * 300, clientY: 100 + Math.random() * 200,
                }));
            } catch (e) {}
        }
    },

    _lastNext: 0,
    _nextErrAt: 0,
    collectVideos(doc, depth) {
        if (depth > 3) return [];
        let out = qsa('video', doc);
        for (const f of qsa('iframe', doc)) {
            try { if (f.contentDocument) out = out.concat(CX.collectVideos(f.contentDocument, depth + 1)); } catch (e) {}
        }
        return out;
    },
    tick() {
        muteAll();
        if (!/\/mycourse\/studentstudy/.test(location.href)) return;
        let playing = CX.collectVideos(document, 0).some(v => !v.paused && !v.ended);
        const rpt = { frame: 0, vid: 0, btn: 0, play: 0 };
        const visit = (doc, depth) => {
            if (depth > 3) return;
            rpt.frame++;
            for (const v of qsa('video', doc)) {
                rpt.vid++;
                if (muteEnabled && !v.muted) v.muted = true;
                if (v.playbackRate !== conf.cxSpeed) { try { v.playbackRate = conf.cxSpeed; } catch (e) {} }
                if (conf.autoPlay && !playing && v.paused && !v.ended) {
                    try { const p = v.play(); if (p && p.catch) p.catch(() => {}); rpt.play++; playing = true; } catch (e) {}
                }
                if (!v.paused && !v.ended) playing = true;
                if (!v._xaDone && v.duration > 0 && (v.ended || v.currentTime >= v.duration * 0.92)) {
                    v._xaDone = true;
                    XIA_AI.log('✅ 一个视频已看完（≥92%）', 'ok');
                    CX.clickNextSection();
                }
            }
            for (const b of qsa('button, [role="button"], [class*="play"], a, div', doc)) {
                if (qtext(b) !== '播放视频' || !visible(b)) continue;
                rpt.btn++;
                if (conf.autoPlay && !playing) { try { b.click(); playing = true; } catch (e) {} }
            }
            for (const f of qsa('iframe', doc)) {
                if (/antispider/i.test(f.src || '')) {
                    if (!CX._capWarned) {
                        CX._capWarned = true;
                        XIA_AI.log('⚠️ 触发平台风控验证码，请人工在页面中输入验证码；通过后挂机自动恢复', 'error');
                        XIA_AI.progress('⚠️ 等待人工验证码…');
                    }
                } else if (depth === 0 || f.src) {
                    CX._capWarned = false;
                }
                try { if (f.contentDocument) visit(f.contentDocument, depth + 1); } catch (e) {}
            }
        };
        visit(document, 0);
        const now = Date.now();
        if (now - (CX._rptAt || 0) > 30000) {
            CX._rptAt = now;
            XIA_AI.log('🔍 视频扫描: frames=' + rpt.frame + ' videos=' + rpt.vid
                + ' playBtns=' + rpt.btn + ' playCalls=' + rpt.play
                + (playing ? ' ▶播放中' : ' ⏸未播放') + ' autoPlay=' + !!conf.autoPlay, 'ai');
        }
        if (conf.autoPlay && !playing && now - (CX._idleLogAt || 0) > 60000) {
            CX._idleLogAt = now;
            XIA_AI.progress('⏳ 等待视频任务点…');
        }
    },
    bindStudyTop() {
        window.addEventListener('message', (e) => {
            if (!e.data || e.data.__xa !== 'cx-video-done') return;
            CX.clickNextSection();
        });
    },
    clickNextSection() {
        const now = Date.now();
        if (now - CX._lastNext < 8000) return;
        let btn = null;
        qsa('button, a, [role="button"], [class*="next"], [class*="Next"]').forEach(el => {
            if (btn || !visible(el)) return;
            if (qtextAll(el) === '下一节') btn = el;
        });
        if (btn) {
            CX._lastNext = now;
            XIA_AI.log('▶ 视频已看完（≥92%），点击「下一节」', 'ok');
            XIA_AI.progress('▶ 跳转下一节…');
            try { btn.click(); } catch (e) {}
        } else if (now - CX._nextErrAt > 30000) {
            CX._nextErrAt = now;
            XIA_AI.log('未找到「下一节」按钮', 'error');
        }
    },

};

const CXQA = {
    questionRoot() {
        const roots = qsa('.TiMu').filter(el => visible(el) && el.offsetHeight > 8);
        if (!roots.length) return null;
        for (const r of roots) if (!CXQA.isAnswered(r)) return r;
        return roots[0];
    },
    questionType(root) {
        if (!root) return 'single';
        const t = qtext(root.querySelector('.fontLabel, [class*="fontLabel"], .Cy_TItle b, .Zy_TItle b'));
        if (/多选/.test(t)) return 'multi';
        if (/判断/.test(t)) return 'bool';
        if (/填空/.test(t)) return 'cloze';
        if (/简答|论述|名词解释|案例分析|计算题/.test(t)) return 'subjective';
        return 'single';
    },
    isAnswered(root) {
        if (!root) return false;
        if (qsa('input[type="radio"], input[type="checkbox"]', root).some(i => i.checked)) return true;
        if (qsa('li.cur, .check_answer', root).length) return true;
        const ed = root.querySelector('textarea, [contenteditable="true"]');
        if (ed) { const t = qtext(ed); return t.length > 0 && !/请输入/.test(t); }
        return false;
    },
    letterOf(label) {
        const m = qtext(label).match(/^\s*([A-H])(?=[\.\、\s])/i);
        return m ? m[1].toUpperCase() : null;
    },
    allSelected(root, letters) {
        if (!root) return false;
        const lis = qsa('ul li', root);
        return String(letters).toUpperCase().split('').every(ch => {
            const li = lis.find(l => CXQA.letterOf(l) === ch);
            return !!li && (li.classList.contains('cur') || !!li.querySelector('input:checked'));
        });
    },
    questionScore(root) {
        const m = qtext(root).match(/(?:\(|（)\s*(\d+(?:\.\d+)?)\s*分/);
        return m ? parseFloat(m[1]) : 0;
    },
    extractOptions(root) {
        const opts = [];
        qsa('ul li', root).forEach(li => {
            if (!visible(li)) return;
            const t = qtext(li);
            const m = t.match(/^([A-H])[\.\、\:\s]*(.+)$/i);
            if (m) opts.push({ letter: m[1].toUpperCase(), text: m[2].slice(0, 120), node: li });
        });
        if (!opts.length) { // 判断题：对/错文本选项，合成 T/F 字母
            qsa('ul li', root).forEach(li => {
                if (!visible(li)) return;
                const t = qtext(li);
                if (/^(对|正确|√)/.test(t)) opts.push({ letter: 'T', text: t.slice(0, 60), node: li });
                else if (/^(错|错误|×)/.test(t)) opts.push({ letter: 'F', text: t.slice(0, 60), node: li });
            });
        }
        return opts;
    },
    questionTitle(root) {
        const t = root.querySelector('.Zy_TItle, .Cy_TItle, [class*="TItle"]') || root;
        return qtext(t)
            .replace(/^\s*\d+\s*[\.\、\)．]\s*/, '')
            .replace(/[\(（]\s*\d+(?:\.\d+)?\s*分\s*[\)）]/g, '')
            .slice(0, 400);
    },
    diagnose() {
        const out = [];
        const push = s => { out.push(s); XIA_AI.log(s, 'ai'); };
        push('🩺 超星诊断 ' + location.href.slice(0, 70));
        const timu = qsa('.TiMu');
        push('① .TiMu=' + timu.length + ' iframe=' + qsa('iframe').length);
        const root = CXQA.questionRoot();
        if (!root) { push('❌ 未定位到题目容器（若在列表页属正常）'); return; }
        push('② 类型=' + CXQA.questionType(root) + ' 已答=' + CXQA.isAnswered(root) + ' 分值=' + CXQA.questionScore(root));
        push('③ 题干=' + (CXQA.questionTitle(root) || '(空)').slice(0, 90));
        const opts = CXQA.extractOptions(root);
        push('④ 选项=' + opts.length);
        opts.slice(0, 8).forEach(o => push('  ' + o.letter + ': ' + o.text.slice(0, 45)));
        push('⑤ 题块HTML前300: ' + root.innerHTML.replace(/\s+/g, ' ').slice(0, 300));
        console.log('[XIA-diagnose]\n' + out.join('\n'));
    },
};

const QA = XA_SITE === 'chaoxing' ? CXQA : {
    questionRoot, questionType, isAnswered, letterOf, allSelected,
    questionScore, extractOptions, questionTitle,
};


const XIA_QROOT = '.homework-single-selected, .homework-multiple-selected, .homework-true-or-false, .homework-cloze, .homework-question-editor';

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

function exactText(selector, text) {
    let hit = null;
    qsa(selector).forEach(el => { if (!hit && visible(el) && qtextAll(el) === text) hit = el; });
    return hit;
}

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

function letterOf(label) {
    const m = label.querySelector('.index-name');
    const nameLetter = m ? qtext(m).match(/[A-H]/) : null;
    if (nameLetter) return nameLetter[0];
    const input = label.querySelector('input[type="radio"], input[type="checkbox"]');
    const v = input && input.value ? String(input.value).trim().toUpperCase() : '';
    return /^[A-H]$/.test(v) ? v : null;
}

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

function questionScore(root) {
    const scope = root.querySelector('.question-tag-score') ? root : (root.closest('.question-box') || root.parentElement || root);
    const m = scope.querySelector('.question-tag-score');
    const s = m ? qtext(m).match(/(\d+)\s*分/) : null;
    return s ? parseInt(s[1], 10) : 0;
}

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

    progress(text) {
        const el = document.getElementById('xa-progress');
        if (el) el.textContent = text;
    },

    bump(k) {
        if (k) XIA_AI.stats[k]++;
        const el = document.getElementById('xa-stats');
        if (el) {
            const s = XIA_AI.stats;
            el.textContent = '已答 ' + s.answered + ' · 缓存命中 ' + s.cached + ' · 已提交 ' + s.submitted;
        }
    },

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

    parseAnswer(content, type) {
        const c = String(content || '').trim();
        if (!c) return null;
        if (type === 'subjective') return c;
        if (type === 'cloze') {
            const lines = c.split(/\n+/).map(s => s.trim()).filter(Boolean);
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

    callAI(q, onResult) {
        const type = q.type || 'single';
        const isSubjective = type === 'subjective';
        const apiKey = conf.apiKey;
        if (!apiKey) { XIA_AI.log('未配置 API Key', 'error'); onResult(null); return; }
        const base = (conf.apiBase || CFG.DEFAULT_API_BASE).replace(/\/+$/, '');
        const endpoint = /\/v\d+\/?$/.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions';
        const model = conf.model || CFG.DEFAULT_MODEL;
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
            const sel = window.getSelection();
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(editor);
            sel.addRange(range);

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
.xa-body{padding:14px;display:flex;flex-direction:column;gap:10px;max-height:640px;overflow-y:auto;}
.xa-tab-pane{display:none;flex-direction:column;gap:10px;}
.xa-tab-pane.active{display:flex;}
.xa-status{font-size:12px;color:#6b7280;text-align:center;padding:6px 8px;border-radius:6px;background:#f3f4f6;transition:color .2s,background .2s;}
.xa-status.running{color:#059669;background:#d1fae5;}
.xa-status.paused{color:#d97706;background:#fef3c7;}
.xa-btn{width:100%;padding:9px 0;border:none;border-radius:10px;font-size:13px;font-weight:600;
  cursor:pointer;transition:all .2s;letter-spacing:.3px;color:#fff;}
.xa-btn:disabled{opacity:.55;cursor:wait;}
.xa-once{background:linear-gradient(135deg,#0ea5e9,#06b6d4);}
.xa-once:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xa-once:active{transform:scale(.97);}
.xa-about{font-size:12px;color:#374151;line-height:1.8;max-height:350px;overflow-y:auto;
  padding-right:4px;word-break:break-word;}
.xa-about h4{font-size:14px;color:#1e40af;margin:0 0 6px;}
.xa-about p{margin:0 0 8px;}
.xa-stop{background:#f3f4f6;color:#374151;}
.xa-stop:hover{background:#e5e7eb;}
.xa-mute{background:#f3f4f6;color:#374151;}
.xa-mute:hover{background:#e5e7eb;}
.xa-mute.muted{background:#fee2e2;color:#dc2626;}
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
  font-family:'SF Mono','Menlo','Consolas',monospace;height:240px;min-height:140px;max-height:480px;
  resize:vertical;overflow-y:auto;line-height:1.5;}
.xa-ai-log::-webkit-scrollbar{width:4px;}
.xa-ai-log::-webkit-scrollbar-thumb{background:#475569;border-radius:2px;}
#xa-mini{position:fixed;top:16px;left:16px;width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:18px;font-weight:700;
  display:none;align-items:center;justify-content:center;cursor:move;z-index:99999;
  box-shadow:0 4px 16px rgba(59,130,246,.35);transition:transform .2s;user-select:none;}
#xa-mini:hover{transform:scale(1.1);}
#xa-mini.show{display:flex;}
.xa-sec{font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:.5px;margin:2px 0 -2px;}
.xa-btnrow{display:flex;gap:8px;}
.xa-btnrow .xa-btn{flex:1;padding:8px 0;font-size:12px;letter-spacing:0;}
.xa-progress{font-size:11px;color:#2563eb;background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;
  padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xa-stats{font-size:11px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
  padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xa-loghead{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#6b7280;font-weight:700;}
.xa-loghead button{border:none;background:#f3f4f6;color:#6b7280;font-size:11px;border-radius:6px;padding:3px 10px;cursor:pointer;transition:background .2s;}
.xa-loghead button:hover{background:#e5e7eb;color:#374151;}
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

function restorePos(el) {
    try {
        const all = JSON.parse(GM_getValue(SK.panelPos, '{}'));
        const p = all && all[el.id];
        if (p && typeof p.l === 'number') { el.style.left = p.l + 'px'; el.style.top = p.t + 'px'; }
    } catch (e) {}
}
function savePos(el) {
    try {
        const all = JSON.parse(GM_getValue(SK.panelPos, '{}'));
        all[el.id] = { l: parseInt(el.style.left) || 0, t: parseInt(el.style.top) || 0 };
        GM_setValue(SK.panelPos, JSON.stringify(all));
    } catch (e) {}
}

function buildPanel() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'xa-panel';
    panel.innerHTML = `
<div class="xa-header"><span>芯位网课辅助 <span id="xa-ver" style="opacity:.85;font-size:11px;font-weight:500;"></span></span><button class="xa-min-btn" title="最小化">−</button></div>
<div class="xa-tabs">
  <div class="xa-tab active" data-tab="cfg">⚙ 挂机</div>
  <div class="xa-tab" data-tab="ai">🤖 答题</div>
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
    <select class="xa-input" id="xa-cx-speed" title="超星视频倍速（芯位不受影响）">
      <option value="1">超星倍速：1x（正常）</option>
      <option value="1.25">超星倍速：1.25x</option>
      <option value="1.5">超星倍速：1.5x</option>
      <option value="2">超星倍速：2x（平台上限）</option>
    </select>
  </div>
  <!-- Tab 2: AI 答题 -->
  <div class="xa-tab-pane" data-pane="ai">
    <div class="xa-status" id="xa-ai-status"><span class="xa-led" id="xa-ai-led"></span><span id="xa-ai-status-text">等待配置 Key</span></div>
    <div class="xa-progress" id="xa-progress">待机中</div>
    <div class="xa-stats" id="xa-stats">已答 0 · 缓存命中 0 · 已提交 0</div>
    <div class="xa-sec">🔌 接口配置</div>
    <div class="xa-ai-inputs">
      <input class="xa-input" id="xa-apikey" type="password" placeholder="API Key（sk-xxxxxxxx）" />
      <input class="xa-input" id="xa-apibase" type="text" placeholder="API Base（https://api.deepseek.com）" />
      <input class="xa-input" id="xa-model" type="text" placeholder="模型名（deepseek-chat / gpt-4o-mini）" />
    </div>
    <div class="xa-sec">🔍 检索增强</div>
    <div class="xa-ai-inputs">
      <select class="xa-input" id="xa-search-mode">
        <option value="off">检索：关闭</option>
        <option value="auto">检索：自动（事实/时事题）</option>
        <option value="always">检索：总是</option>
      </select>
      <select class="xa-input" id="xa-search-provider">
        <option value="duckduckgo">来源：DuckDuckGo（免密钥）</option>
        <option value="tavily">来源：Tavily（需 Key，更准）</option>
      </select>
      <input class="xa-input" id="xa-search-key" type="password" placeholder="Tavily API Key（DDG 可留空）" />
    </div>
    <div class="xa-btnrow">
      <button class="xa-btn xa-once" id="xa-answer-once" title="只答当前这一题">🎯 答题</button>
      <button class="xa-btn xa-stop" id="xa-cruise" title="打开本课程作业列表并自动逐份完成">🧭 巡航</button>
      <button class="xa-btn xa-stop" id="xa-test-grab" title="测试题目抓取">🧪 抓取</button>
      <button class="xa-btn xa-stop" id="xa-diagnose" title="dump 题目 DOM 结构">🩺 诊断</button>
    </div>
    <div class="xa-sec">⚡ 自动模式</div>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autoanswer-switch" title="开启自动答题+作业巡航"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">自动答题+跳题+作业巡航</span>
    </div>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autosubmit-switch" title="全部答完后自动提交作业（含未答题保护）"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">答完自动提交作业</span>
    </div>
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
  <div class="xa-loghead"><span>📜 运行日志</span><button id="xa-clear-log">清空</button></div>
  <div class="xa-ai-log" id="xa-ai-log"><div style="color:#94a3b8;">等待操作...</div></div>
</div>`;
    document.body.appendChild(panel);
    restorePos(panel);
    const ver = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) ? 'v' + GM_info.script.version : '';
    const verEl = panel.querySelector('#xa-ver');
    if (verEl && ver) verEl.textContent = ver;

    mini = document.createElement('div');
    mini.id = 'xa-mini';
    mini.textContent = '芯';
    document.body.appendChild(mini);
    restorePos(mini);
}

function makeDraggable(dragEl, handleEl) {
    let dragging = false, moved = false, startX, startY, origLeft, origTop;
    handleEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, .xa-min-btn, .xa-switch, input, .xa-btn')) return;
        e.preventDefault();
        dragging = true;
        moved = false;
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
        if (dx || dy) moved = true;
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
        if (moved) savePos(dragEl);
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

    qsa('.xa-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            qsa('.xa-tab, .xa-tab-pane').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            const pane = panel.querySelector('[data-pane="' + tab.dataset.tab + '"]');
            if (pane) pane.classList.add('active');
        });
    });

    $('.xa-min-btn').addEventListener('click', () => {
        panel.classList.add('xa-hidden');
        mini.classList.add('show');
        GM_setValue(SK.minimized, true);
    });
    mini.addEventListener('click', () => {
        panel.classList.remove('xa-hidden');
        mini.classList.remove('show');
        GM_setValue(SK.minimized, false);
    });

    const saveInput = (key, el) => {
        const save = () => {
            conf[key] = el.value.trim();
            GM_setValue(SK[key], conf[key]);
            if (XIA_AI._cfgError) { XIA_AI._cfgError = null; XIA_AI.log('配置已更新，自动答题恢复', 'ok'); }
        };
        el.addEventListener('change', save);
        el.addEventListener('blur', save);
    };
    saveInput('apiKey', apikeyInput);
    saveInput('apiBase', apibaseInput);
    saveInput('model', modelInput);
    saveInput('searchMode', searchModeInput);
    saveInput('searchProvider', searchProviderInput);
    saveInput('searchApiKey', searchApiKeyInput);

    apikeyInput.addEventListener('input', () => {
        conf.apiKey = apikeyInput.value.trim();
        setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');
    });

    apikeyInput.value = conf.apiKey;
    apibaseInput.value = conf.apiBase;
    modelInput.value = conf.model;
    searchModeInput.value = conf.searchMode;
    searchProviderInput.value = conf.searchProvider;
    searchApiKeyInput.value = conf.searchApiKey;
    setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');

    autoSwitch.addEventListener('click', () => {
        conf.autoAnswer = !conf.autoAnswer;
        GM_setValue(SK.autoAnswer, conf.autoAnswer);
        refreshAISwitch();
    });
    function refreshAISwitch() {
        if (conf.autoAnswer) {
            autoSwitch.classList.add('on');
            XIA_AI.log('自动答题已开启（每 ' + CFG.INTERVAL + 's 扫描页面）', 'ok');
            startAIScan();
        } else {
            autoSwitch.classList.remove('on');
            stopAIScan();
            XIA_AI.log('自动答题已关闭', 'info');
        }
    }

    const submitSwitch = $('#xa-autosubmit-switch');
    submitSwitch.addEventListener('click', () => {
        conf.autoSubmit = !conf.autoSubmit;
        GM_setValue(SK.autoSubmit, conf.autoSubmit);
        refreshSubmitSwitch();
    });
    function refreshSubmitSwitch() {
        if (conf.autoSubmit) {
            submitSwitch.classList.add('on');
            XIA_AI.log('答完自动提交已开启（有未答题会自动取消提交）', 'ok');
        } else {
            submitSwitch.classList.remove('on');
            XIA_AI.log('答完自动提交已关闭', 'info');
        }
    }

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
        GM_setValue(SK.autoPlay, conf.autoPlay);
        refreshPlaySwitch();
    });

    const cxSpeedInput = $('#xa-cx-speed');
    if (cxSpeedInput) {
        cxSpeedInput.value = String(conf.cxSpeed);
        cxSpeedInput.addEventListener('change', () => {
            conf.cxSpeed = parseFloat(cxSpeedInput.value) || 1;
            GM_setValue(SK.cxSpeed, String(conf.cxSpeed));
            XIA_AI.log('超星倍速已设为 ' + conf.cxSpeed + 'x（芯位视频不受影响）', 'ok');
        });
    }

    $('#xa-answer-once').addEventListener('click', e => {
        const b = e.currentTarget;
        b.disabled = true;
        XIA_AI.answerOnce();
        setTimeout(() => { b.disabled = false; }, 3000);
    });

    $('#xa-cruise').addEventListener('click', () => { XIA_AI.cruise(); });
    $('#xa-test-grab').addEventListener('click', () => { XIA_AI.testGrab(); });
    $('#xa-diagnose').addEventListener('click', () => { XIA_AI.diagnose(); });

    $('#xa-clear-log').addEventListener('click', () => {
        XIA_AI.logLines = [];
        const box = document.getElementById('xa-ai-log');
        if (box) box.innerHTML = '<div style="color:#94a3b8;">日志已清空</div>';
    });

    const muteBtn = $('.xa-mute');
    muteBtn.addEventListener('click', () => {
        muteEnabled = !muteEnabled;
        if (muteEnabled) { muteAll(); muteBtn.classList.remove('muted'); muteBtn.textContent = '🔇 关闭静音'; }
        else { document.querySelectorAll('video').forEach(v => { if (v.muted) v.muted = false; }); muteBtn.classList.add('muted'); muteBtn.textContent = '🔊 开启声音'; }
    });

    XIA_AI.bump(); // 初始化统计显示
    refreshPlaySwitch();
    refreshAISwitch();
    refreshSubmitSwitch();
}


let scriptStart = Date.now();
let cooldownUntil = 0;
let pptSince = 0;
let tick = 0;
let consecutiveJumps = 0;
let mainLoopId = null;

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

    if (isStaticOrPptSection()) {
        if (pptSince === 0) pptSince = now;
        if (now - pptSince > CFG.PPT_DWELL * 1000) { console.log('[芯位] PPT/静态课件停留' + CFG.PPT_DWELL + 's → 完成'); return true; }
        return false;
    }
    pptSince = 0;

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
    if (XA_SITE === 'chaoxing') { CX.tick(); return; } // 超星：视频由播放器帧驱动，top 只静音兜底
    muteAll();
    keepPlay();
    if (tick % 10 === 0) {
        const active = document.querySelector('li.el-menu-item.is-active');
        const cur = active ? (active.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20) : '(无)';
        const cd = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        console.log('[芯位] #' + tick + ' | 当前: "' + cur + '" | cd=' + cd + 's | 连跳=' + consecutiveJumps);
    }
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

if (window.xaScriptLoaded) return;
window.xaScriptLoaded = true;

if (!XA_SITE) return;

if (window.self !== window.top) {
    if (XA_SITE === 'chaoxing' && CX.isVideoIframe()) CX.startVideoFrameLoop();
    return;
}

loadCfg();

if (XA_SITE === 'chaoxing') CX.bindStudyTop();

buildPanel();
makeDraggable(panel, panel.querySelector('.xa-header'));
makeDraggable(mini, mini);
bindUI();

if (GM_getValue(SK.minimized, false)) {
    panel.classList.add('xa-hidden');
    mini.classList.add('show');
}

muteAll();

XIA_AI.log('本脚本以 MIT 协议开源发布，详见仓库 LICENSE。请遵守平台规则与当地法律使用。', 'info');

initPopupAutoReload();

console.log('[XinweiAutoStudy] 已加载');

})();
