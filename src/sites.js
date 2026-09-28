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
        for (const v of document.querySelectorAll('video')) {
            if (muteEnabled && !v.muted) v.muted = true;
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
        let playing = false;
        const visit = (doc, depth) => {
            if (depth > 3) return;
            const vids = qsa('video', doc);
            for (const v of vids) {
                if (muteEnabled && !v.muted) v.muted = true;
                if (conf.autoPlay && v.paused && !v.ended) {
                    // 不设 readyState 门槛：play() 本身会触发流加载；
                    // 播放器需点「播放视频」大按钮才初始化流，paused 时兜底补点（开播后按钮自动消失）
                    try { v.play().catch(() => {}); } catch (e) {}
                    const btn = doc.querySelector('.vjs-big-play-button, [title="播放视频"], [aria-label="播放视频"]');
                    if (btn) { try { btn.click(); } catch (e) {} }
                }
                if (!v.paused && !v.ended) playing = true;
                // 完成判定：ended 或播过 92%（平台要求 90%，留余量；不可拖拽只能真实播放）
                if (!v._xaDone && v.duration > 0 && (v.ended || v.currentTime >= v.duration * 0.92)) {
                    v._xaDone = true;
                    XIA_AI.log('✅ 一个视频已看完（≥92%）', 'ok');
                    CX.clickNextSection();
                }
            }
            for (const f of qsa('iframe', doc)) {
                try { if (f.contentDocument) visit(f.contentDocument, depth + 1); } catch (e) {}
            }
        };
        visit(document, 0);
        if (conf.autoPlay && !playing && Date.now() - (CX._idleLogAt || 0) > 30000) {
            CX._idleLogAt = Date.now();
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

    // autoplay 主循环在 chaoxing top 帧的分支（视频工作都在播放器帧自己的 loop 里）
    tick() {
        muteAll();
        if (/\/mycourse\/studentstudy/.test(location.href)) {
            // 视频由播放器帧驱动，这里仅等待 message（bindStudyTop 已挂）
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
