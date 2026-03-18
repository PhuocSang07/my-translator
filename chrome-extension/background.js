// Service Worker for My Translator Chrome Extension

// Handle tab capture stream ID request from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_STREAM_ID') {
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: message.tabId },
      (streamId) => {
        sendResponse({ streamId });
      }
    );
    return true; // will respond asynchronously
  }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
