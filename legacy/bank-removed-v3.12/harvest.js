// ==================== 全库扫描（复盘采集 / API 直拉 / DOM 走查）====================
// 从 qa.js 拆出：复盘页采集 + 跨课程扫描状态机（XIA_AI 方法扩展）。
// 加载顺序在 qa.js 之后（此处 Object.assign 扩展 XIA_AI）；由 ui.js 的 harvestTimer 驱动 harvestTick。

// ===== 复盘页答案采集 =====
// 已完成作业（status=3 已批改）的查看页：每题渲染得分条「本题得分：X 分」（.result-score-content）。
// 得分 = 题面分值的题，其选中项即平台验证过的正确答案 → 抓进答案本（重做同卷直接回填）。
// DOM 依据 detailPage/SingleSelected chunk 实证：
// 题目组件 mode=detail 渲染，类名与答题页一致（.homework-single-selected 等 + .question-tag-score）。
function harvestReviewPage() {
    let harvested = 0, skipped = 0;
    qsa('.question-tag-score').forEach(tag => {
        const root = tag.closest(XIA_QROOT) || tag.parentElement;
        if (!root || !visible(root)) return;
        // 题块边界：向上找含得分条的最近容器（question-area / question-content-body）
        let box = root.parentElement, scoreText = '';
        for (let i = 0; box && i < 6; i++, box = box.parentElement) {
            const bar = box.querySelector('.result-score-content');
            if (bar) { scoreText = qtext(bar); break; }
        }
        if (!scoreText) { skipped++; return; } // 无得分条（未批改/答题页）不采
        const gotM = scoreText.match(/(\d+(?:\.\d+)?)/);
        const full = QA.questionScore(root);
        const got = gotM ? parseFloat(gotM[1]) : -1;
        if (!gotM || full <= 0 || Math.abs(got - full) > 0.01) { skipped++; return; } // 非满分不采，宁缺毋滥
        const q = parseQuestionRoot(root);
        if (!q || q.type === 'subjective') { skipped++; return; } // 主观题无固定答案不采
        // 选中项字母：判断题无 .index-name（渲染为 T.对/F.错），QA.letterOf 取不到 → 按位置兜底 A/B
        // （与 extractOptions 的字母分配一致：第 i 个选项 = A+i）
        const allLabels = qsa('.el-radio, .el-checkbox', root);
        const picked = allLabels
            .filter(l => l.classList.contains('is-checked'))
            .map(l => QA.letterOf(l) || String.fromCharCode(65 + allLabels.indexOf(l)))
            .filter(Boolean).sort().join('');
        if (!picked) { skipped++; return; }
        const hash = questionHash(q);
        const known = XIA_AI.bankGet(hash);
        XIA_AI.bankSet(hash, picked);
        harvested++;
        if (!known || known !== picked) {
            XIA_AI.log('📗 采集: ' + q.question.slice(0, 36) + (q.question.length > 36 ? '…' : '') + ' → ' + picked, 'ok');
        }
    });
    return { harvested, skipped };
}

Object.assign(XIA_AI, {
    // 📗 复盘页采集入口：已批改作业的查看页自动抓满分题答案进答案本。
    // SPA 路由感知：hash 变化 + 渲染延迟后执行，按页面 URL 去重防重复采集。
    maybeHarvestReview() {
        const h = location.hash + location.pathname;
        if (h.indexOf('homeworkDetailPage') < 0 && h.indexOf('homeworkPaperId') < 0) return; // 仅复盘/详情页
        if (XIA_AI._harvestPage === h) return;
        XIA_AI._harvestPage = h;
        // 等题目组件渲染完成（Vue 异步渲染，轮询到题块出现或超时）
        let tries = 0;
        const poll = () => {
            const n = qsa('.question-tag-score').length;
            if (n > 0 || tries > 10) {
                const r = harvestReviewPage();
                if (r.harvested) XIA_AI.log('📗 复盘采集完成: 新收 ' + r.harvested + ' 题（非满分跳过 ' + r.skipped + ' 题）', 'ok');
                else if (tries > 10) XIA_AI.log('📗 本页无可采集题目（未批改或非复盘页）', 'info');
            } else { tries++; setTimeout(poll, 800); }
        };
        setTimeout(poll, 1200);
    },

    // 📡 全库扫描状态机（跨课程）：自动扫完「正在上课」全部课程的已完成作业满分题。
    // 由 ui.js 的 harvestTimer 每 2.5s 驱动 harvestTick()。单课程循环：
    //   课程作业列表(tabKey=2) → 点「查看作业」→ 复盘页采集 → 返回列表 → 下一份 → 翻页 → 下一门课程
    // 状态持久化到 GM（SK.harvestState）：SPA 整页跳转（进课程/回列表）不丢队列进度。
    // 与答题巡航 homeworkWalker 互斥：扫描优先，答题暂停。
    _hvLoad() {
        try { return JSON.parse(GM_getValue(SK.harvestState, 'null')) || null; } catch (e) { return null; }
    },
    _hvSave() {
        try {
            GM_setValue(SK.harvestState, JSON.stringify({
                on: XIA_AI._harvestOn,
                queue: XIA_AI._hvQueue || [],
                idx: XIA_AI._hvIdx || 0,
                done: XIA_AI._hvDone || 0,
                total: XIA_AI._hvTotal || 0,
                seenTitles: XIA_AI._hvSeenTitles || [],
                apiMode: !!XIA_AI._hvApi,
                newCnt: XIA_AI._hvNew || 0,
            }));
        } catch (e) {}
    },

    harvestTick() {
        if (!XIA_AI._harvestOn) return;
        // v3.5.0 API 直拉模式：整条扫描在后台请求完成，页面全程不动（也不阻塞答题巡航）
        if (XIA_AI._hvApi) { XIA_AI._hvApiTick(); return; }
        const h = location.hash || '';
        const now = Date.now();

        // 复盘/详情页：等渲染完采集，然后返回作业列表
        if (h.indexOf('homeworkDetailPage') >= 0) {
            if (!XIA_AI._hvNav) XIA_AI._hvNav = now; // 进页时间
            if (now - XIA_AI._hvNav < 2500) return;  // 等 Vue 渲染
            const r = harvestReviewPage();
            XIA_AI._hvTotal = (XIA_AI._hvTotal || 0) + r.harvested;
            XIA_AI.progress('📡 ' + (XIA_AI._hvCourse || '') + ' 扫描中…本卷 +' + r.harvested);
            if (!XIA_AI._hvQuiet) XIA_AI.log('📡 ' + (XIA_AI._hvTitle || '当前作业') + ': 采集 ' + r.harvested + ' 题（跳过 ' + r.skipped + '）', r.harvested ? 'ok' : 'info');
            XIA_AI._hvQuiet = true;
            if (now - XIA_AI._hvNav > 4000) {
                XIA_AI._hvSave();
                const back = exactText('a, button, [role="button"]', '作业考试') || exactText('a, button, [role="button"]', '返回');
                if (back) { try { back.click(); } catch (e) {} }
                else { try { history.back(); } catch (e2) {} }
                XIA_AI._hvNav = 0; XIA_AI._hvDone = (XIA_AI._hvDone || 0) + 1;
            }
            return;
        }
        XIA_AI._hvNav = 0; XIA_AI._hvQuiet = false;

        // 试卷页（答题页路由）不是扫描目标，跳过等它离开
        if (h.indexOf('homeworkPaperId') >= 0) return;

        // 作业列表页：驱动当前课程的扫描
        if (h.indexOf('/homework') >= 0) {
            XIA_AI._hvIdleAt = 0; XIA_AI._hvIdleRetry = 0; // 已到列表页：清导航等待态
            // 页签状态在 hash 的 query 里（应用为 hash 模式！）：tabKey: 0未完成/1待批改/2已完成（ListPage chunk 实证）
            if (!/tabKey=2/.test(h)) {
                if (!XIA_AI._hvTabFirst) XIA_AI._hvTabFirst = now;
                if (now - XIA_AI._hvTabFirst > 45000) { // 页签 45s 切不过去（URL 落错/组件异常）→ 跳过本课程防死循环
                    XIA_AI._hvTabFirst = 0;
                    XIA_AI._nextCourse('已完成页签切换超时');
                    return;
                }
                // 优先直接点击「已完成」页签（Vue 组件自行 router.replace，最可靠）
                const tab = exactText('.tab, .status-tab .tab', '已完成');
                if (tab) { try { tab.click(); } catch (e) {} }
                // 点击兜底：改写 hash 的 tabKey（hashchange 驱动 vue-router 导航，不刷新页面、不重载脚本）
                if (!XIA_AI._hvTabNav || now - XIA_AI._hvTabNav > 8000) {
                    XIA_AI._hvTabNav = now;
                    const nh = /tabKey=\d+/.test(h) ? h.replace(/tabKey=\d+/, 'tabKey=2') : h + (h.indexOf('?') >= 0 ? '&' : '?') + 'tabKey=2';
                    try { location.replace(location.pathname + location.search + nh); } catch (e) {}
                }
                return;
            }
            XIA_AI._hvTabFirst = 0; // 已到已完成页签：清超时计数
            if (now - (XIA_AI._hvTabAt || 0) < 1500) return; // 页签渲染等待
            XIA_AI._hvTabAt = XIA_AI._hvTabAt || now - 1500;

            // 「查看作业」按钮逐个处理：按「卡片标题」记名跳过已扫过的（DOM 重建后元素引用失效，
            // 不能用元素引用比较——实测返回列表后组件重挂载，旧写法 view===_hvLastBtn 永远 false 会死循环重扫第一份）
            const viewBtns = qsa('button, [role="button"], a, .el-button').filter(el => visible(el) && qtextAll(el) === '查看作业');
            if (viewBtns.length) {
                const seen = XIA_AI._hvSeenTitles || [];
                let target = null, targetKey = '', targetTitle = '';
                for (let i = 0; i < viewBtns.length; i++) {
                    const btn = viewBtns[i];
                    const card = btn.closest('.homework-list, .homework-item, [class*="card"]') || btn.parentElement;
                    const ct = card ? qtext(card) : '';
                    const m = ct.match(/考核点\s*([^\s]{2,24}?作业)|(第[^章]{1,8}章[^\s]{0,12}作业)|([^\s:：]{2,24}作业)/);
                    const title = m ? (m[1] || m[2] || m[3] || '') : '';
                    const sm = ct.match(/(\d+(?:\.\d+)?)\s*分/);
                    const key = (title || ('idx' + i)) + (sm ? '|' + sm[1] : '');
                    if (seen.indexOf(key) < 0) { target = btn; targetKey = key; targetTitle = title; break; }
                }
                if (target) {
                    seen.push(targetKey);
                    XIA_AI._hvSeenTitles = seen;
                    XIA_AI._hvTitle = targetTitle;
                    XIA_AI._hvSave();
                    XIA_AI.log('📡 [' + (XIA_AI._hvCourse || '') + '] 打开: ' + (targetTitle || '作业'), 'info');
                    try { target.click(); } catch (e) {}
                    return;
                }
                // 本页全部扫过 → 翻页；无下一页（或超页数上限）→ 本课程结束
                const next = qsa('.el-pagination .btn-next, .el-pagination button.btn-next').find(visible);
                if (next && !next.disabled && (XIA_AI._hvPage || 0) < 20) {
                    XIA_AI._hvPage = (XIA_AI._hvPage || 0) + 1;
                    try { next.click(); } catch (e) {}
                    XIA_AI.log('📡 已完成作业第 ' + (XIA_AI._hvPage + 1) + ' 页…', 'info');
                    return;
                }
                XIA_AI._nextCourse('本课程扫完');
                return;
            }

            // 空转：重试页签，仍无「查看作业」→ 本课程无已完成作业，下一门
            XIA_AI._hvEmpty = (XIA_AI._hvEmpty || 0) + 1;
            if (XIA_AI._hvEmpty === 3) {
                const tab = exactText('.tab, .status-tab .tab, button, [role="button"]', '已完成');
                if (tab) { try { tab.click(); } catch (e) {} }
                return;
            }
            if (XIA_AI._hvEmpty >= 6) XIA_AI._nextCourse('本课程无可扫作业');
            return;
        }

        // 非作业页（课程学习页/主页/等待导航中）：正常情况下 gotoCourseHomework 发起的导航很快到页，
        // 落在这里说明导航失败/被拦截 → 90s 后重试一次当前课程的 URL 直达，再 90s 仍失败则跳过该课程
        if (!XIA_AI._hvIdleAt) XIA_AI._hvIdleAt = now;
        const idle = now - XIA_AI._hvIdleAt;
        if (idle > 90000) {
            XIA_AI._hvIdleAt = now;
            XIA_AI._hvIdleRetry = (XIA_AI._hvIdleRetry || 0) + 1;
            if (XIA_AI._hvIdleRetry >= 2) { XIA_AI._hvIdleRetry = 0; XIA_AI._nextCourse('导航失败，跳过'); return; }
            XIA_AI.log('📡 长时间未到作业列表，重试导航…', 'info');
            XIA_AI.gotoCourseHomework(XIA_AI._hvIdx);
        } else if (now - (XIA_AI._hvIdleLog || 0) > 30000) {
            XIA_AI._hvIdleLog = now;
            XIA_AI.log('📡 等待进入作业列表…（当前页非作业列表）', 'info');
        }
    },

    // 当前课程结束 → 推进队列；全部完成则停机
    _nextCourse(reason) {
        XIA_AI._hvEmpty = 0; XIA_AI._hvPage = 0; XIA_AI._hvTabNav = 0; XIA_AI._hvTabFirst = 0;
        XIA_AI._hvSeenTitles = []; // 换课程：已扫记名清空
        XIA_AI._hvIdx = (XIA_AI._hvIdx || 0) + 1;
        if (XIA_AI._hvIdx >= (XIA_AI._hvQueue || []).length) {
            XIA_AI.log('📡 全库扫描完成: 共 ' + (XIA_AI._hvQueue || []).length + ' 门课程，扫 ' + XIA_AI._hvDone + ' 卷，采集 ' + XIA_AI._hvTotal + ' 题进答案本', 'ok');
            XIA_AI.progress('📡 全部完成 +' + XIA_AI._hvTotal);
            XIA_AI.harvestStop();
            const sw = document.querySelector('#xa-harvest-switch');
            if (sw) sw.classList.remove('on');
            return;
        }
        XIA_AI._hvSave();
        XIA_AI.gotoCourseHomework(XIA_AI._hvIdx); // URL 直达下一门作业列表（整页导航，bootstrap 会恢复状态）
    },

    // ===== 📡 API 直拉状态机（v3.5.0）：不导航页面，后台依次拉取每门课的已完成作业与标准答案 =====
    // 契约真机校准（2026-10-10）：
    //   课表  queryLearnCoursePage → code:200, records[]（courseStatus 1在学/2已结课, versions='v2'）
    //   作业  getHomeworkList body {status:2, teachingClassId, pageNo, pageSize} → data.records[]（homeworkPaperId）
    //   详情  getDoneHomeworkPaperDetail/{paperId}/{classId} POST 空 body → homeworkTopicList[]（含 topicRightAnswerList）
    // 每门课 1 + ceil(卷数/50) + 卷数 个请求；33 门课实测约 380 个请求。串行 + 300ms 间隔，限流友好；
    // 连续 5 次请求失败 → 判定接口异常，自动降级 DOM 走查模式（_hvApi=false 走原 harvestTick 逻辑）。
    _hvApiGet(url, body, cb) {
        let token = '';
        try { token = localStorage.getItem('loginToken') || ''; } catch (e) {}
        const onFail = msg => {
            XIA_AI._hvApiFails = (XIA_AI._hvApiFails || 0) + 1;
            XIA_AI.log('📡 API 请求失败(' + XIA_AI._hvApiFails + '/5): ' + msg, 'error');
            if (XIA_AI._hvApiFails >= 5) {
                XIA_AI.log('📡 接口连续失败，自动降级为页面走查模式', 'error');
                XIA_AI._hvApiFails = 0; XIA_AI._hvApi = false;
                XIA_AI.gotoCourseHomework(XIA_AI._hvIdx); // 进入 DOM 模式（页面导航式扫描）
            } else cb(null);
        };
        try {
            GM_xmlhttpRequest({
                method: 'POST', timeout: 20000, url: url,
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': token } : {}) },
                data: JSON.stringify(body || {}),
                onload: res => {
                    if (res.status !== 200) { onFail('HTTP ' + res.status); return; }
                    try {
                        const j = typeof res.response === 'object' ? res.response : JSON.parse(res.responseText);
                        if (j.code != null && !/^(0|1|200)$/.test(String(j.code))) { onFail('业务 code=' + j.code + ' ' + (j.msg || '')); return; }
                        XIA_AI._hvApiFails = 0; // 成功即清零（零星超时不降级）
                        cb(j);
                    } catch (e) { onFail('解析: ' + e.message); }
                },
                onerror: () => onFail('网络错误'),
                ontimeout: () => onFail('超时'),
            });
        } catch (e) { onFail('异常: ' + e.message); }
    },

    _hvApiStart() {
        XIA_AI._hvApi = true; XIA_AI._hvApiFails = 0; XIA_AI._hvApiBeat = Date.now();
        XIA_AI.progress('📡 API 扫描：拉取课表…');
        XIA_AI.log('📡 API 直拉模式启动：直接调平台接口采集标准答案（页面不动，答题不受影响）', 'ok');
        XIA_AI.collectCourseQueue(list => {
            if (!XIA_AI._harvestOn) return;
            if (!list.length) {
                XIA_AI.log('⚠️ 未获取到可扫描的 v2 课程，扫描停止', 'error');
                XIA_AI.harvestStop();
                const sw = document.querySelector('#xa-harvest-switch');
                if (sw) sw.classList.remove('on');
                return;
            }
            XIA_AI._hvQueue = list; XIA_AI._hvIdx = 0; XIA_AI._hvDone = 0; XIA_AI._hvTotal = 0;
            XIA_AI._hvSave();
            XIA_AI.log('📡 收集到 ' + list.length + ' 门课程，开始逐课拉取（预计 ' + Math.ceil(list.length * 12 / 60) + ' 分钟）', 'ok');
            XIA_AI._hvApiNext();
        });
    },

    _hvApiNext() {
        if (!XIA_AI._harvestOn || !XIA_AI._hvApi) return;
        if (XIA_AI._hvIdx >= (XIA_AI._hvQueue || []).length) {
            XIA_AI.log('📡 全库扫描完成: 共 ' + XIA_AI._hvQueue.length + ' 门课程，扫 ' + XIA_AI._hvDone + ' 卷，采集 ' + XIA_AI._hvTotal + ' 题进答案本', 'ok');
            XIA_AI.progress('📡 全部完成 +' + XIA_AI._hvTotal);
            XIA_AI.harvestStop();
            const sw = document.querySelector('#xa-harvest-switch');
            if (sw) sw.classList.remove('on');
            return;
        }
        const c = XIA_AI._hvQueue[XIA_AI._hvIdx];
        XIA_AI._hvCourse = c.name;
        XIA_AI._hvSave();
        XIA_AI.progress('📡 (' + (XIA_AI._hvIdx + 1) + '/' + XIA_AI._hvQueue.length + ') ' + c.name + '：拉取作业列表…');
        const origin = location.origin;
        XIA_AI._hvApiGet(origin + '/api/learning-service/admin/studentHomeWork/getHomeworkList',
            { status: 2, teachingClassId: c.classId, pageNo: 1, pageSize: 50 }, j => {
                if (!XIA_AI._harvestOn || !XIA_AI._hvApi) return;
                if (!j) { XIA_AI._hvNextAfter(3000); return; } // 请求失败（未达降级线）→ 跳过本课程
                const recs = (j.data && j.data.records) || [];
                if (!recs.length) {
                    XIA_AI.log('📡 [' + c.name + '] 无已完成作业，跳过', 'info');
                    XIA_AI._hvIdx++; XIA_AI._hvNextAfter(200);
                    return;
                }
                XIA_AI.log('📡 [' + c.name + '] ' + recs.length + ' 份已完成作业，逐卷拉取答案…', 'info');
                // 串行拉取本课程所有卷（recs 顺序消费，用游标而非递归队列）
                let pi = 0;
                const pullOne = () => {
                    if (!XIA_AI._harvestOn || !XIA_AI._hvApi) return;
                    if (pi >= recs.length) { XIA_AI._hvIdx++; XIA_AI._hvNextAfter(300); return; }
                    const rec = recs[pi++];
                    XIA_AI.progress('📡 (' + (XIA_AI._hvIdx + 1) + '/' + XIA_AI._hvQueue.length + ') ' + c.name + ' ' + pi + '/' + recs.length + '：' + (rec.title || ''));
                    XIA_AI._hvApiGet(origin + '/api/learning-service/admin/studentLearning/getDoneHomeworkPaperDetail/'
                        + rec.homeworkPaperId + '/' + c.classId, {}, jd => {
                        if (!XIA_AI._harvestOn || !XIA_AI._hvApi) return;
                        if (jd) {
                            const topics = ((jd.data || {}).homeworkTopicList) || [];
                            let got = 0;
                            for (const t of topics) {
                                const m = xaApiMirrorTopic(t);
                                if (!m) continue; // 无答案/解析失败的题跳过
                                const hash = questionHash(m.q);
                                const known = XIA_AI.bankGet(hash);
                                XIA_AI.bankSet(hash, m.answer);
                                got++;
                                if (known !== m.answer) XIA_AI._hvNew++;
                            }
                            XIA_AI._hvDone = (XIA_AI._hvDone || 0) + 1;
                            XIA_AI._hvTotal = (XIA_AI._hvTotal || 0) + got;
                            if (!XIA_AI._hvQuiet) {
                                XIA_AI.log('📡 [' + c.name + '] ' + (rec.title || '') + ': 采集 ' + got + ' 题（累计 ' + XIA_AI._hvTotal + '）', 'ok');
                                XIA_AI._hvQuiet = true;
                                setTimeout(() => { XIA_AI._hvQuiet = false; }, 2500);
                            }
                            XIA_AI._hvSave();
                        }
                        XIA_AI._hvNextAfter(300, pullOne);
                    });
                };
                pullOne();
            });
    },

    // 下一跳延时（保活 + 解耦 setTimeout 嵌套）：delay 后执行 fn（缺省 _hvApiNext）
    _hvNextAfter(delay, fn) {
        setTimeout(() => {
            if (!XIA_AI._harvestOn || !XIA_AI._hvApi) return;
            XIA_AI._hvApiBeat = Date.now();
            (fn || (() => XIA_AI._hvApiNext()))();
        }, delay);
    },

    // API 模式看门狗：状态机由 setTimeout 链自驱动（_hvNextAfter），harvestTick 只做停滞恢复——
    // 请求回调丢失（浏览器后台节流/扩展异常）超过 45s 无心跳时踢链一次，防扫描静默挂死
    _hvApiTick() {
        const now = Date.now();
        if (!XIA_AI._hvApiBeat) XIA_AI._hvApiBeat = now;
        if (now - XIA_AI._hvApiBeat < 45000) return;
        XIA_AI._hvApiBeat = now;
        XIA_AI.log('📡 API 扫描疑似停滞，恢复链路…', 'info');
        XIA_AI._hvApiNext();
    },

    // 收集「正在上课」课程队列：直接调平台课表接口（竞品脚本同款用法）。
    // POST /api/learning-service/student/course/queryLearnCoursePage
    // 返回 records[] 含 courseId/classId/courseName/courseStatus/versions —— 拿来直接拼作业列表 URL。
    // 关键：必须带 Authorization（localStorage.loginToken，与页面 axios 拦截器一致），否则网关 401/重定向导致请求失败；
    // 且 onload 里要检查 HTTP status 与业务 code，不能只看 onerror。
    collectCourseQueue(cb) {
        const fin = list => { cb(list); };
        let user = {};
        let token = '';
        try { user = JSON.parse(localStorage.getItem('user') || '{}').userInfo || {}; } catch (e) {}
        try { token = localStorage.getItem('loginToken') || ''; } catch (e) {}
        const payload = {
            courseName: '', pageNo: 1, pageSize: 50, teachMode: ['3'],
            tenantId: String(user.tenantId || ''),
            userAccount: String(user.username || ''),
        };
        const fail = msg => { XIA_AI.log('📡 课表接口失败: ' + msg, 'error'); fin([]); };
        try {
            GM_xmlhttpRequest({
                method: 'POST', timeout: 15000,
                url: location.origin + '/api/learning-service/student/course/queryLearnCoursePage',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': token } : {}),
                },
                data: JSON.stringify(payload),
                onload: res => {
                    if (res.status !== 200) { fail('HTTP ' + res.status + ' ' + String(res.responseText || '').slice(0, 120)); return; }
                    try {
                        const j = typeof res.response === 'object' ? res.response : JSON.parse(res.responseText);
                        // 业务成功码：本接口实测返回 code:200（数字，msg=操作成功）；部分接口用 0/1 —— 三种都接受
                        if (j.code != null && !/^(0|1|200)$/.test(String(j.code))) { fail('业务错误 code=' + j.code + ' ' + (j.msg || '')); return; }
                        const recs = (j.data && j.data.records) || [];
                        // 收「正在上课」(1) 与「已结课」(2)：已结课课程的作业大多已批改，复盘采集价值更高。
                        // 仅收 v2(versions==='v2')——v1 路由不同且需 sessionStorage，跳过；0=即将开课无作业不扫
                        const list = recs
                            .filter(r => (r.courseStatus === 1 || r.courseStatus === 2) && r.versions === 'v2' && r.courseId && r.classId)
                            .map(r => ({ name: String(r.courseName || r.className || r.courseId), courseId: String(r.courseId), classId: String(r.classId), status: r.courseStatus }));
                        fin(list);
                    } catch (e) { fail('响应解析: ' + e.message); }
                },
                onerror: e => fail('网络错误（可能是未登录/跨域）'),
                ontimeout: () => fail('超时'),
            });
        } catch (e) { fail('异常: ' + e.message); }
    },

    // 进入队列第 idx 门课程的作业列表。
    // 【hash 模式】主包 router 创建为 vue-router createWebHashHistory（'#' 逐字实证）：路由与 query 全在 location.hash。
    // 【路由】主包路由表括号配对解析 + 平台菜单自身跳法（ElMenuComponent chunk）双重实证：
    //   push({name:'LearnHomeworkList', params:{courseId}, query:{classId,t,courseResourceId}})
    //   → /<courseType>/<courseId>/homework（与 learn 平级，无 learn 段）
    // 同壳（/student/）：直接改 hash → hashchange 驱动 vue-router SPA 导航（不重载、状态全保留）；
    // 跨壳：整页导航到 /student/ 壳目标 URL。tabKey=2 直接落「已完成」页签。
    gotoCourseHomework(idx) {
        const c = XIA_AI._hvQueue[idx];
        if (!c) return;
        let courseType = 'courseInfo';
        const m = (location.hash || '').match(/\/(courseInfo|shortCoursePreview|shortCourse)\//);
        if (m) courseType = m[1];
        const route = '#/' + courseType + '/' + c.courseId + '/homework?classId='
            + encodeURIComponent(c.classId) + '&tabKey=2&t=' + Date.now();
        XIA_AI._hvCourse = c.name;
        XIA_AI._hvIdleAt = 0; XIA_AI._hvIdleRetry = 0; // 重新计时导航等待
        XIA_AI.log('📡 [' + c.name + '] 打开作业列表 → …/' + c.courseId + '/homework', 'info');
        try {
            if (location.pathname.indexOf('/student') === 0) {
                // 同壳换课：只改 hash 时 vue-router 复用组件不重挂载（真机实测：页面仍显示上一门课），
                // 改 hash 后强制 reload 让应用按目标路由冷启动（扫描状态在 GM，harvestResume 自动续跑）
                location.hash = route;
                setTimeout(() => { try { location.reload(); } catch (e) {} }, 250);
            } else {
                location.href = location.origin + '/student/' + route; // 跨壳整页导航
            }
        } catch (e) {
            try { location.href = location.origin + '/student/' + route; } catch (e2) {}
        }
    },

    harvestStart() {
        if (XIA_AI._harvestOn) return;
        XIA_AI._harvestOn = true;
        XIA_AI._hvQueue = []; XIA_AI._hvIdx = 0; XIA_AI._hvDone = 0; XIA_AI._hvTotal = 0;
        XIA_AI._hvPage = 0; XIA_AI._hvEmpty = 0; XIA_AI._hvTabNav = 0; XIA_AI._hvTabFirst = 0; XIA_AI._hvSeenTitles = [];
        XIA_AI._hvNew = 0;
        XIA_AI._hvSave();
        XIA_AI.progress('📡 获取课表…');
        XIA_AI.log('📡 全库扫描启动: 正在获取课程列表（含已结课）…', 'ok');
        XIA_AI._hvApiStart(); // v3.5.0 默认 API 直拉模式；连续失败自动降级 DOM 走查（_hvApi=false）
    },
    harvestStop() {
        XIA_AI._harvestOn = false;
        XIA_AI._hvApi = false;
        try { GM_setValue(SK.harvestState, JSON.stringify({ on: false })); } catch (e) {}
        XIA_AI.progress('');
    },
    // 页面加载后恢复未完成的扫描（跨导航存活）：由 bootstrap 调用
    harvestResume() {
        const st = XIA_AI._hvLoad();
        if (!st || !st.on) return;
        // API 模式状态（queue 完整存 GM）：直接恢复直拉；DOM 模式（queue 为空）走原恢复逻辑
        if ((st.queue || []).length && st.apiMode) {
            XIA_AI._harvestOn = true;
            XIA_AI._hvApi = true; XIA_AI._hvApiFails = 0;
            XIA_AI._hvQueue = st.queue; XIA_AI._hvIdx = st.idx || 0;
            XIA_AI._hvDone = st.done || 0; XIA_AI._hvTotal = st.total || 0;
            XIA_AI._hvNew = st.newCnt || 0;
            XIA_AI._hvCourse = (XIA_AI._hvQueue[XIA_AI._hvIdx] || {}).name || '';
            XIA_AI.log('📡 恢复 API 全库扫描: [' + XIA_AI._hvCourse + '] (' + (XIA_AI._hvIdx + 1) + '/' + XIA_AI._hvQueue.length + ')，已采 ' + XIA_AI._hvTotal + ' 题', 'ok');
            const sw = document.querySelector('#xa-harvest-switch');
            if (sw) sw.classList.add('on');
            XIA_AI._hvNextAfter(1200);
            return;
        }
        // 首次启动后跳转课程列表的过渡期不恢复（queue 尚为空）
        if (!(st.queue || []).length) return;
        XIA_AI._harvestOn = true;
        XIA_AI._hvQueue = st.queue; XIA_AI._hvIdx = st.idx || 0;
        XIA_AI._hvDone = st.done || 0; XIA_AI._hvTotal = st.total || 0;
        XIA_AI._hvCourse = (XIA_AI._hvQueue[XIA_AI._hvIdx] || {}).name || '';
        XIA_AI._hvSeenTitles = st.seenTitles || []; // 恢复已扫记名（返回列表后 DOM 重建，靠它跳过已扫作业）
        XIA_AI._hvIdleAt = 0; XIA_AI._hvIdleRetry = 0;
        XIA_AI.log('📡 恢复全库扫描: [' + XIA_AI._hvCourse + '] (' + (XIA_AI._hvIdx + 1) + '/' + XIA_AI._hvQueue.length + ')，已采 ' + XIA_AI._hvTotal + ' 题', 'ok');
        const sw = document.querySelector('#xa-harvest-switch');
        if (sw) sw.classList.add('on');
        // 当前页不在该课程的作业列表 → URL 直达（整页导航后本函数会再次执行，届时已在列表页）
        const want = XIA_AI._hvQueue[XIA_AI._hvIdx];
        const hh = location.hash || '';
        if (want && !(hh.indexOf('/' + want.courseId + '/homework') >= 0 && /tabKey=2/.test(hh))) {
            XIA_AI.gotoCourseHomework(XIA_AI._hvIdx);
        }
    },
});
