'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
String.prototype.format = function(...args) { let i = 0; return this.replace(/%s/g, () => args[i++]); };
function E(tag, attrs, children) {
 if (children === undefined && typeof attrs === 'string') { children = attrs; attrs = {}; }
 const node = {tag, attrs: attrs || {}, parentNode: null, childNodes: [],
  appendChild(child) {
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
   this.childNodes.forEach(child => { if (typeof child === 'object') child.parentNode = null; });
   this.childNodes = [];
   children.forEach(child => this.appendChild(child));
  },
  addEventListener(event, fn) { this[event] = fn; },
  getAttribute(name) { return this.attrs[name]; }};
 (Array.isArray(children) ? children : children ? [children] : []).forEach(child => node.appendChild(child));
 return node;
}
let deviceOption, calls = 0;
class Map {
 section() { return { option(type, name) {
  const option = { value() {}, depends() {} };
  if (name === 'wan') deviceOption = option;
  return option;
 } }; }
 render() { return Promise.resolve(E('div')); }
}

let callback, result;
const source = fs.readFileSync('htdocs/luci-static/resources/view/network/cake-tiny.js', 'utf8');
const view = new Function('form', 'fs', 'poll', 'ui', 'view', 'widgets', 'E', '_', source)(
 {Map, NamedSection: {}}, {exec: async () => { calls++; if (result instanceof Error) throw result; return result; }}, {add(fn) { callback = fn; }},
 {tabs: {initTabGroup(nodes) {
  const group = nodes[0].parentNode;
  group.parentNode.insertBefore(E('ul', { 'class': 'cbi-tabmenu' }), group);
  nodes[0].attrs['data-tab-active'] = 'true';
 }}},
 {extend: value => value}, {DeviceSelect: {}}, E, value => value);
function sample(time, bytes, device = '7/8', complete = '1') {
 return {stdout: `enabled=1\nconfigured_device=pppoe-wan\nactive_device=pppoe-wan\ncomplete=${complete}\nsample_time=${time}\ndevice_identity=${device}\n\n[upload]\nqdisc cake 1ca: root\n Sent ${bytes} bytes ${bytes} pkt (dropped 2, overlimits 0 requeues 0)\n backlog 0b 0p\n pk_delay 1ms\n ecn_mark 3\n\n[download]\nqdisc cake 1cb: root\n Sent ${bytes} bytes ${bytes} pkt (dropped 0, overlimits 0 requeues 0)\n\n[filter]\nfilter`};
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
 assert.equal(deviceOption.nocreate, false, "Keep configured devices while absent");
 assert.equal(deviceOption.validate('main', 'pppoe-wan'), true);
 assert.notEqual(deviceOption.validate('main', '@wan'), true);
 await callback();
 assert.equal(calls, 0, 'Settings tab must not poll status');
 assert.equal(panes[0].attrs['data-tab'], 'settings');
 assert.equal(panes[1].attrs['data-tab'], 'status');
 panes[1].attrs['data-tab-active'] = 'true';
 const summary = panes[1].childNodes[1];
 const table = summary.childNodes[2];
 const cell = table.childNodes[1].childNodes[1];
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
 console.log('View tab mounting, device selection, incremental updates and error recovery passed');
})();
