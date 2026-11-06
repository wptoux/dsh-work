# Security Policy

## Reporting a vulnerability

Please use this repository's private vulnerability-reporting form under the GitHub **Security** tab when it is available. If it is unavailable, open a minimal issue asking the maintainer for a private contact channel; do not include exploit details in that issue.

请优先通过 GitHub **Security** 页面中的私密漏洞报告功能联系维护者。如果该入口不可用，请只创建一个不含利用细节的简短 issue，请求私下沟通渠道。

Never include DeepSeek API keys, credentials files, session contents, raw logs, or unredacted balance data in a report. Revoke any credential that may already have been exposed.

报告中不要附带 DeepSeek API key、凭据文件、会话内容、原始日志或未脱敏余额。已经暴露的凭据应立即吊销。

## Scope

Security fixes target the latest version on the default branch. The five HTTP endpoints are read-only and never expose credentials, but they still require one of three identities: a loopback peer with a loopback Host; a harness-authenticated web session that passes the same `Connection.requestRejection` gate every `/api` route runs (trusted Host plus signed browser-session cookie); or a live paired-device cookie issued by `dsh-remote-web-ui`. Unauthenticated remote callers get 403. Exposing the endpoints through any other kind of reverse proxy is outside the supported security model unless the proxy adds authentication and access control.

五个端点只对三类调用放行：回环 peer + 回环 Host 的本机请求；通过与 `/api` 相同的 harness 会话认证（信任的 Host + 签名的浏览器会话 cookie）的请求；携带 `dsh-remote-web-ui` 签发的有效配对设备 cookie 的请求。其余远程请求一律 403。请不要把端点交给没有认证与访问控制的反向代理。

Declarative account monitors are trusted local configuration, but they still default to HTTPS, same-origin relative paths, manual redirects, JSON-only responses, and a 1 MiB response limit. Before sending credentials, the plugin filters IPv4/IPv6 DNS answers and pins one validated address for the connection. Public addresses are preferred. For HTTPS hostnames only, an IPv4 address in `198.18.0.0/15` may be accepted as a proxy-synthetic fake-IP mapping for Clash/Mihomo-style TUN DNS. Literal targets in that range remain blocked by default, and other private or special-use addresses still require explicit `allowPrivateNetwork` opt-in. Enabling cross-origin, insecure HTTP, or private-network access expands the trust boundary and should be done only for an endpoint you control.
