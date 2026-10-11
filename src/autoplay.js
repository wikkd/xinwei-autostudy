// ==================== 自动刷课 ====================

let scriptStart = Date.now();
let cooldownUntil = 0;
let pptSince = 0;        // 进入静态课件的时间（就绪计时基准）
let pptReadyAt = 0;      // iframe 就绪时间（就绪后才开始计 DWELL）
let tick = 0;
let consecutiveJumps = 0;
let mainLoopId = null;
let tickTimer = null;    // 媒体事件驱动的提前 tick（后台节流兜底）
let navPending = null;   // 跳转落地校验 {from, at}
let navMisses = 0;
let stallRef = null;     // 卡死看门狗 {el, t}（t=最近一次进度前进时间）
let stallStage = 0;      // 0正常 1已尝试重播 2待 reload
let unlockWatchAt = 0;   // 解锁守望时间戳（到点静默刷新复查）

// 开放时间窗解析（「2026-10-04 至 2026-10-18」）：返回 {start, end} 毫秒时间戳；
// end 含当日全天（+86399999）。解析不出返回 null。
function parseExpirationRange(text) {
    const dates = String(text || '').match(/\d{4}-\d{2}-\d{2}/g);
    if (!dates || dates.length < 2) return null;
    const toTs = s => {
        const p = s.split('-').map(Number);
        return new Date(p[0], p[1] - 1, p[2]).getTime();
    };
    return { start: toTs(dates[0]), end: toTs(dates[1]) + 86399999 };
}

// 卡死阶梯决策（纯函数）：stuckSec=距最近进度前进的秒数。
// 返回 0=不动 1=重点播 2=reload。reload 前必须先经过一次重播（stage≥1）。
function stallDecision(stuckSec, stage, stallSec, reloadSec) {
    if (stuckSec >= reloadSec && stage >= 1) return 2;
    if (stuckSec >= stallSec && stage === 0) return 1;
    return 0;
}

// 当前节标题（frontend-map 实证：.courseWare__title > .title__text）
function currentSectionTitle() {
    const t = document.querySelector('.courseWare__title .title__text') || document.querySelector('.title__text');
    return t ? qtext(t) : '';
}

// 当前正在观看的主视频：首个可见且已有元数据（duration>0）的 video
function watchingVideo() {
    for (const v of document.querySelectorAll('video')) {
        if (!visible(v)) continue;
        if (v.duration > 0) return v;
    }
    return null;
}

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

// PPT/文档 iframe 是否就绪：防白页空跳（iframe 还在加载时页面几乎空白，停留判定无意义）。
// 同源判 readyState；跨域访问抛异常 → 视为已就绪（无法探测，不阻塞流程）
function pptReady() {
    for (const f of document.querySelectorAll('iframe')) {
        const src = (f.src || '').toLowerCase();
        if (!src || !/powerpointframe|ppt|slide|preview|doc|courseware|resource|office|viewer/.test(src)) continue;
        try {
            if (f.contentDocument && f.contentDocument.readyState !== 'complete') return false;
            return true;
        } catch (e) { return true; }
    }
    return false;
}

function openSidebarSwitch() {
    const btn = document.querySelector('.course-sidebar-switch');
    if (btn && visible(btn)) { btn.click(); return true; }
    return false;
}

// 锁定章盘点：区分「待解锁」与「已过期」。仅在可点节点全部扫完、准备停机前调用。
// pending：未到开放时间且内含未完成节（值得等待解锁）；expired：窗口已过或无法解析（放弃）
function lockedChapterStatus() {
    const pend = [], expired = [];
    qsa('.el-sub-menu.disable-menu').forEach(ch => {
        // 节完成态原始判定（不能用 menuItemIncomplete——它把锁定章整体排除）
        const items = qsa('li.el-menu-item-group, li.el-menu-item', ch);
        const hasTodo = items.some(li => li.querySelector('.inProgress-icon, .unStart-icon'));
        if (!hasTodo) return;
        const range = parseExpirationRange(qtext(ch.querySelector('.expiration-date')) || qtext(ch));
        const today0 = new Date(); today0.setHours(0, 0, 0, 0);
        if (!range) { pend.push({ at: Infinity, text: '未知' }); return; }
        if (range.start > today0.getTime()) {
            const d = new Date(range.start);
            pend.push({ at: range.start, text: (d.getMonth() + 1) + '-' + d.getDate() });
        } else if (range.end < today0.getTime()) {
            expired.push(1);
        } else {
            pend.push({ at: Date.now() + 3600000, text: '即将' }); // 窗口含今天但仍是锁定态（时序细节）→ 视为待解锁短守望
        }
    });
    return { pend, expired: expired.length };
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

    // 静态/PPT 课件：打开即算已观看。等 iframe 就绪后再计 DWELL（防白页空跳），
    // 迟迟不就绪则按「到达时间 + 宽限 + DWELL」兜底放行（可能本就是无 iframe 的静态页）
    if (isStaticOrPptSection()) {
        if (pptSince === 0) pptSince = now;
        if (!pptReadyAt && pptReady()) pptReadyAt = now;
        if (pptReadyAt) {
            if (now - pptReadyAt > CFG.PPT_DWELL * 1000) { console.log('[芯位] PPT/静态课件就绪停留' + CFG.PPT_DWELL + 's → 完成'); return true; }
            return false;
        }
        if (now - pptSince > (CFG.PPT_LOAD_GRACE_MS + CFG.PPT_DWELL * 1000)) { console.log('[芯位] PPT 就绪宽限已过 → 放行'); return true; }
        return false;
    }
    pptSince = 0; pptReadyAt = 0;

    // 视频完成判定（需满足最少观看时长，防止过早跳章）。
    // 阈值取 WATCH_DONE_PCT(96%)：平台规则「需观看 95% 计入完成」，同时覆盖流尾部挂起
    // （卡在 99.x% 永不 ended）的场景；若平台不认，本节会仍显示未完成，被回溯逻辑重新扫到自愈
    if (now - scriptStart < CFG.MIN_WATCH * 1000) return false;
    for (const v of document.querySelectorAll('video')) {
        if (!visible(v)) continue;
        if (v.duration > 0 && (v.ended || v.currentTime >= v.duration * CFG.WATCH_DONE_PCT)) {
            console.log('[芯位] 视频观看达 ' + Math.round(CFG.WATCH_DONE_PCT * 100) + '% → 完成');
            return true;
        }
    }
    return false;
}

// ===== 视频卡死看门狗 =====
// 夜间挂机最大失败源：缓冲卡住 currentTime 不前进，keepPlay 的 play() 救不回。
// 阶梯恢复：连续 STALL_SEC 无进度 → 点播放键重播；仍无进度到 STALL_RELOAD_SEC → 静默 reload。
// 弹题/答题浮层出现时不判定（平台刻意的暂停，见 utils.interactiveOverlay）。
function videoStallCheck() {
    const now = Date.now();
    const vid = watchingVideo();
    if (!vid || vid.ended || isStaticOrPptSection() || interactiveOverlay()) {
        stallRef = { el: vid, t: now }; stallStage = 0;
        return;
    }
    // 已到完成阈值：跳转在即，不算卡死
    if (vid.currentTime >= vid.duration * CFG.WATCH_DONE_PCT) { stallRef = { el: vid, t: now }; stallStage = 0; return; }
    if (!stallRef || stallRef.el !== vid) { stallRef = { el: vid, t: now }; stallStage = 0; return; }
    if (Math.abs(vid.currentTime - (stallRef.lastTime || 0)) > 0.05) {
        stallRef = { el: vid, t: now, lastTime: vid.currentTime };
        stallStage = 0;
        return;
    }
    stallRef.lastTime = vid.currentTime;
    const stuck = (now - stallRef.t) / 1000;
    const act = stallDecision(stuck, stallStage, CFG.STALL_SEC, CFG.STALL_RELOAD_SEC);
    if (act === 1) {
        stallStage = 1;
        XIA_AI.log('⏳ 视频 ' + CFG.STALL_SEC + 's 无进度，尝试恢复播放…', 'info');
        const btn = qsa('.vjs-play-control').find(visible);
        if (btn) { try { btn.click(); } catch (e) {} }
        try { vid.play().catch(() => {}); } catch (e) {}
        return;
    }
    if (act === 2) {
        const last = Number(GM_getValue(SK.lastReload, 0));
        if (Date.now() - last < 20000) return; // 刷新冷却中（如风控恢复刚刷新过）：保持 stage，等冷却
        stallStage = 0;
        GM_setValue(SK.lastReload, Date.now());
        XIA_AI.log('🔄 视频 ' + CFG.STALL_RELOAD_SEC + 's 无进度且重播无效，自动刷新页面恢复', 'error');
        try { location.reload(); } catch (e) {}
    }
}

// ===== 跳转落地校验 =====
// 点击后标题长时间不变 = 点击被静默拦截（锁定节/渲染异常）→ 冷却后重试，连续 3 次暂停 60s。
// 把「静默重试」变成日志可见的状态。
const NAV_VERIFY_MS = 8000;
function noteNavPending() {
    navPending = { from: currentSectionTitle(), at: Date.now() };
}
function verifyNavLanding() {
    if (!navPending) return;
    if (Date.now() - navPending.at < NAV_VERIFY_MS) return;
    const nowT = currentSectionTitle();
    if (!navPending.from || (nowT && nowT !== navPending.from)) { navPending = null; navMisses = 0; return; } // 已切换或无基准可比
    navPending = null;
    navMisses++;
    if (navMisses <= 2) {
        console.log('[芯位] 跳转后 8s 标题未变化（拦截/加载慢），冷却后重试');
        cooldownUntil = Date.now() + 8000;
    } else {
        navMisses = 0;
        XIA_AI.log('⚠️ 连续跳转未生效（可能节点被锁或渲染异常），暂停 60s 重试', 'error');
        cooldownUntil = Date.now() + 60000;
    }
}

// ===== 解锁守望 =====
// 满足条件：可点节点全部完成，但存在「未到开放时间」的章（内含未完成节）→ 不误报「挂机完成」，
// 记录守望状态 {at: 下次检查时间戳, unlockTs: 已知最早解锁时间(0=未知), tries: 盲查次数}。
// 已知解锁时间：每 UNLOCK_CHECK_MS 顺延检查，到解锁日才刷新页面复查；
// 未知解锁时间：每 UNLOCK_UNKNOWN_MS 盲刷新复查，上限 UNLOCK_UNKNOWN_MAX 次后停止告知人工。
// 真正跳转成功后清除守望（有节可刷就不需要）。
const UNLOCK_UNKNOWN_MS = 30 * 60 * 1000;
const UNLOCK_UNKNOWN_MAX = 3;
let _uwLoaded = false;
function _uwLoad() {
    try {
        const o = JSON.parse(GM_getValue(SK.unlockWatch, '0'));
        return (o && o.at) ? o : null;
    } catch (e) { return null; }
}
function _uwSave(o) {
    try { GM_setValue(SK.unlockWatch, JSON.stringify(o || 0)); } catch (e) {}
}
function unlockWatchClear() {
    unlockWatchAt = 0;
    _uwSave(0);
}
function checkUnlockWatch() {
    if (!_uwLoaded) { // 每会话从存储恢复一次（内存快路径，避免每 tick 读 GM）
        _uwLoaded = true;
        const w0 = _uwLoad();
        if (w0) unlockWatchAt = w0.at;
    }
    if (!unlockWatchAt || Date.now() < unlockWatchAt) return;
    const w = _uwLoad();
    if (!w) { unlockWatchAt = 0; return; }
    if (w.unlockTs && Date.now() < w.unlockTs) { // 已知解锁日未到：顺延，不做无谓刷新
        const at = Date.now() + CFG.UNLOCK_CHECK_MS;
        _uwSave({ at: at, unlockTs: w.unlockTs, tries: w.tries || 0 });
        unlockWatchAt = at;
        return;
    }
    if (!w.unlockTs) { // 解锁时间未知：盲刷新复查，限次防刷新风暴
        const tries = (w.tries || 0) + 1;
        if (tries > UNLOCK_UNKNOWN_MAX) {
            unlockWatchAt = 0; _uwSave(0);
            XIA_AI.log('⏳ 无法确定章节解锁时间，盲查 ' + UNLOCK_UNKNOWN_MAX + ' 次仍未解锁，已停止守望。请手动查看课程章节开放时间', 'error');
            XIA_AI.progress('⏳ 未知解锁时间，守望停止');
            return;
        }
        _uwSave({ at: Date.now() + UNLOCK_UNKNOWN_MS, unlockTs: 0, tries: tries });
        XIA_AI.log('⏳ 章节开放时间未知，刷新页面复查（第 ' + tries + '/' + UNLOCK_UNKNOWN_MAX + ' 次）…', 'info');
        try { location.reload(); } catch (e) {}
        return;
    }
    unlockWatchAt = 0; // 解锁日已到：刷新页面让菜单按新时间窗重渲染
    _uwSave(0);
    XIA_AI.log('⏰ 章节解锁时间已到，刷新页面复查开放状态…', 'info');
    try { location.reload(); } catch (e) {}
}

function clickNextChapter() {
    const rights = document.querySelectorAll('.right, div.right');
    for (const r of rights) {
        if (!visible(r)) continue;
        const t = r.textContent || '';
        const clickable = !!r.closest('button, a, [role="button"], [class*="btn"], [class*="Btn"]');
        // 严格短语（完整「观看下一章节」）或按钮类元素上的宽短语（下一节/下一集）
        if (!/观看下一章节/.test(t) && !(clickable && /下一章节|下一节|下一集/.test(t))) continue;
        setTimeout(() => {
            const target = r.closest('button, a, [role="button"], [class*="btn"], [class*="Btn"]') || r;
            target.click();
        }, 800 + Math.random() * 1000);
        console.log('[芯位] 点击 "观看下一章节" 按钮');
        cooldownUntil = Date.now() + CFG.COOLDOWN * 1000;
        pptSince = 0; pptReadyAt = 0; consecutiveJumps++;
        stallRef = null; stallStage = 0;
        noteNavPending();
        unlockWatchClear();
        return true;
    }
    return false;
}

function navigateToNextSection() {
    openSidebarSwitch();
    const active = document.querySelector('li.el-menu-item.is-active');
    if (!active) { console.log('[芯位] 无高亮节点'); return false; }
    // 菜单渲染完整性守卫：目录一个节都没渲染出来时不做「全部完成」判断，防误停机
    const allItems = document.querySelectorAll('li.el-menu-item');
    if (allItems.length <= 1) { console.log('[芯位] 菜单未就绪，等待下次扫描'); return false; }
    // 优先跳下一个「未完成」章节（inProgress/unStart 图标），跳过已完成的不重看
    let next = findNextMenuItem(active, menuItemIncomplete);
    if (!next) {
        // 当前节之后全部完成：回溯菜单开头找漏网未完成章节（断点续刷场景）。
        // 回溯走 menuItemIncomplete 过滤（含锁定章排除），不会命中 disable-menu 内的节
        for (const li of allItems) {
            if (li === active || li.classList.contains('is-active')) continue;
            if (menuItemIncomplete(li)) { next = li; break; }
        }
        if (next) console.log('[芯位] 后方已全部完成，回溯到未完成章节');
    }
    if (!next) {
        // 可点节点全部完成。先盘点锁定章：有「未到开放时间」的章 → 解锁守望，不误报挂机完成
        const lock = lockedChapterStatus();
        if (lock.pend.length) {
            const earliest = lock.pend.reduce((m, p) => Math.min(m, p.at), Infinity);
            const unlockTs = earliest === Infinity ? 0 : earliest;
            const et = unlockTs ? ('最早 ' + (new Date(unlockTs).getMonth() + 1) + '-' + new Date(unlockTs).getDate()) : '未知时间';
            if (!unlockWatchAt) {
                unlockWatchAt = Date.now() + CFG.UNLOCK_CHECK_MS;
                _uwSave({ at: unlockWatchAt, unlockTs: unlockTs });
                XIA_AI.log('⏳ 可见章节已全部完成，仍有 ' + lock.pend.length + ' 个章未到开放时间（' + et + '解锁），'
                    + '进入守望模式（解锁后自动刷新续刷；其间每分钟轻量复查）', 'ok');
                XIA_AI.progress('⏳ 等章节解锁（' + et + '）');
            }
            cooldownUntil = Date.now() + 60000; // 守望期每分钟轻量复查
            return false;
        }
        console.log('[芯位] 目录内未发现未完成章节');
        unlockWatchClear();
        XIA_AI.log('✅ 侧边栏内未发现未完成章节，挂机完成，已自动停止'
            + (lock.expired ? '（另有 ' + lock.expired + ' 章已过期无法完成，属正常）' : ''), 'ok');
        XIA_AI.progress('✅ 课程已全部完成');
        stopAuto();
        conf.autoPlay = false;
        try { GM_setValue(SK.autoPlay, false); } catch (e) {}
        const sw = document.querySelector('#xa-autoplay-switch');
        if (sw) sw.classList.remove('on');
        return false;
    }
    const cur = (active.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    const nxt = (next.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    console.log('[芯位] 穿透搜索: "' + cur + '" → "' + nxt + '"');
    ensureVisible(next);
    setTimeout(() => {
        if (!visible(next)) ensureVisible(next);
        next.click();
        cooldownUntil = Date.now() + CFG.COOLDOWN * 1000;
        pptSince = 0; pptReadyAt = 0; consecutiveJumps++;
        stallRef = null; stallStage = 0;
        noteNavPending();
        unlockWatchClear();
        console.log('[芯位] 点击完成');
    }, 400 + Math.random() * 400);
    return true;
}

// 媒体事件驱动的提前 tick：Chrome 后台标签页 5 分钟后 setInterval 节流到约 1 次/分钟，
// 而媒体事件（ended/loadedmetadata）不受节流——视频放完/新源加载时立刻推进状态机，
// 保证后台挂机也能连续跳章（前台运行时与主循环互为补充，scheduleTick 去重）
function scheduleTick(delay) {
    if (tickTimer || !mainLoopId) return;
    tickTimer = setTimeout(() => {
        tickTimer = null;
        if (mainLoopId) mainTick();
    }, delay || 400);
}
let _vidHooksInstalled = false;
function installVideoHooks() {
    if (_vidHooksInstalled) return;
    _vidHooksInstalled = true;
    const hook = v => {
        if (!v || v.__xaHooked) return;
        v.__xaHooked = true;
        v.addEventListener('ended', () => scheduleTick(300));          // 放完 → 立即走完成判定/跳章
        v.addEventListener('loadedmetadata', () => scheduleTick(500)); // 新节新源 → 尽快催播
        v.addEventListener('play', () => scheduleTick(1500));          // 开始播放 → 刷新卡死基准
    };
    document.querySelectorAll('video').forEach(hook);
    // SPA 换节会频繁重建播放器 DOM；rAF 合并一帧内的全部新增节点再挂载（挂机外零开销）
    let pending = null;
    try {
        new MutationObserver(muts => {
            for (const m of muts) for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.tagName === 'VIDEO') { (pending || (pending = [])).push(n); }
                if (n.querySelectorAll) qsa('video', n).forEach(v => (pending || (pending = [])).push(v));
            }
            if (!pending) return;
            const batch = pending;
            pending = null;
            requestAnimationFrame(() => batch.forEach(hook));
        }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
}

// ===== 面板课程进度（X/Y 节 · 剩余视频时长估算）=====
// 数据源：侧边栏目录（frontend-map 3.3 实证结构）。
//   节数：.section-area 所在 li（排除锁定章 .disable-menu）；
//   剩余时长：未完成节（inProgress/unStart 图标）的时长文本（mm:ss / h:mm:ss）求和，按 1x 播放估算。
// 未展开章的节不在 DOM 里（计入会偏小），无法读到目录时整行隐藏；10s 缓存防每 tick 全量解析。
let _progCacheAt = 0, _progCacheText = '';
function updateCourseProgress() {
    const el = document.getElementById('xa-course-progress');
    if (!el) return;
    const now = Date.now();
    if (now - _progCacheAt < 10000) {
        if (_progCacheText) el.textContent = _progCacheText;
        return;
    }
    _progCacheAt = now;
    _progCacheText = '';
    const secs = qsa('.section-area').map(sa => sa.closest('li')).filter(li => li && !(li.closest && li.closest('.el-sub-menu.disable-menu')));
    if (secs.length < 2) { el.style.display = 'none'; return; }
    let done = 0, remainSec = 0;
    for (const li of secs) {
        const complete = !!li.querySelector('.done-icon, .icon-done, .el-icon-check, .el-icon-circle-check, .el-icon-check-circle, .is-done');
        if (complete) { done++; continue; }
        if (!li.querySelector('.inProgress-icon, .unStart-icon')) continue; // PPT/文档等无完成态的节不计时长
        const txt = qtext(li.querySelector('.section-area') || li);
        const m = txt.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/g);
        if (!m) continue;
        const parts = m[m.length - 1].split(':').map(Number); // 取最后一段匹配（时长通常在节名之后）
        remainSec += parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    }
    let text = '📚 课程进度 ' + done + '/' + secs.length + ' 节';
    if (remainSec > 0) {
        const h = Math.floor(remainSec / 3600), mnt = Math.floor((remainSec % 3600) / 60);
        const est = h > 0 ? h + ' 小时' + (mnt > 0 ? ' ' + mnt + ' 分' : '') : (mnt > 0 ? mnt + ' 分' : '<1 分');
        text += ' · 剩余视频约 ' + est + '（按 1x 计）';
    }
    _progCacheText = text;
    el.textContent = text;
    el.style.display = '';
}

function mainTick() {
    tick++;
    muteAll();
    keepPlay();
    verifyNavLanding();
    videoStallCheck();
    checkUnlockWatch();
    if (tick % 4 === 0) updateCourseProgress();
    if (tick % 10 === 0) {
        const active = document.querySelector('li.el-menu-item.is-active');
        const cur = active ? (active.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20) : '(无)';
        const cd = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        const vid = watchingVideo();
        const pct = vid && vid.duration > 0 ? Math.floor(vid.currentTime / vid.duration * 100) : null;
        console.log('[芯位] #' + tick + ' | 当前: "' + cur + '"' + (pct != null ? ' | 已观看 ' + pct + '%' : '') + ' | cd=' + cd + 's | 连跳=' + consecutiveJumps);
        // 面板进度：仅在答题/扫描/配置告警/确认等待闲置时由挂机更新（避免覆盖 📋/📡/⛔/⏸ 等关键信息）
        const pel = document.getElementById('xa-progress');
        const ptxt = pel ? (pel.textContent || '') : '';
        if (!XIA_AI.answering && !XIA_AI.answeringOnce && !XIA_AI._cfgError && ptxt.indexOf('⏳') !== 0 && ptxt.indexOf('⏸') !== 0) {
            XIA_AI.progress('▶ ' + cur + (pct != null ? ' · 已观看 ' + pct + '%' : ''));
        }
    }
    // 题目扫描由 ui.js 的 startAIScan 定时器驱动（自动答题开启时常驻），此处不再重复调用
    if (!isSectionComplete()) { consecutiveJumps = 0; return; }
    if (Date.now() < cooldownUntil) return;
    if (consecutiveJumps >= 3) { console.log('[芯位] 连续跳转' + consecutiveJumps + '次，暂停50s'); cooldownUntil = Date.now() + 50000; consecutiveJumps = 0; return; }
    console.log('[芯位] 触发跳转');
    if (clickNextChapter()) return;
    // 兜底跳转回调可能有多个排队（章节完成状态会持续几个 tick，每 tick 都排一个）。
    // 任何一次成功跳转都会设置 cooldownUntil（+15s），迟到的回调检查到冷却即作废——
    // 否则多个排队回调接连执行 clickNextChapter/navigateToNextSection，落到新章节后被立刻再跳一次（连跳2次bug）
    setTimeout(() => {
        if (Date.now() < cooldownUntil) return;
        if (!clickNextChapter()) navigateToNextSection();
    }, 5000);
}

function startAuto() {
    if (mainLoopId) return;
    installVideoHooks();
    mainLoopId = setInterval(mainTick, CFG.INTERVAL * 1000);
    setStatus('正在运行', 'running');
    console.log('[芯位] 自动刷课已启动');
    XIA_AI.log('🚀 自动挂机已启动，每 ' + CFG.INTERVAL + ' 秒扫描一次页面', 'ok');
}

function stopAuto() {
    if (mainLoopId) { clearInterval(mainLoopId); mainLoopId = null; }
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    setStatus('已暂停', 'paused');
    console.log('[芯位] 自动刷课已停止');
    XIA_AI.log('⏸ 挂机已停止', 'info');
}
