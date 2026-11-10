// ==================== 作业巡航（列表推进 / 自动提交 / 一键巡航） ====================
// 从 qa.js 拆出的巡航三件套：作业列表逐份推进、答完自动提交、课程页一键进入巡航。
// 状态字段（_walkerNav/_walkerEmptyLog/_submitting/_lastSubmitTry/_donePage）仍挂在
// XIA_AI 上——test-qa 的 resetAI 统一复位它们，拆文件不拆状态。
// 与 qa.js 共享同一 IIFE 作用域；对 XIA_AI/exactText/conf 的引用都在运行期解析，
// 因此 BODY_ORDER 里放在 qa.js 之后仅是阅读顺序约束，非依赖约束。

// ===== 作业列表巡航：自动逐份完成列表中的作业 =====
// 状态机：提交完成详情页(homeworkDetailPage) → 返回列表 → 打开下一份「做作业」→ 试卷页(homeworkPaperId)交给答题主流程。
// 仅在自动答题开启时由 scan() 驱动；返回 true 表示当前页由巡航接管（列表/详情页）。
function homeworkWalker() {
    const h = location.hash || '';
    const now = Date.now();
    if (h.indexOf('homeworkDetailPage') >= 0) { // 提交完成后的详情/成绩页：停留十几秒再返回，模拟人工节奏
        if (now - XIA_AI._walkerNav < 12000) return true;
        XIA_AI._walkerNav = now;
        const link = exactText('a, button, [role="button"]', '作业考试');
        if (link) {
            XIA_AI.log(' 本份作业已提交，返回作业列表', 'ok');
            XIA_AI.progress('已提交，返回列表中');
            try { link.click(); } catch (e) {}
        }
        return true;
    }
    if (h.indexOf('homeworkPaperId') >= 0) return false;
    if (h.indexOf('/homework') >= 0) { // 作业列表页
        if (now - XIA_AI._walkerNav < 8000) return true;
        XIA_AI._walkerNav = now;
        const btn = exactText('button, [role="button"]', '做作业');
        if (btn) {
            XIA_AI.log(' 打开下一份未完成作业', 'ok');
            XIA_AI.progress('打开下一份作业…');
            try { btn.click(); } catch (e) {}
        } else if (now - XIA_AI._walkerEmptyLog > 60000) {
            XIA_AI._walkerEmptyLog = now;
            XIA_AI.log('作业列表暂无未完成作业（全部完成或待批改）', 'info');
            XIA_AI.progress('列表暂无未完成作业');
            xaNotify('cruise', '作业巡航完成', '作业列表暂无未完成作业（全部完成或待批改）');
        }
        return true;
    }
    return false;
}

// ===== 答完自动提交作业（XIA_AI.tryAutoSubmit 委托到此） =====
// 点「提交作业」并自动确认；弹窗提示有未答题时取消并留给人工。
// 仅精确匹配「提交作业」按钮，绝不触碰考试类的「交卷/提交试卷」。30s 节流，可反复重试。
// 确认模式下整体停用：提交这一步正是人工把关的最后一道闸。
function runAutoSubmit() {
    if (conf.confirmAnswer) return;
    const now = Date.now();
    if (XIA_AI._submitting) return;
    if (XIA_AI._lastSubmitTry && now - XIA_AI._lastSubmitTry < 30000) return;
    XIA_AI._lastSubmitTry = now;
    let btn = null;
    qsa('button, [role="button"]').forEach(el => {
        if (btn || !visible(el)) return;
        if (qtextAll(el) === '提交作业') btn = el;
    });
    if (!btn) return;
    if (btn.disabled || (btn.className || '').indexOf('is-disabled') >= 0) {
        XIA_AI.log('「提交作业」按钮不可用（可能有题目未作答），30s 后重试', 'info');
        return;
    }
    XIA_AI._submitting = true;
    XIA_AI.log(' 全部答完，自动提交作业...', 'ok');
    XIA_AI.progress('自动提交中…');
    try { btn.click(); } catch (e) {}
    setTimeout(() => {
        // 确认弹窗：element-ui 组件；找不到弹层时退化为全页扫「确定/确认/提交」文本按钮。
        const pops = qsa('.el-message-box, .el-dialog, .el-popconfirm, [class*="dialog"], [class*="popup"]').filter(visible);
        if (pops.length) {
            const msg = pops.map(d => qtextAll(d)).join(' ');
            if (/未(作答|回答|完成)|尚未(作答|完成)|还有\d*题|请(先)?(答完|完成所有|作答)/.test(msg)) {
                XIA_AI.log('平台提示有题目未作答，已取消自动提交，请人工补答', 'error');
                const cancel = pops.map(d => qsa('button, a, [class*="btn"]', d)).flat()
                    .filter(visible).find(b => /^(取消|关闭|继续答题)$/.test(qtextAll(b)));
                try { if (cancel) cancel.click(); } catch (e) {}
                XIA_AI._submitting = false;
                return;
            }
        }
        const scope = pops.length ? pops : [document.body];
        const confirm = scope.map(d => qsa('button, a, [class*="btn"]', d)).flat()
            .filter(visible).find(b => /^(确定|确认|提交)$/.test(qtextAll(b)) && !b.disabled);
        if (confirm) {
            try { confirm.click(); } catch (e) {}
            XIA_AI.log('已点击确认提交', 'ok');
        } else {
            XIA_AI.log('未找到确认按钮，请人工提交', 'error');
            XIA_AI._submitting = false;
            return;
        }
        setTimeout(() => {
            const toast = qsa('.el-message, [class*="toast"], [class*="success"]').map(m => m.textContent || '').join(' ');
            if (/提交成功|成功/.test(toast) || !qtextAll(document.body).includes('提交作业')) {
                XIA_AI._donePage = location.hash + location.pathname; // 本页已提交完成，交给 walker 接管
                XIA_AI.bump('submitted');
                XIA_AI.log(' 作业提交成功', 'ok');
                XIA_AI.progress('提交成功');
                xaNotify('submit', '作业提交成功', '当前作业已提交，巡航继续下一份', 60000);
            } else {
                XIA_AI.log('提交结果未确认（无成功提示），请人工核对', 'info');
            }
            XIA_AI._submitting = false;
        }, 2500);
    }, 1200);
}

// =====  一键作业巡航（XIA_AI.cruise 委托到此） =====
// 从当前课程页打开「作业考试」列表，之后 homeworkWalker 自动逐份完成
function runCruise() {
    const link = exactText('a, button, [role="button"], li.el-menu-item, .el-sub-menu__title', '作业考试')
        || qsa('a, button, li.el-menu-item, .el-sub-menu__title').find(el => visible(el) && /作业考试|作业与考试|课程作业/.test(qtext(el)));
    if (link) {
        XIA_AI.log(' 已进入作业列表，巡航开始', 'ok');
        XIA_AI.progress('作业巡航中');
        try { link.click(); } catch (e) {}
        if (!conf.autoAnswer) { // 顺手把自动答题开关打开，巡航才能真正跑起来
            const sw = document.getElementById('xa-autoanswer-switch');
            if (sw) sw.click();
        }
    } else {
        XIA_AI.log('未找到「作业考试」入口，请先在课程菜单里手动展开一次', 'error');
    }
}
