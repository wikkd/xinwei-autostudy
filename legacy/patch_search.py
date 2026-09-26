# -*- coding: utf-8 -*-
import io, re

path = r"C:\Users\FrostStarInquire\WorkBuddy\2026-09-26-13-28-00\XF芯位_patched.user.js"
src = io.open(path, 'r', encoding='utf-8', newline='').read()

def repl(old, new):
    global src
    c = src.count(old)
    if c != 1:
        raise SystemExit('FAIL anchor count=%d -> %r' % (c, old[:70]))
    src = src.replace(old, new, 1)

# ---- 1. CFG 默认 ----
repl("        DEFAULT_MODEL: 'deepseek-chat',\r\n    };",
     "        DEFAULT_MODEL: 'deepseek-chat',\r\n\r\n        DEFAULT_SEARCH_PROVIDER: 'duckduckgo', // duckduckgo(免密钥) / tavily(需Key)\r\n        DEFAULT_SEARCH_MODE: 'auto',            // off / auto / always\r\n        SEARCH_MAX_CHARS: 3000,\r\n    };")

# ---- 2. STORAGE_KEYS ----
repl("    const STORAGE_KEYS = { apiKey: 'xia_apikey', apiBase: 'xia_apibase', model: 'xia_model', autoAnswer: 'xia_autoanswer', autoPlay: 'xia_autoplay' };",
     "    const STORAGE_KEYS = { apiKey: 'xia_apikey', apiBase: 'xia_apibase', model: 'xia_model', autoAnswer: 'xia_autoanswer', autoPlay: 'xia_autoplay', searchProvider: 'xia_search_provider', searchApiKey: 'xia_search_key', searchMode: 'xia_search_mode' };")

# ---- 3. loadCfg ----
repl("            autoPlay: GM_getValue(STORAGE_KEYS.autoPlay, false) === true || GM_getValue(STORAGE_KEYS.autoPlay, false) === 'true',\r\n        };",
     "            autoPlay: GM_getValue(STORAGE_KEYS.autoPlay, false) === true || GM_getValue(STORAGE_KEYS.autoPlay, false) === 'true',\r\n            searchProvider: GM_getValue(STORAGE_KEYS.searchProvider, CFG.DEFAULT_SEARCH_PROVIDER),\r\n            searchApiKey: GM_getValue(STORAGE_KEYS.searchApiKey, ''),\r\n            searchMode: GM_getValue(STORAGE_KEYS.searchMode, CFG.DEFAULT_SEARCH_MODE),\r\n        };")

# ---- 4. 插入检索增强方法（在 callAI 之前） ----
HELPERS = (
"        // ==================== 检索增强（答题前先搜资料） ====================\r\n"
"        needsSearch(question, type) {\r\n"
"            if (type === 'subjective') return false;\r\n"
"            const q = question || '';\r\n"
"            if (/(世界|国际|全球|国外|海外|外国)/.test(q)) return true;\r\n"
"            if (/(19|20)\\d{2}\\s*年|哪一年|成立于|创立于|发明|发现|首次|第一次|总统|总理|主席|首相|元首|首都|人口|GDP|经济总[量值]|世界杯|奥运|历史|地理|政治|名人|品牌|公司|企业|最新|目前|截至|现任|多少岁|面积|海拔|发明者|作者|画家|科学家/.test(q)) return true;\r\n"
"            if (/\\d{3,}/.test(q)) return true;\r\n"
"            if (/[A-Za-z]{3,}\\s*(公司|大学|奖|协议|法案|组织)/.test(q)) return true;\r\n"
"            return false;\r\n"
"        },\r\n"
"\r\n"
"        buildPrompt(question, options, type, ctx) {\r\n"
"            const opt = options.map(o => o.letter + '. ' + o.text).join(' ');\r\n"
"            let base;\r\n"
"            if (type === 'subjective') base = '用一句话或100字内直接回答以下主观题，禁止多余废话。\\n\\n题目：' + question;\r\n"
"            else if (type === 'multi') base = '你是一个答题助手。请分析以下多选题，输出所有正确选项的字母，多个字母直接拼接（如 ABC），不要有任何废话。\\n\\n题目：' + question + '\\n\\n选项：' + opt;\r\n"
"            else base = '你是一个答题助手。请分析以下题目和选项，直接输出正确选项的字母（如 A 或 B），只输出一个字母，不要有任何废话、不要解释、不要换行。\\n\\n题目：' + question + '\\n\\n选项：' + opt;\r\n"
"            if (ctx && ctx.length) {\r\n"
"                return '以下是检索到的相关资料（可能包含答案，请甄别并优先采信权威可靠来源；若资料与你的知识冲突，以资料为准）：\\n' + ctx + '\\n\\n==========\\n\\n' + base;\r\n"
"            }\r\n"
"            return base;\r\n"
"        },\r\n"
"\r\n"
"        searchWeb(query, cb) {\r\n"
"            const provider = conf.searchProvider || 'duckduckgo';\r\n"
"            const key = conf.searchApiKey || '';\r\n"
"            const maxChars = CFG.SEARCH_MAX_CHARS || 3000;\r\n"
"            const done = (ctx) => { try { cb && cb(ctx || ''); } catch (e) {} };\r\n"
"            try {\r\n"
"                if (provider === 'tavily') {\r\n"
"                    if (!key) { XIA_AI.log('Tavily 需要 API Key，回退为不检索', 'error'); return done(''); }\r\n"
"                    GM_xmlhttpRequest({\r\n"
"                        method: 'POST',\r\n"
"                        url: 'https://api.tavily.com/search',\r\n"
"                        headers: { 'Content-Type': 'application/json' },\r\n"
"                        data: JSON.stringify({ api_key: key, query: query, max_results: 5, search_depth: 'basic' }),\r\n"
"                        timeout: 15000,\r\n"
"                        onload: (r) => {\r\n"
"                            try {\r\n"
"                                const j = JSON.parse(r.responseText);\r\n"
"                                const arr = (j.results || []).map(x => ((x.title ? ('【' + x.title + '】') : '') + (x.content || ''))).filter(Boolean);\r\n"
"                                done(arr.join('\\n').slice(0, maxChars));\r\n"
"                            } catch (e) { XIA_AI.log('检索解析失败: ' + e.message, 'error'); done(''); }\r\n"
"                        },\r\n"
"                        onerror: () => { XIA_AI.log('检索网络错误', 'error'); done(''); },\r\n"
"                        ontimeout: () => { XIA_AI.log('检索超时', 'error'); done(''); },\r\n"
"                    });\r\n"
"                } else {\r\n"
"                    GM_xmlhttpRequest({\r\n"
"                        method: 'GET',\r\n"
"                        url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),\r\n"
"                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },\r\n"
"                        timeout: 15000,\r\n"
"                        onload: (r) => {\r\n"
"                            try {\r\n"
"                                const html = r.responseText || '';\r\n"
"                                const snippets = [];\r\n"
"                                const re = /class=\"result__snippet\"[^>]*>([\\s\\S]*?)<\\/a>/g;\r\n"
"                                let m;\r\n"
"                                while ((m = re.exec(html)) !== null) {\r\n"
"                                    const txt = m[1].replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim();\r\n"
"                                    if (txt) snippets.push(txt);\r\n"
"                                }\r\n"
"                                if (snippets.length === 0) {\r\n"
"                                    const re2 = /class=\"result__a\"[^>]*>([\\s\\S]*?)<\\/a>/g;\r\n"
"                                    while ((m = re2.exec(html)) !== null) {\r\n"
"                                        const txt = m[1].replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim();\r\n"
"                                        if (txt) snippets.push(txt);\r\n"
"                                    }\r\n"
"                                }\r\n"
"                                done(snippets.join('\\n').slice(0, maxChars));\r\n"
"                            } catch (e) { XIA_AI.log('检索解析失败: ' + e.message, 'error'); done(''); }\r\n"
"                        },\r\n"
"                        onerror: () => { XIA_AI.log('检索网络错误', 'error'); done(''); },\r\n"
"                        ontimeout: () => { XIA_AI.log('检索超时', 'error'); done(''); },\r\n"
"                    });\r\n"
"                }\r\n"
"            } catch (e) { XIA_AI.log('检索异常: ' + e.message, 'error'); done(''); }\r\n"
"        },\r\n"
)
OLD_CI = "        // 调用 AI 接口（支持单选/多选）\r\n        callAI(question, options, type, onResult) {"
repl(OLD_CI, HELPERS + "\r\n\r\n" + OLD_CI)

# ---- 5. 重写 callAI 主体（先搜后答） ----
BODY = (
"            const _0xf0 = conf.apiKey;\r\n"
"            if (!_0xf0) { XIA_AI.log('未配置 API Key', 'error'); onResult(null); return; }\r\n"
"            const _0xf1 = conf.apiBase || CFG.DEFAULT_API_BASE;\r\n"
"            const _0xf2 = conf.model || CFG.DEFAULT_MODEL;\r\n"
"            const _0xf3 = options.map(_0x8b => _0x8b.letter + '. ' + _0x8b.text).join(' ');\r\n"
"            const _0xf4 = type === 'multi';\r\n"
"            const _0xf5 = type === 'subjective';\r\n"
"            let _0xf7 = _0xf1.replace(/\\/+$/, '');\r\n"
"            const _0xf8 = /\\/v\\d+\\/?$/.test(_0xf7) ? (_0xf7 + '/chat/completions') : (_0xf7 + '/v1/chat/completions');\r\n"
"            XIA_AI.log('请求 ' + _0xf8 + ' | model=' + _0xf2 + ' | 题目长度=' + question.length, 'ai');\r\n"
"\r\n"
"            // 检索增强：先搜后答\r\n"
"            const needSearch = conf.searchMode === 'always' || (conf.searchMode === 'auto' && XIA_AI.needsSearch(question, type));\r\n"
"            const doLLM = (ctx) => {\r\n"
"                const _0xf6 = XIA_AI.buildPrompt(question, options, type, ctx);\r\n"
"                XIA_AI.log('Prompt摘要: ' + _0xf6.slice(0, 80), 'ai');\r\n"
"                try {\r\n"
"                    GM_xmlhttpRequest({\r\n"
"                        method: 'POST',\r\n"
"                        url: _0xf8,\r\n"
"                        headers: {\r\n"
"                            'Content-Type': 'application/json',\r\n"
"                            'Authorization': 'Bearer ' + _0xf0,\r\n"
"                        },\r\n"
"                        data: JSON.stringify({\r\n"
"                            model: _0xf2,\r\n"
"                            messages: [{ role: 'user', content: _0xf6 }],\r\n"
"                            temperature: 0.3,\r\n"
"                            max_tokens: _0xf5 ? 300 : 16,\r\n"
"                        }),\r\n"
"                        timeout: _0xf5 ? 30000 : 20000,\r\n"
"                        onload: (_0xf9) => {\r\n"
"                            try {\r\n"
"                                const _0xfa = JSON.parse(_0xf9.responseText);\r\n"
"                                const _0xfb = _0xfa.choices && _0xfa.choices[0] && _0xfa.choices[0].message && _0xfa.choices[0].message.content;\r\n"
"                                if (!_0xfb) { XIA_AI.log('AI 响应异常: ' + _0xf9.responseText.slice(0, 200), 'error'); onResult(null); return; }\r\n"
"                                let _0xfc;\r\n"
"                                if (_0xf5) {\r\n"
"                                    _0xfc = _0xfb.trim();\r\n"
"                                } else {\r\n"
"                                    const _0xfd = _0xfb.trim().match(/[A-H]/g);\r\n"
"                                    if (!_0xfd) { XIA_AI.log('AI 返回无法解析: \"' + _0xfb.trim().slice(0, 80) + '\"', 'error'); onResult(null); return; }\r\n"
"                                    _0xfc = _0xfd.filter((_0xfe, _0xff, _0x10a) => _0x10a.indexOf(_0xfe) === _0xff).join('');\r\n"
"                                }\r\n"
"                                XIA_AI.log('AI 答案 -> ' + _0xfc.slice(0, 100), 'ok');\r\n"
"                                onResult(_0xfc);\r\n"
"                            } catch (e) {\r\n"
"                                XIA_AI.log('解析失败: ' + e.message + ' | 原始: ' + (_0xf9.responseText || '').slice(0, 200), 'error');\r\n"
"                                onResult(null);\r\n"
"                            }\r\n"
"                        },\r\n"
"                        onerror: (e) => { XIA_AI.log('网络错误: ' + (e.error || JSON.stringify(e)), 'error'); onResult(null); },\r\n"
"                        ontimeout: () => { XIA_AI.log('请求超时', 'error'); onResult(null); },\r\n"
"                    });\r\n"
"                } catch (e) {\r\n"
"                    XIA_AI.log('LLM 请求异常: ' + e.message, 'error');\r\n"
"                    onResult(null);\r\n"
"                }\r\n"
"            };\r\n"
"\r\n"
"            if (needSearch) {\r\n"
"                XIA_AI.log('🔍 先检索相关资料...', 'ai');\r\n"
"                XIA_AI.searchWeb(question, (ctx) => doLLM(ctx || ''));\r\n"
"            } else {\r\n"
"                doLLM('');\r\n"
"            }\r\n"
)
start = "        callAI(question, options, type, onResult) {"
end = "                XIA_AI.log('GM_xmlhttpRequest 异常: ' + e.message, 'error');\r\n                onResult(null);\r\n            }\r\n        },"
pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.DOTALL)
new_method = start + "\r\n" + BODY + "\r\n        },"
new_src, n = pat.subn(lambda m: new_method, src, count=1)
if n != 1:
    raise SystemExit('FAIL callAI rewrite n=%d' % n)
src = new_src

# ---- 6. UI：AI 页签加检索配置 ----
repl('      <input class="xia-input" id="xia-model" type="text" placeholder="deepseek-chat / gpt-4o-mini" />',
     '      <input class="xia-input" id="xia-model" type="text" placeholder="deepseek-chat / gpt-4o-mini" />\r\n      <div class="xia-label">检索增强（答题前先搜资料）</div>\r\n      <select class="xia-input" id="xia-search-mode">\r\n        <option value="off">关闭（不检索）</option>\r\n        <option value="auto">自动（事实/时事题才搜）</option>\r\n        <option value="always">总是（每题都搜）</option>\r\n      </select>\r\n      <select class="xia-input" id="xia-search-provider">\r\n        <option value="duckduckgo">DuckDuckGo（免密钥）</option>\r\n        <option value="tavily">Tavily（需Key，更准）</option>\r\n      </select>\r\n      <input class="xia-input" id="xia-search-key" type="password" placeholder="Tavily API Key（DDG 可留空）" />')

# ---- 7. UI 绑定：声明 + 保存 + 回填 ----
repl("    const modelInput = $('#xia-model');",
     "    const modelInput = $('#xia-model');\r\n    const searchModeInput = $('#xia-search-mode');\r\n    const searchProviderInput = $('#xia-search-provider');\r\n    const searchApiKeyInput = $('#xia-search-key');")
repl("    saveInput('model', modelInput);",
     "    saveInput('model', modelInput);\r\n    saveInput('searchMode', searchModeInput);\r\n    saveInput('searchProvider', searchProviderInput);\r\n    saveInput('searchApiKey', searchApiKeyInput);")
repl("    modelInput.value = conf.model;",
     "    modelInput.value = conf.model;\r\n    searchModeInput.value = conf.searchMode;\r\n    searchProviderInput.value = conf.searchProvider;\r\n    searchApiKeyInput.value = conf.searchApiKey;")

# ---- 校验 ----
for marker in ["XIA_AI.searchWeb", "needsSearch", "buildPrompt", "xia-search-mode", "xia-search-key", "conf.searchMode", "GM_xmlhttpRequest"]:
    if marker not in src:
        raise SystemExit('MISSING marker: ' + marker)
io.open(path, 'w', encoding='utf-8', newline='').write(src)
print("OK, new size:", len(src.encode('utf-8')))
