// ==UserScript==
// @name                YouTube +
// @name:en             YouTube +
// @name:de             YouTube +
// @name:ja             YouTube +
// @name:tr             YouTube +
// @name:zh-CN          YouTube +
// @name:zh-TW          YouTube +
// @name:fr             YouTube +
// @name:ko             YouTube +
// @namespace           by
// @version             2.3.3
// @author              diorhc
// @description         Вкладки для информации, комментариев, видео, плейлиста и скачивание видео и другие функции ↴
// @description:en      Tabview YouTube and Download and others features ↴
// @description:de      Tabview YouTube und Download und andere Funktionen ↴
// @description:fr      Tabview YouTube et Télécharger et autres fonctionnalités ↴
// @description:zh-CN   标签视图 YouTube、下载及其他功能 ↴
// @description:zh-TW   標籤檢視 YouTube 及下載及其他功能 ↴
// @description:ko      Tabview YouTube 및 다운로드 및 기타 기능 ↴
// @description:ja      タブビューYouTubeとダウンロードおよびその他の機能 ↴
// @description:tr      Sekmeli Görünüm YouTube ve İndir ve diğer özellikler ↴
// @match               https://*.youtube.com/*
// @match               https://music.youtube.com/*
// @match               *://myactivity.google.com/*
// @include             *://www.youtube.com/feed/history/*
// @include             https://www.youtube.com
// @include             *://*.youtube.com/**
// @exclude             *://accounts.youtube.com/*
// @exclude             *://www.youtube.com/live_chat_replay*
// @exclude             *://www.youtube.com/persist_identity*
// @exclude             /^https?://\w+\.youtube\.com\/live_chat.*$/
// @exclude             /^https?://\S+\.(txt|png|jpg|jpeg|gif|xml|svg|manifest|log|ini)[^\/]*$/
// @icon                https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @license             MIT
// @require             https://cdn.jsdelivr.net/npm/@preact/signals-core@1.12.1/dist/signals-core.min.js
// @require             https://cdn.jsdelivr.net/npm/browser-id3-writer@4.4.0/dist/browser-id3-writer.min.js
// @require             https://cdn.jsdelivr.net/npm/preact@10.27.2/dist/preact.min.js
// @require             https://cdn.jsdelivr.net/npm/preact@10.27.2/hooks/dist/hooks.umd.js
// @require             https://cdn.jsdelivr.net/npm/@preact/signals@2.5.0/dist/signals.min.js
// @require             https://cdn.jsdelivr.net/npm/dayjs@1.11.19/dayjs.min.js
// @grant               GM_addStyle
// @grant               GM_getValue
// @grant               GM_setValue
// @grant               GM_xmlhttpRequest
// @grant               unsafeWindow
// @connect             api.livecounts.io
// @connect             cnv.cx
// @connect             mp3yt.is
// @connect             web.archive.org
// @connect             *
// @connect             ytplaylist.robert.wesner.io
// @connect             youtube.com
// @connect             googlevideo.com
// @connect             self
// @run-at              document-start
// @noframes
// @homepageURL         https://github.com/diorhc/YTP
// @supportURL          https://github.com/diorhc/YTP/issues
// @downloadURL         https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js
// @updateURL           https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js
// ==/UserScript==
