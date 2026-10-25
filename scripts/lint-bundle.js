#!/usr/bin/env node
'use strict';
/*
 * 生成 lint 专用未压缩 bundle 到 tmp/lint-bundle.user.js（gitignored，跑完即弃）。
 *
 * 为什么不直接 lint src/*.js：src 模块共享同一 IIFE 作用域，跨文件符号（conf/QA/qsa/XIA_AI…）
 * 在单文件视角全是未定义引用——no-undef 会海量误报，恰恰漏掉真正要抓的裸调用错名
 * （v3.15.1 的 searchBing ReferenceError 正是这类）。必须按 build.js 的 BODY_ORDER
 * 拼接成完整 IIFE 后 lint，跨模块引用才可解析，拼错的名字才会暴露。
 */
const fs = require('fs');
const path = require('path');
const { makeBundle } = require('../build.js');

const out = path.join(__dirname, '..', 'tmp', 'lint-bundle.user.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, makeBundle(false).code, 'utf8');
console.log('ℹ️ lint bundle -> ' + out);
