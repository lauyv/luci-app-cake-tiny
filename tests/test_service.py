"""Exercise the init script with isolated devices and mocked OpenWrt commands."""
import pathlib
import subprocess
import tempfile
import unittest

SERVICE = pathlib.Path(__file__).resolve().parents[1] / 'root/etc/init.d/cake-tiny'


class RateUpdateTests(unittest.TestCase):
    def run_service(self, download='90', upload='19', nat='1', fail='', missing=False):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            for device, index in [('pppoe-wan', '7'), ('ifb-cake', '8')]:
                (base / device).mkdir()
                (base / device / 'ifindex').write_text(index + '\n')
            (base / 'state').write_text('pppoe-wan 7 8 2\n')
            (base / 'params').write_text('nat raw 0 0 20 100\n')
            script = SERVICE.read_text().replace('/sys/class/net', directory)
            script = script.replace('STATE=/var/run/cake-tiny.wan', f'STATE={directory}/state')
            script = script.replace('PARAMS=/var/run/cake-tiny.params', f'PARAMS={directory}/params')
            script += f'''
config_load() {{ :; }}
config_get() {{
 case "$2" in
 main) case "$3" in
 wan) value=pppoe-wan;; download) value={download};; upload) value={upload};;
 link_profile) value=raw;; overhead) value=44;; mpu) value=84;; esac;;
 esac
 eval "$1=\\$value"
}}
config_get_bool() {{
 case "$3" in enabled) value=1;; nat) value={nat};; esac
 eval "$1=\\$value"
}}
log() {{ echo "LOG: $*"; }}
check_wan_conflicts() {{ return 0; }}
status_service() {{ return {1 if missing else 0}; }}
tc() {{
 echo "TC: $*"
 case "$*" in *'dev ifb-cake'*'bandwidth {download}Mbit') { 'return 1' if fail == 'download' else ':' };; esac
}}
cleanup() {{ echo REBUILD; }}
modprobe() {{ :; }}
ip() {{ echo "IP: $*"; return 1; }}
start_service
result=$?
echo "RESULT: $result"
cat "$PARAMS"
'''
            return subprocess.run(['sh'], input=script, text=True, capture_output=True, check=True).stdout

    def test_rates_change_without_rebuild(self):
        output = self.run_service()
        self.assertIn('TC: qdisc change dev pppoe-wan root handle 1ca: cake bandwidth 19Mbit', output)
        self.assertIn('TC: qdisc change dev ifb-cake root handle 1cb: cake bandwidth 90Mbit', output)
        self.assertNotIn('REBUILD', output)
        self.assertIn('nat raw 0 0 19 90', output)

    def test_download_only_does_not_touch_upload(self):
        output = self.run_service(upload='20')
        self.assertNotIn('TC: qdisc change dev pppoe-wan', output)
        self.assertIn('TC: qdisc change dev ifb-cake', output)

    def test_upload_only_does_not_touch_download(self):
        output = self.run_service(download='100')
        self.assertIn('TC: qdisc change dev pppoe-wan', output)
        self.assertNotIn('TC: qdisc change dev ifb-cake', output)

    def test_identical_settings_do_not_touch_queues(self):
        output = self.run_service(upload='20', download='100')
        self.assertNotIn('TC:', output)
        self.assertNotIn('REBUILD', output)

    def test_failed_download_restores_upload(self):
        output = self.run_service(fail='download')
        self.assertIn('bandwidth 20Mbit', output)
        self.assertIn('RESULT: 1', output)
        self.assertIn('nat raw 0 0 20 100', output)
        self.assertNotIn('REBUILD', output)

    def test_changed_nat_rebuilds(self):
        self.assertIn('REBUILD', self.run_service(nat='0'))

    def test_incomplete_rules_rebuild(self):
        self.assertIn('REBUILD', self.run_service(missing=True))


class CleanupTests(unittest.TestCase):
    def run_cleanup(self, recreated=False, foreign=False):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            for device, index in [('pppoe-wan', '9' if recreated else '7'), ('ifb-cake', '10' if recreated else '8')]:
                (base / device).mkdir()
                (base / device / 'ifindex').write_text(index + '\n')
            (base / 'state').write_text('pppoe-wan 7 8 2\n')
            (base / 'params').write_text('nat raw 0 0 20 100\n')
            script = SERVICE.read_text().replace('/sys/class/net', directory)
            script = script.replace('STATE=/var/run/cake-tiny.wan', f'STATE={directory}/state')
            script = script.replace('PARAMS=/var/run/cake-tiny.params', f'PARAMS={directory}/params')
            script += f"""
tc() {{
 case "$*" in
 'qdisc show dev pppoe-wan') echo 'qdisc {'fq_codel 0:' if foreign else 'cake 1ca:'} root refcnt 2';;
 'qdisc show dev ifb-cake') echo 'qdisc {'cake 999:' if foreign else 'cake 1cb:'} root refcnt 2';;
 'filter show dev pppoe-wan parent ffff: pref 49152') {'echo foreign' if foreign else "echo 'Egress Redirect to device ifb-cake'"};;
 'filter show dev pppoe-wan parent ffff:') {'echo foreign' if foreign else ':'};;
 *) echo "TC: $*";;
 esac
}}
ip() {{ echo "IP: $*"; }}
cleanup
"""
            result = subprocess.run(['sh'], input=script, text=True, capture_output=True, check=True)
            self.assertFalse((base / 'state').exists())
            self.assertFalse((base / 'params').exists())
            return result.stdout

    def test_owned_rules_are_removed(self):
        output = self.run_cleanup()
        self.assertIn('TC: qdisc del dev pppoe-wan root', output)
        self.assertIn('TC: filter del dev pppoe-wan', output)
        self.assertIn('IP: link del ifb-cake', output)

    def test_recreated_devices_are_preserved(self):
        self.assertEqual(self.run_cleanup(recreated=True), '')

    def test_foreign_rules_are_preserved(self):
        self.assertEqual(self.run_cleanup(foreign=True), '')


class HotplugTests(unittest.TestCase):
    def run_hotplug(self, action, wan='pppoe-wan', interface='wan', device=None, exists=True):
        hotplug = SERVICE.parent.parent / 'hotplug.d/iface/95-cake-tiny'
        with tempfile.TemporaryDirectory() as directory:
            if exists:
                pathlib.Path(directory, wan).mkdir()
            script = hotplug.read_text().replace('/sys/class/net', directory)
            script = script.replace('/etc/init.d/cake-tiny', 'mock_service')
            # netifd only sets DEVICE for ifup and ifupdate, not ifdown.
            device_line = 'unset DEVICE' if device is None else f'DEVICE={device}'
            prefix = f"""
ACTION={action}
INTERFACE={interface}
{device_line}
uci() {{ case "$*" in *main.wan) echo {wan};; *main.enabled) echo 1;; esac; }}
tc() {{ return 0; }}
mock_service() {{ echo "$*"; }}
"""
            return subprocess.run(['sh'], input=prefix + script, text=True,
                                  capture_output=True, check=True).stdout.strip()

    def test_logical_device_reconnect(self):
        for action in ['ifup', 'ifupdate']:
            with self.subTest(action=action):
                self.assertEqual(self.run_hotplug(action, device='pppoe-wan'), 'start')

    def test_ifdown_without_device_cleans_existing_wan(self):
        for wan in ['eth0', 'eth0.2', 'pppoe-wan']:
            with self.subTest(wan=wan):
                self.assertEqual(self.run_hotplug('ifdown', wan=wan), 'down')

    def test_ifdown_without_device_cleans_removed_wan(self):
        self.assertEqual(self.run_hotplug('ifdown', exists=False), 'down')

    def test_unrelated_ifdown_is_ignored(self):
        self.assertEqual(self.run_hotplug('ifdown', interface='lan'), '')

    def test_reconnect_of_custom_interface(self):
        self.assertEqual(self.run_hotplug('ifup', interface='uplink', device='pppoe-wan'), 'start')


if __name__ == '__main__':
    unittest.main()
