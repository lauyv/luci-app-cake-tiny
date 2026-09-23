include $(TOPDIR)/rules.mk

PKG_LICENSE:=GPL-2.0-only
PKG_RELEASE:=1

LUCI_TITLE:=Tiny CAKE shaper (tc + IFB)
LUCI_DESCRIPTION:=Minimal CAKE upload and download shaping without sqm-scripts
LUCI_DEPENDS:=+luci-base +tc-tiny +kmod-ifb +kmod-sched-cake
LUCI_URL:=https://github.com/lauyv/luci-app-cake-tiny

define Build/Prepare/luci-app-cake-tiny
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/init.d/cake-tiny
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/hotplug.d/iface/95-cake-tiny
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/hotplug.d/net/95-cake-tiny
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/cake-tiny-status
endef

define Package/luci-app-cake-tiny/conffiles
/etc/config/cake_tiny
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
