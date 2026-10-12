# Security and privacy

YouTube+ runs as a userscript on youtube.com and music.youtube.com. Some
features contact external services; every contacted host is listed below with
the data it receives and the setting that controls it.

## Reporting a vulnerability

Report privately through a
[GitHub security advisory](https://github.com/diorhc/YTP/security/advisories/new),
or contact the maintainer before publishing details or an exploitable
demonstration against the deployed backend. Never put service-role credentials
in source, logs or screenshots.

## Runtime boundaries

- Dynamic HTML is built with YouTubeSafeDOM or DOM node APIs. In the
  userscript realm safe-dom owns the only Trusted Types policy,
  `youtubeplus#sanitize`, which sanitizes at the sink. The Tabview core runs
  in the page realm, where safe-dom is absent; it creates one private policy,
  `ytplus-tabview`, used only for its own static tab markup. Neither policy
  is a default policy or published on `window`.
- Community data (feature suggestions, votes, attached images) lives in the
  deployed Supabase project. The client embeds no Supabase key: requests go
  through the author's proxy vote.diorhc.space, which attaches the public anon
  key itself. Authorization and quotas belong on the deployed server.
- The owner secret lives in the userscript manager's GM storage. A legacy
  plaintext copy in origin localStorage is migrated (read, rewrite into GM
  storage, verify, delete). Owner writes send the secret only as an RPC
  argument through GM_xmlhttpRequest; writes and own-vote reads are refused
  without that isolated transport.
- The `@require`d runtime dependency browser-id3-writer is pinned by version
  and SHA-256 in the userscript header.
- Locale dictionaries come from GitHub raw or jsDelivr and are verified
  against pinned SHA-256 digests when WebCrypto is available. Unverified
  payloads serve the current session only and fall back to the English
  dictionary embedded at build time.

## Network use

Requests expose ordinary network metadata, including the request IP. Feature
switches do not disable the userscript manager's own updates or `@require`
downloads. Community requests go through vote.diorhc.space: the proxy does not
store request IPs or User-Agents, and Supabase only sees the proxy's address.

| Host | Sent | Returned | Off switch | On failure |
| --- | --- | --- | --- | --- |
| api.livecounts.io | GET; channel id in the path (`.../youtube-live-subscriber-counter/stats/<id>`) | JSON subscriber, view and video counters | `enableChannelStats` (overlay) or `enableStatsButton` (panel) | the overlay falls back to the on-page subscriber count; the panel renders an error card; nothing throws |
| livecounts.io | Origin/Referer value attached to the api.livecounts.io request | not contacted directly | same as api.livecounts.io | same as api.livecounts.io |
| returnyoutubedislikeapi.com | GET `?videoId=<id>` | JSON `{likes, dislikes, rating}` | the dislike/statistics display | the result is treated as unknown (fields stay null), never shown as zero |
| cdn.jsdelivr.net | GET the pinned-release locale JSON; the `@require` browser-id3-writer download is fetched by the userscript manager | locale dictionary JSON | none — core i18n, fetched only when a dictionary is needed | falls back to raw.githubusercontent.com, then to the English dictionary embedded at build time |
| fonts.googleapis.com | GET of the static Rubik CSS URL through a `<link>` element (browser subresource, not GM/fetch) | font CSS, then the font files | `enableChannelStats` | the overlay uses the system font |
| translate.googleapis.com | GET `?tl=<language>&q=<comment text>` — the comment text is the payload | nested translation array | `enableCommentTranslate` | the button returns to its idle state and the comment text is unchanged; nothing throws |
| cnv.cx | POST the video URL plus the requested format; GET a sanity key | a conversion key, then a download URL | `enableDownload` | the next converter is tried, then Cobalt, then an error notification |
| mp3yt.is | Origin/Referer value impersonated for cnv.cx (no request is made to this host) | not contacted directly | `enableDownload` | — |
| cobalt.directory | GET the working-instance list, only while `allowCobaltDiscovery` is on | JSON list of API hosts | `allowCobaltDiscovery` (off by default) | only the statically verified instances are used |
| rue-cobalt.xenon.zone, cobaltapi.cjs.nz, api.cobalt.liubquanti.click | POST the video URL plus the requested format | a tunnel URL or an error text | `enableDownload` (Cobalt fallback) | the next instance is tried; when all fail a download error is reported |
| vote.diorhc.space | community reads and writes: proposal/comment text, votes, owner proof, optional images | records and media paths | the community panel | the offline state is kept; the write is refused or queued and the UI stays usable |
| raw.githubusercontent.com | GET the pinned-release locale JSON | locale dictionary JSON | none — core i18n | falls back to cdn.jsdelivr.net, then to the embedded English dictionary |
| update.greasyfork.org, greasyfork.org | GET the userscript metadata and the changelog page | userscript metadata text, changelog HTML | the automatic update check | the check stays silent and is retried with a bounded backoff |
| i.ytimg.com | HEAD/GET thumbnail images (the video id is in the path) | a JPEG/WebP image | `enableThumbnail` | the alternate thumbnail URL is tried, or the preview closes |
| yt3.ggpht.com | only used as a DOM selector for avatars YouTube has already loaded | — | `enableThumbnail` | — |
| ssyoutube.com (configurable) | the video URL is opened in a new tab | the third-party downloader page | the chosen download site | the tab simply does not open the file |
| youtube.com, www.youtube.com, ytimg.com | the player, subtitle and media requests the download/stats features already make | player JSON, subtitles, media streams | the owning feature | the owning feature reports the failure |

The Rubik stylesheet is a browser `<link>` subresource from the YouTube page,
which `@connect` does not govern; no `GM_xmlhttpRequest`/`fetch` call targets
it. `mp3yt.is` and `livecounts.io` are Origin/Referer values, not request
targets. Speed, loop, zoom, themes, screenshots and PiP work entirely against
the open page; preferences and resume data are stored locally.

## Verification

`npm run verify` checks sources, dangerous HTML and accidental secrets, locale
metadata, tests, coverage floors and artifact integrity. `npm run security`
checks npm advisories. These checks cannot establish deployed Supabase
authorization or userscript-manager isolation.