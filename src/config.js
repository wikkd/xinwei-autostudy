// ==================== 全局配置 ====================

let muteEnabled = true; // 运行期开关：是否静音视频

const CFG = {
    PPT_DWELL: 5,           // 静态/PPT 课件停留秒数（打开即算已观看）
    MIN_WATCH: 30,          // 启动后最少观看秒数（防过早跳章）
    COOLDOWN: 15,           // 跳章后冷却秒数
    INTERVAL: 3,            // 主循环 / 题目扫描间隔（秒）
    BANK_MAX: 400,          // 答案本最大条数（超出淘汰最早的）

    DEFAULT_API_BASE: 'https://api.deepseek.com',
    DEFAULT_MODEL: 'deepseek-chat',
    DEFAULT_SEARCH_PROVIDER: 'duckduckgo', // duckduckgo(免密钥) / tavily(需Key)
    DEFAULT_SEARCH_MODE: 'auto',           // off / auto / always
    SEARCH_MAX_CHARS: 3000,
};

// 持久化键（GM_setValue / GM_getValue）
const SK = {
    apiKey: 'xa_apikey', apiBase: 'xa_apibase', model: 'xa_model',
    autoAnswer: 'xa_autoanswer', autoPlay: 'xa_autoplay', autoSubmit: 'xa_autosubmit',
    searchProvider: 'xa_search_provider', searchApiKey: 'xa_search_key', searchMode: 'xa_search_mode',
    cxSpeed: 'xa_cx_speed',     // 超星视频倍速（1/1.25/1.5/2，仅 chaoxing 生效；芯位不变速）
    bank: 'xa_answer_bank',     // 答案本：题目hash -> {a:答案, t:时间}
    panelPos: 'xa_panel_pos',   // 面板/迷你球拖动位置
    minimized: 'xa_minimized',  // 面板是否处于最小化
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
        autoSubmit: b(g(SK.autoSubmit, true)),
        searchProvider: g(SK.searchProvider, CFG.DEFAULT_SEARCH_PROVIDER),
        searchApiKey: g(SK.searchApiKey, ''),
        searchMode: g(SK.searchMode, CFG.DEFAULT_SEARCH_MODE),
        cxSpeed: parseFloat(g(SK.cxSpeed, '2')) || 2, // 默认 2x（平台开放上限）
    };
}
