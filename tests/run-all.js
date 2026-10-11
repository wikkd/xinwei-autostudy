// 全量测试入口：node tests/run-all.js
// 依次运行全部测试套件，聚合结果；任一失败退出码非 0（CI 用）
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const suites = fs.readdirSync(dir)
    .filter(f => /^test-.*\.js$/.test(f))
    .sort();

let failed = 0;
const t0 = Date.now();
for (const f of suites) {
    process.stdout.write('── ' + f + ' … ');
    try {
        const out = execFileSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 120000 });
        const last = out.trim().split('\n').filter(Boolean).pop() || '';
        console.log(last);
    } catch (e) {
        failed++;
        console.log('FAILED');
        const out = String((e.stdout || '') + (e.stderr || '')).trim();
        if (out) console.log(out.split('\n').map(l => '   ' + l).join('\n'));
    }
}
console.log('──────────────────────────────');
console.log(failed ? '❌ ' + failed + '/' + suites.length + ' 套件失败' : '✅ 全部 ' + suites.length + ' 套件通过（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
process.exit(failed ? 1 : 0);
