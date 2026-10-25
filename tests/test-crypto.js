// utils.js 密钥加密纯函数测试：xaEncEncrypt / xaEncDecrypt / xaDevKey（设备密钥自动加密模式）
// Node 18+ 自带 WebCrypto/btoa/TextEncoder，注入 harness 沙箱即可（运行：node tests/test-crypto.js）
const { loadSlice } = require('./harness');

const _store = {};
const _gm = {
    GM_getValue: (k, d) => (k in _store ? _store[k] : d),
    GM_setValue: (k, v) => { _store[k] = String(v); },
};
const { xaEncEncrypt, xaEncDecrypt, xaDevKey } = loadSlice(
    ['config.js', 'utils.js'],
    ['xaEncEncrypt', 'xaEncDecrypt', 'xaDevKey'],
    { crypto, btoa, atob, TextEncoder, TextDecoder, ..._gm }
);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};

(async () => {
    const KEY = 'sk-test-1234567890abcdef-芯位';
    // ===== 往返：加密 → 解密还原 =====
    const rec = await xaEncEncrypt('我的口令', KEY);
    eq('记录结构 {v,s,i,c}', rec.v === 1 && typeof rec.s === 'string' && typeof rec.i === 'string' && typeof rec.c === 'string', true);
    eq('正确口令解密还原', await xaEncDecrypt('我的口令', rec), KEY);

    // ===== 错口令 / 篡改 / 损坏记录 =====
    eq('错误口令返回 null', await xaEncDecrypt('错误口令', rec), null);
    const tampered = JSON.parse(JSON.stringify(rec));
    tampered.c = tampered.c.slice(0, -4) + 'AAAA'; // 翻改密文尾
    eq('密文被篡改返回 null（GCM 完整性校验）', await xaEncDecrypt('我的口令', tampered), null);
    eq('记录损坏（非 base64）返回 null', await xaEncDecrypt('我的口令', { v: 1, s: '!!', i: '??', c: '@@' }), null);
    eq('空记录对象返回 null', await xaEncDecrypt('我的口令', {}), null);

    // ===== 盐 / IV 每次随机（同口令同明文两次加密的记录互不相同，旧密文不可被新记录旁路）=====
    const rec2 = await xaEncEncrypt('我的口令', KEY);
    eq('盐每次随机', rec.s !== rec2.s, true);
    eq('IV 每次随机', rec.i !== rec2.i, true);
    eq('密文每次不同', rec.c !== rec2.c, true);

    // ===== 口令与密钥含特殊字符 =====
    const recU = await xaEncEncrypt('p@ss "quote" 中文 🔑', 'sk-!"\'\\#$%&');
    eq('特殊字符口令+密钥往返', await xaEncDecrypt('p@ss "quote" 中文 🔑', recU), 'sk-!"\'\\#$%&');

    // ===== 设备密钥（自动加密模式）：首次生成、稳定复用、跨设备不可解 =====
    const dk1 = xaDevKey();
    eq('设备密钥为 32 字节 base64（44 字符）', dk1.length, 44);
    eq('设备密钥稳定复用（同存储）', xaDevKey(), dk1);
    const recD = await xaEncEncrypt(dk1, 'sk-autotest');
    eq('设备密钥模式往返', await xaEncDecrypt(dk1, recD), 'sk-autotest');
    eq('外来密钥解不开（跨设备拷密文无效）', await xaEncDecrypt('other-device-key-0000000000000000', recD), null);
    // 独立存储（模拟另一台设备）生成不同设备密钥，旧密文无法解开
    delete _store['xa_devkey'];
    const dk2 = xaDevKey();
    eq('新存储生成新设备密钥', dk2 !== dk1, true);
    eq('旧设备密钥的密文用新设备密钥解不开', await xaEncDecrypt(dk2, recD), null);

    console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' crypto tests passed'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('crypto 测试异常:', e); process.exit(1); });
