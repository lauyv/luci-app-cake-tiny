# CAKE Tiny for LuCI

适用于 ImmortalWrt / OpenWrt 25.12 的简易 CAKE 整形页面。它在物理 WAN 网卡上用 `tc` 和 CAKE 控制上传，并把该网卡的入站流量重定向到 IFB 控制下载。不依赖 `sqm-scripts`。

本项目只使用普通 `cake` qdisc：上传和下载都采用 `besteffort`，下载侧启用 CAKE 的 `ingress` 模式。默认开启 IPv4 NAT 查询，以改善直连流量的主机公平性；不配置 DiffServ 优先级或自定义 UDP 规则。

## 快速设置

安装后打开 LuCI 的 **网络 → CAKE Tiny**，按以下顺序设置并点击**保存并应用**：

1. 选择连接上级设备的**物理 WAN 设备**。`eth0` 只是默认值，请以路由器的实际网口分配为准。
2. 分别填写下载和上传限速，单位为 **Mbps**。建议先取未启用整形时有线实测稳定速率的约 90%～95%，再根据满载时的延迟调整。
3. **链路层开销补偿**默认开启，可按实际链路设置每包开销和最小包长；关闭后使用 Linux 报告的包长。
4. **IPv4 NAT 查询**默认开启。若不需要，可在页面中关闭。
5. 勾选**启用**。默认配置中的 `enabled=0`，安装后不会立即接管 WAN 队列。

默认配置位于 `/etc/config/cake_tiny`：

| 选项                | 默认值 | 含义                              |
| ------------------- | -----: | --------------------------------- |
| `wan`               | `eth0` | 被整形的物理 WAN 设备             |
| `download`          |  `140` | 下载限速，Mbps                    |
| `upload`            |   `30` | 上传限速，Mbps                    |
| `nat`               |    `1` | 是否启用 CAKE 的 IPv4 NAT 查询    |
| `link_compensation` |    `1` | 是否启用链路层开销补偿            |
| `overhead`          |   `44` | CAKE 最终使用的每包开销，字节     |
| `mpu`               |   `84` | CAKE 最终使用的最小计费包长，字节 |

这些速率只是初始值，并不代表线路测速结果。例如实测**下载 100 Mbps、上传 20 Mbps** 时，可以先试下载 `95`、上传 `19`；满载延迟稳定后再逐步提高。

### 常见 WAN 接入方式

| 接入方式                          | WAN 设备选择                 | 注意事项                                                     |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| 上级设备拨号，本机通过 DHCP 上网  | 连接上级设备的物理网卡       | 只有经过本机的流量会被整形；直连上级设备的终端不受控制。     |
| 上级设备桥接，本机通过 PPPoE 拨号 | 承载 PPPoE 的物理网卡        | 本项目的规则装在所选网卡上，而不是 `pppoe-wan`。             |
| 本机 PPPoE 拨号并使用 VLAN        | 通常仍选承载 VLAN 的物理网卡 | 先确认网络配置中的上联设备及标签是否已计入该设备看到的包长。 |

sing-box 的 TUN、`auto_route` 和 `auto_redirect` 可以与本项目同时使用。CAKE 整形最终经过所选物理 WAN 的流量。`nat=1` 会在上传和下载 CAKE 上查询 IPv4 NAT 连接，可能改善经内核直接转发的多设备流量公平性；sing-box 代理或 `direct` 出站重新发起的连接无法借此还原原始内网设备，IPv6 也不依赖此查询。若使用 `auto_redirect` 的内核级 `bypass` 放行直连 IPv4，且本机执行 NAT，这个选项才更可能有用。物理 WAN 承载 PPPoE 时，CAKE 在此处看到的 PPPoE 帧通常无法进行 IPv4 NAT 查询。使用 CAKE 时建议关闭硬件流量卸载；若统计计数不随负载增长，也要检查软件流量卸载和实际流量路径。

### 开销参数的实际含义

启用链路层开销补偿时，服务使用 `overhead <数值> mpu <数值>`，当前默认值为 **overhead 44、MPU 84**，上传和下载共用这组参数。`overhead` 是每包补偿，`mpu` 是补偿后的最小计费长度。关闭时，服务向 CAKE 传入 `raw`，不传入 `overhead` 和 `mpu`；LuCI 隐藏这两个输入框，保存后会删除原值。重新开启时使用默认的 `44/84`，可再调整。`raw` 按 Linux 报告的包长计费，这个包长不一定等于纯 IP 包长。

本项目不启用 ATM/PTM 补偿。开启补偿时，计费关系可理解为：

```text
计费长度 = max(CAKE 的基础包长 + overhead, mpu)
```

CAKE 会先按 `skb_network_offset` 扣除基础包长之前的头部。是否需要补偿某种封装，取决于它是否仍被计入基础包长；仅凭抓包里看到了头部，不能判断是否需要补偿。实现见 [CAKE 内核计费代码](https://github.com/torvalds/linux/blob/v6.12/net/sched/sch_cake.c#L1218)。

### 不同拨号方式的参考值

先以普通千兆以太网为基础计算。根据 [Linux tc-cake 手册](https://man7.org/linux/man-pages/man8/tc-cake.8.html)，完整以太网传输开销包含 14 字节 MAC 帧头、4 字节 FCS、8 字节前导码及帧起始定界符，以及 12 字节帧间隙的等效长度，共 **38 字节**。PPPoE/PPP 额外增加 **8 字节**，每层 VLAN 标签再增加 **4 字节**。

以下数字表示**以 IP 包长为基础、按完整以太网线上长度计算**的参考值，并不等于所有 PON 线路的精确开销。精确设置还取决于运营商的计费方式，以及上传和下载整形位置已计入的封装，需避免重复补偿。

| 封装方式       |       Overhead | MPU |
| -------------- | -------------: | --: |
| DHCP，无 VLAN  |             38 |  84 |
| DHCP，单 VLAN  |             42 |  84 |
| PPPoE，无 VLAN |             46 |  84 |
| PPPoE，单 VLAN |             50 |  84 |
| PPPoE，双 VLAN |             54 |  84 |
| FTTH 封装未知  | 44（通用起点） |  84 |

最小以太网帧 64 字节，加上前导码和帧间隙的占用，对应 MPU 84。`18/64` 则是 CAKE 的 DOCSIS 预设，不能仅因为使用网线就选 MPU 64。[预设定义](https://github.com/iproute2/iproute2/blob/main/man/man8/tc-cake.8#L321)

这也解释了为什么 **44 并不是所有 PPPoE 光纤线路的精确值**：以 IP 包长为基础、按完整以太网线上长度计算时，即使没有 VLAN，PPPoE 的参考开销也已经达到 **46 字节**。表中的 `44/84` 是封装未知时的经验起点，不是上述封装公式的计算结果，也不是开销上限。[SQM 维护者说明](https://lists.openwrt.org/pipermail/openwrt-devel/2022-November/039814.html)

CAKE 还提供以下链路预设，参数定义见 [CAKE 手册](https://man7.org/linux/man-pages/man8/tc-cake.8.html)：

| 预设        | 等效参数                   | 适用场景                          |
| ----------- | -------------------------- | --------------------------------- |
| `ethernet`  | `overhead 38 mpu 84 noatm` | 按完整以太网线上长度计费          |
| `pppoe-ptm` | `overhead 30 ptm`          | 经 PTM 承载的 PPPoE，常见于 VDSL2 |
| `docsis`    | `overhead 18 mpu 64 noatm` | 有线电视宽带的 DOCSIS 计费方式    |
| `raw`       | 不启用开销补偿             | 按 Linux 报告的包长计费           |

仅使用 PPPoE 拨号不代表适合 `pppoe-ptm`。本项目开启补偿时手动传入 `overhead` 和 `mpu`，默认 `44/84`；关闭时使用 `raw`，不会自动选择其他预设。

## 安装

### 通过 apk-repository 软件源安装

[lauyv/apk-repository](https://github.com/lauyv/apk-repository) 提供本应用的签名 APK 软件源，适用于 OpenWrt 25.12 的 `aarch64_generic` 和 `x86_64` 架构；其他架构及 `opkg` 系统请使用下方的安装方式。先在路由器上运行 `cat /etc/apk/arch`，确认设备架构与所选软件源一致。

1. 通过 SSH 下载公钥并显示指纹：

   ```sh
   wget -O /tmp/apk-repository.pem 'https://lauyv.github.io/apk-repository/apk/apk-repository.pem'
   sha256sum /tmp/apk-repository.pem
   ```

   将输出与维护者提供的可信指纹核对，确认一致后安装公钥：

   ```sh
   mkdir -p /etc/apk/keys
   mv /tmp/apk-repository.pem /etc/apk/keys/apk-repository.pem
   ```

2. 在 LuCI 的 **系统 → 软件包 → 配置** 中打开 `/etc/apk/repositories.d/customfeeds.list`，保留原有内容，另起一行添加与设备架构对应的地址：

   | 架构              | `latest` 软件源地址                                                              |
   | ----------------- | -------------------------------------------------------------------------------- |
   | `aarch64_generic` | `https://lauyv.github.io/apk-repository/apk/latest/aarch64_generic/packages.adb` |
   | `x86_64`          | `https://lauyv.github.io/apk-repository/apk/latest/x86_64/packages.adb`          |

3. 保存配置并**更新列表**，在 **系统 → 软件包 → 可用** 中搜索 `luci-app-cake-tiny`，核对版本后安装。保留系统原有的官方软件源，以便安装 `tc-tiny` 和内核模块等依赖。

`latest` 会选用上游最近发布的非草稿版本，包括预发布版；只需要正式版时，把地址中的 `latest` 改为 `stable`。同一时间只添加一个本仓库通道。后续可在软件包页面更新列表并升级本应用；公钥、指纹核对和来源确认的完整步骤以 [apk-repository README](https://github.com/lauyv/apk-repository#readme) 为准。

### 在固件构建树中编译

将本目录放在 `feeds/luci/applications/luci-app-cake-tiny`，然后运行：

```sh
./scripts/feeds update luci
./scripts/feeds install luci-app-cake-tiny
make package/luci-app-cake-tiny/compile V=s
```

在路由器上安装生成的 APK。依赖包括 `luci-base`、`tc-tiny`、`kmod-ifb` 和 `kmod-sched-cake`；后者会引入 `kmod-sched-core`。

### 安装 GitHub Release 软件包

[Releases](https://github.com/lauyv/luci-app-cake-tiny/releases) 提供未签名的 APK 和 IPK，以及编译好的简体中文 LuCI 翻译。APK 面向 ImmortalWrt 25.12；IPK 面向兼容的 `opkg` 系统。先把软件包复制到路由器的 `/tmp`，再执行对应命令：

```sh
# ImmortalWrt 25.12
apk add --allow-untrusted /tmp/luci-app-cake-tiny-*.apk

# 使用 opkg 的兼容系统
opkg install /tmp/luci-app-cake-tiny_*.ipk

/etc/init.d/rpcd restart
```

路由器的软件源必须提供与当前内核匹配的依赖模块；Release 软件包本身不包含内核模块。

## 运行与排查

服务在开机时读取配置，并通过 procd 的 UCI 触发器响应配置变更。WAN 下线时清理规则，恢复或重建时重新安装；服务使用 `ifb-cake` 作为下载侧设备。LuCI 页面会显示当前的 qdisc 和入站过滤器统计。

```sh
/etc/init.d/cake-tiny status
tc -s qdisc show dev eth0
tc -s qdisc show dev ifb-cake
tc filter show dev eth0 parent ffff:
logread -e cake-tiny
```

如果物理 WAN 不是 `eth0`，请把命令中的设备名改为实际值。满载时检查上传 CAKE、IFB CAKE 和入站过滤器的计数是否增长，并同时观察延迟；仅看到规则存在，不能证明所有流量都经过整形。

同一个 WAN 设备应只有一个服务管理根 qdisc 和 ingress qdisc。启用 CAKE Tiny 前，先停用已有的 SQM 或自定义 `tc` 服务。检测到其他服务的非默认规则时，CAKE Tiny 会拒绝接管；若 `ifb-cake` 已被其他用途占用，也会拒绝覆盖。停止服务时，它会核对设备及规则标识，避免删除后来被其他服务替换的规则。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
