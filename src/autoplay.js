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
    if (XA_SITE === 'chaoxing') { CX.tick(); return; } // 超星：视频由播放器帧驱动，top 只静音兜底
    muteAll();
    keepPlay();
    if (tick % 10 === 0) {
        const active = document.querySelector('li.el-menu-item.is-active');
        const cur = active ? (active.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20) : '(无)';
        const cd = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        console.log('[芯位] #' + tick + ' | 当前: "' + cur + '" | cd=' + cd + 's | 连跳=' + consecutiveJumps);
    }
    // 题目扫描由 ui.js 的 startAIScan 定时器驱动（自动答题开启时常驻），此处不再重复调用
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
