// ==================== 作业截止提醒 ====================
// 定期拉取在学课程的未完成作业（getHomeworkList status=0 todo），截止日临近时在面板横幅提醒。
// 接口契约沿用 legacy harvest.js 真机校准配方（2026-10-10，存档于 legacy/bank-removed-v3.12/）：
//   课表 queryLearnCoursePage {courseName,pageNo,pageSize,teachMode:['3'],tenantId,userAccount} → data.records[]
//   作业 getHomeworkList {status:0, teachingClassId, pageNo, pageSize} → data.records[]（status/endDate/title）
// 鉴权：Authorization = localStorage.loginToken（与页面 axios 拦截器一致，缺失会 401）。
// 节流：GM 时间戳跨刷新 30 分钟一次；结果存 GM，刷新后横幅免请求展示。
// 只提醒「临近截止」：已过期不提醒（一般也交不了，避免持续骚扰）；无截止日期的作业跳过。

// 截止时间解析："2026-10-18 23:59" / "2026-10-18" → 毫秒时间戳；无时间部分按当日 23:59:59 计
// （作业通常当天内有效）。解析失败返回 0（该项跳过不误报）。
function parseDeadline(text) {
    const m = String(text || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) return 0;
    const t = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59, 59).getTime();
    return isNaN(t) ? 0 : t;
}

// 纯函数：距截止的紧急级别。0=不提醒 1=临近（≤warnDays 天）2=紧急（≤24 小时）。
function deadlineLevel(endMs, nowMs, warnDays) {
    if (!endMs || endMs <= nowMs) return 0;
    const remain = endMs - nowMs;
    if (remain <= 86400000) return 2;
    if (remain <= warnDays * 86400000) return 1;
    return 0;
}

// 纯函数：单门课程的作业列表 → 临近截止的提醒条目（过滤已完成/无日期/不临近）
function deadlineItemsFromList(recs, courseName, nowMs, warnDays) {
    const items = [];
    for (const r of (recs || [])) {
        if (r.status !== 0) continue; // 仅未完成（0=todo；1=待批改无需动作；2=已完成）
        const end = parseDeadline(r.endDate);
        const level = deadlineLevel(end, nowMs, warnDays);
        if (!level) continue;
        items.push({
            course: String(courseName || ''),
            title: String(r.title || r.chapterTitle || '未命名作业'),
            end: end, level: level,
            paperId: String(r.homeworkPaperId || ''),
        });
    }
    return items;
}

// 同源接口 POST（harvest._hvApiGet 同款契约：HTTP status + 业务 code 双检，Authorization 必带）
function deadlineApi(url, body, cb) {
    let token = '';
    try { token = localStorage.getItem('loginToken') || ''; } catch (e) {}
    try {
        GM_xmlhttpRequest({
            method: 'POST', timeout: 15000, url: url,
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': token } : {}) },
            data: JSON.stringify(body || {}),
            onload: res => {
                if (res.status !== 200) { cb(null); return; }
                try {
                    const j = typeof res.response === 'object' ? res.response : JSON.parse(res.responseText);
                    cb(j.code != null && !/^(0|1|200)$/.test(String(j.code)) ? null : j);
                } catch (e) { cb(null); }
            },
            onerror: () => cb(null),
            ontimeout: () => cb(null),
        });
    } catch (e) { cb(null); }
}

// 拉取全部在学 v2 课程的未完成作业，汇总临近截止条目。
// cb(items|null)：null=课表接口失败（不打扰，保留旧横幅）；单课程失败跳过。
function fetchDeadlineItems(cb) {
    let user = {};
    try { user = JSON.parse(localStorage.getItem('user') || '{}').userInfo || {}; } catch (e) {}
    const payload = {
        courseName: '', pageNo: 1, pageSize: 50, teachMode: ['3'],
        tenantId: String(user.tenantId || ''),
        userAccount: String(user.username || ''),
    };
    deadlineApi(location.origin + '/api/learning-service/student/course/queryLearnCoursePage', payload, j => {
        const courses = (((j || {}).data || {}).records || [])
            .filter(r => r.courseStatus === 1 && r.versions === 'v2' && r.classId) // 仅在学（已结课无需赶截止）
            .map(r => ({ name: String(r.courseName || r.className || r.courseId), classId: String(r.classId) }));
        if (!j || !courses.length) { cb(j ? [] : null); return; }
        let i = 0, hardFail = 0;
        const items = [];
        const next = () => {
            if (i >= courses.length) { cb(hardFail >= courses.length ? null : items); return; }
            const c = courses[i++];
            deadlineApi(location.origin + '/api/learning-service/admin/studentHomeWork/getHomeworkList',
                { status: 0, teachingClassId: c.classId, pageNo: 1, pageSize: 50 }, j2 => {
                    if (!j2) hardFail++;
                    items.push(...deadlineItemsFromList((j2 && j2.data && j2.data.records) || [], c.name, Date.now(), CFG.DEADLINE_WARN_DAYS));
                    setTimeout(next, 300); // 串行 + 300ms 间隔，限流友好（harvest 同款）
                });
        };
        next();
    });
}

let _dlLastLogged = '';
function renderDeadlineBanner(summary) {
    const el = document.getElementById('xa-deadline');
    if (!el) return;
    if (!summary) {
        try { summary = JSON.parse(GM_getValue(SK.deadlineSummary, '') || 'null'); } catch (e) {}
    }
    const items = ((summary || {}).items || []).filter(i => i.end > Date.now()); // 过滤已过期
    if (!items.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    items.sort((a, b) => a.end - b.end);
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const when = ts => {
        const d = new Date(ts);
        const pad = n => (n < 10 ? '0' : '') + n;
        return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    };
    const urgent = items.some(i => i.level === 2);
    el.innerHTML = items.map(i =>
        '<div>' + (i.level === 2 ? '🔴' : '🟠') + ' [' + esc(i.course) + '] ' + esc(i.title)
        + ' — 截止 ' + when(i.end) + (i.level === 2 ? '（不足 24 小时！）' : '') + '</div>').join('');
    el.style.display = '';
    el.className = 'xa-deadline' + (urgent ? ' urgent' : '');
}

// 检查入口。force=true 跳过节流（面板按钮）；平时由定时器驱动（GM 时间戳 30 分钟节流，跨刷新生效）。
function deadlineCheck(force) {
    const now = Date.now();
    if (!force && now - Number(GM_getValue(SK.deadlineLastAt, 0)) < CFG.DEADLINE_CHECK_MS) return;
    GM_setValue(SK.deadlineLastAt, String(now));
    fetchDeadlineItems(items => {
        if (items === null) return; // 课表接口失败：静默保留旧横幅
        const summary = { at: now, items: items };
        try { GM_setValue(SK.deadlineSummary, JSON.stringify(summary)); } catch (e) {}
        renderDeadlineBanner(summary);
        const key = items.map(i => i.paperId + '@' + i.end).sort().join('|');
        if (items.length && key !== _dlLastLogged) { // 同一批不重复刷日志
            _dlLastLogged = key;
            const urgent = items.filter(i => i.level === 2).length;
            XIA_AI.log('⏰ ' + items.length + ' 份作业临近截止' + (urgent ? '（其中 ' + urgent + ' 份不足 24 小时！）' : '')
                + '，详见面板提醒', urgent ? 'error' : 'info');
        }
    });
}

function initDeadlineWatch() {
    renderDeadlineBanner(); // 先用上次结果展示（免请求）
    setInterval(() => { try { deadlineCheck(false); } catch (e) { console.log('[XIA-deadline] 异常', e); } }, CFG.DEADLINE_CHECK_MS);
    deadlineCheck(false); // 启动即查（内部节流，30 分钟内不重复打接口）
}
