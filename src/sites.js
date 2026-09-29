// ==================== 多站点适配层 ====================
// XA_SITE: 'beeline' | 'chaoxing'；QA: 当前站点的题目解析适配器（qa.js 按 QA.xxx 调用）
//
// 超星学习通结构（线上实测）：
//   课程首页  mooc-ans/mycourse/studentcourse —— 左侧「待完成任务点」+ 顶部 作业/考试 tab
//   学习页    mooc-ans/mycourse/studentstudy   —— 主文档含右侧章节树与「上一节/下一节」按钮
//     └ iframe  mooc-ans/knowledge/cards       —— 任务点卡片列表（无需脚本介入）
//         └ iframe  ananas/modules/video       —— 真实 <video> 播放器，完成条件「观看时长 ≥ 90%」
// 视频帧播完 → postMessage 通知 top → top 点击「下一节」。
// 作业/考试为独立整页（.TiMu 题块），由 qa.js 的答题主流程经 QA 适配器处理。

const XA_SITE = /(^|\.)chaoxing\.com$/.test(location.hostname) ? 'chaoxing'
    : /(^|\.)beeline-ai\.com$/.test(location.hostname) ? 'beeline' : null;

const CX = {
    // 该 frame 是否为超星视频播放器 iframe（唯一需要注入的子 frame）
    isVideoIframe() { return /\/ananas\/modules\/video\//.test(location.pathname); },

    // ===== 视频播放器帧：静音、自动开播、播完通知 top =====
    startVideoFrameLoop() {
        loadCfg();
        setInterval(() => { try { CX.videoTick(); } catch (e) {} }, 3000);
        console.log('[XinweiAutoStudy] chaoxing video frame loop 已启动');
    },
    videoTick() {
        // frame 里面板不生效，开关直接读存储
        const on = GM_getValue(SK.autoPlay, false);
        conf.autoPlay = on === true || on === 'true';
        const speed = parseFloat(GM_getValue(SK.cxSpeed, '2')) || 1;
        for (const v of document.querySelectorAll('video')) {
            if (muteEnabled && !v.muted) v.muted = true;
            if (v.playbackRate !== speed) { try { v.playbackRate = speed; } catch (e) {} }
            if (conf.autoPlay && !v.ended && v.readyState >= 2 && v.paused) {
                try { v.play().catch(() => {}); } catch (e) {}
            }
            // 完成判定：ended 或播过 92%（平台要求 90%，留余量；不可拖拽只能真实播放）
            if (!v._xaDone && v.duration > 0 && (v.ended || v.currentTime >= v.duration * 0.92)) {
                v._xaDone = true;
                try { window.parent.postMessage({ __xa: 'cx-video-done' }, '*'); } catch (e) {}
            }
        }
        // 合成鼠标移动，防超星失焦暂停
        if (conf.autoPlay) {
            try {
                document.dispatchEvent(new MouseEvent('mousemove', {
                    bubbles: true, clientX: 100 + Math.random() * 300, clientY: 100 + Math.random() * 200,
                }));
            } catch (e) {}
        }
    },

    // ===== 学习页 top 帧：穿透同源 iframe 收集视频，静音/自动开播/完成检测 =====
    //（超星播放器在 ananas/modules/video 二级 iframe 里，与主文档同源，可直接穿透；
    //  同时保留 video 帧注入作为双保险，两处 play() 幂等无冲突）
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
        // 预扫描：已有视频在播则本轮不再启动新视频——一章多个视频同播易触发风控 9010
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
                // 完成判定：ended 或播过 92%（平台要求 90%，留余量；不可拖拽只能真实播放）
                if (!v._xaDone && v.duration > 0 && (v.ended || v.currentTime >= v.duration * 0.92)) {
                    v._xaDone = true;
                    XIA_AI.log('✅ 一个视频已看完（≥92%）', 'ok');
                    CX.clickNextSection();
                }
            }
            // 大播放按钮：超星按钮无 title/aria（vjs-big-play-button 类名也可能变），
            // 按可见文本精确匹配「播放视频」；点击后按钮消失故不会重复点击；同样一轮只点一个
            for (const b of qsa('button, [role="button"], [class*="play"], a, div', doc)) {
                if (qtext(b) !== '播放视频' || !visible(b)) continue;
                rpt.btn++;
                if (conf.autoPlay && !playing) { try { b.click(); playing = true; } catch (e) {} }
            }
            for (const f of qsa('iframe', doc)) {
                // 风控验证码：卡片 iframe 被 antispider 验证页替换（9010），提示人工处理；
                // 验证通过后 iframe 恢复，复位标记以便下次再触发时仍能告警
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
        // 诊断报告 30s 节流：帧数/视频数/按钮数/play调用数，用于远程定位链路断点
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

// ===== 超星题目适配器（.TiMu 题块）=====
// 题型标签 .fontLabel：单选题/多选题/判断题/填空题/简答题。
// 选择器按超星常见结构编写，若抓取异常用面板「🩺 诊断」dump 真实 DOM 后迭代。
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
    // 超星诊断：dump .TiMu 真实结构
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

// 当前站点的题目适配器：chaoxing 用 CXQA；beeline 用 qa.js 中的全局函数
//（function 声明在同一 IIFE 作用域内提升，此处可直接引用）
const QA = XA_SITE === 'chaoxing' ? CXQA : {
    questionRoot, questionType, isAnswered, letterOf, allSelected,
    questionScore, extractOptions, questionTitle,
};
