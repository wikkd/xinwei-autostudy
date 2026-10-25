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

// ==================== API Key 加密保存（可选）====================
// GM 存储不再留明文密钥：口令经 PBKDF2(210k 迭代)派生 AES-GCM-256 密钥加密，盐/IV 每次随机，
// 密文记录 {v,s,i,c} 落 GM 存储，明文同时清除。口令只存 sessionStorage 复用——页面脚本读得到
// 口令，但读不到扩展 GM 存储里的密文，两者拼不到一起。
// 边界如实说明：解密后的密钥必须驻留内存供请求使用，本方案防的是存储侧直接翻看与浏览器
// 配置文件/同步泄露，防不了能读脚本内存或浏览器控制台的对手。crypto.subtle 需安全上下文（芯位为 https）。
async function xaEncEncrypt(pass, text) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 210000, hash: 'SHA-256' },
        await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']),
        { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
    const b64 = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    return { v: 1, s: b64(salt), i: b64(iv), c: b64(ct) };
}

// 解密失败（口令错误/记录损坏）统一返回 null，由调用方给出提示
async function xaEncDecrypt(pass, rec) {
    try {
        const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: unb64(rec.s), iterations: 210000, hash: 'SHA-256' },
            await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']),
            { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.i) }, key, unb64(rec.c));
        return new TextDecoder().decode(pt);
    } catch (e) { return null; }
}

// 本机设备密钥（自动加密模式）：首次调用随机生成 32 字节并存 GM，此后稳定复用。
// 安全边界：与密文同存一处——防的是存储被随手翻看/明文被一眼复制走；
// 防不了定向的整配置文件窃取（设备密钥跟着密文一起被拿走），那需要口令模式。
function xaDevKey() {
    let k = '';
    try { k = String(GM_getValue(SK.devKey, '') || ''); } catch (e) {}
    if (k) return k;
    const raw = crypto.getRandomValues(new Uint8Array(32));
    k = btoa(String.fromCharCode.apply(null, raw));
    try { GM_setValue(SK.devKey, k); } catch (e) {}
    return k;
}
