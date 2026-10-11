// ==================== 学习状态异常弹窗自动刷新 ====================
// 平台风控弹窗出现时脚本无法操作，检测到后自动刷新页面恢复；刷新后按面板开关状态自动续跑。
// 三条服务端风控文案（2026-10-01 chunk 调研实锤，前端 0 命中→判定在服务端下发）：
//   ① 当前视频不允许倍速播放  ② 系统检测到你的学习状态异常，请刷新后继续学习  ③ 播放位置不合法
// 外加平台通用的「请刷新后继续学习」措辞兜底。
//
// 性能：快/慢双路径。快路径每 3s 只看可见弹窗节点（风控文案统一走 el-message-box，无弹窗零成本）；
// 全页 innerText 会强制样式重算+重排，降为 20s 一次的兜底扫描（弹窗实现变化时仍能捕获）。

function initPopupAutoReload() {
    const RELOAD_COOLDOWN = 20000; // 20s 冷却，防止刷新死循环
    const HINTS = ['学习状态异常', '请刷新后继续学习', '不允许倍速播放', '播放位置不合法'];
    const matchHit = t => HINTS.find(h => t.indexOf(h) !== -1);
    let slowAt = 0;
    const trigger = hit => {
        GM_setValue(SK.lastReload, Date.now());
        console.log('[芯位] 检测到平台风控弹窗（' + hit + '），3秒后自动刷新页面');
        setTimeout(() => { location.reload(); }, 3000);
    };
    setInterval(() => {
        const last = Number(GM_getValue(SK.lastReload, 0));
        if (Date.now() - last < RELOAD_COOLDOWN) return;
        // 快路径：可见弹窗的局部文本（只对已打开的少数节点读 innerText）
        for (const d of qsa('.el-message-box, .el-dialog, [role="dialog"]')) {
            if (!visible(d)) continue;
            const hit = matchHit(d.innerText || d.textContent || '');
            if (hit) { trigger(hit); return; }
        }
        // 慢路径：20s 一次全页兜底
        if (Date.now() - slowAt > 20000) {
            slowAt = Date.now();
            const hit = matchHit((document.body && document.body.innerText) || '');
            if (hit) trigger(hit);
        }
    }, 3000);
}

// ==================== 视频内弹题自动作答 ====================
// 平台视频播到 marker 点会暂停并弹出题目（chunk 逆向 2026-10-11，PopupQuestion 组件）：
//   弹窗 .popup-topic-dialog（append-to-body）；题干 = .question-type 同级的 <p>；
//   选项 .option-item > .option-content（文本 "A.内容"，判断题渲染 "T.对/F.错"）；
//   单选/判断 = .el-radio-group，多选 = .el-checkbox-group；footer .el-button「提交」（选中前置 disabled）；
//   提交走 answerVideoLearnQuestion 接口后回显答案，header 出现 .icon-close → 点击后平台自动恢复播放。
// 策略：与作业答题共用同一 AI 引擎（callAI → 字母答案 → 原生 click 回填）。
//   确认模式（confirmAnswer）只填不交；AI 失败留人工（同题最多重试 2 次）。
//   已答过的弹窗（重进视频回显）直接点关闭续播。
//   浮层期间 keepPlay/卡死看门狗已避让（utils.interactiveOverlay 覆盖 .el-dialog）。
let _mqKey = '', _mqState = '', _mqFails = {};
function initMarkerQuestion() {
    setInterval(() => {
        try { markerQuestionTick(); } catch (e) { console.log('[XIA-marker] 异常', e); }
    }, 2500);
}

function markerQuestionTick() {
    if (!conf.autoAnswer) return; // 自动答题关闭时不碰弹题（留给人工）
    const dlg = qsa('.popup-topic-dialog').find(visible);
    if (!dlg) { _mqKey = ''; _mqState = ''; return; }

    // 先解析题键：换题（新 marker / 重进视频）即复位状态机，防上一题状态泄漏到新弹窗
    const typeEl = dlg.querySelector('.question-type');
    const titleEl = typeEl && typeEl.parentElement ? typeEl.parentElement.querySelector('p') : null;
    const title = titleEl ? qtext(titleEl) : '';
    if (!title || title.length < 3) return;
    const isMulti = !!dlg.querySelector('.el-checkbox-group');
    const options = qsa('.option-item', dlg).map((item, i) => {
        const c = item.querySelector('.option-content');
        const m = c ? qtext(c).match(/^([A-H])[\.\．、:：]?/) : null;
        return { letter: m ? m[1] : String.fromCharCode(65 + i), text: c ? qtext(c).replace(/^[A-H][\.\．、:：]\s*/, '') : qtext(item), node: item };
    });
    if (!options.length) return;
    const key = title.slice(0, 80) + '|' + options.map(o => o.letter).join('');
    if (key !== _mqKey) { _mqKey = key; _mqState = ''; _mqFails[key] = _mqFails[key] || 0; }

    // 已答弹窗（提交完成/历史回显）：有关闭按钮就点，平台收到 popupDialogClose 自动续播
    if (_mqState === 'submitted' || !dlg.querySelector('.el-dialog__footer .el-button')) {
        const close = dlg.querySelector('.icon-close');
        if (close && visible(close)) {
            XIA_AI.log('📕 弹题已作答，关闭浮层恢复播放', 'ok');
            try { close.click(); } catch (e) {}
            _mqState = '';
        }
        return;
    }
    if (_mqState === 'busy' || _mqState === 'filled') return;
    if (_mqFails[key] >= 2) return; // 同题连败 2 次：留人工，不再打扰

    _mqState = 'busy';
    XIA_AI.log('🎬 视频弹题: ' + title.slice(0, 50) + (title.length > 50 ? '…' : '') + (isMulti ? '（多选）' : ''), 'ai');

    XIA_AI.callAI({ question: title, options: options, type: isMulti ? 'multi' : 'single', score: 0 }, ans => {
        if (!qsa('.popup-topic-dialog').includes(dlg) || !visible(dlg)) { _mqState = ''; return; } // 弹窗已不在，丢弃过期结果
        if (!ans) {
            _mqState = '';
            _mqFails[key] = (_mqFails[key] || 0) + 1;
            XIA_AI.log(_mqFails[key] >= 2 ? '弹题连续作答失败，留人工处理（视频将保持暂停）' : '弹题未取得答案，稍后重试', 'error');
            return;
        }
        // 回填：按字母命中 .option-item（option-content 前缀），原生 input click 驱动 Vue v-model
        const letters = String(ans).toUpperCase().replace(/[^A-H]/g, '').split('');
        let clicked = 0;
        for (const ch of letters) {
            let hit = options.find(o => o.letter === ch) || options[ch.charCodeAt(0) - 65];
            if (!hit) continue;
            const input = hit.node.querySelector('input[type="radio"], input[type="checkbox"]');
            if (input && !(isMulti && input.checked)) { try { input.click(); } catch (e) {} clicked++; }
        }
        if (!clicked) { _mqState = ''; _mqFails[key] = (_mqFails[key] || 0) + 1; XIA_AI.log('弹题选项点击失败，留人工处理', 'error'); return; }
        XIA_AI.log('弹题已选 ' + letters.join(''), 'ok');
        if (conf.confirmAnswer) { // 确认模式：只填不交，人工核对后点提交，视频随之恢复
            _mqState = 'filled';
            XIA_AI.progress('⏸ 弹题已填，待人工确认');
            return;
        }
        setTimeout(() => {
            const btn = dlg.querySelector('.el-dialog__footer .el-button');
            if (!btn || btn.disabled || (btn.className || '').indexOf('is-disabled') >= 0) { _mqState = ''; return; }
            try { btn.click(); } catch (e) {}
            XIA_AI.log('弹题已提交，提交后自动关闭续播', 'ok');
            _mqState = 'submitted'; // 下一 tick 由关闭分支点 .icon-close 恢复播放
        }, 600);
    });
}
