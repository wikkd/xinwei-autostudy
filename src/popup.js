// ==================== 学习状态异常弹窗自动刷新 ====================
// 平台风控弹窗出现时脚本无法操作，检测到后自动刷新页面恢复；刷新后按面板开关状态自动续跑。
// 三条服务端风控文案（2026-10-01 chunk 调研实锤，前端 0 命中→判定在服务端下发）：
//   ① 当前视频不允许倍速播放  ② 系统检测到你的学习状态异常，请刷新后继续学习  ③ 播放位置不合法
// 外加平台通用的「请刷新后继续学习」措辞兜底。
//
// 性能：快/慢双路径。快路径每 3s 只看可见弹窗节点（风控文案统一走 el-message-box，无弹窗零成本）；
// 全页 innerText 会强制样式重算+重排，降为 20s 一次的兜底扫描（弹窗实现变化时仍能捕获）。

function initPopupAutoReload() {
    const RELOAD_COOLDOWN = 20000; // 20s 冷却，防止刷新死循环
    const HINTS = ['学习状态异常', '请刷新后继续学习', '不允许倍速播放', '播放位置不合法'];
    const matchHit = t => HINTS.find(h => t.indexOf(h) !== -1);
    let slowAt = 0;
    const trigger = hit => {
        GM_setValue(SK.lastReload, Date.now());
        console.log('[芯位] 检测到平台风控弹窗（' + hit + '），3秒后自动刷新页面');
        setTimeout(() => { location.reload(); }, 3000);
    };
    setInterval(() => {
        const last = Number(GM_getValue(SK.lastReload, 0));
        if (Date.now() - last < RELOAD_COOLDOWN) return;
        // 快路径：可见弹窗的局部文本（只对已打开的少数节点读 innerText）
        for (const d of qsa('.el-message-box, .el-dialog, [role="dialog"]')) {
            if (!visible(d)) continue;
            const hit = matchHit(d.innerText || d.textContent || '');
            if (hit) { trigger(hit); return; }
        }
        // 慢路径：20s 一次全页兜底
        if (Date.now() - slowAt > 20000) {
            slowAt = Date.now();
            const hit = matchHit((document.body && document.body.innerText) || '');
            if (hit) trigger(hit);
        }
    }, 3000);
}
