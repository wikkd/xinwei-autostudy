// ==================== 共享题库（GitHub 仓库 tiku/ 目录） ====================
// 数据完全匿名化：仓库只存「题干指纹 sha256(归一化题干+选项文本) 前16位 + 题型 + 答案文本」，
// 不存题目明文——查询端本地对当前题目算同样的指纹去匹配，规避真题版权与平台风控暴露。
//
// 存储布局（wikkd/xinwei-autostudy 公有仓库）：
//   tiku/manifest.json  { v: 版本号, updated: ISO时间, shards: [{ f: "shard-xxxxxxxx.json", n: 题数 }] }
//   tiku/shard-xxxxxxxx.json  [{ h: 指纹前16位, t: "s|m|b|f|q", a: "答案文本" }, ...]（单文件≤500条）
//
// 读链路（上一轮 jsDelivr 实测定型）：manifest 走 api.github.com（无 CDN 缓存、国内可达），
// 分片走 cdn.jsdelivr.net/gh/...@<完整40位commit sha>（immutable，永远正确且命中 CDN 缓存）。
// 写链路（v3.8）：GitHub 授权直推——首次走 OAuth 设备流（github.com/login/device 输 8 位码，
// 公开 client_id 非机密）取 public_repo 范围令牌存本机 → fork 仓库 → 差集提交到 fork → 自动开 PR
// → 仓库侧 tiku-auto-merge 工作流校验后自动合并。无第三方服务器；github.com 国内可达（Chrome 实测）。
// 答案按题型归一：s/m 回填走选项文本匹配（答案库存文本不存字母），b 对/错归一，f/q 直接文本。

const XA_TIKU_REPO = 'wikkd/xinwei-autostudy';
const XA_TIKU_BRANCH = 'main';
const XA_TIKU_SHARD_MAX = 500;
const XA_TIKU_CLIENT_ID = 'Ov23liK0u7PqAZLbGxVW'; // OAuth App「xinwei-autostudy-tiku」公开标识

// 题干归一化：全角→半角、去空白与标点、小写——同一道题在不同平台/排版下指纹一致
function xaNormalizeQuestion(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/（/g, '(').replace(/）/g, ')')
        .replace(/，/g, ',').replace(/：/g, ':').replace(/；/g, ';').replace(/？/g, '?')
        .replace(/[\.．、""''【】\[\]!\!{}<>《》"'_\-—·\s！？‥…·]+/g, '')
        .trim();
}

// 同步 hash（data: URL + atob 万能手写 sha256 双精简实现，题干短文本够用；
// 为保证跨端一致，直接实现标准 SHA-256，无依赖）
function xaSha256Hex(str) {
    const msg = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) msg.push(c);
        else if (c < 0x800) msg.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
            const c2 = str.charCodeAt(++i);
            const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
            msg.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else msg.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    const bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (let i = 7; i >= 0; i--) msg.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);

    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const rr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < msg.length; off += 64) {
        const w = new Array(64);
        for (let i = 0; i < 16; i++) w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
        for (let i = 16; i < 64; i++) {
            const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
            const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
}

// 指纹（查询端 query 与贡献端 bankToEntries 共用的唯一实现——两端各写一份内联曾靠人肉保证一致，
// 统一后杜绝漂移）：归一化(题干前100字) + '#' + 归一化(各选项文本前30字，'|'连接)，SHA-256 取前 16 位。
// 截断规则与答案本 bank key（questionHash 的 100/30 截断）同源，查询端与上传端才能对上同一道题
function xaQuestionFingerprint(question, optionTexts) {
    const optPart = (optionTexts || []).map(t => xaNormalizeQuestion(String(t).slice(0, 30))).join('|');
    return xaSha256Hex(xaNormalizeQuestion(String(question).slice(0, 100)) + '#' + optPart).slice(0, 16);
}

// base64 ↔ UTF-8（字节级手写：btoa/atob 只吃 Latin1，含中文的答案文本直接抛错/乱码；
// 实现与 xaSha256Hex 的 UTF-8 编码表同构，编解码互为逆运算）
function xaUtf8ToB64(str) {
    const s = String(str == null ? '' : str);
    const bin = [];
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) bin.push(c);
        else if (c < 0x800) bin.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
            const c2 = s.charCodeAt(++i);
            const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
            bin.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else bin.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    let raw = '';
    for (let i = 0; i < bin.length; i++) raw += String.fromCharCode(bin[i]);
    return btoa(raw);
}
function xaB64ToUtf8(b64) {
    const raw = atob(String(b64 == null ? '' : b64).replace(/\s/g, ''));
    const out = [];
    for (let i = 0; i < raw.length; ) {
        const c = raw.charCodeAt(i);
        if (c < 0x80) { out.push(c); i += 1; }
        else if ((c & 0xe0) === 0xc0) { out.push(((c & 0x1f) << 6) | (raw.charCodeAt(i + 1) & 0x3f)); i += 2; }
        else if ((c & 0xf0) === 0xe0) { out.push(((c & 0x0f) << 12) | ((raw.charCodeAt(i + 1) & 0x3f) << 6) | (raw.charCodeAt(i + 2) & 0x3f)); i += 3; }
        else {
            const cp = ((c & 0x07) << 18) | ((raw.charCodeAt(i + 1) & 0x3f) << 12) | ((raw.charCodeAt(i + 2) & 0x3f) << 6) | (raw.charCodeAt(i + 3) & 0x3f);
            out.push(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
            i += 4;
        }
    }
    let s = '';
    for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.slice(i, i + 8192));
    return s;
}

const XA_TIKU = {
    _cache: null,      // { mv: manifest版本, index: {hash: {t,a}}, local: Set(本地已有分片名) }
    _uploading: false, // 直推进行中（防重复触发）
    stats: { hits: 0, queries: 0 },

    // 当前仓库 manifest 元信息（api.github.com 无缓存）
    fetchManifest(cb) {
        GM_xmlhttpRequest({
            method: 'GET', timeout: 12000,
            url: 'https://api.github.com/repos/' + XA_TIKU_REPO + '/contents/tiku/manifest.json?ref=' + XA_TIKU_BRANCH,
            headers: { 'Accept': 'application/vnd.github+json' },
            onload: res => {
                try {
                    if (res.status !== 200) return cb(null, 'HTTP ' + res.status);
                    const j = JSON.parse(res.responseText);
                    // GitHub Contents API 返回 base64；答案文本普遍含中文，必须走 UTF-8 解码（atob 会抛错/乱码）
                    cb({ raw: xaB64ToUtf8(j.content), sha: j.sha }, null);
                } catch (e) { cb(null, e.message); }
            },
            onerror: () => cb(null, '网络错误'),
            ontimeout: () => cb(null, '超时'),
        });
    },

    // 加载全部分片到内存索引（本地缓存优先，版本变更才拉新分片）
    ensureIndex(cb) {
        if (XA_TIKU._cache) return cb(XA_TIKU._cache);
        XA_TIKU.fetchManifest((man, err) => {
            if (!man) { XIA_AI.log('📚 题库清单获取失败: ' + err, 'error'); return cb(null); }
            let manData;
            try { manData = JSON.parse(man.raw); } catch (e) { XIA_AI.log('📚 题库清单解析失败', 'error'); return cb(null); }
            const cached = (() => { try { return JSON.parse(GM_getValue(SK.tikuCache, 'null')); } catch (e) { return null; } })();
            if (cached && cached.mv === manData.v && cached.index) {
                XA_TIKU._cache = cached;
                return cb(cached);
            }
            const shards = manData.shards || [];
            if (!shards.length) { XA_TIKU._cache = { mv: manData.v, index: {}, local: [] }; return cb(XA_TIKU._cache); }
            // 分片需要其所在 commit：manifest 的 sha 反推不可行，分片 URL 用仓库最新 commit（jsDelivr immutable）
            GM_xmlhttpRequest({
                method: 'GET', timeout: 12000,
                url: 'https://api.github.com/repos/' + XA_TIKU_REPO + '/commits/' + XA_TIKU_BRANCH,
                onload: res => {
                    let commit = '';
                    try { commit = JSON.parse(res.responseText).sha; } catch (e) {}
                    if (!commit) { XIA_AI.log('📚 题库 commit 获取失败', 'error'); return cb(null); }
                    let pending = shards.length;
                    const index = {};
                    shards.forEach(s => {
                        GM_xmlhttpRequest({
                            method: 'GET', timeout: 15000,
                            url: 'https://cdn.jsdelivr.net/gh/' + XA_TIKU_REPO + '@' + commit + '/tiku/' + s.f,
                            onload: r2 => {
                                try {
                                    const arr = JSON.parse(r2.responseText);
                                    if (Array.isArray(arr)) arr.forEach(it => { if (it && it.h && it.a != null) index[it.h] = { t: it.t || 's', a: String(it.a) }; });
                                } catch (e) {}
                                if (--pending === 0) {
                                    XA_TIKU._cache = { mv: manData.v, index: index, local: shards.map(s => s.f) };
                                    try { GM_setValue(SK.tikuCache, JSON.stringify(XA_TIKU._cache)); } catch (e) {}
                                    cb(XA_TIKU._cache);
                                }
                            },
                            onerror: () => { if (--pending === 0) { XA_TIKU._cache = { mv: manData.v, index: index, local: [] }; cb(XA_TIKU._cache); } },
                            ontimeout: () => { if (--pending === 0) { XA_TIKU._cache = { mv: manData.v, index: index, local: [] }; cb(XA_TIKU._cache); } },
                        });
                    });
                },
                onerror: () => { XIA_AI.log('📚 题库 commit 获取失败', 'error'); cb(null); },
                ontimeout: () => { XIA_AI.log('📚 题库 commit 获取失败', 'error'); cb(null); },
            });
        });
    },

    // 查库：q 为 grabQuestion() 结果（含 question/options/type）；onHit(answerText|null)
    query(q, onHit) {
        if (!conf.tikuEnabled) return onHit(null);
        XA_TIKU.stats.queries++;
        const fp = xaQuestionFingerprint(q.question, (q.options || []).map(o => o.text));
        XA_TIKU.ensureIndex(cache => {
            if (!cache || !cache.index[fp]) return onHit(null);
            const rec = cache.index[fp];
            XA_TIKU.stats.hits++;
            const norm = XA_TIKU.normalizeAnswer(rec.a, rec.t, q);
            XIA_AI.log('📚 命中共享题库: ' + (rec.a.length > 60 ? rec.a.slice(0, 60) + '…' : rec.a), 'ok');
            onHit(norm);
        });
    },

    // 题库答案（文本）→ 当前题目可用的答案：s/m 按选项文本映射字母，b 归一对/错，f/q 原文
    normalizeAnswer(text, t, q) {
        const s = String(text).trim();
        if (t === 'b') {
            if (/^(对|正确|true|√|是)$/i.test(s)) return 'A';
            if (/^(错|错误|false|×|否)$/i.test(s)) return 'B';
            return s;
        }
        if ((t === 's' || t === 'm') && q.options && q.options.length) {
            const norm = xaNormalizeQuestion;
            // 库里可能是 "文本#文本"（多选）或 "A#B"（字母）或单个字母/文本
            const parts = s.split('#').map(x => x.trim()).filter(Boolean);
            const letters = parts.map(p => {
                if (/^[A-H]$/.test(p)) return p;
                const hit = q.options.find(o => norm(o.text) === norm(p));
                return hit ? hit.letter : null;
            });
            if (letters.every(Boolean)) return letters.join('');
            // 库存文本但当前题目选项文本对不上（可能选项被平台改写）→ 回退原文让 AI 兜底流程自行处理
            return letters.filter(Boolean).join('') || s;
        }
        return s;
    },

    // 本地答案本 → 贡献条目（上传共用）：客观题 {h,t,a}，a 存答案文本（选项字母→选项文本）
    // 注意指纹必须与 bank key 同源：bank key 的选项段是 letter+text.slice(0,30)，贡献端也用截断文本算指纹，
    // 否则查询端（完整选项文本指纹）与贡献端指纹不一致会永远错配。
    bankToEntries() {
        const out = [];
        const bank = (() => { try { return JSON.parse(GM_getValue(SK.bank, '{}')) || {}; } catch (e) { return {}; } })();
        const types = (() => { try { return JSON.parse(GM_getValue('xa_bank_types', '{}')) || {}; } catch (e) { return {}; } })();
        Object.keys(bank).forEach(key => {
            const [qTitle, optPart] = String(key).split('|');
            if (!qTitle) return;
            const entry = { t: 's', a: String(bank[key].a || '') };
            if (types[key]) entry.t = types[key];
            // bank key 选项段：客观题形如 "A选项文本前30字,B选项文本前30字"；
            // 填空/主观为占位符 "cloze"/"subj"（无选项段，指纹选项段为空串）
            const opts = (optPart && !/^(cloze|subj)$/.test(optPart))
                ? optPart.split(',').map(x => x.replace(/^[A-H]/, '')).filter(Boolean)
                : [];
            entry.h = xaQuestionFingerprint(qTitle, opts);
            // 字母答案 → 选项文本存库（跨卷字母序可能不同，文本才可移植）
            if (/^[A-H]{1,4}$/.test(entry.a) && opts.length) {
                const texts = entry.a.split('').map(ch => opts[ch.charCodeAt(0) - 65]).filter(Boolean);
                if (texts.length === entry.a.length) entry.a = texts.join('#');
            }
            out.push(entry);
        });
        return out;
    },

    // ===== ☁️ 入库写链路（v3.8）：GitHub 授权直推 =====
    // 链路：设备授权（首次，github.com/login/device 输 8 位码，本机存令牌）→ fork 仓库 →
    // 以用户身份在自己 fork 上提交（并集求差/分片补满/manifest 收尾/409 重试）→ 向上游自动开 PR
    // → 仓库侧 GitHub Action 校验后自动 squash 合并。无第三方服务器、Token 不离本机。
    // 域名说明：github.com 网页在国内可达（Chrome 实测），api.github.com 部分网络直连不稳，
    // 但 GM_xmlhttpRequest 走浏览器栈与页面同源策略无关，与读链路同一域名、同一可达性。
    _validateEntries(entries) {
        const H_RE = /^[0-9a-f]{16}$/, TYPES = { s: 1, m: 1, b: 1, f: 1, q: 1 };
        const out = [];
        for (const it of entries) {
            const h = String(it.h || ''), t = String(it.t || 's'), a = String(it.a || '').trim();
            if (!H_RE.test(h) || !TYPES[t] || !a || a.length > 2000) continue; // 非法条目静默丢弃（本地数据可自控，无需整批拒绝）
            out.push({ h: h, t: t, a: a });
        }
        return out;
    },

    // ---- GitHub API 小工具（令牌来自设备流，public_repo 范围够 fork/PR/Contents 写） ----
    _gh(method, path, body, token, cb) {
        GM_xmlhttpRequest({
            method: method, timeout: 25000,
            url: 'https://api.github.com' + path,
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'xinwei-autostudy-userscript',
                ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            data: body ? JSON.stringify(body) : undefined,
            onload: res => {
                let j = null;
                try { j = res.responseText ? JSON.parse(res.responseText) : null; } catch (e) {}
                cb(res.status, j, res);
            },
            onerror: () => cb(0, null, null),
            ontimeout: () => cb(0, null, null),
        });
    },

    // 设备流第一步：要 device code（client_id 是 OAuth App 公开标识，非机密）
    _deviceCodeStart(cb) {
        XA_TIKU._gh('POST', '/login/device/code', {
            client_id: XA_TIKU_CLIENT_ID, scope: 'public_repo',
        }, null, (code, j) => {
            if (code !== 200 || !j || !j.device_code) return cb(null, 'HTTP ' + code + ((j && j.message) ? ' ' + j.message : ''));
            cb(j, null);
        });
    },
    // 设备流第二步：轮询换令牌（interval 秒节流；slow_down 顺延 5s）
    _deviceCodePoll(dc, interval, cb, add) {
        add = add || 0;
        setTimeout(() => {
            XA_TIKU._gh('POST', '/login/oauth/access_token', {
                client_id: XA_TIKU_CLIENT_ID, device_code: dc, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }, null, (code, j) => {
                if (code !== 200 || !j) return cb(null, 'HTTP ' + code);
                if (j.access_token) return cb(j.access_token, null);
                if (j.error === 'authorization_pending') return XA_TIKU._deviceCodePoll(dc, interval, cb, add);
                if (j.error === 'slow_down') return XA_TIKU._deviceCodePoll(dc, interval + 5, cb, add);
                if (j.error === 'expired_token') return cb(null, '授权码已过期，请重新点击入库');
                return cb(null, '授权失败: ' + (j.error || '未知'));
            });
        }, (interval + add) * 1000);
    },
    // 确保已授权：有令牌直接用；无令牌弹日志引导 + 打开授权页 + 轮询取令牌
    _ensureToken(cb) {
        const saved = String(conf.tikuGhToken || '').trim();
        if (saved) return cb(saved, null);
        XA_TIKU._deviceCodeStart((dc, err) => {
            if (!dc) return cb(null, 'GitHub 授权服务不可达: ' + err);
            XIA_AI.log('🔑 首次入库需授权 GitHub：打开 ' + dc.verification_uri + ' 输入码 ' + dc.user_code + '（一次性，之后全自动）', 'info');
            XIA_AI.progress('🔑 等待 GitHub 授权 ' + dc.user_code);
            try { GM_openInTab(dc.verification_uri, { active: true }); } catch (e) {}
            XA_TIKU._deviceCodePoll(dc.device_code, dc.interval || 5, (tok, perr) => {
                if (!tok) return cb(null, perr);
                try { GM_setValue(SK.tikuGhToken, tok); } catch (e) {}
                conf.tikuGhToken = tok;
                XIA_AI.log('🔑 GitHub 授权成功，已存本机（仅 public_repo 权限）', 'ok');
                // 拿登录名（拼 fork 仓库名用），失败不阻塞——后续 fork 响应里也会带 full_name
                XA_TIKU._gh('GET', '/user', null, tok, (uc, uj) => {
                    if (uc === 200 && uj && uj.login) { conf.tikuGhUser = String(uj.login); try { GM_setValue('xa_tiku_gh_user', conf.tikuGhUser); } catch (e) {} }
                    cb(tok, null);
                });
            });
        });
    },

    // 拉取远端全量状态（读上游仓库，公开数据无需令牌）：目录清单 + manifest + 各分片
    // → { manSha, manData, manShards, files, shardItems, shardSha, map }
    _loadRemote(cb) {
        XA_TIKU.fetchManifest((man, err) => {
            if (!man) return cb(null, 'manifest ' + (err || '获取失败'));
            let manData;
            try { manData = JSON.parse(man.raw); } catch (e) { return cb(null, 'manifest 解析失败'); }
            const manShards = (manData.shards || []).filter(s => s && s.f);
            const shardItems = {}, shardSha = {}, map = {};
            const todo = manShards.map(s => s.f);
            const next = () => {
                const f = todo.shift();
                if (!f) return cb({ manSha: man.sha, manData, manShards, files: manShards.map(s => s.f), shardItems, shardSha, map });
                XA_TIKU._gh('GET', '/repos/' + XA_TIKU_REPO + '/contents/tiku/' + f, null, null, (c2, j) => {
                    if (c2 === 200 && j && j.content) {
                        // 有 sha 即可重写：内容解析失败按空分片处理，指纹丢失 → 差集把条目重传回来（原地自愈）
                        shardSha[f] = j.sha;
                        try {
                            const arr = JSON.parse(xaB64ToUtf8(j.content));
                            if (Array.isArray(arr)) {
                                shardItems[f] = arr.filter(it => it && it.h && it.a != null);
                                shardItems[f].forEach(it => { if (!map[it.h]) map[it.h] = { t: it.t || 's', a: String(it.a) }; });
                            }
                        } catch (e) {}
                    }
                    next();
                });
            };
            next();
        });
    },

    // 在 fork 上提交一批文件（Contents API 串行 PUT），成功后回调
    _putToFork(fork, jobs, token, cb) {
        let i = 0;
        const next = () => {
            if (i >= jobs.length) return cb(null);
            const job = jobs[i++];
            const body = { message: 'tiku: ' + job.f + ' +' + job.items.length + ' 条', content: xaUtf8ToB64(JSON.stringify(job.items)), branch: XA_TIKU_BRANCH };
            if (job.sha) body.sha = job.sha;
            XA_TIKU._gh('PUT', '/repos/' + fork + '/contents/tiku/' + job.f, body, token, (code, j) => {
                if (code !== 200 && code !== 201) return cb('写 fork 失败 ' + job.f + ' HTTP ' + code + ((j && j.message) ? ' ' + j.message : ''));
                next();
            });
        };
        next();
    },

    // 上传主流程：校验 → 授权 → 读上游 → fork → 并集差集写 fork → 开 PR
    // 幂等性靠差集：上游已有的指纹不再出现在 PR 里，重复触发最多开一个空 PR（直接跳过）
    upload(opts) {
        opts = opts || {};
        const entries = XA_TIKU._validateEntries(XA_TIKU.bankToEntries());
        if (!entries.length) { XIA_AI.log('☁️ 本地答案本为空（或无合法条目），无可上传', 'error'); return opts.cb && opts.cb(false); }
        if (XA_TIKU._uploading) { XIA_AI.log('☁️ 入库已在进行中，忽略本次触发', 'info'); return opts.cb && opts.cb(false); }
        XA_TIKU._uploading = true;
        const finish = (ok, msg) => {
            XA_TIKU._uploading = false;
            if (msg) XIA_AI.log(msg, ok ? 'ok' : 'error');
            if (opts.cb) opts.cb(ok);
        };
        XA_TIKU._ensureToken((token, terr) => {
            if (!token) return finish(false, '☁️ 入库中止：' + terr);
            XIA_AI.log('☁️ 入库中：读取上游题库…');
            XA_TIKU._loadRemote((st, err) => {
                if (!st) return finish(false, '☁️ 上游题库读取失败：' + err);
                const diff = entries.filter(e => !st.map[e.h]);
                if (!diff.length) return finish(true, '☁️ 共享题库无新增（本地 ' + entries.length + ' 条上游已覆盖）');
                // 容量分配：旧分片补满（n 同步累加防超 500）→ 溢出开新分片（fork 上新建，无 sha）
                const putJobs = [];
                const manShards = st.manShards.map(s => ({ f: s.f, n: s.n || 0 }));
                for (const s of manShards) {
                    if (!diff.length) break;
                    if (!st.shardSha[s.f]) continue; // 拉取失败的分片不做补满目标（无 sha 在 fork 上会 422）
                    const room = XA_TIKU_SHARD_MAX - s.n;
                    if (room <= 0) continue;
                    const take = diff.splice(0, room);
                    s.n += take.length;
                    putJobs.push({ f: s.f, items: (st.shardItems[s.f] || []).concat(take), sha: st.shardSha[s.f] });
                }
                const known = st.manShards.map(s => s.f).slice();
                while (diff.length) {
                    const take = diff.splice(0, XA_TIKU_SHARD_MAX);
                    let idx = 0;
                    known.forEach(f => { const m = f.match(/^shard-(\d+)\.json$/); if (m) idx = Math.max(idx, parseInt(m[1], 10) + 1); });
                    const f = 'shard-' + ('00000000' + idx).slice(-8) + '.json';
                    known.push(f);
                    putJobs.push({ f: f, items: take });
                    manShards.push({ f: f, n: take.length });
                }
                const newCnt = putJobs.reduce((n, j) => n + j.items.length, 0);
                // 1) fork（已存在则 202 也算成功）
                XIA_AI.log('☁️ fork 仓库中…');
                XA_TIKU._gh('POST', '/repos/' + XA_TIKU_REPO + '/forks', {}, token, (code, j) => {
                    if (code !== 202 && code !== 200 && !(code === 403 && j && /fork/.test(j.message || ''))) {
                        return finish(false, '☁️ fork 失败：HTTP ' + code + ((j && j.message) ? ' ' + j.message : ''));
                    }
                    const forkFull = (j && j.full_name) || (conf.tikuGhUser + '/' + XA_TIKU_REPO.split('/')[1]);
                    // fork 异步生成，等它可写（最多 ~20s）
                    const waitFork = tries => {
                        XA_TIKU._gh('GET', '/repos/' + forkFull + '/contents/tiku/manifest.json', null, token, (c2) => {
                            if (c2 !== 200 && tries < 10) return setTimeout(() => waitFork(tries + 1), 2000);
                            if (c2 !== 200) return finish(false, '☁️ fork 就绪等待超时，请稍后重试「☁️ 入库」');
                            // 2) 差集写 fork
                            XA_TIKU._putToFork(forkFull, putJobs, token, perr => {
                                if (perr) return finish(false, '☁️ ' + perr);
                                // 3) fork 上更新 manifest（v+1，PR 合并时 Action 会重算校验）
                                const man = { v: (st.manData.v || 0) + 1, updated: new Date().toISOString().slice(0, 10), shards: manShards };
                                XA_TIKU._gh('PUT', '/repos/' + forkFull + '/contents/tiku/manifest.json', {
                                    message: 'tiku: manifest v' + man.v + '（+' + newCnt + ' 条）',
                                    content: xaUtf8ToB64(JSON.stringify(man)), branch: XA_TIKU_BRANCH, sha: st.manSha,
                                }, token, (c3) => {
                                    if (c3 !== 200 && c3 !== 201) return finish(false, '☁️ fork manifest 写入失败 HTTP ' + c3);
                                    // 4) 向上游开 PR（已有未合并的同源 PR 时 422，视为进行中）
                                    XA_TIKU._gh('POST', '/repos/' + XA_TIKU_REPO + '/pulls', {
                                        title: 'tiku: +' + newCnt + ' 条（自动贡献 ' + new Date().toISOString().slice(0, 10) + '）',
                                        head: forkFull.split('/')[0] + ':' + XA_TIKU_BRANCH,
                                        base: XA_TIKU_BRANCH,
                                        body: '自动贡献：' + newCnt + ' 条匿名指纹答案（由 xinwei-autostudy 用户脚本生成，tiku-auto-merge 工作流校验合并）',
                                    }, token, (c4, j4) => {
                                        if (c4 === 201) return finish(true, '☁️ PR 已开：' + ((j4 && (j4.html_url || '')).slice(0, 80)) + '（机器人校验后自动合并）');
                                        if (c4 === 422) return finish(true, '☁️ 条目已推到你的 fork，已有未合并的 PR 等待自动合并');
                                        finish(false, '☁️ PR 创建失败 HTTP ' + c4 + ((j4 && j4.message) ? ' ' + j4.message : '') + '（条目已在你 fork，可手动开 PR）');
                                    });
                                });
                            });
                        });
                    };
                    waitFork(0);
                });
            });
        });
    },

    // 自动入库入口：仅在全库扫描完成后由 qa.js 调用。
    // 未授权时走设备流（用户输一次 8 位码），授权后全自动。
    autoUpload() {
        // 上传前强制落盘：答案本/题型表此刻可能还有防抖未落盘的最后一批
        XIA_AI.bankFlush();
        _xaTypesFlush();
        XIA_AI.log('☁️ 扫描完成，自动入库答案本到共享题库…');
        XA_TIKU.upload();
    },

    // 命中统计展示
    statsText() {
        return '题库查询 ' + XA_TIKU.stats.queries + ' · 命中 ' + XA_TIKU.stats.hits;
    },
};

// bankSet 时同步登记题型（贡献时判断 s/m/b 用）。
// 内存表 + 防抖落盘：全库扫描一次可触发 700+ 次调用，逐次全量 JSON 读写是 O(n²)
let _xaTypes = null;          // 内存题型表（懒加载）
let _xaTypesTimer = 0;
let _xaTypesDirty = false;
function _xaTypesFlush() {
    if (_xaTypesTimer) { clearTimeout(_xaTypesTimer); _xaTypesTimer = 0; }
    if (!_xaTypesDirty || !_xaTypes) return;
    _xaTypesDirty = false;
    try { GM_setValue('xa_bank_types', JSON.stringify(_xaTypes)); } catch (e) {}
}
function xaTikuTrackType(hash, type) {
    if (!hash) return;
    try {
        if (!_xaTypes) _xaTypes = JSON.parse(GM_getValue('xa_bank_types', '{}')) || {};
        _xaTypes[hash] = type === 'multi' ? 'm' : type === 'bool' ? 'b' : type === 'cloze' ? 'f' : type === 'subjective' ? 'q' : 's';
        const keys = Object.keys(_xaTypes);
        if (keys.length > 600) { const drop = keys.slice(0, keys.length - 600); drop.forEach(k => delete _xaTypes[k]); } // 简单FIFO淘汰
        _xaTypesDirty = true;
        if (!_xaTypesTimer) _xaTypesTimer = setTimeout(_xaTypesFlush, 500);
    } catch (e) {}
}

// ===== scan → 题库 → AI 的胶水 =====
// scan() 抓到题后先查共享题库：命中直接回填并校验跳题（与答案本命中同路径），
// 未命中静默落入 scanAI() 原有流程（答案本 → 检索 → LLM）。
function XIA_TIKU_QUERY(q, hash) {
    if (!conf.tikuEnabled) { XIA_AI.scanAI(q, hash); return; }
    XA_TIKU.query(q, hit => {
        if (!hit) { XIA_AI.scanAI(q, hash); return; }
        XIA_AI.answering = true;
        XIA_AI.lastQuestionHash = hash;
        xaTikuTrackType(hash, q.type); // 命中题也要登记题型，入库才不污染
        XIA_TIKU_STATS_SYNC();
        const finish = ok => {
            if (ok) {
                XIA_AI.bump('cached');
                XIA_TIKU_STATS_SYNC();
                XIA_AI.verifyAndAdvance(q, hash, hit);
            } else {
                XIA_AI.log('📚 题库答案回填失败，转 AI 作答', 'info');
                XIA_AI.answering = false;
                XIA_AI.lastQuestionHash = '';
                XIA_AI.scanAI(q, hash);
            }
        };
        if (q.type === 'subjective') XIA_AI.answerSubjective(hit, finish);
        else if (q.type === 'cloze') XIA_AI.fillCloze(hit, q.node, finish);
        else XIA_AI.fillChoice(hit, q.node, finish);
    });
}

// 面板题库统计刷新（查询/命中数随查库实时更新）
function XIA_TIKU_STATS_SYNC() {
    const el = document.getElementById('xa-tiku-stats');
    if (el) el.textContent = XA_TIKU.statsText();
}
