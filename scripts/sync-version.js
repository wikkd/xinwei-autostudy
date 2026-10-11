// 版本一致性检查：meta.js @version 为唯一来源，package.json 必须跟随（CI 用）
// 运行：node scripts/sync-version.js [--write]
//   默认只检查（不一致退出码 1）；--write 自动同步 package.json 后成功退出
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const meta = fs.readFileSync(path.join(root, 'src', 'meta.js'), 'utf8');
const m = meta.match(/^\/\/\s*@version\s+(\S+)/m);
if (!m) { console.error('❌ src/meta.js 缺少 @version'); process.exit(1); }
const version = m[1];

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.version === version) {
    console.log('✅ 版本一致: ' + version);
    process.exit(0);
}

if (process.argv.includes('--write')) {
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('✅ package.json 已同步为 ' + version);
    process.exit(0);
}

console.error('❌ 版本不一致：meta.js=' + version + '，package.json=' + pkg.version
    + '（运行 node scripts/sync-version.js --write 修复）');
process.exit(1);
