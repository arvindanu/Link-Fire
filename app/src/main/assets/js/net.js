'use strict';
/* LINKFIRE — transport. On Android: TCP via the native bridge (NetBridge.kt).
   In a desktop browser: BroadcastChannel between two tabs, for quick testing. */
const Net = (() => {
  const hasA = typeof Android !== 'undefined' && Android && typeof Android.host === 'function';
  let bc = null, role = '';

  const api = {
    native: hasA, role: '', connected: false, lastRx: 0, on: {},

    host() { api.close(); role = api.role = 'h'; if (hasA) Android.host(PORT); else devOpen(); },
    join(ip) { api.close(); role = api.role = 'g'; if (hasA) Android.join(ip || '', PORT); else devOpen(); },

    send(o) {
      if (!api.connected) return;
      const s = JSON.stringify(o);
      if (hasA) Android.send(s);
      else if (bc) bc.postMessage({ k: 'd', to: role === 'h' ? 'g' : 'h', d: s });
    },

    // Drop the opponent only (host keeps listening).
    drop() {
      if (hasA) Android.drop();
      else if (bc) { bc.postMessage({ k: 'bye', to: role === 'h' ? 'g' : 'h' }); api.connected = false; api._ev('closed', ''); }
    },

    close() {
      api.connected = false;
      if (hasA) Android.close();
      if (bc) {
        try { bc.postMessage({ k: 'bye', to: role === 'h' ? 'g' : 'h' }); bc.close(); } catch (e) {}
        bc = null;
      }
    },

    ips() { try { return hasA ? Android.localIps() : ''; } catch (e) { return ''; } },

    // Native -> JS entry point
    _ev(type, data) {
      if (type === 'msg') {
        api.lastRx = performance.now();
        const lines = String(data).split('\n');
        for (const l of lines) {
          if (!l) continue;
          let m = null;
          try { m = JSON.parse(l); } catch (e) { continue; }
          if (api.on.msg) api.on.msg(m);
        }
        return;
      }
      if (type === 'connected') { api.connected = true; api.lastRx = performance.now(); }
      if (type === 'closed' || type === 'error') api.connected = false;
      if (api.on[type]) api.on[type](data);
    }
  };

  function devOpen() {
    bc = new BroadcastChannel('linkfire-dev');
    bc.onmessage = e => {
      const m = e.data;
      if (m.k === 'join' && role === 'h' && !api.connected) { bc.postMessage({ k: 'ok' }); api._ev('connected', 'dev'); }
      else if (m.k === 'ok' && role === 'g' && !api.connected) api._ev('connected', 'dev');
      else if (m.k === 'd' && m.to === role) api._ev('msg', m.d);
      else if (m.k === 'bye' && m.to === role && api.connected) api._ev('closed', '');
    };
    if (role === 'h') setTimeout(() => api._ev('hosting', ''), 0);
    else {
      bc.postMessage({ k: 'join' });
      setTimeout(() => { if (!api.connected) api._ev('error', 'No room found (open the game in another tab and tap CREATE ROOM first).'); }, 1500);
    }
  }

  return api;
})();
