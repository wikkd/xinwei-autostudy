# 芯位前端地图（真机调研 2026-10-09）

> 本文件由浏览器真机实测 + 前端 chunk 逆向沉淀，供后续开发查询。所有类名/路由/接口均经过实测验证。

## 1. 站点架构：两套前端

| 区域 | 技术栈 | 入口 | 说明 |
|---|---|---|---|
| 学习中心（本脚本主战场） | Vue 3 + Element Plus + vue-router **hash 模式** | `https://www.beeline-ai.com/student/#/...` | 课程/视频/作业/考试，SPA |
| 门户 + AI/学历银行 | **Nuxt 3** | `https://www.beeline-ai.com/`、`/stu/agent`、`/myBank/courseResearch` | 首页/智能体/课程广场，独立应用 |

两套应用通过 URL 跳转衔接（`window.open('/student/'+href)`），学习中心的所有路由都在 `/student/#/` 之后。

## 2. 学习中心路由表（hash 模式）

```
/student/#/<courseType>/<courseId>/...      courseType ∈ courseInfo | shortCoursePreview | shortCourse

courseWare/:courseId/video/:itemId     视频学习页（courseLearnCourseWare → video）
courseWare/:courseId                   课件页（默认重定向到最近一次 item）
:courseId/homework                     作业/考试列表页（defaultKey=0作业/1考试；tabKey=0未完成/1待批改/2已完成）
:courseId/homeworkDetailPage           作业复盘页（query: homeworkPaperId, classId, homeworkStatus）
:courseId/homework                     试卷作答页（courseWareHomework，query: homeworkPaperId）
:courseId/examDetail                   考试复盘页
:courseId/project/:classId             项目页（独立页面）
:courseId/note/all|own                 笔记
:courseId/courseMaterials              课程资料
:courseId/bbs、:courseId/statistics    互动/统计
:courseId/home、:courseId/skillMap     课程首页/技能图
```

**关键实测**：同壳改 hash 不会重挂载组件（页面仍显示旧数据）→ 换课必须 `location.hash=新路由` 后 **reload 强制冷启动**（v3.4.2 已实现）。

## 3. 页面结构与选择器

### 3.1 作业/考试列表页

```html
.homework-list-container / .homework-list
  ├─ .tab "我的作业" / "我的考试"     ← defaultKey=1 切考试（也可点 tab）
  ├─ .status-tab .tab "未完成/待批改/已完成"  ← tabKey=2 已完成；点击 → router.replace(query)
  ├─ 作业卡片：标题「考核点第X章作业」+ 关联章节 + 开放时间 + 题目数量 + 重做次数 + 分数 + 按钮
  │    ├─ todo 状态 → <button class="button">做作业</button>
  │    ├─ unmarked → "查看作业"（待批改）
  │    └─ completed → <div class="score-text">100分</div> + <button class="button">查看作业</button>
  └─ .el-pagination（翻页）
```
- 已完成卡片的结构可直接读「分数」和「查看作业」按钮
- 进度显示：`.examine-progress` + `.progress-text`（如 17/55）

### 3.2 作业复盘页（采集主战场）

```html
.homework-detail-container
  ├─ .homework-baseInfo-content / .homework-head
  │    ├─ .head-left .title-class     作业名称（如「第二章作业」）
  │    └─ .head-right .total-score    总分
  ├─ .homework-describe（描述表：课程名称/关联章节/开放时间/重做次数/题目数量/总分/合格分）
  ├─ .homework-body > .content-area-container > .content-area
  │    └─ 每题: .question-content-body
  │         ├─ .question-area
  │         │    └─ 题目组件（mode="detail"）：.homework-single-selected / -multiple-selected /
  │         │       -true-or-false / -cloze / -question-editor
  │         │         ├─ .question-tag-score（题型+分值，如「单选10 分」）
  │         │         ├─ .topic-title（题干）
  │         │         └─ .index-name（选项字母；判断题无此项！渲染为 T.对/F.错）
  │         └─ .result-score-content    「本题得分：10 分」（仅已批改 status=3）
  │         └─ .solve-question-box / .answer-analysis / .answer-remark（答案解析，如有）
  ├─ .sequence-pagination / .sequence-item.item-done   答题卡（数字跳题）
  └─ .operate-area > 「再做一次」按钮（el-button，重做次数用尽时 disabled）
```

**采集规则**（v3.4.2 实现）：`本题得分 == 题目分值` 且选中项存在 → 收进答案本。
- 选中态：`.el-radio.is-checked` / `.el-checkbox.is-checked`（disabled 状态也保留 is-checked）
- 字母提取：优先 `.index-name`，**判断题按位置兜底**（A=第一个选项=T.对，B=第二=F.错）
- 主观题（`.homework-question-editor`）不采

### 3.3 视频学习页

```html
.course-courseWare__body
  ├─ .course-courseWare__main
  │    ├─ .courseWare__title > .title__text        当前节标题（如「4.1新文化运动和五四运动」）
  │    └─ .course-courseWare__content
  │         └─ .video-container.default-container
  │              └─ .video-container-box > .video-player.abp
  │                   └─ #videoDomId.video-js       ← video.js 播放器
  │                        └─ video#videoDomId_html5_api.vjs-tech   ← 实际 <video>
  └─ .course-courseWare__sidebar.course-sidebar
       ├─ .course-sidebar-switch                    折叠开关
       └─ .course-sidebar-wrapper > .course-sidebar-content
            ├─ .sidebar-item (×5)：「目录/笔记/课程资料/课程互动/课程应用」+ .active-item 当前态
            └─ .course-courseWare__chapter-body
                 └─ .couresSideBox                  面板容器（课程应用=敬请期待）
```

**播放器**（video.js 8）：
- 视频源是 **blob URL**（MSE 流），不能直接播 mp4——但 `video` 元素可用标准 API 操作（playbackRate 实测可设）
- 控件：`.vjs-play-control`（暂停/播放）、`.vjs-volume-panel`（静音）、`.vjs-progress-control`（进度，考核视频**被禁用拖动**）、`.vjs-playback-rate`（倍速，实测面板存在）、`.vjs-chapters-button`（节目段落）、`.vjs-skip-forward/backward`
- 观看规则：**考核点需观看 95% 才计入完成**；页面上有「已观看 X%」提示（`.section-introduce` 内文本）

**目录章节**（`.course-courseWare__chapter-body`，2026-10-09 深挖全屏浮层后完整版）：

```html
.course-courseWare__chapter          ← 浮层容器（position:relative, width:392px，截图里的全屏目录面板）
  └─ .course-courseWare__chapter-main
       ├─ .courseWare-tab-header
       │    ├─ .courseWare-tab > .tab.active-tab「课程章节」
       │    └─ .courseWare-tab-header-right > .point-box > .el-progress（进度条）+「23/59」
       └─ .course-courseWare__chapter-body
            └─ li.el-sub-menu                    ← 章（可展开）
                 ├─ .el-sub-menu__title
                 │    ├─ .chapter-title（章名，当前章高亮 #005EFF）
                 │    ├─ .expiration-date（开放时间窗「2026-10-04 至 2026-10-18」）
                 │    └─ .el-sub-menu__icon-arrow
                 └─ ul.el-menu--inline
                      ├─ li.el-menu-item-group   ← 节（直达视频的节）
                      │    └─ .el-menu-item-group__title > .section-area
                      │         ├─ .section-content > .section-icon-type > .video-icon（视频）/ .doc-icon（文档）
                      │         ├─ .section-title（节名）
                      │         └─ .section-status.status-icon > .done-icon/.inProgress-icon/.unStart-icon
                      └─ li.el-menu-item-group   ← 含子节的节组（三级嵌套，如 3.2）
                           ├─ 自身 section-area（节名 3.2 直角坐标系下网格与坐标轴）
                           └─ li.el-menu-item   ← 子节（3.2.1 / 3.2.2，可直接点播）
```

**三种章的形态**（实测）：
| class | 含义 | 可否点击 |
|---|---|---|
| `.el-sub-menu` | 开放中 | ✅ 展开/点入 |
| `.el-sub-menu.is-opened` | 展开中的章 | ✅ |
| `.el-sub-menu.disable-menu` | **锁定章**（时间窗口外） | ❌ 点击无效（`.chapter-title.lock-title` + 锁图标） |

**章节开放时间窗机制（重要）**：每个章有 `.expiration-date` 开放区间（如「2026-09-20 至 2026-10-04」）。两种锁定：
- **已过期**：窗口终点 < 当前日期（如第一章 10-04 截止、今天 10-09 → locked）
- **未开放**：窗口起点 > 当前日期（如第四章 10-11 开始 → locked）

**锁定行为实测（2026-10-09）**：`.disable-menu` 章**可以正常展开**（DOM 上无 pointer-events/opacity 限制，点击标题即可展开），
内部节也**可以渲染**（能看到节名/时长/状态图标），但**节点击不跳转**（Vue 逻辑层拦截，URL 无变化，且**无任何 toast 提示**——
静默拦截）。实测数据可视化课 11 章中 6 章锁定（第一章已过期 + 第四~八章未开放）。

**对刷课脚本的硬约束**：锁定章的节点不动，扫描/跳章必须**排除 `.el-sub-menu.disable-menu` 内的节**。
**✅ v3.5.0 已实现**：`menuItemIncomplete`（src/utils.js）增加 `li.closest('.el-sub-menu.disable-menu')` 祖先判定，
`findNextMenuItem` 过滤与 `navigateToNextSection` 回溯扫描均走它，锁定节不再进入补完扫描目标。
排除判定：`li.closest('.el-sub-menu.disable-menu')` 存在即跳过。
（chunk 源码印证：`je(startDate,endDate)` 判时间窗，窗口外加 `disable-menu` class）

- 当前节容器：`.el-menu-item-group.group-menu-active`
- 进度显示：页头「23/59」+ 圆形/条形进度条（`.point-box .el-progress`，aria-valuenow 为百分比）

**旧版描述（保留）**：
- `.el-sub-menu`（章）→ 内部 `.el-menu-item-group`（节，含时长）
- 节状态图标：`.done-icon`（完成）/ `.inProgress-icon`（进行中）/ `.unStart-icon`（未开始）

### 3.4 项目页 / 课程首页

**项目页**（`:courseId/project/:classId`）：
```html
.project
  ├─ .project-tabs（全部/未开始/进行中/已结束）
  ├─ .project-list（项目卡片列表）
  └─ .project-empty（暂无数据）
```

**课程首页**（`:courseId/home`）：
```html
.course-home
  ├─ 概览卡（已完成视频数量 / 上次学习节点 / 视频学习进度 / 查看进度）
  ├─ 授课教师 / 关键词 / 课程大纲（该门课程共有 X 章 Y 讲）/ 简介
  └─ 学习日历（月历 + 日期）
```
注：该页「视频学习进度 -/-」与课程实际进度不一致（页面数据源与学习页不同步，实测课程已看 17/55 但首页显示 -/-），开发时别依赖此页取进度。

### 3.5 其他课程页面（2026-10-09 补充实测）

**课程资料页**（`:courseId/courseMaterials`）：
```html
.course-materials-page
  ├─ .materials-area
  │    ├─ .material-search > .material-input（搜索框）
  │    └─ .material-table（el-table：文件名/大小/浏览记录）
  └─ 空态「本课程尚未添加课程资料」
```

**笔记页**（`:courseId/note/all`）：
```html
.editor-wrapper.textarea > .editor-input > .my-editor（富文本编辑器，同答题页 wangEditor 风格）
```
本路由竟渲染编辑器（可能直接进编辑态）；页面几乎空白属正常。

**统计页**（`:courseId/statistics/online`）：
```html
.el-tabs.statistics-tabs（线上学习统计 / 线下学习统计）> .online-statistics
```

**技能图谱**（`:courseId/skillMap`）：仅页头「技能图谱」标题，内容为空（无数据）。

**课程论坛**（`:courseId/bbs`）：页头「课程论坛」+ 内容区（本课程空）。

**项目页**（`:courseId/project/:classId`）：
```html
.project
  ├─ .project-tabs（全部/未开始/进行中/已结束）
  ├─ .project-list（项目卡片）
  └─ .project-empty（「暂无数据」）
```

### 3.6 Nuxt 门户（学历银行/课程广场）

入口 `/myBank/courseResearch`、`/stu/agent`，Nuxt 3（`window.__NUXT__` 可读，`serverRendered: true`）。
- 配置（`__NUXT__.config.public`）：`apiBase: "/api"`、`client_id: "xinwei"`、`PLATFORM: "XINWEI_HOME"`
- 课程卡：`.card-item`（**无 data-id 属性**，课程 ID 只在 Vue 内存里，DOM 拿不到）
- 「我的课表」8 门课卡：课程名 + 班级 + 考核点完成 X/Y（文本形式）
- 「开始学习」按钮点击 → `window.open` 新标签页（v2 课程）/ 写 sessionStorage 后跳转（v1 老课）——**脚本无法通过点击驱动**，课程切换必须走 API + URL 直达（v3.4.2 实现方式）

### 3.7 页面头部（全站共用）

```html
.el-header
  ├─ .header-lf（logo）
  ├─ .header-mid
  │    ├─ .course-name（课程名）+ .examine-progress（进度）
  │    └─ 导航：学习 / 作业考试 / 项目 / 更多
  ├─ .header-rf
  │    ├─ .more-menu-btn（更多下拉：账号设置/学历银行/创作中心/我的订单/帮助中心/退出登录）
  │    └─ .user-avatar-container（头像 → 个人信息弹层）
  └─ .layout-header-text.language（CN/EN 切换）
```

**注意**：导航项是 `router.push` 跳转的 SPA 链接，跳「作业考试」→ `:courseId/homework`，跳「学习」→ `courseWare/:courseId/video/:itemId`。

## 4. 平台接口（/api/learning-service 主前缀）

axios 实例：baseURL `/`（同源）+ `withCredentials`；请求拦截器注入 **`Authorization: <localStorage.loginToken>`** + 接收语言头；响应拦截器处理 `code`（**成功=200**，非 0/1！）、401 跳登录。

| 接口 | 方法 | 用途 |
|---|---|---|
| `/student/course/queryLearnCoursePage` | POST | 课表列表（courseId/classId/courseName/courseStatus/versions/completeExamineNum） |
| `/admin/studentHomeWork/getHomeworkList` | POST | 作业列表（含 status/completed/todo/unmarked） |
| `/admin/studentLearning/getHomeworkPaperDetail/{paperId}/{classId}` | POST | 试卷详情（作答） |
| `/admin/studentLearning/getDoneHomeworkPaperDetail/{paperId}/{classId}` | POST | 已交答卷详情（复盘） |
| `/admin/studentLearning/homework/draft` | POST | 保存草稿 |
| `/admin/studentLearning/homework/submit` | POST | 提交作业 |
| `/admin/studentLearning/homework/gotoRedo/{paperId}` | POST | 重做 |
| `/admin/studentLearning/getChapterData` | POST | 章节目录 |
| `/admin/studentLearning/getSingleChapterData/{itemId}` | POST | 单节数据 |
| `/admin/studentLearning/video/getNextItemInfoByCurrentItemId/{itemId}` | POST | 下一节信息 |
| `/admin/studentLearning/videoLearnProcessReport` | POST | **视频播放心跳**（上报进度） |
| `/admin/studentLearning/documentLearnProcessReport` | POST | 文档学习心跳 |
| `/admin/studentLearning/answerVideoLearnQuestion` | POST | 视频内嵌题作答 |
| `/admin/studentLearning/getExamineData` | POST | 考核点数据 |
| `/xinwei_exam/student/exam/...` | - | 考试相关（getExamList/draft/submit/toScore） |

**课表请求参数**（实测）：
```json
{ "courseName": "", "pageNo": 1, "pageSize": 50, "teachMode": ["3"],
  "tenantId": "<localStorage.user.userInfo.tenantId>", "userAccount": "<userInfo.username>" }
```
返回 `records[]`：courseStatus 1=在学 2=已结课；versions='v2' 为当前版本（33 门课全 v2）。

### 4.1 ⭐ 试卷详情接口直接返回标准答案（重大发现，2026-10-09）

**`getDoneHomeworkPaperDetail/{paperId}/{classId}` 返回每题的 `topicRightAnswerList`（平台标准答案）**，
不只有用户作答。实测 27/27 份已完成作业全部返回（`v2HomeworkAnswerShow=1`），含用户答错的题。

主题字段（`homeworkTopicList[]`，实测）：
| 字段 | 含义 |
|---|---|
| `topicType` | danxuan 单选 / duoxuan 多选 / panduan 判断 / tiankong 填空 / zhuguan 主观 |
| `topicTitle` / `topicContent` | 题干 |
| `topicQuestionCoreDtoList[]` | 选项（`.index` 字母 + `.content` 文本） |
| `topicRightAnswerList` | **平台标准答案**（如 `["C"]` / `["BD"]` / `["T"]`） |
| `topicUserAnswerList` | 用户作答 |
| `topicThisQuestionScore` / `topicScore` | 本题得分 / 满分 |
| `topicRemark` | 答案解析（HTML） |
| `topicOrder` / `topicQuestionBankId` | 题序 / 题库 ID |

顶层：`homeworkTitle`、`thisHomeworkScore`、`homeworkSumScore`、`status`（3=已批改）、
`v2HomeworkAnswerShow`（1=答案可见）、`v2HomeworkAnswerShowScore`（显示门槛分）。

**对脚本的意义**：整条「全库扫描」链路可从 DOM 逐页点击改为 **API 直拉**：
```
课表 API → 每门课 getHomeworkList(status=2) → 每卷 getDoneHomeworkPaperDetail
→ topicRightAnswerList 即答案（item[0] 即字母，直接可回填）
```
比 DOM 方案快数十倍、无渲染依赖、不受页面改版影响（仅接口协议）。DOM 方案（harvestReviewPage）保留作接口失效时的降级路径。

**✅ v3.5.0 已实现（2026-10-10）**：`harvestStart` 默认走 API 直拉（`_hvApiStart/_hvApiNext` 状态机，
串行 + 300ms 间隔，连续 5 败自动降级 DOM 走查；`_hvApiTick` 看门狗防链路挂死）。
接口契约最终版（请求体真机钉死）：
- `getHomeworkList` body `{status:2, teachingClassId, pageNo, pageSize}`（status 2=已完成，常量 chunk 实证 todo=0/unmarked=1/completed=2）
- `getDoneHomeworkPaperDetail/{paperId}/{classId}` **POST 空 body**（参数全在路径，detailPage chunk `I=T` 调用实证）
- 答案可见性：`v2HomeworkAnswerShow=1` 时返回全部标准答案——**48 分未通过卷同样返回**（比 DOM 只采满分卷覆盖更全）
- 题型 `topicType`: danxuan/duoxuan/panduan/tiankong/**wenda**（主观，非 zhuguan）；
  选项 `topicQuestionCoreDtoList[]{index,content,isAnswer}`；多空填空 `topicRightAnswerList:['not,or']` 逗号分隔

**镜像对齐规则（双端 hash 逐字节一致，11/11 题真机验证）**：
1. 题干 = `"N. " + plain(topicTitle)` 再走 questionTitle 同款序号剥离 → 残留一个**前导空格**（DOM 端 `.topic-title-box` 的 `<span>1. </span>` 剥后同形）
2. 填空题：题干取 `topicContent`、去 `_{9,}` 挖空、前缀 `"0."`（无空格，与 DOM input 渲染同形）
3. 选项文本 = `index + '.' + plain(content)`（DOM `.label` 内 index-name+option-content 拼接同形）
4. 判断题：字母按位置 A/B（DOM 无 `.index-name` 同款兜底）；答案 T→A / F→B
5. 多选答案 `['A','B']` join 去重排序；单选取首个字母；主观取 plain 参考答案（≤1500字）

### 4.2 章节目录接口

`getChapterData`（POST `{teachingClassId, courseId}`）返回**数组**（非对象）：
```
[ { id, parentId, type, title, level, isHasChild, status(1未开始/2已完成),
    studyTime(已学秒), totalTime(总秒), assessPoints(0非考核/1考核),
    textType(0视频/1文档/null目录层), relatedHomework, children[] } ]
```
实测本课程 55 节点（11 章 + 44 节，13 节已完成）。进度 = status=2 的节数。

### 4.3 作业列表接口字段（getHomeworkList，实测 status=2 已完成）

```
{ id, homeworkPaperId, title(「第二章作业」), chapterTitle, startDate, endDate,
  topicCount, repeatCount(-1=0次/-2=不限), score("100"), assessPoints,
  isReDo, isCorrect, isPass(1合格), path, status(2已完成) }
```

### 4.4 其他接口实测

- `getExamList`（`/xinwei_exam/student/exam/getExamList`, body `{teachingClassId}`）：33 门课全部无考试数据（本账号课程考核点只用作业），考试链路结构待有数据后再验
- `enterClass`（`/manager/collect/teachingClass/enterClass`）：进入课程时上报（页面自动调）
- `getExamineData`（`/admin/studentLearning/getExamineData`）：考核点进度数据（页头 17/55 来源）
- 页面加载时还会调：`/api/xinwei-auth/user/profile`（用户信息）、`/api/intelligent-center/agentInfo/aikefu`（AI 客服）、`liveStreamSeminar/*`（直播提示）等

## 5. 关键机制备忘

- **同壳换课**：改 hash 不重挂载组件 → 必须 reload
- **视频 blob 源**：MSE 流，下载不了，但 element 可控制
- **95% 观看规则**：考核视频需 ≥95% 才完成；考核点从 44 节里选（`13/44`）
- **防护观察**：`(用户名) 正在观看` 页面实时显示观看者（服务端知情）；进度条不可拖动（考核视频）
- **作业状态机**：todo(未做) → unmarked(待批改) → completed(已完成，含分数)；重做次数 `repeatCount`（-1=0次，-2=不限）
- **`.el-menu-item.is-active`** 侧边栏高亮节（autoplay.js 用）

## 6. 反自动化注意点

- 页面显示「(姓名/学号) 正在观看」——观看行为服务端可见
- 视频心跳 `videoLearnProcessReport` 定期上报（具体间隔未观测）
- 考核视频进度条禁用拖动（防止跳进度的最直接防护）
- 倍速：video.js 面板存在（1x），但白名单拖速历史记忆为 0.5-2x（详见 xinwei-detection-research）

---
*调研方式：登录真机逐页点击 + DOM 采集 + chunk 逆向。生成于 2026-10-09。*
