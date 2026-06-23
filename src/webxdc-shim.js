// Local fallback for window.webxdc, active ONLY when no real host is present
// (i.e. opening index.html directly in a browser). Delta Chat and webxdc-dev
// inject the real `window.webxdc`, in which case this file is a no-op.
//
// The shim persists updates in localStorage and fans them out across browser
// tabs via the `storage` event, so you can open two tabs as a crude two-player
// test. For real multiplayer testing, use `npx webxdc-dev run src`.
if (!window.webxdc) {
  const KEY = 'webxdc-shim-updates';
  const NAME_KEY = 'webxdc-shim-name';
  const ADDR_KEY = 'webxdc-shim-addr';

  let addr = localStorage.getItem(ADDR_KEY);
  if (!addr) {
    addr = 'me-' + Math.floor(Math.random() * 1e6) + '@local';
    localStorage.setItem(ADDR_KEY, addr);
  }
  const name = localStorage.getItem(NAME_KEY) || addr.split('@')[0];

  const read = () => JSON.parse(localStorage.getItem(KEY) || '[]');
  const write = (a) => localStorage.setItem(KEY, JSON.stringify(a));

  let listener = null;
  let lastServed = 0;

  function serve() {
    if (!listener) return;
    const all = read();
    for (let i = lastServed; i < all.length; i++) {
      listener({ payload: all[i].payload, serial: i + 1, max_serial: all.length });
    }
    lastServed = all.length;
  }

  window.webxdc = {
    selfAddr: addr,
    selfName: name,
    sendUpdate(update) {
      const all = read();
      all.push({ payload: update.payload });
      write(all);
      serve();
    },
    setUpdateListener(cb, serial = 0) {
      listener = cb;
      lastServed = serial;
      serve();
      return Promise.resolve();
    },
    joinRealtimeChannel() {
      return { send() {}, setListener() {}, leave() {} };
    },
  };

  window.addEventListener('storage', (e) => {
    if (e.key === KEY) serve();
  });

  console.info('[crate-diggers] using local webxdc shim as', addr);
}
