// ==================== 自动刷课 ====================

let scriptStart = Date.now();
let cooldownUntil = 0;
let pptSince = 0;
let tick = 0;
let consecutiveJumps = 0;
let mainLoopId = null;

function isPowerPointFrame() {
    for (const f of document.querySelectorAll('iframe')) {
        if (f.src && f.src.includes('PowerPointFrame') && visible(f)) return true;
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
    if (now - scriptStart < CFG.MIN_WATCH * 1000) return false;
    const active = document.querySelector('li.el-menu-item.is-active');
    if (active) {
        if (active.querySelector('.inProgress-icon, .unStart-icon')) return false;
        const done = active.querySelector('.done-icon, .icon-done, .el-icon-check, .el-icon-circle-check, .el-icon-check-circle, .is-done');
        if (done && visible(done)) { console.log('[芯位] done-icon → 完成'); return true; }
    }
    if (isPowerPointFrame()) {
        if (pptSince === 0) pptSince = now;
        if (now - pptSince > CFG.PPT_TIMEOUT * 1000) { console.log('[芯位] PPT停留' + CFG.PPT_TIMEOUT + 's → 完成'); return true; }
    } else { pptSince = 0; }
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
