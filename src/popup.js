// ==================== 学习状态异常弹窗自动刷新 ====================
// 平台弹出"系统检测到你的学习状态异常，请刷新后继续学习"时脚本无法操作，
// 检测到后自动刷新页面恢复；刷新后脚本按面板开关状态自动续跑。

function initPopupAutoReload() {
    const RELOAD_COOLDOWN = 20000; // 20s 冷却，防止刷新死循环
    setInterval(() => {
        const last = Number(GM_getValue('xa_last_reload_at', 0));
        if (Date.now() - last < RELOAD_COOLDOWN) return;
        const text = (document.body && document.body.innerText) || '';
        if (text.indexOf('学习状态异常') !== -1 || text.indexOf('请刷新后继续学习') !== -1) {
            GM_setValue('xa_last_reload_at', Date.now());
            console.log('[芯位] 检测到学习状态异常弹窗，3秒后自动刷新页面');
            setTimeout(() => { location.reload(); }, 3000);
        }
    }, 3000);
}
