# tvbox

TVBox / 影视仓的配置源镜像仓库：把公开的源配置抓取到本仓库并对外暴露，源站挂掉时仍可用。

对外入口（多仓格式，客户端里选择对应的源）：

```
https://raw.giteeusercontent.com/zcchu/tvbox/raw/master/source.json
```

## 目录结构

```
source.json            多仓索引，urls 里每条对应一个源
cvkkj/ liucn/ wex/ ... 每个源一个目录：源配置文件 + 它用相对路径引用的文件
common/                各源用绝对地址引用的文件（见下）
```

源配置里**相对路径**（`./jar/x.jar`、`./js/x.js`）引用的文件随该源放在对应源目录下；**绝对地址**引用的文件放进 `common/`。配置里这两类引用都已改写成本仓库的 raw 地址，即镜像不依赖源站存活。文件校验：配置中带 `;md5;` 声明的（jar 等）已核对与文件内容一致。

## 收录与剔除

| 目录 | 源 | 备注 |
| --- | --- | --- |
| `cvkkj` | 综合源 `https://tv.cvkkj.top/1.json` | 站点 46→42、直播 1；上游两处引用指向不存在的文件名，已改指实际文件 |
| `liucn` | `https://raw.liucn.cc/box/m.json` | 站点 234→221、直播 3→1 |
| `wex` | 王小二 `https://9280.kstore.space/wex.json` | 站点 63、直播 2；配置内全为绝对地址，13 处已改指 `common/` |
| `qist` | `https://raw.githubusercontent.com/qist/tvbox/master/jsm.json` | 站点 149、直播 3；经 ghproxy 抓取 |
| `gao` | 高天流云 `https://raw.githubusercontent.com/gaotianliuyun/gao/master/js.json` | 站点 298→297、直播 2；经 ghproxy / jsdelivr 抓取 |

探测时不可用、因此不收录的源：

- 饭太硬 `http://www.饭太硬.cc/tv`、`http://fty.xxooo.cf/tv`：只返回落地页/商标图，没有配置内容；
- 摸鱼儿 `http://我不是.摸鱼儿.com`：所有路径都返回跳转广告页；
- OK猫开发 `http://ok213.top/tv`：域名有 NS 记录但无 A/AAAA 记录。

源站 404 的引用，对应站点/直播条目会从镜像配置中剔除；如果只是上游把目录写错、同名文件在别处存在，则改指正确路径而不是删除。

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
