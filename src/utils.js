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
//  新挂载的 video/audio 立即静音（MutationObserver，含动态创建的元素）
//  劫持 HTMLMediaElement.play()：任何播放调用先静音（堵住轮询间隙）
//  捕获 volumechange：页面/播放器任何取消静音的操作即时压回（该事件不冒泡，必须用捕获）
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
            ? ' 已进入运行时段，自动刷课/答题恢复'
            : ' 已到暂停时段（' + (conf.schedule || '') + '），自动刷课/答题暂停，手动操作不受影响',
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

// ==================== 页面动画冻结（省电，默认启用无开关）====================

// 把全页 CSS 动画/过渡压到近零时长：Element Plus 骨架屏微光、loading 旋转、弹窗/菜单过渡
// 全部瞬时完成，省合成与绘制开销（页面侧唯一动不了的旁路是视频解码与播放器本体）。
// 三处刻意为之：
//   · 用 0.01ms 而非 animation:none —— animationend/transitionend 必须照常触发，
//     Vue 的 whenTransitionEnds/after-leave 等回调等的是事件，none 会把组件挂死在过渡态；
//   · iteration-count:1 必须配对 —— 只压时长不压次数，无限旋转会变成每秒十万次迭代，反而更卡；
//   · 不动 animation-fill-mode/timing-function —— fill-mode:forwards 的入场动画要落到终态。
// JS 驱动的动效（跑马灯 scrollLeft 跳位、播放器进度刷新）不受本规则影响，也不该受影响。
function xaFreezePageAnim() {
    if (document.getElementById('xa-anim-freeze')) return;
    const el = document.createElement('style');
    el.id = 'xa-anim-freeze';
    el.textContent = '*,*::before,*::after{'
        + 'animation-duration:0.01ms!important;animation-delay:0ms!important;animation-iteration-count:1!important;'
        + 'transition-duration:0.01ms!important;transition-delay:0ms!important;'
        + 'scroll-behavior:auto!important}';
    (document.head || document.documentElement).appendChild(el);
}

// ==================== 竖屏适配（视口 ≤1199px 生效，纯表现层）====================

// 芯位布局层零响应式（主 CSS 442KB + 7 个布局组件 CSS 共 0 条 @media，2026-11-10 实测）：
// 学习页双布局都是 min-width:1200px 硬墙，竖屏（iPad ~810px、竖装显示器 1080px）只能横向滚动。
// 内层组件全是流式 flex——解锁 min-width 即大部分自然回弹；头部 88px/74px 边距、logo 142px、
// 课程名 26px 一并收敛。条条带 !important 压平台同规则；不限定 orientation，分屏窄窗口同受惠。
// 刻意不做的事：目录盒不用 display:none（自动跳章要读侧边栏目录 DOM，隐藏不影响查询但破坏点击），
// 视频播放器不设固定尺寸（video 本身流式）。与动画冻结（#xa-anim-freeze）各自独立，幂等。
function xaPortraitCSS() {
    if (document.getElementById('xa-portrait-css')) return;
    const el = document.createElement('style');
    el.id = 'xa-portrait-css';
    el.textContent = '@media (max-width:1199px){'
        + '.el-container.teaching-layout{min-width:0!important}'
        + '.el-container .el-main{min-width:0!important}'
        + '.layout{min-width:0!important}'
        + '.teaching-layout .el-header{height:auto!important;min-height:56px;padding:6px 12px!important}'
        + '.teaching-layout .header-lf{padding-right:12px!important}'
        + '.teaching-layout .header-lf .logo-img{width:100px!important}'
        + '.teaching-layout .header-mid .course-name{font-size:16px!important;line-height:22px!important;padding-right:12px!important;text-align:left!important}'
        + '.teaching-layout .header-mid .examine-progress{min-width:0!important}'
        + '.teaching-layout .header-rf a{padding-right:16px!important}'
        + '.el-main{padding:8px!important}'
        + '}';
    (document.head || document.documentElement).appendChild(el);
}

// ==================== 主观题草稿防丢（纯本地）====================

// 场景：用户在简答/论述编辑器手打内容时，页面被我们的风控自愈刷新/浏览器崩溃/误关——内容全丢。
// 每 5s 轻扫题块编辑器，非空即存 GM 本地（题干 hash 键）；刷新/后退进来的新页面生命中，编辑器为空
// 且有草稿 → 用 answerSubjective 同款合成输入恢复（一次性，恢复即删草稿）。上限 20 条、7 天过期。
const XA_DRAFT_CAP = 20, XA_DRAFT_TTL = 7 * 24 * 3600 * 1000;

function xaDraftKey(title) {
    const s = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
}

function xaDraftAll() {
    try { return JSON.parse(GM_getValue(SK.drafts, '{}')) || {}; } catch (e) { return {}; }
}

function xaDraftStore(store) {
    const now = Date.now();
    const list = Object.keys(store).filter(k => store[k] && store[k].text).sort((a, b) => b.at - a.at);
    const keep = {};
    list.slice(0, XA_DRAFT_CAP).forEach(k => { if (now - store[k].at < XA_DRAFT_TTL) keep[k] = store[k]; });
    GM_setValue(SK.drafts, JSON.stringify(keep));
}

// 恢复写入：与 answerSubjective 同款合成输入（beforeinput 优先、execCommand 兜底），长度回读判活
function xaDraftRestoreInto(editor, text) {
    const paras = String(text).split(/\n+/).map(s => s.replace(/\s+$/, '')).filter(Boolean);
    if (!paras.length || !editor) return false;
    try { editor.focus(); } catch (e) {}
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.addRange(range);
    const normLen = () => (editor.textContent || '').replace(/\s+/g, '').length;
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
    if (normLen() === 0) {
        // 合成输入未被编辑器接纳（个别富文本内核/无头环境）：直接落 DOM 保内容——
        // 草稿恢复宁可让用户看到再手工接管，也不能静默丢文
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        try { editor.innerHTML = paras.map(p => '<p>' + esc(p) + '</p>').join(''); } catch (e) {}
    }
    try { editor.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    return normLen() > 0;
}

// 草稿巡检（bootstrap 每 5s 调）。recovered 参数=当前页面生命是否为刷新/后退进入
// （performance navigation type；测试可注入），此时空编辑器+有草稿才恢复，杜绝把提交后正常
// 清空的编辑器重新填上旧文。
function xaDraftWatchTick(recovered) {
    if (recovered == null) {
        try {
            const nav = (performance.getEntriesByType('navigation')[0] || {});
            recovered = nav.type === 'reload' || nav.type === 'back_forward';
        } catch (e) { recovered = false; }
    }
    const roots = qsa('[class*="homework-question-editor"]');
    if (!roots.length) return;
    const store = xaDraftAll();
    let dirty = false;
    roots.forEach((root, idx) => {
        const ed = root.querySelector('[data-slate-editor]')
            || root.querySelector('div.w-e-text-container [contenteditable="true"]')
            || root.querySelector('[contenteditable="true"]');
        if (!ed) return;
        const titleEl = root.querySelector('.topic-title');
        const key = xaDraftKey((titleEl && titleEl.textContent) || 'idx' + idx);
        const text = String(ed.textContent || '').replace(/\s+$/, '');
        // 保存闸：AI 答题写入的内容不存草稿——否则提交后编辑器清空，风控自愈刷新会把
        // 「已提交的答案」当草稿回填。确认模式的人工核对在 answering 复位后照常可存。
        if (text.replace(/\s/g, '').length > 1) {
            if (!XIA_AI.answering && !XIA_AI.answeringOnce && (!store[key] || store[key].text !== text)) {
                store[key] = { text, at: Date.now(), title: String((titleEl && titleEl.textContent) || '').trim().slice(0, 40) };
                dirty = true;
            }
        } else if (recovered && store[key] && store[key].text) {
            const at = new Date(store[key].at).toLocaleTimeString();
            if (xaDraftRestoreInto(ed, store[key].text)) {
                XIA_AI.log(' 已恢复本地草稿（' + at + ' 保存' + (store[key].title ? '：' + store[key].title : '') + '），请核对内容', 'ok');
                delete store[key];
                dirty = true;
            }
        }
    });
    if (dirty) xaDraftStore(store);
}

// ==================== 暗色/护眼模式 ====================

// Element Plus 走 CSS 变量整体换肤；平台布局里散落的硬编码浅色（.el-header #fff、.el-main #edf1fa、
// .couresSideBox #fff、#app #f0f0f0——来自平台 CSS 实测）逐个补丁。样式常驻注入（#xa-dark-css），
// html.xa-dark 类开关生效，conf.darkMode 由面板开关驱动。视频/图片不动（无 filter 反转）。
// 首版覆盖面有限，真机截图迭代补漏。
function xaDarkModeCSS() {
    if (document.getElementById('xa-dark-css')) return;
    const el = document.createElement('style');
    el.id = 'xa-dark-css';
    el.textContent = `html.xa-dark{--el-bg-color:#1d222b;--el-bg-color-page:#141821;--el-bg-color-overlay:#252b36;
--el-text-color-primary:#e5eaf3;--el-text-color-regular:#cfd6e0;--el-text-color-secondary:#9aa3b2;
--el-text-color-placeholder:#6b7280;--el-text-color-disabled:#555c68;
--el-border-color:#3a4150;--el-border-color-light:#2e3542;--el-border-color-lighter:#2a303c;--el-border-color-extra-light:#252b36;
--el-fill-color:#2a303c;--el-fill-color-light:#242a35;--el-fill-color-lighter:#20252f;--el-fill-color-extra-light:#1d222b;
--el-fill-color-blank:#1d222b;--el-fill-color-dark:#2e3542;--el-fill-color-darker:#333a48;
--el-mask-color:rgba(0,0,0,.65);}
html.xa-dark body,html.xa-dark #app{background:#141821;color:#cfd6e0}
html.xa-dark .el-main{background-color:#141821!important}
html.xa-dark .el-container.teaching-layout .el-header,html.xa-dark .couresSideBox{background:#1d222b!important}
html.xa-dark .couresSideBox-title,html.xa-dark .teaching-layout .header-mid .course-name{color:#e5eaf3!important}
html.xa-dark .teaching-layout .header-rf a span{color:#9aa3b2!important}
html.xa-dark .homework-question-editor,html.xa-dark .question-box,html.xa-dark .topic-title{color:#cfd6e0}
html.xa-dark .w-e-text-container,html.xa-dark [class*="w-e-"]{background:#1d222b;color:#cfd6e0}
html.xa-dark .w-e-text-container [contenteditable="true"]{color:#e5eaf3}`;
    (document.head || document.documentElement).appendChild(el);
}

function xaApplyDarkMode() {
    document.documentElement.classList.toggle('xa-dark', !!conf.darkMode);
}

// ==================== 降画质省性能 ====================

// 平台本就有画质菜单（QualityDialog），切换属正常用户行为，不涉风控（风控管倍速/进度位置）。
// 解码开销与分辨率直接挂钩：自动选最低档 = 大幅降解码 CPU 与带宽。走 video.js qualityLevels
// API（vjs7 http-streaming 自带）；无多档画质（单 mp4）静默跳过。每元素只记一次日志。
function xaApplyVideoEco(v) {
    if (!conf.videoEco || v.__xaEcoDone) return;
    try {
        const p = v.player || (window.videojs && window.videojs.getPlayer ? window.videojs.getPlayer(v.id || '') : null);
        if (!p || typeof p.qualityLevels !== 'function') return;
        const ls = p.qualityLevels();
        // 空列表不锁 done：HLS 清单可能晚于 loadedmetadata 解析，留待下次事件重试；
        // 单 mp4 播放器列表恒空也只相当于每次换源多一次廉价探测
        if (!ls || !ls.length) return;
        let low = 0;
        for (let i = 1; i < ls.length; i++) {
            if ((ls[i].bitrate || ls[i].height || 0) < (ls[low].bitrate || ls[low].height || 0)) low = i;
        }
        for (let i = 0; i < ls.length; i++) { try { ls[i].enabled = (i === low); } catch (e) {} }
        v.__xaEcoDone = true;
        console.log('[芯位] 降画质省性能：已选最低档 ' + (ls[low].width || '?') + 'x' + (ls[low].height || '?'));
    } catch (e) {}
}

// ==================== 作业/考试页防误关 ====================

// hash 命中 homework|exam（sites.routeHasQuestions 同源判定）时挂 beforeunload。我们的自动化
// 全走 DOM 点击（SPA hash 路由，不触发 beforeunload）；脚本自身发起的全页刷新（风控自愈 popup.js、
// 视频卡死/解锁守望 autoplay.js）在 reload 前设 XIA_AI._allowLeaveAt 放行。3s 巡检跟随路由装卸。
let _xaUnloadOn = false;
function _xaUnloadHandler(e) {
    if (Date.now() - (XIA_AI._allowLeaveAt || 0) < 5000) return;
    e.preventDefault();
    e.returnValue = '作业/考试内容可能未提交，确定离开？';
}

function xaUnloadGuardTick() {
    const need = routeHasQuestions(location.hash);
    if (need && !_xaUnloadOn) {
        window.addEventListener('beforeunload', _xaUnloadHandler);
        _xaUnloadOn = true;
    } else if (!need && _xaUnloadOn) {
        window.removeEventListener('beforeunload', _xaUnloadHandler);
        _xaUnloadOn = false;
    }
}

// ==================== 面板屏幕适配 ====================

// 位置钳制纯函数：把 (x,y) 收回视口内（与拖拽路径同规则，下/右边界贴边、负坐标收 0）。
// 拖拽过程中已有实时钳制，这里管的是「保存的定位在当前视口越界」——横竖旋转/窗口缩放后
// 恢复面板定位时的共同实现。vw/vh 参数化供测试注入。
function xaClampToViewport(x, y, w, h, vw, vh) {
    const maxX = Math.max(0, vw - w), maxY = Math.max(0, vh - h);
    return { x: Math.min(Math.max(x, 0), maxX), y: Math.min(Math.max(y, 0), maxY) };
}
