// ==================== 全局配置 ====================

// 运行期开关：是否静音视频
let muteEnabled = true;

const CFG = {
    PPT_TIMEOUT: 60,        // PPT 帧停留多少秒判定为章节完成
    MIN_WATCH: 30,          // 启动后最少观看秒数（防过早跳章）
    COOLDOWN: 15,           // 跳章后冷却秒数
    INTERVAL: 3,            // 主循环 / 题目扫描间隔（秒）

    DEFAULT_API_BASE: 'https://api.deepseek.com',
    DEFAULT_MODEL: 'deepseek-chat',

    DEFAULT_SEARCH_PROVIDER: 'duckduckgo', // duckduckgo(免密钥) / tavily(需Key)
    DEFAULT_SEARCH_MODE: 'auto',           // off / auto / always
    SEARCH_MAX_CHARS: 3000,
};

// 持久化配置键（GM_setValue / GM_getValue）
const STORAGE_KEYS = {
    apiKey: 'xa_apikey',
    apiBase: 'xa_apibase',
    model: 'xa_model',
    autoAnswer: 'xa_autoanswer',
    autoPlay: 'xa_autoplay',
    searchProvider: 'xa_search_provider',
    searchApiKey: 'xa_search_key',
    searchMode: 'xa_search_mode',
};

let conf = {};

function loadCfg() {
    const get = (key, def) => GM_getValue(key, def);
    conf = {
        apiKey: get(STORAGE_KEYS.apiKey, ''),
        apiBase: get(STORAGE_KEYS.apiBase, CFG.DEFAULT_API_BASE),
        model: get(STORAGE_KEYS.model, CFG.DEFAULT_MODEL),
        autoAnswer: get(STORAGE_KEYS.autoAnswer, false) === true || get(STORAGE_KEYS.autoAnswer, false) === 'true',
        autoPlay: get(STORAGE_KEYS.autoPlay, false) === true || get(STORAGE_KEYS.autoPlay, false) === 'true',
        searchProvider: get(STORAGE_KEYS.searchProvider, CFG.DEFAULT_SEARCH_PROVIDER),
        searchApiKey: get(STORAGE_KEYS.searchApiKey, ''),
        searchMode: get(STORAGE_KEYS.searchMode, CFG.DEFAULT_SEARCH_MODE),
    };
}
