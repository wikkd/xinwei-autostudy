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

    DEFAULT_API_BASE: 'https://api.deepseek.com',
    DEFAULT_MODEL: 'deepseek-chat',
    DEFAULT_SEARCH_PROVIDER: 'duckduckgo', // duckduckgo(免密钥) / tavily(需Key)
    DEFAULT_SEARCH_MODE: 'off',            // off / auto / always；默认 off：检索会向外部引擎发送题目内容，风险项用户显式开启
    SEARCH_MAX_CHARS: 3000,
};

// 持久化键（GM_setValue / GM_getValue）
const SK = {
    apiKey: 'xa_apikey', apiBase: 'xa_apibase', model: 'xa_model',
    autoAnswer: 'xa_autoanswer', autoPlay: 'xa_autoplay', autoSubmit: 'xa_autosubmit',
    confirmAnswer: 'xa_confirm_answer', // 答题确认模式：AI 填完暂停，人工核对后自行跳题/提交
    searchProvider: 'xa_search_provider', searchApiKey: 'xa_search_key', searchMode: 'xa_search_mode',
    panelPos: 'xa_panel_pos',   // 面板/迷你球拖动位置
    minimized: 'xa_minimized',  // 面板是否处于最小化
    lastReload: 'xa_last_reload_at', // 异常弹窗自动刷新的冷却时间戳
    unlockWatch: 'xa_unlock_watch_at', // 章节解锁守望：到点静默刷新复查开放状态的时间戳
    answerDelay: 'xa_answer_delay',  // 答题间隔秒数（0=不等待）
    imgSkipped: 'xa_img_skipped',    // 图片作答题跳过记录（hash→题干摘要）
    deadlineLastAt: 'xa_deadline_last_at',   // 截止检查上次时间戳（30 分钟节流）
    deadlineSummary: 'xa_deadline_summary',  // 最近一次截止检查结果（刷新后横幅免请求展示）
};

let conf = {};

function loadCfg() {
    const g = (k, d) => GM_getValue(k, d);
    const b = v => v === true || v === 'true';
    conf = {
        apiKey: g(SK.apiKey, ''),
        apiBase: g(SK.apiBase, CFG.DEFAULT_API_BASE),
        model: g(SK.model, CFG.DEFAULT_MODEL),
        autoAnswer: b(g(SK.autoAnswer, false)),
        autoPlay: b(g(SK.autoPlay, false)),
        // 默认关闭：自动提交影响真实成绩，属高风险项
        autoSubmit: b(g(SK.autoSubmit, false)),
        // 默认关闭：开启后 AI 填完答案即暂停，人工核对后自行翻题/提交
        confirmAnswer: b(g(SK.confirmAnswer, false)),
        searchProvider: g(SK.searchProvider, CFG.DEFAULT_SEARCH_PROVIDER),
        searchApiKey: g(SK.searchApiKey, ''),
        answerDelay: String(g(SK.answerDelay, '0')),
        searchMode: g(SK.searchMode, CFG.DEFAULT_SEARCH_MODE),
    };
}
