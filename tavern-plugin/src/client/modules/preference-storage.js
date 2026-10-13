function tavernPreferenceStorage(action, ...args) {
  try { return localStorage[action](...args); }
  catch (_) { return action === 'getItem' ? null : undefined; }
}
