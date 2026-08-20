/* Gmail AutoMail Merge - Timer Worker */
/* This worker runs on a separate thread and is NOT throttled when the tab is in the background */

self.onmessage = function(e) {
  if (e.data.type === 'sleep') {
    setTimeout(() => {
      self.postMessage({ type: 'sleep_done', id: e.data.id });
    }, e.data.ms);
  }
};
