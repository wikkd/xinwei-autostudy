// ==UserScript==
// @name         XF芯位
// @namespace    https://scriptcat.org/users/xia
// @version      5.07
// @description  基于大语言模型的前端文本分析与在线学习辅助
// @author       XF
// @icon         https://ts1.tc.mm.bing.net/th/id/OIP-C.lYLQ3le89_SgCj3Fsht4TAAAAA?r=0&rs=1&pid=ImgDetMain&o=7&rm=3
// @match        https://www.beeline-ai.com/*
// @match        https://beeline-ai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

// 📢 免责声明 (Disclaimer)
// 本脚本仅用于个人学习、计算机技术研究及自动化脚本开发交流，请勿用于任何商业用途或非法途径。
// 使用本脚本所产生的一切后果
// 均由使用者本人自行承担，作者不承担任何明示或暗示的法律责任及连带责任。
// 本脚本自定义的 AI 答题功能，其答案均由大语言模型生成，作者无法保证答案的 100% 正确率。
// 因 AI 误判、答错导致的考试不及格或作业低分，请使用者自行负责。
// 平台（网课网站）规则可能随时更新，脚本随时可能失效。安装即代表您已阅读并自愿接受本声明的所有条款。

(function() {
    'use strict';

    // 防重复注入（同一页面脚本可能被加载多次）
    if (window.xiaScriptLoaded) return;
    window.xiaScriptLoaded = true;

    // ==================== 免责声明（首次运行弹窗） ====================
    if (!GM_getValue('xia_disclaimer_accepted', false)) {
        const agreed = confirm(
            '📢 免责声明 (Disclaimer)\n\n' +
            '本脚本仅用于个人学习、计算机技术研究及自动化脚本开发交流，请勿用于任何商业用途或非法途径。\n\n' +
            '使用本脚本所产生的一切后果（包括但不限于被平台检测、封号、网课成绩清零、重修、通报批评等处分），' +
            '均由使用者本人自行承担，作者不承担任何明示或暗示的法律责任及连带责任。\n\n' +
            '本脚本自定义的 AI 答题功能，其答案均由大语言模型生成，作者无法保证答案的 100% 正确率。' +
            '因 AI 误判、答错导致的考试不及格或作业低分，请使用者自行负责。\n\n' +
            '平台（网课网站）规则可能随时更新，脚本随时可能失效。安装即代表您已阅读并自愿接受本声明的所有条款。\n\n' +
            '点击「确定」同意以上条款，点击「取消」则终止脚本运行。'
        );
        if (!agreed) {
            alert('您已拒绝免责声明，脚本将不会运行。');
            return;
        }
        GM_setValue('xia_disclaimer_accepted', true);
    }

    // ==================== 全局配置 ====================
    const CFG = {
        PPT_TIMEOUT: 60,
        MIN_WATCH: 30,
        COOLDOWN: 15,
        INTERVAL: 3,              // 主循环/题目扫描间隔（秒）

        DEFAULT_API_BASE: 'https://api.deepseek.com',
        DEFAULT_MODEL: 'deepseek-chat',

        DEFAULT_SEARCH_PROVIDER: 'duckduckgo', // duckduckgo(免密钥) / tavily(需Key)
        DEFAULT_SEARCH_MODE: 'auto',            // off / auto / always
        SEARCH_MAX_CHARS: 3000,
    };

    const scriptStart = Date.now();
    let muteEnabled = true;
    let conf = {};

    // 持久化配置
    const STORAGE_KEYS = { apiKey: 'xia_apikey', apiBase: 'xia_apibase', model: 'xia_model', autoAnswer: 'xia_autoanswer', autoPlay: 'xia_autoplay', searchProvider: 'xia_search_provider', searchApiKey: 'xia_search_key', searchMode: 'xia_search_mode' };

    function loadCfg() {
        conf = {
            apiKey: GM_getValue(STORAGE_KEYS.apiKey, ''),
            apiBase: GM_getValue(STORAGE_KEYS.apiBase, CFG.DEFAULT_API_BASE),
            model: GM_getValue(STORAGE_KEYS.model, CFG.DEFAULT_MODEL),
            autoAnswer: GM_getValue(STORAGE_KEYS.autoAnswer, false) === true || GM_getValue(STORAGE_KEYS.autoAnswer, false) === 'true',
            autoPlay: GM_getValue(STORAGE_KEYS.autoPlay, false) === true || GM_getValue(STORAGE_KEYS.autoPlay, false) === 'true',
            searchProvider: GM_getValue(STORAGE_KEYS.searchProvider, CFG.DEFAULT_SEARCH_PROVIDER),
            searchApiKey: GM_getValue(STORAGE_KEYS.searchApiKey, ''),
            searchMode: GM_getValue(STORAGE_KEYS.searchMode, CFG.DEFAULT_SEARCH_MODE),
        };
    }
    loadCfg();

    // ==================== 工具函数 ====================
    function visible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        return true;
    }

    function muteAll() {
        document.querySelectorAll('video').forEach(v => { if (muteEnabled && !v.muted) { v.muted = true; } });
    }

    function keepPlay() {
        document.querySelectorAll('video, audio').forEach(v => {
            if (v.paused && !v.ended && v.readyState >= 2) {
                try { v.play().catch(() => {}); } catch(e) {}
            }
        });

        try {
            Object.defineProperty(document, 'hidden', { get: () => false });
        } catch(e) {}
        try {
            Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
        } catch(e) {}
        try {
            document.hasFocus = function() { return true; };
        } catch(e) {}

        const _0xda = Math.random;
        const _0xdb = function(a, b) { return Math.floor(_0xda() * (b - a) + a); };
        const _0xdc = _0xdb(50, window.innerWidth - 50 || 200);
        const _0xdd = _0xdb(50, window.innerHeight - 50 || 200);

        try {
            document.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, cancelable: true, view: window,
                clientX: _0xdc, clientY: _0xdd,
                movementX: _0xdb(-5, 5), movementY: _0xdb(-5, 5)
            }));
        } catch(e) {}

        if (_0xda() > 0.75) {
            try {
                const _0xde = document.elementFromPoint(_0xdc, _0xdd) || document.body;
                _0xde.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: _0xdc, clientY: _0xdd, button: 0
                }));
            } catch(e) {}
        }

        if (_0xda() > 0.88) {
            try {
                const _0xdf = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp'][_0xdb(0, 6)];
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: _0xdf, bubbles: true, cancelable: true
                }));
            } catch(e) {}
        }

        if (_0xda() > 0.65) {
            try {
                window.scrollBy({ top: _0xdb(-15, 15), left: _0xdb(-8, 8), behavior: 'instant' });
            } catch(e) {}
        }
    }

    function ensureVisible(el) {
        if (!el) return;
        try {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        } catch (e) {
            try { el.scrollIntoView(); } catch (e2) {}
        }
        let _0xv = el.parentElement;
        let _0xsteps = 0;
        while (_0xv && _0xsteps < 6) {
            if (_0xv.scrollHeight > _0xv.clientHeight) {
                try {
                    _0xv.scrollTop = el.offsetTop - _0xv.clientHeight / 2;
                } catch (e) {}
            }
            _0xv = _0xv.parentElement;
            _0xsteps++;
        }
    }

    function _0x1a(activeNode) {
        let _0xd0 = activeNode;
        const _0xd1 = 80;
        for (let _0xd2 = 0; _0xd2 < _0xd1; _0xd2++) {
            let _0xd3 = _0xd0.nextElementSibling;
            if (!_0xd3 && _0xd0.parentElement) {
                let _0xd4 = _0xd0.parentElement;
                while (_0xd4 && !_0xd4.nextElementSibling) { _0xd4 = _0xd4.parentElement; }
                if (_0xd4) _0xd3 = _0xd4.nextElementSibling;
            }
            if (!_0xd3) break;
            if (_0xd3.querySelector('.el-sub-menu__title') || (_0xd3.textContent || '').trim().includes('第') && !_0xd3.querySelector('li.el-menu-item')) {
            }
            if (_0xd3.matches && _0xd3.matches('.el-sub-menu__title, .el-menu-item-group__title')) {
                _0xd0 = _0xd3;
                continue;
            }
            const _0xd5 = _0xd3.querySelectorAll ? _0xd3.querySelectorAll('li.el-menu-item') : [];
            if (_0xd5.length > 0) {
                let _0xd9 = null;
                for (const _0xd6 of _0xd5) {
                    const _0xd7 = (_0xd6.textContent || '').trim();
                    if (_0xd7.length === 0) continue;
                    const _0xd8 = /[\d:：]/.test(_0xd7) || _0xd6.querySelector('.time, .duration, [class*="time"]');
                    if (!_0xd8) continue;
                    if (_0xd6.offsetHeight > 0 && _0xd6.offsetWidth > 0) {
                        _0xd9 = _0xd6;
                        break;
                    }
                }
                if (_0xd9) return _0xd9;
            } else if (_0xd3.matches && _0xd3.matches('li.el-menu-item')) {
                return _0xd3;
            }
            _0xd0 = _0xd3;
        }
        return null;
    }

    // ==================== AI 答题核心 ====================
    // 注：名字叫 XIA_AI 而非 AI，避免与页面其他脚本已有的 AI 标识符冲突
    const XIA_AI = {
        lastQuestionHash: '',
        answering: false,
        logLines: [],

        log(msg, type) {
            const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
            XIA_AI.logLines.push({ text: line, type: type || 'info' });
            if (XIA_AI.logLines.length > 80) XIA_AI.logLines.shift();
            const box = document.getElementById('xia-ai-log');
            if (box) {
                box.innerHTML = XIA_AI.logLines.slice(-30).map(l => {
                    const col = l.type === 'error' ? '#dc2626' : l.type === 'ok' ? '#059669' : l.type === 'ai' ? '#7c3aed' : '#374151';
                    return '<div style="color:' + col + ';line-height:1.55;">' + l.text.replace(/</g,'&lt;') + '</div>';
                }).join('');
                box.scrollTop = box.scrollHeight;
            }
            console.log('[XIA] ' + msg);
        },

        // 题目抓取（Element UI div.question + el-radio/el-checkbox 专用，带通用兜底）
        grabQuestion() {
            const _0x10 = document.querySelector('div.question');
            if (_0x10 && visible(_0x10)) {
                const _0x14 = _0x10.querySelector('.topic-title, .content .topic-title-box, .content p, .question p');
                let _0x11 = (_0x14 ? (_0x14.textContent || '') : (_0x10.textContent || '')).trim().replace(/\s+/g, ' ');
                _0x11 = _0x11.replace(/^\s*\d+[\.\.\s、]*/, '').replace(/\s*单选|\s*多选\s*/g, '').replace(/\s*\d+\s*分\s*/g, '').trim();
                const _0x12 = _0x10.querySelector('.common-duoxuan-tag') !== null;
                const _0x13 = _0x10.querySelector('.common-zhuguan-tag') !== null;
                if (_0x13 && _0x11) {
                    if (_0x11.length < 5 || /^主观/.test(_0x11)) {
                        const _0x15 = document.querySelector('.topic-title-box, .topic-title, [class*="topic-title-box"]');
                        if (_0x15) {
                            _0x11 = (_0x15.textContent || '').trim().replace(/\s+/g, ' ');
                            if (_0x11) _0x11 = _0x11.replace(/^\s*\d+[\.\s、]*/, '').trim();
                        }
                    }
                    if (_0x11 && _0x11.length > 3) {
                        const _0x16 = _0x11.slice(0, 300);
                        return { question: _0x16, options: [], node: _0x10, type: 'subjective', raw: _0x11 };
                    }
                }
                const _0x17 = [];
                const _0x18 = _0x10.querySelector('.el-radio-group, .el-checkbox-group, [class*="radio-group"], [class*="checkbox-group"], [class*="option-group"]') || _0x10;
                _0x18.querySelectorAll('label.el-radio, label.el-checkbox, label').forEach(_0x19 => {
                    if (!visible(_0x19)) return;
                    const _0x1a = _0x19.querySelector('input[type="radio"], input[type="checkbox"]');
                    const _0x1b = _0x19.querySelector('.option-content, .el-radio__label .label, .el-radio__label, .el-checkbox__label, p.label, p');
                    const _0x1c = _0x1a && _0x1a.value ? String(_0x1a.value).toUpperCase().match(/[A-H]/) : null;
                    if (!_0x1c) return;
                    const _0x1d = _0x1c[0];
                    if (_0x17.find(_0x2a => _0x2a.letter === _0x1d)) return;
                    const _0x1e = _0x1b ? (_0x1b.textContent || '').trim() : (_0x19.textContent || '').replace(/^[A-H][\.\.\s]*/, '').trim();
                    _0x17.push({ letter: _0x1d, text: _0x1e.slice(0, 120), node: _0x19 });
                });
                if (_0x11 && _0x17.length > 0) {
                    const _0x16 = _0x11.replace(/^\s*\d+[\.\.\s、]*/, '').trim().slice(0, 300);
                    return { question: _0x16, options: _0x17, node: _0x10, type: _0x12 ? 'multi' : 'single', raw: _0x11 };
                }
            }
            const _0x1f = document.querySelector('.common-zhuguan-tag');
            if (_0x1f) {
                const _0x14 = document.querySelector('.topic-title-box, .topic-title, [class*="topic-title-box"]');
                let _0x11 = '';
                if (_0x14) {
                    _0x11 = (_0x14.textContent || '').trim().replace(/\s+/g, ' ');
                    _0x11 = _0x11.replace(/^\s*\d+[\.\s、]*/, '').trim();
                }
                console.log('[XIA-grab] 主观题标题:', _0x11.slice(0,80));
                if (_0x11 && _0x11.length > 3) {
                    return { question: _0x11.slice(0, 300), options: [], node: _0x1f, type: 'subjective', raw: _0x11 };
                }
            }
            const _0x20 = [];
            const _0x21 = (_0x2b) => { if (_0x2b && visible(_0x2b) && _0x2b.offsetHeight > 20) _0x20.push(_0x2b); };
            document.querySelectorAll('form, [class*="question"], [class*="quiz"], [class*="Question"], [class*="题目"], [data-question]').forEach(_0x21);
            document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="popup"], [role="dialog"]').forEach(_0x2c => {
                if (!visible(_0x2c)) return;
                _0x2c.querySelectorAll('p, h1, h2, h3, h4, h5, div').forEach(_0x2d => {
                    if (_0x2d.children.length <= 3 && (_0x2d.textContent || '').trim().length >= 4 && visible(_0x2d)) _0x20.push(_0x2d);
                });
            });
            if (_0x20.length === 0) return null;
            let _0x22 = '', _0x23 = null, _0x24 = 0;
            for (const _0x25 of _0x20) {
                const _0x26 = (_0x25.textContent || '').trim().replace(/\s+/g, ' ');
                if (_0x26.length < 6 || _0x26.length > 800) continue;
                let _0x27 = 0;
                if (/[?？]/.test(_0x26)) _0x27 += 4;
                if (/选项|[ABCD][．.\s]|[Aa]\s*\.|[Bb]\s*\./.test(_0x26)) _0x27 += 3;
                if (/题目|问题|题干|请选择|请回答|单选|多选|判断/.test(_0x26)) _0x27 += 5;
                if (_0x25.querySelector('input[type="radio"], input[type="checkbox"], button, [role="radio"]')) _0x27 += 3;
                if (_0x27 > _0x24) { _0x24 = _0x27; _0x22 = _0x26; _0x23 = _0x25; }
            }
            if (!_0x22) return null;
            const _0x17 = [];
            _0x23.querySelectorAll('label, [class*="option"], [class*="choice"], [class*="选项"], li, [role="radio"]').forEach(_0x28 => {
                if (!visible(_0x28)) return;
                const _0x26 = (_0x28.textContent || '').trim().replace(/\s+/g, ' ');
                if (_0x26.length < 2) return;
                const _0x29 = _0x26.match(/^([A-H])[\s\.．、\:：](.+)$/);
                if (_0x29) {
                    const _0x1d = _0x29[1].toUpperCase();
                    if (!_0x17.find(_0x2a => _0x2a.letter === _0x1d)) _0x17.push({ letter: _0x1d, text: _0x29[2].trim().slice(0, 120), node: _0x28 });
                }
            });
            if (_0x17.length === 0) {
                const _0x2e = ['A', 'B', 'C', 'D', 'E', 'F'];
                _0x23.querySelectorAll('button, span, div, p, label').forEach(_0x28 => {
                    if (!visible(_0x28)) return;
                    const _0x2f = (_0x28.textContent || '').trim();
                    for (const _0x1d of _0x2e) {
                        if (_0x2f === _0x1d || _0x2f.startsWith(_0x1d + '.') || _0x2f.startsWith(_0x1d + '．') || _0x2f.startsWith(_0x1d + ' ')) {
                            if (!_0x17.find(_0x2a => _0x2a.letter === _0x1d)) _0x17.push({ letter: _0x1d, text: _0x2f.slice(0, 120), node: _0x28 });
                        }
                    }
                });
            }
            if (_0x17.length === 0) return null;
            let _0x11 = _0x22;
            _0x17.forEach(_0x2a => { _0x11 = _0x11.replace(new RegExp(_0x2a.letter + '[\s\.．\:：].*?', 'g'), ''); });
            _0x11 = _0x11.replace(/\s+/g, ' ').trim().slice(0, 300);
            return { question: _0x11, options: _0x17, node: _0x23, raw: _0x22 };
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
            if (type === 'subjective') base = '用一句话或100字内直接回答以下主观题，禁止多余废话。\n\n题目：' + question;
            else if (type === 'multi') base = '你是一个答题助手。请分析以下多选题，输出所有正确选项的字母，多个字母直接拼接（如 ABC），不要有任何废话。\n\n题目：' + question + '\n\n选项：' + opt;
            else base = '你是一个答题助手。请分析以下题目和选项，直接输出正确选项的字母（如 A 或 B），只输出一个字母，不要有任何废话、不要解释、不要换行。\n\n题目：' + question + '\n\n选项：' + opt;
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
                        timeout: 15000,
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
                        onerror: () => { XIA_AI.log('检索网络错误', 'error'); done(''); },
                        ontimeout: () => { XIA_AI.log('检索超时', 'error'); done(''); },
                    });
                }
            } catch (e) { XIA_AI.log('检索异常: ' + e.message, 'error'); done(''); }
        },


        // 调用 AI 接口（支持单选/多选）
        callAI(question, options, type, onResult) {
            const _0xf0 = conf.apiKey;
            if (!_0xf0) { XIA_AI.log('未配置 API Key', 'error'); onResult(null); return; }
            const _0xf1 = conf.apiBase || CFG.DEFAULT_API_BASE;
            const _0xf2 = conf.model || CFG.DEFAULT_MODEL;
            const _0xf3 = options.map(_0x8b => _0x8b.letter + '. ' + _0x8b.text).join(' ');
            const _0xf4 = type === 'multi';
            const _0xf5 = type === 'subjective';
            let _0xf7 = _0xf1.replace(/\/+$/, '');
            const _0xf8 = /\/v\d+\/?$/.test(_0xf7) ? (_0xf7 + '/chat/completions') : (_0xf7 + '/v1/chat/completions');
            XIA_AI.log('请求 ' + _0xf8 + ' | model=' + _0xf2 + ' | 题目长度=' + question.length, 'ai');

            // 检索增强：先搜后答
            const needSearch = conf.searchMode === 'always' || (conf.searchMode === 'auto' && XIA_AI.needsSearch(question, type));
            const doLLM = (ctx) => {
                const _0xf6 = XIA_AI.buildPrompt(question, options, type, ctx);
                XIA_AI.log('Prompt摘要: ' + _0xf6.slice(0, 80), 'ai');
                try {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: _0xf8,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + _0xf0,
                        },
                        data: JSON.stringify({
                            model: _0xf2,
                            messages: [{ role: 'user', content: _0xf6 }],
                            temperature: 0.3,
                            max_tokens: _0xf5 ? 300 : 16,
                        }),
                        timeout: _0xf5 ? 30000 : 20000,
                        onload: (_0xf9) => {
                            try {
                                const _0xfa = JSON.parse(_0xf9.responseText);
                                const _0xfb = _0xfa.choices && _0xfa.choices[0] && _0xfa.choices[0].message && _0xfa.choices[0].message.content;
                                if (!_0xfb) { XIA_AI.log('AI 响应异常: ' + _0xf9.responseText.slice(0, 200), 'error'); onResult(null); return; }
                                let _0xfc;
                                if (_0xf5) {
                                    _0xfc = _0xfb.trim();
                                } else {
                                    const _0xfd = _0xfb.trim().match(/[A-H]/g);
                                    if (!_0xfd) { XIA_AI.log('AI 返回无法解析: "' + _0xfb.trim().slice(0, 80) + '"', 'error'); onResult(null); return; }
                                    _0xfc = _0xfd.filter((_0xfe, _0xff, _0x10a) => _0x10a.indexOf(_0xfe) === _0xff).join('');
                                }
                                XIA_AI.log('AI 答案 -> ' + _0xfc.slice(0, 100), 'ok');
                                onResult(_0xfc);
                            } catch (e) {
                                XIA_AI.log('解析失败: ' + e.message + ' | 原始: ' + (_0xf9.responseText || '').slice(0, 200), 'error');
                                onResult(null);
                            }
                        },
                        onerror: (e) => { XIA_AI.log('网络错误: ' + (e.error || JSON.stringify(e)), 'error'); onResult(null); },
                        ontimeout: () => { XIA_AI.log('请求超时', 'error'); onResult(null); },
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

        // ====== 答题引擎 v5 ======
        _0xee: "本算法由xia首发于GreasyFork",
        forceClick(el) {
            if (!el) return;
            console.log('[XIA-forceClick] 目标:', el.tagName, el.className?.slice(0, 40), el.textContent?.slice(0, 30));
            try { el.click(); } catch(e) {}
            try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch(e) {}
            try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
            const _0x31 = el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
            if (_0x31) {
                console.log('[XIA-forceClick] 内部input:', _0x31.value);
                try { _0x31.checked = true; } catch(e) {}
                try { _0x31.click(); } catch(e) {}
                try { _0x31.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch(e) {}
                try { _0x31.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
            }
            const _0x32 = el.closest && el.closest('.el-radio-group, .el-checkbox-group, [role="radiogroup"], [role="group"]');
            if (_0x32 && _0x31) {
                try { _0x32.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
                try { _0x32.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
            }
        },

        clickAnswer(letters) {
            console.log('[XIA-clickAnswer] 开始点击选项:', letters);
            const _0x40 = document.querySelector('div.question');
            if (!_0x40) { XIA_AI.log('页面已无题目容器，无法点击', 'error'); return false; }
            const _0x41 = _0x40.querySelector('.common-duoxuan-tag') !== null;
            console.log('[XIA-clickAnswer] 题目类型:', _0x41 ? '多选' : '单选');
            const _0x42 = letters.split('');
            let _0x43 = true;
            for (const _0x44 of _0x42) {
                const _0x45 = _0x40.querySelectorAll('label.el-radio, label.el-checkbox');
                let _0x46 = null;
                _0x45.forEach(_0x4a => {
                    const _0x47 = _0x4a.querySelector('input[type="radio"], input[type="checkbox"]');
                    if (_0x47 && String(_0x47.value).toUpperCase() === _0x44) _0x46 = _0x4a;
                });
                if (!_0x46) {
                    const _0x48 = _0x40.querySelector('input[type="radio"][value="' + _0x44 + '"], input[type="radio"][value="' + _0x44.toLowerCase() + '"], input[type="checkbox"][value="' + _0x44 + '"], input[type="checkbox"][value="' + _0x44.toLowerCase() + '"]');
                    if (_0x48) {
                        XIA_AI.forceClick(_0x48);
                        XIA_AI.log('点击选项(直接input) ' + _0x44, 'ok');
                    } else {
                        XIA_AI.log('找不到选项 ' + _0x44 + ' 的DOM节点', 'error');
                        _0x43 = false;
                    }
                } else {
                    if (_0x41) {
                        XIA_AI.log('多选请使用自动答题模式（已跳过此点击）', 'info');
                        _0x43 = false;
                        continue;
                    } else {
                        const _0x49 = _0x46.querySelector('.el-radio__inner, .el-checkbox__inner');
                        if (_0x49) { XIA_AI.forceClick(_0x49); }
                        XIA_AI.forceClick(_0x46);
                    }
                    XIA_AI.log('点击选项 ' + _0x44, 'ok');
                }
            }
            return _0x43;
        },

        clickMultiAnswer(letters, onDone) {
            console.log('[XIA-multi] 开始逐项点击:', letters);
            const _0x50 = document.querySelector('div.question');
            if (!_0x50) { console.log('[XIA-multi] 无题目容器'); if (onDone) onDone(); return; }
            const _0x51 = letters.toUpperCase().split('');
            if (_0x51.length === 0) { if (onDone) onDone(); return; }
            let _0x52 = 0;
            const _0x53 = () => {
                if (_0x52 >= _0x51.length) {
                    XIA_AI.log('多选全部点击完毕', 'ok');
                    if (onDone) onDone();
                    return;
                }
                const _0x54 = _0x51[_0x52++];
                const _0x55 = _0x50.querySelectorAll('label.el-radio, label.el-checkbox');
                let _0x56 = null;
                _0x55.forEach(_0x57 => {
                    const _0x58 = _0x57.querySelector('input[type="radio"], input[type="checkbox"]');
                    if (_0x58 && String(_0x58.value).toUpperCase() === _0x54) _0x56 = { label: _0x57, input: _0x58 };
                });
                if (_0x56) {
                    _0x56.input.checked = true;
                    _0x56.label.classList.add('is-checked');
                    const _0x59 = _0x56.label.querySelector('.el-radio__input, .el-checkbox__input');
                    if (_0x59) _0x59.classList.add('is-checked');
                    try { _0x56.input.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
                    try {
                        const _0x5a = _0x56.label.__vue__;
                        if (_0x5a) {
                            _0x5a.$emit('input', _0x56.input.type === 'checkbox' ? true : _0x56.input.value);
                            _0x5a.$emit('change', _0x56.input.type === 'checkbox' ? true : _0x56.input.value);
                        }
                    } catch(e) {}
                    XIA_AI.log('多选点击: ' + _0x54, 'ok');
                } else {
                    XIA_AI.log('多选找不到: ' + _0x54, 'error');
                }
                setTimeout(_0x53, 350);
            };
            _0x53();
        },

        answerSubjective(answer, onDone) {
            const _0x60 = document.querySelector('[data-slate-editor]') || document.querySelector('div.w-e-text-container [contenteditable="true"]') || document.querySelector('[contenteditable="true"]');
            if (!_0x60) {
                XIA_AI.log('未找到主观题编辑器', 'error');
                if (onDone) onDone();
                return;
            }
            try { _0x60.focus(); } catch(e) {}
            try { _0x60.click(); } catch(e) {}
            try { _0x60.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch(e) {}
            try { _0x60.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch(e) {}
            try { _0x60.dispatchEvent(new FocusEvent('focus', { bubbles: true })); } catch(e) {}
            setTimeout(() => {
                const _0x61 = window.getSelection();
                _0x61.removeAllRanges();
                const _0x62 = document.createRange();
                _0x62.selectNodeContents(_0x60);
                _0x61.addRange(_0x62);
                try {
                    _0x60.dispatchEvent(new InputEvent('beforeinput', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: answer,
                    }));
                } catch(e) {
                    try { document.execCommand('insertText', false, answer); } catch(e2) {}
                }
                try { _0x60.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
                XIA_AI.log('主观题答案已填入: ' + answer.slice(0, 60) + (answer.length > 60 ? '...' : ''), 'ok');
                if (onDone) onDone();
            }, 200);
        },

        answerOnce() {
            if (XIA_AI.answeringOnce) { XIA_AI.log('正在执行单次答题，请稍候', 'error'); return; }
            XIA_AI.answeringOnce = true;
            const _0x70 = XIA_AI.grabQuestion();
            if (!_0x70 || !_0x70.question) {
                XIA_AI.log('当前页面未找到可答题目', 'error');
                XIA_AI.answeringOnce = false;
                return;
            }
            if (_0x70.type !== 'subjective' && _0x70.options.length === 0) {
                XIA_AI.log('当前页面未找到可答题目（无选项）', 'error');
                XIA_AI.answeringOnce = false;
                return;
            }
            XIA_AI.log('🎯 单次答题: ' + _0x70.question.slice(0, 60) + (_0x70.question.length > 60 ? '...' : ''), 'ok');
            XIA_AI.callAI(_0x70.question, _0x70.options, _0x70.type || 'single', (answer) => {
                if (answer) {
                    if (_0x70.type === 'subjective') {
                        XIA_AI.answerSubjective(answer, () => {
                            XIA_AI.log('单次答题（主观）完成', 'ok');
                            XIA_AI.answeringOnce = false;
                        });
                        return;
                    }
                    const _0x71 = document.querySelector('div.question .common-duoxuan-tag') !== null;
                    if (_0x71) {
                        XIA_AI.clickMultiAnswer(answer, () => {
                            XIA_AI.log('单次答题（多选）完成', 'ok');
                            XIA_AI.answeringOnce = false;
                        });
                        return;
                    } else if (_0x70.type === 'multi') {
                        XIA_AI.clickMultiAnswer(answer, () => {
                            XIA_AI.log('单次答题（多选）完成', 'ok');
                            XIA_AI.answeringOnce = false;
                        });
                        return;
                    } else {
                        XIA_AI.clickAnswer(answer);
                    }
                }
                XIA_AI.answeringOnce = false;
            });
        },

        scan() {
            if (!conf.autoAnswer) { console.log('[XIA-scan] autoAnswer=false, 跳过'); return; }
            if (XIA_AI.answering) { console.log('[XIA-scan] answering=true, 跳过'); return; }
            const _0x80 = XIA_AI.grabQuestion();
            if (!_0x80) { console.log('[XIA-scan] grabQuestion()=null'); return; }
            if (!_0x80.question) { console.log('[XIA-scan] question为空, raw=', (_0x80.raw||'').slice(0,80)); return; }
            if (_0x80.type !== 'subjective' && _0x80.options.length === 0) { console.log('[XIA-scan] 选项为0, question=', _0x80.question.slice(0,60)); return; }
            const _0x81 = _0x80.question.slice(0, 100) + '|' + (_0x80.options.length > 0 ? _0x80.options.map(_0x8b => _0x8b.letter + _0x8b.text.slice(0, 30)).join(',') : 'subj');
            if (_0x81 === XIA_AI.lastQuestionHash) { console.log('[XIA-scan] hash去重, 跳过'); return; }
            const _0x82 = document.querySelector('div.question input[type="radio"]:checked, div.question input[type="checkbox"]:checked, .el-radio.is-checked, .el-checkbox.is-checked, div.question .is-checked');
            const _0x83 = _0x80.type === 'subjective' && document.querySelector('div.w-e-text-container [data-slate-editor]')?.textContent?.trim()?.length > 0;
            if (_0x82 || _0x83) {
                if (_0x80.type === 'multi') {
                    console.log('[XIA-scan] 多选题已有选中项，不自动跳题');
                    return;
                }
                const _0x8c = Date.now();
                if (XIA_AI._lastNav && (_0x8c - XIA_AI._lastNav) < 2500) {
                    console.log('[XIA-scan] 跳题冷却中，跳过');
                    return;
                }
                XIA_AI._lastNav = _0x8c;
                console.log('[XIA-scan] 题目已有选中项，跳过');
                XIA_AI.log('检测到当前题目已被选择，跳过', 'info');
                XIA_AI.lastQuestionHash = '';
                let _0x84 = null;
                const _0x85 = document.querySelectorAll('.toggle-button');
                console.log('[XIA-scan] toggle-button 数量:', _0x85.length);
                for (const _0x86 of _0x85) {
                    const _0x87 = (_0x86.textContent || '').trim();
                    console.log('[XIA-scan] toggle-button text="' + _0x87 + '"');
                    if (/下一题|下一个/.test(_0x87)) { _0x84 = _0x86; break; }
                }
                if (_0x84) console.log('[XIA-scan] 策略0 匹配: 下一题');
                if (!_0x84) {
                    const _0x88 = document.querySelectorAll('button, [role="button"]');
                    for (const _0x86 of _0x88) {
                        const _0x87 = (_0x86.textContent || '').trim();
                        if (/下一题|下一个/.test(_0x87) && !/上一题|提交|交卷|作业|先保存/.test(_0x87)) {
                            _0x84 = _0x86;
                            console.log('[XIA-scan] 策略1 遍历匹配: 下一题');
                            break;
                        }
                    }
                }
                if (_0x84) {
                    console.log('[XIA-scan] 最终点击: ' + ((_0x84.textContent || '').trim().slice(0, 15) || '??'));
                    try { _0x84.click(); } catch(e) {}
                    XIA_AI.log('点击按钮: "' + (_0x84.textContent || '').trim().slice(0, 15) + '"', 'ok');
                } else {
                    console.log('[XIA-scan] 未找到下一题按钮');
                    XIA_AI.log('未找到下一页按钮', 'error');
                }
                return;
            }
            XIA_AI.lastQuestionHash = _0x81;
            XIA_AI.answering = true;
            XIA_AI.log('📋 抓到题目: ' + _0x80.question.slice(0, 60) + (_0x80.question.length > 60 ? '...' : '') + ' [' + (_0x80.type || 'single') + ']');
            if (_0x80.options.length > 0) {
                XIA_AI.log('共 ' + _0x80.options.length + ' 个选项: ' + _0x80.options.map(_0x8b => _0x8b.letter).join(' '));
            }
            XIA_AI.callAI(_0x80.question, _0x80.options, _0x80.type || 'single', (answer) => {
                if (answer) {
                    if (_0x80.type === 'subjective') {
                        XIA_AI.answerSubjective(answer, () => {
                            XIA_AI.log('主观题答案已填入，2s 后跳转下一题', 'ok');
                            setTimeout(() => {
                                let _0x8a = null;
                                const _0x85 = document.querySelectorAll('.toggle-button');
                                for (const _0x86 of _0x85) {
                                    const _0x87 = (_0x86.textContent || '').trim();
                                    if (/下一题|下一个/.test(_0x87)) { _0x8a = _0x86; break; }
                                }
                                if (!_0x8a) {
                                    const _0x88 = document.querySelectorAll('button, [role="button"]');
                                    for (const _0x86 of _0x88) {
                                        const _0x87 = (_0x86.textContent || '').trim();
                                        if (/下一题|下一个/.test(_0x87) && !/上一题|提交|交卷|作业|先保存/.test(_0x87)) { _0x8a = _0x86; break; }
                                    }
                                }
                                if (_0x8a) {
                                    try { _0x8a.click(); } catch(e) {}
                                    XIA_AI.log('(主观)跳转下一题', 'ok');
                                } else {
                                    XIA_AI.log('(主观)未找到下一题按钮', 'error');
                                }
                                XIA_AI.answering = false;
                            }, 2000);
                        });
                        return;
                    }
                    const _0x89 = document.querySelector('div.question .common-duoxuan-tag') !== null;
                    if (_0x89 || _0x80.type === 'multi') {
                        XIA_AI.clickMultiAnswer(answer, () => {
                            XIA_AI.log('多选题答案 ' + answer + ' 已全部点击，1.5s 后跳转下一题', 'ok');
                            setTimeout(() => {
                                let _0x8a = null;
                                const _0x85 = document.querySelectorAll('.toggle-button');
                                for (const _0x86 of _0x85) {
                                    const _0x87 = (_0x86.textContent || '').trim();
                                    if (/下一题|下一个/.test(_0x87)) { _0x8a = _0x86; break; }
                                }
                                if (!_0x8a) {
                                    const _0x88 = document.querySelectorAll('button, [role="button"]');
                                    for (const _0x86 of _0x88) {
                                        const _0x87 = (_0x86.textContent || '').trim();
                                        if (/下一题|下一个/.test(_0x87) && !/上一题|提交|交卷|作业|先保存/.test(_0x87)) { _0x8a = _0x86; break; }
                                    }
                                }
                                if (_0x8a) {
                                    try { _0x8a.click(); } catch(e) {}
                                    XIA_AI.log('(多选)跳转下一题', 'ok');
                                } else {
                                    XIA_AI.log('(多选)未找到下一题按钮', 'error');
                                }
                                XIA_AI.answering = false;
                            }, 1500);
                        });
                        return;
                    } else {
                        XIA_AI.clickAnswer(answer);
                        setTimeout(() => { XIA_AI.lastQuestionHash = ''; }, 500);
                    }
                }
                XIA_AI.answering = false;
            });
        },

        testGrab() {
            const _0x90 = XIA_AI.grabQuestion();
            if (!_0x90) { XIA_AI.log('[测试] grabQuestion()=null', 'error'); return; }
            if (!_0x90.question) { XIA_AI.log('[测试] question为空', 'error'); return; }
            XIA_AI.log('[测试] 抓到题目: ' + _0x90.question.slice(0, 150), 'ai');
            if (_0x90.options.length === 0) {
                XIA_AI.log('[测试] 未抓到选项（raw 前120字）: ' + (_0x90.raw || '').slice(0, 120), 'error');
            } else {
                _0x90.options.forEach(_0x91 => XIA_AI.log('[测试] 选项 ' + _0x91.letter + ': ' + _0x91.text.slice(0, 60), 'ai'));
            }
            if (conf.apiKey) XIA_AI.log('[测试] 如想让 AI 作答，点击下方"开启自动答题"后重新测试', 'ai');
            else XIA_AI.log('[测试] 未配置 API Key，仅演示抓取', 'error');
        },
    };

    // ==================== 悬浮控制面板 UI ====================
    const CSS = `
#xia-panel{position:fixed;top:16px;left:16px;width:300px;background:#fff;border-radius:14px;
  box-shadow:0 10px 32px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);z-index:99999;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;transition:opacity .25s,transform .25s;}
#xia-panel.xia-hidden{opacity:0;transform:scale(.85);pointer-events:none;}
.xia-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:15px;font-weight:700;letter-spacing:.5px;cursor:move;user-select:none;}
.xia-min-btn{width:22px;height:22px;border-radius:6px;border:none;background:rgba(255,255,255,.2);
  color:#fff;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;}
.xia-min-btn:hover{background:rgba(255,255,255,.35);}
.xia-tabs{display:flex;background:#f9fafb;border-bottom:1px solid #e5e7eb;}
.xia-tab{flex:1;padding:9px 4px;font-size:12px;font-weight:600;color:#6b7280;text-align:center;cursor:pointer;transition:all .15s;border-bottom:2px solid transparent;}
.xia-tab:hover{color:#3b82f6;}
.xia-tab.active{color:#3b82f6;border-bottom-color:#3b82f6;background:#fff;}
.xia-body{padding:14px;display:flex;flex-direction:column;gap:10px;max-height:520px;overflow-y:auto;}
.xia-tab-pane{display:none;flex-direction:column;gap:10px;}
.xia-tab-pane.active{display:flex;}
.xia-status{font-size:12px;color:#6b7280;text-align:center;padding:6px 8px;border-radius:6px;background:#f3f4f6;transition:color .2s,background .2s;}
.xia-status.running{color:#059669;background:#d1fae5;}
.xia-status.paused{color:#d97706;background:#fef3c7;}
.xia-btn{width:100%;padding:9px 0;border:none;border-radius:10px;font-size:13px;font-weight:600;
  cursor:pointer;transition:all .2s;letter-spacing:.3px;color:#fff;}
.xia-start{background:linear-gradient(135deg,#3b82f6,#2563eb);}
.xia-start:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xia-start:active{transform:scale(.97);}
.xia-once{background:linear-gradient(135deg,#0ea5e9,#06b6d4);}
.xia-once:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xia-once:active{transform:scale(.97);}
.xia-input:disabled{background:#f3f4f6;color:#9ca3af;cursor:not-allowed;}
.xia-ai-inputs{display:flex;flex-direction:column;gap:10px;}
.xia-about{font-size:12px;color:#374151;line-height:1.8;max-height:350px;overflow-y:auto;
  padding-right:4px;word-break:break-word;}
.xia-about h4{font-size:14px;color:#1e40af;margin:0 0 6px;}
.xia-about p{margin:0 0 8px;}
.xia-about emoji{font-size:16px;}
.xia-stop{background:#f3f4f6;color:#374151;}
.xia-stop:hover{background:#e5e7eb;}
.xia-mute{background:#f3f4f6;color:#374151;}
.xia-mute:hover{background:#e5e7eb;}
.xia-mute.muted{background:#fee2e2;color:#dc2626;}
.xia-label{font-size:11px;color:#6b7280;font-weight:600;letter-spacing:.3px;margin-bottom:-4px;}
.xia-input{width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;
  font-family:inherit;outline:none;transition:border-color .2s;box-sizing:border-box;}
.xia-input:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.12);}
.xia-row{display:flex;align-items:center;gap:8px;}
.xia-switch{position:relative;width:42px;height:22px;border-radius:11px;background:#d1d5db;cursor:pointer;transition:background .2s;flex-shrink:0;}
.xia-switch.on{background:linear-gradient(135deg,#10b981,#059669);}
.xia-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .2s;}
.xia-switch.on::after{transform:translateX(20px);}
.xia-led{display:inline-block;width:8px;height:8px;border-radius:50%;background:#9ca3af;margin-right:6px;vertical-align:middle;}
.xia-led.ok{background:#10b981;box-shadow:0 0 6px rgba(16,185,129,.6);}
.xia-led.err{background:#dc2626;}
.xia-ai-log{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px;font-size:11px;
  font-family:'SF Mono','Menlo','Consolas',monospace;height:150px;overflow-y:auto;line-height:1.5;}
.xia-ai-log::-webkit-scrollbar{width:4px;}
.xia-ai-log::-webkit-scrollbar-thumb{background:#475569;border-radius:2px;}
#xia-mini{position:fixed;top:16px;left:16px;width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:18px;font-weight:700;
  display:none;align-items:center;justify-content:center;cursor:move;z-index:99999;
  box-shadow:0 4px 16px rgba(59,130,246,.35);transition:transform .2s;user-select:none;}
#xia-mini:hover{transform:scale(1.1);}
#xia-mini.show{display:flex;}
`;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'xia-panel';
    panel.innerHTML = `
<div class="xia-header"><span>XF芯位 v5.0</span><button class="xia-min-btn" title="最小化">−</button></div>
<div class="xia-tabs">
  <div class="xia-tab active" data-tab="cfg">⚙ 挂机配置</div>
  <div class="xia-tab" data-tab="ai">🤖 AI 答题调试</div>
  <div class="xia-tab" data-tab="about">💬 作者的话</div>
</div>
<div class="xia-body">
  <!-- Tab 1: 挂机配置 -->
  <div class="xia-tab-pane active" data-pane="cfg">
    <div class="xia-status" id="xia-status">状态：就绪</div>
    <div class="xia-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">全自动刷课</span>
      <div class="xia-switch" id="xia-autoplay-switch" title="开启自动刷课"></div>
    </div>
    <button class="xia-btn xia-mute">🔇 关闭静音</button>
  </div>
  <!-- Tab 2: AI 答题调试 -->
  <div class="xia-tab-pane" data-pane="ai">
    <div class="xia-status" id="xia-ai-status"><span class="xia-led" id="xia-ai-led"></span><span id="xia-ai-status-text">等待配置 Key</span></div>
    <div class="xia-ai-inputs" id="xia-ai-inputs">
      <div class="xia-label" id="xia-label-apikey">API Key（密钥）</div>
      <input class="xia-input" id="xia-apikey" type="password" placeholder="sk-xxxxxxxxxxxxxxxx" />
      <div class="xia-label" id="xia-label-apibase">API Base URL</div>
      <input class="xia-input" id="xia-apibase" type="text" placeholder="https://api.deepseek.com" />
      <div class="xia-label" id="xia-label-model">模型名称</div>
      <input class="xia-input" id="xia-model" type="text" placeholder="deepseek-chat / gpt-4o-mini" />
      <div class="xia-label">检索增强（答题前先搜资料）</div>
      <select class="xia-input" id="xia-search-mode">
        <option value="off">关闭（不检索）</option>
        <option value="auto">自动（事实/时事题才搜）</option>
        <option value="always">总是（每题都搜）</option>
      </select>
      <select class="xia-input" id="xia-search-provider">
        <option value="duckduckgo">DuckDuckGo（免密钥）</option>
        <option value="tavily">Tavily（需Key，更准）</option>
      </select>
      <input class="xia-input" id="xia-search-key" type="password" placeholder="Tavily API Key（DDG 可留空）" />
    </div>
    <button class="xia-btn xia-once" id="xia-answer-once">🎯 回答当前题目</button>
    <div class="xia-row">
      <div class="xia-switch" id="xia-autoanswer-switch" title="开启自动答题"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">自动答题+跳题</span>
    </div>
    <button class="xia-btn xia-start" id="xia-test-grab">🧪 一键抓取当前题目测试</button>
  </div>
  <!-- Tab 3: 作者的话 -->
  <div class="xia-tab-pane" data-pane="about">
    <div class="xia-about">
      <h4>👋 各位同学好</h4>
      <p>作为一个代码小白，这个脚本最初只是我为了方便自己和身边的朋友，耗费了几天的空闲时间，用AI编程助手Trae做出的一时心血来潮的技术产物。</p>
      <h4>1. 关于"为什么没有内置 AI ？"</h4>
      <p>别问了，问就是作者太穷。😅 为了脚本的长期存活，也为了彻底断绝大家"API Key 会不会被偷"的隐私顾虑，本脚本目前为全网最纯净的<strong>【单机自填版】</strong>。（为了不被校方顺着收款码精准逮到、喜提处分套餐。本脚本纯粹用爱发电，不接受任何形式的打赏。 觉得好用，在评论区留下一句好评，就是对我最大的支持）</p>
      <h4>2. 强烈推荐的白嫖方案</h4>
      <p>脚本完全依赖你自己在面板里填写的配置。如果你没有 Key，强烈推荐去注册一个 <strong>硅基流动 (SiliconFlow)</strong>、<strong>DeepSeek 官方</strong> 或其他大模型平台。新用户通常会送几百万甚至上千万的免费 Token 额度，足够你把全校的课刷完还过剩。</p>
      <h4>3. 友情提示（叠最厚的甲）</h4>
      <p>本脚本仅供计算机自动化技术交流与学习，请勿用于非法用途。AI 并不保证 100% 的正确率，刷完课记得自己复习一遍。使用本脚本产生的一切风险，请自行承担。 怕风险的同学请立刻卸载，手动刷课保平安。</p>
      <h4>5. 关于更新</h4>
      <p>代码已由 AI 助手（Trae）协助总装完成。有bug可以在评论区反馈。由于网课平台经常暗改，如果哪天脚本失效了（比如不自动勾选、报错），我会不定期来修。随时跑路！</p>
    </div>
  </div>
  <!-- 共享日志框（在两个页签下方均可见） -->
  <div class="xia-ai-log" id="xia-ai-log"><div style="color:#94a3b8;">等待操作...</div></div>
</div>`;
    document.body.appendChild(panel);

    const mini = document.createElement('div');
    mini.id = 'xia-mini';
    mini.textContent = '夏';
    document.body.appendChild(mini);

    // ==================== 拖动功能 ====================
    function makeDraggable(dragEl, handleEl) {
        let dragging = false, startX, startY, origLeft, origTop;
        handleEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('button, .xia-min-btn, .xia-switch, input, .xia-btn')) return;
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
    makeDraggable(panel, panel.querySelector('.xia-header'));
    makeDraggable(mini, mini);

    // ==================== UI 绑定 ====================
    let pptSince = 0, cooldownUntil = 0, mainLoopId = null, tick = 0, aiScanTimer = null;
    let _0xc4 = 0;

    function startAIScan() {
        if (aiScanTimer) return;
        setTimeout(() => { XIA_AI.scan(); }, 500);
        aiScanTimer = setInterval(() => { XIA_AI.scan(); }, 3000);
    }
    function stopAIScan() {
        if (aiScanTimer) { clearInterval(aiScanTimer); aiScanTimer = null; }
    }
    const $ = s => panel.querySelector(s);
    const statusEl = $('#xia-status');
    const aiStatusEl = $('#xia-ai-status');
    const aiLed = $('#xia-ai-led');
    const aiStatusText = $('#xia-ai-status-text');
    const apikeyInput = $('#xia-apikey');
    const apibaseInput = $('#xia-apibase');
    const modelInput = $('#xia-model');
    const searchModeInput = $('#xia-search-mode');
    const searchProviderInput = $('#xia-search-provider');
    const searchApiKeyInput = $('#xia-search-key');
    const autoSwitch = $('#xia-autoanswer-switch');
    const playSwitch = $('#xia-autoplay-switch');

    function setStatus(text, cls) {
        statusEl.textContent = text;
        statusEl.className = 'xia-status' + (cls ? ' ' + cls : '');
    }
    function setAIStatus(type, text) {
        if (type === true) { aiLed.className = 'xia-led ok'; }
        else if (type === false) { aiLed.className = 'xia-led err'; }
        else { aiLed.className = 'xia-led'; }
        aiStatusText.textContent = text || '';
    }

    // Tab 切换
    document.querySelectorAll('.xia-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.xia-tab, .xia-tab-pane').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            const pane = document.querySelector('[data-pane="' + tab.dataset.tab + '"]');
            if (pane) pane.classList.add('active');
        });
    });

    // 最小化
    $('.xia-min-btn').addEventListener('click', () => {
        panel.classList.add('xia-hidden');
        mini.classList.add('show');
    });
    mini.addEventListener('click', () => {
        panel.classList.remove('xia-hidden');
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

    refreshPlaySwitch();
    refreshAISwitch();

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
    $('#xia-answer-once').addEventListener('click', () => { XIA_AI.answerOnce(); });

    // 测试按钮
    $('#xia-test-grab').addEventListener('click', () => { XIA_AI.testGrab(); });

    // 静音按钮
    const muteBtn = $('.xia-mute');
    muteBtn.addEventListener('click', () => {
        muteEnabled = !muteEnabled;
        if (muteEnabled) { muteAll(); muteBtn.classList.remove('muted'); muteBtn.textContent = '🔇 关闭静音'; }
        else { document.querySelectorAll('video').forEach(v => { if (v.muted) v.muted = false; }); muteBtn.classList.add('muted'); muteBtn.textContent = '🔊 开启声音'; }
    });

    // ==================== 核心：完成态判断 + 跳转 + AI 扫描 ====================

    function _0x1b() {
        for (const f of document.querySelectorAll('iframe')) {
            if (f.src && f.src.includes('PowerPointFrame') && visible(f)) return true;
        }
        return false;
    }

    function _0x1c() {
        const btn = document.querySelector('.course-sidebar-switch');
        if (btn && visible(btn)) { btn.click(); return true; }
        return false;
    }

    function _0x1d() {
        const _0xe0 = Date.now();
        if (_0xe0 < cooldownUntil) return false;
        if (_0xe0 - scriptStart < CFG.MIN_WATCH * 1000) return false;
        const _0xe1 = document.querySelector('li.el-menu-item.is-active');
        if (_0xe1) {
            if (_0xe1.querySelector('.inProgress-icon, .unStart-icon')) return false;
            const _0xe2 = _0xe1.querySelector('.done-icon, .icon-done, .el-icon-check, .el-icon-circle-check, .el-icon-check-circle, .is-done');
            if (_0xe2 && visible(_0xe2)) { console.log('[芯位] done-icon → 完成'); return true; }
        }
        if (_0x1b()) {
            if (pptSince === 0) pptSince = _0xe0;
            if (_0xe0 - pptSince > CFG.PPT_TIMEOUT * 1000) { console.log('[芯位] PPT停留' + CFG.PPT_TIMEOUT + 's → 完成'); return true; }
        } else { pptSince = 0; }
        for (const _0xe3 of document.querySelectorAll('video')) {
            if (!visible(_0xe3)) continue;
            if (_0xe3.duration > 0 && (_0xe3.ended || _0xe3.currentTime >= _0xe3.duration - 0.5)) { console.log('[芯位] 视频播放完毕 → 完成'); return true; }
        }
        return false;
    }

    function _0x1e() {
        const _0xa0 = document.querySelectorAll('.right, div.right');
        for (const _0xa1 of _0xa0) {
            if (!visible(_0xa1)) continue;
            if ((_0xa1.textContent || '').includes('观看下一章节')) {
                setTimeout(() => {
                    const _0xa2 = _0xa1.closest('button, a, [role="button"], [class*="btn"], [class*="Btn"]') || _0xa1;
                    _0xa2.click();
                }, 800 + Math.random() * 1000);
                console.log('[芯位] 点击 "观看下一章节" 按钮');
                cooldownUntil = Date.now() + CFG.COOLDOWN * 1000;
                pptSince = 0; _0xc4++;
                return true;
            }
        }
        return false;
    }

    function _0x1f() {
        _0x1c();
        const _0xb0 = document.querySelector('li.el-menu-item.is-active');
        if (!_0xb0) { console.log('[芯位] 无高亮节点'); return false; }
        const _0xb1 = _0x1a(_0xb0);
        if (!_0xb1) { console.log('[芯位] 已是最后一节'); return false; }
        const _0xb2 = (_0xb0.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        const _0xb3 = (_0xb1.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        console.log('[芯位] 穿透搜索: "' + _0xb2 + '" → "' + _0xb3 + '"');
        ensureVisible(_0xb1);
        setTimeout(() => {
            if (!visible(_0xb1)) ensureVisible(_0xb1);
            _0xb1.click();
            cooldownUntil = Date.now() + CFG.COOLDOWN * 1000;
            pptSince = 0; _0xc4++;
            console.log('[芯位] 点击完成');
        }, 400);
        return true;
    }

    function _0x20() {
        tick++;
        muteAll();
        keepPlay();
        if (tick % 10 === 0) {
            const _0xc0 = document.querySelector('li.el-menu-item.is-active');
            const _0xc1 = _0xc0 ? (_0xc0.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20) : '(无)';
            const _0xc2 = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
            console.log('[芯位] #' + tick + ' | 当前: "' + _0xc1 + '" | cd=' + _0xc2 + 's | 连跳=' + _0xc4);
        }
        try { XIA_AI.scan(); } catch (e) { console.error('[XIA] 扫描异常:', e); }
        if (!_0x1d()) { _0xc4 = 0; return; }
        if (Date.now() < cooldownUntil) return;
        if (_0xc4 >= 3) { console.log('[芯位] 连续跳转' + _0xc4 + '次，暂停50s'); cooldownUntil = Date.now() + 50000; _0xc4 = 0; return; }
        console.log('[芯位] 触发跳转');
        if (_0x1e()) return;
        setTimeout(() => { if (!_0x1e()) _0x1f(); }, 5000);
    }

    function startAuto() {
        if (mainLoopId) return;
        mainLoopId = setInterval(_0x20, CFG.INTERVAL * 1000);
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

    muteAll();

    // ==================== 学习状态异常弹窗自动刷新 ====================
    // 平台弹出"系统检测到你的学习状态异常，请刷新后继续学习"时脚本无法操作，
    // 检测到后自动刷新页面恢复；刷新后脚本按面板开关状态自动续跑。
    (function() {
        const RELOAD_COOLDOWN = 20000; // 20s 冷却，防止刷新死循环
        setInterval(() => {
            const last = Number(GM_getValue('xia_last_reload_at', 0));
            if (Date.now() - last < RELOAD_COOLDOWN) return;
            const text = (document.body && document.body.innerText) || '';
            if (text.indexOf('学习状态异常') !== -1 || text.indexOf('请刷新后继续学习') !== -1) {
                GM_setValue('xia_last_reload_at', Date.now());
                console.log('[芯位] 检测到学习状态异常弹窗，3秒后自动刷新页面');
                setTimeout(() => { location.reload(); }, 3000);
            }
        }, 3000);
    })();

})();