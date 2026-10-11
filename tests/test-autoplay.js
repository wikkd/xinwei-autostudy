// 视频跳转优化回归测试：stallDecision（卡死阶梯）与 parseExpirationRange（开放时间窗解析）
// 运行：node tests/test-autoplay.js（harness 直加载 src）
const { loadSlice } = require('./harness');

// autoplay.js 顶层只声明状态变量，无 DOM 触碰；CG 依赖来自 config.js
const { stallDecision, parseExpirationRange } = loadSlice(
    ['config.js', 'utils.js', 'sites.js', 'qa.js', 'autoplay.js'],
    ['stallDecision', 'parseExpirationRange'],
    { CFG: { UNLOCK_CHECK_MS: 600000 } });

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};

// ===== stallDecision（stuckSec, stage, stallSec=45, reloadSec=120）=====
eq('stall below threshold', stallDecision(44, 0, 45, 120), 0);
eq('stall triggers replay', stallDecision(45, 0, 45, 120), 1);
eq('stall stage1 no double replay', stallDecision(60, 1, 45, 120), 0);   // 已重播过，等 reload 闸门
eq('stall reload after stage1', stallDecision(120, 1, 45, 120), 2);
eq('stall no reload without replay', stallDecision(120, 0, 45, 120), 1); // stage0 先走重播（不直接 reload）
eq('stall stage2 defensive', stallDecision(200, 2, 45, 120), 2);         // 防御：stage≥1 已重播过 → 许可 reload

// ===== parseExpirationRange =====
const r1 = parseExpirationRange('2026-10-04 至 2026-10-18');
eq('range parse start', r1.start, new Date(2026, 9, 4).getTime());
eq('range parse end includes whole day', r1.end, new Date(2026, 9, 18).getTime() + 86399999);
eq('range no match', parseExpirationRange('无时间窗'), null);
eq('range single date', parseExpirationRange('2026-10-04'), null); // 需两个日期
// 依赖本地时区，用同构造方式对比（Date(y,m,d) 本地时区语义一致）
eq('range cross month', parseExpirationRange('2026-09-20 至 2026-10-04').end, new Date(2026, 9, 4).getTime() + 86399999);

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' autoplay tests passed'));
process.exit(fail ? 1 : 0);
