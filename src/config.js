// ==================== 全局配置 ====================

let muteEnabled = true; // 运行期开关：是否静音视频

const CFG = {
    PPT_DWELL: 5,           // 静态/PPT 课件停留秒数（打开即算已观看）
    MIN_WATCH: 30,          // 启动后最少观看秒数（防过早跳章）
    COOLDOWN: 15,           // 跳章后冷却秒数
    INTERVAL: 3,            // 主循环 / 题目扫描间隔（秒）
    WATCH_DONE_PCT: 0.96,   // 视频完成判定阈值：currentTime >= duration*比值 即算看完。
                            // 平台规则「需观看 95% 计入完成」（frontend-map 实证），取 0.96 留 1% 余量
                            // 防心跳竞态；同时覆盖流尾部挂起（卡 99.x% 永不 ended）的场景
    STALL_SEC: 45,          // 视频卡死判定：currentTime 连续 N 秒无推进 → 阶梯恢复（重点播 → reload）
    STALL_RELOAD_SEC: 120,  // 卡死且重点播无效：连续 N 秒无推进 → 静默 reload（共用 refresh 冷却）
    PPT_LOAD_GRACE_MS: 4000,// PPT/静态课件等待 iframe 就绪的宽限时常（防白页空跳），就绪后才开始计 DWELL
    UNLOCK_CHECK_MS: 600000,// 锁定章守望检查间隔（10 分钟）：所有节完成后仍有未开放章时，定期复查是否解锁
    DEADLINE_WARN_DAYS: 3,  // 作业截止提醒阈值：未完成作业距截止 ≤N 天时在面板提醒（≤24h 升级为紧急）
    DEADLINE_CHECK_MS: 1800000, // 截止检查间隔（30 分钟，GM 时间戳节流，跨刷新生效）
    DEADLINE_RETRY_MS: 300000,  // 检查失败后的短重试间隔（5 分钟）：瞬断不放大成 30 分钟提醒盲区

    DEFAULT_API_BASE: 'https://api.deepseek.com',
    DEFAULT_MODEL: 'deepseek-reasoner', // 思考模型：qa.callAI 按模型名命中 reasoning 正则，自动放宽 max_tokens/超时
    DEFAULT_SEARCH_MODE: 'off',            // off / auto / always；默认 off：检索会向外部引擎发送题目内容，风险项用户显式开启
    SEARCH_MAX_CHARS: 3000,
};

// 持久化键（GM_setValue / GM_getValue）
const SK = {
    apiKey: 'xa_apikey', apiBase: 'xa_apibase', model: 'xa_model',
    autoAnswer: 'xa_autoanswer', autoPlay: 'xa_autoplay',
    submitMode: 'xa_submit_mode', // 提交方式三态（manual/auto/confirm），替代旧 autoSubmit+confirmAnswer 两开关（二者本互斥）
    autoSubmit: 'xa_autosubmit',        // 旧键仅作迁移读取：无 submitMode 时 auto=true 迁移为 auto
    confirmAnswer: 'xa_confirm_answer', // 旧键仅作迁移读取：confirm=true 优先（旧版确认模式整体压过自动提交）
    notify: 'xa_notify',        // 桌面通知开关（页面在后台时弹系统通知，前台不打扰）
    searchMode: 'xa_search_mode',
    schedule: 'xa_schedule',    // 运行时段表 HH:MM-HH:MM（可跨零点；空=全天），时段外自动刷课/答题暂停
    visionModel: 'xa_vision_model', // 视觉模型（选填）：题干带图时改走该模型看图作答；空=不带图纯文本作答
    videoEco: 'xa_video_eco',   // 降画质省性能：每个视频自动选最低画质档（降解码 CPU 与带宽）
    speedBoost: 'xa_speed_boost',     // 智能倍速：有平台倍速菜单（0.5x-2x）的视频自动点最高档，>2x 永不
    speedRejectAt: 'xa_speed_reject_at', // 智能倍速被风控拒绝（不允许倍速播放）的时间戳：30 分钟冷却防刷新循环
    panelPos: 'xa_panel_pos',   // 面板/迷你球拖动位置
    drawers: 'xa_drawers',      // 面板抽屉折叠状态（data-sec → 是否展开，JSON）
    minimized: 'xa_minimized',  // 面板是否处于最小化
    lastReload: 'xa_last_reload_at', // 异常弹窗自动刷新的冷却时间戳
    unlockWatch: 'xa_unlock_watch_at', // 章节解锁守望：到点静默刷新复查开放状态的时间戳
    answerDelay: 'xa_answer_delay',  // 答题间隔秒数（0=不等待）
    imgSkipped: 'xa_img_skipped',    // 图片作答题跳过记录（hash→题干摘要）
    drafts: 'xa_drafts',             // 主观题草稿防丢（题干 hash → {text,at,title}，上限 20 条 7 天过期，纯本地）
    deadlineLastAt: 'xa_deadline_last_at',   // 截止检查上次时间戳（30 分钟节流）
    deadlineSummary: 'xa_deadline_summary',  // 最近一次截止检查结果（刷新后横幅免请求展示）
};

let conf = {};

function loadCfg() {
    const g = (k, d) => GM_getValue(k, d);
    const b = v => v === true || v === 'true';
    // 提交方式三态合一：manual=人工核对提交 / auto=答完自动提交 / confirm=填完暂停待确认。
    // 旧版两开关（autoSubmit+confirmAnswer）迁移：confirm 优先——旧版里确认模式本就整体压过自动提交；
    // 迁移结果写回 submitMode 后旧键不再读，qa/cruise/popup 的 conf.autoSubmit/conf.confirmAnswer 改为派生标志不动。
    let submitMode = String(g(SK.submitMode, '') || '');
    if (submitMode !== 'auto' && submitMode !== 'confirm' && submitMode !== 'manual') {
        submitMode = b(g(SK.confirmAnswer, false)) ? 'confirm' : (b(g(SK.autoSubmit, false)) ? 'auto' : 'manual');
        GM_setValue(SK.submitMode, submitMode);
    }
    conf = {
        apiKey: g(SK.apiKey, ''),
        apiBase: g(SK.apiBase, CFG.DEFAULT_API_BASE),
        model: g(SK.model, CFG.DEFAULT_MODEL),
        autoAnswer: b(g(SK.autoAnswer, false)),
        autoPlay: b(g(SK.autoPlay, false)),
        submitMode,
        // 派生标志：与 submitMode 恒同步（ui.js 切换时一并重算），下游判断不用改
        autoSubmit: submitMode === 'auto',
        confirmAnswer: submitMode === 'confirm',
        // 默认开启：本地系统通知（无网络外发），仅页面在后台时弹，面板可关
        notify: b(g(SK.notify, true)),
        answerDelay: String(g(SK.answerDelay, '0')),
        searchMode: g(SK.searchMode, CFG.DEFAULT_SEARCH_MODE),
        schedule: String(g(SK.schedule, '')).trim(),
        visionModel: String(g(SK.visionModel, '')).trim(),
        videoEco: b(g(SK.videoEco, false)),
        speedBoost: b(g(SK.speedBoost, false)),
    };
}
