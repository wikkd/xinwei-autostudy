#!/usr/bin/env node
'use strict';
/*
 * 一键部署到浏览器 ScriptCat：构建 → 复制剪贴板 → 定位编辑器标签 → 自动粘贴并保存
 *
 * 用法：
 *   node deploy.js          标准部署
 *   node deploy.js --slow   Chrome 较慢时使用（粘贴前多等 5s）
 *
 * 前提：Chrome 运行中，且任意标签页打开了 ScriptCat 的「芯位网课辅助」编辑器。
 *
 * 原理：激活 Chrome → 循环 Ctrl+Tab 并读取窗口标题，直到标题含 "Script Editor"
 *       → Ctrl+A 全选 → Ctrl+V 粘贴 → Ctrl+S 保存。
 * 成功标志：编辑器页顶部出现「保存成功」气泡。
 *
 * 实测教训：
 *   - SendKeys 输 URL：冒号会被打成全角「：」，Chrome 当作搜索打开 Bing —— 禁用；
 *   - start chrome <url>：每次都新开标签堆积 —— 禁用；
 *   - Ctrl+数字：AX 树里标签顺序与视觉顺序相反，不可靠 —— 改用标题校验；
 *   - ps1 必须纯 ASCII（无 BOM 时中文按 ANSI 读会乱码导致匹配失败）。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist', 'xinwei-autostudy.user.js');
const PS1 = path.join(__dirname, '.deploy-keys.ps1');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = cmd => execSync(cmd, { stdio: 'inherit', shell: true });
const runOut = cmd => execSync(cmd, { encoding: 'utf8', shell: true });

// 执行一段 PowerShell（写临时 ps1 文件，纯 ASCII）
function ps(script) {
    fs.writeFileSync(PS1, script, 'utf8');
    return runOut(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS1}"`);
}

const ACTIVATE = `
Add-Type -Namespace Win32 -Name FG -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
'@
$p = Get-Process chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
if (-not $p) { Write-Output 'NO-CHROME'; exit }
[Win32.FG]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[Win32.FG]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
Write-Output ("TITLE=" + $p.MainWindowTitle)
`;

const NEXT_TAB = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^{TAB}')
Start-Sleep -Milliseconds 700
$p = Get-Process chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
Write-Output ("TITLE=" + $p.MainWindowTitle)
`;

const SAVE_KEYS = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 2500
[System.Windows.Forms.SendKeys]::SendWait('^s'); Start-Sleep -Milliseconds 900
Write-Output 'KEYS-SENT'
`;

(async () => {
    console.log('① 构建 dist ...');
    run('node build.js');

    console.log('② 复制到剪贴板 ...');
    run(`powershell -NoProfile -Command "Set-Clipboard ([System.IO.File]::ReadAllText('${DIST}', [System.Text.Encoding]::UTF8))"`);

    console.log('③ 激活 Chrome ...');
    let out = ps(ACTIVATE);
    if (out.includes('NO-CHROME')) {
        console.log('⚠️ 未检测到运行中的 Chrome。请先启动 Chrome 并打开编辑器标签。');
        process.exit(1);
    }
    let title = (out.match(/TITLE=(.*)/) || [])[1] || '';

    // 循环 Ctrl+Tab 直到激活标签是编辑器（标题含 "Script Editor"），最多 15 次
    if (!/Script Editor/.test(title)) {
        console.log('④ 定位编辑器标签（Ctrl+Tab 循环）...');
        for (let i = 0; i < 15; i++) {
            out = ps(NEXT_TAB);
            title = (out.match(/TITLE=(.*)/) || [])[1] || '';
            if (/Script Editor/.test(title)) break;
        }
    }
    if (!/Script Editor/.test(title)) {
        console.log('⚠️ 未找到编辑器标签（窗口标题轮询 15 次未命中）。请打开一次 ScriptCat 编辑器标签后重试。');
        process.exit(1);
    }
    console.log('   已定位：' + title.trim());

    const wait = process.argv.includes('--slow') ? 5000 : 0;
    if (wait) { console.log(`   额外等待 ${wait / 1000}s ...`); await sleep(wait); }

    console.log('⑤ 粘贴并保存 ...');
    out = ps(SAVE_KEYS);
    if (out.includes('KEYS-SENT')) {
        console.log('✅ 部署完成：浏览器编辑器页应显示「保存成功」气泡。');
        console.log('   目标网站页面刷新后即加载新版本。');
    } else {
        console.log('⚠️ 键盘发送未确认，请手动 Ctrl+A/V/S。');
    }
})().catch(e => {
    console.error('部署失败:', e.message);
    process.exit(1);
});
