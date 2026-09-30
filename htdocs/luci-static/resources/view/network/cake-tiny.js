'use strict';
'require form';
'require fs';
'require poll';
'require ui';
'require view';
'require tools.widgets as widgets';

return view.extend({
  load: function () {
    return fs.exec('/usr/libexec/cake-tiny-status', []).catch(function (err) {
      return { stdout: _('Status unavailable: %s').format(err.message) };
    });
  },

  render: function (status) {
    var m, s, o;

    m = new form.Map('cake_tiny', 'CAKE Tiny');
    m.description = _('Simple upload and download shaping with tc, IFB and CAKE. No sqm-scripts or traffic priority rules are used. Save & Apply updates the service.');

    s = m.section(form.NamedSection, 'main', 'cake_tiny', _('Settings'));
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.Flag, 'enabled', _('Enable'));
    o.default = '0';
    o.rmempty = false;

    o = s.option(widgets.DeviceSelect, 'wan', _('WAN device'));
    o.default = 'eth0';
    o.rmempty = false;
    o.nocreate = false;
    o.noaliases = true;
    o.nobridges = true;
    o.description = _('Select the device carrying Internet traffic. For PPPoE, prefer pppoe-wan; for DHCP, select the WAN Ethernet or VLAN device.');
    o.filter = function (section_id, value) {
      return value !== 'lo' && !value.startsWith('ifb');
    };
    o.validate = function (section_id, value) {
      return /^[a-zA-Z0-9_.:-]{1,15}$/.test(value) && value !== 'lo' && !value.startsWith('ifb') ? true : _('Select an available WAN device.');
    };

    o = s.option(form.Value, 'download', _('Download limit (Mbps)'));
    o.default = '140';
    o.rmempty = false;
    o.validate = function (section_id, value) {
      return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0 ? true : _('Enter a positive speed in Mbps.');
    };

    o.description = _('Start at 90–95% of your stable wired download speed measured without shaping, then adjust based on latency under load.');

    o = s.option(form.Value, 'upload', _('Upload limit (Mbps)'));
    o.default = '30';
    o.rmempty = false;
    o.validate = function (section_id, value) {
      return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0 ? true : _('Enter a positive speed in Mbps.');
    };
    o.description = _('Start at 90–95% of your stable wired upload speed measured without shaping, then adjust based on latency under load.');

    o = s.option(form.Flag, 'nat', _('IPv4 NAT lookup'));
    o.default = '1';
    o.rmempty = false;
    o.description = _('Upload uses source-host fairness and download uses destination-host fairness. NAT lookup lets directly forwarded IPv4 traffic be assigned to the original LAN device; proxy connections and IPv6 do not benefit.');

    o = s.option(form.ListValue, 'link_profile', _('Link-layer accounting'));
    o.value('raw', _('None (raw packet length)'));
    o.value('ethernet', _('Ethernet (38/84)'));
    o.value('ftth', _('FTTH, unknown encapsulation (44/84)'));
    o.value('pppoe', _('PPPoE, no VLAN (46/84)'));
    o.value('pppoe_vlan', _('PPPoE, single VLAN (50/84)'));
    o.value('custom', _('Custom'));
    o.default = 'raw';
    o.rmempty = false;
    o.description = _('Choose how CAKE accounts for framing overhead. The FTTH preset is a conservative starting point when the provider encapsulation is unknown.');

    o = s.option(form.Value, 'overhead', _('Per-packet overhead (bytes)'));
    o.default = '44';
    o.rmempty = false;
    o.depends('link_profile', 'custom');
    o.description = _('Final CAKE overhead for the custom profile.');
    o.validate = function (section_id, value) {
      return /^\d{1,3}$/.test(value) && Number(value) <= 256 ? true : _('Enter an integer from 0 to 256.');
    };

    o = s.option(form.Value, 'mpu', _('Minimum packet unit (bytes)'));
    o.default = '84';
    o.rmempty = false;
    o.depends('link_profile', 'custom');
    o.validate = function (section_id, value) {
      return /^\d{1,3}$/.test(value) && Number(value) <= 256 ? true : _('Enter an integer from 0 to 256.');
    };

    return m.render().then(function (node) {
      var summary = E('div'),
        raw = E('pre', { style: 'white-space: pre-wrap; overflow-wrap: anywhere' });
      var previous = null,
        refreshing = false;
      var stateText = E('p'),
        deviceText = E('p'),
        hint = E('p', { hidden: true });
      var cells = {},
        rows = ['upload', 'download'].map(function (direction) {
          cells[direction] = Array.from({ length: 6 }, function () {
            return E('td', {}, '—');
          });
          return E('tr', {}, [E('td', {}, direction === 'upload' ? _('Upload') : _('Download'))].concat(cells[direction]));
        });
      summary.appendChild(stateText);
      summary.appendChild(deviceText);
      summary.appendChild(
        E(
          'table',
          { class: 'table' },
          [
            E(
              'tr',
              { class: 'tr table-titles' },
              [_('Direction'), _('Current rate'), _('Backlog'), _('Peak queue delay'), _('Drops'), _('ECN marks'), _('Traffic')].map(function (label) {
                return E('th', {}, label);
              }),
            ),
          ].concat(rows),
        ),
      );
      summary.appendChild(E('p', {}, _('Start at 90–95% of stable wired throughput. Compare idle and loaded ping; lower the affected limit if latency rises under load, then increase gradually.')));
      summary.appendChild(E('p', {}, _('Queue delay is local, not end-to-end latency. Drops and ECN marks are cumulative congestion-control counters. Rates are sampled every 3 seconds; no traffic can mean an idle link.')));
      hint.textContent = _('If counters stay unchanged during a transfer, check the selected WAN device and flow offloading.');
      summary.appendChild(hint);
      function stats(text) {
        var cake = (text || '').match(/(?:^|\n)qdisc cake [\s\S]*?(?=\nqdisc |$)/);
        text = cake ? cake[0] : '';
        var sent = text.match(/Sent (\d+) bytes (\d+) pkt \(dropped (\d+)/);
        var backlog = text.match(/backlog (\S+) (\S+)/);
        var delay = text.match(/pk_delay\s+(\S+)/),
          marks = text.match(/ecn_mark\s+(\d+)/);
        return {
          bytes: sent ? Number(sent[1]) : null,
          packets: sent ? Number(sent[2]) : null,
          drops: sent ? sent[3] : '—',
          backlog: backlog ? backlog[1] + ' / ' + backlog[2] : '—',
          delay: delay ? delay[1] : '—',
          marks: marks ? marks[1] : '—',
        };
      }
      function update(result) {
        var output = result.stdout || '',
          fields = {},
          sections = output.split(/\n\[(?:upload|download|filter)\]\n/);
        sections[0].split('\n').forEach(function (line) {
          var pos = line.indexOf('=');
          if (pos > 0) fields[line.slice(0, pos)] = line.slice(pos + 1);
        });
        var current = {
          time: Number(fields.sample_time),
          device: fields.active_device,
          identity: fields.device_identity,
          upload: stats(sections[1]),
          download: stats(sections[2]),
        };
        var elapsed = previous ? current.time - previous.time : 0;
        var comparable = previous && elapsed > 0 && current.device === previous.device && current.identity === previous.identity && fields.complete === '1';
        var observed = false;
        ['upload', 'download'].forEach(function (direction) {
          var now = current[direction],
            before = previous && previous[direction],
            rate = '—',
            traffic = _('Waiting for samples');
          if (comparable && now.bytes !== null && before.bytes !== null && now.bytes >= before.bytes && now.packets >= before.packets) {
            rate = (((now.bytes - before.bytes) * 8) / elapsed / 1000000).toFixed(2) + ' Mbps';
            var growing = now.packets > before.packets;
            traffic = growing ? _('Traffic observed') : _('No traffic observed in this interval');
            observed = observed || growing;
          }
          [rate, now.backlog, now.delay, now.drops, now.marks, traffic].forEach(function (value, index) {
            cells[direction][index].textContent = value;
          });
        });
        previous = fields.complete === '1' ? current : null;
        stateText.textContent = fields.enabled !== '1' ? _('Disabled') : fields.complete === '1' ? _('Rules complete') : _('Rules incomplete or device unavailable');
        deviceText.textContent = _('Configured device: %s; sampled device: %s').format(fields.configured_device || '—', fields.active_device || '—');
        hint.hidden = !(fields.complete === '1' && comparable && !observed);
        raw.textContent = output || _('No statistics available.');
      }
      update(status);
      var statusPane = E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') }, [E('h3', {}, _('Live CAKE status')), summary, E('details', {}, [E('summary', {}, _('Raw tc statistics')), raw])]);
      function refresh() {
        if (refreshing) return Promise.resolve();
        refreshing = true;
        return fs
          .exec('/usr/libexec/cake-tiny-status', [])
          .then(update)
          .catch(function (err) {
            previous = null;
            stateText.textContent = _('Status unavailable: %s').format(err.message);
            hint.hidden = true;
            Object.keys(cells).forEach(function (direction) {
              cells[direction].forEach(function (cell) {
                cell.textContent = '—';
              });
            });
          })
          .finally(function () {
            refreshing = false;
          });
      }
      statusPane.addEventListener('cbi-tab-active', function () {
        previous = null;
        refresh();
      });
      poll.add(function () {
        if (statusPane.getAttribute('data-tab-active') === 'true') return refresh();
      }, 3);
      var panes = E('div', {}, [E('div', { 'data-tab': 'settings', 'data-tab-title': _('Settings') }, [node]), statusPane]);
      var root = E('div', { class: 'cbi-section' }, [panes]);
      ui.tabs.initTabGroup(panes.childNodes);
      return root;
    });
  },
});
