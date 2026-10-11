#!/usr/bin/env node
// 共享题库 PR 校验 + 自动合并脚本（由 .github/workflows/tiku-auto-merge.yml 调用）
// 校验通过 → 就地 merge PR；不通过 → 打标 + 评论原因，不合并。
// 【重要】以 process.cwd() 为仓库根（Action 的 working-directory 天然是仓库根）；
// 本地调试需 cd 到目标仓库再 node <本文件路径>。
// 校验规则（与脚本端/中转端同源）：
//   1) tiku/manifest.json 合法 JSON：v 为正整数、updated 为日期、shards 数组每项 {f, n} 且 f 唯一、n 为非负整数
//   2) 每个登记分片存在、是 JSON 数组、≤500 条
//   3) 每条 {h,t,a}：h 恰 16 位小写 hex；t ∈ s/m/b/f/q；a 非空 ≤2000 字符
//   4) 全库指纹唯一（跨分片重复 → 拒绝，污染检测）
//   5) manifest 登记数 n 与分片实际条数一致
//   6) PR 只允许改 tiku/ 目录（防注入 workflow / 恶意文件）
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const H_RE = /^[0-9a-f]{16}$/;
const TYPES = new Set(['s', 'm', 'b', 'f', 'q']);
const SHARD_MAX = 500;

function fail(msg) {
    console.error('❌ ' + msg);
    process.exit(1);
}

// 本次 PR 改动的文件（git diff 上游 main...HEAD）
function changedFiles() {
    const { execSync } = require('child_process');
    try {
        const out = execSync('git diff --name-only origin/main...HEAD', { cwd: ROOT, encoding: 'utf8' });
        return out.split('\n').map(s => s.trim()).filter(Boolean);
    } catch (e) {
        // 本地跑（无 origin）：退化为全量文件
        return fs.readdirSync(path.join(ROOT, 'tiku')).map(f => 'tiku/' + f);
    }
}

const files = changedFiles();
const bad = files.filter(f => !/^tiku\//.test(f));
if (bad.length) fail('PR 改动了 tiku/ 之外的文件: ' + bad.join(', '));
if (!files.length) fail('PR 未改动任何文件');
if (!files.includes('tiku/manifest.json')) fail('PR 必须更新 tiku/manifest.json（分片登记）');

// 1) manifest
let man;
try { man = JSON.parse(fs.readFileSync(path.join(ROOT, 'tiku', 'manifest.json'), 'utf8')); } catch (e) { fail('manifest.json 不是合法 JSON: ' + e.message); }
if (!Number.isInteger(man.v) || man.v < 1) fail('manifest.v 必须是正整数');
if (!/^\d{4}-\d{2}-\d{2}/.test(String(man.updated || ''))) fail('manifest.updated 必须是日期');
if (!Array.isArray(man.shards) || !man.shards.length) fail('manifest.shards 必须是非空数组');
const seenF = new Set();
for (const s of man.shards) {
    if (!s || typeof s !== 'object' || !/^shard-[0-9a-z_]+\.json$/.test(String(s.f || ''))) fail('shards 项非法 f: ' + JSON.stringify(s));
    if (seenF.has(s.f)) fail('shards 重复登记: ' + s.f);
    seenF.add(s.f);
    if (!Number.isInteger(s.n) || s.n < 0) fail('shards.n 必须是非负整数: ' + s.f);
}

// 2/3/4/5) 分片内容 + 指纹唯一性 + 计数一致
const seenH = new Map(); // h -> shard 文件（跨分片重复 = 污染）
let totalReal = 0;
for (const s of man.shards) {
    const p = path.join(ROOT, 'tiku', s.f);
    let arr;
    try { arr = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail(s.f + ' 不是合法 JSON: ' + e.message); }
    if (!Array.isArray(arr)) fail(s.f + ' 必须是 JSON 数组');
    if (arr.length > SHARD_MAX) fail(s.f + ' 超过 ' + SHARD_MAX + ' 条上限（实际 ' + arr.length + '）');
    arr.forEach((it, i) => {
        const tag = s.f + '#' + i;
        if (!it || typeof it !== 'object') fail(tag + ' 条目必须是对象');
        if (!H_RE.test(String(it.h || ''))) fail(tag + ' 指纹非法: ' + String(it.h).slice(0, 40));
        if (!TYPES.has(it.t)) fail(tag + ' 题型非法: ' + String(it.t).slice(0, 10));
        if (typeof it.a !== 'string' || !it.a.trim()) fail(tag + ' 答案为空');
        if (it.a.length > 2000) fail(tag + ' 答案超长（' + it.a.length + ' > 2000）');
        if (seenH.has(it.h)) fail(tag + ' 指纹与 ' + seenH.get(it.h) + ' 重复（同一题多答案属污染，拒绝合并）');
        seenH.set(it.h, tag);
    });
    totalReal += arr.length;
    if (arr.length !== s.n) fail(s.f + ' manifest 计数 n=' + s.n + ' 与实际 ' + arr.length + ' 不一致');
}
// 未登记的孤儿分片也不允许混入（PR 新增文件必须全部登记）
for (const f of files) {
    if (/^tiku\/shard-.+\.json$/.test(f) && !seenF.has(f.replace('tiku/', ''))) fail('分片未在 manifest 登记: ' + f);
}

console.log('✅ 校验通过：manifest v' + man.v + '，' + man.shards.length + ' 分片共 ' + totalReal + ' 条，全部指纹唯一');
