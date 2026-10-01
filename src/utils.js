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
    const muteEl = el => { if (muteEnabled && !el.muted) el.muted = true; };
    try {
        new MutationObserver(muts => {
            for (const m of muts) for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n instanceof HTMLMediaElement) muteEl(n);
                if (n.querySelectorAll) qsa('video, audio', n).forEach(muteEl);
            }
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
