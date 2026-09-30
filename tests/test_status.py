"""Verify status against a single tc snapshot and device ownership."""

import pathlib
import subprocess
import tempfile
import unittest

STATUS = (
    pathlib.Path(__file__).resolve().parents[1] / "root/usr/libexec/cake-tiny-status"
)


class StatusTests(unittest.TestCase):
    def run_status(
        self,
        check=False,
        identity="7",
        state=True,
        filter_pref="49152",
        ingress=True,
        fail=False,
    ):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            for device, index in [("pppoe-wan", identity), ("ifb-cake", "8")]:
                (base / device).mkdir()
                (base / device / "ifindex").write_text(index + "\n")
            if state:
                (base / "state").write_text("pppoe-wan 7 8 2\n")
            (base / "uptime").write_text("123.45 60.00\n")
            (base / "upload").write_text(
                "qdisc cake 1ca: root bandwidth 19Mbit\n"
                + ("qdisc ingress ffff: parent ffff:fff1\n" if ingress else "")
            )
            (base / "download").write_text("qdisc cake 1cb: root bandwidth 90Mbit\n")
            (base / "filter").write_text(
                f"filter parent ffff: protocol all pref {filter_pref} matchall handle 0x1\n"
                " action order 1: mirred (Egress Redirect to device ifb-cake)\n"
            )
            script = STATUS.read_text().replace("/sys/class/net", directory)
            script = script.replace("/var/run/cake-tiny.wan", f"{directory}/state")
            script = script.replace("/proc/uptime", f"{directory}/uptime")
            prefix = f'''
uci() {{ case "$*" in *main.wan) echo pppoe-wan;; *main.enabled) echo 1;; esac; }}
tc() {{
 echo "$*" >>"{directory}/calls"
 case "$*" in
 *filter*) cat "{directory}/filter";;
 *ifb-cake*) cat "{directory}/download";;
 *) cat "{directory}/upload";;
 esac
 return {1 if fail else 0}
}}
'''
            result = subprocess.run(
                ["sh", "-s", "--"] + (["--check"] if check else []),
                input=prefix + script,
                text=True,
                capture_output=True,
            )
            self.assertEqual(len((base / "calls").read_text().splitlines()), 3)
            return result

    def test_complete_snapshot(self):
        result = self.run_status()
        self.assertEqual(result.returncode, 0)
        self.assertIn("complete=1\n", result.stdout)
        self.assertIn("sample_time=123.45\n", result.stdout)

    def test_check_is_silent(self):
        result = self.run_status(check=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_recreated_device_is_incomplete(self):
        self.assertIn("complete=0\n", self.run_status(identity="9").stdout)

    def test_missing_state_is_incomplete(self):
        self.assertIn("complete=0\n", self.run_status(state=False).stdout)

    def test_other_filter_cannot_prove_ownership(self):
        result = self.run_status(check=True, filter_pref="100")
        self.assertEqual(result.returncode, 1)

    def test_missing_ingress_is_incomplete(self):
        self.assertIn("complete=0\n", self.run_status(ingress=False).stdout)

    def test_failed_tc_is_incomplete(self):
        self.assertIn("complete=0\n", self.run_status(fail=True).stdout)


if __name__ == "__main__":
    unittest.main()
