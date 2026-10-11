// 授权直推回归测试：XA_TIKU 设备流授权 + fork/PR 写链路（v3.8）
// 运行：node tests/test-tiku-upload.js（harness 直加载 src/tiku.js + config.js）
// 桩掉 GM_xmlhttpRequest 模拟 GitHub API（设备流/fork/contents/pulls），
// 覆盖：条目校验 / 空答案本 / 设备流 happy path（授权一次）+ 令牌复用 / 授权过期 /
// 基础贡献（fork→写 fork→manifest→PR）/ 幂等无新增 / 超容量开新分片 / PR 422 已有 PR / fork 就绪等待
const { loadSlice } = require('./harness');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

function bankOf(n, seed) {
    const bank = {};
    for (let i = 0; i < n; i++) bank['题' + seed + '第' + i + '题|'] = { a: '答案' + i };
    return bank;
}

// ===== 桩：伪 GitHub =====
// state: { pending: 次数, forkDelay: 次, prStatus: 201|422, failPut: 次 }
function ghStub(opts) {
    const log = { urls: [], puts: [], prBody: null, token: null };
    const st = { token: 'gho_testtoken_abc', forkReady: 0, prStatus: 201, failPut: 0, ...opts };
    const GH = (opt) => {
        const url = String(opt.url || '');
        const m = url.match(/https:\/\/api\.github\.com(\/.*)/);
        const p = m ? m[1].split('?')[0] : url;
        const method = opt.method || 'GET';
        let body = {};
        try { body = opt.data ? JSON.parse(opt.data) : {}; } catch (e) {}
        if (opt.headers && opt.headers.Authorization) log.token = opt.headers.Authorization;
        log.urls.push(method + ' ' + p);
        const jres = (status, j) => opt.onload({ status: status, responseText: JSON.stringify(j) });
        if (method === 'POST' && p === '/login/device/code') {
            return jres(200, { device_code: 'DC123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0 });
        }
        if (method === 'POST' && p === '/login/oauth/access_token') {
            if (st.pending > 0) { st.pending--; return jres(200, { error: 'authorization_pending' }); }
            return jres(200, { access_token: st.token, scope: 'public_repo' });
        }
        if (method === 'GET' && p === '/user') return jres(200, { login: 'contributor1' });
        if (method === 'POST' && p === '/repos/wikkd/xinwei-autostudy/forks') return jres(202, { full_name: 'contributor1/xinwei-autostudy' });
        if (method === 'GET' && p === '/repos/contributor1/xinwei-autostudy/contents/tiku/manifest.json') {
            if (st.forkReady > 0) { st.forkReady--; return jres(404, { message: 'Not Found' }); }
            return jres(200, { sha: 'forkShaM' });
        }
        // 上游 manifest（公开读，无令牌）
        if (method === 'GET' && p === '/repos/wikkd/xinwei-autostudy/contents/tiku/manifest.json') {
            return jres(200, { sha: 'shaM1', content: Buffer.from(JSON.stringify(st.upMan || { v: 1, shards: [{ f: 'shard-00000000.json', n: 0 }] }), 'utf8').toString('base64') });
        }
        // 上游分片
        if (method === 'GET' && p.startsWith('/repos/wikkd/xinwei-autostudy/contents/tiku/shard-')) {
            const f = p.split('/').pop();
            const arr = (st.upShards && st.upShards[f]) || [];
            return jres(200, { sha: 'shaS_' + f, content: Buffer.from(JSON.stringify(arr), 'utf8').toString('base64') });
        }
        // fork 分片 PUT
        if (method === 'PUT' && p.startsWith('/repos/contributor1/xinwei-autostudy/contents/tiku/')) {
            if (st.failPut > 0) { st.failPut--; return jres(422, { message: 'sha was not specified' }); }
            const f = p.split('/').pop();
            log.puts.push({ f: f, n: (JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'))).length, hasSha: !!body.sha });
            return jres(201, {});
        }
        if (method === 'POST' && p === '/repos/wikkd/xinwei-autostudy/pulls') {
            log.prBody = body;
            return jres(st.prStatus, st.prStatus === 201 ? { html_url: 'https://github.com/wikkd/xinwei-autostudy/pull/1' } : { message: 'A pull request already exists' });
        }
        return jres(404, { message: 'unexpected ' + method + ' ' + p });
    };
    return { GH: GH, log: log, st: st };
}

// 组装被测切片：config.js（SK/conf）+ sites.js（questionHash）+ tiku.js，全部外部依赖走桩
function sandbox(bank, confOver, gh) {
    const logs = [];
    const store = { xa_answer_bank: JSON.stringify(bank), xa_bank_types: JSON.stringify({}) };
    const openTabs = [];
    const exposed = loadSlice(
        ['config.js', 'sites.js', 'tiku.js'],
        ['XA_TIKU', 'conf', 'questionHash', 'xaQuestionFingerprint'],
        {
            GM_store: store,
            GM_getValue: (k, d) => (k in store ? store[k] : d),
            GM_setValue: (k, v) => { store[k] = String(v); },
            GM_xmlhttpRequest: gh.GH,
            GM_openInTab: u => openTabs.push(u),
            XIA_AI: { log: (m, t) => logs.push(m), progress: () => {}, bankFlush: () => {} },
            btoa: s => Buffer.from(s, 'binary').toString('base64'),
            atob: s => Buffer.from(s, 'base64').toString('binary'),
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
        });
    Object.assign(exposed.conf, { tikuEnabled: true, tikuGhToken: '', tikuGhUser: '' }, confOver);
    return { X: { XA_TIKU: exposed.XA_TIKU, questionHash: exposed.questionHash, fp: exposed.xaQuestionFingerprint }, logs, store, openTabs, gh };
}

// 尊重 device flow 的 interval=0（setTimeout(…,0) 也要出栈）；⑨ 的 fork 等待是 2s/次 ×2，
// 统一等足 5 秒真实时钟
const settle = () => new Promise(r => setTimeout(r, 5000));

(async () => {
    // ① 空答案本：不发起任何 GitHub 请求
    {
        const gh = ghStub({});
        const { X, logs } = sandbox({}, {}, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        ok('① 空答案本拒绝', cbOk === false && gh.log.urls.length === 0 && /为空/.test(logs.join('\n')));
    }

    // ② 设备流 happy path：无令牌 → 打开授权页 → 轮询拿令牌 → 存本机 → 完成贡献
    {
        const gh = ghStub({ pending: 1 });
        const { X, logs, store, openTabs } = sandbox(bankOf(2, 1), {}, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        ok('② 打开授权页', openTabs.some(u => /github\.com\/login\/device/.test(u)));
        ok('② 日志含 8 位码', /ABCD-1234/.test(logs.join('\n')));
        eq('② 令牌存本机', store.xa_tiku_gh_token, 'gho_testtoken_abc');
        ok('② 走完 fork+PR', cbOk === true && gh.log.puts.length >= 1 && gh.log.prBody && gh.log.prBody.head === 'contributor1:main');
    }

    // ③ 令牌复用：已授权 → 不再走设备流
    {
        const gh = ghStub({});
        const { X } = sandbox(bankOf(1, 2), { tikuGhToken: 'gho_saved', tikuGhUser: 'contributor1' }, gh);
        await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        ok('③ 跳过设备流', !gh.log.urls.some(u => /device\/code/.test(u)));
        ok('③ 用已存令牌', gh.log.token === 'Bearer gho_saved');
    }

    // ④ 授权过期：expired_token → 明确报错提示重试
    {
        const gh = ghStub({});
        // 劫持 access_token 端点返回 expired
        const orig = gh.GH;
        gh.GH = opt => {
            const u = String(opt.url || '');
            if (opt.method === 'POST' && /access_token/.test(u)) return opt.onload({ status: 200, responseText: JSON.stringify({ error: 'expired_token' }) });
            return orig(opt);
        };
        const { X, logs } = sandbox(bankOf(1, 3), {}, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        ok('④ 过期提示', cbOk === false && /过期/.test(logs.join('\n')));
    }

    // ⑤ 基础贡献形态：1 条进空分片 → 1 次 PUT（带 sha）+ manifest PUT + PR 标题带条数
    {
        const gh = ghStub({});
        const { X } = sandbox(bankOf(1, 4), { tikuGhToken: 'gho_saved', tikuGhUser: 'contributor1' }, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        eq('⑤ PUT 次数（分片+manifest）', gh.log.puts.length, 2);
        eq('⑤ 分片条数', gh.log.puts[0].n, 1);
        ok('⑤ 更新已带 sha / 新建不带', gh.log.puts[0].hasSha === true);
        ok('⑤ PR 标题', /条/.test(gh.log.prBody.title) && gh.log.prBody.base === 'main');
    }

    // ⑥ 幂等：上游已覆盖全部指纹 → 0 PUT 0 PR
    {
        // 先算真实指纹
        const probe = sandbox(bankOf(3, 5), { tikuGhToken: 'g', tikuGhUser: 'contributor1' }, ghStub({}));
        const entries = probe.X.XA_TIKU.bankToEntries();
        const gh = ghStub({ upMan: { v: 1, shards: [{ f: 'shard-00000000.json', n: 3 }] }, upShards: { 'shard-00000000.json': entries } });
        const { X, logs } = sandbox(bankOf(3, 5), { tikuGhToken: 'gho_saved', tikuGhUser: 'contributor1' }, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        ok('⑥ 幂等跳过', cbOk === true && gh.log.puts.length === 0 && /无新增/.test(logs.join('\n')));
    }

    // ⑦ 超容量开新分片：上游旧片 498 条（填充物）→ 5 条新增 = 旧片补 2 + 新片 3（fork 上新建无 sha）
    {
        const filler = [];
        for (let i = 0; i < 498; i++) filler.push({ h: ('f' + i).padStart(16, '0'), t: 's', a: '上游' + i });
        const gh = ghStub({ upMan: { v: 1, shards: [{ f: 'shard-00000000.json', n: 498 }] }, upShards: { 'shard-00000000.json': filler } });
        const { X } = sandbox(bankOf(5, 6), { tikuGhToken: 'gho_saved', tikuGhUser: 'contributor1' }, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        eq('⑦ PUT 次数（旧片+新片+manifest）', gh.log.puts.length, 3);
        eq('⑦ 旧片补满 500', gh.log.puts[0].n, 500);
        eq('⑦ 新片 3 条', gh.log.puts[1].n, 3);
        ok('⑦ 新片无 sha（fork 新建）', gh.log.puts[1].hasSha === false);
        ok('⑦ 成功开 PR', cbOk === true);
    }

    // ⑧ PR 422（已有未合并 PR）→ 仍算成功
    {
        const gh = ghStub({ prStatus: 422 });
        const { X, logs } = sandbox(bankOf(1, 7), { tikuGhToken: 'gho_saved', tikuGhUser: 'contributor1' }, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        ok('⑧ 已有 PR 容忍', cbOk === true && /已有未合并/.test(logs.join('\n')));
    }

    // ⑨ fork 就绪等待：fork GET 前两次 404 → 等待后继续
    {
        const gh = ghStub({ forkReady: 2 });
        const { X, logs } = sandbox(bankOf(1, 8), { tikuGhToken: 'gho_saved', tikuGhUser: 'contributor1' }, gh);
        const cbOk = await new Promise(r => X.XA_TIKU.upload({ cb: r }));
        await settle();
        ok('⑨ fork 延迟就绪', cbOk === true && /PR 已开|已有未合并/.test(logs.join('\n')));
    }

    // ⑩ 条目校验过滤：坏指纹/坏题型/空答案被丢弃
    {
        const gh = ghStub({});
        const { X } = sandbox({}, { tikuGhToken: 'g', tikuGhUser: 'contributor1' }, gh);
        const out = X.XA_TIKU._validateEntries([
            { h: '0123456789abcdef', t: 's', a: 'ok' },
            { h: 'XYZ', t: 's', a: 'bad-hex' },
            { h: '0123456789abcdef', t: 'z', a: 'bad-type' },
            { h: '0123456789abcdef', t: 's', a: '' },
            { h: '0123456789abcdef', t: 's', a: 'x'.repeat(2001) },
        ]);
        eq('⑩ 只留合法条目', out, [{ h: '0123456789abcdef', t: 's', a: 'ok' }]);
    }

    // ⑪ 指纹双端一致：查询端输入 与 bank key→贡献端输入 必须产出同一指纹
    // （历史上两端各写一份内联计算，靠人肉保证一致；现在共用 xaQuestionFingerprint，
    //   此测试锁定「100/30 截断 + 归一化」规则在两条路径上不可漂移）
    {
        const gh = ghStub({});
        const { X } = sandbox({}, { tikuGhToken: 'g', tikuGhUser: 'contributor1' }, gh);
        const HEX16 = /^[0-9a-f]{16}$/;
        const q1 = {
            question: '下面的概念与箱线图的绘制无关的是（     ）',
            options: [{ letter: 'A', text: '均值' }, { letter: 'B', text: '方差' }, { letter: 'C', text: '分位数' }, { letter: 'D', text: '众数' }],
            type: 'single',
        };
        // 查询端：原始题目 + 选项文本
        const fpQuery = X.fp(q1.question, q1.options.map(o => o.text));
        // 贡献端：bank key 拆解（与 bankToEntries 同一拆解规则）
        const key = X.questionHash(q1);
        const [qTitle, optPart] = key.split('|');
        const opts = (optPart && !/^(cloze|subj)$/.test(optPart))
            ? optPart.split(',').map(x => x.replace(/^[A-H]/, '')).filter(Boolean)
            : [];
        const fpUpload = X.fp(qTitle, opts);
        eq('⑪ 客观题指纹双端一致', fpUpload, fpQuery);
        ok('⑪ 指纹为 16 位 hex', HEX16.test(fpQuery));

        // 填空题（无选项段）：查询端 options=[] 与贡献端 cloze 占位 → 空选项段
        const q2 = { question: 'Python中用于检查变量类型的函数是_________。', options: [], type: 'cloze' };
        const fp2a = X.fp(q2.question, []);
        const k2 = X.questionHash(q2);
        const [t2, o2] = k2.split('|');
        const fp2b = X.fp(t2, (o2 && !/^(cloze|subj)$/.test(o2)) ? o2.split(',').map(x => x.replace(/^[A-H]/, '')).filter(Boolean) : []);
        eq('⑪ 填空题指纹双端一致', fp2b, fp2a);

        // 截断规则生效：超长题干与 100 字截断后同指纹（bank key 同源截断的立身之本）
        const longQ = '长题干'.repeat(100);
        eq('⑪ 题干 100 字截断', X.fp(longQ, []), X.fp(longQ.slice(0, 100), []));
        const longOpt = '选项内容'.repeat(20);
        eq('⑪ 选项 30 字截断', X.fp('题', [longOpt]), X.fp('题', [longOpt.slice(0, 30)]));
    }

    console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
