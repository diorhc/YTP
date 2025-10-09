// ==UserScript==
// @name            YouTube +
// @name:en         YouTube +
// @namespace       by
// @version         2.0
// @author          diorhc
// @description     Вкладки для информации, комментариев, видео, плейлиста и скачивание видео и другие функции ↴
// @description:en  Tabview YouTube and Download and others features ↴
// @match           https://*.youtube.com/*
// @match           https://music.youtube.com/*
// @match           *://myactivity.google.com/*
// @include         *://www.youtube.com/feed/history/*
// @include         https://www.youtube.com
// @include         *://*.youtube.com/**
// @exclude         *://accounts.youtube.com/*
// @exclude         *://www.youtube.com/live_chat_replay*
// @exclude         *://www.youtube.com/persist_identity*
// @exclude         /^https?://\w+\.youtube\.com\/live_chat.*$/
// @exclude         /^https?://\S+\.(txt|png|jpg|jpeg|gif|xml|svg|manifest|log|ini)[^\/]*$/
// @icon            https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @license         MIT
// @grant           GM_xmlhttpRequest
// @grant           unsafeWindow
// @connect         api.livecounts.io
// @connect         livecounts.io
// @run-at          document-start
// @homepageURL     https://github.com/diorhc/YoutubePlus
// @supportURL      https://github.com/diorhc/YoutubePlus/issues
// @downloadURL     https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js
// @updateURL       https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js
// ==/UserScript==