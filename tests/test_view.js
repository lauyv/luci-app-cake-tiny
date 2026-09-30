'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
String.prototype.format = function (...args) {
  let i = 0;
  return this.replace(/%s/g, () => args[i++]);
};
function E(tag, attrs, children) {
  if (children === undefined && typeof attrs === 'string') {
    children = attrs;
    attrs = {};
  }
  const node = {
    tag,
    attrs: attrs || {},
    parentNode: null,
    childNodes: [],
    appendChild(child) {
      if (child && child.nodeType === 11) {
        const children = child.childNodes.splice(0);
        children.forEach((entry) => this.appendChild(entry));
        return child;
      }
      this.childNodes.push(child);
      if (typeof child === 'object') child.parentNode = this;
    },
    insertBefore(child, reference) {
      const index = this.childNodes.indexOf(reference);
      assert.ok(index >= 0, 'Reference node must belong to the parent');
      this.childNodes.splice(index, 0, child);
      child.parentNode = this;
    },
    replaceChildren(...children) {
      this.childNodes.forEach((child) => {
        if (typeof child === 'object') child.parentNode = null;
      });
      this.childNodes = [];
      children.forEach((child) => this.appendChild(child));
    },
    addEventListener(event, fn) {
      this[event] = fn;
    },
    getAttribute(name) {
      return this.attrs[name];
    },
  };
  (Array.isArray(children) ? children : children ? [children] : []).forEach((child) => node.appendChild(child));
  return node;
}
let deviceOption,
  calls = 0;
class Map {
  section() {
    return {
      option(type, name) {
        const option = { value() {}, depends() {} };
        if (name === 'wan') deviceOption = option;
        return option;
      },
    };
  }
  render() {
    return Promise.resolve(E('div'));
  }
}

let callback, result, selectedTab = 0;
const source = fs.readFileSync('htdocs/luci-static/resources/view/network/cake-tiny.js', 'utf8');
const view = new Function('form', 'fs', 'poll', 'ui', 'view', 'widgets', 'E', '_', source)(
  { Map, NamedSection: {} },
  {
    exec: async () => {
      calls++;
      if (result instanceof Error) throw result;
      return result;
    },
  },
  {
    add(fn) {
      callback = fn;
    },
  },
  {
    tabs: {
      initTabGroup(nodes) {
        const group = nodes[0].parentNode;
        group.parentNode.insertBefore(E('ul', { class: 'cbi-tabmenu' }), group);
        nodes[selectedTab].attrs['data-tab-active'] = 'true';
      },
    },
  },
  { extend: (value) => value },
  { DeviceSelect: {} },
  E,
  (value) => value,
);
function sample(time, bytes, device = '7/8', complete = '1') {
  return {
    stdout: `enabled=1\nconfigured_device=pppoe-wan\nactive_device=pppoe-wan\ncomplete=${complete}\nsample_time=${time}\ndevice_identity=${device}\n\n[upload]\nqdisc cake 1ca: root\n Sent ${bytes} bytes ${bytes} pkt (dropped 2, overlimits 0 requeues 0)\n backlog 0b 0p\n pk_delay 1ms\n ecn_mark 3\n\n[download]\nqdisc cake 1cb: root\n Sent ${bytes} bytes ${bytes} pkt (dropped 0, overlimits 0 requeues 0)\n\n[filter]\nfilter`,
  };
}
function contents(node) {
  if (typeof node === 'string') return node;
  return [node.textContent || '', ...(node.childNodes || []).map(contents)].join(' ');
}
(async () => {
  const root = await view.render(sample(1, 100));
  const panes = root.childNodes[1].childNodes;
  assert.equal(root.childNodes[0].attrs['class'], 'cbi-tabmenu');
  assert.equal(deviceOption.noaliases, true);
  assert.equal(deviceOption.nocreate, false, 'Keep configured devices while absent');
  assert.equal(deviceOption.validate('main', 'pppoe-wan'), true);
  assert.notEqual(deviceOption.validate('main', '@wan'), true);
  await callback();
  assert.equal(calls, 0, 'Settings tab must not poll status');
  assert.equal(panes[0].attrs['data-tab'], 'settings');
  assert.equal(panes[1].attrs['data-tab'], 'status');
  const actions = E('div', { class: 'cbi-page-actions' }, [E('button', {}, 'Save & Apply'), E('button', {}, 'Save'), E('button', {}, 'Reset')]);
  const fragment = E('fragment', {}, [actions]);
  fragment.nodeType = 11;
  view.super = (method) => {
    assert.equal(method, 'addFooter');
    return fragment;
  };
  const footer = view.addFooter();
  assert.equal(footer, fragment, 'Return the standard LuCI footer fragment');
  assert.equal(footer.style, undefined, 'DocumentFragment has no style property');
  assert.equal(footer.childNodes.length, 0, 'Appending a fragment consumes its children');
  assert.equal(actions.parentNode, panes[0], 'Native actions belong to the settings pane');
  root.appendChild(footer);
  assert.equal(root.childNodes.length, 2, 'Do not mount a second global action bar');
  result = sample(1, 100);
  panes[0].attrs['data-tab-active'] = 'false';
  panes[1].attrs['data-tab-active'] = 'true';
  panes[1]['cbi-tab-active']();
  assert.doesNotMatch(contents(panes[1]), /Save|Reset/, 'Status pane contains no form actions');
  await new Promise((resolve) => setImmediate(resolve));
  panes[0].attrs['data-tab-active'] = 'true';
  panes[1].attrs['data-tab-active'] = 'false';
  assert.equal(actions.parentNode, panes[0], 'Actions remain mounted when switching tabs');
  const callsBeforeSettingsPoll = calls;
  await callback();
  assert.equal(calls, callsBeforeSettingsPoll, 'Returning to settings stops status polling');
  panes[1].attrs['data-tab-active'] = 'true';
  const summary = panes[1].childNodes[1];
  const table = summary.childNodes[2];
  const cell = table.childNodes[1].childNodes[1];
  table.childNodes.forEach((row) => {
    assert.match(row.attrs.class, /\btr\b/);
    row.childNodes.forEach((cell) => {
      assert.equal(cell.attrs.class, cell.tag === 'th' ? 'th' : 'td');
      assert.equal(cell.attrs.style, undefined, 'Use theme table styles');
      if (cell.tag === 'th') assert.equal(cell.attrs.scope, 'col');
    });
  });
  result = sample(4, 3000100);
  await callback();
  assert.match(contents(root), /8.00 Mbps/);
  assert.equal(summary.childNodes[2], table, 'Keep the table across refreshes');
  assert.equal(table.childNodes[1].childNodes[1], cell, 'Update cells in place');
  assert.match(contents(root), /Traffic observed/);
  result = sample(7, 20, '9/10');
  await callback();
  assert.doesNotMatch(contents(root), /8.00 Mbps/);
  result = sample(10, 30, '9/10', '0');
  await callback();
  assert.match(contents(root), /Rules incomplete/);
  result = new Error('RPC unavailable');
  await callback();
  assert.match(contents(root), /Status unavailable: RPC unavailable/);
  assert.equal(summary.childNodes[2], table, 'Errors must preserve the table');
  assert.equal(cell.textContent, '—');
  result = sample(13, 1000, '9/10');
  await callback();
  assert.match(contents(root), /Waiting for samples/);
  assert.doesNotMatch(contents(root), /RPC unavailable/);
  selectedTab = 1;
  const restoredRoot = await view.render(sample(16, 2000, '9/10'));
  const restoredPanes = restoredRoot.childNodes[1].childNodes;
  const restoredActions = E('div', { class: 'cbi-page-actions' }, 'Save');
  const restoredFragment = E('fragment', {}, [restoredActions]);
  restoredFragment.nodeType = 11;
  view.super = () => restoredFragment;
  restoredRoot.appendChild(view.addFooter());
  assert.equal(restoredPanes[1].attrs['data-tab-active'], 'true');
  assert.equal(restoredActions.parentNode, restoredPanes[0], 'Restored status tab still keeps actions inside settings');
  assert.doesNotMatch(contents(restoredPanes[1]), /Save/);
  const emptyFragment = E('fragment');
  emptyFragment.nodeType = 11;
  view.super = () => emptyFragment;
  assert.equal(view.addFooter(), emptyFragment, 'An empty native footer must also be supported');
  console.log('View tab mounting, native footer lifecycle, device selection, incremental updates and error recovery passed');
})();
