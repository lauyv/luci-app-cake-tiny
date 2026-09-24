'use strict';
'require form';
'require fs';
'require view';
'require tools.widgets as widgets';

return view.extend({
	load: function() {
		return fs.exec('/usr/libexec/cake-tiny-status', []).catch(function(err) {
			return { stdout: _('Status unavailable: %s').format(err.message) };
		});
	},

	render: function(status) {
		var m, s, o;

		m = new form.Map('cake_tiny', _('CAKE Tiny'));
		m.description = _('Simple upload and download shaping with tc, IFB and CAKE. No sqm-scripts or traffic priority rules are used. Save & Apply updates the service.');

		s = m.section(form.NamedSection, 'main', 'cake_tiny', _('Settings'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(widgets.DeviceSelect, 'wan', _('Physical WAN device'));
		o.default = 'eth0';
		o.rmempty = false;
		o.nocreate = true;
		o.noaliases = true;
		o.nobridges = true;
		o.filter = function(section_id, value) {
			return value !== 'ifb-cake';
		};
		o.validate = function(section_id, value) {
			return /^[a-zA-Z0-9_.:-]{1,15}$/.test(value) && value !== 'ifb-cake'
				? true : _('Select an available WAN device.');
		};

		o = s.option(form.Value, 'download', _('Download limit (Mbps)'));
		o.default = '140';
		o.rmempty = false;
		o.validate = function(section_id, value) {
			return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0
				? true : _('Enter a positive speed in Mbps.');
		};

		o = s.option(form.Value, 'upload', _('Upload limit (Mbps)'));
		o.default = '30';
		o.rmempty = false;
		o.validate = function(section_id, value) {
			return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0
				? true : _('Enter a positive speed in Mbps.');
		};
		o.description = _('Set this to about 93–95% of your measured upload speed.');

		o = s.option(form.Flag, 'nat', _('IPv4 NAT lookup'));
		o.default = '1';
		o.rmempty = false;
		o.description = _('May improve fairness between LAN devices for directly forwarded IPv4 traffic. Proxy connections and IPv6 do not benefit.');

		o = s.option(form.Value, 'overhead', _('Per-packet overhead (bytes)'));
		o.default = '38';
		o.rmempty = false;
		o.description = _('Final CAKE overhead. Start with 38 bytes for a physical Ethernet WAN; do not automatically add PPPoE bytes.');
		o.validate = function(section_id, value) {
			return /^\d{1,3}$/.test(value) && Number(value) <= 256
				? true : _('Enter an integer from 0 to 256.');
		};

		o = s.option(form.Value, 'mpu', _('Minimum packet unit (bytes)'));
		o.default = '84';
		o.rmempty = false;
		o.validate = function(section_id, value) {
			return /^\d{1,3}$/.test(value) && Number(value) <= 256
				? true : _('Enter an integer from 0 to 256.');
		};

		return m.render().then(function(node) {
			node.appendChild(E('h3', {}, _('Current tc statistics')));
			node.appendChild(E('pre', { 'style': 'white-space: pre-wrap; overflow-wrap: anywhere' },
				status.stdout || _('No statistics available.')));
			return node;
		});
	}
});
