# CAKE Tiny for LuCI

A small LuCI application for ImmortalWrt/OpenWrt 25.12. It shapes upload on the
physical WAN interface and downloads through an IFB using `tc` and CAKE. The
default configuration is `eth0`, 93 Mbit/s download and 19 Mbit/s upload,
with `ethernet overhead 44 mpu 84` in both directions.
The service starts disabled until you enable it in LuCI.

It uses `besteffort` in both directions and `ingress` on the IFB. It does not
install `sqm-scripts`, NAT host isolation, DiffServ or UDP priority rules.
The default qdisc is regular `cake`. LuCI also offers `cake_mq` for a physical
WAN device with at least two transmit queues. In that mode the service creates
a multiqueue IFB and applies `cake_mq` in both directions. It checks support
before removing the previous rules; unsupported devices leave the prior
configuration intact and produce a log message.

## Build and install

Place this directory at `feeds/luci/applications/luci-app-cake-tiny` in your
ImmortalWrt 25.12 build tree, then run:

```sh
./scripts/feeds update luci
./scripts/feeds install luci-app-cake-tiny
make package/luci-app-cake-tiny/compile V=s
```

Install the resulting `.apk` on the router with `apk add ./luci-app-cake-tiny-*.apk`.
The package depends on `luci-base`, `tc-tiny`, `ip-tiny`, `kmod-ifb`, and
`kmod-sched-cake` (which brings in `kmod-sched-core`).

## GitHub Actions release packages

The **Release** workflow can be started manually with a tag such as `v0.1.0`.
It builds unsigned APK v3 and IPK packages, uploads them as workflow artifacts,
and creates a [GitHub Release](https://github.com/lauyv/luci-app-cake-tiny/releases).
The release packages include the compiled
Simplified Chinese LuCI translation. The APK is intended for ImmortalWrt 25.12;
the IPK is for compatible `opkg` systems.

Install a downloaded release package from the router's `/tmp` directory:

```sh
apk add --allow-untrusted /tmp/luci-app-cake-tiny-*.apk
# or on an opkg-based system:
opkg install /tmp/luci-app-cake-tiny_*.ipk
/etc/init.d/rpcd restart
```

The router must have a compatible package repository for the declared kernel
module dependencies. These release packages contain the LuCI application,
not kernel modules.

In LuCI, open **Network → CAKE Tiny**, check the physical WAN device and set
the upload rate to suit your connection, then enable and **Save & Apply**.
The page displays the current `tc` qdisc and ingress filter statistics.
The init service starts at boot. A WAN `ifdown` event removes its rules, and
`ifup` restores them. An `ifupdate` event restores missing rules. Removing or
recreating the physical WAN device also triggers cleanup or reinstallation.
Configuration changes are handled by the procd UCI reload trigger.

## Notes

- Only one service should own the WAN qdiscs. Disable an existing SQM or custom
  `tc` service (including the original `cake-simple` script) before enabling
  CAKE Tiny. Existing non-default root or ingress qdiscs cause startup to fail
  without replacing them.
- The service uses `ifb-cake` and refuses to overwrite an existing device with
  that name.
- The default 44-byte overhead is an initial FTTH setting, not a universal
  value. Adjust it and MPU to match your actual encapsulation.
- `cake_mq` requires at least two WAN TX queues and an iproute2 `ip` utility
  that can create a multiqueue IFB. It is not a guaranteed speed improvement:
  OpenWrt 25.12 has a [reported low-throughput issue](https://github.com/openwrt/openwrt/issues/22344)
  on some configurations. At 100 Mbit/s, keep regular `cake` unless a loaded
  latency and throughput comparison shows a benefit.
- If CAKE counters do not increase under load, test with software flow
  offloading disabled. Hardware flow offloading should stay off for shaping.
- For manual checks, run `tc -s qdisc show dev eth0`,
  `tc -s qdisc show dev ifb-cake`, and
  `tc filter show dev eth0 parent ffff:`.
