// ==================== 悬浮控制面板 UI ====================

const PANEL_CSS = `
#xa-panel{position:fixed;top:16px;left:16px;width:300px;background:#fff;border-radius:14px;
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
.xa-body{padding:14px;display:flex;flex-direction:column;gap:10px;max-height:640px;overflow-y:auto;}
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
        if (p && typeof p.l === 'number') { el.style.left = p.l + 'px'; el.style.top = p.t + 'px'; }
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
  <div class="xa-tab active" data-tab="cfg">⚙ 挂机</div>
  <div class="xa-tab" data-tab="ai">🤖 答题</div>
  <div class="xa-tab" data-tab="about">ℹ 关于</div>
</div>
<div class="xa-body">
  <!-- Tab 1: 挂机配置 -->
  <div class="xa-tab-pane active" data-pane="cfg">
    <div class="xa-status" id="xa-status">状态：就绪</div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">全自动刷课</span>
      <div class="xa-switch" id="xa-autoplay-switch" title="开启自动刷课"></div>
    </div>
    <button class="xa-btn xa-mute">🔇 关闭静音</button>
  </div>
  <!-- Tab 2: AI 答题 -->
  <div class="xa-tab-pane" data-pane="ai">
    <div class="xa-status" id="xa-ai-status"><span class="xa-led" id="xa-ai-led"></span><span id="xa-ai-status-text">等待配置 Key</span></div>
    <div class="xa-progress" id="xa-progress">待机中</div>
    <div class="xa-stats" id="xa-stats">已答 0 · 缓存命中 0 · 已提交 0</div>
    <div class="xa-sec">🔌 接口配置</div>
    <div class="xa-ai-inputs">
      <input class="xa-input" id="xa-apikey" type="password" placeholder="API Key（sk-xxxxxxxx）" />
      <input class="xa-input" id="xa-apibase" type="text" placeholder="API Base（https://api.deepseek.com）" />
      <input class="xa-input" id="xa-model" type="text" placeholder="模型名（deepseek-chat / gpt-4o-mini）" />
    </div>
    <div class="xa-sec">🔍 检索增强</div>
    <div class="xa-ai-inputs">
      <select class="xa-input" id="xa-search-mode">
        <option value="off">检索：关闭</option>
        <option value="auto">检索：自动（事实/时事题）</option>
        <option value="always">检索：总是</option>
      </select>
      <select class="xa-input" id="xa-search-provider">
        <option value="duckduckgo">来源：DuckDuckGo（免密钥）</option>
        <option value="tavily">来源：Tavily（需 Key，更准）</option>
      </select>
      <input class="xa-input" id="xa-search-key" type="password" placeholder="Tavily API Key（DDG 可留空）" />
    </div>
    <div class="xa-btnrow">
      <button class="xa-btn xa-once" id="xa-answer-once" title="只答当前这一题">🎯 答题</button>
      <button class="xa-btn xa-stop" id="xa-cruise" title="打开本课程作业列表并自动逐份完成">🧭 巡航</button>
      <button class="xa-btn xa-stop" id="xa-test-grab" title="测试题目抓取">🧪 抓取</button>
      <button class="xa-btn xa-stop" id="xa-diagnose" title="dump 题目 DOM 结构">🩺 诊断</button>
    </div>
    <div class="xa-sec">⚡ 自动模式</div>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autoanswer-switch" title="开启自动答题+作业巡航"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">自动答题+跳题+作业巡航</span>
    </div>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autosubmit-switch" title="全部答完后自动提交作业（含未答题保护）"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">答完自动提交作业</span>
    </div>
    <div class="xa-row" style="justify-content:space-between;">
      <span style="font-size:12px;color:#374151;font-weight:600;">答题间隔（秒）</span>
      <input class="xa-input" id="xa-answer-delay" type="number" min="0" max="600" step="1" style="width:76px;padding:5px 8px;" title="每答完一题后等待的秒数再答下一题，0 = 不等待" />
    </div>
  </div>
  <!-- Tab 3: 关于 -->
  <div class="xa-tab-pane" data-pane="about">
    <div class="xa-about">
      <h4>👋 关于本脚本</h4>
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
  <div class="xa-loghead"><span>📜 运行日志</span><button id="xa-clear-log">清空</button></div>
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
    const searchModeInput = $('#xa-search-mode');
    const searchProviderInput = $('#xa-search-provider');
    const searchApiKeyInput = $('#xa-search-key');
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

    // 最小化 / 恢复（状态持久化）
    $('.xa-min-btn').addEventListener('click', () => {
        panel.classList.add('xa-hidden');
        mini.classList.add('show');
        GM_setValue(SK.minimized, true);
    });
    mini.addEventListener('click', () => {
        panel.classList.remove('xa-hidden');
        mini.classList.remove('show');
        GM_setValue(SK.minimized, false);
    });

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
    saveInput('apiKey', apikeyInput);
    saveInput('apiBase', apibaseInput);
    saveInput('model', modelInput);
    saveInput('searchMode', searchModeInput);
    saveInput('searchProvider', searchProviderInput);
    saveInput('searchApiKey', searchApiKeyInput);
    saveInput('answerDelay', answerDelayInput);

    // API Key 输入时实时更新状态
    apikeyInput.addEventListener('input', () => {
        conf.apiKey = apikeyInput.value.trim();
        setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');
    });

    // 配置回填 + 初始化 UI
    apikeyInput.value = conf.apiKey;
    apibaseInput.value = conf.apiBase;
    modelInput.value = conf.model;
    searchModeInput.value = conf.searchMode;
    searchProviderInput.value = conf.searchProvider;
    searchApiKeyInput.value = conf.searchApiKey;
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

    // 挂机开关：独立控制主循环
    function refreshPlaySwitch() {
        if (conf.autoPlay) {
            playSwitch.classList.add('on');
            startAuto();
        } else {
            playSwitch.classList.remove('on');
            stopAuto();
        }
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

    // 静音按钮
    const muteBtn = $('.xa-mute');
    muteBtn.addEventListener('click', () => {
        muteEnabled = !muteEnabled;
        if (muteEnabled) { muteAll(); muteBtn.classList.remove('muted'); muteBtn.textContent = '🔇 关闭静音'; }
        else { document.querySelectorAll('video, audio').forEach(v => { if (v.muted) v.muted = false; }); muteBtn.classList.add('muted'); muteBtn.textContent = '🔊 开启声音'; }
    });

    XIA_AI.bump(); // 初始化统计显示
    refreshPlaySwitch();
    refreshAISwitch();
    refreshSubmitSwitch();
}
