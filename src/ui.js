// ==================== 悬浮控制面板 UI ====================

const PANEL_CSS = `
#xa-panel{position:fixed;top:16px;left:16px;width:min(300px, calc(100vw - 20px));background:#fff;border-radius:14px;
  box-shadow:0 10px 32px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);z-index:99999;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;transition:opacity .25s,transform .25s;}
#xa-panel.xa-hidden{opacity:0;transform:scale(.85);pointer-events:none;}
.xa-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:15px;font-weight:700;letter-spacing:.5px;cursor:move;user-select:none;}
.xa-min-btn{width:22px;height:22px;border-radius:6px;border:none;background:rgba(255,255,255,.2);
  color:#fff;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;}
.xa-min-btn:hover{background:rgba(255,255,255,.35);}
.xa-tabs{display:flex;background:#f9fafb;border-bottom:1px solid #e5e7eb;}
.xa-tab{flex:1;padding:9px 4px;font-size:12px;font-weight:600;color:#6b7280;text-align:center;cursor:pointer;transition:all .15s;border-bottom:2px solid transparent;}
.xa-tab:hover{color:#3b82f6;}
.xa-tab.active{color:#3b82f6;border-bottom-color:#3b82f6;background:#fff;}
.xa-body{padding:14px;display:flex;flex-direction:column;gap:10px;max-height:min(640px, calc(100vh - 110px));overflow-y:auto;}
.xa-tab-pane{display:none;flex-direction:column;gap:10px;}
.xa-tab-pane.active{display:flex;}
.xa-status{font-size:12px;color:#6b7280;text-align:center;padding:6px 8px;border-radius:6px;background:#f3f4f6;transition:color .2s,background .2s;}
.xa-status.running{color:#059669;background:#d1fae5;}
.xa-status.paused{color:#d97706;background:#fef3c7;}
.xa-btn{width:100%;padding:9px 0;border:none;border-radius:10px;font-size:13px;font-weight:600;
  cursor:pointer;transition:all .2s;letter-spacing:.3px;color:#fff;}
.xa-btn:disabled{opacity:.55;cursor:wait;}
.xa-once{background:linear-gradient(135deg,#0ea5e9,#06b6d4);}
.xa-once:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xa-once:active{transform:scale(.97);}
.xa-about{font-size:12px;color:#374151;line-height:1.8;max-height:350px;overflow-y:auto;
  padding-right:4px;word-break:break-word;}
.xa-about h4{font-size:14px;color:#1e40af;margin:0 0 6px;}
.xa-about p{margin:0 0 8px;}
.xa-stop{background:#f3f4f6;color:#374151;}
.xa-stop:hover{background:#e5e7eb;}
.xa-mute{background:#f3f4f6;color:#374151;}
.xa-mute:hover{background:#e5e7eb;}
.xa-mute.muted{background:#fee2e2;color:#dc2626;}
.xa-input{width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;
  font-family:inherit;outline:none;transition:border-color .2s;box-sizing:border-box;}
.xa-input:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.12);}
.xa-ai-inputs{display:flex;flex-direction:column;gap:8px;}
.xa-row{display:flex;align-items:center;gap:8px;}
.xa-switch{position:relative;width:42px;height:22px;border-radius:11px;background:#d1d5db;cursor:pointer;transition:background .2s;flex-shrink:0;}
.xa-switch.on{background:linear-gradient(135deg,#10b981,#059669);}
.xa-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .2s;}
.xa-switch.on::after{transform:translateX(20px);}
.xa-led{display:inline-block;width:8px;height:8px;border-radius:50%;background:#9ca3af;margin-right:6px;vertical-align:middle;}
.xa-led.ok{background:#10b981;box-shadow:0 0 6px rgba(16,185,129,.6);}
.xa-led.err{background:#dc2626;}
.xa-ai-log{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px;font-size:11px;
  font-family:'SF Mono','Menlo','Consolas',monospace;height:240px;min-height:140px;max-height:480px;
  resize:vertical;overflow-y:auto;line-height:1.5;}
.xa-ai-log::-webkit-scrollbar{width:4px;}
.xa-ai-log::-webkit-scrollbar-thumb{background:#475569;border-radius:2px;}
#xa-mini{position:fixed;top:16px;left:16px;width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:18px;font-weight:700;
  display:none;align-items:center;justify-content:center;cursor:move;z-index:99999;
  box-shadow:0 4px 16px rgba(59,130,246,.35);transition:transform .2s;user-select:none;}
#xa-mini:hover{transform:scale(1.1);}
#xa-mini.show{display:flex;}
.xa-sec{font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:.5px;margin:2px 0 -2px;}
.xa-btnrow{display:flex;gap:8px;}
.xa-btnrow .xa-btn{flex:1;padding:8px 0;font-size:12px;letter-spacing:0;}
.xa-progress{font-size:11px;color:#2563eb;background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;
  padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xa-stats{font-size:11px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
  padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xa-deadline{font-size:11px;line-height:1.6;color:#b45309;background:#fffbeb;border:1px solid #fde68a;
  border-radius:8px;padding:6px 8px;word-break:break-word;}
.xa-deadline.urgent{color:#b91c1c;background:#fef2f2;border-color:#fecaca;}
.xa-loghead{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#6b7280;font-weight:700;}
.xa-loghead button{border:none;background:#f3f4f6;color:#6b7280;font-size:11px;border-radius:6px;padding:3px 10px;cursor:pointer;transition:background .2s;}
.xa-loghead button:hover{background:#e5e7eb;color:#374151;}
`;

let panel = null;
let mini = null;
let statusEl = null;
let aiLed = null;
let aiStatusText = null;

function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'xa-status' + (cls ? ' ' + cls : '');
}

function setAIStatus(type, text) {
    if (!aiLed || !aiStatusText) return;
    if (type === true) aiLed.className = 'xa-led ok';
    else if (type === false) aiLed.className = 'xa-led err';
    else aiLed.className = 'xa-led';
    aiStatusText.textContent = text || '';
}

// 面板/迷你球位置持久化（按元素 id 分别记录）
function restorePos(el) {
    try {
        const all = JSON.parse(GM_getValue(SK.panelPos, '{}'));
        const p = all && all[el.id];
        if (p && typeof p.l === 'number') {
            el.style.left = p.l + 'px';
            el.style.top = p.t + 'px';
            clampPos(el, el.id === 'xa-mini' ? 44 : 300, el.id === 'xa-mini' ? 44 : 160);
        }
    } catch (e) {}
}

// 越界钳制：横竖旋转/窗口缩放后，保存的定位可能落在当前视口之外（面板"消失"）。
// 显示中的元素量实际尺寸；隐藏的（迷你球 display:none）用兜底尺寸。变了才写回并落盘。
function clampPos(el, fallbackW, fallbackH) {
    try {
        const l = parseInt(el.style.left) || 0, t = parseInt(el.style.top) || 0;
        const p = xaClampToViewport(l, t, el.offsetWidth || fallbackW, el.offsetHeight || fallbackH,
            window.innerWidth, window.innerHeight);
        if (p.x !== l || p.y !== t) {
            el.style.left = p.x + 'px';
            el.style.top = p.y + 'px';
            savePos(el);
        }
    } catch (e) {}
}
function savePos(el) {
    try {
        const all = JSON.parse(GM_getValue(SK.panelPos, '{}'));
        all[el.id] = { l: parseInt(el.style.left) || 0, t: parseInt(el.style.top) || 0 };
        GM_setValue(SK.panelPos, JSON.stringify(all));
    } catch (e) {}
}

function buildPanel() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'xa-panel';
    panel.innerHTML = `
<div class="xa-header"><span>芯位网课辅助 <span id="xa-ver" style="opacity:.85;font-size:11px;font-weight:500;"></span></span><button class="xa-min-btn" title="最小化">−</button></div>
<div class="xa-tabs">
  <div class="xa-tab active" data-tab="cfg">挂机</div>
  <div class="xa-tab" data-tab="ai">答题</div>
  <div class="xa-tab" data-tab="about">ℹ 关于</div>
</div>
<div class="xa-body">
  <!-- Tab 1: 挂机配置 -->
  <div class="xa-tab-pane active" data-pane="cfg">
    <div class="xa-status" id="xa-status">状态：就绪</div>
    <div class="xa-stats" id="xa-course-progress" style="display:none;"></div>
    <div class="xa-deadline" id="xa-deadline" style="display:none;"></div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">全自动刷课</span>
      <div class="xa-switch" id="xa-autoplay-switch" title="开启自动刷课"></div>
    </div>
    <button class="xa-btn xa-mute">关闭静音</button>
    <button class="xa-btn xa-stop" id="xa-deadline-btn" title="立即检查全部在学课程的未完成作业截止时间（平时每 30 分钟自动检查）">检查作业截止</button>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">后台桌面通知</span>
      <div class="xa-switch" id="xa-notify-switch" title="页面在后台时，巡航完成/待人工/配置熔断/截止临近等事件弹系统通知；前台不打扰，纯本地无网络外发"></div>
    </div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">运行时段</span>
      <input class="xa-input" id="xa-schedule" type="text" placeholder="HH:MM-HH:MM，空=全天" style="width:150px;padding:5px 8px;" title="仅在该时段内执行自动刷课/自动答题（支持跨零点如 23:00-07:00）。时段外自动功能暂停，手动操作不受影响。" />
    </div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">暗色护眼</span>
      <div class="xa-switch" id="xa-dark-switch" title="护眼暗色：覆盖平台浅色变量与硬编码背景，视频/图片不受影响。首版覆盖面有限，漏网的刺眼区域欢迎截图反馈"></div>
    </div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">降画质省性能</span>
      <div class="xa-switch" id="xa-eco-switch" title="每个视频自动选最低画质档：大幅降解码 CPU 与带宽（平台本就有画质菜单，切换属正常行为，不碰风控）。想看清视频时关闭"></div>
    </div>
  </div>
  <!-- Tab 2: AI 答题 -->
  <div class="xa-tab-pane" data-pane="ai">
    <div class="xa-status" id="xa-ai-status"><span class="xa-led" id="xa-ai-led"></span><span id="xa-ai-status-text">等待配置 Key</span></div>
    <div class="xa-progress" id="xa-progress">待机中</div>
    <div class="xa-stats" id="xa-stats">已答 0 · 已提交 0</div>
    <div class="xa-sec">接口配置</div>
    <div class="xa-ai-inputs">
      <input class="xa-input" id="xa-apikey" type="password" placeholder="API Key（sk-xxxxxxxx）" />
      <input class="xa-input" id="xa-apibase" type="text" placeholder="API Base（https://api.deepseek.com）" />
      <input class="xa-input" id="xa-model" type="text" placeholder="模型名（deepseek-reasoner / deepseek-chat / gpt-4o-mini）" />
      <input class="xa-input" id="xa-vision-model" type="text" placeholder="视觉模型（选填，题干带图时用，如 Qwen/Qwen2.5-VL-72B-Instruct）" />
    </div>
    <button class="xa-btn xa-stop" id="xa-health" title="向当前端点发一条最小请求，测 Key / 模型名 / 连通性与延迟；只做检查，不改变运行状态">测试连接</button>
    <div class="xa-sec">检索增强</div>
    <div class="xa-ai-inputs">
      <select class="xa-input" id="xa-search-mode">
        <option value="off">检索：关闭</option>
        <option value="auto">检索：自动（事实/时事题）</option>
        <option value="always">检索：总是</option>
      </select>
    </div>
    <div class="xa-btnrow">
      <button class="xa-btn xa-once" id="xa-answer-once" title="只答当前这一题">答题</button>
      <button class="xa-btn xa-stop" id="xa-cruise" title="打开本课程作业列表并自动逐份完成">巡航</button>
      <button class="xa-btn xa-stop" id="xa-test-grab" title="测试题目抓取">抓取</button>
      <button class="xa-btn xa-stop" id="xa-diagnose" title="dump 题目 DOM 结构">诊断</button>
    </div>
    <div class="xa-sec">自动模式</div>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autoanswer-switch" title="开启自动答题+作业巡航"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">自动答题+跳题+作业巡航</span>
    </div>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autosubmit-switch" title="全部答完后自动提交作业（含未答题保护）"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">答完自动提交作业</span>
    </div>
    <div class="xa-row">
      <div class="xa-switch" id="xa-confirm-switch" title="AI 填完答案即暂停：人工核对后自行翻题/提交，脚本不代跳不代交"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">答题确认（填完暂停待核对）</span>
    </div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">答题间隔（秒）</span>
      <input class="xa-input" id="xa-answer-delay" type="number" min="0" max="600" step="1" style="width:76px;padding:5px 8px;" title="每答完一题后等待的秒数再答下一题，0 = 不等待" />
    </div>
  </div>
  <!-- Tab 3: 关于 -->
  <div class="xa-tab-pane" data-pane="about">
    <div class="xa-about">
      <h4>关于本脚本</h4>
      <p>本脚本以 <strong>MIT 协议</strong>开源发布，源码与构建流程完全公开，详见仓库 LICENSE 与 README。</p>
      <h4>1. 为什么没有内置 AI？</h4>
      <p>为了避免密钥泄露风险并长期维护，脚本采用<strong>【单机自填版】</strong>：你需要在面板里填写自己的大模型 API Key（如 DeepSeek、SiliconFlow 等）。脚本不会上报任何数据。</p>
      <h4>2. 推荐的白嫖方案</h4>
      <p>新用户可在 <strong>硅基流动 (SiliconFlow)</strong>、<strong>DeepSeek 官方</strong> 等平台注册，通常会获赠大量免费 Token，足够完成课程学习。</p>
      <h4>3. 友情提示</h4>
      <p>本脚本仅供计算机自动化技术交流与学习，请在遵守平台规则与当地法律的前提下使用。AI 不保证 100% 正确率，刷完课建议自行复习一遍，使用风险请自行承担。</p>
      <h4>4. 反馈与更新</h4>
      <p>代码由社区协作维护。遇到 bug 可在 GitHub Issues 反馈。网课平台经常改版，若某天失效我会跟进修复。</p>
    </div>
  </div>
  <!-- 共享日志框 -->
  <div class="xa-loghead"><span>运行日志</span><span><button id="xa-copy-log">复制</button> <button id="xa-clear-log">清空</button></span></div>
  <div class="xa-ai-log" id="xa-ai-log"><div style="color:#94a3b8;">等待操作...</div></div>
</div>`;
    document.body.appendChild(panel);
    restorePos(panel);
    const ver = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) ? 'v' + GM_info.script.version : '';
    const verEl = panel.querySelector('#xa-ver');
    if (verEl && ver) verEl.textContent = ver;

    mini = document.createElement('div');
    mini.id = 'xa-mini';
    mini.textContent = '芯';
    document.body.appendChild(mini);
    restorePos(mini);

    // 屏幕适配：旋转/缩放窗口后把面板与迷你球收回视口（orientationchange 在部分浏览器
    // 早于尺寸更新触发，延迟一拍再钳）。恢复定位路径已在 restorePos 内钳过。
    let rszT = null;
    const reClamp = () => { if (panel) clampPos(panel, 300, 160); if (mini) clampPos(mini, 44, 44); };
    window.addEventListener('resize', () => { clearTimeout(rszT); rszT = setTimeout(reClamp, 200); });
    window.addEventListener('orientationchange', () => setTimeout(reClamp, 350));
}

function makeDraggable(dragEl, handleEl) {
    let dragging = false, moved = false, startX, startY, origLeft, origTop;
    handleEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, .xa-min-btn, .xa-switch, input, .xa-btn')) return;
        e.preventDefault();
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        origLeft = parseInt(dragEl.style.left) || dragEl.getBoundingClientRect().left;
        origTop = parseInt(dragEl.style.top) || dragEl.getBoundingClientRect().top;
        dragEl.style.transition = 'none';
        dragEl.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (dx || dy) moved = true;
        const maxX = window.innerWidth - dragEl.offsetWidth;
        const maxY = window.innerHeight - dragEl.offsetHeight;
        dragEl.style.left = Math.max(0, Math.min(origLeft + dx, maxX)) + 'px';
        dragEl.style.top = Math.max(0, Math.min(origTop + dy, maxY)) + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        dragEl.style.cursor = '';
        dragEl.style.transition = '';
        if (moved) savePos(dragEl);
    });

    // 触屏拖拽（平板/触屏本）：与鼠标路径同一套状态机；move 阶段 preventDefault 阻止页面滚动，
    // start 保持 passive 不阻塞默认行为
    handleEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (t.target.closest('button, .xa-min-btn, .xa-switch, input, .xa-btn')) return;
        dragging = true;
        moved = false;
        startX = t.clientX;
        startY = t.clientY;
        origLeft = parseInt(dragEl.style.left) || dragEl.getBoundingClientRect().left;
        origTop = parseInt(dragEl.style.top) || dragEl.getBoundingClientRect().top;
        dragEl.style.transition = 'none';
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        if (e.cancelable) e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (dx || dy) moved = true;
        const maxX = window.innerWidth - dragEl.offsetWidth;
        const maxY = window.innerHeight - dragEl.offsetHeight;
        dragEl.style.left = Math.max(0, Math.min(origLeft + dx, maxX)) + 'px';
        dragEl.style.top = Math.max(0, Math.min(origTop + dy, maxY)) + 'px';
    }, { passive: false });
    document.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;
        dragEl.style.cursor = '';
        dragEl.style.transition = '';
        if (moved) savePos(dragEl);
    });
}

function bindUI() {
    let aiScanTimer = null;
    function startAIScan() {
        if (aiScanTimer) return;
        setTimeout(() => { XIA_AI.scan(); }, 500);
        aiScanTimer = setInterval(() => { XIA_AI.scan(); }, 3000);
    }
    function stopAIScan() {
        if (aiScanTimer) { clearInterval(aiScanTimer); aiScanTimer = null; }
    }

    const $ = s => panel.querySelector(s);
    statusEl = $('#xa-status');
    aiLed = $('#xa-ai-led');
    aiStatusText = $('#xa-ai-status-text');
    const apikeyInput = $('#xa-apikey');
    const apibaseInput = $('#xa-apibase');
    const modelInput = $('#xa-model');
    const visionModelInput = $('#xa-vision-model');
    const searchModeInput = $('#xa-search-mode');
    const scheduleInput = $('#xa-schedule');
    const autoSwitch = $('#xa-autoanswer-switch');
    const playSwitch = $('#xa-autoplay-switch');
    const answerDelayInput = $('#xa-answer-delay');

    // Tab 切换
    qsa('.xa-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            qsa('.xa-tab, .xa-tab-pane').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            const pane = panel.querySelector('[data-pane="' + tab.dataset.tab + '"]');
            if (pane) pane.classList.add('active');
        });
    });

    // 最小化 / 恢复（状态持久化）：按钮与迷你球同一出口，F9 全局快捷键也走这里
    function toggleMinimize() {
        const hidden = panel.classList.contains('xa-hidden');
        panel.classList.toggle('xa-hidden', !hidden);
        mini.classList.toggle('show', !hidden);
        GM_setValue(SK.minimized, !hidden);
        refreshMenuCommands();
    }
    $('.xa-min-btn').addEventListener('click', toggleMinimize);
    mini.addEventListener('click', toggleMinimize);
    // F9 隐藏/恢复面板（借鉴蜜雪学习通助手的快捷键思路，实现为本库自己的开关）：
    // 输入控件/富文本编辑器（contenteditable，如主观题作答区）聚焦时不响应，
    // 避免打字/改配置/写答案时面板突然消失
    document.addEventListener('keydown', e => {
        if (e.key !== 'F9') return;
        const t = e.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(String(t.tagName || '')) || t.isContentEditable)) return;
        toggleMinimize();
    });

    // ===== 油猴菜单命令：面板被遮挡/最小化时也能从扩展菜单直接控制核心开关 =====
    // 菜单文字动态反映当前状态（重注册实现）；环境不支持注销时只挂一次、文字停留在装载时状态。
    // 菜单项直接 click 面板开关——与面板共用同一状态出口，不会出现两处状态机。
    let menuIds = null;
    const canMenu = typeof GM_registerMenuCommand === 'function';
    const canMenuUnreg = typeof GM_unregisterMenuCommand === 'function';
    function refreshMenuCommands() {
        if (!canMenu || (menuIds && !canMenuUnreg)) return;
        try {
            if (menuIds) menuIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch (e) {} });
            menuIds = [
                GM_registerMenuCommand((conf.autoAnswer ? '暂停自动答题' : '开启自动答题'), () => autoSwitch.click()),
                GM_registerMenuCommand((conf.autoPlay ? '暂停自动刷课' : '开启自动刷课'), () => playSwitch.click()),
                GM_registerMenuCommand((panel.classList.contains('xa-hidden') ? '展开面板' : '最小化面板'), toggleMinimize),
            ];
        } catch (e) { menuIds = null; }
    }

    // API 配置实时保存（改动任一配置项会解除配置熔断）
    const saveInput = (key, el) => {
        const save = () => {
            conf[key] = el.value.trim();
            GM_setValue(SK[key], conf[key]);
            if (XIA_AI._cfgError) { XIA_AI._cfgError = null; XIA_AI.log('配置已更新，自动答题恢复', 'ok'); }
        };
        el.addEventListener('change', save);
        el.addEventListener('blur', save);
    };
    // ===== API Key 保存：明文落 GM 存储（加密保存功能已移除——GM 存储本就与页面隔离，
    // dev 模式密文与设备密钥同存一处只是混淆级保护，口令模式的输口令成本不值这个防面） =====
    // 一次性清理历史密文记录与设备密钥（这两个存储键已随功能移除，不再入 SK 表，用字面量）；
    // 若明文 Key 为空且曾有密文（dev 自动加密是默认，大概率已无明文），提示重新填写
    if (GM_getValue('xa_apikey_enc', '')) {
        GM_setValue('xa_apikey_enc', '');
        GM_setValue('xa_devkey', '');
        if (!conf.apiKey) {
            XIA_AI.log('加密保存功能已移除：原加密的 Key 无法自动恢复，请重新填写 API Key', 'error');
            setAIStatus(false, '请重新填写 API Key');
        }
    }
    saveInput('apiKey', apikeyInput);
    saveInput('apiBase', apibaseInput);    saveInput('model', modelInput);
    saveInput('visionModel', visionModelInput);
    saveInput('searchMode', searchModeInput);
    saveInput('schedule', scheduleInput);
    saveInput('answerDelay', answerDelayInput);
    // 运行时段格式即时校验：写错格式时段闸按全天放行（不锁死自动化），但不提醒用户会误以为已生效
    scheduleInput.addEventListener('change', () => {
        const v = scheduleInput.value.trim();
        if (v && !xaParseScheduleRange(v)) XIA_AI.log('运行时段格式应为 HH:MM-HH:MM（如 23:00-07:00，支持跨零点），当前写法不生效', 'error');
    });

    // API Key 输入时实时更新状态
    apikeyInput.addEventListener('input', () => {
        conf.apiKey = apikeyInput.value.trim();
        setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');
    });

    // 配置回填 + 初始化 UI
    apikeyInput.value = conf.apiKey;
    apibaseInput.value = conf.apiBase;
    modelInput.value = conf.model;
    visionModelInput.value = conf.visionModel;
    searchModeInput.value = conf.searchMode;
    scheduleInput.value = conf.schedule;
    answerDelayInput.value = conf.answerDelay;
    setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');

    // 自动答题开关
    autoSwitch.addEventListener('click', () => {
        conf.autoAnswer = !conf.autoAnswer;
        GM_setValue(SK.autoAnswer, conf.autoAnswer);
        refreshAISwitch();
    });
    function refreshAISwitch() {
        if (conf.autoAnswer) {
            autoSwitch.classList.add('on');
            XIA_AI.log('自动答题已开启（每 ' + CFG.INTERVAL + 's 扫描页面）', 'ok');
            startAIScan();
        } else {
            autoSwitch.classList.remove('on');
            stopAIScan();
            XIA_AI.log('自动答题已关闭', 'info');
        }
        refreshMenuCommands();
    }

    // 自动提交开关（默认关闭——影响真实成绩的高风险项，可在面板显式开启）
    const submitSwitch = $('#xa-autosubmit-switch');
    submitSwitch.addEventListener('click', () => {
        conf.autoSubmit = !conf.autoSubmit;
        GM_setValue(SK.autoSubmit, conf.autoSubmit);
        refreshSubmitSwitch();
    });
    function refreshSubmitSwitch() {
        if (conf.autoSubmit) {
            submitSwitch.classList.add('on');
            XIA_AI.log('答完自动提交已开启（有未答题会自动取消提交）', 'ok');
        } else {
            submitSwitch.classList.remove('on');
            XIA_AI.log('答完自动提交已关闭', 'info');
        }
    }

    // 答题确认开关（默认关闭）：开启后 AI 填完暂停，人工核对后自行操作
    const confirmSwitch = $('#xa-confirm-switch');
    confirmSwitch.addEventListener('click', () => {
        conf.confirmAnswer = !conf.confirmAnswer;
        GM_setValue(SK.confirmAnswer, conf.confirmAnswer);
        refreshConfirmSwitch();
    });
    function refreshConfirmSwitch() {
        if (conf.confirmAnswer) {
            confirmSwitch.classList.add('on');
            XIA_AI.log('答题确认已开启：AI 填完暂停，人工核对后自行翻题/提交（自动提交停用）', 'ok');
        } else {
            confirmSwitch.classList.remove('on');
            XIA_AI.log('答题确认已关闭', 'info');
        }
    }

    // 桌面通知开关（默认开启：纯本地能力，仅后台时弹，不弹也无害）
    const notifySwitch = $('#xa-notify-switch');
    notifySwitch.addEventListener('click', () => {
        conf.notify = !conf.notify;
        GM_setValue(SK.notify, conf.notify);
        refreshNotifySwitch();
    });
    function refreshNotifySwitch() {
        if (conf.notify) {
            notifySwitch.classList.add('on');
            XIA_AI.log('桌面通知已开启：页面在后台时提醒巡航完成/待人工/熔断/截止事件', 'ok');
        } else {
            notifySwitch.classList.remove('on');
            XIA_AI.log('桌面通知已关闭', 'info');
        }
    }

    // 暗色护眼开关：切 html.xa-dark 类（样式常驻注入，见 utils.xaDarkModeCSS）
    const darkSwitch = $('#xa-dark-switch');
    darkSwitch.addEventListener('click', () => {
        conf.darkMode = !conf.darkMode;
        GM_setValue(SK.darkMode, conf.darkMode);
        xaApplyDarkMode();
        refreshDarkSwitch();
    });
    function refreshDarkSwitch() {
        if (conf.darkMode) {
            darkSwitch.classList.add('on');
            XIA_AI.log('暗色护眼已开启：浅色变量/硬编码背景已覆盖，漏网区域欢迎截图反馈', 'ok');
        } else {
            darkSwitch.classList.remove('on');
            XIA_AI.log('暗色护眼已关闭', 'info');
        }
    }

    // 降画质省性能开关：新视频自动选最低画质档（见 utils.xaApplyVideoEco）
    const ecoSwitch = $('#xa-eco-switch');
    ecoSwitch.addEventListener('click', () => {
        conf.videoEco = !conf.videoEco;
        GM_setValue(SK.videoEco, conf.videoEco);
        refreshEcoSwitch();
    });
    function refreshEcoSwitch() {
        if (conf.videoEco) {
            ecoSwitch.classList.add('on');
            XIA_AI.log('降画质省性能已开启：之后打开的视频自动选最低画质档', 'ok');
        } else {
            ecoSwitch.classList.remove('on');
            XIA_AI.log('降画质省性能已关闭', 'info');
        }
    }

    // 挂机开关：独立控制主循环
    function refreshPlaySwitch() {
        if (conf.autoPlay) {
            playSwitch.classList.add('on');
            startAuto();
        } else {
            playSwitch.classList.remove('on');
            stopAuto();
        }
        refreshMenuCommands();
    }
    playSwitch.addEventListener('click', () => {
        conf.autoPlay = !conf.autoPlay;
        GM_setValue(SK.autoPlay, conf.autoPlay);
        refreshPlaySwitch();
    });

    // 单次答题按钮（执行期间禁用防连点）
    $('#xa-answer-once').addEventListener('click', e => {
        const b = e.currentTarget;
        b.disabled = true;
        XIA_AI.answerOnce();
        setTimeout(() => { b.disabled = false; }, 3000);
    });

    $('#xa-cruise').addEventListener('click', () => { XIA_AI.cruise(); });
    $('#xa-test-grab').addEventListener('click', () => { XIA_AI.testGrab(); });
    $('#xa-diagnose').addEventListener('click', () => { XIA_AI.diagnose(); });

    // 清空日志
    $('#xa-clear-log').addEventListener('click', () => {
        XIA_AI.logLines = [];
        const box = document.getElementById('xa-ai-log');
        if (box) box.innerHTML = '<div style="color:#94a3b8;">日志已清空</div>';
    });

    // 复制日志（诊断反馈用）：优先 Clipboard API，降级 execCommand
    $('#xa-copy-log').addEventListener('click', e => {
        const btn = e.currentTarget;
        const text = XIA_AI.logLines.map(l => l.text).join('\n');
        const done = ok => {
            btn.textContent = ok ? '已复制' : '复制失败';
            setTimeout(() => { btn.textContent = '复制'; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
        } else {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                done(ok);
            } catch (err) { done(false); }
        }
    });

    // 截止检查按钮：立即拉取一次（跳过 30 分钟节流）
    $('#xa-deadline-btn').addEventListener('click', () => {
        XIA_AI.log(' 正在检查各课程作业截止时间…', 'info');
        deadlineCheck(true);
    });

    // 连接健康检查按钮：结果映到 AI 状态灯（成功带延迟，失败带原因归类）
    $('#xa-health').addEventListener('click', e => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = '测试中…';
        XIA_AI.healthCheck((ok, info) => {
            b.disabled = false;
            b.textContent = '测试连接';
            info = info || {};
            setAIStatus(ok === true, ok ? '连接正常（' + (info.ms / 1000).toFixed(1) + 's）' : '连接失败：' + (info.why || '未知原因'));
        });
    });

    // 静音按钮
    const muteBtn = $('.xa-mute');
    muteBtn.addEventListener('click', () => {
        muteEnabled = !muteEnabled;
        if (muteEnabled) { muteAll(); muteBtn.classList.remove('muted'); muteBtn.textContent = '关闭静音'; }
        else { document.querySelectorAll('video, audio').forEach(v => { if (v.muted) v.muted = false; }); muteBtn.classList.add('muted'); muteBtn.textContent = '开启声音'; }
    });

    XIA_AI.bump(); // 初始化统计显示
    refreshPlaySwitch();
    refreshAISwitch();
    refreshSubmitSwitch();
    refreshConfirmSwitch();
    refreshNotifySwitch();
    refreshDarkSwitch();
    refreshEcoSwitch();
    refreshMenuCommands(); // 按当前开关状态挂油猴菜单（环境不支持时内部静默跳过）
}
