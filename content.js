/* Gmail AutoMail Merge - content.js */

// Background-safe sleep using extension background service worker (not throttled when switching windows)
const sleep = (ms) => new Promise((resolve) => {
  const duration = Math.max(0, ms || 0);
  try {
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "sleep", ms: duration }, (response) => {
        if (chrome.runtime.lastError || !response) {
          setTimeout(resolve, duration);
        } else {
          resolve();
        }
      });
      return;
    }
  } catch (e) {}
  setTimeout(resolve, duration);
});

// Close all open compose dialogs to keep UI clean and prevent multiple windows opening
function closeAllComposeDialogs() {
  try {
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    for (const d of dialogs) {
      if (d.querySelector('input[name="subjectbox"]') || d.querySelector('[aria-label="Message Body"]')) {
        const closeBtn = d.querySelector('[aria-label^="Save & close"], [aria-label^="Close"], .Ha, img.Ha');
        if (closeBtn) {
          closeBtn.click();
        }
      }
    }
  } catch (e) {
    console.error("Error closing compose dialogs:", e);
  }
}

// Dedicated robust recipient field filler
async function fillRecipientField(composeDialog, email) {
  const toInput = await waitForElement(() => resolveElement(SELECTORS.toField, composeDialog), 4000);
  if (!toInput) {
    throw new Error("Could not find 'To' recipient field in Gmail compose.");
  }
  
  toInput.focus();
  await sleep(300); // Allow Gmail dialog autofocus to settle completely
  
  toInput.value = '';
  toInput.dispatchEvent(new Event('input', { bubbles: true }));
  
  // Use execCommand to insert the entire email address at once
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, email);
  } catch (e) {}
  
  // Fallback direct assignment if execCommand was ignored
  if (!inserted || toInput.value !== email) {
    toInput.value = email;
    toInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  await sleep(150);
  
  // Dispatch Enter key (code 13) to convert to recipient chip
  toInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  toInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  toInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  
  // Dispatch Comma key (code 188 / 44) which Gmail also uses for chipping
  toInput.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', keyCode: 188, which: 188, bubbles: true }));
  toInput.dispatchEvent(new KeyboardEvent('keypress', { key: ',', code: 'Comma', keyCode: 44, which: 44, charCode: 44, bubbles: true }));
  toInput.dispatchEvent(new KeyboardEvent('keyup', { key: ',', code: 'Comma', keyCode: 188, which: 188, bubbles: true }));
  
  // Dispatch blur
  toInput.dispatchEvent(new Event('blur', { bubbles: true }));
  await sleep(250);
  
  // Fallback Tab if value wasn't converted
  if (toInput.value && toInput.value.trim().length > 0) {
    toInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true }));
    toInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true }));
  }
}

// Dedicated robust subject field filler (never bleeds into 'To' field)
async function fillSubjectField(composeDialog, subject) {
  const subjectInput = await waitForElement(() => resolveElement(SELECTORS.subjectField, composeDialog), 3000);
  if (!subjectInput) {
    throw new Error("Could not find 'Subject' field in Gmail compose.");
  }
  
  subjectInput.focus();
  await sleep(200);
  
  subjectInput.value = '';
  subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
  
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, subject);
  } catch (e) {}
  
  if (!inserted || subjectInput.value !== subject) {
    subjectInput.value = subject;
    subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(150);
}

// Dedicated robust body field filler
async function fillBodyField(composeDialog, body) {
  const bodyInput = await waitForElement(() => resolveElement(SELECTORS.bodyField, composeDialog), 3000);
  if (!bodyInput) {
    throw new Error("Could not find 'Message Body' field in Gmail compose.");
  }
  
  bodyInput.focus();
  const formattedHTML = formatBodyToGmailHTML(body);
  
  // Try selecting all and inserting HTML via execCommand
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertHTML', false, formattedHTML);
  } catch (e) {}
  
  // Ensure innerHTML is populated
  if (!bodyInput.innerHTML || bodyInput.innerHTML.trim() === '' || bodyInput.innerHTML === '<br>') {
    bodyInput.innerHTML = formattedHTML;
  }
  
  bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
  bodyInput.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(150);
}

// Format raw text or markdown template into Gmail-friendly HTML
function formatBodyToGmailHTML(text) {
  // Convert markdown links: [text](url) -> <a href="url">text</a>
  let html = text;
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|www\.[^\s)]+|[^\s)]+)\)/g, (match, linkText, url) => {
    let href = url;
    if (!/^https?:\/\//i.test(href)) {
      href = 'https://' + href;
    }
    return `<a href="${href}" target="_blank" style="color: #1a0dab; text-decoration: underline;">${linkText}</a>`;
  });

  // Check if it's already HTML containing block elements
  const hasHTMLBlockTags = /<(p|div|br|html|body|table|tr|td|li|ul|ol|h[1-6])\b/i.test(html);
  
  if (hasHTMLBlockTags) {
    return html;
  }
  
  // Wrap lines in native Gmail <div> blocks and handle empty lines properly
  const lines = html.split('\n');
  const formattedLines = lines.map(line => {
    // If the line is empty, Gmail represents it with a <div><br></div>
    if (line.trim() === '') {
      return '<div><br></div>';
    } else {
      return `<div>${line}</div>`;
    }
  });
  
  return formattedLines.join('');
}

// Human simulation clicking with guaranteed trigger in background
async function simulateHumanClick(element) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX, clientY }));
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX, clientY }));
  await sleep(100 + Math.random() * 100);
  
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY, buttons: 1 }));
  try { element.focus(); } catch (e) {}
  await sleep(100 + Math.random() * 80);
  
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY, buttons: 1 }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
  
  // Native click call ensures trigger even when tab/window is unfocused
  try {
    element.click();
  } catch (e) {}
}

// CSV Parser (RFC 4180 compliant)
function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push("");
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  
  if (lines.length === 0) return { headers: [], rows: [] };
  
  const headers = lines[0].map(h => h.trim().toLowerCase());
  const dataRows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    if (values.length !== headers.length) continue; // skip malformed lines
    
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = values[j].trim();
    }
    dataRows.push(rowObj);
  }
  
  return { headers, rows: dataRows };
}

// Gmail DOM Helper Selectors
const SELECTORS = {
  composeButton: [
    'div[role="button"][gh="cm"]',
    '.T-I-KE',
    'div[role="button"][aria-label="Compose"]',
    '[aria-label="Compose"]'
  ],
  toField: [
    'textarea[aria-label="To"]',
    'textarea[aria-label="To recipient"]',
    'input[aria-label="To recipients"]',
    'input[placeholder="Recipients"]',
    'input[peoplekit-id]',
    'textarea[name="to"]',
    'input[name="to"]'
  ],
  subjectField: [
    'input[name="subjectbox"]',
    'input[placeholder="Subject"]',
    '[aria-label="Subject"]'
  ],
  bodyField: [
    'div[role="textbox"][aria-label="Message Body"]',
    'div[aria-label="Message Body"]',
    '.Am.Al-O',
    '.LW-avf'
  ],
  sendButton: [
    'div[role="button"][data-tooltip^="Send"]',
    'div[role="button"][aria-label^="Send"]',
    '.T-I.J-J5-Ji.aoO',
    '.aoO'
  ]
};

async function attachFilesToCompose(composeDialog, files) {
  if (!files || files.length === 0) {
    return;
  }

  let fileInput = resolveElement([
    'input[type="file"]',
    'input[name="Filedata"]',
    'input[accept]',
  ], composeDialog) || document.querySelector('input[type="file"]');

  if (!fileInput) {
    const attachButton = await waitForElement(() => resolveElement([
      'div[role="button"][aria-label="Attach files"]',
      'div[role="button"][aria-label^="Attach"]',
      '[aria-label="Attach files"]',
      '[aria-label^="Attach"]'
    ], composeDialog), 4000);
    await simulateHumanClick(attachButton);
    await sleep(500);

    fileInput = await waitForElement(() => resolveElement([
      'input[type="file"]',
      'input[name="Filedata"]',
      'input[accept]'
    ], composeDialog) || document.querySelector('input[type="file"]'), 4000);
  }

  if (!fileInput) {
    throw new Error('Could not find the Gmail attachment input. Please confirm the compose window is active.');
  }

  try {
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(600 + Math.random() * 400);
  } catch (error) {
    throw new Error(`Failed to attach files to Gmail compose: ${error.message}`);
  }
}

// Generic element resolver trying multiple selectors
function resolveElement(selectors, parent = document) {
  for (const selector of selectors) {
    const el = parent.querySelector(selector);
    if (el) return el;
  }
  return null;
}

// Find Compose Button
function findComposeButton() {
  let btn = resolveElement(SELECTORS.composeButton);
  if (btn) return btn;
  
  // Text search fallback
  const buttons = document.querySelectorAll('div[role="button"]');
  for (const b of buttons) {
    if (b.textContent && b.textContent.trim().toLowerCase() === 'compose') {
      return b;
    }
  }
  return null;
}

// Get the active (most recently opened) compose dialog
function getActiveComposeDialog() {
  const dialogs = document.querySelectorAll('div[role="dialog"]');
  if (dialogs.length === 0) return null;
  return dialogs[dialogs.length - 1];
}

// Wait for element helper
function waitForElement(resolverFn, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const el = resolverFn();
    if (el) return resolve(el);
    
    const startTime = Date.now();
    const interval = setInterval(() => {
      const el = resolverFn();
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error("Timeout waiting for element. Check if compose window opened correctly."));
      }
    }, 150);
  });
}

// Replace placeholders in template e.g. {name} or {email}
function personalizeTemplate(template, row) {
  let result = template;
  for (const [key, val] of Object.entries(row)) {
    const placeholder = `{${key}}`;
    // Case insensitive replace all
    result = result.replace(new RegExp(placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi'), val);
  }
  return result;
}

// Main Mail Merge Automation Controller Class
class MailMergeController {
  constructor() {
    this.csvData = { headers: [], rows: [] };
    this.state = 'idle'; // 'idle', 'sending', 'paused'
    this.currentIndex = 0;
    this.emailColumn = '';
    this.attachmentFiles = [];
    this.dragged = false;
    
    this.initUI();
  }
  
  initUI() {
    // 1. Create floating launcher button
    this.launcher = document.createElement('button');
    this.launcher.className = 'amm-launcher-btn pulse';
    this.launcher.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
      </svg>
    `;
    document.body.appendChild(this.launcher);
    
    // 2. Create control panel modal
    const logoUrl = chrome.runtime.getURL('northpeak-logo.svg');
    this.panel = document.createElement('div');
    this.panel.className = 'amm-panel';
    this.panel.innerHTML = `
      <div class="amm-header" id="ammHeader">
        <div class="amm-header-titles">
          <h3 class="amm-header-title">Gmail AutoMail Merge</h3>
          <span class="amm-header-subtitle">Power By <img src="${logoUrl}" class="amm-header-np-logo" alt="NorthPeak Studio" /> <strong>NorthPeak Studio</strong></span>
        </div>
        <button class="amm-header-close" id="ammClose">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
          </svg>
        </button>
      </div>
      <div class="amm-body">
        <div class="amm-group">
          <label class="amm-label">1. Upload Recipient CSV</label>
          <div class="amm-file-dropzone" id="ammDropzone">
            <svg viewBox="0 0 24 24">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
            </svg>
            <span class="amm-file-text" id="ammFileText">Drag & drop CSV or click to browse</span>
            <span class="amm-file-info" id="ammFileInfo"></span>
            <input type="file" id="ammFileInput" accept=".csv" style="display: none;">
          </div>
        </div>
        
        <div class="amm-vars-guide" id="ammVarsGuide">
          Variables detected: <i>None (upload CSV first)</i>
        </div>
        
        <div class="amm-group">
          <label class="amm-label">2. Email Subject</label>
          <input type="text" class="amm-input" id="ammSubject" placeholder="e.g. Hello {name}, important updates!">
        </div>
        
        <div class="amm-group">
          <label class="amm-label">3. Message Body (Rich Text / HTML supported)</label>
          <div contenteditable="true" class="amm-textarea" id="ammBody" placeholder="Hi {name},&#10;&#10;We wanted to let you know that your email {email} is ready.&#10;&#10;Best regards,&#10;Support Team" style="min-height: 140px; max-height: 200px; overflow-y: auto;"></div>
        </div>

        <div class="amm-group">
          <label class="amm-label">4. Optional attachments for every email</label>
          <div class="amm-attachment-box">
            <input type="file" id="ammAttachmentInput" multiple style="display: none;">
            <button type="button" class="amm-btn amm-btn-secondary amm-attachment-picker" id="ammAttachmentPicker">Choose files</button>
            <button type="button" class="amm-btn amm-btn-danger amm-attachment-clear" id="ammAttachmentClear" style="display: none;">Clear</button>
          </div>
          <div class="amm-attachment-list" id="ammAttachmentList">No files selected</div>
        </div>
        
        <div class="amm-group">
          <label class="amm-label">Delay Between Sends (seconds)</label>
          <input type="number" class="amm-input" id="ammDelay" value="10" min="2" max="60">
        </div>
        
        <div class="amm-group" style="flex-direction: row; align-items: center; gap: 8px;">
          <input type="checkbox" id="ammRandomize" checked style="width: auto; margin: 0; cursor: pointer;">
          <label class="amm-label" for="ammRandomize" style="cursor: pointer; user-select: none;">Randomize delay (+/- 3 seconds)</label>
        </div>
        
        <div class="amm-group" style="flex-direction: row; align-items: center; gap: 8px;">
          <input type="checkbox" id="ammFingerprint" checked style="width: auto; margin: 0; cursor: pointer;">
          <label class="amm-label" for="ammFingerprint" style="cursor: pointer; user-select: none;">Append anti-spam content fingerprint</label>
        </div>

        <div class="amm-group" style="flex-direction: row; gap: 10px;">
          <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
            <label class="amm-label">Batch Size</label>
            <input type="number" class="amm-input" id="ammBatchSize" value="15" min="1" max="100">
          </div>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
            <label class="amm-label">Batch Pause (mins)</label>
            <input type="number" class="amm-input" id="ammBatchPause" value="5" min="1" max="120">
          </div>
        </div>
        
        <div class="amm-progress-section" id="ammProgressSection" style="display: flex;">
          <div class="amm-progress-text">
            <span id="ammProgressStatus">No CSV Loaded</span>
            <span id="ammProgressRatio">0/0</span>
          </div>
          <div class="amm-progress-bar-container">
            <div class="amm-progress-bar" id="ammProgressBar"></div>
          </div>
        </div>
        
        <div class="amm-console" id="ammConsole"></div>
      </div>
      <div class="amm-footer">
        <div class="amm-btn-row">
          <button class="amm-btn amm-btn-primary" id="ammActionBtn" disabled>Start Mail Merge</button>
          <button class="amm-btn amm-btn-danger" id="ammCancelBtn" disabled>Reset</button>
        </div>
        <div class="amm-footer-powered">
          <img src="${logoUrl}" class="amm-footer-logo" alt="NorthPeak Studio" />
          <span>Power By <strong>NorthPeak Studio</strong></span>
        </div>
      </div>
    `;
    document.body.appendChild(this.panel);
    
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    const launcher = this.launcher;
    const panel = this.panel;
    const closeBtn = document.getElementById('ammClose');
    const dropzone = document.getElementById('ammDropzone');
    const fileInput = document.getElementById('ammFileInput');
    const actionBtn = document.getElementById('ammActionBtn');
    const cancelBtn = document.getElementById('ammCancelBtn');
    const header = document.getElementById('ammHeader');
    const attachmentInput = document.getElementById('ammAttachmentInput');
    const attachmentPicker = document.getElementById('ammAttachmentPicker');
    const attachmentClear = document.getElementById('ammAttachmentClear');
    
    // Toggle Panel
    launcher.addEventListener('click', () => {
      panel.classList.toggle('active');
      launcher.classList.remove('pulse');
    });
    
    closeBtn.addEventListener('click', () => {
      panel.classList.remove('active');
    });
    
    // Drag Panel
    let isDragging = false;
    let startX, startY, initialLeft, initialRight, initialBottom, initialTop;
    
    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      // Remove bottom/right positioning to allow absolute repositioning
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.left = `${initialLeft}px` ;
      panel.style.top = `${initialTop}px` ;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${initialLeft + dx}px`;
      panel.style.top = `${initialTop + dy}px`;
    };
    
    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    // File Upload Dialog Trigger
    dropzone.addEventListener('click', () => fileInput.click());
    
    // Drag & Drop CSV
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });
    
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.csv')) {
        this.handleCSVFile(files[0]);
      } else {
        this.log('Invalid file type. Please upload a .csv file.', 'error');
      }
    });
    
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleCSVFile(e.target.files[0]);
      }
    });

    attachmentPicker.addEventListener('click', () => attachmentInput.click());
    attachmentInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleAttachmentFiles(e.target.files);
      }
    });
    attachmentClear.addEventListener('click', () => {
      this.attachmentFiles = [];
      attachmentInput.value = '';
      this.renderAttachmentList();
      this.log('Attachment selection cleared.', 'warn');
    });
    
    // Start / Pause / Resume
    actionBtn.addEventListener('click', () => {
      if (this.state === 'idle') {
        this.startMerge();
      } else if (this.state === 'sending') {
        this.pauseMerge();
      } else if (this.state === 'paused') {
        this.resumeMerge();
      }
    });
    
    // Cancel
    cancelBtn.addEventListener('click', () => {
      this.cancelMerge();
    });
  }
  
  handleCSVFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsed = parseCSV(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        this.log('Error: CSV file seems empty or malformed.', 'error');
        return;
      }
      
      this.csvData = parsed;
      
      // Auto-detect email column
      this.emailColumn = this.csvData.headers.find(h => h.includes('email') || h.includes('mail') || h.includes('to'));
      if (!this.emailColumn && this.csvData.headers.length > 0) {
        this.emailColumn = this.csvData.headers[0];
      }
      
      // Update UI File Info
      document.getElementById('ammFileText').style.display = 'none';
      const fileInfo = document.getElementById('ammFileInfo');
      fileInfo.textContent = `📄 ${file.name} (${this.csvData.rows.length} records detected)`;
      fileInfo.style.display = 'block';
      
      // Update variables guide UI
      const varsGuide = document.getElementById('ammVarsGuide');
      const badgesHTML = this.csvData.headers.map(h => `<span class="amm-var-badge">{${h}}</span>`).join(' ');
      varsGuide.innerHTML = `Personalization placeholders:<br>${badgesHTML}`;
      
      // Enable Start and Reset Buttons
      document.getElementById('ammActionBtn').removeAttribute('disabled');
      document.getElementById('ammCancelBtn').removeAttribute('disabled');
      document.getElementById('ammCancelBtn').textContent = 'Reset';
      
      // Update progress details immediately so the count is shown
      this.updateProgress(0, this.csvData.rows.length);
      document.getElementById('ammProgressStatus').textContent = 'Ready';
      
      this.log(`Successfully loaded CSV file with ${this.csvData.rows.length} rows. Primary recipient column: {${this.emailColumn}}`, 'success');
    };
    reader.readAsText(file);
  }

  handleAttachmentFiles(files) {
    const nextFiles = Array.from(files || []).filter(Boolean);
    if (nextFiles.length === 0) {
      this.log('No valid files were selected for attachment.', 'warn');
      return;
    }

    this.attachmentFiles = nextFiles;
    this.renderAttachmentList();
    this.log(`Selected ${this.attachmentFiles.length} attachment file(s) to include in every email.`, 'success');
  }

  renderAttachmentList() {
    const list = document.getElementById('ammAttachmentList');
    const clearBtn = document.getElementById('ammAttachmentClear');

    if (!this.attachmentFiles || this.attachmentFiles.length === 0) {
      list.textContent = 'No files selected';
      list.classList.add('empty');
      clearBtn.style.display = 'none';
      return;
    }

    list.classList.remove('empty');
    clearBtn.style.display = 'inline-flex';

    const names = this.attachmentFiles.slice(0, 5).map(file => file.name);
    const more = this.attachmentFiles.length > 5 ? ` (+${this.attachmentFiles.length - 5} more)` : '';
    list.textContent = `${names.join(', ')}${more}`;
  }
  
  log(message, type = 'info') {
    const consoleEl = document.getElementById('ammConsole');
    consoleEl.style.display = 'flex';
    
    const logEl = document.createElement('div');
    logEl.className = `amm-console-log ${type}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logEl.textContent = `[${time}] ${message}`;
    
    consoleEl.appendChild(logEl);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    
    console.log(`[AutoMailMerge] ${message}`);
  }
  
  async startMerge() {
    const subject = document.getElementById('ammSubject').value.trim();
    const body = document.getElementById('ammBody').innerHTML.trim();
    
    // Clean up basic HTML tags that browsers add for empty contenteditable divs
    const isBodyEmpty = !body || body === '<br>' || body === '<div><br></div>' || body === '<div></div>';
    
    if (!subject || isBodyEmpty) {
      this.log('Error: Subject and Message Body are required.', 'error');
      alert('Please fill out both Subject and Message Body fields.');
      return;
    }
    
    this.state = 'sending';
    this.currentIndex = 0;
    
    // Toggle action UI elements
    document.getElementById('ammActionBtn').textContent = 'Pause Sending';
    document.getElementById('ammActionBtn').className = 'amm-btn amm-btn-secondary';
    document.getElementById('ammCancelBtn').textContent = 'Cancel';
    document.getElementById('ammCancelBtn').removeAttribute('disabled');
    
    // Disable inputs during processing
    document.getElementById('ammSubject').disabled = true;
    document.getElementById('ammBody').setAttribute('contenteditable', 'false');
    document.getElementById('ammDelay').disabled = true;
    document.getElementById('ammRandomize').disabled = true;
    document.getElementById('ammFingerprint').disabled = true;
    document.getElementById('ammBatchSize').disabled = true;
    document.getElementById('ammBatchPause').disabled = true;
    document.getElementById('ammDropzone').style.pointerEvents = 'none';
    document.getElementById('ammAttachmentPicker').disabled = true;
    document.getElementById('ammAttachmentClear').disabled = true;
    
    this.log('Starting Mail Merge...', 'info');
    
    await this.processQueue();
  }
  
  pauseMerge() {
    this.state = 'paused';
    document.getElementById('ammActionBtn').textContent = 'Resume Sending';
    document.getElementById('ammActionBtn').className = 'amm-btn amm-btn-primary';
    this.log('Mail Merge paused.', 'warn');
  }
  
  async resumeMerge() {
    this.state = 'sending';
    document.getElementById('ammActionBtn').textContent = 'Pause Sending';
    document.getElementById('ammActionBtn').className = 'amm-btn amm-btn-secondary';
    this.log('Resuming Mail Merge...', 'info');
    await this.processQueue();
  }
  
  cancelMerge() {
    const wasActive = this.state === 'sending' || this.state === 'paused';
    this.state = 'idle';
    this.currentIndex = 0;
    
    // Reset UI buttons
    document.getElementById('ammActionBtn').textContent = 'Start Mail Merge';
    document.getElementById('ammActionBtn').className = 'amm-btn amm-btn-primary';
    
    // Enable inputs
    document.getElementById('ammSubject').disabled = false;
    document.getElementById('ammBody').setAttribute('contenteditable', 'true');
    document.getElementById('ammDelay').disabled = false;
    document.getElementById('ammRandomize').disabled = false;
    document.getElementById('ammFingerprint').disabled = false;
    document.getElementById('ammBatchSize').disabled = false;
    document.getElementById('ammBatchPause').disabled = false;
    document.getElementById('ammDropzone').style.pointerEvents = 'all';
    document.getElementById('ammAttachmentPicker').disabled = false;
    document.getElementById('ammAttachmentClear').disabled = false;
    
    if (wasActive && this.csvData && this.csvData.rows && this.csvData.rows.length > 0) {
      // Just stopped sending — keep the CSV loaded so user can restart
      document.getElementById('ammCancelBtn').textContent = 'Reset';
      this.updateProgress(0, this.csvData.rows.length);
      document.getElementById('ammProgressStatus').textContent = 'Stopped';
      this.log('Mail Merge stopped.', 'warn');
    } else {
      // Full reset — clear the loaded CSV and all state
      this.csvData = { headers: [], rows: [] };
      this.emailColumn = '';
      
      document.getElementById('ammFileText').style.display = 'block';
      const fileInfo = document.getElementById('ammFileInfo');
      fileInfo.style.display = 'none';
      fileInfo.textContent = '';
      
      document.getElementById('ammVarsGuide').innerHTML = 'Variables detected: <i>None (upload CSV first)</i>';
      
      this.attachmentFiles = [];
      document.getElementById('ammAttachmentInput').value = '';
      this.renderAttachmentList();
      
      document.getElementById('ammActionBtn').setAttribute('disabled', 'true');
      document.getElementById('ammCancelBtn').textContent = 'Reset';
      document.getElementById('ammCancelBtn').setAttribute('disabled', 'true');
      
      this.updateProgress(0, 0);
      document.getElementById('ammProgressStatus').textContent = 'No CSV Loaded';
      document.getElementById('ammProgressBar').style.width = '0%';
      
      this.log('Mail Merge reset and CSV cleared.', 'error');
    }
  }
  
  updateProgress(current, total) {
    const ratio = document.getElementById('ammProgressRatio');
    const bar = document.getElementById('ammProgressBar');
    const status = document.getElementById('ammProgressStatus');
    
    ratio.textContent = `${current}/${total}`;
    const pct = total > 0 ? (current / total) * 100 : 0;
    bar.style.width = `${pct}%`;
    
    if (this.state === 'sending') {
      status.textContent = 'Sending...';
    } else if (this.state === 'paused') {
      status.textContent = 'Paused';
    }
  }
  
  async processQueue() {
    const total = this.csvData.rows.length;
    const subjectTemplate = document.getElementById('ammSubject').value.trim();
    const bodyTemplate = document.getElementById('ammBody').innerHTML.trim();
    const delaySec = parseInt(document.getElementById('ammDelay').value) || 10;
    const useRandomize = document.getElementById('ammRandomize').checked;
    const useFingerprint = document.getElementById('ammFingerprint').checked;
    const batchSize = parseInt(document.getElementById('ammBatchSize').value) || 15;
    const batchPauseMins = parseInt(document.getElementById('ammBatchPause').value) || 5;
    
    let batchCounter = 0;
    
    while (this.currentIndex < total && this.state === 'sending') {
      // Check if batch size is reached
      if (batchCounter > 0 && batchCounter % batchSize === 0) {
        this.log(`Batch limit of ${batchSize} reached. Pausing for ${batchPauseMins} minutes to prevent spam filters from blocking...`, 'warn');
        
        // Countdown timer loop
        let secondsRemaining = batchPauseMins * 60;
        const statusEl = document.getElementById('ammProgressStatus');
        
        while (secondsRemaining > 0 && this.state === 'sending') {
          const mins = Math.floor(secondsRemaining / 60);
          const secs = secondsRemaining % 60;
          statusEl.textContent = `Batch Pause: ${mins}m ${secs}s`;
          await sleep(1000);
          secondsRemaining--;
        }
        
        if (this.state !== 'sending') return; // if paused or cancelled during sleep
        
        statusEl.textContent = 'Sending...';
        this.log('Resuming sending next batch...', 'success');
        batchCounter = 0; // reset
      }
      
      const row = this.csvData.rows[this.currentIndex];
      const email = row[this.emailColumn];
      
      if (!email) {
        this.log(`Row ${this.currentIndex + 1}: Skipped (email address is empty)`, 'warn');
        this.currentIndex++;
        continue;
      }
      
      const personalizedSubject = personalizeTemplate(subjectTemplate, row);
      let personalizedBody = personalizeTemplate(bodyTemplate, row);
      
      // Anti-spam fingerprinting disabled by default to avoid adding a footer to customer emails.
      if (useFingerprint) {
        // Kept for compatibility, but does not append any footer text.
      }
      
      this.log(`Sending to ${email} (${this.currentIndex + 1} of ${total})...`, 'info');
      this.updateProgress(this.currentIndex, total);
      
      try {
        await this.sendEmailDOM(email, personalizedSubject, personalizedBody);
        this.log(`Success: Email sent to ${email}`, 'success');
        this.currentIndex++;
        batchCounter++;
        this.updateProgress(this.currentIndex, total);
      } catch (err) {
        this.log(`Error sending to ${email}: ${err.message}`, 'error');
        this.pauseMerge();
        return;
      }
      
      // Delay before next send
      if (this.currentIndex < total && this.state === 'sending') {
        // If the next send is going to trigger a batch pause, we skip the normal delay
        if (batchCounter % batchSize === 0) {
          continue; 
        }
        
        let actualDelay = delaySec;
        if (useRandomize) {
          // Randomize by +/- 3 seconds (minimum delay of 3 seconds)
          const offset = Math.floor(Math.random() * 7) - 3;
          actualDelay = Math.max(3, delaySec + offset);
        }
        this.log(`Waiting ${actualDelay} seconds before next email...`, 'info');
        await sleep(actualDelay * 1000);
      }
    }
    
    if (this.currentIndex >= total) {
      this.log(`Mail Merge completed! Sent ${total} emails.`, 'success');
      this.cancelMerge();
    }
  }
  
  // High-fidelity UI automation logic
  async sendEmailDOM(email, subject, body) {
    // 0. Close any stale compose dialogs to prevent multiple windows opening
    closeAllComposeDialogs();
    await sleep(300);
    
    // 1. Click Compose button
    const composeBtn = findComposeButton();
    if (!composeBtn) {
      throw new Error("Could not find 'Compose' button in Gmail. Please ensure you are logged into Gmail.");
    }
    
    await simulateHumanClick(composeBtn);
    
    // 2. Wait for Compose dialog to appear
    const composeDialog = await waitForElement(getActiveComposeDialog, 5000);
    
    // Allow dialog to settle
    await sleep(400 + Math.random() * 300);
    
    // 3. Fill "To" recipient field (with guaranteed chip creation)
    await fillRecipientField(composeDialog, email);
    await sleep(250 + Math.random() * 150);
    
    // 4. Fill "Subject" field (isolated target, never bleeds into 'To' field)
    await fillSubjectField(composeDialog, subject);
    await sleep(250 + Math.random() * 150);
    
    // 5. Fill "Body" text-editor
    await fillBodyField(composeDialog, body);

    // 5b. Attach any queued files to every email
    await attachFilesToCompose(composeDialog, this.attachmentFiles);
    
    // Human-like review delay (1s - 2s)
    const reviewDelay = 1000 + Math.random() * 1000;
    await sleep(reviewDelay);
    
    // 6. Find and click the "Send" button
    const sendBtn = await waitForElement(() => resolveElement(SELECTORS.sendButton, composeDialog), 2000);
    await simulateHumanClick(sendBtn);
    
    // 7. Wait for Compose Dialog to close to verify delivery completion
    let closed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      if (!document.body.contains(composeDialog)) {
        closed = true;
        break;
      }
    }
    
    if (!closed) {
      throw new Error("Compose window did not close after clicking Send. Please check if Gmail shows an alert.");
    }
  }
}

// Self-initializing function on load
function init() {
  // Prevent duplicate instantiations
  if (window.ammController) return;
  
  window.ammController = new MailMergeController();
  console.log("[AutoMailMerge] Initialized successfully.");
  
  // Maintain persistent keep-alive port with background script to prevent tab freezing
  function maintainKeepAlive() {
    try {
      if (chrome && chrome.runtime && chrome.runtime.connect) {
        const port = chrome.runtime.connect({ name: "keepAlive" });
        port.onDisconnect.addListener(() => {
          setTimeout(maintainKeepAlive, 5000);
        });
      }
    } catch (e) {}
  }
  maintainKeepAlive();

  // Listen for message from background.js (toolbar icon click)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "toggle_panel") {
      const panel = document.querySelector('.amm-panel');
      const launcher = document.querySelector('.amm-launcher-btn');
      if (panel) {
        panel.classList.toggle('active');
        if (launcher) {
          launcher.classList.remove('pulse');
        }
      }
      sendResponse({ status: "toggled" });
    }
  });
}

// Run init
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  window.addEventListener('load', init);
}
