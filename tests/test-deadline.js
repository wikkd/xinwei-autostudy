// 截止提醒纯函数回归测试：parseDeadline（日期解析）/ deadlineLevel（紧急分级）/ deadlineItemsFromList（条目收集）
// 运行：node tests/test-deadline.js（harness 直加载 src，无 DOM 依赖）
const { loadSlice } = require('./harness');

const { parseDeadline, deadlineLevel, deadlineItemsFromList } = loadSlice(
    ['config.js', 'deadline.js'],
    ['parseDeadline', 'deadlineLevel', 'deadlineItemsFromList']);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};

// ===== parseDeadline =====
eq('日期+时间', parseDeadline('2026-10-18 23:59'), new Date(2026, 9, 18, 23, 59, 59).getTime());
eq('仅日期按 23:59:59 计', parseDeadline('2026-10-18'), new Date(2026, 9, 18, 23, 59, 59).getTime());
eq('ISO T 分隔', parseDeadline('2026-10-18T09:30'), new Date(2026, 9, 18, 9, 30, 59).getTime());
eq('含中文杂讯仍可解析', parseDeadline('截止时间：2026-10-18 23:59 前'), new Date(2026, 9, 18, 23, 59, 59).getTime());
eq('空串', parseDeadline(''), 0);
eq('无日期文本', parseDeadline('尽快完成'), 0);
eq('null 安全', parseDeadline(null), 0);

// ===== deadlineLevel（warnDays=3）=====
const NOW = new Date(2026, 9, 11, 12, 0, 0).getTime(); // 2026-10-11 12:00 固定基准
eq('不足 24h → 紧急', deadlineLevel(NOW + 2 * 3600000, NOW, 3), 2);
eq('恰好 24h → 紧急', deadlineLevel(NOW + 86400000, NOW, 3), 2);
eq('48h → 临近', deadlineLevel(NOW + 2 * 86400000, NOW, 3), 1);
eq('3 天边界 → 临近', deadlineLevel(NOW + 3 * 86400000, NOW, 3), 1);
eq('超过 3 天 → 不提醒', deadlineLevel(NOW + 5 * 86400000, NOW, 3), 0);
eq('已过期 → 不提醒', deadlineLevel(NOW - 3600000, NOW, 3), 0);
eq('无日期(0) → 不提醒', deadlineLevel(0, NOW, 3), 0);

// ===== deadlineItemsFromList（过滤 + 分级 + 字段透传）=====
const recs = [
    { title: '第二章作业', endDate: '2026-10-12 08:00', status: 0, homeworkPaperId: 'p1' },  // 20h → 紧急
    { title: '第三章作业', endDate: '2026-10-13 12:00', status: 0, homeworkPaperId: 'p2' },  // 48h → 临近
    { title: '第四章作业', endDate: '2026-10-20 23:59', status: 0, homeworkPaperId: 'p3' },  // 9d → 排除
    { title: '已完成的', endDate: '2026-10-12 08:00', status: 2, homeworkPaperId: 'p4' },    // 已完成 → 排除
    { title: '待批改的', endDate: '2026-10-12 08:00', status: 1, homeworkPaperId: 'p5' },    // 待批改 → 排除
    { title: '无截止日期', status: 0, homeworkPaperId: 'p6' },                                // 无日期 → 排除
];
const items = deadlineItemsFromList(recs, '数据可视化', NOW, 3);
eq('仅收集临近且未完成的条目', items.length, 2);
eq('紧急条目级别', items[0].level, 2);
eq('条目透传课程名', items[0].course, '数据可视化');
eq('条目透传标题', items[0].title, '第二章作业');
eq('条目透传 paperId', items[0].paperId, 'p1');
eq('临近条目级别', items[1].level, 1);
eq('空列表安全', deadlineItemsFromList(null, 'x', NOW, 3).length, 0);

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' deadline tests passed'));
process.exit(fail ? 1 : 0);
