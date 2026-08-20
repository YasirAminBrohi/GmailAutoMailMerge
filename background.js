/* Gmail AutoMail Merge - background.js */

// Listen for clicks on the extension action icon in the Chrome toolbar
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes("mail.google.com")) {
    // If we are on Gmail, send a message to toggle the panel
    chrome.tabs.sendMessage(tab.id, { action: "toggle_panel" })
      .catch((err) => {
        console.log("Could not send message to tab. Script might not be loaded yet.", err);
        // Fallback: reload the tab to inject the content script
        chrome.tabs.reload(tab.id);
      });
  } else {
    // If we are not on Gmail, open Gmail in a new tab
    chrome.tabs.create({ url: "https://mail.google.com/" });
  }
});

// Background Timer Service (Unthrottled timer for background tab execution)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sleep") {
    const delay = Math.max(0, request.ms || 0);
    setTimeout(() => {
      sendResponse({ status: "done" });
    }, delay);
    return true; // Keep message channel open for async response
  }
});

// Maintain active port connection to prevent Chrome from freezing background tab
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepAlive") {
    port.onDisconnect.addListener(() => {
      console.log("[AutoMailMerge] Keep-alive port disconnected.");
    });
  }
});
