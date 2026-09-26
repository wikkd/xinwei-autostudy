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
.xa-body{padding:14px;display:flex;flex-direction:column;gap:10px;max-height:520px;overflow-y:auto;}
.xa-tab-pane{display:none;flex-direction:column;gap:10px;}
.xa-tab-pane.active{display:flex;}
.xa-status{font-size:12px;color:#6b7280;text-align:center;padding:6px 8px;border-radius:6px;background:#f3f4f6;transition:color .2s,background .2s;}
.xa-status.running{color:#059669;background:#d1fae5;}
.xa-status.paused{color:#d97706;background:#fef3c7;}
.xa-btn{width:100%;padding:9px 0;border:none;border-radius:10px;font-size:13px;font-weight:600;
  cursor:pointer;transition:all .2s;letter-spacing:.3px;color:#fff;}
.xa-start{background:linear-gradient(135deg,#3b82f6,#2563eb);}
.xa-start:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xa-start:active{transform:scale(.97);}
.xa-once{background:linear-gradient(135deg,#0ea5e9,#06b6d4);}
.xa-once:hover{box-shadow:0 4px 12px rgba(59,130,246,.4);transform:translateY(-1px);}
.xa-once:active{transform:scale(.97);}
.xa-input:disabled{background:#f3f4f6;color:#9ca3af;cursor:not-allowed;}
.xa-ai-inputs{display:flex;flex-direction:column;gap:10px;}
.xa-about{font-size:12px;color:#374151;line-height:1.8;max-height:350px;overflow-y:auto;
  padding-right:4px;word-break:break-word;}
.xa-about h4{font-size:14px;color:#1e40af;margin:0 0 6px;}
.xa-about p{margin:0 0 8px;}
.xa-stop{background:#f3f4f6;color:#374151;}
.xa-stop:hover{background:#e5e7eb;}
.xa-mute{background:#f3f4f6;color:#374151;}
.xa-mute:hover{background:#e5e7eb;}
.xa-mute.muted{background:#fee2e2;color:#dc2626;}
.xa-label{font-size:11px;color:#6b7280;font-weight:600;letter-spacing:.3px;margin-bottom:-4px;}
.xa-input{width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;
  font-family:inherit;outline:none;transition:border-color .2s;box-sizing:border-box;}
.xa-input:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.12);}
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
  font-family:'SF Mono','Menlo','Consolas',monospace;height:150px;overflow-y:auto;line-height:1.5;}
.xa-ai-log::-webkit-scrollbar{width:4px;}
.xa-ai-log::-webkit-scrollbar-thumb{background:#475569;border-radius:2px;}
#xa-mini{position:fixed;top:16px;left:16px;width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:18px;font-weight:700;
  display:none;align-items:center;justify-content:center;cursor:move;z-index:99999;
  box-shadow:0 4px 16px rgba(59,130,246,.35);transition:transform .2s;user-select:none;}
#xa-mini:hover{transform:scale(1.1);}
#xa-mini.show{display:flex;}
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

function buildPanel() {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'xa-panel';
    panel.innerHTML = `
<div class="xa-header"><span>Xinwei AutoStudy v1.0</span><button class="xa-min-btn" title="最小化">−</button></div>
<div class="xa-tabs">
  <div class="xa-tab active" data-tab="cfg">⚙ 挂机配置</div>
  <div class="xa-tab" data-tab="ai">🤖 AI 答题调试</div>
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
  <!-- Tab 2: AI 答题调试 -->
  <div class="xa-tab-pane" data-pane="ai">
    <div class="xa-status" id="xa-ai-status"><span class="xa-led" id="xa-ai-led"></span><span id="xa-ai-status-text">等待配置 Key</span></div>
    <div class="xa-ai-inputs" id="xa-ai-inputs">
      <div class="xa-label" id="xa-label-apikey">API Key（密钥）</div>
      <input class="xa-input" id="xa-apikey" type="password" placeholder="sk-xxxxxxxxxxxxxxxx" />
      <div class="xa-label" id="xa-label-apibase">API Base URL</div>
      <input class="xa-input" id="xa-apibase" type="text" placeholder="https://api.deepseek.com" />
      <div class="xa-label" id="xa-label-model">模型名称</div>
      <input class="xa-input" id="xa-model" type="text" placeholder="deepseek-chat / gpt-4o-mini" />
      <div class="xa-label">检索增强（答题前先搜资料）</div>
      <select class="xa-input" id="xa-search-mode">
        <option value="off">关闭（不检索）</option>
        <option value="auto">自动（事实/时事题才搜）</option>
        <option value="always">总是（每题都搜）</option>
      </select>
      <select class="xa-input" id="xa-search-provider">
        <option value="duckduckgo">DuckDuckGo（免密钥）</option>
        <option value="tavily">Tavily（需Key，更准）</option>
      </select>
      <input class="xa-input" id="xa-search-key" type="password" placeholder="Tavily API Key（DDG 可留空）" />
    </div>
    <button class="xa-btn xa-once" id="xa-answer-once">🎯 回答当前题目</button>
    <div class="xa-row">
      <div class="xa-switch" id="xa-autoanswer-switch" title="开启自动答题"></div>
      <span style="font-size:12px;color:#374151;font-weight:600;">自动答题+跳题</span>
    </div>
    <button class="xa-btn xa-start" id="xa-test-grab">🧪 一键抓取当前题目测试</button>
    <button class="xa-btn" id="xa-diagnose">🩺 诊断当前页面结构</button>
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
  <div class="xa-ai-log" id="xa-ai-log"><div style="color:#94a3b8;">等待操作...</div></div>
</div>`;
    document.body.appendChild(panel);

    mini = document.createElement('div');
    mini.id = 'xa-mini';
    mini.textContent = '夏';
    document.body.appendChild(mini);
}

function makeDraggable(dragEl, handleEl) {
    let dragging = false, startX, startY, origLeft, origTop;
    handleEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, .xa-min-btn, .xa-switch, input, .xa-btn')) return;
        e.preventDefault();
        dragging = true;
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

    // Tab 切换
    document.querySelectorAll('.xa-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.xa-tab, .xa-tab-pane').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            const pane = document.querySelector('[data-pane="' + tab.dataset.tab + '"]');
            if (pane) pane.classList.add('active');
        });
    });

    // 最小化
    $('.xa-min-btn').addEventListener('click', () => {
        panel.classList.add('xa-hidden');
        mini.classList.add('show');
    });
    mini.addEventListener('click', () => {
        panel.classList.remove('xa-hidden');
        mini.classList.remove('show');
    });

    // API 配置实时保存
    const saveInput = (key, el) => {
        el.addEventListener('change', () => { conf[key] = el.value.trim(); GM_setValue(STORAGE_KEYS[key], conf[key]); XIA_AI.log('已保存: ' + key); });
        el.addEventListener('blur', () => { conf[key] = el.value.trim(); GM_setValue(STORAGE_KEYS[key], conf[key]); });
    };
    saveInput('apiKey', apikeyInput);
    saveInput('apiBase', apibaseInput);
    saveInput('model', modelInput);
    saveInput('searchMode', searchModeInput);
    saveInput('searchProvider', searchProviderInput);
    saveInput('searchApiKey', searchApiKeyInput);

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
    setAIStatus(conf.apiKey ? true : null, conf.apiKey ? 'AI 引擎已就绪' : '等待配置 Key');

    // 自动答题开关
    autoSwitch.addEventListener('click', () => {
        conf.autoAnswer = !conf.autoAnswer;
        GM_setValue(STORAGE_KEYS.autoAnswer, conf.autoAnswer);
        refreshAISwitch();
    });
    function refreshAISwitch() {
        if (conf.autoAnswer) {
            autoSwitch.classList.add('on');
            XIA_AI.log('自动答题已开启（每 3s 扫描页面）', 'ok');
            startAIScan();
        } else {
            autoSwitch.classList.remove('on');
            stopAIScan();
            XIA_AI.log('自动答题已关闭', 'info');
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
        GM_setValue(STORAGE_KEYS.autoPlay, conf.autoPlay);
        refreshPlaySwitch();
    });

    // 单次答题按钮
    $('#xa-answer-once').addEventListener('click', () => { XIA_AI.answerOnce(); });

    // 测试按钮
    $('#xa-test-grab').addEventListener('click', () => { XIA_AI.testGrab(); });

    // 诊断按钮（dump 页面真实题目 DOM，便于按真机结构修选择器）
    $('#xa-diagnose').addEventListener('click', () => { XIA_AI.diagnose(); });

    // 静音按钮
    const muteBtn = $('.xa-mute');
    muteBtn.addEventListener('click', () => {
        muteEnabled = !muteEnabled;
        if (muteEnabled) { muteAll(); muteBtn.classList.remove('muted'); muteBtn.textContent = '🔇 关闭静音'; }
        else { document.querySelectorAll('video').forEach(v => { if (v.muted) v.muted = false; }); muteBtn.classList.add('muted'); muteBtn.textContent = '🔊 开启声音'; }
    });

    refreshPlaySwitch();
    refreshAISwitch();
}
