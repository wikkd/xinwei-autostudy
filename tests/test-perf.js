// 性能优化回归测试：路由短路判定 + 批量落盘语义
// 运行：node tests/test-perf.js（harness 直加载 src）
const fs = require('fs');
const path = require('path');
const { loadSlice, readModules } = require('./harness');

// routeHasQuestions 是 scan 的性能短路闸门：漏放行 = 静默不答题（比漏拦截危险）
const { routeHasQuestions } = loadSlice(['utils.js', 'sites.js'], ['routeHasQuestions']);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
};

// ===== 必须放行（含题目/需巡航的路由）=====
eq('放行 作业列表', routeHasQuestions('#/courseInfo/123/homework?classId=1&tabKey=0'), true);
eq('放行 试卷作答', routeHasQuestions('#/courseInfo/123/homework?classId=1&homeworkPaperId=9'), true);
eq('放行 复盘页', routeHasQuestions('#/courseInfo/123/homeworkDetailPage?paperId=9'), true);
eq('放行 考试复盘', routeHasQuestions('#/courseInfo/123/examDetail?paperId=9'), true);
eq('放行 大写 EXAM', routeHasQuestions('#/courseInfo/123/EXAM'), true);
eq('放行 exam（小写）', routeHasQuestions('#/exam/1'), true);

// ===== 必须短路（无题目路由，刷课主战场）=====
eq('短路 视频页', routeHasQuestions('#/courseInfo/123/courseWare/123/video/456'), false);
eq('短路 课件页', routeHasQuestions('#/courseInfo/123/courseWare/123'), false);
eq('短路 课程首页', routeHasQuestions('#/courseInfo/123/home'), false);
eq('短路 笔记页', routeHasQuestions('#/courseInfo/123/note/all'), false);
eq('短路 空路由', routeHasQuestions(''), false);
eq('短路 undefined', routeHasQuestions(undefined), false);
eq('短路 统计页', routeHasQuestions('#/courseInfo/123/statistics/online'), false);

// ===== 批量落盘语义（测试直接读源码文本，不再依赖 dist 路径）=====
const qaSrc = readModules(['qa.js']);
const utilsSrc = readModules(['utils.js']);
const bootSrc = readModules(['bootstrap.js']);

// 答案本/全库扫描已整体移除（v3.12.0，答题全交给 agent）——防复活残留
eq('答案本三件套已移除', /bankGet|bankSet|bankFlush|xa_answer_bank|BANK_MAX/.test(qaSrc), false);
eq('全库扫描状态机已移除', /harvestTick|harvestResume|harvestStart|collectCourseQueue|_hvApi|xa_harvest_state/.test(qaSrc + bootSrc), false);
eq('缓存命中统计已移除', /cached|缓存命中/.test(qaSrc), false);
eq('pagehide 兜底已随答案本移除', /addEventListener\('pagehide'/.test(bootSrc), false);
eq('keepPlay 属性补丁只装一次', /_poseInstalled/.test(utilsSrc), true);
eq('MutationObserver 静音批次合并', /pending = false; muteAll\(\)/.test(utilsSrc), true);

// ===== 架构拆分断言（防回退到单文件上帝模块）=====
const sitesSrc = readModules(['sites.js']);
eq('sites.js 含题目解析', /function parseQuestionRoot/.test(sitesSrc), true);
eq('bootstrap 版本为注入占位符', /__XA_VERSION__/.test(bootSrc), true);
eq('题库功能已移除（防复活残留）', /XIA_TIKU|xaTikuTrackType|tikuEnabled/.test(qaSrc + sitesSrc), false);
eq('harvest.js 文件已删除', !fs.existsSync(require('path').join(__dirname, '..', 'src', 'harvest.js')), true);

console.log(fail ? ('\n' + fail + ' FAILED / ' + (pass + fail)) : ('✅ ' + pass + '/' + (pass + fail) + ' perf tests passed'));
process.exit(fail ? 1 : 0);
