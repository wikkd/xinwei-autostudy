// ==================== 入口 ====================
// 防重复注入（同一页面脚本可能被加载多次）
if (window.xaScriptLoaded) return;
window.xaScriptLoaded = true;

// beeline 为 Vue SPA 整页渲染，不进 iframe
if (window.self !== window.top) return;

loadCfg();

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

// 启动「学习状态异常」弹窗自动刷新
initPopupAutoReload();

console.log('[XinweiAutoStudy] 已加载');
