// ==================== 入口 ====================
// 防重复注入（同一页面脚本可能被加载多次）
if (window.xaScriptLoaded) return;
window.xaScriptLoaded = true;

// beeline 为 Vue SPA 整页渲染，不进 iframe
if (window.self !== window.top) return;

loadCfg();

// 页面动画冻结（省电）：全页 CSS 动画/过渡近零时长，默认启用。机制与取舍见 utils.xaFreezePageAnim
xaFreezePageAnim();

// 竖屏适配：视口 ≤1199px 时解锁布局层 min-width:1200px 硬墙并收敛头部。见 utils.xaPortraitCSS
xaPortraitCSS();

// 构建并挂载 UI
buildPanel();
makeDraggable(panel, panel.querySelector('.xa-header'));
makeDraggable(mini, mini);
bindUI();

// 恢复上一次的最小化状态
if (GM_getValue(SK.minimized, false)) {
    panel.classList.add('xa-hidden');
    mini.classList.add('show');
}

installMute();
muteAll();

// MIT 一句话提示（替代原拦截式免责弹窗）
XIA_AI.log('本脚本以 MIT 协议开源发布，详见仓库 LICENSE。请遵守平台规则与当地法律使用。', 'info');

// 启动「学习状态异常」弹窗自动刷新 + 视频内弹题自动作答 + 作业截止提醒
initPopupAutoReload();
initMarkerQuestion();
initDeadlineWatch();

// 常驻周期任务归一到单心跳（1s 驱动，各任务自带周期与 gate）：草稿防丢 5s 轻扫（纯本地）、
// 作业/考试页防误关 3s 跟随路由装卸；风控弹窗/弹题/截止提醒在各自 init 里注册
xaHeartbeat(xaDraftWatchTick, 5000);
xaHeartbeat(xaUnloadGuardTick, 3000);
setInterval(xaHeartTick, 1000);

console.log('[XinweiAutoStudy] 已加载 v__XA_VERSION__ (build __XA_BUILD__)');
