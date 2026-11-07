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

// 常用 DOM 小工具
function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function qtext(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }        // 压缩空白
function qtextAll(el) { return ((el && el.textContent) || '').replace(/\s+/g, ''); }             // 去全部空白（精确比对用）

// ==================== 整页静音 ====================
// 三重拦截，保证开启静音后页面完全无声（面板可一键恢复声音）：
// ① 新挂载的 video/audio 立即静音（MutationObserver，含动态创建的元素）
// ② 劫持 HTMLMediaElement.play()：任何播放调用先静音（堵住轮询间隙）
// ③ 捕获 volumechange：页面/播放器任何取消静音的操作即时压回（该事件不冒泡，必须用捕获）
function installMute() {
    try {
        // 批次合并：SPA 导航/大列表渲染会产生成百上千个 addedNode，逐节点 QSA 是纯浪费。
        // 合并到 300ms 一次全页静音（play() 劫持兜底保证新元素在窗口期内也不会出声）
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            setTimeout(() => { pending = false; muteAll(); }, 300);
        }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    try {
        const origPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            if (muteEnabled) this.muted = true;
            return origPlay.apply(this, arguments);
        };
    } catch (e) {}
    try {
        document.addEventListener('volumechange', e => {
            const t = e.target;
            if (muteEnabled && t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO') && !t.muted) t.muted = true;
        }, true);
    } catch (e) {}
}

// 静音当前所有媒体元素（轮询兜底，配合 installMute 的三重拦截）
function muteAll() {
    document.querySelectorAll('video, audio').forEach(v => { if (muteEnabled && !v.muted) v.muted = true; });
}

// 视频内弹题/交互浮层检测：marker 弹题（到达标记点暂停 + 浮层答题）与答题弹窗出现时，
// 页面的暂停是刻意行为——此时催促播放会与平台机制互踩（弹题被顶回去/状态错乱），
// 需避让：video 暂停但存在可见交互浮层时，keepPlay 与卡死看门狗都不碰播放。
// 性能：单次逗号选择器（原来 8 次独立 QSA，keepPlay 每 tick 都调）
const XA_OVERLAY_SEL = '.el-message-box, .el-dialog, .vjs-modal-dialog, [class*="question-popup"], [class*="quiz"], [class*="answer-popup"], [class*="marker"], .el-overlay';
let _ovCacheAt = 0, _ovCacheVal = false; // 同 tick 复用（keepPlay + videoStallCheck 一个 tick 内各调一次）
function interactiveOverlay() {
    const now = Date.now();
    if (now - _ovCacheAt < 1200) return _ovCacheVal;
    _ovCacheAt = now;
    _ovCacheVal = false;
    for (const el of qsa(XA_OVERLAY_SEL)) {
        if (!visible(el)) continue;
        if (qtextAll(el).length > 4) { _ovCacheVal = true; break; } // 有实际内容的浮层（空容器不算）
    }
    return _ovCacheVal;
}

// 反挂机检测规避：伪造可见/聚焦状态 + 合成随机鼠标移动/按键/滚动。
// 刻意不合成点击：合成事件 isTrusted=false 骗不过服务端风控（调研实锤检测在服务端），
// 而随机坐标点击可能误触倍速/音量/侧栏等真实控件，引发意外状态变更，得不偿失。
let _poseInstalled = false; // 属性劫持只装一次（每 tick 重复 defineProperty 无意义且耗性能）
function keepPlay() {
    const overlay = interactiveOverlay(); // 弹题/答题浮层期间不催播（避让平台刻意的暂停）
    document.querySelectorAll('video, audio').forEach(v => {
        if (overlay) return;
        if (v.paused && !v.ended && v.readyState >= 2) {
            try { v.play().catch(() => {}); } catch (e) {}
        }
    });

    if (!_poseInstalled) {
        _poseInstalled = true;
        try { Object.defineProperty(document, 'hidden', { get: () => false }); } catch (e) {}
        try { Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }); } catch (e) {}
        try { document.hasFocus = function () { return true; }; } catch (e) {}
    }

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
// filter（可选）：额外过滤器（节点 Element → bool），用于跳过已完成章节等
function findNextMenuItem(activeNode, filter) {
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
                if (filter && !filter(it)) continue;
                if (it.offsetHeight > 0 && it.offsetWidth > 0) { target = it; break; }
            }
            if (target) return target;
        } else if (sib.matches && sib.matches('li.el-menu-item')) {
            if (!filter || filter(sib)) return sib;
        }
        cur = sib;
    }
    return null;
}

// 侧边栏章节完成状态（courseMenu chunk 实证：.lecture-status 仅在 assessPoints===1 时渲染）
// inProgress-icon=进行中（半圆） / unStart-icon=未开始（空心圆） / done-icon=已完成（对勾）
// 无图标的节（PPT/文档等非考核内容）平台永远不给完成态，必须排除出补完扫描——
// 否则视频刷完后扫描会反复命中这些节点，造成来回跳转 PPT 页的死循环
function menuItemIncomplete(li) {
    if (!li) return false;
    // 锁定章（.disable-menu，开放时间窗之外）内的节点击不跳转（平台静默拦截），
    // 扫描命中只会白耗轮次——排除（ElMenuComponent chunk + 真机实测 2026-10-09）
    if (li.closest && li.closest('.el-sub-menu.disable-menu')) return false;
    return !!li.querySelector('.inProgress-icon, .unStart-icon');
}

// 找到可见且文本（去空白后）完全等于 text 的第一个元素
function exactText(selector, text) {
    let hit = null;
    qsa(selector).forEach(el => { if (!hit && visible(el) && qtextAll(el) === text) hit = el; });
    return hit;
}

// ==================== 图片作答题：文本答案 → PNG → 平台上传控件 ====================
// 题干要求「拍照/上传图片作答」时（sites.isImageAnswerQuestion），LLM 产出不了图片文件，
// 但可以把文本答案渲染成 PNG，再走平台上传控件（input[type=file] + DataTransfer）交图。
// 任一步环境受限（jsdom 无 canvas 2D、老浏览器无 DataTransfer/File 构造）即返回失败，
// 由调用方回退人工跳过路径——绝不静默假装成功。

// 纯文本排版：按最大列宽折行（CJK 逐字计 1、拉丁/数字计 0.55 的宽度估算），可独立测试。
// 英文长单词在行尾硬切（渲染成照片场景可接受，不做逐词回退的复杂度）。
function xaWrapTextLines(text, maxCols) {
    const out = [];
    for (const para of String(text || '').split(/\r?\n/)) {
        if (!para.trim()) { out.push(''); continue; }
        let line = '', width = 0;
        for (const ch of para) {
            const w = ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
            if (width + w > maxCols && line) { out.push(line); line = ''; width = 0; }
            line += ch;
            width += w;
        }
        if (line) out.push(line);
    }
    return out;
}

// canvas 渲染：白底黑字按行排版，高度按行数自适应（封顶 16000px，浏览器 canvas 上限内）。
// cb(dataUrl|null)；dataURL 为 image/png（xaUploadAnswerPng 只认这个格式）。
function xaRenderTextPng(text, cb) {
    try {
        const lines = xaWrapTextLines(String(text || '').slice(0, 6000), 46);
        const canvas = document.createElement('canvas');
        if (!canvas.getContext || !canvas.toBlob) { cb(null); return; }
        const W = 1040, PAD = 48, LH = 34;
        canvas.width = W;
        canvas.height = Math.min(PAD * 2 + lines.length * LH + 20, 16000);
        const ctx = canvas.getContext('2d');
        if (!ctx) { cb(null); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, canvas.height);
        ctx.fillStyle = '#111111';
        ctx.font = '22px "Microsoft YaHei", "PingFang SC", sans-serif';
        ctx.textBaseline = 'top';
        lines.forEach((ln, i) => ctx.fillText(ln, PAD, PAD + i * LH));
        canvas.toBlob(blob => {
            if (!blob) { cb(null); return; }
            const reader = new FileReader();
            reader.onload = () => cb(String(reader.result || '') || null);
            reader.onerror = () => cb(null);
            reader.readAsDataURL(blob);
        }, 'image/png');
    } catch (e) { cb(null); }
}

// 把 PNG dataURL 塞进题目块的文件上传控件并触发 change（Element Plus el-upload 原生监听
// 其隐藏 input 的 change）。返回 true=已派发（平台是否真正收件由上传回显校验确认），
// false=找不到控件/构造受限（DataTransfer 被禁等），调用方回退人工。
function xaUploadAnswerPng(scope, dataUrl) {
    try {
        const box = (scope && scope.closest && scope.closest('.question-box')) || scope || document;
        let inputs = qsa('input[type="file"]', box);
        if (!inputs.length) {
            // 兜底全页：仅当全页恰好只有一个文件控件时才取——多题同屏（答题卡式卷面）时
            // 抓「第一个」很可能投到别的题里，宁可失败回人工也不传错位置
            const all = qsa('input[type="file"]');
            if (all.length === 1) inputs = all;
        }
        if (!inputs.length) return false;
        const input = inputs.find(i => /image/i.test(String(i.accept || ''))) || inputs[0];
        const bin = atob(String(dataUrl).split(',')[1] || '');
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([arr], 'answer.png', { type: 'image/png' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    } catch (e) { return false; }
}

// ==================== 桌面通知（无人值守事件提醒）====================
// 页面在后台（用户看不到面板/日志）时才弹系统通知，前台一律不打扰；同类事件默认 10 分钟
// 节流防骚扰（巡航列表页每分钟都会刷一次「暂无作业」日志）。纯本地能力，无网络外发。

// 真实可见性判定：keepPlay 反挂机伪装把 document.hidden / visibilityState / hasFocus
// 全部劫持成「恒可见」，实例上的 defineProperty 只遮蔽不覆盖——Document.prototype 上的
// 原生 getter 仍在。从原型取真值才能知道用户是否真的在看这个页面。
// 原型 getter 不可用（极端环境）时按后台处理：宁多提醒不漏提醒。
function xaPageInBackground() {
    try {
        const d = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
        if (d && d.get) return !!d.get.call(document);
    } catch (e) {}
    return true;
}

// type：节流键（cfg/manual/cruise/submit/risk/deadline）；gapMs：同类最小间隔（默认 10 分钟）。
// GM_notification 不可用（未授权/老扩展）时静默跳过——通知是锦上添花，绝不影响主流程。
const _xaNotifyAt = {};
function xaNotify(type, title, body, gapMs) {
    try {
        if (conf && conf.notify === false) return;
        if (!xaPageInBackground()) return;
        const now = Date.now();
        if (now - (_xaNotifyAt[type] || 0) < (gapMs || 600000)) return;
        _xaNotifyAt[type] = now;
        if (typeof GM_notification !== 'function') return;
        GM_notification({
            title: '芯位 · ' + title,
            text: String(body || '').slice(0, 200),
            onclick: () => { try { window.focus(); } catch (e) {} },
        });
    } catch (e) {}
}

// token 用量缩写（面板统计展示）：940 → '940'，1200 → '1.2k'，15300 → '15.3k'
function xaFmtTok(n) {
    n = Number(n) || 0;
    return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n);
}

// 标签页标题附加进度后缀：后台挂机时切到别的窗口也能瞄到课程进度。
// SPA 路由会改写 document.title——每次先剥掉上次自己加的后缀再拼新的，防后缀叠加；
// suffix 传空串即还原原标题。
let _xaTitleSuffix = '';
function xaTitleSuffix(suffix) {
    try {
        suffix = String(suffix || '');
        if (_xaTitleSuffix && document.title.endsWith(_xaTitleSuffix)) {
            document.title = document.title.slice(0, document.title.length - _xaTitleSuffix.length);
        }
        _xaTitleSuffix = suffix;
        if (suffix && document.title) document.title += suffix;
    } catch (e) {}
}

// ==================== 运行时段表（自动功能的执行时间窗）====================

// 解析 "HH:MM-HH:MM"（也容忍 ~ 分隔与单位数小时）：返回 [起始分钟, 结束分钟]；
// 格式/取值非法（25:00、12:7x 等）返回 null——由调用方决定按全天放行（配错不能锁死自动化）。
function xaParseScheduleRange(s) {
    const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h1 = +m[1], m1 = +m[2], h2 = +m[3], m2 = +m[4];
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
    return [h1 * 60 + m1, h2 * 60 + m2];
}

// 当前时刻是否在允许时段内（空配置=全天；起止相同视为全天；支持跨零点如 23:00-07:00）。
// nowMin 参数仅供测试注入，运行期不传走真实时钟。
function xaScheduleActive(nowMin) {
    const r = xaParseScheduleRange(conf && conf.schedule);
    if (!r) return true;
    const cur = nowMin != null ? nowMin : new Date().getHours() * 60 + new Date().getMinutes();
    if (r[0] === r[1]) return true;
    return r[0] < r[1] ? (cur >= r[0] && cur < r[1]) : (cur >= r[0] || cur < r[1]);
}

// 时段闸门：自动流程（scan / 挂机主循环）每轮调用，跨过时段边界时打一条日志。
// 手动操作（答题/巡航按钮）不设闸——用户亲手点的，不该被时段拦。nowMin 仅供测试注入。
let _xaScheduleWasActive = true;
function xaScheduleGate(nowMin) {
    const active = xaScheduleActive(nowMin);
    if (active !== _xaScheduleWasActive) {
        _xaScheduleWasActive = active;
        XIA_AI.log(active
            ? '▶ 已进入运行时段，自动刷课/答题恢复'
            : '⏸ 已到暂停时段（' + (conf.schedule || '') + '），自动刷课/答题暂停，手动操作不受影响',
            active ? 'ok' : 'info');
    }
    return active;
}

// ==================== 题干图片拉取（视觉模型答题用）====================

// 图片 URL → dataURL：GM_xmlhttpRequest 拉字节（带浏览器 Cookie，过平台 CDN 鉴权/防盗链），
// FileReader 转 base64 dataURL。魔数嗅探 MIME；>6MB 或拉取失败返回 ''（调用方按无图处理）。
// 本身已是 dataURL 的原样放行。cb(dataURL|'')。
function xaFetchImageDataURL(src, cb) {
    const done = v => { try { cb(String(v || '')); } catch (e) {} };
    src = String(src || '');
    if (/^data:image\//i.test(src)) return done(src);
    try {
        GM_xmlhttpRequest({
            method: 'GET', url: src, timeout: 10000, responseType: 'arraybuffer',
            headers: { 'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*' },
            onload: r => {
                try {
                    const buf = r.response;
                    if (!buf || !buf.byteLength || buf.byteLength > 6 * 1024 * 1024) return done('');
                    const u8 = new Uint8Array(buf);
                    let mime = 'image/jpeg'; // 认不出的兜底：多数 vision 端点会自行嗅探真实格式
                    if (u8[0] === 0x89 && u8[1] === 0x50) mime = 'image/png';
                    else if (u8[0] === 0xFF && u8[1] === 0xD8) mime = 'image/jpeg';
                    else if (u8[0] === 0x47 && u8[1] === 0x49) mime = 'image/gif';
                    else if (u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42) mime = 'image/webp';
                    const fr = new FileReader();
                    fr.onload = () => done(fr.result);
                    fr.onerror = () => done('');
                    fr.readAsDataURL(new Blob([buf], { type: mime }));
                } catch (e) { done(''); }
            },
            onerror: () => done(''),
            ontimeout: () => done(''),
        });
    } catch (e) { done(''); }
}
