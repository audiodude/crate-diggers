// Local fallback for window.webxdc, active ONLY when no real host is present
// (i.e. opening index.html directly in a browser). Delta Chat and webxdc-dev
// inject the real `window.webxdc`, in which case this file is a no-op.
//
// The shared update log lives in localStorage and fans out across tabs of the
// same origin via the `storage` event. Player identity is PER-TAB (sessionStorage
// or a `?as=alice` URL param), so two tabs are two different players sharing one
// log — open the app in two tabs to play yourself. For full multi-peer testing
// (out-of-order delivery etc.), use `npx webxdc-dev run src`.
if (!window.webxdc) {
  const KEY = 'webxdc-shim-updates';
  const ADDR_KEY = 'webxdc-shim-addr';

  // `?as=alice` (or `?as=alice@host`) forces an identity — handy for testing.
  const params = new URLSearchParams(location.search);
  const asParam = params.get('as');
  let addr;
  if (asParam) {
    addr = asParam.includes('@') ? asParam : `${asParam}@local`;
  } else {
    addr = sessionStorage.getItem(ADDR_KEY);
    if (!addr) {
      addr = 'me-' + Math.floor(Math.random() * 1e6) + '@local';
      sessionStorage.setItem(ADDR_KEY, addr);
    }
  }
  const name = params.get('name') || addr.split('@')[0];

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
