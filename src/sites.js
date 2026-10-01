// ==================== 站点适配层 ====================
// 芯位/beeline-ai 单平台（超星学习通已拆分至独立项目 chaoxing-autostudy）。
// beeline 为 Vue 3 + Element Plus SPA，题目/作业/视频均在主文档，无需 iframe 注入。

// 题目解析适配器：qa.js 按 QA.xxx 调用；function 声明在同一 IIFE 作用域内提升，
// 此处可直接引用 qa.js 中的全局解析函数（XIA_QROOT 亦定义于 qa.js）。
const QA = {
    questionRoot, questionType, isAnswered, letterOf, allSelected,
    questionScore, extractOptions, questionTitle,
};
