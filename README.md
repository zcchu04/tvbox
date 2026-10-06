# tvbox

TVBox / 影视仓的配置源镜像仓库：把公开的源配置抓取到本仓库并对外暴露，源站挂掉时仍可用。

对外入口（多仓格式，客户端里选择对应的源）：

```
https://raw.giteeusercontent.com/zcchu/tvbox/raw/master/source.json
```

## 目录结构

```
source.json            多仓索引，urls 里每条对应一个源
hb.json                合并源：liucn + 王小二 + qist + 高天流云 合并成的一份配置
cvkkj/ liucn/ wex/ ... 每个源一个目录：源配置文件 + 它用相对路径引用的文件
common/                各源用绝对地址引用的文件（见下）
```

源配置里**相对路径**（`./jar/x.jar`、`./js/x.js`）引用的文件随该源放在对应源目录下；**绝对地址**引用的文件放进 `common/`。配置里这两类引用都已改写成本仓库的 raw 地址，即镜像不依赖源站存活。文件校验：配置中带 `;md5;` 声明的（jar 等）已核对与文件内容一致。

## 收录与剔除

| 目录 | 源 | 备注 |
| --- | --- | --- |
| `cvkkj` | xx源 `https://tv.cvkkj.top/1.json` | 站点 46→42、直播 1；上游两处引用指向不存在的文件名，已改指实际文件 |
| `liucn` | `https://raw.liucn.cc/box/m.json` | 站点 234→221、直播 3→1 |
| `wex` | 王小二 `https://9280.kstore.space/wex.json` | 站点 63、直播 2；配置内全为绝对地址，13 处已改指 `common/` |
| `qist` | `https://raw.githubusercontent.com/qist/tvbox/master/jsm.json` | 站点 149、直播 3；经 ghproxy 抓取 |
| `gao` | 高天流云 `https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json` | 站点 298→297、直播 2；经 ghproxy / jsdelivr 抓取 |

探测时不可用、因此不收录的源：

- 饭太硬 `http://www.饭太硬.cc/tv`、`http://fty.xxooo.cf/tv`：只返回落地页/商标图，没有配置内容；
- 摸鱼儿 `http://我不是.摸鱼儿.com`：所有路径都返回跳转广告页；
- OK猫开发 `http://ok213.top/tv`：域名有 NS 记录但无 A/AAAA 记录。

源站 404 的引用，对应站点/直播条目会从镜像配置中剔除；如果只是上游把目录写错、同名文件在别处存在，则改指正确路径而不是删除。

## 合并源（`hb.json`）

`hb.json` 把 `liucn`、`王小二`、`qist`、`高天流云` 四份配置合并成一份，由 `tools/merge.mjs` 生成。合并规则是按客户端 `com.fongmi.android.tv.api` 的实际行为定的，不是各取一份随便拼：

| 字段 | 规则 | 依据 |
| --- | --- | --- |
| `sites` | 按 `key` 去重，先出现的保留 | `Site.equals` 只比 key，`initSite` 遇到已有的 key 直接 `continue` |
| `sites[].jar` | 每个 `csp_` 站点写上它原来那份配置的顶层 spider | `parseJar(site, spider)` 只在站点无 `jar` 时回退到顶层 spider，写死等价于原行为 |
| 顶层 `spider` | 只能放**一个** jar，取 qist 的 | `JarLoader.parseJar` 按 `;md5;` 切开只读前两段，多 jar 拼接会解析失败；四个 jar 里只有 qist 和 liucn 的带 `com.github.catvod.parser.Json*/Mix*`（`Json聚合`/`Web聚合` 解析要用） |
| `parses` | 按 `name` 去重 | `initParse` 对已存在的 parse 直接跳过 |
| `rules` | 按 `name` 去重，但 `proxy` 规则合并其 `hosts` | `setRules` 会把**每一条**名为 `proxy` 的规则的 hosts 都加进 http selector |
| `lives` / `doh` / `headers` | 按 `name`（headers 按 `host`）去重 | — |
| `ads` / `flags` / `hosts` | 字符串列表取并集 | — |
| `wallpaper` | 取第一个能连通的 | 顶层只接受一个值 |
| `./` 引用 | 全部改写成该源目录的绝对地址 | `Decoder.fix` 会把配置文本里**每一处** `./` 换成配置自身所在目录；`hb.json` 在仓库根目录，保留相对路径会指错地方 |

合并后：站点 730 → 675（去重后）、解析 71 → 50、规则 53 → 33、直播 8。`tools/check-jars.mjs` 可以核对每个 `csp_` 站点要的类是否真在它指向的 jar 里。

## 绝对地址资源的镜像规则（`common/`）

各源配置里**绝对地址**（`http://` / `https://`）引用的文件，同样下载一份放进仓库根目录的 `common/`：

- `common/` 下以**该绝对地址字符串的 md5**（小写十六进制，按 UTF-8 计算，不含结尾换行）作为子目录名；
- 子目录内放文件本身，文件名取原地址最后一段路径的文件名；
- 同一目录内再放一个 `<文件名>.md5`，内容是**文件内容**的 md5（小写十六进制）。

例：绝对地址 `https://cdn.example.com/a/b/x.txt`

```
common/<md5("https://cdn.example.com/a/b/x.txt")>/x.txt
common/<md5("https://cdn.example.com/a/b/x.txt")>/x.txt.md5
```

配置里的这个绝对地址会被改写成 `https://raw.giteeusercontent.com/zcchu/tvbox/raw/master/common/<md5(地址)>/x.txt`。

原地址与目录的对应关系统一记在 `common/url-index.tsv`（列：`url`、`dir`、`file`、`size`、`md5`、`note`）。改写后原地址不再出现在配置里，这个索引就是唯一的映射依据，**不要手工改名或删除 `common/` 下的目录**。

不镜像的情况：

- 带 `{}` 模板占位的地址，如 `https://epg.112114.xyz/?ch={name}&date={date}`；
- 带查询串（`?`）的地址，属于动态接口或带时效 token，如 `https://jx.yparse.com/index.php?url=`；
- 地址末段没有文件扩展名的，属于目录或纯接口，如 `http://api2.rinhome.com`；
- 指向本仓库自身的地址。

源站 404 的、以及本机探测拉不到的绝对地址，引用它的站点/直播条目会从镜像配置里一并剔除（个别地址只是通道不通、换代理能拿到同一份内容的，会改走可用通道并仍按原地址记目录，记在索引的 `note` 列）。

### 变更判定

`common/` 里存的是**快照，不会自动更新**。再次探测到同一绝对地址时：

- 文件内容 md5 与同名 `.md5` 一致 → 视为未变化，跳过；
- 文件内容 md5 与同名 `.md5` 不一致 → **不覆盖**，只标记该地址已变更，是否更新**由人工判定**后再改。

定位方式：在 `common/url-index.tsv` 里按 `url` 找到 `dir`，比对目录内 `<file>.md5` 与重新拉取该地址内容算出的 md5。

## 维护工具（`tools/`）

按下面的顺序跑，每一步的中间结果写在 `tools/.state/`（已 gitignore）。源清单、`pathRemap`、`urlOverrides`、大文件清单都在 `tools/sources.json` 里改。

| 脚本 | 作用 |
| --- | --- |
| `probe.mjs candidates.json` | 探测候选源地址：能否 200、是不是 JSON 配置（有 `sites`）。落地页/图片/跳转广告页会判为 REJECT |
| `mirror.mjs <folder>` | 抓源配置 + 它用相对路径引用的文件到 `<folder>/`，校验 `;md5;` 声明。会展开 `a$$$b$$$./c.json` 这类拼接值，把里面每个 `./` 字段都当引用抓 |
| `remap-check.mjs <folder>` | 对抓不到的文件，在已抓文件里找同名文件，据此决定是否加 `pathRemap` |
| `transform.mjs <folder>` | 剔除引用了抓不到文件的条目，把相对引用改写成本仓库 raw 地址 |
| `common-snapshot.mjs` | 把各源配置里的绝对地址文件快照进 `common/` |
| `common-rewrite.mjs <folder>` | 剔除绝对地址快照失败的条目，把绝对引用改写指向 `common/` |
| `index.mjs` | 重建 `common/url-index.tsv` |
| `merge.mjs [n]` | 按 `merges` 配置生成合并配置（默认 `hb.json`） |
| `check-jars.mjs [file]` | 核对每个 `csp_` 站点要的类是否在它指向的 jar 里，区分上游就坏的与你自己的错 |
| `fetch-large.mjs` | 下载大文件（spider jar、代理内核）。公共 github 代理会截断大响应，这里按预期字节数校验并对短传做 Range 续传 |
| `verify.mjs` | 全量校验：配置可解析、引用都存在、`;md5;` 与文件一致、每个 `common/` 文件都有匹配的 `.md5`（含合并产物） |

加新源：先在 `tools/sources.json` 里加一条（`folder` / `entry` / `configUrl` / `baseUrl` / `selfOrigins`），然后 `probe → mirror → transform → common-snapshot → common-rewrite → index → verify`，最后把该源的条目追加进 `source.json` 的 `urls` 并跑一次 `verify.mjs`。

合并配置：改 `tools/sources.json` 的 `merges` 后跑 `merge.mjs`，再用 `check-jars.mjs` 和 `verify.mjs` 复核。`merges[].topSpiderFrom` 决定顶层用哪个源的 jar。

`common-snapshot.mjs` 不会覆盖已有快照：md5 不一致时只在报告里标 `CHANGED`，等人工判定后再动。
